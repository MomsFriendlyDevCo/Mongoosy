var _ = require('lodash');
var mongoosy = require('../src/mongoosy');
const stringSplit = require('string-split-by');

module.exports = function MongoosySearch(model, options) {
	var settings = {
		path: '_search',
		fields: [
			// Use static path
			// {path: 'lastName', weight: 10},

			// Use (sync/async) handler function, can be a promise return
			// {name: 'ref', weight: 20, handler() {...}}
		],
		mutateTokens: v => _.chain(v)
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
		searchTermsModify: v => _.chain(v)
			.toString()
			.thru(v => v.toUpperCase())
			.deburr()
			.value(),
		select: undefined,
		acceptTags: true,
		mergeTags: {},
		tagsRe: /^(?<tag>.+?):(?<val>.+)$/,
		...options,
	};
	// Sanity checks {{{
	if (!settings.fields?.length) throw new Error('Must specify at least one field to index');
	// }}}

	// }}}

	// Create text index against the model {{{
	// FIXME: Need to edit schema with 'text' type?
	// model.schema.add({[settings.path]: 'text'});

	model.schema.index(
		// Specify all fields as 'text' type
		Object.fromEntries(
			settings.fields
				.filter(f => {
					if (f.path) return true;
					console.warn('Ignoring unsupported search field type', f);
				})
				.map(f => [f.path, 'text'])
		),
		{
			name: settings.path,
			weights: Object.fromEntries(
				settings.fields
					.filter(f => {
						if (f.path) return true;
						console.warn('Ignoring unsupported search field type', f);
					})
					.map(f => [f.path, f.weight])
			),
		},
	);

	// Sync indexes from schema to models
	// Model.$indexBuilding is a waitable promise
	model.$indexBuilding = model.createIndexes()
		.then(()=> console.log('Promise post-index'))
	// }}}

	// Add MODEL.search(text, opts) function {{{
	/**
	* Fuzzy search using the declared search fields
	* @param {String} terms Search terms to filter
	* @param {Object} [options] Additional options
	* @param {String} [options.scoreField="_score"] Append the search score as this field, set to falsy to disable
	* @param {Boolean} [options.sortByScore=true] Sort results by the score, descending
	* @param {Boolean} [options.count=false] Return only the count of matching documents, optimizing various parts of the search functionality
	* @param {Boolean} [options.acceptTags=true] Whether to process specified tags. If falsy tag contents are ignored and removed from the term
	* @param {Object} [options.mergeTags={}] Tags to merge into the terms tags, if `acceptTags=false` this is used instead of any user provided tags
	* @param {RegExp} [options.tagsRe] RegExp used to split tags
	* @returns {array<Object>} An array of matching documents with the meta `scoreField`
	*/
	model.search = function mongooseSearch(terms, options) {
		var searchStart = Date.now();
		var searchSettings = {
			filter: undefined,
			populate: undefined,
			limit: 50,
			skip: 0,
			select: undefined,
			count: false,
			wholeTerm: false,
			scoreField: '_score',
			sortByScore: true,
			log: console.log.bind(this, 'Search'),
			..._.cloneDeep(settings),
			...options,
		};
		// Ensure parameters are integers
		['skip', 'limit'].forEach(k => searchSettings[k] = parseInt(searchSettings[k]));

		var termsRE = _.chain(terms)
			.thru(terms => stringSplit(terms, /\s+/, {
				ignore: ['"', "'", '()'], // Preserve compound terms with speachmarks + brackets
				escape: true, // Allow escaping of terms
			}))
			.map(term => /^["'\(].+["'\)]$/.test(term) ? term.slice(1, -1) : term) // Remove wrapping for combined terms
			.filter(term => { // Remove tags
				var tagBits = searchSettings.tagsRe.exec(term);
				if (tagBits) searchSettings.log('tag', tagBits.groups.tag.toLowerCase(), _.has(searchSettings.tags, tagBits.groups.tag.toLowerCase()));
				if (tagBits && searchSettings.acceptTags && searchSettings.tags[tagBits.groups.tag.toLowerCase()]) { // Found a valid tag and we are accepting tags
					searchSettings.mergeTags[tagBits.groups.tag.toLowerCase()] = tagBits.groups.val;
					return false; // Remove from output list of terms
				} else if (tagBits && !searchSettings.acceptTags) { // Found a tag but we're ignoring them anyway
					// Do nothing
					return false;
				} else if (tagBits && searchSettings.acceptTags && !searchSettings.tags[tagBits.groups.tag.toLowerCase()]) { // Found a tag but its invalid
					searchSettings.log(`Invalid tag passed in search query ${tagBits.groups.tag}:${tagBits.groups.val} - tag ignored`);
					return false; // Remove from output list of terms
				} else {
					return true;
				}
			})
			.filter(Boolean) // Remove empty terms
			.thru(terms => settings.wholeTerm && terms.length > 0 // Wrap terms in speachmarks if we only accept wholeTerm (and they are not already)
				? [_.trim(terms.join(' '))]
				: terms
			)
			.map(term => searchSettings.searchTermsModify(term)) // Mangle terms to remove burring etc.
			.map(term => new RegExp(term.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'), 'i')) // Encode each term as a RegExp
			.value();

		searchSettings.log(
			`Performing ${!searchSettings.count ? 'search' : 'search-count'} on`,
			'collection=', model.collectionName,
			'raw query=', `"${terms}"`,
			'RE query=', termsRE.map(t => t.toString()).join(', '),
			'tags=', _(searchSettings.mergeTags)
				.map((v, k) => `${k}:${v}`)
				.thru(v => v.length > 0 ? v.join(', ') : '[none]')
				.value(),
		);

		if (searchSettings.count) {
			return model.countDocuments({
				$text: {
					$search: terms,
					$caseSensitive: false,
					$diacriticSensitive: false,
				},
			});
		} else {
			let query = model.find({
				$text: {
					$search: terms,
					$caseSensitive: false,
					$diacriticSensitive: false,
				},
			},
			{
				...(searchSettings.scoreField && {
					[searchSettings.scoreField]: {
						$meta: 'textScore'
					},
				}),
			})

			if (settings.sortByScore)
				query.sort({[searchSettings.scoreField]: -1});

			return query;
		}
	};
	// }}}
}
