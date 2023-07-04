var expect = require('chai').expect;
var mongoosy = require('..');
var searchMiddleware = require('../middleware/search');

require('./setup');

describe('Middleware: TextSearch', function() {
	this.timeout(5 * 1000);

	['$text', '$search'].forEach(searchMethod => {

	before('create search index', ()=> mongoosy.schemas.movies.use(searchMiddleware, {
		method: searchMethod,
		fields: [
			{path: 'title', weight: 100},
			{path: 'info.directors', weight: 50},
			{path: 'year', weight: 10},
			// FIXME: Example of handler() index
		],
	}));

	before('compile schema', ()=> mongoosy.schemas.movies.compile());

	before('wait for reindexing', ()=> mongoosy.models.movies.$indexBuilding);

	it('should generate the movies index', ()=> {
		if (searchMethod == '$search') {
			expect(mongoosy.models.movies.textSearchIndex({method: searchMethod})).to.deep.equal({
				createSearchIndexes: 'movies',
				indexes: [{
					name: 'searchIndex',
					definition: {
						mappings: {
							dynamic: false,
							fields: {
								title: {
									type: 'string',
								},
								info: {
									type: 'document',
									fields: {
										directors: {
											type: 'string',
										},
									},
								},
								year: {
									type: 'string',
								},
							},
						},
					},
				}],
			});
		} else {
			expect(mongoosy.models.movies.textSearchIndex({method: searchMethod})).to.deep.equal([
				{
					'info.directors': 'text',
					title: 'text',
					year: 'text',
				},
				{
					name: '_search',
					weights: {
						'info.directors': 50,
						title: 100,
						year: 10,
					},
				},
			]);
		}
	});

	it('simple string search', ()=>
		mongoosy.models.movies.textSearch('luhrmann')
			.then(res => {
				expect(res).to.be.an('array');
				expect(res).to.have.length(5);
				res.forEach(r => {
					expect(r).to.have.property('title');
					expect(r).to.have.property('year');
					expect(r._score).to.be.above(0);
				});
			})
	);

	it('simple search result counting', ()=>
		mongoosy.models.movies.textSearch('luhrmann', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(5);
			})
	);

	it('query + additional filters', ()=>
		mongoosy.models.movies.textSearch('luhrmann', {
			match: {year: 2013},
		})
			.then(res => {
				expect(res).to.be.an('array');
				expect(res).to.have.length(1);
			})
	)

	});

});
