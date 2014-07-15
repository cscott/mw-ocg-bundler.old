/* global describe, it */
"use strict";
require('es6-shim');
require('prfun');

var assert = require("assert");
var fs = require('fs');
var path = require('path');

var bundler = require('../');
var P = require('../lib/p');

var IMAGESIZE = 64; // very small to keep downloads short

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
							verbose: false
						});
					}).then(function(statusCode) {
						assert.equal(statusCode, 0);
					}).finally(function() {
						try {
							fs.unlinkSync(filename + '.zip');
						} catch (e) { }
					});
			});
		});
	});
});
