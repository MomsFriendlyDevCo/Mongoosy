var _ = require('lodash');
var Debug = require('debug');
var debug = Debug('mongoosy');
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

		this.models[id] = model;
		return model.schema;
	};


	/**
	* Drop a collection by name from the database
	* @param {string} name The name of the collection to drop
	* @returns {boolean} A boolean true if the collection was actually dropped, false if it didn't exist anyway
	*/
	dropCollection(name) {
		return Promise.resolve()
			.then(()=> this.connection.db.collections())
			.then(collections => collections
				.filter(c => c.s.namespace.collection == name)
			)
			.then(collections => {
				if (!collections.length) return false;
				return collections[0].drop();
			})
			.then(()=> true);
	};

}

module.exports = new Mongoosy();
