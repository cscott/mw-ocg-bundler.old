"use strict";
require('es6-shim'); // Map/Set support

var json = require('../package.json');

var fs = require('fs');
var path = require('path');
var rimraf = require('rimraf');
var util = require('util');
var when = require('when');

var Db = require('./db');
var Html = require('./html');
var Image = require('./image');
var Metabook = require('./metabook');
var P = require('./p');
var Parsoid = require('./parsoid');
var Revisions = require('./revisions');
var Siteinfo = require('./siteinfo');
var StatusReporter = require('./status');

// set this to true to emit bundles which are more closely compatible
// with the pediapress bundler (at the cost of poorer support for
// interwiki collections)
var IMAGEDB_COMPAT = false;
// limit the total number of redirects we are willing to follow
var MAX_REDIRECTS = 5;

module.exports = {
	name: json.name, // package name
	version: json.version // version # for this package
};

// allow access to the metabook creation/repair functions
module.exports.metabook = Metabook;

// returns a promise to create the given bundle
module.exports.bundle = function(metabook, options) {
	var status = options.status = new StatusReporter(5, function(msg) {
		if (options.log) {
			var file = msg.file ? (': ' + msg.file) : '';
			options.log('['+msg.percent.toFixed()+'%]', msg.status + file);
		}
	});


	var parsoid = new Parsoid(metabook.wikis);
	var html = new Html(metabook.wikis);
	var imageloader = new Image(metabook.wikis);

	var sourceMap = new Map(), imageMap = new Map();

	var cleanUpOutput = false;

	var mkOutputDir = function() {
		// fail if output location is not writable
		return P.call(fs.mkdir, fs, options.output, parseInt('700', 8)).then(function() {
			// don't clean up output dir unless this mkdir succeeded
			cleanUpOutput = true;
		});
	};

	// promise to repair metabook
	var repairMetabook = function() {
		return Metabook.repair(metabook, options).then(function(m) {
			metabook = m;
		});
	};

	// promise to fetch and write siteinfo
	var fetchSiteinfo = function() {
		return Siteinfo.fetchAndWrite(metabook.wikis, options);
	};

	// count total # of items (used for status reporting)
	var countItems = function(item) {
		return (item.items || []).reduce(function(sum, item) {
			return sum + countItems(item);
		}, 1);
	};

	// returns a promise which is resolved when the sourceMap has been
	// filled with all the parsoid sources.
	var fetchParsed = function() {
		status.createStage(
			// once for Parsoid, once for PHP parser, once for completion.
			3 * countItems(metabook),
			'Fetching parsed articles'
		);

		var parsoidDb = new Db(path.join(options.output, "parsoid.db"));
		var htmlDb = options.compat ?
			new Db(path.join(options.output, "html.db")) : null;
		var max_redirects = options.follow ? MAX_REDIRECTS : 0;

		var tasks = [];
		// a promise to parse a single item (from parsoid & php)
		var doOneItem = function(item) {
			item.wiki = item.wiki || 0;
			// note that item revision is not a unique key in a multiwiki
			// collection. so we prefix it by the wiki index in that case.
			var key = item.wiki ? (item.wiki+'|') : '';
			return parsoid.fetch(
				item.wiki, item.title, item.revision, max_redirects, status
			).then(function(result) {
				var revid = result.getRevisionId();
				if (!revid) { throw new Error("No revision ID"); }
				item.revision = '' + revid;
				sourceMap.set(revid, result);
				result.getImages().forEach(function(img) {
					// xxx this stores metadata for all images in memory.
					// for very large bundles, store in temp db?
					imageMap.set(img.resource, img);
				});
				key += item.revision;
				return parsoidDb.put(key, result.text);
			}).then(function() {
				return options.compat ? html.fetch(item.wiki, item.title, item.revision, status) : null;
			}).then(function(result) {
				return options.compat ? htmlDb.put(key, result) : null;
			}).then(function() {
				status.report(null, util.format(
					'%s:%s [complete]',
					metabook.wikis[item.wiki].prefix, item.title
				));
			});
		};

		// recursively visit all items in the metabook info structure
		(function visit(item) {
			if (item.type === 'article') {
				tasks.push(doOneItem(item));
			} else {
				status.reportN(3, null, item.type + ' ' + item.title);
				(item.items || []).forEach(visit);
			}
		})(metabook);

		// return a promise to do all these tasks, then close the parsoid db
		return when.all(tasks).then(function() {
			return parsoidDb.close();
		}).then(function() {
			return options.compat ? htmlDb.close() : null;
		});
	};

	var imagedir = path.join(options.output, 'images');

	var mkImageDir = function() {
		return P.call(fs.mkdir, fs, imagedir, parseInt('777', 8));
	};

	// returns a promise which is resolved when all images from the imageMap
	// are downloaded.
	var fetchImages = function() {
		status.createStage(2 * imageMap.size, 'Fetching media');
		var imageDb = new Db(path.join(options.output, "imageinfo.db"));

		var tasks = [];
		imageMap.forEach(function(img) {
			var p = imageloader.fetchMetadata(img, status).then(function() {
				if (img.imageinfo.mediatype === 'BITMAP' ||
					img.imageinfo.mediatype === 'DRAWING' ||
					img.imageinfo.mediatype === 'VIDEO' ||
					img.imageinfo.mime === 'application/pdf') {
					return imageloader.fetch(img, imagedir, status);
				} else {
					status.report(null, img.short + ' [skipping]');
				}
			}).then(function() {
				var metadata = {
					height: img.imageinfo.height,
					width: img.imageinfo.width,
					thumburl: img.src,
					url: img.imageinfo.url,
					descriptionurl: img.imageinfo.descriptionurl,
					sha1: img.imageinfo.sha1,
					// our extensions:
					resource: img.resource,
					short: img.short,
					mime: img.imageinfo.mime,
					mediatype: img.imageinfo.mediatype,
					filename: img.filename
				};
				var key = IMAGEDB_COMPAT ? img.short : img.resource;
				return imageDb.put(key, metadata);
			});
			tasks.push(p);
		});

		// return a promise to do all these tasks, then close the db
		return when.all(tasks).then(function() {
			return imageDb.close();
		});
	};

	var fetchRevisions = function() {
		// create list of titles to fetch
		var titles = [];
		//  ... all articles
		sourceMap.forEach(function(parsoidResult, revid) {
			titles.push({
				wiki: parsoidResult.wiki,
				title: parsoidResult.title,
				revid: revid
			});
		});
		//  ... all image pages
		imageMap.forEach(function(img) {
			// look up appropriate wiki (may fetch from commons)
			var w = metabook.wikis[img.wiki], iwiki = img.wiki;
			w.filerepos.forEach(function(repo) {
				if (img.imagerepository === repo.name) {
					iwiki = repo.wiki;
				}
			});
			// normalize namespace (localized namespaces don't work on commons)
			var canontitle = img.short.replace(/^[^:]+:/, 'File:');
			titles.push({
				wiki: iwiki,
				title: img.short,
				canontitle: canontitle
				// images are always the 'latest' revision
			});
		});
		status.createStage(titles.length, 'Fetching wikitext');
		return Revisions.fetchAndWrite(
			metabook.wikis, titles, options.output, status, options.compat
		);
	};

	var writeMetabookNfoJson = function() {
		var nfo = JSON.stringify(metabook.wikis[0]); // poor man's clone
		// field names in the nfo file differ slightly =(
		nfo.base_url = nfo.baseurl;
		delete nfo.baseurl;
		// write to disk
		return when.map([
			{ filename: 'metabook.json', data: metabook },
			{ filename: 'nfo.json', data: nfo }
		], function(item) {
			if (item.filename==='nfo.json' && !options.compat) { return; }
			return P.call(fs.writeFile, fs,
						 path.join(options.output, item.filename),
						 JSON.stringify(item.data),
						 { encoding: 'utf8' });
		});
	};

	// promise to create the desired bundle!
	var createBundle = function() {
		status.createStage(0, 'Creating bundle');
		if (options.nozip) {
			// make the directory readable, then we're done.
			return P.call(fs.chmod, fs, options.output, parseInt('755', 8));
		}

		// create zip archive
		var tmpzip = options.output + '.tmp';
		var params = [ '-r', path.resolve(tmpzip), '.' ];
		if (options.storedb) {
			// don't compress sqlite3 files.  this allows them to be
			// accessed directly within the .db without extraction.
			params.unshift('-n', '.db');
		}
		var p = P.spawn('zip', params, {
			cwd: options.output
		});

		// always clean up at the end
		p = p.ensure(function() {
			try {
				rimraf.sync(options.output);
				fs.renameSync(tmpzip, options.output);
			} catch (e1) { /* ignore */ }
			try {
				rimraf.sync(tmpzip);
			} catch (e2) { /* ignore */ }
		});
		return p;
	};

	return when.resolve()
	// stage 1
		.then(function() {
			status.createStage(
				2 * (metabook.wikis.length + 1),
				'Fetching wiki configuration'
			);
		})
		.then(repairMetabook)
		.then(mkOutputDir)
		.then(fetchSiteinfo)
	// stage 2
		.then(fetchParsed)
	// stage 3
		.then(mkImageDir)
		.then(fetchImages)
	// stage 4
		.then(fetchRevisions)
		.then(writeMetabookNfoJson)
	// stage 5
		.then(createBundle)
		.then(function() {
			status.createStage(0, 'Done');
			return 0;
		}, function(err) {
			// clean up
			if (cleanUpOutput) {
				try {
					rimraf.sync(options.output);
				} catch (e) { /* ignore */ }
			}
			if (options.debug) {
				throw err;
			}
			// xxx send this error to parent process?
			console.error('Error:', err);
			return 1;
		});
};
