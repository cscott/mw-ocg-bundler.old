// Generate content of siteinfo.json
var fs = require('fs');
var path = require('path');
var when = require('when');

var Api = require('./api');
var Db = require('./db');
var P = require('./p');

var fetchSiteInfo = function(wikis, wiki) {
	var api = new Api(wikis);
	return api.request(wiki, {
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

module.exports = {
	fetch: function(wikis, wiki, nocache) {
		if (nocache) {
			return fetchSiteInfo(wikis, wiki);
		}
		// cache the promise so that we make only a single query
		var cacheName = '_cached_' + wiki;
		if (!this[cacheName]) {
			this[cacheName] = this.fetch(wikis, wiki, true);
		}
		return this[cacheName];
	},
	fetchAndWrite: function(wikis, options) {
		var outdir = options.output, status = options.status;
		var db = new Db(path.join(outdir, 'siteinfo.db'));
		return when.all(wikis.map(function(_, wiki) {
			return this.fetch(wikis, wiki).then(function(siteinfo) {
				status.report(null, wikis[wiki].prefix + ' siteinfo');
				// only write siteinfo.json for wiki 0 (backward compat)
				var p = (wiki===0 && options.compat) ?
					writeSiteInfo(outdir, wiki, siteinfo) :
					when.resolve();
				return p.then(function() {
					// write siteinfo.db, keyed on the baseURL for the wiki
					return db.put(wikis[wiki].baseurl, siteinfo);
				}).then(function() {
					return siteinfo;
				});
			});
		}.bind(this)));
	}
};
