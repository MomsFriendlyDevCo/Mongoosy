var expect = require('chai').expect;
var moment = require('moment');
var mongoosy = require('..');
var searchMiddleware = require('../middleware/search');
var tagsMiddleware = require('../middleware/tags');
const momentParseFormats = ['YYYY-MM-DD', 'D/M/YYYY', 'D/M/YYYY', 'D/M/YY', 'D/M']; // Array of formats to pass to moment(value, FORMATS) to parse dates

require('./setup');

describe('Middleware: Tags', function() {

	before('create search index', ()=> mongoosy.schemas.movies.use(searchMiddleware, {
		fields: [
			{path: 'title', weight: 100},
			{path: 'info.directors', weight: 50},
			{path: 'year', weight: 10},
		],
	}));

	before('setup tags middleware', ()=> mongoosy.schemas.movies.use(tagsMiddleware, {
		tags: {
			// Query genre by CSV
			// is:(csv-of-genres)
			is(v) { return {$match: {
				'info.genres': {$in: v.split(/\s*,\s*/)},
			}}},

			// Query the release year by date
			// after:(dateish)
			after(v) { return {$match: {
				year: {$gte: +moment(v, momentParseFormats).utc().startOf('day').format('YYYY')},
			}}},

			// Query the release year by date
			// before:(dateish)
			before(v) { return {$match: {
				year: {$lte: +moment(v, momentParseFormats).utc().endOf('day').format('YYYY')},
			}}},

			// Use whole numbers to query the rating. e.g. '2' -> '>=2 && <=3'
			// stars:(number)
			// stars:(from-to)
			stars(v) {
				let parsedRating = /^(?<from>\d+)-(?<to>\d+)$/.exec(v)?.groups || {from: parseInt(v), to: parseInt(v)};

				let [ratingFrom, ratingTo] = [parseInt(parsedRating.from || 0), parseInt(parsedRating.to || 5)];
				if (!ratingFrom || !ratingTo) throw new Error(`Cannot parse stars:from-to search tag: "${v}"`);

				return {$match: {
					'info.rating': {
						$gte: ratingFrom,
						$lt: ratingTo + 1,
					},
				}};
			},
		},
	}));

	before('compile schema', ()=> mongoosy.schemas.movies.compile());

	before('wait for reindexing', ()=> mongoosy.models.movies.$indexBuilding);

	it('should parse tags', ()=>
		mongoosy.models.movies.parseTags('foo after:2000-01-01 bar before:"2015-12-31" stars:3-5 baz')
			.then(res => {
				expect(res).to.be.an('object');

				expect(res).to.have.property('tags');
				expect(res.tags).to.be.deep.equal({
					after: '2000-01-01',
					before: '2015-12-31',
					stars: '3-5',
				});

				expect(res).to.have.property('fuzzy');
				expect(res.fuzzy).to.be.equal('foo bar baz');

				expect(res).to.have.property('aggregation');
				expect(res.aggregation).to.be.deep.equal([
					{$match: {year: {$gte: 1999}}},
					{$match: {year: {$lte: 2015}}},
					{$match: {'info.rating': {$gte: 3, $lt: 6}}},
				]);
			})
	);

	[
		// '$text',
		'$search',
	].forEach(searchMethod => {

	it(`${searchMethod}: [no value / return everything]`, ()=>
		mongoosy.models.movies.search('', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(4609);
			})
	);

	it(`${searchMethod}: is:Comedy`, ()=>
		mongoosy.models.movies.search('is:Comedy', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(1615);
			})
	);

	it(`${searchMethod}: is:Comedy,Drama`, ()=>
		mongoosy.models.movies.search('is:Comedy,Drama', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(3350);
			})
	);

	it(`${searchMethod}: is:"Comedy, Drama"`, ()=>
		mongoosy.models.movies.search('is:"Comedy, Drama"', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(3350);
			})
	);

	it(`${searchMethod}: "is:Comedy, Drama"`, ()=>
		mongoosy.models.movies.search('"is:Comedy, Drama"', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(3350);
			})
	);

	it(`${searchMethod}: Miller "is:Comedy, Drama"`, ()=>
		mongoosy.models.movies.search('Miller "is:Comedy, Drama"', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.above(23); // 23 with $text, 26 with $search+fuzzy
			})
	);

	it(`${searchMethod}: "is:Comedy, Drama" Miller`, ()=>
		mongoosy.models.movies.search('"is:Comedy, Drama" Miller', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.above(23);
			})
	);

	it(`${searchMethod}: "stars:5"`, ()=>
		mongoosy.models.movies.search('stars:5', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(935);
			})
	);

	it(`${searchMethod}: "stars:1-2"`, ()=>
		mongoosy.models.movies.search('stars:1-2', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(29);
			})
	);

	it(`${searchMethod}: after:2000-01-01 before:2015-12-31 stars:5`, ()=>
		mongoosy.models.movies.search('after:2000-01-01 before:2015-12-31 stars:5', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(733);
			})
	);

	it(`${searchMethod}: unsupported:tag`, ()=>
		mongoosy.models.movies.search('unsupported:tag Miller', {method: searchMethod, count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.above(33); // 33 with $text, 38 with $search
			})
	);

	});

});
