var fs = require('fs');
var guard = require('when/guard');
var path = require('path');
var request = require('request');
var tmp = require('tmp');
var when = require('when');

var Api = require('./api');
var P = require('./p');

// limit the # of concurrent image requests
var IMAGE_REQUEST_LIMIT = 5;

var Image = module.exports = function(wikis) {
	this.wikis = wikis;
	this.api = new Api(wikis);
};

// "Filenames are from MediaWiki with localized "File:" prefix, with
// tildes replaced with "~~" and all non-ASCII characters plus slash
// and backslash replaced with "~%d~" where %d is the Unicode
// codepoint for the character."
// Don't know how surrogate characters are handled for codepoints > 0xFFFF
var cleanFilename = function(filename) {
	return filename.replace(/[^\ -\.0-\[\]-\}]/g, function(c) {
		return (c==='~') ? '~~' : ( '~' + c.charCodeAt(0) + '~' );
	});
};

// returns a promise for the metadata for the given image
Image.prototype.fetchMetadata =
guard(guard.n(IMAGE_REQUEST_LIMIT), function(img, status /* optional */) {
	if (status) {
		// we're inside the guard, so these won't come all at once
		status.report(null, img.short + ' [metadata]');
	}
	return this.api.request(img.wiki, {
		action: 'query',
		prop: 'imageinfo',
		iiprop: 'url|size|mediatype|mime|sha1',
		titles: img.short
	}).then(function(resp) {
		resp = resp.query.pages;
		var pageid = Object.keys(resp)[0];
		resp = resp[pageid];
		img.imagerepository = resp.imagerepository;
		img.imageinfo = resp.imageinfo[0];
		img.pageid = resp.pageid;
		return img;
	});
});

// returns a promise for the name of the on-disk filename for the given image
// (or null, if the image couldn't be fetched)
Image.prototype.fetch =
guard(guard.n(IMAGE_REQUEST_LIMIT), function(img, imagedir, status /*optional*/) {
	var maxRes = +(img.imagesize) || 1200 ;

	var deferred = when.defer();
	img.filename = null;

	if (status) {
		// we're inside the guard, so these won't come all at once
		status.report(null, img.short);
	}

	// return a promise for a uniq & cleaned name, and an output stream.
	var outStream = function() {
		var name = cleanFilename(img.short);
		return when.resolve().then(function() {
			return P.call(fs.open, fs, path.join(imagedir, name), 'w+');
		}).then(function(fd) {
			return [path.join(imagedir, name), fd];
		}, function(err) {
			// tweak cleanFilename if there was a conflict!
			// (this is possible in multiwiki collections)
			// it might also just be that the cleaned filename is too long.
			var ext = path.extname(name);
			var trimname = path.basename(name, ext).substring(0, 128);
			/* jshint unused: vars */
			return P.call(tmp.file, tmp, {
				dir: imagedir,
				prefix: trimname,
				postfix: ext // limit len
			});
		}).then(function(args) {
			var name = args[0], fd = args[1];
			// record the filename
			img.filename = path.relative(imagedir, name);
			return fs.createWriteStream(name, { fd: fd });
		});
	};

	var realURL = img.imageinfo.url || // link to actual image
		img.resource.replace(/\/File:/, '/Special:Redirect/file/');

	// use thumbnail if resolution is too high
	var suffix = img.short.replace(/^.*([.][^.]+)$/, '$1');
	if ((img.imageinfo.width > img.imagesize) &&
		/\/\d+(px-[^\/]+)$/.test(img.src) &&
		img.src.endsWith(suffix)) {
		realURL = img.src.replace(/\/\d+(px-[^\/]+)$/, '/'+maxRes+'$1');
	}

	var req = request({ url: realURL, encoding: null }).
		on('end', function() {
			return deferred.resolve();
		}).
		on('response', function(resp) {
			if (resp.statusCode !== 200) {
				this.emit('error');
			}
			req.pause();
			outStream().then(function(stream) {
				req.pipe(stream);
				req.resume();
			}).done();
		}).
		on('error', function() {
			this.abort();
			console.error('Error fetching image', realURL);
			// non-fatal, map this url to null
			return deferred.resolve();
		});
	return deferred.promise.then(function() {
		return img.filename;
	});
});
