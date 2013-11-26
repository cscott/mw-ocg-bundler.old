/** Create a new metabook structure, or fixup a broken/incomplete one. */
var when = require('when');

var Api = require('../lib/api');
var P = require('../lib/p');
var Siteinfo = require('../lib/siteinfo');
var status = require('../lib/status');

var DEFAULT_METABOOK = {
	type: "collection",
	title: "",
	subtitle: "",
	summary: "",
	version: 1,
	items: [],
	licenses: [ {
		mw_rights_icon: '',
		mw_rights_page: '',
		mw_rights_text: '',
		mw_rights_url: '',
		name: 'License',
		type: 'license'
	} ],
	wikis: [{
		type: "wikiconf",
		baseurl: null, // API endpoint for the wiki, filled in below
		imagesize: 1200,
		keep_tmpfiles: false,
		script_extension: ".php",
		format: "nuwiki",
		// our extra fields (filled in below)
		parsoid: undefined,
		prefix: undefined,
		// the filerepos is a link to commons, etc; it looks something like:
		filerepos: [{
			type: 'filerepo',
			name: 'local',
			displayname: 'Wikimedia Commons',
			rootUrl: "//upload.wikimedia.org/wikipedia/commons",
			local: true,
			scriptDirUrl: 'http://commons.wikimedia.org/w/api.php',
			wiki: 0 // pointer to an entry in metabook.wikis
		}]
	}]
};

var COMMONSWIKI = {
	type: "wikiconf",
	baseurl: 'http://commons.wikimedia.org/w',
	imagesize: 1200,
	keep_tmpfiles: false,
	script_extension: ".php",
	format: "nuwiki",
	// our extra fields
	parsoid: undefined,
	prefix: 'commonswiki',
	filerepos: undefined
};

var clone = function(o) {
	// poor man's clone
	return JSON.parse(JSON.stringify(o));
};

// Return a promise for a metabook object containing the given articles.
var metabookFromArticles = function(articles, options) {
	var metabook = clone(DEFAULT_METABOOK);
	metabook.wikis = [];

	// fetch siteinfo from enwiki to get (approx of) interwiki prefix mapping
	var interwikimap;
	var p = when.resolve().then(function() {
		return Siteinfo.fetch([{
			baseurl: 'http://en.wikipedia.org/w'
		}], 0, true);
	}).then(function(resp) {
		interwikimap = resp.interwikimap;
	});

	// look up prefix
	var prefixMap = new Map();
	var lookupPrefix = function(prefix) {
		// is this prefix already in the set of wikis?
		if (prefixMap.has(prefix)) {
			return prefixMap.get(prefix);
		}

		// XXX THIS IS A HACK, since prefix !== interwiki.  But we don't
		// seem to have a better way to do the reverse mapping.
		var w;
		interwikimap.forEach(function(ww) {
			if (ww.prefix === prefix || (ww.prefix + 'wiki') === prefix) {
				w = ww;
			}
		});
		if (!w) {
			throw new Error('Prefix not found: ' + prefix);
		}
		if (!w.url.endsWith('/wiki/$1')) {
			throw new Error('Can\'t make API url from: ' + w.url);
		}
		var baseurl = w.url.replace(/iki\/\$1$/, '');
		prefixMap.set(prefix, metabook.wikis.length);
		metabook.wikis.push({
			type: "wikiconf",
			baseurl: baseurl,
			imagesize: 1200,
			keep_tmpfiles: false,
			script_extension: ".php",
			format: "nuwiki",
			parsoid: options.parsoid,
			prefix: prefix,
			titleurl: w.url // temp
		});
		return prefixMap.get(prefix);
	};

	// fill in items
	return P.forEachSeq(articles, function(a) {
		var prefix = a.prefix, title = a.title;
		return when.resolve().then(function() {
			return lookupPrefix(prefix);
		}).then(function(w) {
			var url = metabook.wikis[w].titleurl.replace(/\$1/, title);

			// xxx fetch latest revision and timestamp?
			var item = {
				type: 'article',
				title: title.replace(/_/g,' '),
				content_type: 'text/x-wiki',
				url: url,
				wiki: w
			};
			metabook.items.push(item);
		});
	}, p).then(function() {
		// remove temporary titleurl info
		metabook.wikis.forEach(function(w) {
			delete w.titleurl;
		});
		// resolve to the resulting metabook object
		return metabook;
	});
};

var metabookRepair = function(metabook, options) {
	var needsCommonsWiki = false;
	var p = when.resolve();

	// promise to fetch missing 'filerepos' field in wiki config
	var fetchFileRepos = function(wiki) {
		var api = new Api(metabook.wikis);
		var w = metabook.wikis[wiki];
		var p = when.resolve();
		if (!w.filerepos) {
			w.filerepos = [];
			p = p.then(function() {
				return api.request(wiki, {
					action: 'query',
					meta: 'filerepoinfo'
				});
			}).then(function(resp) {
				resp.query.repos.forEach(function(repo) {
					repo.type = 'filerepo';
					w.filerepos.push(repo);
					// link to a wiki # in metabooks.json
					if (repo.local) {
						repo.wiki = wiki;
						return;
					}
					// xxx note that scriptDirUrl isn't (yet) part of the
					// filerepoinfo response.
					// see https://gerrit.wikimedia.org/r/96568
					if (!repo.scriptDirUrl) {
						repo.scriptDirUrl = COMMONSWIKI.baseurl;
					}
					for (var i=0; i<metabook.wikis.length; i++) {
						if (metabook.wikis[i].baseurl === repo.scriptDirUrl) {
							repo.wiki = i;
							return;
						}
					}
					// fudge a pointer to commons
					needsCommonsWiki = true;
					repo.wiki = metabook.wikis.length;
				});
			});
		}
		return p;
	};
	// add our extension fields, if missing
	p = p.then(function() {
		var pp = when.resolve();
		status.createStage(metabook.wikis.length + 1 /* commons wiki */);
		if (options.toc !== 'auto') {
			metabook.toc = !/^(no|false|off)$/i.test(options.toc);
		}
		metabook.wikis.forEach(function(w, idx) {
			status.report('Obtaining source wiki metadata', w.baseurl);
			if (!w.parsoid) {
				w.parsoid = options.parsoid;
			}
			if (!w.prefix) {
				// look up siteid in siteinfo
				pp = pp.then(function() {
					return Siteinfo.fetch(metabook.wikis, idx);
				}).then(function(resp) {
					w.prefix = resp.general.wikiid;
				});
			}
			if (!w.filerepos) {
				pp = pp.then(function() {
					return fetchFileRepos(idx);
				});
			}
		});
		return pp;
	});
	// fudge a pointer to commonswiki if needed
	p = p.then(function() {
		status.report('Loading commons metadata');
		if (needsCommonsWiki) {
			var cwiki = clone(COMMONSWIKI);
			cwiki.parsoid = options.parsoid;
			metabook.wikis.push(cwiki);
			return fetchFileRepos(metabook.wikis.length - 1);
		}
	});
	// done!
	return p.then(function() {
		return metabook;
	});
};

module.exports = {
	fromArticles: metabookFromArticles,
	repair: metabookRepair
};
