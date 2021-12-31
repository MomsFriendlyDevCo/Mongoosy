@MomsFriendlyDevCo/Mongoosy
===========================
The Mongoose module but with some quality-of-life additions.



Differences from Mongoose
=========================
For the most part this module is a tiny wrapper around standard Mongoose but some additional quality-of-life fixes have been applied.


Sane connection defaults
------------------------
Configuring the initial connection options in Mongoose can be a pain. Mongoosy ships with all the latest Mongoose switches tuned to their correct values, preventing any depreciation warnings.

**NOTE:** `mongoosy.connect()` and `mongoosy.compileModels()` need to be called seperately. This is so calls to schema construction can be buffered with additional hooks and virtuals declared before the entire schema structure is ready to compile.


Version incrementing
--------------------
All documents have the meta `__v` property which now gets automatically incremented on each save.


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


Meta 'change' event
-------------------
The [Mongo middleware functions](https://mongoosejs.com/docs/middleware.html) are a little annoying when trying to differenciate between new, saved and updated documents. Mongoosy implements a generic 'change' event which tracks all of these simultaniously with one binding:

```javascript
mongoosy.models.widgets.pre('change', function() {
	var doc = this; // Context is the full document (pulled automatically even on partial queries)
	doc.$isNew() // Returns if the doc is being created for the first time (in the case of 'create' calls)
});
```

As with all middleware this function is async compatible and stackable.


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


Schema use() middleware helper
------------------------------
The Schema model now also includes an easily chainable middleware function `use(helper, optons)` which can instantiate middleware when the model is eventually compiled.

```javascript
mongoosy.schema('users')
	.use(someMongooseMiddleware, {foo: 'bar'})
	.use((model, options) => { /* ... do something with the compiled model + options object */ })
	// ... continue to chain other properties to the schema ... //
```

Each handler is a function which is called as `(model, options)` with the context being set to the now-instantiated `model` object.


Scenario support built in
-------------------------
Importing large datasets (with linked OIDs) is now supported as built-in functionality.
See the `mongoosy.scenario()` function for details.


ReST server support built in
----------------------------
Connecting a Mongoose collection to Express compatible middleware is now supported as built-in functionality.
See the `mongoosy.models.MODEL.serve()` function for details.


API
===
In addition to the default Mongoose methods this module also provides a few conveinence functions.


mongoosy.dropCollection(name)
-----------------------------
Drops a single collection by name.
Returns a promise which will resolve with a boolean true if a collection was dropped or false if the collection didn't exist anyway.


mongoosy.dropDatabase(confirmation)
-----------------------------------
Drop an entire database allow with data, collections and indexes.
Requires a confirmation object _exactly_ matching `{$confirmDrop: true}` for obvious reasons.
Returns a promise which will resolve when the database has dropped.


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
			$: '$users.joe',
			name: 'Joe Random',
			company: '$company.acme', // <- The ID of the first company is inserted here
		},
	],

});
```

In the above scenario the company is inserted first, its ID remembered and used to populate the `company` field of the user.


Options:

| Option       | Type       | Default | Description                                                                                                                                                                   |
|--------------|------------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `glob`       | `object`   | `{}`    | Additional options to pass to globby                                                                                                                                          |
| `circular`   | `boolean`  | `false` | Try to create stub documents in the first cycle, thus ensuring they always exists. This fixes recursive/graph-like data structures at the cost of speed                       |
| `nuke`       | `boolean`  | `false` | Whether to erase / rebuild existing collections before replacing them entirely                                                                                                |
| `threads`    | `number`   | `3`     | How many documents to attempt to create at once                                                                                                                               |
| `postRead`   | `function` |         | Manipulate the merged scenario object before processing, called as (tree) where each key is the model and all keys are an array of items, expected to return the changed tree |
| `postCreate` | `function` |         | Function called whenever a document is created under a model, called as (model, count) where model is a string and count the number created for that model so far             |
| `postStats`  | `function` |         | Called when complete as (stats) where each key is the model and the value is the number of documents created                                                                  |

**Circular mode**
Switching on `circular: true` enables stubbed-document mode which allows resolving complex circular, graph-like scenarios where a document can point at another and that in turn can point back to the original. These structures would need a non-circular tree like dependency if stubbing were disabled.
Stubbing creates empty documents for all items with an ID in the first cycle, then goes back and fills in their content later.
Because of this the process is slow (requiring insert + update as two distinct steps rather than one insert) but it does mean that circular dependencies are supported out of the box.



mongoosy.serve(model, options)
------------------------------
Create a Express compatible middleware backend which functions as a ReST server.
This is an alternate method to call `mongoosy.models.MODEL.serve(options)` with an explicit model.


mongoosy.models.MODEL.collectionName
------------------------------------
The actual, low-level database collection being interacted with.


mongoosy.models.MODEL.count(query)
----------------------------------
Alias for `MODEL.countDocuments(query)` which doesn't throw a warning.


mongoosy.models.MODEL.upsert(body, options)
-------------------------------------------
Wrapper around `mongoosy.models.MODEL.update()` which makes upserts behave a bit more obviously than using the $upsert property within an update query.

`body` is the document body to insert (if not found) or update (if a matching document already exists).

`options` can be either an Object (in which case it matches the below specification), an array or string (in which case it is assumed to populate `options.by`).


```javascript
mongoosy.models.users.upsert({
	name: 'Joe Random',
	email: 'joe@random.com',
}, ['email'])
	.then(doc => ... Existing or newly created user matching "email" field)
