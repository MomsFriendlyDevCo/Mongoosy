var _ = require('lodash');
var debug = require('debug')('mongoosy:schema');
var mongoose = require('mongoose');

module.exports = class MongoosySchema extends mongoose.Schema {

	/**
	* Parent Mongoosy instance
	* @type {Mongoosy}
	*/
	mongoosy = undefined;


	/**
	* ID of this schema
	* @type {string}
	*/
	id = undefined;


	/**
	* Queued use() middleware functions to run when the model is compiled
	* @type {array<Object>}
	* @property {function} handler The handler function to run in each case
	* @property {Object} Options Additional object to pass to the handler in each case
	*/
	middleware = [];


	/**
	* Wrap the default virtual declaration so that we can accept an object definition or a simple getter only
	* @param {string} field Field to setup the virtual on
	* @param {function|object} getter Either an object of the form `{get: Function, set:Function}` or the getter worker for a virtual
	* @param {function} [setter] If specifying the getter/setter seperately, this specifies the setter worker for the virtual
	* @returns {MongoosySchema|MongooseVirtual} If called as `(String, Object | Function)` this function returns a chainable function, all others returns a regular Mongoose Virtual instance
	*/
	virtual(field, getter, setter) {
		// Treat as object spec
		if (_.isString(field) && _.isPlainObject(getter)) {
			super.virtual(field, getter);
		} else if (_.isString(field) && (_.isFunction(getter) || _.isFunction(setter))) {
			if (_.isFunction(getter)) super.virtual(field).get(getter);
			if (_.isFunction(setter)) super.virtual(field).set(setter);
		} else {
			super.virtual(field, getter);
		}
		return this;
	};


	/**
	* Instanciate a function with the given options setting the context to the current compiled model when its loaded
	* @param {function} handler Callback function to run when the model is ready
	* @param {Object} [options] Additional options to pass to the callback when instanciating
	* @returns {MongoosySchema} Chainable schema object
	*/
	use(handler, options = {}) {
		if (typeof handler != 'function') throw new Error('First param to mongoosy.schema.use() must be a handler function');
		if (options && typeof options != 'object') throw new Error('Second param to mongoosy.schema.use() must an options object or falsy');
		this.middleware.push({handler, options});
		return this;
	};


	/**
	* Force compile the model now
	* This effectiyly fires compileTemplates() immediately on this one model
	* This is only really useful if models are declared late in the load order
	*/
	compile() {
		return this.mongoosy.compileModels(this.id);
	};


	/**
	* Wrap the pre handler so that we can capture the meta 'change' event
	* @see https://mongoosejs.com/docs/api/schema.html#schema_Schema-pre
	* @param {string} hook Middleware function to trap
	* @param {Object} [options] Additional options to pass
	* @param {function} handler Handler function to attach
	* @returns {MongoosySchema} Chainable schema object
	*/
	pre(hook, options, handler) {
		if (hook == 'change') {
			if (_.isFunction(options)) [options, handler] = [{}, options];

			debug('pre change binding');
			// Functions that are sane and pass the entire doc
			this.pre('save', handler);
			this.pre('updateOne', handler);

			// Functions that only give us a query
			var resolveDoc = query =>
				this.mongoosy.models[this.id].findById(query._id)
					.then(doc => handler.call(doc))
			this.pre('update', resolveDoc);
			this.pre('findOneAndUpdate', resolveDoc);
			this.pre('updateMany', resolveDoc);
		} else {
			super.pre(hook, options, handler);
		}
		return this;
	};


	/**
	* Wrap the post handler so that we can capture the meta 'change' event
	* @see https://mongoosejs.com/docs/api/schema.html#schema_Schema-pre
	* @param {string} hook Middleware function to trap
	* @param {Object} [options] Additional options to pass
	* @param {function} handler Handler function to attach
	* @returns {MongoosySchema} Chainable schema object
	*/
	post(hook, options, handler) {
		if (hook == 'change') {
			if (_.isFunction(options)) [options, handler] = [{}, options];

			debug('post change binding');
			// Functions that are sane and pass the entire doc
			this.post('save', handler);
			this.post('updateOne', handler);

			// Functions that only give us a query
			var resolveDoc = query =>
				this.mongoosy.models[this.id].findById(query._id)
					.then(doc => handler.call(doc))
			this.post('update', resolveDoc);
			this.post('findOneAndUpdate', resolveDoc);
			this.post('updateMany', resolveDoc);
		} else {
			super.post(hook, options, handler);
		}
		return this;
	};
}
