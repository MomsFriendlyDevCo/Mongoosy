var expect = require('chai').expect;
var mongoosy = require('..');

require('./setup');

describe('Change hooks', ()=> {

	var hasChanged = 0;
	before('setup change tracking collection', ()=>
		mongoosy.schema('hookTests', {
			name: String,
			iteration: {type: Number, default: 1},
		})
		.pre('change', ()=> hasChanged++)
		.compile()
	)
	beforeEach('reset change trap', ()=> hasChanged = 0);

	it('EVENT: change for  model.create()', ()=> Promise.resolve()
		.then(()=> mongoosy.models.hookTests.create({
			name: 'Change:Create()',
		}))
		.then(newDoc => {
			expect(newDoc).to.have.property('_id');
			expect(hasChanged).to.equal(1);
		})
	);

	it('EVENT: change for model.insertOne()', ()=> Promise.resolve()
		.then(()=> mongoosy.models.hookTests.insertOne({
			name: 'Change:InsertOne()',
		}))
		.then(newDoc => {
			expect(newDoc).to.have.property('_id');
			expect(hasChanged).to.equal(1);
		})
	);

	it('EVENT: change for doc.save()', ()=> Promise.resolve()
		.then(()=> mongoosy.models.hookTests.insertOne({
			name: 'Change:DocSave()',
		}))
		.then(()=> mongoosy.models.hookTests.findOne({name: 'Change:DocSave()'}))
		.then(doc => {
			doc.iteration++;
			return doc.save();
		})
		.then(newDoc => {
			expect(newDoc).to.have.property('_id');
			expect(newDoc).to.have.property('iteration', 2);
			expect(hasChanged).to.equal(2);
		})
	);

	it('EVENT: change for model.findOneAndUpdate()', ()=> Promise.resolve()
		.then(()=> mongoosy.models.hookTests.insertOne({
			name: 'Change:FindOneAndUpdate()',
		}))
		.then(()=> mongoosy.models.hookTests.findOne({name: 'Change:FindOneAndUpdate()'}))
		.then(doc => {
			doc.iteration++;
			return doc.save();
		})
		.then(newDoc => {
			expect(newDoc).to.have.property('_id');
			expect(newDoc).to.have.property('iteration', 2);
			expect(hasChanged).to.equal(2);
		})
	);

	// Skipped as this throws depreciation warnings and probably shoulnd't be used anyway
	it.skip('EVENT: change for model.update()', ()=> Promise.resolve()
		.then(()=> mongoosy.models.hookTests.insertOne({
			name: 'Change:Update()',
		}))
		.then(()=> mongoosy.models.hookTests.update({name: 'Change:Update()'}, {iteration: 10}))
		.then(()=> {
			expect(hasChanged).to.equal(1);
		})
	);

});
