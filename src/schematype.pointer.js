var mongoose = require('mongoose');

// BUGFIX: For some reason Mongoose insists that we provide both cases when matching {type: 'pointer'} inside and outside of sub-document arrays
mongoose.Schema.Types.pointer =
	mongoose.Schema.Types.Pointer
	= mongoose.Schema.Types.ObjectId;
