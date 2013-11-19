# mw-bundler

A mediawiki article spider tool.

This tool grabs all the dependencies for a given set of articles and
creates a directory or zip file.  The format is documented at
https://www.mediawiki.org/wiki/PDF_rendering/Bundle_format

## Installation

Tested with node 0.10.  Probably any recent node will work.

Install the node package depdendencies with:
```
npm install
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
