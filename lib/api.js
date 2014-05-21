// helpers for making mediawiki api requests
"use strict";

var nodefn = require('when/node/function');
var querystring = require('querystring');
var request = require('request');
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
	var apiURL =
		url.resolve(this.wikis[wiki].baseurl + '/', 'api.php') +
		'?' + querystring.stringify(queryobj);
	return nodefn.call(request, { url: apiURL, encoding: 'utf8' }).
		then(function(result) {
			var response = result[0], body = result[1];
			if (response.statusCode !== 200) {
				throw new Error('Unexpected HTTP status: ' +
								response.statusCode + ' ' + url);
			}
			return nojson ? body : JSON.parse(body);
		});
};
