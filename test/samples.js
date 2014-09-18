/* global describe, it */
"use strict";
require('es6-shim');
require('prfun');

var assert = require("assert");
var fs = require('fs');
var path = require('path');
var util = require('util');

var bundler = require('../');
var P = require('../lib/p');

var IMAGESIZE = 64; // very small to keep downloads short
// extra logging in travis/jenkins, ensure they don't timeout w/o output
var TRAVIS = !!(process.env.TRAVIS || process.env.ZUUL_COMMIT);

// ensure that we don't crash on any of our sample inputs
describe("Basic crash test", function() {
	['taoism.json', 'hurricanes.json', 'multiwiki.json'].forEach(function(name) {
		describe(name, function() {
			it('should bundle', function() {
				this.timeout(0);
				process.setMaxListeners(0);
				var filename = path.join(__dirname, '..', 'samples', name);
				return P.call(fs.readFile, fs, filename, 'utf8')
					.then(function(metabook) {
						metabook = JSON.parse(metabook);
						return bundler.bundle(metabook, {
							output: filename + '.zip',
							size: IMAGESIZE,
							debug: TRAVIS,
							log: function() {
								if (!TRAVIS) { return; }
								var time = new Date().toISOString().slice(11,23);
								console.log(time, util.format.apply(util, arguments));
							}
						});
					}).then(function(_) {
						// should resolve with no value
						assert.equal(_, undefined);
					}).finally(function() {
						try {
							fs.unlinkSync(filename + '.zip');
						} catch (e) { }
					});
			});
		});
	});
});