```


Options are:

| Option   | Type               | Default | Description                                                                                         |
|----------|--------------------|---------|-----------------------------------------------------------------------------------------------------|
| `by`     | `array` / `string` |         | How to match existing documents, if no match is found a new document is created from `body`         |
| `result` | `boolean`          | `true`  | Return the created / updated document. Disable this if you just want to save and ignore the new doc |
| `...`    | See Mongoose docs  |         | Other options passed to `MongooseModel.update()`                                                    |


mongoosy.models.MODEL.meta(options)
-----------------------------------
Return frontend-safe meta information about the schema of a model.
An object is returned with the key of each being the dotted notation to the schema path. The value is an object of the form `{type: String, enum?: Array, default?: Any, required?: Boolean, ...customFields}`

Options are:

| Option            | Type      | Default | Description                                                                        |
|-------------------|-----------|---------|------------------------------------------------------------------------------------|
| `arrayDefault`    | `boolean` | `true`  | Set the default type for arrays to `[]`                                            |
| `collectionEnums` | `boolean` | `true`  | Convert all enums into a collection of the type `{id: String, title: String}`      |
| `custom`          | `array`   | `[]`    | Additional field names to provide, each must be explicitly specified               |
| `filterPrivate    | `boolean` | `true`  | Omit all fields matching /^_/                                                      |
| `indexes`         | `boolean` | `true`  | Append indexing information                                                        |
| `prototype`       | `boolean` | `false` | Add a `$prototype` key which contains an empty object with all defaults applied |




mongoosy.models.MODEL.serve(options)
------------------------------------
Create a Express compatible middleware backend which functions as a ReST server.


```javascript
var app = express();
app.use(bodyParser.json());
app.use('/api/movies/:id?', mongoosy.models.movies.serve({
	create: true,
	get: true,
	query: true,
	count: true,
	save: true,
	delete: true,
}));
```

The following options are supported:

