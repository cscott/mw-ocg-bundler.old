// Generate content of siteinfo.json
"use strict";
require('es6-shim');
require('prfun');

var fs = require('fs');
var path = require('path');

var Api = require('./api');
var Db = require('./db');
var P = require('./p');

var SiteInfo = module.exports = function(wikis, log) {
	this.api = new Api(wikis, log);
	this.wikis = wikis;
	this._cache = Object.create(null);
};

SiteInfo.prototype._fetchSiteInfo = function(wiki) {
	return this.api.request(wiki, {
		action: 'query',
		meta: 'siteinfo',
		siprop: 'general|namespaces|interwikimap|namespacealiases|magicwords|rightsinfo'
	}).then(function(resp) {
		return resp.query;
	});
};

var writeSiteInfo = function(outdir, wiki, siteinfo) {
	var filename = (wiki === 0) ? 'siteinfo.json' : ('siteinfo-'+wiki+'.json');
	return P.call(
		fs.writeFile, fs,
		path.join(outdir, filename),
		JSON.stringify(siteinfo)
	);
};

SiteInfo.prototype.fetch = function(wiki, nocache) {
	if (nocache) {
		return this._fetchSiteInfo(wiki);
	}
	// cache the promise so that we make only a single query
	var cacheName = '_cached_' + wiki;
	if (!this._cache[cacheName]) {
		this._cache[cacheName] = this.fetch(wiki, true);
	}
	return this._cache[cacheName];
};

SiteInfo.prototype.fetchAndWrite = function(options) {
	var outdir = options.output, status = options.status, wikis = this.wikis;
	var db = new Db(path.join(outdir, 'siteinfo.db'));
	return Promise.all(wikis.map(function(_, wiki) {
		return this.fetch(wiki).then(function(siteinfo) {
			status.report(null, wikis[wiki].prefix + ' siteinfo');
			// only write siteinfo.json for wiki 0 (backward compat)
			var p = (wiki===0 && options.compat) ?
				writeSiteInfo(outdir, wiki, siteinfo) :
				Promise.resolve();
			return p.then(function() {
				// write siteinfo.db, keyed on the baseURL for the wiki
				return db.put(wikis[wiki].baseurl, siteinfo);
			}).then(function() {
				return siteinfo;
			});
		});
	}.bind(this)));
};

// helper function for fetching a single siteinfo (uncached)
SiteInfo.fetch = function(baseurl, log) {
	return new SiteInfo([{ baseurl: baseurl }], log).fetch(0, true);
};
