require('./promise.allLimit');
module.exports = Promise.allSeries = promises => Promise.allLimit(1, promises);
