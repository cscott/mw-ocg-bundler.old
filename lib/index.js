require('es6-shim'); // Map/Set support

var fs = require('fs');
var path = require('path');
var rimraf = require('rimraf');
var when = require('when');

var P = require('./p');

// set this to true to emit deprecated file formats for better pediapress
// compatibility
var PEDIAPRESS_COMPAT = true;
// set this to true to emit bundles which are more closely compatible
// with the pediapress bundler (at the cost of poorer support for
// interwiki collections)
var IMAGEDB_COMPAT = false;

module.exports = {
	version: require('../package.json').version
};

// returns a promise to create the given bundle
module.exports.bundle = function(metabook, options) {
	var Parsoid = require('./parsoid');
	var Html = require('./html');
	var Image = require('./image');
	var Db = require('./db');
	var Revisions = require('./revisions');
	var Siteinfo = require('./siteinfo');

	var log = function() {
		if (options.verbose || options.debug) {
			console.error.apply(console, arguments);
		}
	};

	var parsoid = new Parsoid(metabook.wikis, log);
	var html = new Html(metabook.wikis, log);
	var imageloader = new Image(metabook.wikis, log);

	var sourceMap = new Map(), imageMap = new Map();

	var cleanUpOutput = false;

	var mkOutputDir = function() {
		// fail if output location is not writable
		return P.call(fs.mkdir, fs, options.output, 0700).then(function() {
			// don't clean up output dir unless this mkdir succeeded
			cleanUpOutput = true;
		});
	};

	// promise to fetch and write siteinfo
	var fetchSiteinfo = function() {
		return Siteinfo.fetchAndWrite(metabook.wikis, options.output);
	};

	// returns a promise which is resolved when the sourceMap has been
	// filled with all the parsoid sources.
	var fetchParsed = function() {
		log('Fetching parsed article contents');
		var parsoidDb = new Db(path.join(options.output, "parsoid.db"));
		var htmlDb = new Db(path.join(options.output, "html.db"));

		var tasks = [];
		// a promise to parse a single item (from parsoid & php)
		var doOneItem = function(item) {
			item.wiki = item.wiki || 0;
			return parsoid.fetch(item.wiki, item.title, item.revision)
				.then(function(result) {
					var revid = result.getRevisionId();
					if (!revid) { throw new Error("No revision ID"); }
					item.revision = '' + revid;
					sourceMap.set(revid, result);
					result.getImages().forEach(function(img) {
						imageMap.set(img.resource, img);
					});
					return parsoidDb.put(item.revision, result.text);
				}).then(function() {
					return html.fetch(item.wiki, item.title, item.revision);
				}).then(function(result) {
					return htmlDb.put(item.revision, result);
				});
		};

		// recursively visit all items in the metabook info structure
		(function visit(item) {
			if (item.type === 'article') {
				tasks.push(doOneItem(item));
			} else if (item.type === 'collection' || item.type === 'chapter') {
				item.items.forEach(visit);
			}
		})(metabook);

		// return a promise to do all these tasks, then close the parsoid db
		return when.all(tasks).then(function() {
			return parsoidDb.close();
		}).then(function() {
			return htmlDb.close();
		});
	};

	var imagedir = path.join(options.output, 'images');

	var mkImageDir = function() {
		return P.call(fs.mkdir, fs, imagedir, 0777);
	};

	// returns a promise which is resolved when all images from the imageMap
	// are downloaded.
	var fetchImages = function() {
		log('Fetching images');
		var imageDb = new Db(path.join(options.output, "imageinfo.db"));

		var tasks = [];
		imageMap.forEach(function(img) {
			var p = imageloader.fetchMetadata(img).then(function() {
				if (img.imageinfo.mediatype === 'BITMAP' ||
					img.imageinfo.mediatype === 'DRAWING') {
					return imageloader.fetch(img, imagedir);
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
			titles.push({
				wiki: iwiki,
				title: img.short
				// images are always the 'latest' revision
			});
		});
		return Revisions.fetchAndWrite(
			metabook.wikis, titles, options.output, log, PEDIAPRESS_COMPAT
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
			return P.call(fs.writeFile, fs,
						 path.join(options.output, item.filename),
						 JSON.stringify(item.data),
						 { encoding: 'utf8' });
		});
	};

	// promise to create the desired bundle!
	var createBundle = function() {
		log('Creating bundle');
		if (options.nozip) {
			// make the directory readable, then we're done.
			return P.call(fs.chmod, fs, options.output, 0755);
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
		.then(mkOutputDir)
		.then(fetchSiteinfo)
		.then(fetchParsed)
		.then(mkImageDir)
		.then(fetchImages)
		.then(fetchRevisions)
		.then(writeMetabookNfoJson)
		.then(createBundle)
		.then(function() {
			log('Done.');
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
			console.error('Error:', err);
			return 1;
		});
};
