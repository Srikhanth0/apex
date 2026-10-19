#!/usr/bin/env bash
# Build the deployable site folder: the app's static files, the source lists, the synced log and the API.
set -euo pipefail
rm -rf _site && mkdir -p _site/data
cp index.html styles.css app.js data.js match.js intel.js sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png _site/
cp -r sources _site/sources
[ -f data/tracker.json ] && cp data/tracker.json _site/data/ || true
[ -d api ] && cp -r api _site/api || mkdir -p _site/api/v1
touch _site/.nojekyll
echo "assembled $(find _site -type f | wc -l) files"
