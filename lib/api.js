// helpers for making mediawiki api requests
"use strict";
require('es6-shim');
require('prfun');

var querystring = require('querystring');
var request = Promise.promisify(require('./retry-request'), true);
var url = require('url');

var Api = module.exports = function(wikis) {
	this.wikis = wikis;
};

// return a promise for the result of the API request.  Rejects the
// promise if the HTTP status code is not 200
Api.prototype.request = function(wiki, queryobj, nojson) {
	if (!nojson) {
		queryobj.format = 'json';
	}

	var apiURL = this.wikis[wiki].baseurl;
	if (apiURL.indexOf('//') === 0) {
		// Protocol relative URL which url.resolve doesn't understand
		// Assuming http
		apiURL = 'http:' + apiURL;
	}
	apiURL = url.resolve(apiURL + '/', 'api.php') + '?' + querystring.stringify(queryobj);
	
	return request({ url: apiURL, encoding: 'utf8', pool: false }).
		spread(function(response, body) {
			if (response.statusCode !== 200) {
				throw new Error('Unexpected HTTP status: ' +
								response.statusCode + ' ' + url);
			}
			return nojson ? body : JSON.parse(body);
		});
};
