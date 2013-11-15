// Make parsoid API requests.
var domino = require('domino');
var fs = require('fs');
var path = require('path');
var request = require('request');
var url = require('url');

var Parsoid = module.exports = function(apiURL, log) {
	this.apiURL = apiURL;
	this.log = log; // shared logging function
};

var ParsoidResult = function(parsoid, prefix, title, text) {
	this.prefix = prefix;
	this.title = title;
	this.text = text;
	parsoid.log('Converting to DOM');
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
	if (!html) return 0;
	var m = /revision\/(\d+)$/.exec(html.getAttribute('about'));
	if (!m) return 0;
	return +(m[1]);
};

ParsoidResult.prototype.getImages = function() {
	var base = this.getBaseHref();
	var imgs = this.document.querySelectorAll([
		'figure img[resource]',
		'*[typeof="mw:Image"] img[resource]',
		'*[typeof="mw:Image/Thumb"] img[resource]'
	].join(','));
	return Array.prototype.map.call(imgs, function(img) {
		var resourceURL = url.resolve(base, img.getAttribute('resource'));
		var srcURL = url.resolve(base, img.getAttribute('src')); // thumb, etc
		return {
			resource: resourceURL,
			src: srcURL
		};
	});
};

Parsoid.prototype.fetch = function(prefix, title, callback) {
	this.log('Fetching', prefix + ':' + title, 'from Parsoid');
	// XXX: should take a revision ID, if available.

	// look-aside cache, mostly for quicker/offline dev
	try {
		var cachePath = path.join(__dirname, '..', 'cache', prefix, title);
		var cached = fs.readFileSync(cachePath, 'utf8');
		return callback(null, new ParsoidResult(this, prefix, title, cached));
	} catch (e) {
		/* no cached version, do the actual API request */
	}

	var apiURL = url.resolve(this.apiURL, prefix + '/' + title);
	request({ url: apiURL, encoding: 'utf8' }, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			return callback("Error fetching Parsoid result: " + apiURL);
		}
		callback(null, new ParsoidResult(this, prefix, title, body));
	}.bind(this));
};
