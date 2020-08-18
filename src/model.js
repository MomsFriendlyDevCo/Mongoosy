var Debug = require('debug');
var debug = Debug('mongoosy');

/**
* Decorate the existing MongooseModel with more methods
*/
module.exports = function(mongoosy) {
	mongoosy.on('model', model => {
		// Create insert / insertOne aliases
		model.insert = model.insertOne = model.create;


		/*
		// Plugin should be available even after compiling the model
		model.plugin = (func, options) => {
			func(model, options);
			return model;
		};


		// Glue a virtual method which really redirects to the schema
		model.virtual = (...args) => {
			model.virtual(...args);
			return model;
		};
		*/


		// Debugging enabled? Strap a debugging prefix onto all doc access methods
		if (debug.enabled || process.env.DEBUG) {
			['count', 'create', 'deleteMany', 'deleteOne', 'insert', 'insertOne', 'insertMany', 'updateMany', 'updateOne']
				.forEach(method => {
					var originalMethod = model[method];
					model[method] = function(...args) {
						debug(method, ...args);
						Debug(`mongoosy:${method}`)(...args);
						return originalMethod.call(this, ...args);
					};
				});
		}
	});
};
