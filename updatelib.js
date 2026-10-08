'use strict';
// עדכון הגרסה הניידת בתיקייה: במקום להוריד את כל התוכנה (100MB) מורידים רק את קוד התוכנה
// (app.asar, כמה מגה) - כל עוד רכיב הדפדפן (Electron) לא השתנה. טהור (בלי electron), נבדק ב-node,
// ומשמש גם את סקריפט הבנייה (scripts/make-update-manifest.js).
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream');

const MANIFEST_NAME = 'app-update.json';
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const MAX_ASAR_BYTES = 300 * 1024 * 1024;

const asarAssetName = (version) => `camp-manager-app-${version}.asar.gz`;
const fastZipName = (version) => `camp-manager-fast-portable-${version}.zip`;

function newerVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// הקובץ שמתפרסם עם כל גרסה: איזה Electron צריך, ומה טביעת האצבע של קוד התוכנה (לפני הדחיסה).
async function makeManifest({ version, electron, asarPath }) {
  if (!VERSION_RE.test(version)) throw new Error('מספר גרסה לא תקין: ' + version);
  const st = fs.statSync(asarPath);
  return { version, electron, asar: { name: asarAssetName(version), sha256: await sha256File(asarPath), size: st.size } };
}

function parseManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('קובץ העדכון לא תקין');
  const a = m.asar || {};
  if (!VERSION_RE.test(String(m.version))) throw new Error('גרסה לא תקינה בקובץ העדכון');
  if (!/^\d+\.\d+\.\d+/.test(String(m.electron))) throw new Error('גרסת Electron לא תקינה בקובץ העדכון');
  if (a.name !== asarAssetName(m.version)) throw new Error('שם קובץ הקוד לא תקין בקובץ העדכון');
  if (!/^[0-9a-f]{64}$/i.test(String(a.sha256))) throw new Error('טביעת אצבע לא תקינה בקובץ העדכון');
  if (!Number.isInteger(a.size) || a.size <= 0 || a.size > MAX_ASAR_BYTES) throw new Error('גודל לא תקין בקובץ העדכון');
  return { version: m.version, electron: String(m.electron), asar: { name: a.name, sha256: a.sha256.toLowerCase(), size: a.size } };
}

// כתובת ההורדה של ה-zip המלא (להורדה ידנית בדפדפן), אם קיים בגרסה.
function fastZipUrl(assets, version) {
  const zip = (assets || []).find((a) => a.name === fastZipName(version));
  return zip ? zip.browser_download_url : null;
}

// מה לעשות: 'none' (אין חדש), 'asar' (מורידים רק את הקוד), או 'full' (צריך להוריד את כל התוכנה מחדש,
// כי רכיב הדפדפן השתנה או שחסר קובץ הקוד).
function planFolderUpdate({ latest, current, electron, manifest, assets }) {
  if (!VERSION_RE.test(String(latest))) throw new Error('מספר גרסה לא תקין מ-GitHub');
  if (!newerVersion(latest, current)) return { kind: 'none' };
  const zip = (assets || []).find((a) => a.name === fastZipName(latest));
  const full = { kind: 'full', url: zip ? zip.browser_download_url : null };
  if (!manifest || manifest.version !== latest || manifest.electron !== electron) return full;
  const asset = (assets || []).find((a) => a.name === manifest.asar.name);
  return asset ? { kind: 'asar', asset } : full;
}

// פורס את הקובץ הדחוס ובודק (תוך כדי) שהתוצאה היא בדיוק הקוד שפורסם. קובץ שלא תואם נמחק.
function gunzipVerify(gzFile, outFile, { sha256, size }) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    let n = 0;
    const out = fs.createWriteStream(outFile);
    const gunzip = zlib.createGunzip();
    gunzip.on('data', (d) => {
      n += d.length;
      if (n > MAX_ASAR_BYTES) gunzip.destroy(new Error('הקובץ גדול מהצפוי'));
      h.update(d);
    });
    pipeline(fs.createReadStream(gzFile), gunzip, out, (err) => {
      const bad = err || n !== size || h.digest('hex') !== String(sha256).toLowerCase();
      if (bad) {
        try { fs.unlinkSync(outFile); } catch (_) { /* לא נוצר */ }
        return reject(err || new Error('הקוד שירד שונה מהקוד שפורסם - לא מתקינים אותו'));
      }
      resolve(outFile);
    });
  });
}

module.exports = { MANIFEST_NAME, VERSION_RE, asarAssetName, fastZipName, newerVersion, fastZipUrl, sha256File, makeManifest, parseManifest, planFolderUpdate, gunzipVerify };
