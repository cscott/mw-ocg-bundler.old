// Generate content of revisions-1.txt
// this is a particularly grody file, so we also store this in a more
// sane manner as revisions.db.  hopefully we can deprecate the ugliness.
var fs = require('fs');
var nodefn = require('when/node/function');
var path = require('path');
var when = require('when');

var Api = require('./api');
var Db = require('./db');

var fetchOne = function(wikis, wiki, title, revid) {
	var api = new Api(wikis);
	var q = {
		action: 'query',
		prop: 'revisions',
		rvprop: 'content|ids',
		rvexpandtemplates: ''
	};
	if (revid) {
		q.revids = '' + revid;
	} else {
		q.titles = title;
		q.redirects = '';
	}
	return api.request(wiki, q).then(function(resp) {
		resp = resp.query.pages;
		var pageid = Object.keys(resp)[0];
		resp = resp[pageid];
		if ('missing' in resp) {
			// XXX should look in commons?
			console.error('Revision not found for', title);
			return null;
		}
		resp.expanded = 1;
		resp.wiki = wiki;
		return resp;
	});
};

var writeOne = function(data, outstream, db) {
	// write db record
	var revid = (data.revisions || [])[0].revid;
	if (!revid) { throw new Error("revision not found"); }
	var p = db.put(revid, data);
	// append to revisions-1.txt stream
	var s =
		"\n\f --page-- " +
		JSON.stringify({
			expanded: data.expanded,
			ns: data.ns,
			revid: data.revid,
			title: data.title,
			wiki: data.wiki // our extension
		}) +
		'\n';
	p = p.then(function() {
		return nodefn.call(outstream.write.bind(outstream), s, 'utf8');
	});
	p = p.then(function() {
		return nodefn.call(outstream.write.bind(outstream),
						   data.revisions[0]['*'], 'utf8');
	});
	return p;
};

// fetch and write revision info corresponding to the given array of titles
var fetchAndWrite = function(wikis, titles, outdir, log) {
	var revDb = new Db(path.join(outdir, 'revisions.db'));
	var revStream = fs.createWriteStream(path.join(outdir, 'revisions-1.txt'));
	var p = when.resolve();
	titles.forEach(function(t) {
		p = p.then(function() {
			log('Fetching revision info for', JSON.stringify(t));
			return fetchOne(wikis, t.wiki, t.title, t.revid);
		}).then(function(data) {
			return data===null ? null : writeOne(data, revStream, revDb);
		});
	});
	p = p.then(function() {
		return revDb.close();
	}).then(function() {
		return nodefn.call(revStream.end.bind(revStream));
	});
	return p;
};

module.exports = {
	fetchAndWrite: fetchAndWrite
};
