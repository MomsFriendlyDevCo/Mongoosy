var expect = require('chai').expect;
var mongoosy = require('..');

var settings = {
	uri: 'mongodb://localhost/mongoosy',
};

before(()=> mongoosy.connect(settings.uri), 'connect to test database');

after(()=> mongoosy.disconnect(), 'disconnect');

// Setup schemas {{{
before(()=> {
	// Users {{{
	var Users = mongoosy
		.schema('users', {
			name: String,
			role: {type: String, enum: ['user', 'admin'], default: 'user', index: true, customBool: true},
			_password: String,
			favourite: {type: 'pointer', ref: 'widgets'},
			items: [{type: 'pointer', ref: 'widgets'}],
			mostPurchased: [
				{
					number: {type: Number, default: 0},
					item: {type: 'pointer', ref: 'widgets'},
				}
			],
			settings: {
				lang: {type: String, enum: ['en', 'es', 'fr', 'elmerFudd'], default: 'en', customNumber: 123},
				greeting: String,
				featured: {type: 'pointer', ref: 'widgets'},
			},
		})
		.method('splitNames', function() {
			return this.name.split(/\s+/);
		})
		.method('randomWait', function(next) {
			// Test function to wait a random amount of MS then return the name
			var doc = this;
			setTimeout(function() {
				next(null, doc.name);
			}, _.random(0, 100));
		})
		.static('countByType', function(type, next) {
			Users.count({
				$collection: 'users',
				role: type,
			}, next);
		})
		.virtual('password', function() { return 'RESTRICTED' }, function(pass) {
			// Very crappy, yet predictable password hasher that removes all consonants
			this._password = pass
				.toLowerCase()
				.replace(/[^aeiou]+/g, '');
		})
		.virtual('passwordStrength', function() {
			// Returns the length of the (badly, see above) hashed password which is an approximate indicator of hash strength
			return (this._password.length || 0);
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
	});
	// }}}

	// Groups {{{
	var Groups = mongoosy.schema('groups', {
		name: String,
		users: [{type: 'pointer', ref: 'users'}],
		preferences: {
			defaults: {
				items: [{type: 'pointer', ref: 'widgets'}]
			}
		},
	});
	// }}}

	// Friends (big data set) {{{
	var Friends = mongoosy.schema('friends', {
		name: String,
		email: String,
		username: String,
		job: String,
		dob: String,
		uuid: String,
		address: {
			street: String,
			city: String,
			state: String,
			country: String,
		},
		avatar: String,
	});
	// }}}
}, 'setup schemas');
// }}}


// Setup scenarios {{{
before(()=> {
	var scenario = {
		// Users {{{
		users: [
			{
				_ref: 'users.joe',
				name: 'Joe Random',
				role: 'user',
				favourite: 'widget-crash',
				items: ['widget-bang'],
				_password: 'ue', // INPUT: flume
				mostPurchased: [
					{
						number: 5,
						item: 'widget-crash',
					},
					{
						number: 10,
						item: 'widget-bang',
					},
					{
						number: 15,
						item: 'widget-whollop',
					},
				],
			},
			{
				_ref: 'users.jane',
				name: 'Jane Quark',
				role: 'user',
				favourite: 'widget-bang',
				items: ['widget-crash', 'widget-whollop'],
				_password: 'oeaeoeae', // INPUT: correct battery horse staple
				mostPurchased: [
					{
						number: 1,
						item: 'widget-bang',
					},
					{
						number: 2,
						item: 'widget-whollop',
					},
				],
			},
		],
		// }}}
		// Widgets {{{
		widgets: [
			{
				_ref: 'widget-crash',
				created: '2016-06-23T10:23:42Z',
				name: 'Widget crash',
				content: 'This is the crash widget',
				featured: true,
				// color: 'blue', // Should default to this via schema
			},
			{
				_ref: 'widget-bang',
				created: '2016-01-27T19:17:04Z',
				name: 'Widget bang',
				content: 'This is the bang widget',
				color: 'red',
			},
			{
				_ref: 'widget-whollop',
				created: '2016-03-19T17:43:21',
				name: 'Widget whollop',
				content: 'This is the whollop widget',
				color: 'blue',
			}
		],
		// }}}
		// Groups {{{
		groups: [
			{
				name: 'Group Foo',
				users: ['users.joe'],
				preferences: {
					defaults: {
						items: ['widget-whollop', 'widget-bang'],
					},
				},
			},
			{
				name: 'Group Bar',
				users: ['users.jane'],
				preferences: {
					defaults: {
						items: ['widget-crash', 'widget-bang'],
					},
				},
			},
			{
				name: 'Group Baz',
				users: ['users.joe', 'users.jane'],
				preferences: {
					defaults: {
						items: ['widget-bang'],
					},
				},
			},
		],
		// }}}
	};

}, 'setup scenarios');
// }}}
