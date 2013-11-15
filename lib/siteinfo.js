// Generate content of siteinfo.json
var fs = require('fs');
var nodefn = require('when/node/function');
var path = require('path');
var querystring = require('querystring');
var request = require('request');
var url = require('url');
var when = require('when');

var fetchSiteInfo = function(nfo) {
	var apiBase = nfo.baseurl;
	var apiURL = url.resolve(apiBase+'/', 'api.php?');
	var qs = {
		action: 'query',
		meta: 'siteinfo',
		siprop: 'general|namespaces|interwikimap|namespacealiases|magicwords|rightsinfo',
		format: 'json'
	};
	apiURL += querystring.stringify(qs);
	return nodefn.call(request, { url: apiURL, encoding: 'utf8' }).
		then(function(result) {
			var response = result[0], body = result[1];
			if (response.statusCode !== 200) {
				throw new Error('Unexpected HTTP status: ' +
								response.statusCode + ' ' + apiURL);
			}
			return JSON.parse(body).query;
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
