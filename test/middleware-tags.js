var expect = require('chai').expect;
var moment = require('moment');
var mongoosy = require('..');
var tagsMiddleware = require('../middleware/tags');
const momentParseFormats = ['YYYY-MM-DD', 'D/M/YYYY', 'D/M/YYYY', 'D/M/YY', 'D/M']; // Array of formats to pass to moment(value, FORMATS) to parse dates

require('./setup');

describe('Middleware: Tags', function() {

	before('setup tags middleware', ()=> mongoosy.schemas.movies.use(tagsMiddleware, {
		tags: {
			// Query genre by CSV
			// is:(csv-of-genres)
			is(v) { return {$match: {
				genres: {$in: v.split(/\s*,\s*/)},
			}}},

			// Query the release year by date
			// after:(dateish)
			after(v) { return {$match: {
				year: {$gte: moment(v, momentParseFormats).utc().startOf('day').toDate()},
			}}},

			// Query the release year by date
			// before:(dateish)
			before(v) { return {$match: {
				year: {$lte: moment(v, momentParseFormats).utc().endOf('day').toDate()},
			}}},

			// Use whole numbers to query the rating. e.g. '2' -> '>=2 && <=3'
			// stars:(number)
			// stars:(from-to)
			stars(v) {
				let parsedRating = /^(?<from>\d+)-(?<to>\d+)$/.exec(v)?.groups || {from: parseInt(v), to: parseInt(v)};

				let [ratingFrom, ratingTo] = [parseInt(parsedRating.from || 0), parseInt(parsedRating.to || 5)];
				if (!ratingFrom || !ratingTo) throw new Error(`Cannot parse stars:from-to search tag: "${v}"`);

				return {$match: {
					rating: {
						$gte: ratingFrom,
						$lte: ratingTo,
					},
				}};
			},
		},
	}));

	before('compile schema', ()=> mongoosy.schemas.movies.compile());

	it.only('should parse tags', ()=>
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
					{$match: {year: {$gte: new Date('1999-12-31T00:00:00.000Z')}}},
					{$match: {year: {$lte: new Date('2015-12-30T23:59:59.999Z')}}},
					{$match: {rating: {$gte: 3, $lte: 5}}},
				]);
			})
	);

	it('simple regular search with no value (return everything)', ()=>
		mongoosy.models.movies.search(null, {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: genre:Comedy', ()=>
		mongoosy.models.movies.search('genre:Comedy', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: genre:Comedy,Drama', ()=>
		mongoosy.models.movies.search('genre:Comedy,Drama', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: genre:"Comedy, Drama"', ()=>
		mongoosy.models.movies.search('genre:"Comedy, Drama"', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: "genre:Comedy, Drama"', ()=>
		mongoosy.models.movies.search('"genre:Comedy, Drama"', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: Miller "genre:Comedy, Crime"', ()=>
		mongoosy.models.movies.search('Miller "genre:Comedy, Crime"', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: "genre:Comedy, Crime" Miller', ()=>
		mongoosy.models.movies.search('"genre:Comedy, Crime" Miller', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: "stars:1"', ()=>
		mongoosy.models.movies.search('stars:1', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: "stars:1-2"', ()=>
		mongoosy.models.movies.search('stars:1-2', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

	it('regular search against: after:2000-01-01 before:2015-12-31 stars:5', ()=>
		mongoosy.models.movies.search('after:2000-01-01 before:2015-12-31 stars:5', {count: true})
			.then(res => {
				expect(res).to.be.a('number');
				expect(res).to.equal(666);
			})
	);

});
