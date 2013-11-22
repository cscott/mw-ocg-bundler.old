#!/usr/bin/env node
require('es6-shim');
/** Generate bundles from the featured articles list. */

var fs = require('fs');
var path = require('path');
var url = require('url');

var P = require('../lib/p');

var articles = Object.create(null);
fs.
	readFileSync(path.join(__dirname,'featuredarticles.txt'), 'utf8').
	replace(/^\s+/, '').
	replace(/\s+$/, '').
	split(/[\r\n]+/).forEach(function(articleUrl) {
		var u = url.parse(articleUrl);
		var m = /^(..)[.]/.exec(u.host);
		var prefix = m[1] + 'wiki';
		if (!(prefix in articles)) { articles[prefix] = []; }
		m = /^\/wiki\/(.*)$/.exec(u.path);
		var title = decodeURIComponent(m[1]);
		articles[prefix].push(title);
	});

// now make a collection for each language
// (cross-wiki stuff will have to wait)
P.forEachSeq(Object.keys(articles), function(prefix) {
	var outfile = prefix + '.zip';
	var args = [ '-D', '-v', '-o', outfile, '-p', prefix ].
		concat(articles[prefix]);
	console.log('mw-bundler', args.join(' '));
	return P.call(fs.unlink, fs, path.join(__dirname, outfile)).
		then(function() {
			return P.spawn(path.join(__dirname, '..', 'bin', 'mw-bundler'),
						   args, { cwd: __dirname, stdio: 'inherit' });
		});
}).done();
