# mw-ocg-bundler 1.0.0 (2014-07-26)
* Add `authors.db` database using the `prop=contributors` mediawiki
  API to record article authorship information.
* Add image metadata (artist, credit, license) to image database.
* Add `attribution.html` (and optionally `attribution.wt`) to localize
  attribution credits (generated from the above two databases).
* Use random filenames for images (security improvement).
* Robustness improvements (request timeouts and retries, disable
  request pool, use `readable-stream` on node 0.8).
* Handle protocol-relative urls.
* Performance improvements (skip more unnecessary fetches when
  `--no-compat` is given, increase some request batch size).

# mw-ocg-bundler 0.2.2 (2014-01-21)
* Add --no-compat, --no-follow, and --syslog CLI options.
* Follow wiki title redirects by default.
* Improve error handling.

# mw-ocg-bundler 0.2.1 (2013-12-18)
* Bug fixes to status reporting; add --size option to CLI.

# mw-ocg-bundler 0.2.0 (2013-12-04)
* Main change is consistent binary name (mw-ocg-bundler).

# mw-ocg-bundler 0.1.0 (2013-12-03)
* Initial release.
