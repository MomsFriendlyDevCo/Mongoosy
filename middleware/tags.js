const stringSplit = require('string-split-by');

/**
* Add the tag processing middleware to the given model
*
* @param {Object} [options] Additional options to mutate behaviour
* @param {RegExp} [options.stringSplitBy=/\s+/] How to split the incomming terms string
* @param {Array<String>} [options.stringSplitIgnore] What string characters to preserve when splitting - defaults to preserving compound terms with speachmarks + brackets
* @param {Function} [options.unwrap] Overriding function on how to unwrap speachmarks around a string
*/
module.exports = function MongoosyTags(model, options) {
	var settings = {
		tags: null,
		stringSplitBy: /\s+/,
		stringSplitIgnore: ['"', "'", '()'],
		unwrap: w => /^["'\(].+["'\)]$/.test(w) // Remove wrapping for combined terms
			? w.slice(1, -1)
			: w,
		...options,
	};
	// Sanity checks {{{
	if (settings.tags?.length <= 0) throw new Error('Must specify at least one tag');
	// }}}

	// MODEL.parseTags(terms, opts) {{{
	/**
	* Parse the incomming field / value into an objecct / aggregation query block
	* e.g. {'req.query.q': 'is:active after:2000 before:2025 "some fuzzy search"'}
	*
	* @param {String} terms Input fuzzy search string
	*
	* @returns {Promise<Object>} An eventual output object composed of the extracted tags, aggregation block + remaining fuzzy search terms
	* @param {Object} tags Extracted tags by key
	* @param {Array} aggregation Computed aggregation block
	* @property {String} fuzzy The input fuzzy search string stripped of all regonised tags
	*/
	model.parseTags = function MongoosyParseTags(terms) {
		var parsed = {
			fuzzy: [],
			tags: {},
			aggregation: [],
		};

		return Promise.resolve()
			.then(()=> stringSplit(terms, settings.stringSplitBy, {
				ignore: settings.stringSplitIgnore,
				escape: true,
			}))
			.then(terms => Promise.all(terms
				.map(term => {
					var cleanedTerm = settings.unwrap(term);

					var parsedTerm = /^(?<key>\w+?):(?<value>.*)$/.exec(cleanedTerm)?.groups;

					if (!parsedTerm) { // Not a key:val term
						parsed.fuzzy.push(term);
					} else { // Looks like a valid tag
						// Clean up value tag + validate
						parsedTerm.key = parsedTerm.key.toLowerCase();
						if (!settings.tags[parsedTerm.key]) return parsed.fuzzy.push(term); // Invalid tag
						parsedTerm.value = settings.unwrap(parsedTerm.value);

						// Allocate tag to parsed output
						parsed.tags[parsedTerm.key] = parsedTerm.value;

						// Wait for tag aggregations to validate
						return Promise.resolve(settings.tags[parsedTerm.key].call(parsed, parsedTerm.value))
							.then(result => {
								if (typeof result != 'object' && result !== false) {
									throw new Error(`Expected aggregation step (or boolean FALSE) from tag "${parsedTerm.key}" but got something else`);
								} else if (result === false) { // Tag handler rejected handling this
									parsed.fuzzy.push(term);
								} else { // Any other value, store as tag result
									return parsed.aggregation.push(result);
								}
							});
					}
				})
			))
			.then(()=> ({
				...parsed,
				fuzzy: parsed.fuzzy.join(' '), // Transform remaining fuzzy terms back into a string
			}))
	};
	// }}}
}
