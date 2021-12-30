var expect = require('chai').expect;
var mongoosy = require('..');

describe('Schema.use()', ()=> {

	it('should instanciate middleware layers', ()=> {
		var ranMiddleware = false;

		return mongoosy.schema('middlewares', {
			title: {type: 'string', required: true},
		})
		.use(function(options) {
			ranMiddleware = true;
			expect(options).to.deep.equal({foo: 1, bar: false, baz: true});
			expect(this).to.have.property('collectionName', 'middlewares');
			this.middlewareTestLoaded = true;
		}, {foo: 1, bar: false, baz: true})
		.compile()
		.then(()=> {
			expect(ranMiddleware).to.be.true;
			expect(mongoosy).to.have.nested.property('models.middlewares.middlewareTestLoaded', true);
		})
	});

});
