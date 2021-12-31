var expect = require('chai').expect;
var mongoosy = require('..');

describe('Schema.use()', ()=> {

	it('should instanciate middleware layers', ()=> {
		var middlewareRuns = 0;

		return mongoosy.schema('middlewares', {
			title: {type: 'string', required: true},
		})
		.use(function(model, options) {
			middlewareRuns++;
			expect(options).to.be.an('object');
			expect(options).to.deep.equal({foo: 1, bar: false, baz: true});
			expect(model).to.have.property('collectionName', 'middlewares');
			expect(this).to.have.property('collectionName', 'middlewares');
			this.middlewareTestLoaded = true;
		}, {foo: 1, bar: false, baz: true})
		.use((model, options) => {
			middlewareRuns++;
			expect(options).to.be.an('object');
			expect(options).to.be.deep.equal({});
		})
		.compile()
		.then(()=> {
			expect(middlewareRuns).to.be.equal(2);
			expect(mongoosy).to.have.nested.property('models.middlewares.middlewareTestLoaded', true);
		})
	});

});
