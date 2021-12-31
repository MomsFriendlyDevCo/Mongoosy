var _ = require('lodash');
var Debug = require('debug');
var debug = Debug('mongoosy:core');
var mongoose = require('mongoose');
var eventer = require('@momsfriendlydevco/eventer');
var Schema = require('./schema');

require('./schematype.objectid');
require('./schematype.pointer');

class Mongoosy extends mongoose.Mongoose {

	constructor() {
		debug('Instanciate');
		super();
		eventer.extend(this);

		require('./rest')(this);
		require('./model')(this);
		// require('./versioning')(this);
	};


	/**
	* Scenario importer function
	* @see Scenario.js
	*/
	scenario = require('./scenario').bind(this, this);


	/**
	* Declared model schemas
	* These are compiled into models when compileModels() is called
	* @type {Object<MongoosySchema>}
	*/
	schemas = {};


	/**
	* Storage for all models loaded as schemas in this instance of Mongoosy
	* @type {<Object>MongooseModel} Populated from schemas when compileModels is called
	*/
	models = {};


	connect(uri, options) {
		var settings = {
			uri: _.isString(uri) ? uri : options.uri,

			// "depreciated feature" surpression - assume sane Mongoose connection options in all cases
			useNewUrlParser: true,
			useUnifiedTopology: true,

			// Inherit rest of options
			...options,
		};

		debug('Connect', settings);
		return super.connect(settings.uri, _.omit(settings, ['uri']));
	};



	/**
	* Compile all pending schemas into models
	* This has to be done when all the virtuals / hooks / event sequencing has taken place so its seperated from connect()
	* @param {string|array<string>} [ids] Optional ID or array of IDs to limit to
	* @returns {Promise<Object>} A promise which will resolve with all available models post-compile
	*
	* @emits schema Emitted as `(schemaInstance)` - Event listeners may decorate the schema object prior to compilation into a model
	* @emits model Emitted as `(modelInstance)` - Event listeners may decorate the compiled model after its ready
	*/
	compileModels(ids) {
		debug('Compile models:', ids || Object.keys(this.schemas));
		if (_.isEmpty(this.schemas)) throw new Error('Call to compileModels() when no schemas have been declared');

		return Promise.all(Object.keys(this.schemas)
			.filter(id => !ids || _.castArray(ids).includes(id))
			.map(id => Promise.resolve()
				.then(()=> this.emit('schema', this.schemas[id]))
				.then(()=> this.models[id] = super.model(id, this.schemas[id]))
				.then(()=> this.emit('model', this.models[id]))
				.then(()=> this.utils.promiseAllLimit(1, this.schemas[id].middleware.map(middleware => ()=>
					middleware.handler.call(this.models[id], this.models[id], middleware.options)
				)))
			)
		)
		.then(()=> this.models)
	};



	/**
	* Similar to the `mongoose.model(id, schema)` declaration but this method prepares the schema and doesn't compile it until compileModels() is called
	* This is so we can keep specifying hooks, virtuals etc. and compile the models when we're ready
	* This allows easy chaining for setup methods like `.method()`, `.virtual()` etc.
	* @param {string} id The name of the model to create, this is automatically lowercased + pluralised
	* @param {Object|mongoose.Schema} schema The schema to construct, if this is a plain JS object it is constructed into a schema instance first
	* @returns {MongooseSchema} The created Mongoose schema, also available via mongoosy.model[name]
	*/
	schema(id, schema) {
		debug('Declare schema', id);
		this.schemas[id] = new Schema(schema);
		this.schemas[id].id = id;
		this.schemas[id].mongoosy = this;
		return this.schemas[id];
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


	/**
	* Drop an entire database
	* For obvious safety reasons this function requires an object parameter exactly matching `{$confirmDrop: true}`
	* @param {object} confirmation Required confirmation object
	* @returns {Promise} A promise which will resolve when the database has dropped
	*/
	dropDatabase(confirmation) {
		if (!_.isEqual(confirmation, {$confirmDrop: true})) throw new Error('Refusing to drop database without exact confirmation object');
		return this.connection.dropDatabase();
	};


	/**
	* Various utilities
	* @type {Object}
	*/
	utils = {
		promiseAllLimit: require('./promise.alllimit'),
	};

}

module.exports = new Mongoosy();
