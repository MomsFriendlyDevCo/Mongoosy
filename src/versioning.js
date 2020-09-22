module.exports = (mongoosy) => {
	mongoosy.on('schema', schema => {
		var hookFactory = function(path) {
			return function() {
				var target = (path && Object.prototype.hasOwnProperty.call(this, path)) ? this[path] : this;
				target.__v = 0 + target.__v + 1;
			}
		};

		// TODO: Are others among these inside _update?
		schema.pre(['save', 'update', 'updateOne', 'updateMany'], hookFactory());
		schema.pre('findOneAndUpdate', hookFactory('_update'));
	});
};
