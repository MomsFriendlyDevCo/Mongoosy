var _ = require('lodash');
var debug = require('debug')('mongoosy');
var mongoose = require('mongoose');

module.exports = class MongoosySchema extends mongoose.Schema {

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
			return this;
		} else if (_.isString(field) && (_.isFunction(getter) || _.isFunction(setter))) {
			super.virtual(field, {get: getter, set: setter});
			return this;
		} else {
			return super.virtual(field, getter);
		}
	};

}
