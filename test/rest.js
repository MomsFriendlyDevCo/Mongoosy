var axios = require('axios');
var bodyParser = require('body-parser');
var mongoosy = require('..');
var expect = require('chai').expect;
var express = require('express');
var expressLogger = require('express-log-url');

require('./setup');

var port = 8181;
var url = 'http://localhost:' + port;

describe('mongoosy.Rest', function() {
	this.timeout(5 * 1000);

	var server;
	before('setup a server', function(finish) {
		var app = express();
		app.use(expressLogger);
		app.use(bodyParser.json());
		app.set('log.indent', '      ');
		app.use('/api/movies/:id?', mongoosy.models.movies.serve({
			create: true,
			get: true,
			query: true,
			count: true,
			save: true,
			delete: true,
			meta: true,
			errorHandler(res, code, text) {
				console.warn('Error code', code, 'thrown by server:', text);
				res.status(code).send(text);
			},
		}));
		app.use('/api/users/:id?', mongoosy.models.users.serve({
			get: true,
			query: true,
			docFinder({id, model}) { // Example where the ID could be the _id field OR the email address of the user
				if (/@/.test(id)) { // Looks like an email address
					return model.findOne({email: id});
				} else {
					return model.findById(id);
				}
			},
			errorHandler(res, code, text) {
				console.warn('Error code', code, 'thrown by server:', text);
				res.status(code).send(text);
			},
		}));
		server = app.listen(port, null, finish);
	});
	after(()=> server && server.close());

	// Basic data retrieval {{{
	it('should get the first three movies', ()=>
		axios.get(`${url}/api/movies?limit=3`)
			.then(res => {
				expect(res.data).to.be.an('array');
				expect(res.data).to.have.length(3);
				res.data.forEach(doc => {
					expect(doc).to.have.property('_id');
					expect(doc).to.have.property('title');
				});
			})
	);
	// }}}

	// Create (POST) {{{
	var newMovie;
	it('should create a new movie', ()=>
		axios.post(`${url}/api/movies`, {
			title: 'mongoosy: Electric Boogaloo',
			year: 2119,
			info: {
				directors: ['Alan Smithee'],
				rank: 17,
			},
		})
			.then(res => {
				newMovie = res.data;
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('_id');
				expect(res.data).to.have.property('title', 'mongoosy: Electric Boogaloo');
				expect(res.data).to.have.property('year', 2119);
				expect(res.data).to.have.property('info');
				expect(res.data.info).to.deep.equal({
					directors: ['Alan Smithee'],
					rank: 17,
					actors: [],
					genres: [],
				});
			})
			.then(()=> new Promise(resolve => setTimeout(()=> resolve(), 3000)))
	);
	// }}}

	// Fetch document (GET + id) {{{
	it('should get the movie by its ID', ()=>
		axios.get(`${url}/api/movies/${newMovie._id}`)
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('_id');
				expect(res.data).to.have.property('title', 'mongoosy: Electric Boogaloo');
			})
	);

	it('should fetch users by email addresses (via docFinder / multi-ids)', ()=>
		axios.get(`${url}/api/users/vallery@company.com`)
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('_id');
				expect(res.data).to.have.property('name', 'Vallery Unverrifed');
			})
	);
	// }}}

	// Update (POST + id) {{{
	it('should update the movie by its ID', ()=>
		axios.post(`${url}/api/movies/${newMovie._id}`, {info: {genres: ['Action', 'Adventure', 'Debugging']}})
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('_id');
				expect(res.data).to.have.property('title', 'mongoosy: Electric Boogaloo');
				expect(res.data).to.have.nested.property('info.genres');
				expect(res.data.info.genres).to.be.deep.equal(['Action', 'Adventure', 'Debugging']);
			})
	);
	// }}}

	// Delete (DELETE) {{{
	it('should delete a document by its ID', ()=>
		axios.delete(`${url}/api/movies/${newMovie._id}`)
			.then(res => {
				expect(res.status).to.equal(200);
			})
	);
	// }}}

	// Count (GET) {{{
	it('count all movies', ()=>
		axios.get(`${url}/api/movies/count`)
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('count');
				expect(res.data.count).to.be.a('number');
				expect(res.data.count).to.equal(4609);
			})
	)

	it('count all biography movies', ()=>
		axios.get(`${url}/api/movies/count?info.genres=Biography`)
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('count');
				expect(res.data.count).to.be.a('number');
				expect(res.data.count).to.equal(220);
			})
	)

	it('count the movies made in 2010', ()=>
		axios.get(`${url}/api/movies/count?year=2010`)
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('count');
				expect(res.data.count).to.be.a('number');
				expect(res.data.count).to.equal(244);
			})
	)
	// }}}

	// Query (GET) {{{
	it('find the 3 best movies made in 2008', ()=>
		axios.get(`${url}/api/movies?year=2018&limit=3&sort=rank&select=title`)
			.then(res => {
				expect(res.data).to.be.an('array');
				res.data.forEach(movie => {
					expect(Object.keys(movie).sort()).to.deep.equal(['_id', 'title']);
				});
			})
	);

	it('should hide _password fields by default', ()=>
		axios.get(`${url}/api/users`)
			.then(res => {
				expect(res.data).to.be.an('array');
				res.data.forEach(user => {
					expect(user).to.be.an('object');
					expect(user).to.have.property('_id');
					expect(user).to.have.property('__v');
					expect(user).to.not.have.property('_password');
				});
			})
	);

	it('should throw when asked for hidden fields', function() {
		axios.get(`${url}/api/users?select=_id,_password`)
			.then(()=> this.fail)
			.catch(res => expect(res.response).to.have.property('status', 400))
	});
	// }}}

	// Meta (GET) {{{
	it('get the structure of the data', ()=>
		axios.get(`${url}/api/movies/meta`)
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.deep.equal({
					'_id': {type: 'objectid', index: true},
					'title': {type: 'string', required: true},
					'year': {type: 'number', required: true},
					'info.directors': {type: 'array', default: '[DYNAMIC]'},
					'info.release_date': {type: 'date'},
					'info.genres': {type: 'array', default: '[DYNAMIC]'},
					'info.image_url': {type: 'string'},
					'info.plot': {type: 'string'},
					'info.rank': {type: 'number'},
					'info.running_time_secs': {type: 'number'},
					'info.actors': {type: 'array', default: '[DYNAMIC]'},
					'info.rating': {type: 'number'},
				});
			})
	);
	// }}}

});
