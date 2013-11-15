// helpers to create key/value mappings in sqlite db

var sqlite3 = require('sqlite3');
var Q = require('q');

var Db = module.exports = function(filename) {
	// use promises!
	var deferred = Q.defer();
	var db = new sqlite3.Database(filename, deferred.makeNodeResolver());
	// this.db is a promise for the database, once tables have been created
	this.db = deferred.promise.then(function() {
		return Q.ninvoke(db, "run",
						 "CREATE TABLE IF NOT EXISTS "+
						 "kv_table (key TEXT PRIMARY KEY, val TEXT);");
	}).then(function() { return db; });
};

// Returns a promise for the value.
Db.prototype.get = function(key) {
	return this.db.then(function(db) {
		return Q.ninvoke(db, "get",
						 "SELECT val FROM kv_table WHERE key = ?;",
						 key);
	});
};

// Returns a promise to write a value
Db.prototype.put = function(key, value) {
	return this.db.then(function(db) {
		return Q.ninvoke(db, "run",
						 "INSERT OR REPLACE INTO kv_table (key, val) "+
						 "VALUES (?,?);", key, value);
	});
};

// Returns a promise Finalize
Db.prototype.close = function() {
	return this.db.then(function(db) {
		return Q.ninvoke(db, "close");
	});
};
