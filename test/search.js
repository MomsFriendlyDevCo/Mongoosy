var expect = require('chai').expect;
var fs = require('fs');
var mongoosy = require('..');
var searchMiddleware = require('../middleware/search');

require('./setup');

describe('mongoosy.Search', function() {
	this.timeout(5 * 1000);

	before('drop existing moviesSearchable collection', ()=> mongoosy.dropCollection('moviesSearchable'));

	before('create a moviesSearchable schema', ()=> mongoosy.schema('moviesSearchable', {
		title: {type: 'string', required: true},
		year: {type: 'number', required: true},
		info: {
			directors: ['string'],
			release_date: 'date',
			genres: ['string'],
			image_url: 'string',
			plot: 'string',
			rank: 'number',
			running_time_secs: 'number',
			actors: ['string'],
		},
	}));

	before('create search index', ()=> mongoosy.schemas.moviesSearchable.use(searchMiddleware, {
		fields: [
			{path: 'title', weight: 100},
			{path: 'info.directors', weight: 50},
			{path: 'year', weight: 10},
		],
	}));

	before('compile schema', ()=> mongoosy.schemas.moviesSearchable.compile());

	before('load movie data', function() {
		this.timeout(30 * 1000);
		let movies = JSON.parse(fs.readFileSync(`${__dirname}/data/movies.json`));

		// Rename movies key
		movies.moviesSearchable = movies.movies;
		delete movies.movies;

		return mongoosy.scenario(movies);
	});

	before('check data has loaded', ()=> mongoosy.models.moviesSearchable.countDocuments()
		.then(res => {
			expect(res).to.be.a('number');
			expect(res).to.be.above(100);
		})
	);

	it('simple director string search', ()=>
		mongoosy.models.moviesSearchable.search('luhrmann')
			.then(res => {
				expect(res).to.be.an('array');
				expect(res).to.have.length(5);
				res.forEach(r => {
					expect(r).to.have.property('title');
					expect(r).to.have.property('year');
					expect(r.toObject()._score).to.be.above(0);
				});
			})
	);

	it('simple search result counting', ()=>
		mongoosy.models.moviesSearchable.search('luhrmann', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(5);
			})
	);

	it('compound query', ()=>
		mongoosy.models.moviesSearchable.search('luhrmann')
			.find({year: 2013})
			.then(res => {
				expect(res).to.be.an('array');
				expect(res).to.have.length(1);
			})
	)

});
