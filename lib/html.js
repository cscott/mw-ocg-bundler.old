// Generate contents of html.db
var guard = require('when/guard');

var PARSER_REQUEST_LIMIT = 5;

var Api = require('./api');

var Html = module.exports = function(nfo, log) {
	this.log = log; // shared logging function
	var api = new Api(nfo);
	// limit concurrency of API requests
	this.request = guard(guard.n(PARSER_REQUEST_LIMIT), api.request.bind(api));
};

Html.prototype.fetch = function(prefix, title, revid /* optional */) {
	this.log('Fetching', revid ? ('revision '+revid+' of') : 'latest',
			 prefix + ':' + title, 'from PHP parser');
	// XXX we currently ignore prefix
	var q = {
		action: 'parse',
		redirects: ''
	};
	if (revid) {
		q.oldid = revid;
	} else {
		q.title = title;
	}
	return this.request(q).then(function(result) {
		return result.parse;
	});
};
