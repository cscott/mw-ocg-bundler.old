"use strict";
require('es6-shim'); // Map/Set/Promise support
require('prfun');

var json = require('../package.json');

var fs = require('fs');
var path = require('path');
var rimraf = require('rimraf');
var util = require('util');

var Attribution = require('./attribution');
var Authors = require('./authors');
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
var IMAGEDB_COMPAT = Image.COMPAT_FILENAMES = false;
// limit the total number of redirects we are willing to follow
var MAX_REDIRECTS = 5;

module.exports = {
	name: json.name, // package name
	version: json.version // version # for this package
};

// Allow access to the metabook creation/repair functions
module.exports.metabook = Metabook;

// Returns a promise to create the given bundle, which resolves with no
// value when the bundle is created successfully.
// The promise is rejected (with an object containing a non-zero `exitCode`
// property) if there is a problem creating the bundle.
module.exports.bundle = function(metabook, options) {
	var stages = 5;
	if (options.compat) { stages += 1; /* fetchRevisions */ }
	var status = options.status = new StatusReporter(stages, function(msg) {
		if (options.log) {
			var file = msg.file ? (': ' + msg.file) : '';
			options.log('['+msg.percent.toFixed()+'%]', msg.message + file);
		}
	});

	var parsoid = new Parsoid(metabook.wikis);
	var authors = new Authors(metabook.wikis);
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

	var parsoidDb, authorsDb, imageDb, htmlDb;
	var openDatabases = function() {
		parsoidDb = new Db(path.join(options.output, "parsoid.db"));
		authorsDb = new Db(path.join(options.output, "authors.db"));
		imageDb = new Db(path.join(options.output, "imageinfo.db"));
		htmlDb = options.compat ? new Db(path.join(options.output, "html.db")) : null;
	};

	var closeDatabases = function() {
		return Promise.map( [parsoidDb, authorsDb, imageDb, htmlDb], function(db) {
			if (db) {
				return db.close().catch(function(e) { /* ignore */ });
			}
		});
	};

	// promise to have written a file
	var writeFile = function (filename, contents) {
		return P.call(fs.writeFile, fs,
					  path.join(options.output, filename),
					  contents, { encoding: 'utf8' });
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
			// 4 Tasks per item, fetch parsoid, fetch php, fetch metadata, mark complete
			4 * countItems(metabook),
			'Fetching parsed articles'
		);

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
				item.about = result.getAbout(); // RDF 'about' property
				item.isVersionOf = result.getIsVersionOf(); // RDF 'isVersionOf'
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
				// TODO: these queries should probably be batched
				return authors.fetchMetadata(item.wiki, item.title, item.revision, status).then(function(result) {
					authorsDb.put(
						item.wiki ? (item.wiki + '|' + item.title) : item.title,
						JSON.stringify(result)
					);
				});
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

		// return a promise to do all these tasks
		return Promise.all(tasks);
	};

	var imagedir = path.join(options.output, 'images');

	var mkImageDir = function() {
		return P.call(fs.mkdir, fs, imagedir, parseInt('777', 8));
	};

	// returns a promise which is resolved when all images from the imageMap
	// are downloaded.
	var fetchImages = function() {
		status.createStage(2 * imageMap.size, 'Fetching media');

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
				['Artist', 'Credit', 'LicenseShortName'].forEach(function(k) {
					var md = img.imageinfo.extmetadata;
					if (md && md[k] && md[k].value) {
						metadata[k.toLowerCase()] = md[k].value;
					}
				});
				var key = IMAGEDB_COMPAT ? img.short : img.resource;
				return imageDb.put(key, metadata);
			});
			tasks.push(p);
		});

		// return a promise to do all these tasks
		return Promise.all(tasks);
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

	var writeAttribution = function() {

		return Attribution.process(
			parsoid, metabook, authorsDb, imageDb, status
		).then(function(result) {
			// Write the output
			return Promise.join(
				writeFile('attribution.html', result.rdf),
				options.compat ?
					writeFile('attribution.wt', result.wikitext) : null
			);
		});
	};

	var writeMetabookNfoJson = function() {
		// poor man's clone
		var nfo = JSON.parse(JSON.stringify(metabook.wikis[0]));
		// field names in the nfo file differ slightly =(
		nfo.base_url = nfo.baseurl;
		delete nfo.baseurl;
		// write to disk
		return Promise.join(
			writeFile('metabook.json', JSON.stringify(metabook)),
			options.compat ? writeFile('nfo.json', JSON.stringify(nfo)) : null
		);
	};

	// Promise to sync the various directories.
	// Closing a file does *not* guarantee that the file's metadata (size, etc)
	// will be flushed to its containing directory.  That can confuse
	// zip!  So let's ensure that the directories are all synced.
	var syncOutputDirs = function() {
		var syncDir = function(path) {
			return P.call(fs.open, fs, path, 'r').then(function(fd) {
				return P.call(fs.fsync, fs, fd).then(function() {
					return P.call(fs.close, fs, fd);
				});
			});
		};
		return syncDir(imagedir).then(function() {
			return syncDir(options.output);
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
		p = p.finally(function() {
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

	return Promise.resolve()
	// stage 1
		.then(function() {
			status.createStage(
				2 * (metabook.wikis.length + 1),
				'Fetching wiki configuration'
			);
		})
		.then(repairMetabook)
		.then(mkOutputDir)
		.then(openDatabases)
		.then(fetchSiteinfo)
	// stage 2
		.then(fetchParsed)
	// stage 3
		.then(mkImageDir)
		.then(fetchImages)
	// stage 4
		.then(options.compat ? fetchRevisions : function(){})
	// stage 5
		.then(writeAttribution)
		.then(writeMetabookNfoJson)
	// stage 6
		.finally(closeDatabases)
		.then(syncOutputDirs)
		.then(createBundle)
		.then(function() {
			status.createStage(0, 'Done');
			return;
		}, function(err) {
			// clean up
			if (cleanUpOutput) {
				try {
					rimraf.sync(options.output);
				} catch (e) { /* ignore */ }
			}
			// XXX use different values to distinguish failure types?
			if (!err.exitCode) {
				err.exitCode = 1;
			}
			throw err;
		});
};
