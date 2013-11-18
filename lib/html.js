// Generate contents of html.db
var guard = require('when/guard');

var PARSER_REQUEST_LIMIT = 5;

var Api = require('./api');

var Html = module.exports = function(wikis, log) {
	this.log = log; // shared logging function
	var api = new Api(wikis);
	// limit concurrency of API requests
	this.request = guard(guard.n(PARSER_REQUEST_LIMIT), api.request.bind(api));
};

Html.prototype.fetch = function(wiki, title, revid /* optional */) {
	wiki = wiki || 0;
	this.log('Fetching', revid ? ('revision '+revid+' of') : 'latest',
			 title, 'from PHP parser');
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