| Option             | Type                 | Default          | Description                                                                                                               |
|--------------------|----------------------|------------------|---------------------------------------------------------------------------------------------------------------------------|
| `get`              | See notes            | `true`           | Enable getting of records or specify middleware(s) to execute beforehand                                                  |
| `getMap`           | Promiseable function |                  | Function to use post-get to mangle a single document in a get (overrides `selectHidden`). Called as `(MongooseDocument)`  |
| `query`            | See notes            | `true`           | Enable querying of records or specify middleware(s) to execute beforehand                                                 |
| `queryForce`       | Promiseable function |                  | Called as `(req)` to override `req.query` with either a static object or an evaluated promise. Called as `(req)`          |
| `queryMap`         | Promiseable function |                  | Function to use post-query to mangle outgoing documents (overrides `selectHidden`). Called as `(MongooseDocument)`        |
| `queryValidate`    | Promiseable function |                  | Validate an incomming query, similar to `queryForce`. Throw an error to reject. Called as `(req)`.                        |
| `count`            | See notes            | `true`           | Enable counting of records or specify middleware(s) to execute beforehand                                                 |
| `countParam`       | `string`             | `"count"`        | Special case URL suffix to identify that we are performating a count operation and not looking up an ID                   |
| `create`           | See notes            | `true`           | Enable creating of records or specify middleware(s) to execute beforehand                                                 |
| `save`             | See notes            | `true`           | Enable updating of records or specify middleware(s) to execute beforehand                                                 |
| `delete`           | See notes            | `true`           | Enable deleting of records or specify middleware(s) to execute beforehand                                                 |
| `meta`             | See notes            | `true`           | Enable retrieving the structure of the collection                                                                         |
| `metaCustomFields` | `array<string>`      | `[]`             | Array of additional custom fields to expose during a meta data query                                                      |
| `metaParam`        | `string`             | `"meta"`         | Special case URL suffix to identify that we are performating a meta operation and not looking up an ID                    |
| `search`           | See notes            | `false`          | Enable searching of records or specify middleware(s) to execute beforehand                                                |
| `searchId`         | `string`             | `"_id"`          | What field to search by when fetching / updating / deleting documents                                                     |
| `searchParam`      | `string`             | `'q'`            | Special case URL querystring to identify that we are performating a search operation and not looking up an ID             |
| `param`            | `string`             | `"id"`           | Where to look in req.params for the document ID to get/update/delete                                                      |
| `selectHidden`     | `boolean`            | `false`          | Automatically surpress all output fields prefixed with `_`                                                                |
| `forbidHidden`     | `boolean`            | `true`           | Forbid the selection of fields prefixed with `_`                                                                          |
| `neverHidden`      | `array<string>`      | `['_id', '__v']` | Array of fields which are excluded from hiding                                                                            |
| `errorHandler`     | Function             | See code         | How to handle errors, default is to use Expresses `res.status(code).send(text)` method. Called as (res, code, text)       |


**Notes:**

* The `get` / `query` / `count` / `create` / `save` / `delete` / `meta` methods can be a simple boolean to enable / disable, an array of Express middleware functions, a single middleware function or a string pointing to the definition in another key. Middleware are all called as `(req, res, next)` and can either call `next()` to accept the request or handle output via `res.send()`
* If `queryForce` is a function it is expected to either mutate `req.query` or return the new absolute contents of that object which is spliced in place. Any falsy return is ignored
* `getMap` / `queryMap` can also be literal strings `'getMap'` / `'queryMap'` in which case the other field is consulted for a value. This is similar behaviour to setting string pointers for middleware


EVENT: model
------------
Emitted as `(modelInstance)` when a model is declared.
Useful to extend the base model functionality when a new model appears.
Note that event hooks cannot be bound at this stage. Trap the `schema` event and add hooks to that instead.


EVENT: schema
-------------
Emitted as `(schemaInstance)` when a schema is declared.
Useful to extend the schema functionality with hooks and other custom functionality.


Migration
=========
When migrating from Monoxide to Mongoose there are a few minor things to remember:

* An additional `mongoosy.compileModels()` call is needed post-connection + post-schema loading to ready the models
* Scenarios now use `$` as the ID field (formally: `_ref`), they also require all ID lookup fields to have a dollar prefix and the ID to match (including the prefix)
* Queries returning no documents no longer automatically fail if `$errNoDocs` is set, use `query.orFail()` instead
* `model.use()` -> `model.plugin()`
* `model.findOneByID()` -> `model.findOne()`
* When setting `{ type: Object, default: {} }` pass `{ minimize: false }` option to `Schema` in order to ensure the key is created.
* Iterators now use the default [Mongoose cursor system](https://mongoosejs.com/docs/api/query.html#query_Query-cursor). Use the `Thing.find().cursor().map()` pattern instead of filter / map / forEach
* Virtuals do not pass the document as the first parameter. Use `this` within the getter / setter function to recieve the current document
* `model.hook()` is no longer supported. Use the [Mongoose pre/post methods instead](https://mongoosejs.com/docs/middleware.html#pre) - `model.pre('save', fn)` / `model.post('save', fn)` instead. `fn` is called as `(doc)` and will be waited on if its a promise.
