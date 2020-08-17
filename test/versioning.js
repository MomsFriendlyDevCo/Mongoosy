var expect = require('chai').expect;
var mongoosy = require('..');

require('./setup');

describe('Versioning', ()=> {

	it('should increment versions via document mutation', ()=> Promise.resolve()
		.then(()=> mongoosy.models.widgets.insertOne({name: 'VTEST1'}))
		.then(doc => {
			expect(doc).to.have.property('__v', 0)
			doc.content = 'one';
			return doc.save();
		})
		.then(doc => {
			expect(doc).to.have.property('__v', 1)
			doc.content = 'two';
			return doc.save();
		})
		.then(doc => expect(doc).to.have.property('__v', 2))
	);

	it('should increment versions via findOneAndUpdate()', ()=> Promise.resolve()
		.then(()=> mongoosy.models.widgets.insertOne({name: 'VTEST2'}))
		.then(doc => expect(doc).to.have.property('__v', 0))
		.then(()=> mongoosy.models.widgets.findOneAndUpdate({name: 'VTEST2'}, {content: 'one'}))
		.then(doc => expect(doc).to.have.property('__v', 1))
		.then(()=> mongoosy.models.widgets.findOneAndUpdate({name: 'VTEST2'}, {content: 'two'}))
		.then(doc => expect(doc).to.have.property('__v', 2))
	);

});
