// Obtain authorship information for wiki articles.
"use strict";
require('es6-shim');
require('prfun');

var util = require('util');

var Api = require('./api');
var P = require('./p');

// limit the # of concurrent image requests
var AUTHORS_REQUEST_LIMIT = 5;

var Authors = module.exports = function(wikis, log) {
	this.wikis = wikis;
	this.api = new Api(wikis, log);
};

/**
 * Obtain the contributors list for a single article on a wiki.
 */
Authors.prototype.fetchMetadata = Promise.guard(AUTHORS_REQUEST_LIMIT,
	function(wiki, title, revid, status /* optional */)
{
	if (status) {
		status.report(null, util.format(
			'%s:%s [authors, %s]', this.wikis[wiki].prefix, title,
			revid ? ('revision ' + revid) : 'latest revision'
		));
	}

	return this.contributorsQuery(wiki, title, revid).then(function(responses) {
		var i, j, resp, pageid, numAnons = null, contributors = [];

		for (i = 0; i < responses.length; i++) {
			resp = responses[i].query.pages;
			pageid = Object.keys(resp)[0];
			resp = resp[pageid];

			if (resp.anoncontributors) {
				numAnons = resp.anoncontributors;
			}

			for (j = 0; j < resp.contributors.length; j++) {
				contributors.push(resp.contributors[j].name);
			}
		}

		if (numAnons) {
			contributors.push('ANONIPEDITS:' + numAnons);
		}
		return contributors;
	});
});

Authors.prototype.contributorsQuery = function(wiki, title, revid, responses, prevResp) {
	var request = {
		action: 'query',
		prop: 'contributors',
		continue: '',
		pclimit: 500
	};
	if (revid) {
		// we prefer to use revision.
		request.revids = revid;
	} else {
		request.titles = title;
	}

	if (prevResp) {
		request.continue = prevResp.continue.continue;
		request.pccontinue = prevResp.continue.pccontinue;
	}

	if (!responses) {
		responses = [];
	}
	return this.api.request(wiki, request).then(function(resp) {
		responses.push(resp);
		if (resp.continue) {
			return this.contributorsQuery(wiki, title, revid, responses, resp);
		}
		return responses;
	}.bind(this));
};
