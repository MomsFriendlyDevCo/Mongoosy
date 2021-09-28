var _ = require('lodash');
var debug  = require('debug')('mongoosy:scenario');
var glob = require('globby');
var {Types} = require('mongoose');


/**
* Deeply scan a document replacing all '$items' with their replacements
* @param {Object} doc The document to deep scan, document is modified in place
* @param {Object} lookup The lookup collection to replace items with
* @returns {Object} An array of items that could not be resolved
*/
var scanDoc = (doc, lookup = {}) => {
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
* Utility function to quickly load a JSON / JS file into a model
* @param {Objet} mongoosy Mongoosy instance to use
* @param {Object|string|array <string|object>} input Either a JS object(s) or a file glob (or array of globs) to process
* @param {Object} [options] Additional options
* @param {Object} [options.glob] Additional options to pass to globby
* @param {boolean} [options.circular=false] Try to create stub documents in the first cycle, thus ensuring they always exists. This fixes recursive/graph-like data structures at the cost of speed
* @param {boolean} [options.circularIndexDisable=true] Remove all indexes from the affected models before stubbing then re-implement them after - fixes `{required: true}` stub items
* @param {boolean} [options.nuke=false] Whether to erase / rebuild existing collections before replacing them entirely
* @param {number} [options.threads=3] How many documents to attempt to create at once
* @param {function <Promise>} [options.postRead] Manipulate the merged scenario object before processing, called as (tree) where each key is the model and all keys are an array of items, expected to return the changed tree
* @param {function} [options.postCreate] Function called whenever a document is created under a model, called as (model, count) where model is a string and count the number created for that model so far
* @param {function} [options.postStats] Called when complete as (stats) where each key is the model and the value is the number of documents created
* @returns {Promise} A promise which will resolve when the input data has been processed
*/
module.exports = function MongoosyScenario(mongoosy, input, options) {
	var settings = {
		glob: undefined,
		circular: false,
		circularIndexDisable: true,
		nuke: false,
		threads: 3,
		postRead: undefined,
		postCreate: undefined,
		postStats: undefined,
		...options,
	};

	return Promise.resolve()
		.then(()=> Promise.all(_.castArray(input).map(item => {
			if (_.isString(item)) {
				return glob(item, options?.glob)
					.then(files => files.map(file => {
						var res = require(file);
						if (!res || !_.isObject(res)) throw new Error(`Error importing scenario contents from ${file}, expected object got ${typeof res}`);
						debug('Scenario import', file, '=', _.keys(res).length, 'keys');
						return res;
					}))
			} else if (_.isObject(item)) {
				return item;
			}
		})))
		.then(blob => _.flatten(blob))
		.then(blob => blob.reduce((t, items) => {
			_.forEach(items, (v, k) => {
				t[k] = t[k] ? t[k].concat(v) : v;
			});
			return t;
		}, {}))
		.then(blob => {
			if (!settings.postRead) return blob;

			// Call postRead and wait for response
			return Promise.resolve(settings.postRead(blob)).then(()=> blob);
		})
		.then(blob => {
			_.forEach(blob, (v, k) => {
				if (!mongoosy.models[k]) throw new Error(`Unknown model "${k}" when prepairing to create scenario`);
			});
			return blob;
		})
		.then(blob => { // Process each model we will operate on
			var rebuildIndexes = {}; // Model => Indexes[] spec to rebuild later if in circular mode

			return Promise.all(
				Object.keys(blob)
					.map(m => Promise.resolve()
						.then(()=> {
							if (!settings.nuke) return;
							debug('STAGE: Clearing collection', m);
							return mongoosy.models[m].deleteMany({})
						})
						.then(()=> {
							if (!settings.circular || !settings.circularIndexDisable) return; // Skip index manipulation if disabled
							debug('STAGE: Temporarily drop indexes');
							return Promise.resolve()
								.then(()=> mongoosy.models[m].syncIndexes({background: false})) // Let Mongoosy catch up to index spec
								.then(()=> mongoosy.models[m].listIndexes())
								.then(indexes => {
									rebuildIndexes[m] = indexes.filter(index => !_.isEqual(index.key, {_id: 1})) // Ignore meta _id field
									debug(`Will drop indexes on db.${m}:`, rebuildIndexes[m].map(i => i.name).join(', '));

									// Tell the mongo driver to drop the indexes we don't care about
									return Promise.all(rebuildIndexes[m].map(index =>
										mongoosy.models[m].collection.dropIndex(index.name)
									))
								})
						})
					)
			)
				.then(()=> ({blob, rebuildIndexes}));
		})
		.then(({blob, rebuildIndexes}) => ({
			rebuildIndexes,
			queue: _.flatMap(blob, (items, collection) => { // Flatten objects into array
				return items.map(item => {
						if (item.$ && !item.$.startsWith('$')) throw new Error(`All item '$' references must have a value that starts with '$' - given "${item.$}"`);
						return {
							id: item.$,
							needs: options?.circular ? [] : scanDoc(item), // Calculate document pre-requisite needs if not in circular mode
							collection,
							item: _.omit(item, '$'),
						};
					});
			}),
		}))
		.then(({queue, rebuildIndexes}) => {
			var lookup = {};
			if (!options?.circular) return {queue, lookup, rebuildIndexes}; // Not stubbing
			debug('STAGE: Create stubs');

			// Create empty records for all items with an ID
			return mongoosy.utils.promiseAllLimit(options?.threads ?? 3,
				queue
					.filter(item => item.id)
					.map(item => ()=>
						mongoosy.models[item.collection].create([{}], {validateBeforeSave: false}) // Insert without validation (skips {required: true} specs)
							.then(([created]) => {
								item.stub = true;
								lookup[item.id] = created._id;
							})
					)
			)
				.then(()=> {
					debug('Created', Object.keys(lookup).length, 'stubs');

					queue.forEach(q => scanDoc(q.item, lookup)); // Map all stub IDs into the documents

					return {queue, lookup, rebuildIndexes};
				})
		})
		.then(({queue, lookup, rebuildIndexes}) => {
			var scenarioCycle = 0;
			var modelCounts = {};

			var tryCreate = ()=> Promise.resolve()
				.then(()=> debug(`STAGE: Try/Create cycle #${scenarioCycle}`))
				.then(()=> mongoosy.utils.promiseAllLimit(options?.threads ?? 3, queue.map(item => ()=> {
					if (item.needs.length > 0) return; // Cannot create at this stage
					if (!mongoosy.models[item.collection]) throw new Error(`Cannot create item in non-existant or model "${item.collection}"`);

					if (item.stub) { // Item was stubbed in previous stage - update its content if we can
						// NOTE: We can't use findByIdAndUpdate() (or similar) because they don't fire validators
						return mongoosy.models[item.collection].findById(lookup[item.id])
							.then(doc => {
								Object.assign(doc, item.item);
								return doc.save();
							})
							.then(()=> {
								item.created = true;
								if (options?.postCreate || options?.postStats) {
									modelCounts[item.collection] = modelCounts[item.collection] ? ++modelCounts[item.collection] : 1;
									if (settings.postCreate) settings.postCreate(item.collection, modelCounts[item.collection]);
								}
							})
							.catch(e => {
								debug('Error when updating stub doc', item.collection, 'using spec', item.item, 'Error:', e);
								throw e;
							});
					} else {
						return mongoosy.models[item.collection].insertOne(item.item)
							.then(created => {
								// Stash ID?
								if (item.id) lookup[item.id] = created._id;
								item.created = true;

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
				})))
				.then(()=> { // Filter queue to non-created items
					var newQueue = queue.filter(item => !item.created);
					if (newQueue.length > 0 && queue.length == newQueue.length) {
						debug('------- UNRESOLVABLE SCENARIO -----');
						debug('Leftover unresolvable / wanted IDs: %O', _.chain(newQueue)
							.map(q => q.needs)
							.flatten()
							.sort()
							.uniq()
							.value()
						);
						debug('-------- UNRESOLVABLE QUEUE -------');
						debug(newQueue);
						debug('---------------- END --------------');
						throw new Error(debug.enabled ? 'Unresolvable scenario' : 'Unresolvable scenario - set DEBUG=mongoosy:scenario to see document queue');
					}

					debug('Imported', queue.length - newQueue.length, 'in scenario cycle with', newQueue.length, 'remaining after cycle', ++scenarioCycle);
					queue = newQueue;
				})
				.then(()=> queue = queue.map(item => {
					item.needs = scanDoc(item.item, lookup);
					return item;
				}))
				// FIXME: Decouple stack depth?
				.then(()=> queue.length && tryCreate())

			return tryCreate()
				.then(()=> ({rebuildIndexes, modelCounts}))
		})
		.then(({rebuildIndexes, modelCounts}) => {
			if (!settings.circular || !settings.circularIndexDisable) return {modelCounts}; // Skip index manipulation if disabled
			debug('STAGE: Rebuild indexes')
			return Promise.all(Object.keys(rebuildIndexes)
				.map(modelName =>Promise.resolve()
					.then(()=> debug(`Re-create indexes on db.${modelName}:`, rebuildIndexes[modelName].map(i => i.name).join(', ')))
					.then(()=> mongoosy.models[modelName].collection.createIndexes(rebuildIndexes[modelName]))
				)
			).then(()=> ({modelCounts}))
		})
		.then(({modelCounts}) => {
			debug('STAGE: Finish');
			if (settings.postStats) settings.postStats(modelCounts)
		});
};
