var _ = require('lodash');
var Debug = require('debug');
var debug = Debug('mongoosy');

/**
* Decorate the existing MongooseModel with more methods
*/
module.exports = function(mongoosy) {
	mongoosy.on('model', model => {
		// Make `name` meta property
		model.collectionName = model.collection.collectionName;

		// Create insert / insertOne aliases
		model.insert = model.insertOne = model.create;

		/**
		* Add .meta() method to model which supplies a basic breakdown on the layout of a model
		* @param {Object} [options] Additional options
		* @param {boolean} [options.arrayDefault=true] Set the default type for arrays to `[]`
		* @param {boolean} [options.collectionEnums=true] Convert all enums into a collection of the type `{id: String, title: String}`
		* @param {array<string>} [options.custom] Additional field names to provide, each must be explicitly specified
		* @param {boolean} [options.filterPrivate=true] Omit all fields matching /^_/
		* @param {boolean} [options.indexes=true] Append indexing information
		* @param {boolean} [options.prototype=false] Add a `$prototype` key which contains an empty object with all defaults applied
		*
		* @returns {Object<String: Object>} An object with each dotted notation path as the key and basic information about each path
		* @property {string} type The type of data. Corresponds to 'string', 'number', 'date', 'boolean', 'array', 'object', 'objectid'
		* @property {Array} [enum] If the type of data has an enum this corresponds to the enum options, if `collectionEnums` is specified this is of the form `{id: String, title: String}`
		* @property {*} [default] The default value for the field, this can also be the special case `'[DYNAMIC]'` if it is computed via a function (e.g. Arrays-of-Scalars)
		* @property {boolean} [isRequired] If the `required` field is specified and is truthy
		* @property {boolean} [index] If `options.indexes`, indicates if the field is indexed
		* @property {string} [ref] If the type is `objectid` and the pointer is specified this indicates the referenced collection
		*/
		model.meta = function(options) {
			var settings = {
				arrayDefault: true,
				collectionEnums: true,
				custom: undefined,
				filterPrivate: true,
				indexes: true,
				prototype: false,
				...options,
			};

			var meta = {
				_id: {type: 'objectid', index: true}, // FIXME: Is it always the case that a doc has an ID?
			};

			// Path branches (in dotted notation) {{{
			var scanNode = function(node, prefix) {
				if (!prefix) prefix = '';

				var sortedPaths = _(node)
					.map((v,k) => v)
					.sortBy('path')
					.value();

				_.forEach(sortedPaths, function(path) {
					var id = prefix + path.path;

					if (settings.filterPrivate && _.last(path.path.split('.')).startsWith('_')) return; // Skip private fields

					var info = {};
					switch (path.instance.toLowerCase()) {
						case 'string':
							info.type = 'string';
							if (path.enumValues && path.enumValues.length) {
								if (settings.collectionEnums) {
									info.enum = path.enumValues.map(e => ({
										id: e,
										title: _.startCase(e),
									}));
								} else {
									info.enum = path.enumValues;
								}
							}
							break;
						case 'number':
							info.type = 'number';
							break;
						case 'date':
							info.type = 'date';
							break;
						case 'boolean':
							info.type = 'boolean';
							break;
						case 'array':
							info.type = 'array';
							if (_.has(path, 'schema.paths')) scanNode(path.schema.paths, id + '.');
							if (!_.isUndefined(path.defaultValue)) info.default = [];
							break;
						case 'object':
							info.type = 'object';
							break;
						case 'objectid':
							info.type = 'objectid';
							if (_.has(path, 'options.ref')) info.ref = path.options.ref;
							break;
						default:
							debug('Unknown Mongo data type during meta extract on ' + this.collection + ':', path.instance.toLowerCase());
					}

					// Extract default value if its not a function (otherwise return [DYNAMIC])
					if (!_.isUndefined(path.defaultValue)) info.default = _.isFunction(path.defaultValue) ? '[DYNAMIC]' : path.defaultValue;
					if (settings.indexes && path._index) info.index = true;
					if (path.isRequired) info.required = true;
					if (settings.custom && settings.custom.length > 0) settings.custom
						.filter(customField => path.options[customField] !== undefined)
						.forEach(customField => info[customField] = path.options[customField])

					meta[id] = info;
				});
			};
			scanNode(this.schema.paths);
			// }}}

			// Compute prototype {{{
			if (settings.prototype) {
				meta.$prototype = Object.entries(meta)
					.filter(([key, val]) => key != '_id') // Skip ID field
					.reduce((proto, [key, val]) =>
						_.set(proto, key,
							val.default && val.default != '[DYNAMIC]' ? val.default
							: val.type == 'string' ? ''
							: val.type == 'array' ? []
							: val.type == 'object' ? {}
							: undefined
						)
					, {});
			}
			// }}}

			return meta;
		};


		/**
		* Wrapper around `update()` which makes upserts behave a bit more obviously than using the $upsert property within an update query
		* @param {Object} body The document body to create / update
		* @param {Object|array|string} options A full options body if an object. If non-objects are given they are used to populate `options.by`
		* @param {array|string} options.by The field(s) to use when determining if a document already exists, these fields should all have an index to reduce overhead
		* @param {boolean} [options.result=true] Return the created / updated document. Disable this if you just want to save and ignore the new doc
		* @returns {Object} The created or updated document contents
		*
		* @example Upsert a user by email address
		* mongoosy.models.users.upsert({name: 'Joe Random', email: 'joe@random.com'}, 'email') //= Newly created or updated document
		*/
		model.upsert = function(body, options) {
			// Settings mangling {{{
			if (!_.isPlainObject(options)) options = {by: options};
			var settings = {
				by: _.castArray(options.by),
				result: true,
				...options,
			};
			if (!settings.by) throw new Error('Unknown {by} option in model.upsert(body, {options: {by: String|Array}})');
			if (_.isEmpty(settings.by)) throw new Error('Empty {by} option in model.upsert(body, {options: {by: String|Array}})');
			// }}}

			var queryBy = _.pick(body, settings.by);
			if (Object.keys(queryBy).length < settings.by.length)
				throw new Error(`Upsert {by} keys must be present in the document body in model.upsert(body, options) - keys missing from body: ${settings.by.filter(b => !_.has(body, b)).join(', ')}`);

			return model.updateOne(
				queryBy, // Pass in query against existing document keys
				body,
				{
					..._.omit(settings, 'by'),
					upsert: true,
				},
			)
				.then(rawResult => settings.result
					? model.findOne(queryBy)
					: rawResult
				)
		};


		/**
		* Redirect count -> countDocuments
		* @param {Object} query Query to count by
		* @alias model.countDocuments
		*/
		model.count = function(query) {
			return model.countDocuments(query);
		};


		// Debugging enabled? Strap a debugging prefix onto all doc access methods
		if (debug.enabled || process.env.DEBUG) {
			['count', 'create', 'deleteMany', 'deleteOne', 'findOneAndUpdate', 'insert', 'insertOne', 'insertMany', 'meta', ,'updateMany', 'updateOne', 'upsert']
				.forEach(method => {
					var originalMethod = model[method];
					model[method] = function(...args) {
						debug(method, model.collectionName, ...args);
						Debug(`mongoosy:${method}`)(model.collectionName, ...args);
						return originalMethod.call(this, ...args);
					};
				});
		}
	});
};
