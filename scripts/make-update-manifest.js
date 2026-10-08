'use strict';
// רץ בבנייה (release.yml): מכין את הנכסים של עדכון הקוד לגרסה הניידת בתיקייה.
// שימוש: node scripts/make-update-manifest.js <גרסה> <נתיב app.asar> <תיקיית פלט>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const L = require('../updatelib');

(async () => {
  const [version, asarPath, outDir] = process.argv.slice(2);
  if (!version || !asarPath || !outDir) throw new Error('שימוש: make-update-manifest <גרסה> <app.asar> <תיקיית פלט>');
  const electron = require('electron/package.json').version;
  const manifest = await L.makeManifest({ version, electron, asarPath });
  fs.mkdirSync(outDir, { recursive: true });
  const gz = zlib.gzipSync(fs.readFileSync(asarPath), { level: 9 });
  fs.writeFileSync(path.join(outDir, manifest.asar.name), gz);
  fs.writeFileSync(path.join(outDir, L.MANIFEST_NAME), JSON.stringify(manifest, null, 2));
  console.log(`electron ${electron}, asar ${manifest.asar.size} bytes -> ${gz.length} bytes gz`);
})().catch((e) => { console.error(e); process.exit(1); });
