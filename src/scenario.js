const _ = require('lodash');
const debug = require('debug')('mongoosy:scenario');
const glob = require('globby');
const {Types} = require('mongoose');
const Stream = require('stream');
//const Stream = require('readable-stream');
const es = require('event-stream');


/**
* Utility function to quickly load a JSON / JS file into a model
* @param {Objet} mongoosy Mongoosy instance to use
* @param {Object|string|array <string|object>} input Either a JS object(s) or a file glob (or array of globs) to process
* @param {Object} [options] Additional options
* @param {Object} [options.collections] Individual options per collection, each key is a Mongo collection
* @param {Boolean} [options.collections.nuke=false] Allow complete removal of the collection rather than updating
* @param {Array<String>|String} [options.collections.updateBy] Field or array of fields to recognise an existing document
* @param {Object} [options.glob] Additional options to pass to globby
* @param {boolean} [options.circular=false] Try to create stub documents in the first cycle, thus ensuring they always exists. This fixes recursive/graph-like data structures at the cost of speed
* @param {boolean} [options.circularIndexDisable=true] Remove all indexes from the affected models before stubbing then re-implement them after - fixes `{required: true}` stub items
* @param {function} [options.importer] Function to dynamically read in a file and return the evaluated object contents, defaults to a `require` pattern
* @param {boolean} [options.nuke=false] Whether to erase / rebuild existing collections before replacing them entirely, cannot be used if `collections` is specified
* @param {number} [options.threads=3] How many documents to attempt to create at once
* @param {function <Promise>} [options.postRead] Manipulate the merged scenario object before processing, called as (tree) where each key is the model and all keys are an array of items, expected to return the changed tree
* @param {function} [options.postCreate] Function called whenever a document is created under a model, called as (model, count) where model is a string and count the number created for that model so far
* @param {function} [options.postStats] Called when complete as (stats) where each key is the model and the value is the number of documents created
* @returns {Promise} A promise which will resolve when the input data has been processed
*/
module.exports = function MongoosyScenario(mongoosy, input, options) {
	var settings = {
		collections: null,
		glob: undefined,
		circular: false,
		circularIndexDisable: true,
		importer: path => {
			return require(path);
		},
		/*
		// NOTE: Import async module then get contents via callback
		importer(path) {
			const module = require(path);
			if (_.isFunction(module)) {
				return new Promise((resolve, reject) => {
					module(function(err, contents) {
						if (err) return reject(err);

						resolve(contents);
					});
				});
			} else {
				return module;
			}
		},
		*/
		nuke: false,
		threads: 3,
		postRead: undefined,
		postCreate: undefined,
		postStats: undefined,
		...options,
	};
	// Argument checking {{{
	if (settings.nuke && settings.collections) throw new Error('`nuke` cannot be used if `collections` is specified');
	// }}}

	const lookup = {};
	const stubbed = {};
	const needed = {};
	const created = {};
	const modelCounts = {};
	const indexes = {};

	/**
	 * Deeply scan a document replacing all '$items' with their replacements
	 * @param {Object} doc The document to deep scan, document is modified in place
	 * @param {Object} lookup The lookup collection to replace items with
	 * @returns {Object} An array of items that could not be resolved
	 */
	const scanDoc = (doc, lookup = {}) => {
		var unresolved = [];
		var scanNode = (node, path) => {
			if (_.isArray(node)) {
				node.forEach((v, k) => scanNode(v, path.concat(k)));
			} else if (_.isPlainObject(node)) {
				Object.keys(node).forEach(k => k != '$' && scanNode(node[k], path.concat(k)));
			} else if (_.isString(node) && node.startsWith('$') && node.length > 1) {
				if (lookup[node]) {
					_.set(doc, path, new Types.ObjectId(lookup[node]));
				} else {
					unresolved.push(node)
				}
			}
		};
		scanNode(doc, []);
		return unresolved;
	};


	/**
	 * Remove indexes to allow adding stub documents
	 * 
	 * @param {Array} collections List of collections to have indexes removed from
	 * @returns {Promise<Object>}
	 */
	const disableIndexes = collections => {
		debug('STAGE: Disabling Indexes');
		return mongoosy.utils.promiseAllSeries(
			collections.map(m => () => Promise.resolve()
				.then(()=> {
					if (
						settings.collections?.[m]?.nuke === true
						|| settings.nuke === true
					) {
						debug('Clearing collection', m);
						return mongoosy.models[m].deleteMany({})
					}
				})
				.then(()=> {
					if (!settings.circular || !settings.circularIndexDisable) return; // Skip index manipulation if disabled

					debug('Temporarily drop indexes', m);
					return Promise.resolve()
						.then(()=> mongoosy.models[m].syncIndexes({background: false})) // Let Mongoosy catch up to index spec
						.then(()=> mongoosy.models[m].listIndexes())
						.then(indexes => {
							indexes[m] = indexes.filter(index => !_.isEqual(index.key, {_id: 1})) // Ignore meta _id field
							debug(`Will drop indexes on db.${m}:`, indexes[m].map(i => i.name).join(', '));

							// Tell the mongo driver to drop the indexes we don't care about
							// NOTE: Mongoose will abort in-progress index creation when "dropIndexes" is passed an array
							// @see https://jira.mongodb.org/browse/SERVER-37726
							return mongoosy.models[m].collection.dropIndexes(indexes[m].map(index => index.name));
						});
				})
			)
		);
	};


	/**
	 * Re-estabalish original indexes after creating documents
	 * 
	 * @returns {Promise}
	 */
	const rebuildIndexes = () => {
		debug('STAGE: Rebuild indexes')
		return mongoosy.utils.promiseAllSeries(Object.keys(indexes)
			.map(modelName => () => Promise.resolve()
				.then(()=> debug(`Re-create indexes on db.${modelName}:`, indexes[modelName].map(i => i.name).join(', ')))
				.then(()=> {
					if (_.isArray(indexes[modelName]) && indexes[modelName].length > 0) {
						mongoosy.models[modelName].collection.createIndexes(indexes[modelName]);
					}
				})
			)
		);
	};


	/**
	 * Convert incoming objects to readable streams
	 * 
	 * @param {Object} blob Complete scenario object
	 * @returns {Object<Stream>}
	 */
	const convertStreams = blob => {
		//debug('STAGE: Converting data to streams');
		return _.mapValues(blob, item => {
			if (_.isFunction(item)) {
				return item;
			} else if (item instanceof Stream) {
				return item;
			} else {
				const stream = Stream.Readable.from(item, { objectMode: true });
				return stream;
			}
		});
	};


	/*
	const concatStreams = streams =>{
		let pass = new Stream.PassThrough();
		for (let stream of streams) {
			const end = stream == streams.at(-1);
			pass = stream.pipe(pass, { end })
		}
		return pass;
	};
	*/


	/**
	 * Create and read streams from each key and create documents
	 * 
	 * @param {Object} blob Complete scenario object
	 * @param {Boolean} [neededOnly=false] Process only those collections which were waiting on others
	 * @returns {Promise<Object>}
	 */
	const processStreams = (blob, neededOnly = false) => {
		//debug('STAGE: Process streams');
		// When not a stream, create one
		return Promise.resolve()
			//.then(() => convertStreams(blob))
			.then(() => blob) // TODO: Rename variables
			.then(streams => mongoosy.utils.promiseAllSeries(
				_.flatMap(streams, (stream, collection) => () => {
					// Skip collections which are not waiting on needed references
					if (neededOnly && (!_.has(needed, collection) || needed[collection].length === 0)) return;

					debug('STAGE: Process', collection);
					return Promise.resolve()
						// Handle scenarios which return a promise which readies and preprocesses a stream {{{
						.then(() => {
							return new Promise(resolve => {
								if (_.isFunction(stream)) {
									//console.log('waiting for promise', collection);
									Promise.resolve()
										.then(() => stream())
										.then(modifiedStream => resolve(modifiedStream));
								} else {
									//console.log('waiting for readable', collection);
									stream.once('readable', () => resolve(stream));
								}
							});
						})
						// }}}
						// Stream writer // TODO: Encapsulate into it's own object with functions exposed as methods {{{
						.then(readStream => {
							return new Promise(resolve => {
								let incomplete = 0;

								/**
								 * Map an incoming item with reference and collection
								 * 
								 * @param {Object} item 
								 * @returns {Object}
								 */
								const mapItem = function(item) {
									//console.log('mapItem', item);
									if (item.$ && !item.$.startsWith('$')) throw new Error(`All item '$' references must have a value that starts with '$' - given "${item.$}"`);

									if (!needed[collection]) needed[collection] = [];
									return {
										ref: item.$,
										collection,
										item: _.omit(item, '$'),
									};
								};


								/**
								 * Create a stub document given an object
								 * 
								 * @param {Object} item 
								 * @returns {Promise<Object>}
								 */
								const createStub = function(item) {
									if (!options?.circular) return item;
									if (!item || !item.ref) return item; // NOTE: Only stub those with "ref" as per the original filter
									if (stubbed[item.ref] || created[item.ref]) return item;

									//console.log('createStub', item.ref);
									return Promise.resolve()
										.then(() => mongoosy.models[item.collection].create([{}], {validateBeforeSave: false})) // Insert without validation (skips {required: true} specs)
										.then(([created]) => {
											//console.log('created.stub', item.ref, created._id);
											lookup[item.ref] = created._id;
											stubbed[item.ref] = true;
										})
										.then(() => {
											//debug('Created', Object.keys(lookup).length, 'stubs');
											//needed[item.ref] = scanDoc(item, lookup);
											return item;
										});
								};


								/**
								 * Insert or Update a stub with complete document
								 * 
								 * @param {Object} item 
								 * @returns {Promise<Object>}
								 */
								const updateStub = item => {
									if (!item) return;
									if (created[item.ref]) return item; // FIXME: Unable to lookup those without "ref"

									//console.log('updateStub', item.ref);
									return Promise.resolve()
										.then(() => {
											const needs = scanDoc(item.item, lookup);
											if (needs.length > 0) {
												//console.log('needs', item.collection, item.ref, needs, lookup);

												// TODO: Push unique needs
												needed[item.collection].push(...needs);
												incomplete++;
												return; // Cannot create at this stage
											}
											if (!mongoosy.models[item.collection]) throw new Error(`Cannot create item in non-existant or model "${item.collection}"`);

											if (stubbed[item.ref]) { // Item was stubbed in previous stage - update its content if we can
												// NOTE: We can't use findByIdAndUpdate() (or similar) because they don't fire validators
												//console.log('findById', item.collection, item.ref, lookup[item.ref]);
												return mongoosy.models[item.collection].findById(lookup[item.ref])
													.then(doc => {
														if (!doc) throw new Error(`Document "${item.ref}" => "${lookup[item.ref]}" not found!`);

														//console.log('lookup', item.ref, lookup[item.ref]);
														//console.log('doc', doc);
														//console.log('item', item);
														Object.assign(doc, item.item);
														return doc.save();
													})
													.then(()=> {
														created[item.ref] = true;
														stubbed[item.ref] = false;
														needed[item.collection] = needed[item.collection].filter(n => !lookup[n])
														if (options?.postCreate || options?.postStats) {
															modelCounts[item.collection] = modelCounts[item.collection] ? ++modelCounts[item.collection] : 1;
															if (settings.postCreate) settings.postCreate(item.collection, modelCounts[item.collection]);
														}
													})
													.catch(e => {
														debug('Error when updating stub doc', item.collection, 'using spec', item.item, 'Error:', e);
														//if (e.code === 11000) ...
														throw e;
													});
											} else {
												return mongoosy.models[item.collection].insertOne(item.item)
													.then(created => {
														//console.log('created.insertOne', item.ref, created._id);
														// Stash ID?
														// NOTE: Only require a "created" state for items with "ref"
														if (item.ref) {
															lookup[item.ref] = created._id;
															created[item.ref] = true;
															stubbed[item.ref] = false;
															needed[item.collection] = needed[item.collection].filter(n => !lookup[n])
														}

														if (options?.postCreate || options?.postStats) {
															modelCounts[item.collection] = modelCounts[item.collection] ? ++modelCounts[item.collection] : 1;
															if (settings.postCreate) settings.postCreate(item.collection, modelCounts[item.collection]);
														}
													})
													.catch(e => {
														debug('Error when creating doc', item.collection, 'using spec', item.item, 'Error:', e);
														throw e;
													});
											}
										})
										.then(() => {
											//needed[item.ref] = scanDoc(item.item, lookup);
											return item; // Finally return the item
										});
								};


								debug('STAGE: Create/Updating documents', collection);


								/**
								 * Implementing a writable stream to consume the readable and utilising the callback for "pause" seems robust
								 */
								let processed = 0;
								const writeStream = new Stream.Writable({
									write(items, encoding, callback) {
										if (!_.isArray(items)) items = [items]; // FIXME: Ever passed anything other than an array?

										//console.log('write', collection, items);

										mongoosy.utils.promiseAllSeries(
											items.map(item => () => {
												return Promise.resolve()
													.then(() => mapItem(item))
													.then(res => createStub(res))
													.then(res => updateStub(res)) // FIXME: But we need to attempt missing ones from the whole list....
													.catch(e => {
														console.warn('Error processing item', item, e);
														// TODO: reject promise?
														//process.exit(1);
													})
													.finally(() => {
														if (++processed % 10000 === 0) debug(`Processed ${processed} items from "${collection}"`);
													});
											})
										).finally(() => {
											//console.log('write.finally', collection);
											callback();
										});
									},
									objectMode: true
								});

								writeStream.once('close', src => {
									//console.error('writer.close', collection);
									resolve();
								});

								/*
								writeStream.on('pipe', src => {
									console.error('writer.pipe', collection);
								});
								writeStream.on('unpipe', src => {
									console.error('writer.unpipe', collection);
								});
								writeStream.on('pause', src => {
									console.error('writer.pause', collection);
								});
								writeStream.on('resume', src => {
									console.error('writer.resume', collection);
								});

								writeStream.on('end', src => {
									console.error('writer.end', collection);
								});

								writeStream.on('finish', () => {
									console.error('writer.finish', collection);
								});

								readStream.on('close', () => {
									console.log('reader.close', collection, incomplete);
								});

								readStream.on('end', () => {
									console.log('reader.end', collection, incomplete);
								});

								readStream.on('finish', () => {
									console.log('reader.finish', collection, incomplete);
								});

								readStream.on('error', err => {
									console.log('reader.error', collection, err);
								});
								*/

								readStream
									.pipe(es.filterSync(item => (!item.$ || !created[item.$]))) // Remove items which have already been created
									.pipe(writeStream);
							});
						});

				})
				// }}}
			))
			.then(() => blob);
	};


	/**
	 * Imports scenario files
	 * 
	 * @returns {Promise<Object>}
	 */
	const loadScenarios = () => {
		return Promise.resolve()
			.then(()=> mongoosy.utils.promiseAllSeries(_.castArray(input).map(item => () => {
				if (_.isString(item)) {
					return glob(item, options?.glob) // FIXME: Use "settings.glob"
						.then(files => mongoosy.utils.promiseAllSeries(files.map(file => () => Promise.resolve()
							.then(() => delete require.cache[require.resolve(file)]) // Force import to re-execute any initalisation
							.then(()=> settings.importer(file))
							.then(res => {
								if (!res || !_.isObject(res)) throw new Error(`Error importing scenario contents from ${file}, expected object got ${typeof res}`);
								debug('Scenario import', file, '=', _.keys(res).length, 'keys');
								return res;
							})
						)))
				} else if (_.isObject(item)) {
					return item;
				}
			})))
			.then(blob => _.flatten(blob))
	};


	/**
	 * Import file and begin processing
	 * 
	 * @returns {Promise<Object>}
	 */
	const retrieveFiles = () => {
		return new Promise(resolve => {
			/**
			 * Recursive function to enable reprocessing until no documents are missing
			 * 
			 * @param {Boolean} [neededOnly = false]
			 */
			const retrieveFilesInner = (neededOnly = false) => {
				debug('STAGE: Retrieving files for processing');
				Promise.resolve()
				.then(() => loadScenarios())
				.then(blob => {
					//console.log('blob', blob)
					blob = blob.map(file => {
						//console.log('file', file);
						return convertStreams(file)
					});
					return blob;
				})
				.then(blob => {
					return mongoosy.utils.promiseAllSeries(blob.map(file => () => {
						//console.log('file', file)
						return Promise.resolve()
							.then(() => file) // FIXME: Rename variables
							.then(blob => {
								if (!settings.postRead) return blob;

								// Call postRead and wait for response
								return Promise.resolve()
									.then(() => settings.postRead(blob))
									.then(() => blob);
							})
							.then(blob => {
								_.forEach(blob, (v, k) => {
									if (!mongoosy.models[k]) throw new Error(`Unknown model "${k}" when prepairing to create scenario`);
								});
								return blob;
							})
							.then(blob => processStreams(blob, neededOnly))
					}))
					.then(blob => {
						console.log('needed', needed);

						const remaining = _.flatMap(needed, item => {
							return item.length;
						})
						.reduce((acc, cur) => {
							return acc + cur;
						}, 0);
						debug('')

						if (remaining > 0) {
							debug('Leftover unresolvable / wanted IDs', remaining);
							setTimeout(() => {
								// TODO: Identify which collections need retrying and avoid reprocessing large files when not required
								retrieveFilesInner(true);
							}); // Recurse
						} else {
							debug('Processing completed!');
							resolve(blob);
						}
					});
				})
				// TODO: catch and reject outer promise
			};


			/**
			 * First remove indexes, then process files.
			 */
			Promise.resolve()
				.then(() => loadScenarios())
				.then(scenarios => {
					return disableIndexes(_(scenarios)
						.map(Object.keys)
						.flatten()
						.uniq()
						.value()
					);
				})
				.then(() => retrieveFilesInner());
		});
	};

	return retrieveFiles()
		.then(() => {
			if (!settings.circular || !settings.circularIndexDisable) return {modelCounts}; // Skip index manipulation if disabled

			return rebuildIndexes()
				.then(()=> ({modelCounts}));
		})
		.then(({modelCounts}) => {
			debug('STAGE: Finish', modelCounts);
			if (settings.postStats) settings.postStats(modelCounts)
		});
};
