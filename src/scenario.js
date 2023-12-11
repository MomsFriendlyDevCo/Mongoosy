const _ = require('lodash');
const debug = require('debug')('mongoosy:scenario');
const glob = require('globby');
const {Types} = require('mongoose');
const Stream = require('stream');
//const Stream = require('readable-stream');


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
		return Promise.all(Object.keys(indexes)
			.map(modelName => Promise.resolve()
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
		debug('STAGE: Converting data to streams');
		//return Promise.resolve()
		//	.then(() => {
				return _.mapValues(blob, item => {
					// FIXME: "readable-stream" returns instance of what? Different import...
					console.log('instanceOf', _.isFunction(item._read), item instanceof Stream, item instanceof Stream.Readable);
					if (item instanceof Stream) {
					//if (item.readable) { // NOTE: "Stream" but not matching instance
					//if (item instanceof Stream || _.isFunction(item._read)) {
					//if (item instanceof Stream.Readable) {
					//if (_.isFunction(item._read)) {
						//item.pause();
						//const reader = item.getReader();
						//console.log('reader', reader);
						//return reader;
						return item;
					} else {
						const stream = Stream.Readable.from(item, { objectMode: true });
						return stream;
					}
				});
		//	});
	};


	const concatStreams = streams =>{
		let pass = new Stream.PassThrough();
		for (let stream of streams) {
			const end = stream == streams.at(-1);
			pass = stream.pipe(pass, { end })
		}
		return pass;
	}


	/**
	 * Create and read streams from each key and create documents
	 * 
	 * @param {Object} blob Complete scenario object
	 * @returns {Promise<Object>}
	 */
	const processStreams = blob => {
		//debug('STAGE: Process streams');
		// When not a stream, create one
		return Promise.resolve()
			//.then(() => convertStreams(blob))
			.then(() => blob) // TODO: Rename variables
			.then(streams => mongoosy.utils.promiseAllSeries(
				_.flatMap(streams, (stream, collection) => () => {
					debug('STAGE: Process', collection);

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

						//stream.on('readable', () => { // FIXME: Was triggering multiple times
						debug('STAGE: Create/Updating documents', collection);

						/**
						 * Recursive function for reading incoming stream data in a stepwise manner
						 * NOTE: This approach breaks down between "JSONStream" or "stream-json" and "createReadStream" due to various changes through stream versions
						 */
						/*
						const readStream = () => {
							try {
								const data = stream.read();
								console.log('readStream', data);
								if (data === null) {
									debug('Data complete');
									return resolve();
								}

								Promise.resolve()
									.then(() => mapItem(data))
									.then(res => createStub(res))
									.then(res => updateStub(res)) // FIXME: But we need to attempt missing ones from the whole list....
									.catch(e => {
										console.log('map.catch', e);
										// TODO: reject promise?
									})
									.finally(() => {
										setTimeout(() => {
											readStream();
										}); // Recurse
									});
							} catch(e) {
								console.log('e', collection, stream, e);
								debug('Data error');
								return resolve();
							}
						};
						*/

						/**
						 * Attempt at bypassing "read()" issues by using "data" events result in similar incompatibilities
						 */
						/*
						stream.on('data', data => {
							console.log('stream.data', data);
							Promise.resolve()
								.then(() => stream.pause())
								.then(() => mapItem(data))
								.then(res => createStub(res))
								.then(res => updateStub(res)) // FIXME: But we need to attempt missing ones from the whole list....
								.catch(e => {
									console.log('map.catch', e);
									// TODO: reject promise?
								})
								.finally(() => stream.resume());
						});
						*/

						console.log('waiting for readable', collection);
						stream.once('readable', () => {
							console.log('readable', collection);
						});

						/**
						 * Implementing a writable stream to consume the readable and utilising the callback for "pause" seems robust
						 */
						let processed = 0;
						const processingStream = new Stream.Writable({
							write(items, encoding, callback) {
								if (!_.isArray(items)) items = [items]; // FIXME: Ever passed anything other than an array?

								Promise.all(
									items.map(item => {
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
												if (++processed % 500 === 0) debug(`Processed ${processed} items`);
											});
									})
								).finally(() => callback());
							},
							objectMode: true
						});

						processingStream.on('pipe', src => {
							console.error('pipe', collection);
						});
						processingStream.on('unpipe', src => {
							console.error('unpipe', collection);
						});

						stream.pipe(processingStream);

						stream.on('close', () => {
							console.log('stream.close', incomplete);
							resolve();
						});

						stream.on('end', () => {
							console.log('stream.end', incomplete);
						});

						stream.on('error', err => {
							console.log('stream.error', err);
						});
					});

				})
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
			.then(()=> Promise.all(_.castArray(input).map(item => {
				if (_.isString(item)) {
					return glob(item, options?.glob) // FIXME: Use "settings.glob"
						.then(files => Promise.all(files.map(file => Promise.resolve()
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
			 */
			const retrieveFilesInner = () => {
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
					return Promise.all(blob.map(file => {
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
								//console.log('blob', blob);
								return blob;
							})
							/*
							.then(blob => {
								if (disableIndexes) {
									return disableIndexes(blob); // Only nuke items on first pass
								} else {
									return blob;
								}
							})
							*/
							.then(blob => processStreams(blob))
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
								retrieveFilesInner();
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
