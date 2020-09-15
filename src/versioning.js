module.exports = (mongoosy) => {
	mongoosy.on('schema', schema => {
		var applyVersioning = function(path) {
			return function() {
				var target = Object.prototype.hasOwnProperty.call(this, path) ? this[path] : this;
				target.__v = 0 + target.__v + 1;
			}
		};


		schema.pre('save', applyVersioning());
		schema.pre('update', applyVersioning());
		schema.pre('updateOne', applyVersioning());
		schema.pre('updateMany', applyVersioning());
		schema.pre('findOneAndUpdate', applyVersioning('_update'));
	});
};
