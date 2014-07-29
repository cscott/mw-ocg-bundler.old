"use strict";
require('es6-shim'); // Map/Set/Promise support
require('prfun');

var util = require('util');

var P = require('./p');
var Siteinfo = require('./siteinfo');

/**
 * This module generates an attribution page for all pages and included images
 * in a metabook file. It works by creating a wikitext string and submitting
 * that to parsoid to get the RDF output.
 *
 * We require the following templates on the zeroth wiki in the metabook. These
 * templates come from the Collection extension i18n files so should always be
 * there, but they can be customized per wiki.
 *
 * - Coll-attribution-page
 *   It is expected that H1 elements are the page (or chapter) title and that
 *   H2 elements are section titles.
 * -- Parameter $1 -- Article attribution list
 * -- Parameter $2 -- Image attribution list
 * -- Parameter $3 -- Content license text
 *
 * - Coll-article-attribution
 * -- Parameter $1 -- Article title
 * -- Parameter $2 -- Canonical URL to article
 * -- Parameter $3 -- List of authors
 *
 * - Coll-image-attribution
 * -- Parameter $1 -- Filename of image
 * -- Parameter $2 -- Canonical URL to image
 * -- Parameter $3 -- Short name of image license
 * -- Parameter $4 -- Upload credit
 * -- Parameter $5 -- Artist credit
 *
 * - Coll-attribution-anons
 * -- Parameter $1 -- Numeric number of IP contributors
 *
 * We also require the following MediaWiki default templates for list creation:
 * - And
 * - Word-separator
 * - Comma-separator
 */

/**
 * Escape of the pipe character to an HTML entity
 * @param str
 * @returns {*|XML|string|void}
 */
var mangle = function(str) {
	var m;
	if ((m = str.match(/^{{(.*)}}$/))) {
		// They're in a template, I assume they know what they're doing
		// except for bug 64821
		return (m[1].trim() === '') ? '' : str;
	} else if ((m = str.match(/(.*)<a [^>]*href=['"]([^'"]*)['"][^>]*>([^<]*)<\/a>(.*)/i))) {
		// Fix URLs back to wikitext format, the metadata API is so helpful
		return mangle(m[1]) + '[' + m[2] + ' ' + mangle(m[3]) + ']' + mangle(m[4]);
	} else {
		return str.replace('|', '&#124;');
	}
};

/**
 * Turn a string array into a wikitext string that can be run through
 * a parser to create a localized string that looks like "<a>, <b> and <c>"
 *
 * @param {string[]} ary Items to turn into a list
 * @returns {string} Wikitext
 */
var listafy = function(ary) {
	var and = '{{int:And}}', space = '{{int:Word-separator}}', comma = '{{int:Comma-separator}}';

	if ( ary.length === 0 ) { return ''; }

	var i, str = mangle(ary[ary.length - 1]);
	for ( i = ary.length - 2; i >= 0; i-- ) {
		if ( i === ary.length - 2 ) {
			str = mangle(ary[i]) + and + space + str;
		} else {
			str = mangle(ary[i]) + comma + str;
		}
	}
	return str;
};

/**
 * Create an Attribution page for all included articles and images.
 *
 * This function will call out to the first wiki's parsoid instance
 * to render the page and it will store the result in the parsoid
 * database. It will also modify the metabook and add an 'Attribution'
 * node to the items tree.
 *
 * @param parsoid
 * @param metabook
 * @param authorsDb
 * @param imageDb
 *
 * @returns {{wikitext, rdf}} In both the wikitext and rdf output, the H1 element
 * is the document title, and the H2 elements are the document sections.
 */
module.exports.process = function (parsoid, metabook, authorsDb, imageDb, status) {
	var pages = [], images = [];

	var canonicalUrl = function(item) {
		// create a ?oldid= format URL.
		return item.isVersionOf + '?oldid=' + item.revision;
	};

	// articles; then image attribution; then calling out to parsoid
	status.createStage(3, "Creating attribution page");

	var resolveChapterContrib = function(item) {
		if (item.type === 'collection') {
			status.report(null, "chapter contributors");
		}
		if (item.type === 'article') {
			return authorsDb.get(
				item.wiki ? (item.wiki + '|' + item.title) : item.title
			).then(function(v) {
				// v will be an array of authors
				// Replace ANONIPEDITS if it exists
				v = v.map(function(author) {
					var m = /^ANONIPEDITS:(\d+)$/.exec(author);
					if (!m) { return author; }
					return '{{int:Coll-attribution-anons|' + m[1] + '}}';
				});

				pages.push(util.format(
					'{{int:Coll-article-attribution|%s|%s|%s}}',
					mangle(item.title), mangle(canonicalUrl(item)),
					listafy(v)
				));
			});
		} else {
			return P.forEachSeq(item.items || [], resolveChapterContrib);
		}
	};

	var resolveImageContribs = function() {
		status.report(null, "image contributors");
		return imageDb.forEach(function(k,v) {
			var licenseshortname = mangle(v.licenseshortname || '?'),
				credit = mangle(v.credit || '?'),
				artist = mangle(v.artist || '?');

			images.push(util.format(
				'{{int:Coll-image-attribution|%s|%s|%s|%s|%s}}',
				mangle(v.short), mangle(v.url), licenseshortname, credit, artist
			));
		}).then(function() {
			// Sort things in alphabetic order; luckily the first thing we
			// see is the filename in the images array! :)
			images.sort();
		});
	};

	var parseWikitext = function() {
		var createLiElements = function(last, current) {
			return last + '<li>' + current + '</li>\n';
		};
		var wikitext;

		// fetch all the siteinfo
		return Promise.map(metabook.wikis, function(w, index, wikis) {
			return Siteinfo.fetch(wikis, index);
		}).then(function(siteinfos) {
			// look for a wiki matching the preferred metabook.lang setting
			// so that the attributions are localized correctly.  If we can't
			// find a match, we'll use the first wiki (wiki id 0).
			var lang = metabook.lang || 'en';
			var wiki = siteinfos.findIndex(function(siteinfo) {
				var wikilang = siteinfo.general.lang || 'en';
				return (wikilang === lang);
			});
			if (wiki === -1) {
				console.error("Can't find appropriate wiki for language", lang);
				wiki = 0;
			}
			// collect the wiki rights info
			var rights = siteinfos.map(function(siteinfo) {
				var r = siteinfo.rightsinfo || {};
				if (r.url) {
					return '[' + encodeURI(r.url) + ' ' + mangle(r.text || '') + ']';
				} else {
					return mangle(r.text || '');
				}
			});
			// filter out duplicate rights
			var seen = new Set();
			rights = rights.filter(function(s) {
				if (seen.has(s)) { return false; }
				seen.add(s);
				return true;
			});
			// create a template invocation, for localization
			wikitext = util.format(
				'{{int:Coll-attribution-page|%s|%s|%s}}',
				pages.reduce(createLiElements, '<ul>\n') + '</ul>\n',
				images.reduce(createLiElements, '<ul>\n') + '</ul>\n',
				rights.reduce(createLiElements, '<ul>\n') + '</ul>\n'
			);
			// parse it!
			return parsoid.parse(
				wiki, wikitext, 'MediaWiki:Coll-attribution-page', status
			);
		}).then(function(result) {
			return {
				wikitext: wikitext,
				rdf: result.text
			};
		});
	};

	return resolveChapterContrib(metabook)
		.then(resolveImageContribs)
		.then(parseWikitext);
};
