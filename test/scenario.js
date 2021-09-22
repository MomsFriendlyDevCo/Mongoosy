var expect = require('chai').expect;
var mongoosy = require('..');

require('./setup');

describe('mongoosy.Scenario', function() {
	this.timeout(30 * 1000);

	// Also see ./rest.js for other scenario tests

	it('should handle circular scenarios', ()=> {
		this.timeout(30 * 1000);

		return Promise.resolve()
			.then(()=> mongoosy.schema('cats', {
				name: String,
				bestFriend: {type: 'oid'},
			}))
			.then(()=> mongoosy.compileModels())
			.then(()=> mongoosy.scenario({cats: [
				{
					$: '$cats.adam',
					name: 'Adam',
					bestFriend: '$cats.charlie',
				},
				{
					$: '$cats.bessie',
					name: 'Bessie',
					bestFriend: '$cats.adam',
				},
				{
					$: '$cats.charlie',
					name: 'Charlie',
					bestFriend: '$cats.bessie',
				},
			]}, {
				nuke: true,
				circular: true,
			}))
			.then(()=> mongoosy.models.cats.find()
				.sort('name')
				.lean()
			)
			.then(cats => {
				expect(cats).to.be.an('array');
				expect(cats).to.have.length(3);

				expect(cats[0]).to.have.property('name', 'Adam');
				expect(cats[0]).to.have.property('bestFriend');
				expect(cats[0].bestFriend.toString()).to.deep.equal(cats[2]._id.toString());

				expect(cats[1]).to.have.property('name', 'Bessie');
				expect(cats[1]).to.have.property('bestFriend');
				expect(cats[1].bestFriend.toString()).to.deep.equal(cats[0]._id.toString());

				expect(cats[2]).to.have.property('name', 'Charlie');
				expect(cats[2]).to.have.property('bestFriend');
				expect(cats[2].bestFriend.toString()).to.deep.equal(cats[1]._id.toString());
			})
	});

});
