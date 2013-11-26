// Make concurrency-limited parsoid API requests.
var domino = require('domino');
var fs = require('fs');
var guard = require('when/guard');
var path = require('path');
var request = require('request');
var url = require('url');
var util = require('util');
var when = require('when');

// limit the # of concurrent requests to parsoid.
var PARSOID_REQUEST_LIMIT = 5;

var Parsoid = module.exports = function(wikis) {
	this.wikis = wikis;
};

var ParsoidResult = function(parsoid, wiki, title, text) {
	this.wiki = wiki;
	this.title = title;
	this.text = text;
	this.imagesize = parsoid.wikis[wiki].imagesize;
	this.document = domino.createDocument(text);
};

ParsoidResult.prototype.getBaseHref = function() {
	var result = '';
	var base = this.document.querySelector('head > base[href]');
	if (base) {
		result = base.getAttribute('href').replace(/^\/\//, 'https://');
	}
	this.getBaseHref = function() { return result; };
	return result;
};

ParsoidResult.prototype.getRevisionId = function() {
	var html = this.document.querySelector('html[about]');
	if (!html) { return 0; }
	var m = /revision\/(\d+)$/.exec(html.getAttribute('about'));
	return m ? +(m[1]) : 0;
};

ParsoidResult.prototype.getImages = function() {
	var base = this.getBaseHref();
	var imgs = this.document.querySelectorAll([
		'figure img[resource]',
		'*[typeof="mw:Image"] img[resource]',
		'*[typeof="mw:Image/Thumb"] img[resource]'
	].join(','));
	return Array.prototype.map.call(imgs, function(img) {
		var relResourceURL = decodeURIComponent(img.getAttribute('resource'));
		var resourceURL = url.resolve(base, relResourceURL);
		var srcURL = url.resolve(base, img.getAttribute('src')); // thumb, etc
		return {
			wiki: this.wiki,
			short: relResourceURL.replace(/^.\//, ''),
			resource: resourceURL,
			src: srcURL,
			imagesize: this.imagesize
		};
	}.bind(this));
};

// We limit the number of parallel fetches allowed to be 'in flight'
Parsoid.prototype.fetch = guard(guard.n(PARSOID_REQUEST_LIMIT), function(wiki, title, revid /* optional */, status /* optional */) {
	wiki = wiki || 0;
	var prefix = this.wikis[wiki].prefix;
	if (status) {
		// this is inside the guard, so if we launch lots of fetches in
		// parallel, we won't report them all at once.
		status.report(null, util.format(
			'%s:%s [Parsoid, %s]', prefix, title,
			revid ? ('revision ' + revid) : 'latest revision'
		));
	}
	var deferred = when.defer();
	var result = deferred.promise.then(function(text) {
		return new ParsoidResult(this, wiki, title, text);
	}.bind(this));

	// look-aside cache, mostly for quicker/offline dev
	try {
		var cachePath = path.join(__dirname, '..', 'cache', prefix, title);
		if (revid) { cachePath = path.join(cachePath, ''+revid); }
		var cached = fs.readFileSync(cachePath, 'utf8');
		deferred.resolve(cached);
		return result;
	} catch (e) {
		/* no cached version, do the actual API request */
	}

	var apiURL = url.resolve(this.wikis[wiki].parsoid, prefix + '/' + title);
	if (revid) {
		apiURL += '?oldid=' + revid;
	}
	request({ url: apiURL, encoding: 'utf8' }, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			deferred.reject("Error fetching Parsoid result: " + apiURL);
		} else {
			deferred.resolve(body);
		}
	});
	return result;
});
