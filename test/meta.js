var expect = require('chai').expect;
var mongoosy = require('..');

require('./setup');

describe('MODEL.meta()', ()=> {

	it('should calculate a models meta structure', ()=> {
		expect(mongoosy.models.users.meta({prototype: true})).to.deep.equal({
			'_id': {type: 'objectid', index: true},
			'company': {type: 'objectid', ref: 'companies', index: true},
			'name': {type: 'string'},
			'status': {type: 'string', enum: [{id: 'active', title: 'Active'}, {id: 'unverified', title: 'Unverified'}, {id: 'deleted', title: 'Deleted'}], default: 'unverified', index: true},
			'role': {type: 'string', enum: [{id: 'user', title: 'User'}, {id: 'admin', title: 'Admin'}], default: 'user', index: true},
			// _password should be omitted by default
			'mostPurchased': {type: 'array', default: '[DYNAMIC]'},
			'mostPurchased.number': {type: 'number'},
			'mostPurchased.widget': {type: 'objectid', ref: 'widgets', index: true},
			'widgets': {type: 'array', default: '[DYNAMIC]'},
			'favourite.color': {type: 'string'},
			'favourite.animal': {type: 'string'},
			'favourite.widget': {type: 'objectid', ref: 'widgets', index: true},
			'settings.lang': {type: 'string', enum: [{id: 'en', title: 'En'}, {id: 'es', title: 'Es'}, {id: 'fr', title: 'Fr'}], default: 'en'},
			'settings.greeting': {type: 'string', default: 'Hello'},
			$prototype: {
				company: undefined,
				name: '',
				status: 'unverified',
				role: 'user',
				mostPurchased: [],
				widgets: [],
				favourite: {
					color: '',
					animal: '',
					widget: undefined,
				},
				settings: {
					lang: 'en',
					greeting: 'Hello',
				},
			},
		});
	});

});
