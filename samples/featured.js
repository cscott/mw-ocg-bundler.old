#!/usr/bin/env node
require('es6-shim');
/** Generate bundles from the featured articles list. */


var program = require('commander');

var fs = require('fs');
var path = require('path');
var rimraf = require('rimraf');
var url = require('url');

var P = require('../lib/p');

program
	.version(require('../').version)
	.usage('[options]')
	.option('-f, --featured <featuredarticles.txt>',
			'Use specified list of featured articles',
			path.join(__dirname, 'featuredarticles.txt'))
	.option('-s, --skip',
			'Skip collections which already exist on disk')
	.option('-v, --verbose',
			'Print verbose progress information')
	.option('-D, --debug',
			'Turn on debugging features (eg, full stack traces on exceptions)');
program.parse(process.argv);

var articles = Object.create(null);
fs.
	readFileSync(program.featured, 'utf8').
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
	if (program.skip && fs.existsSync(path.join(__dirname, outfile))) {
		if (program.verbose) { console.log('Skipping', outfile); }
		return;
	}
	var args = [];
	if (program.debug) { args.push('-D'); }
	if (program.verbose) { args.push('-v'); }
	args = args.concat([ '--title', prefix, '-o', outfile, '-p', prefix ]).
		concat(articles[prefix]);
	console.log('mw-ocg-bundler', args.join(' '));
	return P.call(rimraf, null, path.join(__dirname, outfile)).
		then(function() { }, function() { /* ignore unlink errors */ }).
		then(function() {
			return P.spawn(path.join(__dirname, '..', 'bin', 'mw-ocg-bundler'),
						   args, { cwd: __dirname, stdio: 'inherit' });
		});
}).done();
