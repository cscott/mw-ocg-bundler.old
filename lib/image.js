var easyimage = require('easyimage');
var fs = require('fs');
var guard = require('when/guard');
var path = require('path');
var request = require('request');
var when = require('when');

// limit the # of concurrent image requests
var IMAGE_REQUEST_LIMIT = 5;

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
var fetchImageMetadata = function(wikis, img, log) {
	log('Fetching image metadata', img.short);
	var api = new Api(wikis);
	return api.request(img.wiki, {
		action: 'query',
		prop: 'imageinfo',
		iiprop: 'url|size|mediatype|sha1',
		titles: img.short
	}).then(function(resp) {
		resp = resp.query.pages;
		var pageid = Object.keys(resp)[0];
		resp = resp[pageid];
		img.imagerepository = resp.imagerepository;
		img.imageinfo = resp.imageinfo;
		img.pageid = resp.pageid;
		return img;
	});
};

// returns a promise for the name of the on-disk filename for the given image
// (or null, if the image couldn't be fetched)
var fetchImage = function(img, imagedir, log) {
	var shortName = img.short, resourceURL = img.resource, srcURL = img.src;
	var maxRes = +(img.imagesize) || 1200 ;

	var deferred = when.defer();
	img.filename = null;

	// evil workaround for .svgs
	if (false && /[.]svg$/i.test(resourceURL)) {
		// use 600px hi res
		resourceURL = srcURL.replace(/\/\d+(px-[^\/]+)$/, '/'+maxRes+'$1');
	}
	log('Fetching image', shortName);
	var name = path.join(imagedir, cleanFilename(shortName));
	var realURL = // link to actual image
		resourceURL.replace(/\/File:/, '/Special:Redirect/file/');
	request({ url: realURL, encoding: null }).
		on('end', function() {
			// workaround for .gifs (convert format)
			if (false && /[.]gif$/i.test(resourceURL)) {
				return easyimage.convert({
					src: name, dst: name+'.png'
				}, function(err) {
					if (err) {
						console.error('Error converting from GIF', resourceURL);
						// non-fatal, map this to null
						return deferred.resolve();
					}
					img.filename = name + '.png';
					return deferred.resolve();
				});
			}
			// map URL to the temporary file name w/ contents
			img.filename = name;
			return deferred.resolve();
		}).
		on('response', function(resp) {
			if (resp.statusCode !== 200) {
				this.emit('error');
			}
		}).
		on('error', function() {
			this.abort();
			console.error('Error fetching image', resourceURL);
			// non-fatal, map this url to null
			return deferred.resolve();
		}).pipe( fs.createWriteStream(name) );
	return deferred.promise.then(function() {
		return img.filename;
	});
};

module.exports = {
	fetchMetadata: guard(guard.n(IMAGE_REQUEST_LIMIT), fetchImageMetadata),
	fetch: guard(guard.n(IMAGE_REQUEST_LIMIT), fetchImage)
};
