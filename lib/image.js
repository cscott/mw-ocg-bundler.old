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

// returns a promise for the name of the on-disk filename for the given image
// (or null, if the image couldn't be fetched)
var fetchImage = function(img, imagedir, log) {
	var shortName = img.short, resourceURL = img.resource, srcURL = img.src;
	var maxRes = img.imagesize;

	var deferred = when.defer();

	// evil workaround for .svgs
	if (/[.]svg$/i.test(resourceURL)) {
		// use 600px hi res
		resourceURL = srcURL.replace(/\/\d+(px-[^\/]+)$/, '/600$1');
	}
	log('Fetching image', shortName, resourceURL);
	var m = /([^\/]+)([.]\w+)?$/.exec(resourceURL);
	if (!m) {
		deferred.reject("Couldn't parse filename");
		return deferred.promise;
	}
	var name = path.join(imagedir, cleanFilename(m[1] + (m[2] || '')));
	var realURL = // link to actual image
		resourceURL.replace(/\/File:/, '/Special:Redirect/file/');
	request({ url: realURL, encoding: null }).
		on('end', function() {
			// workaround for .gifs (convert format)
			if (/[.]gif$/i.test(resourceURL)) {
				return easyimage.convert({
					src: name, dst: name+'.png'
				}, function(err) {
					if (err) {
						console.error('Error converting from GIF', resourceURL);
						// non-fatal, map this to null
						return deferred.resolve(null);
					}
					return deferred.resolve(name + '.png');
				});
			}
			// map URL to the temporary file name w/ contents
			return deferred.resolve(name);
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
			return deferred.resolve(null);
		}).pipe( fs.createWriteStream(name) );
	return deferred.promise;
};

module.exports = {
	fetch: guard(guard.n(IMAGE_REQUEST_LIMIT), fetchImage)
};
