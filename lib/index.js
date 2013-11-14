require('es6-shim'); // Map/Set support
require('tmp').setGracefulCleanup();

var PARALLEL_FETCH_LIMIT = 5; // limit number of parallel requests

var async = require('async');
var domino = require('domino');
var fs = require('fs');
var path = require('path');
var request = require('request');
var tmp = require('tmp');
var url = require('url');
var util = require('util');

module.exports = {
	version: require('../package.json').version
};

module.exports.bundle = function(metabook, nfo, options) {
	var Parsoid = require('./parsoid');
	var Image = require('./image');

	var log = function() {
		if (options.verbose || options.debug) {
			console.error.apply(console, arguments);
		}
	};

	var parsoid = new Parsoid(nfo.parsoid, log);

	var tmpdir = null;
	var sourceMap = new Map(), imageMap = new Map();

	var createTmpDir = function(callback) {
		tmp.dir({
			prefix: 'mw-bundler-',
			unsafeCleanup: !options.debug
		}, function(err, _tmpdir) {
			if (!err) { tmpdir = _tmpdir; }
			callback(err);
		});
	};

	var fetchParsoid = function(callback) {
		log('Fetching parsed article contents from Parsoid');
		var tasks = [];
		var doOne = function(prefix, title, callback) {
			parsoid.fetch(prefix, title, function(err, result) {
				if (!err) {
					sourceMap.set(prefix+':'+title, result);
					result.getImages().forEach(function(img) {
						imageMap.set(img.resource, img);
					});
				}
				callback(err);
			});
		};
		var visit = function(item) {
			if (item.type === 'article') {
				var prefix = 'en'; // XXX!
				tasks.push(doOne.bind(null, prefix, item.title));
			} else if (item.type === 'collection' || item.type === 'chapter') {
				item.items.forEach(visit);
			}
		};
		visit(metabook);
		async.parallelLimit(tasks, PARALLEL_FETCH_LIMIT, callback);
	};

	var fetchImages = function(callback) {
		log('Fetching images');
		var tasks = [];
		imageMap.forEach(function(img) {
			tasks.push(function(callback) {
				Image.fetch(img.resource, img.src, tmpdir, log, function(err, name) {
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

	var createBundle = function(callback) {
		log('Creating bundle');
		// write stuff in tmpdir
		// XXX
	};

	async.series([
		createTmpDir,
		fetchParsoid,
		fetchImages,
		createBundle
	], function(err, results) {
		if (err) {
			/* clean up? */
			process.exit(1);
		}
		log('Done');
	});
};
