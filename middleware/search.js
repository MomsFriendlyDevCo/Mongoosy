const _ = require('lodash');
const {inspect} = require('node:util');

/**
* Add [MODEL|QUERY].search() via middleware to create + search text index fields
* @param {Object} [options] Additional options to mutate behaviour
* @param {String} [options.method='$text'] Method to use when indexing / searching. ENUM: '$text', '$search'
* @param {String} [options.searchIndexPath="_searchIndex"] The path within the MongooseDocument to save the computed data
* @param {String} [options.searchIndexName="searchIndex"] The path within the MongooseDocument to save the computed search index data
* @param {Boolean} [options.createIndex=true] Attempt to create the text / search index
* @param {Function} [options.cleanTerms] Function to clean up tokens prior to indexing, defaults to applying uppercase + debug + replacing awkward characters (but preserving email addresses). Called as `(terms:Array<String>)`
* @param {Boolean|String} [options.tags='auto'] Use the tag parsing middleware prior to searching if it is available. Set to `'auto'` to use if the tags middleware is available
* @param {Function} [options.log] Logging output function
*
* @param {Array<Object>} [options.fields] Collection of fields to index
* @param {String} [options.fields.path] Static path to index (conflicts with 'name')
* @param {String} [options.fields.name] Dynamic item to index (conflicts with 'path')
* @param {Number} [options.fields.weight] Search weighting to apply, higher weight is higher priority. method=$text only
* @param {Function} [options.fields.handler] Function to calculate the term value if `name` is also specified. Called as `(doc)`
* @param {String} [options.fields.type='string'] Data type to store with simple index paths (see https://www.mongodb.com/docs/atlas/atlas-search/define-field-mappings/#data-types ). method=$search only
*
* @example Index a user lastname + age
* MODEL.use(mongoosyMiddlewareSearch, {
*   fields: [
*     {path: 'lastname', weight: 10},
*     {name: 'age', weight: 20, handler: doc => doc.getUserAge()},
*   ],
* })
*/
module.exports = function MongoosyTextIndex(model, options) {
	var settings = {
		method: '$search', // FIXME: Should be $text
		searchIndexPath: '_search',
		searchIndexName: 'searchIndex', // Index name may only contain letters, numbers, hyphens, or underscores
		createIndex: false, // FIXME: should be true
		fields: [],
		cleanTerms: v => _.chain(v)
			.toString()
			.thru(v => v.toUpperCase())
			.deburr()
			.split(/\s+/)
			.map(word =>
				/@/.test(word) // Looks like an email?
					? word.replace(/[^A-Z0-9\-_@\.]+/g, ' ') // Email tidy
					: word.replace(/[^A-Z0-9\-:]+/g, ' ') // Standard tidy
			)
			.join(' ')
			.trim()
			.value(),
		log(...args) {
			console.log('[Mongoosy/Search]', ...args.map(a =>
				typeof a == 'object'
					? inspect(a, {depth: 5, colors: true})
					: a
			));
		},
		tags: 'auto',
		...options,
	};
	// Sanity checks {{{
	if (!['$text', '$search'].includes(settings.method)) throw new Error('Method must be "$text" / "$search" only');
	if (!settings.fields?.length) throw new Error('Must specify at least one field to index');
	// }}}

	// }}}

	if (settings.createIndex && settings.method == '$text') {
		// Create $text index {{{
		model.schema.index(...model.textSearchIndex());

		// Sync indexes from schema to models
		// Model.$indexBuilding is a waitable promise
		model.$indexBuilding = model.createIndexes();
		// }}}
	} else if (settings.createIndex && settings.method == '$search') {
		// Create $search index {{{
		let cmd = model.textSearchIndex();
		console.warn('Run DB command', inspect(cmd, {depth: 9, colors: true}));
		console.warn('FIXME: Skip index build');
		/*
		model.$indexBuilding = mongoosy.connection.db.command(cmd)
			.catch(e => {
				if (/no such command: 'createSearchIndexes'/.test(e.toString())) {
					throw new Error(`Cannot create $search index - are you sure this is a Mongo Atlas endpoint? - ${e.toString()}`);
				} else {
					console.warn('Error while trying to run createSearchIndexes');
					throw e;
				}
			})
		*/
		// }}}
	}

	// MODEL.testSearchIndex(opts) {{{
	/**
	* Generate the syntax to create the text / search indexes against the mode
	* This is automatically called if `{createIndex: true}` when attaching the main middleware
	*
	* If trying to create a $text index this returns the index spec that should be passed to MODEL.createIndex(), if using $search this needs to be run via db.runCommand
	*
	* @returns {*} The specification of the selected index
	*/
	model.textSearchIndex = function mongooseTextSearchIndex(options) {
		var indexSettings = {
			..._.cloneDeep(settings),
			...options,
		};

		if (indexSettings.method == '$text') {
			// Specify all fields as 'text' type
			return [
				Object.fromEntries(
					settings.fields
						.filter(f => {
							if (f.path) return true;
							console.warn('Ignoring unsupported text-index field type', f);
						})
						.map(f => [f.path, 'text'])
				),
				{
					name: settings.searchIndexPath,
					weights: Object.fromEntries(
						settings.fields
							.filter(f => {
								if (f.path) return true;
								console.warn('Ignoring unsupported text-index field type', f);
							})
							.map(f => [f.path, f.weight])
					),
				}
			];
		} else if (indexSettings.method == '$search') {
			let cmd = {
				createSearchIndexes: model.collectionName,
				indexes: [{
					name: indexSettings.searchIndexName,
					definition: {
						mappings: {
							dynamic: false,
							fields: {},
						},
					},
				}],
			};

			// Break dotted notation paths into nested document search indexes
			let rootPath = ['indexes', 0, 'definition', 'mappings', 'fields'];
			indexSettings.fields
				.filter(f => {
					if (f.path) return true;
					console.warn('Ignoring unsupported text-index field type', f);
				})
				.forEach(f => {
					let pathSegments = f.path.split('.');

					if (pathSegments.length == 1) { // Top level path
						_.set(cmd, [...rootPath, ...pathSegments, 'type'], f.type || 'string');
					} else { // Nested path {
						let parentPath = [
							...rootPath,
							pathSegments[0],
						];
						_.set(cmd, [...parentPath, 'type'], 'document');

						let nodePath = [
							...parentPath,
							...pathSegments.slice(1).flatMap(seg => ['fields', seg])
						];

						_.set(cmd, [...nodePath, 'type'], f.type || 'string');
					}
				});

			return cmd;
		}
	};
	// }}}

	// MODEL.textSearch(text, opts) {{{
	/**
	* Fuzzy text index search using the declared search fields
	* @param {String} terms Search terms to filter
	* @param {Object} [options] Additional options
	* @param {Object} [options.match] Additional $match fields to filter by
	* @param {Number} [options.skip] Number of records to skip
	* @param {Number} [options.limit] Number of records to limit by
	* @param {String} [options.scoreField="_score"] Append the search score as this field, set to falsy to disable.
	* @param {Boolean} [options.sortByScore=true] Sort results by the score, descending
	* @param {Boolean} [options.count=false] Return only the count of matching documents, optimizing various parts of the search functionality
	* @param {Boolean} [options.tags=true] Whether to process specified tags. If falsy tag contents are ignored and removed from the term
	* @param {RegExp} [options.tagsRe] RegExp used to split tags
	* @param {Array<String>} [options.searchPaths] Paths to search in the search index, auto-computed as a wildcard if omitted. method=$search only
	* @returns {Mongoose.Aggregate} Mongoose aggregation instance (NOTE: Eventual contents will be POJOs if treated as a thenable, not a MongooseDocument)
	*/
	model.textSearch = function mongooseTextSearch(terms, options) {
		var searchSettings = {
			match: false,
			skip: false,
			limit: false,
			count: false,
			scoreField: '_score',
			sortByScore: true,
			searchPaths: {wildcard: '*'},
			..._.cloneDeep(settings),
			...options,
		};

		return Promise.resolve()
			// Determine if we can use tags {{{
			.then(()=> {
				if (searchSettings.tags === 'auto') {
					searchSettings.tags = !!model.parseTags;
				} else if (searchSettings.tags && !model.parseTags) {
					throw new Error('Specified {tags:true} but the tags middleware is not loaded');
				}
			})
			// }}}
			// Determine fuzzy search, tags + other filters {{{
			.then(()=> searchSettings.tags // Can use tags?
				? model.parseTags(terms) // Parse via tags middleware
				: {fuzzy: terms, tags: {}, aggregation: []} // Assume all terms are fuzzy
			)
			.then(({fuzzy, tags, aggregation})=> {
				searchSettings.log(
					`Performing ${!searchSettings.count ? 'textSearch' : 'textSearch+count'} on`,
					'collection=', model.collectionName,
					'fuzzy=', fuzzy ? `"${fuzzy}"` : '[none]',
					'tags=', searchSettings.tags
						? _(tags)
							.map((v, k) => `${k}:${v}`)
							.thru(v => v.length > 0 ? v.join(', ') : '[none]')
							.value()
						: '[disabled]',
				);

				return {fuzzy, aggregation};
			})
			// }}}
			// Compute aggregation {{{
			.then(({fuzzy, aggregation}) => {
				let agg = [];

				// $match - Fuzzy next matcher (top level matcher) + search settings matcher {{{
				if (fuzzy) {
					if (searchSettings.method == '$text') {
						agg.push({$match: {
							$text: {
								$search: fuzzy,
								$caseSensitive: false,
								$diacriticSensitive: false,
							},
						}});
					} else if (searchSettings.method == '$search') {
						agg.push({$search: {
							index: searchSettings.searchIndexName,
							text: {
								query: fuzzy,
								path: searchSettings.searchPaths,
								fuzzy: {
									prefixLength: 3,
								},
							},
						}});
					}
				}
				// }}}

				// $match - searchSettings.match {{{
				if (searchSettings.match && !_.isEmpty(searchSettings.match))
					agg.push({$match: searchSettings.match});
				// }}}

				// $match - apply all other tag aggregations {{{
				aggregation = aggregation.filter(a => {
					if (a.$match) {
						agg.push(a);
						return false; // Remove from aggregation buffer
					}
				});
				if (aggregation.length > 0) {
					settings.log('Remaining aggregations:', aggregation);
					throw new Error('Aggregations remaining after $match fields extracted, this buffer should be empty');
				}
				// }}}

				// $addFields - Project score field (if searchSettings.scoreField) {{{
				if (searchSettings.scoreField && fuzzy)
					agg.push({$addFields: {
						[searchSettings.scoreField]: {
							$meta: searchSettings.method == '$text' ? 'textScore' : 'searchScore',
						},
					}});
				// }}}

				// $sort - Sort by score (if searchSettings.sortByScore) {{{
				if (searchSettings.scoreField && searchSettings.sortByScore && fuzzy && searchSettings.method == '$text')
					agg.push({$sort: {
						[searchSettings.scoreField]: -1,
					}});
				// }}}

				// $skip (if searchSettings.skip) {{{
				if (searchSettings.skip)
					agg.push({$skip: searchSettings.skip});
				// }}}

				// $limit (if searchSettings.limit) {{{
				if (searchSettings.limit)
					agg.push({$limit: searchSettings.limit});
				// }}}

				// $count (if searchSettings.count) {{{
				if (searchSettings.count)
					agg.push({$count: 'count'});
				// }}}

				return agg;
			})
			// }}}
			// Perform aggregation {{{
			.then(aggregation => {
				searchSettings.log('Perform aggregation', aggregation);
				return model.aggregate(aggregation)
					.then(result => searchSettings.count // Collapse .count field if we're just after the result
						? result?.[0]?.count || 0
						: result
					)
			})
			// }}}
	};
	// }}}
}
