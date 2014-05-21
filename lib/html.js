// Generate contents of html.db
"use strict";
var guard = require('when/guard');
var util = require('util');

// limit the # of concurrent requests to the HTML parser
var PARSER_REQUEST_LIMIT = 5;

var Api = require('./api');

var Html = module.exports = function(wikis) {
	var api = new Api(wikis);
	// limit concurrency of API requests
	this.request = guard(guard.n(PARSER_REQUEST_LIMIT), api.request.bind(api));
	this.wikis = wikis;
};

Html.prototype.fetch = function(wiki, title, revid /* optional */, status /* optional */) {
	wiki = wiki || 0;
	if (status) {
		// this is inside the guard, so if we launch lots of fetches in
		// parallel, we won't report them all at once.
		status.report(null, util.format(
			'%s:%s [PHP, %s]', this.wikis[wiki].prefix, title,
			revid ? ('revision ' + revid) : 'latest revision'
		));
	}
	var q = {
		action: 'parse',
		redirects: ''
	};
	if (revid) {
		q.oldid = revid;
	} else {
		q.title = title;
	}
	return this.request(wiki, q).then(function(result) {
		return result.parse;
	});
};
