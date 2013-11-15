// helpers for making mediawiki api requests

var nodefn = require('when/node/function');
var querystring = require('querystring');
var request = require('request');
var url = require('url');

var Api = module.exports = function(nfo) {
	var apiBase = nfo.baseurl;
	this.apiURL = url.resolve(apiBase+'/', 'api.php');
};

// return a promise for the result of the API request.  Rejects the
// promise if the HTTP status code is not 200
Api.prototype.request = function(queryobj, nojson) {
	if (!nojson) {
		queryobj.format = 'json';
	}
	var url = this.apiURL + '?' + querystring.stringify(queryobj);
	return nodefn.call(request, { url: url, encoding: 'utf8' }).
		then(function(result) {
			var response = result[0], body = result[1];
			if (response.statusCode !== 200) {
				throw new Error('Unexpected HTTP status: ' +
								response.statusCode + ' ' + url);
			}
			return nojson ? body : JSON.parse(body);
		});
};
