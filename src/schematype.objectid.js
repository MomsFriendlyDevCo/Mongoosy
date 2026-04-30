const mongoose = require('mongoose');

/**
* Hack to always auto-convert all ObjectIds to strings
* @see https://github.com/Automattic/mongoose/issues/6996#issuecomment-434063799
* @see https://github.com/Automattic/mongoose/issues/16250#event-24978162240
*/
mongoose.Schema.ObjectId.get(v => (v instanceof mongoose.Types.ObjectId) ? v.toString() : v);
