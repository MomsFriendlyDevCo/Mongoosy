var _ = require('lodash');
var debug = require('debug')('mongoosy:rest');

/**
* Mongoosy ReST server
* 	- Adds the class `mongoosy.Rest`
* 	- Adds a global `mongoosy.serve(model, options)` helper function
* 	- Adds a `mongoosy.models.MODEL.serve(options)` function which functions as an Express ReST server
*
* @param {Mongoosy} mongoosy Mongoosy parent instance
* @param {Mongoosymodel} model model instance
* @param {Object} [options] Additional configuration options which overwrite defaults
*/
module.exports = function MongoosyRest(mongoosy, options) {
	var pluginSettings = {
		param: 'id',
		countParam: 'count',
		metaParam: 'meta',
		searchParam: 'q',
		get: true,
		query: true,
		count: true,
		create: false,
		save: false,
		delete: false,
		meta: false,
		searchId: '_id',
		errorHandler: (res, code, text) => res.status(code).send(text),
		selectHidden: false,
		forbidHidden: true,
		neverHidden: ['_id', '__v'],
		...options,
	};

	// mongoosy.Rest {{{
	/**
	* ReST server middleware for Express
	* This middleware is designed to be used with `app.use` rather than picking specific endpoints, although this is also possible if needed
	*
	* NOTES:
	*        * Middleware functions are standard Express pattern middlewares, they can either be a single function or an array
	*        * This function is available as either `mongoosy.serve(model, options)` or `mongoosy.models.model.serve(options)`
	*
	* @param {Mongoosymodel|string} model Mongoosymodel to link against (or its name)
	* @param {Object} [options] Options object
	* @param {string} [options.param="id"] Where to look in req.params for the document ID to get/update/delete
	* @param {string} [options.countParam="count"] Special case URL suffix to identify that we are performating a count operation and not looking up an ID
	* @param {string} [options.metaParam="meta"] Special case URL suffix to identify that we are performating a meta operation and not looking up an ID
	* @param {string} [options.searchParam="q"] Special case URL querystring to identify that we are performating a search operation and not looking up an ID
	* @param {string} [options.searchId="_id"] What field to search by when fetching / updating / deleting documents
	* @param {boolean|array <function>|function} [options.get=true] Enable getting of records or specify middleware(s) to execute beforehand
	* @param {boolean|array <function>|function} [options.query=true] Enable querying of records or specify middleware(s) to execute beforehand
	* @param {boolean|array <function>|function} [options.count=true] Enable counting of records or specify middleware(s) to execute beforehand
	* @param {boolean|array <function>|function} [options.search=false] Enable searching of records or specify middleware(s) to execute beforehand
	* @param {boolean|array <function>|function} [options.create=false] Enable creating of records or specify middleware(s) to execute beforehand
	* @param {boolean|array <function>|function} [options.save=false] Enable updating of records or specify middleware(s) to execute beforehand
	* @param {boolean|array <function>|function} [options.delete=false] Enable deleting of records or specify middleware(s) to execute beforehand
	* @param {boolean|array <function>|function} [options.meta=false] Enable retrieving the structure of the collection (as above)
	* @param {object|function <Promise>|function} [options.queryForce] Override the incomming req.query object with either a static object or an evaluated promise returns. Called as `(req)`
	* @param {function <Promise>|function} [options.queryValidate] Validate an incomming query, similar to `queryForce`. Throw an error to reject. Called as `(req)`.
	* @param {array<string>} [metaCustomFields] Additional fields to expose in meta
	* @param {boolean} [selectHidden=false] Automatically surpress all output fields prefixed with '_'
	* @param {boolean} [forbidHidden=true] Forbid the selection of fields prefixed with '_' if the field has `{select: false}`
	* @param {array<string>} [neverHidden=['_id', '__v']] Array of items which are excluded from hiding
	* @param {function} [options.errorHandler] How to handle errors, default is to use Expresses `res.status(code).send(text)` method. Called as (res, code, text)
	*
	* @example Create a simple ReST server of 'users' with default options
	* app.use('/api/users', mongoosy.serve('users'))
	*
	* @example Create a ReST server where widgets can be created, updated and deleted as well as the default queries
	* app.use('/api/widgets', mongoosy.models.widgets.serve({
	*   create: true,
	*   save: true,
	*   delete: (req, res, next) => res.send('Are you sure you should be deleting that?'),
	* ))
	*/
	mongoosy.Rest = function MongoosyRest(model, options) {
		var settings = {...pluginSettings, ...options};

		if (_.isString(model)) {
			if (!mongoosy.models[model]) throw new Error(`Cannot create ReST middleware for non-existant model "${model}". Try declaring its schema first`);
			model = mongoosy.models[model];
		} else if (_.isObject(model)) {
			// Pass
		} else if (!model) {
			throw new Error('Unspecified model when creating ReST middleware');
		} else {
			throw new Error('Unspecified model type when creating ReST middleware');
		}

		var removeMetaParams = query => _.omit(query, ['limit', 'select', 'skip', 'sort']);

		debug('Setup ReST middleware for model', model.modelName);
		return (req, res) => {
			var serverMethod;

			Promise.resolve()
				// Determine serverMethod {{{
				.then(()=> { // Work out method to use (GET /api/:id -> 'get', POST /api/:id -> 'save' etc.)
					if (req.method == 'GET' && settings.countParam && req.params[settings.param] && req.params[settings.param] == settings.countParam) { // Count matches
						serverMethod = 'count';
					} else if (req.method == 'GET' && settings.metaParam && req.params[settings.param] && req.params[settings.param] == settings.metaParam) { // Return meta information
						serverMethod = 'meta';
					} else if (req.method == 'GET' && req.params[settings.param] != undefined) { // Get one document
						serverMethod = 'get';
					} else if (model.search != undefined && req.method == 'GET' && req.query[settings.searchParam] != undefined) { // Search documents (given a search querystring)
						serverMethod = 'search';
					} else if (req.method == 'GET') { // List all documents (filtered via req.query)
						serverMethod = 'query';
					} else if (req.method == 'POST' && req.params[settings.param] != undefined) { // Update an existing document
						serverMethod = 'save';
					} else if (req.method == 'POST') { // Create a new document (from req.body)
						serverMethod = 'create';
					} else if (req.method == 'DELETE' && req.params[settings.param] != undefined) { // Delete one document
						serverMethod = 'delete';
					} else {
						throw new Error('Unknown endpoint');
					}

					if (settings[serverMethod] === false) throw new Error('Not found'); // Endpoint is disabled
				})
				// }}}
				// Force query injection via queryForce {{{
				.then(()=> {
					if (!settings.queryForce || serverMethod == 'get' || serverMethod == 'save' || serverMethod == 'create'  || serverMethod == 'delete') return;

					if (_.isFunction(settings.queryForce)) {
						return Promise.resolve(settings.queryForce(req, res))
							.then(newQuery => {
								if (!newQuery) return debug('Dont clobber req.query from queryForce undefined return');
								debug('Clobber req.query with replacement value from queryForce:', newQuery);
								req.query = newQuery
							})
					} else if (_.isObject(settings.queryForce)) {
						debug('Clobber req.query with replacement value from queryForce:', settings.queryForce);
						req.query = settings.queryForce;
					}
				})
				// }}}
				// Query validation {{{
				.then(()=> {
					if (settings.forbidHidden && ['get', 'query'].includes(serverMethod) && req.query.select && req.query.select.split(/[\s\,]+/).some(f => !settings.neverHidden.includes(f) && f.startsWith('_'))) return Promise.reject('You are not allowed to select hidden database fields');

					if (!settings.queryValidate || ['get', 'save', 'create', 'delete'].includes(serverMethod)) return;

					return Promise.resolve(settings.queryValidate(req, res))
				})
				// }}}
				// Run middleware {{{
				.then(()=> {
					var middleware = settings[serverMethod];

					if (middleware === true || (Array.isArray(middleware) && !middleware.length)) { // Endpoint enabled or no middleware to call
						return; // Pass through
					} else if (Array.isArray(middleware)) { // Array of middleware - run in series until exhausted
						var middlewareQueue = [...middleware]; // Soft copy middleare
						return new Promise((resolve, reject) => {
							var runNextMiddleware = err => {
								if (err) return reject(err);
								var thisMiddleware = middlewareQueue.shift();
								if (!thisMiddleware) return resolve(); // Exhausted all middleware
								thisMiddleware(req, res, runNextMiddleware);
							}
							runNextMiddleware();
						});
					} else if (typeof middleware == 'function') { // Single function
						return new Promise((resolve, reject) => {
							middleware(req, res, err => {
								if (err) return reject(err);
								resolve();
							});
						});
					} else {
						throw new Error('Unknown middleware structure');
					}
				})
				// }}}
				// Execute function and return (main query handler - GET, POST etc.) {{{
				.then(()=> {
					if (debug.enabled) debug('Perform ReST', {
						serverMethod,
						[settings.searchId]: req.params[settings.param],
						query: req.query,
						queryNoMeta: removeMetaParams(req.query),
						body: req.body,
					});


					/**
					* Internal function used to map documents before outputting
					* This has no function if settings.selectHidden is enabled, if not it hides all `_` prefixed fields
					*/
					var docMap = doc => {
						if (settings.selectHidden) return doc.toObject(); // No rewrite needed
						return _.pickBy(doc.toObject(), (v, k) => settings.neverHidden.includes(k) || !k.startsWith('_'));
					};

					// FIXME: Are there cases here which should call `exec()` instead of relying on a single `then`?
					switch (serverMethod) {
						case 'count': return model.countDocuments(removeMetaParams(req.query))
							.then(count => ({count}))
							.catch(()=> res.sendStatus(400));

						case 'meta': return Promise.resolve(model.meta({custom: settings.metaCustomFields}))
							.catch(()=> res.sendStatus(400));

						case 'get': return model.findOne({
								[settings.searchId]: req.params[settings.param],
							})
							// FIXME: This select does not hold, debug logs say all fields are expliticitly selected
							.select(req.query.select ? req.query.select.split(/[\s\,]+/).join(' ') : undefined)
							.then(doc => {
								if (doc) return docMap(doc);
								res.sendStatus(404);
								return;
							})
							.catch(()=> res.sendStatus(404));

						case 'query': return model.find(removeMetaParams(req.query))
							.select(req.query.select ? req.query.select.split(/[\s\,]+/).join(' ') : undefined)
							.sort(req.query.sort)
							.limit(parseInt(req.query.limit))
							.skip(parseInt(req.query.skip))
							.then(docs => docs.map(docMap))
							.catch(e => settings.errorHandler(res, 400, e))

						case 'search': return model.search(req.query[settings.searchParam])
							.then(docs => docs.map(docMap))
							.catch(e => settings.errorHandler(res, 400, e))


						case 'save': return model.findById(req.params[settings.param])
							.then(doc => { // Mutate existing document while dirtying top-level keys.
								// FIXME: This pattern failed to touch root-level setters.
								//_.merge(doc, _.omit(req.body, ['_id', '__v']));
								delete req.body.__v;
								for (var k in req.body) {
									doc[k] = req.body[k];
								}
								return doc.save();
							})
							.then(doc => {
								if (doc) return docMap(doc);
								return settings.errorHandler(res, 404, 'Document not found when performing update');
							})
							.catch(e => {
								debug(`Failed to update document "${req.params[settings.param]}" - ${e.toString()}`);
								console.log(e);
								return settings.errorHandler(res, 400, e);
							})

						case 'create': return model.create(req.body)
							.catch(e => settings.errorHandler(res, 400, e))

						// FIXME: Like Model.remove(), this function does not trigger pre('remove') or post('remove') hooks.
						case 'delete': return model.deleteOne({
								[settings.searchId]: req.params[settings.param],
							})
							.then(()=> undefined)
							.catch(e => settings.errorHandler(res, 400, e))

						default:
							throw new Error(`Unsupported queryMethod "${queryMethod}"`);
					}
				})
				// }}}
				// End {{{
				.then(output => output == res ? res.end() : res.send(output)) // Send output if Express has not already terminated
				.catch(e => {
					debug('ReST query failed with', e);
					settings.errorHandler(res, 400, e)
				})
				// }}}
		};
	};
	// }}}

	// mongoosy.serve {{{
	/**
	* Create a new Express compatible ReST server middleware
	* @param {string|Mongoosymodel} model The model to bind to, or its name
	* @param {Object} [options] Additional options to use, see the MongoosyRest for the full list of options
	* @returns {MongoosyRest} A MongoosyRest express middleware factory
	*/
	mongoosy.serve = (model, options) =>
		new mongoosy.Rest(mongoosy.models[model], options);
	// }}}

	// mongoosy.models.model.serve {{{
	mongoosy.on('model', model => {
		/**
		* Create a new Express compatible ReST server middleware
		* @param {Object} [options] Additional options to use, see the MongoosyRest for the full list of options
		* @returns {MongoosyRest} A MongoosyRest express middleware factory
		*/
		model.serve = options =>
			new mongoosy.Rest(model, options);
	});
	// }}}
};
