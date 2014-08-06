// Wrapper for the 'request' module, which makes it automatically retry
// requests.
"use strict";

var request = require('request');

var DEFAULT_TIMEOUT = 60 * 1000; /* ms */
var DEFAULT_RETRIES = 3;

var ReadableStream = require('readable-stream');
var util = require('util');

var cleanOpts = function(opts) {
	// clone the opts array, and clean up our own properties so that
	// request doesn't get confused (and so request can't scribble on
	// our properties, like it wants to do with 'callback').
	opts = util._extend({}, opts);
	opts.retries = undefined;
	opts.stream = undefined;
	return opts;
};

// doesn't support all of the request.<foo> methods yet, just the main
// function entry point and a modified API for getting a readable stream.
var RetryRequest = module.exports = function(uri, options, callback) {
	// duplicate the parameter handling of the 'request' module.
	var opts;
	if (typeof uri === 'undefined') {
		throw new Error('undefined is not a valid uri or options object.');
	}
	if ((typeof options === 'function') && !callback) {
		callback = options;
	}
	if (options && typeof options === 'object') {
		opts = util._extend({}, options);
		opts.uri = uri;
	} else if (typeof uri === 'string') {
		opts = {uri:uri};
	} else {
		opts = util._extend({}, uri);
	}
	if (callback) {
		opts.callback = callback;
	}

	// To quote the request module:
	// "People use this property instead all the time so why not just
	// support it."
	if (opts.url && !opts.uri) {
		opts.uri = opts.url;
		opts.url = undefined;
	}

	// ok, all the user options are in opts.
	// add a default timeout and munge the callback slightly.
	if (opts.timeout === undefined) {
		opts.timeout = RetryRequest.DEFAULT_TIMEOUT;
	}
	if (opts.retries === undefined) {
		opts.retries = RetryRequest.DEFAULT_RETRIES;
	}

	var req, mkrequest, n = 0, called = false, orig_cb = opts.callback;
	var ncallback = function(error, response, body) {
		if (opts.retries > 0 && (error || response.statusCode !== 200)) {
			console.error("Retrying ("+(++n)+")", opts.uri,
						  error || response.statusCode);
			opts.retries--;
			opts.timeout *= 2;
			mkrequest();
			return;
		}
		// streaming API!
		if (opts.stream) {
			// can't retry after this point :(
			if (called) { return; }
			called = true;

			if (error || response.statusCode !== 200) {
				return orig_cb.call(this, error || new Error
									("Bad status: "+response.statusCode));
			}
			var rstream = new ReadableStream();
			rstream.wrap(req);
			rstream.pause();
			return orig_cb.call(this, null, rstream,
								this.response.headers['content-length']);
		}
		// standard API.
		return orig_cb.call(this, error, response, body);
	};
	if (!opts.stream) {
		opts.callback = ncallback;
	}
	mkrequest = function() {
		req = request(cleanOpts(opts));
		if (opts.stream) {
			req.on('error', ncallback.bind());
			req.on('response', ncallback.bind(req, null));
		}
	};
	mkrequest();
	return;
};
RetryRequest.DEFAULT_TIMEOUT = DEFAULT_TIMEOUT;
RetryRequest.DEFAULT_RETRIES = DEFAULT_RETRIES;
