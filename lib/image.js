var easyimage = require('easyimage');
var fs = require('fs');
var path = require('path');
var request = require('request');
var tmp = require('tmp');

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

var fetchImage = function(resourceURL, srcURL, imagedir, log, callback) {
	// evil workaround for .svgs
	if (/[.]svg$/i.test(resourceURL)) {
		// use 600px hi res
		resourceURL = srcURL.replace(/\/\d+(px-[^\/]+)$/, '/600$1');
	}
	log('Fetching image', resourceURL);
	var m = /([^\/]+)([.]\w+)?$/.exec(resourceURL);
	if (!m) { return callback("Couldn't parse filename"); }
	var name = path.join(imagedir, cleanFilename(m[1] + (m[2] || '')));
	var realURL = // link to actual image
		resourceURL.replace(/\/File:/, '/Special:Redirect/file/');
	request({ url: realURL, encoding: null }).
		on('end', function() {
			// workaround for .gifs (convert format)
			if (/[.]gif$/i.test(resourceURL)) {
				return easyimage.convert({
					src: name, dst: name+'.png'
				}, function(err, image) {
					if (err) {
						console.error('Error converting from GIF', resourceURL);
						// non-fatal, map this to null
						return callback(null, null);
					}
					callback(null, name + '.png');
				});
			}
			// map URL to the temporary file name w/ contents
			return callback(null, name);
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
			return callback(null, null);
		}).pipe( fs.createWriteStream(name) );
};

module.exports = {
	fetch: fetchImage
};
