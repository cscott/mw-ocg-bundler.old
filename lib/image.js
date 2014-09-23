// Fetch images and metadata about them.
"use strict";
require('es6-shim');
require('prfun');

var fs = require('fs');
var path = require('path');
var tmp = require('tmp');

var Api = require('./api');
var P = require('./p');

var rrequest = Promise.promisify(require('./retry-request'), true);

// limit the # of concurrent image requests
var IMAGE_REQUEST_LIMIT = 5;

// node 0.8 compatibility
var FINISH = /^v0\.8\./.test(process.version) ? 'close' : 'finish';

var Image = module.exports = function(wikis, log) {
	this.wikis = wikis;
	this.api = new Api(wikis, log);
	this.log = log || console.error.bind(console);
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

// Make tmp.file return a promise.
var tmpFile = Promise.promisify(tmp.file, true, tmp);

// returns a promise for the metadata for the given image
Image.prototype.fetchMetadata =
Promise.guard(IMAGE_REQUEST_LIMIT, function(img, status /* optional */) {
	if (status) {
		// we're inside the guard, so these won't come all at once
		status.report(null, img.short + ' [metadata]');
	}
	return this.api.request(img.wiki, {
		action: 'query',
		prop: 'imageinfo',
		iiprop: 'url|size|mediatype|mime|sha1|extmetadata',
		titles: img.short
	}).then(function(resp) {
		resp = resp.query.pages;
		var pageid = Object.keys(resp)[0];
		resp = resp[pageid];
		img.imagerepository = resp.imagerepository;
		img.pageid = resp.pageid;
		if (resp.missing !== undefined && !resp.imagerepository) {
			img.missing = true;
			img.imageinfo = {};
		} else if (resp.invalid !== undefined) {
			console.error("Invalid title:", resp.title);
			img.missing = true;
			img.imageinfo = {};
		} else {
			img.imageinfo = resp.imageinfo[0];
		}
		return img;
	});
});

// returns a promise for the name of the on-disk filename for the given image
// (or null, if the image couldn't be fetched)
Image.prototype.fetch =
Promise.guard(IMAGE_REQUEST_LIMIT, function(img, imagedir, status /*optional*/) {
	var maxRes = +(img.imagesize) || 1200 ;
	var log = this.log;

	var deferred = Promise.defer();
	img.filename = null;

	if (status) {
		// we're inside the guard, so these won't come all at once
		status.report(null, img.short);
	}

	var realURL = img.imageinfo.url || // link to actual image
		img.resource.replace(/\/File:/, '/Special:Redirect/file/');

	// use thumbnail if resolution is too high or filetype is wrong
	var suffix = img.short.replace(/^.*([.][^.]+)$/, '$1');
	var isVector = (img.imageinfo.mediatype === 'DRAWING' ||
				  img.imageinfo.mime === 'application/pdf');
	var isVideo = (img.imageinfo.mediatype === 'VIDEO');
	var isTooBig = (img.imageinfo.width > img.imagesize);
	var proposedName = img.short;
	if ((!isVector) && (isTooBig || isVideo) &&
		/\/\d+(px-[^\/]+)$/.test(img.src)) {
		realURL = img.src.replace(/\/\d+(px-[^\/]+)$/, '/'+maxRes+'$1');
		if (!img.src.endsWith(suffix)) {
			// fix up the suffix if we need to (thumbnail for video, etc)
			proposedName += img.src.replace(/^.*([.][^.]+)$/, '$1');
		}
	}

	// return a promise for a uniq & cleaned name, and an output stream.
	var mkOutStream = function() {
		return Promise.resolve().then(function() {
			// for greater security, by default create a randomized name.
			// only create a name based on the original filename if
			// `Image.COMPAT_FILENAMES` is set.
			if (!Image.COMPAT_FILENAMES) {
				return tmpFile({
					dir: imagedir,
					postfix: path.extname(proposedName),
					keep: true
				});
			}
			// If Image.COMPAT_FILENAMES is set, create a name based on the
			// original filename (easier debug!)
			var name = cleanFilename(proposedName);
			return P.call(fs.open, fs, path.join(imagedir, name), 'w+').then(function(fd) {
				return [path.join(imagedir, name), fd];
			}).catch(function(err) {
				// tweak cleanFilename if there was a conflict!
				// (this is possible in multiwiki collections)
				// it might also just be that the cleaned filename is too long.
				var ext = path.extname(name);
				var trimname = path.basename(name, ext).substring(0, 128);
				/* jshint unused: vars */
				return tmpFile({
					dir: imagedir,
					prefix: trimname,
					postfix: ext, // limit len
					keep: true
				});
			});
		}).spread(function(name, fd) {
			// record the filename
			img.filename = path.relative(imagedir, name);
			return fs.createWriteStream(name, { fd: fd });
		});
	};
	var fsync = function(path) {
		return P.call(fs.open, fs, path, 'r').then(function(fd) {
			return P.call(fs.fsync, fs, fd).finally(function() {
				return P.call(fs.close, fs, fd);
			});
		});
	};

	var doRequest = function(retries) {
		return rrequest({ url: realURL, encoding: null, pool: false, log: log, stream: true }).spread(function(inStream, req) {
			return mkOutStream().then(function(outStream) {
				return new Promise(function(resolve, reject) {
					outStream.on('error', reject).on(FINISH, resolve);
					inStream.on('error', reject);
					inStream.pipe(outStream);
					inStream.resume();
				});
			}).then(function() {
				var contentLength = req.response.headers['content-length'];
				if (contentLength === undefined) {
					return;
				}
				// double-check that we've got all the bits we expected
				var f = path.join(imagedir, img.filename);
				return fsync(f).then(function() {
					return fsync(imagedir);
				}).then(function() {
					return P.call(fs.stat, fs, f);
				}).then(function(st) {
					if (parseInt(contentLength, 10) !== st.size) {
						log("WARN: truncated", realURL, st.size, contentLength, img.filename);
						throw new Error(
							"Download truncated! ("+st.size+" of "+
								contentLength+" bytes)"
						);
					}
				});
			});
		}).catch(function(e) {
			// try to unlink & clean up on error
			var f = path.join(imagedir, img.filename);
			return P.call(fs.unlink, fs, f).catch(function() {
				/* ignore failure to unlink */
			}).then(function() {
				img.filename = null;
				if (retries > 0) {
					// retry request!
					return doRequest(retries - 1);
				}
				throw e;
			});
		});
	};
	return doRequest(5).then(function() {
		return img.filename;
	}).catch(function(error) {
		log('ERROR: fetching image:', realURL, error);
		// non-fatal, map this url to null
		return null;
	});
});
