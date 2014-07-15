// Make concurrency-limited parsoid API requests.
"use strict";
require('es6-shim');
require('prfun');

var domino = require('domino');
var fs = require('fs');
var path = require('path');
var request = require('request');
var url = require('url');
var util = require('util');

var P = require('./p');

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

ParsoidResult.prototype.getRedirect = function() {
	var redirect = this.document.querySelector(
		'link[rel="mw:PageProp/redirect"][href]'
	);
	if (redirect) {
		return redirect.getAttribute('href').replace(/^.\//, '');
	}
	return null; // no redirect
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

var fetch = function(wiki, title, revid /* optional */, max_redirects /* optional */, status /* optional */) {
	wiki = wiki || 0;
	max_redirects = max_redirects || 0;
	var prefix = this.wikis[wiki].prefix;
	if (status) {
		// this is inside the guard, so if we launch lots of fetches in
		// parallel, we won't report them all at once.
		status.report(null, util.format(
			'%s:%s [Parsoid, %s]', prefix, title,
			revid ? ('revision ' + revid) : 'latest revision'
		));
	}
	var deferred = Promise.defer();
	var result = deferred.promise.then(function(text) {
		// parse the article text
		var pr = new ParsoidResult(this, wiki, title, text);
		// check for redirects
		var ntitle = pr.getRedirect();
		if (ntitle && max_redirects > 0) {
			// use unguarded version of this method, so we don't end up
			// deadlocking if max_redirects > PARSOID_REQUEST_LIMIT
			return fetch.call(this, wiki, ntitle, null, max_redirects-1, null);
		}
		return pr;
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
};

// We limit the number of parallel fetches allowed to be 'in flight'
Parsoid.prototype.fetch = Promise.guard(PARSOID_REQUEST_LIMIT, fetch);
