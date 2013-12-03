# mw-bundler

[![Build Status][1]][2] [![dependency status][3]][4] [![dev dependency status][5]][6]

A mediawiki article spider tool.

This tool grabs all the dependencies for a given set of articles and
creates a directory or zip file.  The format is documented at
https://www.mediawiki.org/wiki/PDF_rendering/Bundle_format

## Installation

Node version 0.8 and 0.10 are tested to work.

Install the node package depdendencies with:
```
npm install
```

Install other system dependencies.
```
apt-get install zip
```

## Running

To generate a bundle for the wikipedia article `en:United States`:
```
bin/mw-bundler -o bundle.zip --prefix en --title "United States"
```

If you have a book specification (in the form of `metabook.json` and
`nfo.json` files), use:
```
bin/mw-bundler -o bundle.zip -m metabook.json -n nfo.json
```

For other options, see:
```
bin/mw-bundler --help
```

## License

Copyright (c) 2013 C. Scott Ananian

Licensed under GPLv2.

[1]: https://travis-ci.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-bundler.png
[2]: https://travis-ci.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-bundler
[3]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-bundler.png
[4]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-bundler
[5]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-bundler/dev-status.png
[6]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-bundler#info=devDependencies
