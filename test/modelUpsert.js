var expect = require('chai').expect;
var mongoosy = require('..');

require('./setup');

describe('MODEL.upsert()', ()=> {

	it('should create a new user if none match existing fields', ()=> Promise.resolve()
		.then(()=> mongoosy.models.users.upsert({
			name: 'Joe Upsert',
			status: 'unverified',
		}, ['name']))
		.then(newMovie => {
			expect(newMovie).to.have.property('_id');
			expect(newMovie._id).to.be.a('string');
			expect(newMovie).to.have.property('name', 'Joe Upsert');
			expect(newMovie).to.have.property('status', 'unverified');
		})
	);

	it('should update an existing user if something matches the existing fields', ()=> Promise.resolve()
		.then(()=> mongoosy.models.users.upsert({
			name: 'Joe Upsert',
			status: 'active',
		}, ['name']))
		.then(existingMovie => {
			expect(existingMovie).to.have.property('_id');
			expect(existingMovie._id).to.be.a('string');
			expect(existingMovie).to.have.property('name', 'Joe Upsert');
			expect(existingMovie).to.have.property('status', 'active');
		})
	);

});
