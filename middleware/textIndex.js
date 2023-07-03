const _ = require('lodash');
const mongoosy = require('../src/mongoosy');
const stringSplit = require('string-split-by');
const {inspect} = require('node:util');

/**
* Add [MODEL|QUERY].textIndex() via middleware to create + search text index fields
* @param {Object} [options] Additional options to mutate behaviour
* @param {String} [options.textIndexPath="_textIndex"] The path within the MongooseDocument to save the computed data
* @param {Function} [options.cleanTerms] Function to clean up tokens prior to indexing, defaults to applying uppercase + debug + replacing awkward characters (but preserving email addresses). Called as `(terms:Array<String>)`
* @param {Boolean|String} [options.tags='auto'] Use the tag parsing middleware prior to searching if it is available. Set to `'auto'` to use if the tags middleware is available
* @param {Function} [options.log] Logging output function
*
* @param {Array<Object>} [options.fields] Collection of fields to index
* @param {String} [options.fields.path] Static path to index (conflicts with 'name')
* @param {String} [options.fields.name] Dynamic item to index (conflicts with 'path')
* @param {Number} [options.fields.weight] Search weighting to apply, higher weight is higher priority
* @param {Function} [options.fields.handler] Function to calculate the term value if `name` is also specified. Called as `(doc)`
*
* @example Index a user lastname + age
* MODEL.use(mongoosyTextIndex, {
*   fields: [
*     {path: 'lastname', weight: 10},
*     {name: 'age', weight: 20, handler: doc => doc.getUserAge()},
*   ],
* })
*/
module.exports = function MongoosyTextIndex(model, options) {
	var settings = {
		textIndexPath: '_textIndex',
		fields: [],
		cleanTerms: v => _.chain(v)
			.toString()
			.thru(v => v.toUpperCase())
			.deburr()
			.split(/\s+/)
			.map(word =>
				/@/.test(word) // Looks like an email?
					? word.replace(/[^A-Z0-9\-\_\@\.]+/g, ' ') // Email tidy
					: word.replace(/[^A-Z0-9\-:]+/g, ' ') // Standard tidy
			)
			.join(' ')
			.trim()
			.value(),
		log(...args) {
			console.log('[Mongoosy/TextSearch]', ...args.map(a =>
				typeof a == 'object'
					? inspect(a, {depth: 5, colors: true})
					: a
			));
		},
		tags: 'auto',
		...options,
	};
	// Sanity checks {{{
	if (!settings.fields?.length) throw new Error('Must specify at least one field to index');
	// }}}

	// }}}

	// Create text index against the model {{{
	// FIXME: Need to edit schema with 'text' type?
	// model.schema.add({[settings.textIndexPath]: 'text'});

	model.schema.index(
		// Specify all fields as 'text' type
		Object.fromEntries(
			settings.fields
				.filter(f => {
					if (f.path) return true;
					console.warn('Ignoring unsupported text-index field type', f);
				})
				.map(f => [f.path, 'text'])
		),
		{
			name: settings.textIndexPath,
			weights: Object.fromEntries(
				settings.fields
					.filter(f => {
						if (f.path) return true;
						console.warn('Ignoring unsupported text-index field type', f);
					})
					.map(f => [f.path, f.weight])
			),
		},
	);

	// Sync indexes from schema to models
	// Model.$indexBuilding is a waitable promise
	model.$indexBuilding = model.createIndexes()
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
	* @returns {Mongoose.Aggregate} Mongoose aggregation instance (NOTE: Eventual contents will be POJOs if treated as a thenable, not a MongooseDocument)
	*/
	model.textSearch = function mongooseTextSearch(terms, options) {
		var query = this;
		var searchStart = Date.now();
		var searchSettings = {
			match: false,
			skip: false,
			limit: false,
			count: false,
			scoreField: '_score',
			sortByScore: true,
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
				if (fuzzy)
					agg.push({$match: {
						$text: {
							$search: fuzzy,
							$caseSensitive: false,
							$diacriticSensitive: false,
						},
					}});
				// }}}

				// $match - searchSettings.match {{{
				if (searchSettings.match && searchSettings.match.length > 0)
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
							$meta: 'textScore'
						},
					}});
				// }}}

				// $sort - Sort by score (if searchSettings.sortByScore) {{{
				if (searchSettings.scoreField && searchSettings.sortByScore && fuzzy)
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
