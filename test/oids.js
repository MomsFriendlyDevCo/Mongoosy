var expect = require('chai').expect;
var mongoosy = require('..');

require('./setup');

describe('ObjectIDs', ()=> {

	it('should create a simple user with a string OID', ()=> Promise.resolve()
		.then(()=> mongoosy.models.users.insertOne({
			name: 'Test User',
		}))
		.then(newUser => {
			expect(newUser).to.have.property('_id');
			expect(newUser).to.have.property('name', 'Test User');

			expect(newUser._id).to.be.a('string');
		})
	);

});
