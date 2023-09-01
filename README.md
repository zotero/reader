# Zotero PDF/EPUB/HTML reader and annotator

## Build

Clone the repository:

```
git clone https://github.com/zotero/reader --recursive
```

With Node 18+, run the following:

```
NODE_OPTIONS=--openssl-legacy-provider npm i
NODE_OPTIONS=--openssl-legacy-provider npm run build
```

This will produce `dev`, `web` and `zotero` builds in the `build/` directory.

## Development

Run `npm start` and open http://localhost:3000/dev/reader.html.

