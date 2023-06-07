var expect = require('chai').expect;
var mongoosy = require('..');

var settings = {
	uri: 'mongodb://localhost/mongoosy',
};

before('connect to test database', ()=> mongoosy.connect(settings.uri));

// Setup schemas {{{
before('setup schemas', ()=> {
	// Users {{{
	var Users = mongoosy
		.schema('users', {
			company: {type: 'pointer', ref: 'companies', index: true},
			name: String,
			status: {type: 'string', enum: ['active', 'unverified', 'deleted'], default: 'unverified', index: true},
			role: {type: String, enum: ['user', 'admin'], default: 'user', index: true},
			_password: String,
			mostPurchased: [{
				number: Number,
				widget: {type: 'pointer', ref: 'widgets', index: true},
			}],
			widgets: [{type: 'pointer', ref: 'widgets', index: true}],
			favourite: { // Intentionally has no defaulting children
				color: {type: 'string'},
				animal: {type: 'string'},
				widget: {type: 'pointer', ref: 'widgets', index: true},
			},
			settings: {
				lang: {type: String, enum: ['en', 'es', 'fr'], default: 'en'},
				greeting: {type: 'string', default: 'Hello'},
			},
		})
		.virtual('password',
			()=> 'RESTRICTED',
			(pass, doc) => { // Very crappy, yet predictable password hasher that removes all consonants
				doc._password = pass
					.toLowerCase()
					.replace(/[^aeiou]+/g, '');
			}
		)
		.virtual('passwordStrength', doc => doc._password ? doc._password.length : 0) // Returns the length of the (badly, see above) hashed password which is an approximate indicator of hash strength
		.method('greet', doc => `${doc.settings.greeting} ${doc.name}`)
	// }}}

	// Companies {{{
	var Companies = mongoosy.schema('companies', {
		name: String,
	})
	// }}}

	// Widgets {{{
	var Widgets = mongoosy.schema('widgets', {
		created: {type: Date, default: Date.now},
		name: String,
		content: String,
		status: {type: 'string', enum: ['active', 'deleted'], default: 'active', index: true},
		color: {type: 'string', enum: ['red', 'green', 'blue', 'yellow'], default: 'blue', index: true, customArray: [1, 2, 3]},
		featured: {type: 'boolean', default: false, customObject: {foo: 'Foo!', bar: 'Bar!'}},
		averageOrderSize: {type: Number, default: 1},
	})
	// }}}
});
// }}}

before('compile models', ()=> mongoosy.compileModels());

// Import scenario data {{{
before('setup scenario data', function() {
	this.timeout(60 * 1000); //~ 1m
	return mongoosy.scenario(require('./data/scenario'));
});
// }}}

// Setup movies {{{
before('create movies collection', function() {
	this.timeout(30 * 1000);

	return Promise.resolve()
		.then(()=> mongoosy.dropCollection('movies'))
		.then(()=> mongoosy.schema('movies', {
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
		}).compile())
		.then(()=> mongoosy.scenario(`${__dirname}/data/movies.json`))
});
// }}}

after('drop database', ()=> mongoosy.dropDatabase({$confirmDrop: true}));

after('disconnect', ()=> mongoosy.disconnect());
