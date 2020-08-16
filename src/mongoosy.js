var _ = require('lodash');
var debug = require('debug')('mongoosy');
var mongoose = require('mongoose');
var Schema = require('./Schema');

require('./SchemaType.ObjectId');
require('./SchemaType.Pointer');

class Mongoosy extends mongoose.Mongoose {

	constructor() {
		debug('Instanciate');
		super();
	};


	/**
	* Storage for all models loaded as schemas in this instance of Mongoosy
	*/
	models = {};


	connect(uri, options) {
		var settings = {
			uri: _.isString(uri) ? uri : options.uri,

			// "depreciated feature" surpression - assume sane Mongoose connection options in all cases
			useNewUrlParser: true,
			useUnifiedTopology: true,
			useCreateIndex: true,

			// Inherit rest of options
			...options,
		};

		debug('Connect', settings);
		return super.connect(settings.uri, _.omit(settings, ['uri']));
	};



	/**
	* Similar to the `mongoose.model(id, schema)` declaration but this method constructs the model and returns the SCHEMA not the MODEL
	* This allos easy chaining for setup methods like `.method()`, `.virtual()` etc.
	* @param {string} id The name of the model to create, this is automatically lowercased + pluralised
	* @param {Object|mongoose.Schema} schema The schema to construct, if this is a plain JS object it is constructed into a schema instance first
	*/
	schema(id, schema) {
		var compiledSchema = new Schema(schema);
		var model = super.model(id, compiledSchema);

		// Create insert / insertOne aliases
		model.insert = model.insertOne = model.create;

		// Debugging enabled? Strap a debugging prefix onto all doc access methods
		if (debug.enabled) {
			['count', 'create', 'deleteMany', 'deleteOne', 'insert', 'insertOne', 'insertMany', 'updateMany', 'updateOne']
				.forEach(method => {
					var originalMethod = model[method];
					model[method] = function(...args) {
						debug(method, ...args);
						debug(`mongoosy:${method}`, ...args);
						return originalMethod.call(this, ...args);
					};
				});
		}

		this.models[id] = model;
		return model.schema;
	};

}

module.exports = new Mongoosy();
