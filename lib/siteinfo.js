// Generate content of siteinfo.json
var fs = require('fs');
var nodefn = require('when/node/function');
var path = require('path');

var Api = require('./api');

var fetchSiteInfo = function(nfo) {
	var api = new Api(nfo);
	return api.request({
		action: 'query',
		meta: 'siteinfo',
		siprop: 'general|namespaces|interwikimap|namespacealiases|magicwords|rightsinfo'
	}).then(function(resp) {
		return resp.query;
	});
};

var writeSiteInfo = function(outdir, siteinfo) {
	return nodefn.call(fs.writeFile.bind(fs),
					   path.join(outdir, 'siteinfo.json'),
					   JSON.stringify(siteinfo));
};

module.exports = {
	fetchSiteInfo: function(nfo) {
		// cache the promise so that we make only a single query
		var p = fetchSiteInfo(nfo);
		this.fetchSiteInfo = function() { return p; };
		return p;
	},
	fetchAndWrite: function(nfo, outdir) {
		return this.fetchSiteInfo(nfo).then(function(siteinfo) {
			return writeSiteInfo(outdir, siteinfo).then(function() {
				return siteinfo;
			});
		});
	}
};
