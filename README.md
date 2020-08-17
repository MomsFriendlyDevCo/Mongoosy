@MomsFriendlyDevCo/Mongoosy
===========================
The Mongoose module but with some quality-of-life additions:

**Must haves:**
* [x] ObjectIds are automatically strings
* [x] ObjectIds are always convered back to OIDs when saving to the database
* [x] Schema types can be strings
* [ ] `meta()` compatibility
* [ ] Express ReST server
* [ ] Middleware compatibility
* [x] Connect with sane defaults
* [x] Pointer schema type
* [x] `model.insert()` / `model.insertOne()` (alias of `model.create()`)
* [x] `mongoosy.scenario()`


**Nice to haves:**
* [ ] Works with the MongoSh shell command
* [ ] Programmable field surpression (use `filter` method per field
* [ ] Automatic field surpression (fields prefixed with '_')
* [x] `DEBUG` env variable compatibility


Differences from Mongoose
=========================
For the most part this module is a tiny wrapper around standard Mongoose but some additional quality-of-life fixes have been applied.


Sane connection defaults
------------------------
Configuring the initial connection options in Mongoose can be a pain. Mongoosy ships with all the latest Mongoose switches tuned to their correct values, preventing any depreciation warnings.


ObjectIds are always strings
----------------------------
Mongoose makes comparing ObjectIds painful - always having to remember that while they look like strings they are actually objects and object comparison in JavaScript is unreliable.
To make life easier, all ObjectIds fetched from the database are _always_ simple strings which get converted back to the correct BSON type on save.

```javascript
Promise.all([
	mongoosy.models.users.findOne({name: 'Adam'}),
	mongoosy.models.users.findOne({role: 'admin'}),
]).then(([adam, admin]) => {
	console.log(
		adam._id == admin._id // Simple string comparison
			? 'Adam is admin'
			: 'Adam is not admin'
	);
})
```


Easier debugging
----------------
Mongoosy uses wraps all data read/write functions in the [debug NPM module](https://github.com/visionmedia/debug) for debugging.

To enable debugging set the environment variable to `DEBUG=mongoosy` for all debugging, `DEBUG=mongoosy:METHOD` for a specific method or combine globs as needed.

For example:

```
# Execute myFile.js showing all debugging (can be very loud)
DEBUG=mongoosy node myFile.js

# Execute myFile.js showing all updateOne calls
DEBUG=mongoosy:updateOne node myFile.js

# Execute myFile.js showing insert and delete calls
DEBUG=mongoosy:insert*,mongoosy:delete* node myFile.js
```

Note that enabling the debugging mode adds a small overhead to all model methods.


Models have extra alias functions
---------------------------------
Models have the following additional aliased functions:

* `model.insert()` / `model.insertOne()` (alias of `model.create()`) - Bringing the syntax more into line with `model.updateOne` / `model.updateMany()`


Pointer schema type
-------------------
Pointers are really just one Mongo document pointing at another.
The pointer schema type is actually just an ObjectId by default but it doesn't differenciate on storage methods (i.e. it can be an ObjectId but can be easily extended to storing UUIDs or some other item).


Schema virtuals are chainable
-----------------------------
The [Virtuals](https://mongoosejs.com/docs/guide.html#virtuals) configuration in Mongoose is awkward when it comes to adding methods onto schemas.
Mongoosy supports a simple `(id, {get, set})` or `(id, getter, setter)` syntax without exiting the model chain:

```javascript
mongoosy.schema('users')
	.virtual('password', ()=> 'RESTRICTED', function(pass) {
		// Very crappy, yet predictable password hasher that removes all consonants
		this._password = pass
			.toLowerCase()
			.replace(/[^aeiou]+/g, '');
	})
	.virtual('passwordStrength', function() {
		// Returns the length of the (badly, see above) hashed password which is an approximate indicator of hash strength
		return (this._password.length || 0);
	})
```


API
===
In addition to the default Mongoose methods this module also provides a few conveinence functions.


mongoosy.dropCollection(name)
-----------------------------
Drops a single collection by name.
Returns a promise which will resolve with a boolean true if a collection was dropped or false if the collection didn't exist anyway.


mongoosy.scenario(inputs, options)
----------------------------------
Utility function to quickly load a JSON / JS file into a model.
Inputs can be a JS object(s) or a file glob (or array of globs) to process.

This function acts similar to `insertMany()` with the following differences:

* Models are specified as the top level object key with an array of documents as the value - thus you can import to multiple models at the same time
* The special `$` key is accepted as an identifier for a document, the string value is used as the identifier - i.e. give this inserted document a temporary alias
* Any string field starting with `$` should have the computed ID value of the named document inserted in place
* Creation order is automatically calculated - documents with prerequisites are inserted in the correct order


```javascript
mongoosy.scenario({
	companies: [
		{
			$: '$company.acme',
			name: 'Acme Inc',
		},
	],
	users: [
		{
			$: 'users.joe',
			name: 'Joe Random',
			company: '$company.acme', // <- The ID of the first company is inserted here
		},
	],

});
```

In the above scenario the company is inserted first, its ID remembered and used to populate the `company` field of the user.




Migration
=========
When migrating from Monoxide to Mongoose there are a few minor things to remember:

* No issues reported yet
