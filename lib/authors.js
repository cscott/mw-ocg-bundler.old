// Obtain authorship information for wiki articles.
"use strict";
var guard = require('when/guard');
var Api = require('./api');

// limit the # of concurrent image requests
var AUTHORS_REQUEST_LIMIT = 5;

var Authors = module.exports = function(wikis) {
	this.wikis = wikis;
	this.api = new Api(wikis);
};

/**
 * Obtain the contributors list for a single article on a wiki.
 */
Authors.prototype.fetchMetadata = guard(
	guard.n(AUTHORS_REQUEST_LIMIT),
	function(wiki, title, status /* optional */)
{
	if (status) {
		status.report(null, title + ' [metadata]');
	}

	return this.contributorsQuery(wiki, title, []).then(function(responses) {
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

Authors.prototype.contributorsQuery = function(wiki, title, responses, prevResp) {
	// XXX can we use revision id instead of title here?
	var request = {
		action: 'query',
		prop: 'contributors',
		titles: title,
		continue: '',
		pclimit: 5 //5000
	};

	if (prevResp) {
		request.continue = prevResp.continue.continue;
		request.pccontinue = prevResp.continue.pccontinue;
	}

	return this.api.request(wiki, request).then(function(resp) {
		responses.push(resp);
		if (resp.continue) {
			return this.contributorsQuery(wiki, title, responses, resp);
		}
		return responses;
	}.bind(this));
};
