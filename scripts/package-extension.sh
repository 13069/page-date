#!/usr/bin/env bash
# Build a Chrome Web Store upload zip (extension files only, manifest at zip root).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -pe "JSON.parse(require('fs').readFileSync('$ROOT/manifest.json','utf8')).version")"
STAGE="$ROOT/dist/store-build"
OUT="$ROOT/dist/page-date-extension-v${VERSION}.zip"

rm -rf "$STAGE"
mkdir -p "$STAGE/icons"

FILES=(
  manifest.json
  background.js
  content.js
  detector.js
  extractor.js
  popup.html
  popup.js
  popup.css
  styles.css
)

for f in "${FILES[@]}"; do
  cp "$ROOT/$f" "$STAGE/$f"
done
cp "$ROOT/icons/"*.png "$STAGE/icons/"

node -e "
const fs = require('fs');
const path = process.argv[1];
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
m.short_name = m.short_name || 'PageDate';
m.host_permissions = (m.host_permissions || []).filter(
  (p) => !p.includes('localhost') && !p.includes('127.0.0.1')
);
fs.writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
" "$STAGE/manifest.json"

rm -f "$OUT"
(cd "$STAGE" && zip -r "$OUT" . -x '*.DS_Store')

echo "Created: $OUT"
echo "Files:"
(unzip -l "$OUT")
