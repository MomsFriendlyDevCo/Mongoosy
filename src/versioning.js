module.exports = (mongoosy) => {
	mongoosy.on('schema', schema => {
		var applyVersioning = function(...args) {
			this.__v = 0+this.__v + 1;
		};


		schema.pre('save', applyVersioning);
		schema.pre('update', applyVersioning);
		schema.pre('updateOne', applyVersioning);
		schema.pre('updateMany', applyVersioning);

		// Special weird case for findOneAndUpdate
		schema.pre('findOneAndUpdate', async function() {
			var doc = await this.model.findOne(this.select('__v').getQuery());
			// Note that we don't actually do anything here as the above function now gets correctly called on save
			await doc.save();
		});
	});
};
