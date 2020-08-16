@MomsFriendlyDevCo/Mongoosy
===========================
The Mongoose module but with some quality-of-life additions:

**Must haves:**
[x] ObjectIds are automatically strings
[x] ObjectIds are always convered back to OIDs when saving to the database
[x] Schema types can be strings
[ ] `meta()` compatibility
[ ] Express ReST server
[ ] Middleware compatibility
[x] Connect with sane defaults
[x] Pointer schema type
[x] `model.insert()` / `model.insertOne()` (alias of `model.create()`)


**Nice to haves:**

[ ] Works with the MongoSh shell command
[ ] Programmable field surpression (use `filter` method per field
[ ] Automatic field surpression (fields prefixed with '_')
[ ] `DEBUG` env variable compatibility


Differences from Mongoose
=========================

Sane connection defaults
------------------------
Configuring the initial connection options in Mongoose can be a pain. Mongoosy ships with all the latest Mongoose switches tuned to their correct values, preventing any depreciation warnings.


ObjectIds are always strings
----------------------------
Mongoose makes comparing ObjectIds painful - always having to remember that while they look like strings they are actually objects and object comparison in JavaScript is unreliable.
To make life easier all ObjectIds fetched from the database are _always_ strings which get converted back to the correct BSON type on save.


Models have extra alias functions
---------------------------------
Models have the following additional aliased functions:

* `model.insert()` / `model.insertOne()` (alias of `model.create()`) - Bringing the syntax more into line with `model.updateOne` / `model.updateMany()`


Pointer schema type
-------------------
Pointers are really just one record in Mongoose pointing at another.
The pointer schema type is really just an ObjectId by default but it doesn't differenciate on storage methods (i.e. it can be an ObjectId but can be easily extended to storing UUIDs or some other item).


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


Migration
=========
When migrating from Monoxide to Mongoose there are a few minor things to remember:

* No issues reported yet
