/* global describe, it */
var assert = require("assert");
var fs = require('fs');
var nodefn = require("when/node/function");
var path = require('path');

var bundler = require('../');

// ensure that we don't crash on any of our sample inputs
describe("Basic crash test", function() {
	['taoism.json', 'hurricanes.json' /*, 'us.json'*/].forEach(function(name) {
		describe(name, function() {
			it('should bundle', function(done) {
				this.timeout(0);
				var filename = path.join(__dirname, '..', 'samples', name);
				return nodefn.call(fs.readFile.bind(fs), filename, 'utf8')
					.then(function(metabook) {
						metabook = JSON.parse(metabook);
						return bundler.bundle(metabook, {
							output: filename + '.zip',
							verbose: false
						});
					}).then(function(statusCode) {
						assert.equal(statusCode, 0);
					}).ensure(function() {
						try {
							fs.unlinkSync(filename + '.zip');
						} catch (e) { }
					}).done(
						function() { done(); },
						function(err) { done(err); }
					);
			});
		});
	});
});
