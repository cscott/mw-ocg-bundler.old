// helpers to create key/value mappings in sqlite db

var sqlite3 = require('sqlite3');
var when = require('when');
var nodefn = require("when/node/function");

var Db = module.exports = function(filename) {
	// use promises!
	var deferred = when.defer();
	var db = new sqlite3.Database(filename, nodefn.createCallback(deferred));
	// this.db is a promise for the database, once tables have been created
	this.db = deferred.promise.then(function() {
		return nodefn.call(db.run.bind(db),
						   "CREATE TABLE IF NOT EXISTS "+
						   "kv_table (key TEXT PRIMARY KEY, val TEXT);");
	}).then(function() { return db; });
};

// Returns a promise for the value.
Db.prototype.get = function(key) {
	return this.db.then(function(db) {
		return nodefn.call(db.get.bind(db),
						   "SELECT val FROM kv_table WHERE key = ?;",
						   key);
	});
};

// Returns a promise to write a value.
Db.prototype.put = function(key, value) {
	return this.db.then(function(db) {
		return nodefn.call(db.run.bind(db),
						   "INSERT OR REPLACE INTO kv_table (key, val) "+
						   "VALUES (?,?);", key, value);
	});
};

// Returns a promise to close and finalize the database.
Db.prototype.close = function() {
	return this.db.then(function(db) {
		return nodefn.call(db.close.bind(db));
	});
};
