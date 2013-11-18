// Generate content of siteinfo.json
var fs = require('fs');
var nodefn = require('when/node/function');
var path = require('path');

var Api = require('./api');

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
	return nodefn.call(fs.writeFile.bind(fs),
					   path.join(outdir, filename),
					   JSON.stringify(siteinfo));
};

module.exports = {
	fetchSiteInfo: function(wikis, wiki) {
		// cache the promise so that we make only a single query
		var cacheName = '_cached_' + wiki;
		if (!this[cacheName]) {
			this[cacheName] = fetchSiteInfo(wikis, wiki);
		}
		return this[cacheName];
	},
	fetchAndWrite: function(wikis, outdir) {
		// XXX we'd need more than one output file to do interwiki books
		var wiki = 0;
		return this.fetchSiteInfo(wikis, wiki).then(function(siteinfo) {
			return writeSiteInfo(outdir, wiki, siteinfo).then(function() {
				return siteinfo;
			});
		});
	}
};
