var mongoose = require('mongoose');

/**
* Hack to always auto-convert all ObjectIds to strings
* @see https://github.com/Automattic/mongoose/issues/6996#issuecomment-434063799
*/
mongoose.Schema.ObjectId.get(v => v != null ? v.toString() : v);
