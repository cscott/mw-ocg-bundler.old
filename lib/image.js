var easyimage = require('easyimage');
var fs = require('fs');
var request = require('request');
var tmp = require('tmp');

var fetchImage = function(resourceURL, srcURL, tmpdir, log, callback) {
	// evil workaround for .svgs
	if (/[.]svg$/i.test(resourceURL)) {
		// use 600px hi res
		resourceURL = srcURL.replace(/\/\d+(px-[^\/]+)$/, '/600$1');
	}
	log('Fetching image', resourceURL);
	var m = /([^\/:]+)([.]\w+)$/.exec(resourceURL);
	var clean = function(s) {
		// make filenames TeX-safe
		return s.replace(/[^A-Za-z0-9.]+/g, '-');
	};
	tmp.tmpName({
		prefix: m ? clean(m[1]) : undefined,
		postfix: m ? clean(m[2]) : undefined,
		dir: tmpdir
	}, function(err, name) {
		if (err) return callback(err);
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
							console.error('Error converting from GIF',
										  resourceURL);
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
	});
};

module.exports = {
	fetch: fetchImage
};
