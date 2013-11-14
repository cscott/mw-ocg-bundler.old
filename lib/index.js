var async = require('async');
var domino = require('domino');
var easyimage = require('easyimage');
var fs = require('fs');
var path = require('path');
var request = require('request');
var tmp = require('tmp');
var url = require('url');
var util = require('util');
tmp.setGracefulCleanup();

module.exports = {
	version: require('../package.json').version
};

module.exports.bundle = function(metabook, nfo, options) {

	var log = function() {
		if (options.verbose || options.debug) {
			console.error.apply(console, arguments);
		}
	};

	var getBaseHref = function(document) {
		var base = document.querySelector('head > base[href]');
		if (!base ) return '';
		return base.getAttribute('href').replace(/^\/\//, 'https://');
	};

	// Utilities to fetch images and create a map
	var fetchImages = function(document, callback) {
		tmp.dir({
			prefix: 'mw-bundler-',
			unsafeCleanup: !options.debug
		}, function(err, tmpdir) {
			if (err) throw err;
			var base = getBaseHref(document);
			var imgs = document.querySelectorAll([
				'figure img[resource]',
				'*[typeof="mw:Image"] img[resource]',
				'*[typeof="mw:Image/Thumb"] img[resource]'
			].join(','));
			var tasks = Object.create(null);
			Array.prototype.forEach.call(imgs, function(img) {
				var resURL = url.resolve(base, img.getAttribute('resource'));
				tasks[resURL] = function(callback) {
					// evil workaround for .svgs
					if (/[.]svg$/i.test(resURL)) {
						resURL = url.resolve(base, img.getAttribute('src')).
							replace(/\/\d+(px-[^\/]+)$/, '/600$1'); // use hi res
					}
					log('Fetching image', resURL);
					var m = /([^\/:]+)([.]\w+)$/.exec(resURL);
					var clean = function(s) {
						// make filenames TeX-safe
						return s.replace(/[^A-Za-z0-9.]+/g, '-');
					};
					tmp.tmpName({
						prefix: m ? clean(m[1]) : undefined,
						postfix: m ? clean(m[2]) : undefined,
						dir: tmpdir
					}, function(err, name) {
						if (err) throw err;
						var realURL = // link to actual image
						resURL.replace(/\/File:/, '/Special:Redirect/file/');
						request({ url: realURL, encoding: null }).
							on('end', function() {
								// workaround for .gifs (convert format)
								if (/[.]gif$/i.test(resURL)) {
									return easyimage.convert({
										src: name, dst: name+'.png'
									}, function(err, image) {
										if (err) {
											console.error('Error converting GIF',
														  resURL);
										}
										callback(null, err ? null : name + '.png');
									});
								}
								// map URL to the temporary file name w/ contents
								return callback(null, name);
							}).
							on('response', function(resp) {
								if (resp.statusCode !== 200) {
									this.emit('error');
								}
							}).
							on('error', function() {
								this.abort();
								console.error('Error fetching image', resURL);
								// non-fatal, map this url to null
								return callback(null, null);
							}).pipe( fs.createWriteStream(name) );
					});
				};
			});
			async.parallelLimit(
				tasks, PARALLEL_FETCH_LIMIT, function(err, results) {
					if (err) throw err;
					callback(results);
				});
		});
	};

	// Fetch parsoid source for this page.
	var fetchParsoid = function(prefix, title, callback) {
		log('Fetching from Parsoid');
		var apiURL = url.resolve(nfo.parsoid, prefix + '/' + title);
		request({url:apiURL, encoding:'utf8'}, function(error, response, body) {
			if (error || response.statusCode !== 200) {
				console.error("Error fetching Parsoid source:", apiURL);
				process.exit(1);
			}
			callback(body);
		});
	};

	// look-aside cache of Parsoid source, for quicker debugging
	try {
		var cachePath = path.join(__dirname, '..', 'cache', prefix, title);
		var cached = fs.readFileSync(cachePath, 'utf8');
		fetchParsoid = function(_, callback) { callback(cached); };
	} catch (e) {
		/* no cached version; ignore error */
	}

	if (0) fetchParsoid(title, function(body) {
		// parse to DOM
		log('Converting to DOM');
		var dom = domino.createDocument(body);
		// fetch all image resources
		log('Fetching images...');
		fetchImages(dom, function(imagemap) {
			// xxx create bundle
		});
	});

	//console.log(metabook);
};
