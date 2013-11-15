require('es6-shim'); // Map/Set support
require('tmp').setGracefulCleanup();

var PARALLEL_FETCH_LIMIT = 5; // limit number of parallel requests

var archiver = require('archiver');
var async = require('async');
var domino = require('domino');
var fs = require('fs');
var path = require('path');
var request = require('request');
var rimraf = require('rimraf');
var tmp = require('tmp');
var url = require('url');
var util = require('util');

module.exports = {
	version: require('../package.json').version
};

module.exports.bundle = function(metabook, nfo, options) {
	// fail fast if output location is not writable
	fs.mkdirSync(options.output, 0700);

	var Parsoid = require('./parsoid');
	var Image = require('./image');
	var Db = require('./db');

	var log = function() {
		if (options.verbose || options.debug) {
			console.error.apply(console, arguments);
		}
	};

	var parsoid = new Parsoid(nfo.parsoid, log);

	var sourceMap = new Map(), imageMap = new Map();

	var fetchParsoid = function(callback) {
		log('Fetching parsed article contents from Parsoid');
		var parsoidDb = new Db(path.join(options.output, "parsoid.db"));
		var tasks = [];
		var doOne = function(item, prefix, title, callback) {
			parsoid.fetch(prefix, title, function(err, result) {
				if (err) { return callback(err); }
				var revid = result.getRevisionId();
				if (!revid) { return callback("No revision ID"); }
				item.revision = '' + revid;
				sourceMap.set(prefix+':'+title, result);
				result.getImages().forEach(function(img) {
					imageMap.set(img.resource, img);
				});
				parsoidDb.put(item.revision, result.text).then(function() {
					callback(null);
				}).done();
			});
		};
		var visit = function(item) {
			if (item.type === 'article') {
				var prefix = 'en'; // XXX!
				tasks.push(doOne.bind(null, item, prefix, item.title));
			} else if (item.type === 'collection' || item.type === 'chapter') {
				item.items.forEach(visit);
			}
		};
		visit(metabook);
		async.parallelLimit(tasks, PARALLEL_FETCH_LIMIT, function(err) {
			parsoidDb.close().then(function() { callback(err); },
								   function() { callback(err || "can't close"); });
		});
	};

	var imagedir = path.join(options.output, 'images');
	var fetchImages = function(callback) {
		log('Fetching images');
		var tasks = [];
		imageMap.forEach(function(img) {
			tasks.push(function(callback) {
				Image.fetch(img.resource, img.src, imagedir, log, function(err, name) {
					if (!err) {
						log(' stored in', name);
						img.filename = name;
					}
					callback(err);
				});
			});
		});
		async.parallelLimit(tasks, PARALLEL_FETCH_LIMIT, callback);
	};

	var writeMetabookJson = function(callback) {
		fs.writeFile(path.join(options.output, "metabook.json"),
					 JSON.stringify(metabook),
					 callback);
	};

	var writeNfoJson = function(callback) {
		fs.writeFile(path.join(options.output, "nfo.json"),
					 JSON.stringify(nfo),
					 callback);
	};

	var createBundle = function(callback) {
		log('Creating bundle');
		if (options.nozip) {
			return fs.chmod(options.output, 0755, callback); // make readable
		}
		// zip it up!
		var tmpzip = options.output + '.tmp';
		var output = fs.createWriteStream(tmpzip, { flags: 'wx' });
		var archive = archiver('zip');
		archive.pipe(output);

		fs.readdirSync(options.output).forEach(function(f) {
			var fullpath = path.join(options.output, f);
			if (f === 'images') {
				fs.readdirSync(fullpath).forEach(function(ff) {
					archive.append(fs.createReadStream(path.join(fullpath, ff)),
						{ name: path.join(f, ff) } );
				});
				return;
			}
			archive.append(fs.createReadStream(fullpath), { name: f });
		});

		archive.finalize(function(err, bytes) {
			try {
				rimraf.sync(options.output);
				fs.renameSync(tmpzip, options.output);
			} catch (e1) { if (!err) { err = e1; } }
			try {
				rimraf.sync(tmpzip);
			} catch (e2) { if (!err) { err = e2; } }
			callback(err, null);
		});
	};

	async.series([
		fetchParsoid,
		// xxx: write parsoid to parsoid.db
		fs.mkdir.bind(fs, imagedir, 0777),
		fetchImages,
		writeMetabookJson,
		writeNfoJson,
		// xxx: license info
		createBundle
	], function(err, results) {
		if (err) {
			// make friendly error message
			if (err.code === 'EEXIST') {
				err = 'Error: ' + err.path + ' exists';
			}
			console.error(err);
			// clean up
			try {
				rimraf.sync(options.output);
			} catch (e) { /* ignore */ }
			/* clean up? */
			process.exit(1);
		}
		log('Done');
	});
};
