const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const U = require('../updatelib.js');
const { applySwap } = require('../apply-update.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cm-upd-'));

test('השוואת גרסאות', () => {
  assert.ok(U.newerVersion('1.10.0', '1.9.9'));
  assert.ok(!U.newerVersion('1.9.0', '1.9.0'));
  assert.ok(!U.newerVersion('1.8.9', '1.9.0'));
});

test('קובץ עדכון: יוצרים, מאמתים, ודוחים קובץ מזויף', async () => {
  const dir = tmp();
  const asar = path.join(dir, 'app.asar');
  fs.writeFileSync(asar, Buffer.from('קוד התוכנה'.repeat(1000)));
  const m = await U.makeManifest({ version: '1.9.0', electron: '44.7.0', asarPath: asar });
  assert.strictEqual(m.asar.name, 'camp-manager-app-1.9.0.asar.gz');
  assert.deepStrictEqual(U.parseManifest(JSON.parse(JSON.stringify(m))), m);
  assert.throws(() => U.parseManifest({ ...m, version: '1.9' }));
  assert.throws(() => U.parseManifest({ ...m, asar: { ...m.asar, name: '../evil.gz' } }));
  assert.throws(() => U.parseManifest({ ...m, asar: { ...m.asar, sha256: 'zz' } }));
  assert.throws(() => U.parseManifest({ ...m, asar: { ...m.asar, size: -1 } }));
});

test('פריסה ובדיקה של הקוד שירד', async () => {
  const dir = tmp();
  const raw = Buffer.from('קוד התוכנה'.repeat(1000));
  const asar = path.join(dir, 'app.asar');
  fs.writeFileSync(asar, raw);
  const m = await U.makeManifest({ version: '1.9.0', electron: '44.7.0', asarPath: asar });
  const gz = path.join(dir, 'x.gz');
  fs.writeFileSync(gz, zlib.gzipSync(raw));
  const out = path.join(dir, 'out.asar');
  await U.gunzipVerify(gz, out, m.asar);
  assert.ok(fs.readFileSync(out).equals(raw));
  // קוד שונה (אותו גודל) נדחה ונמחק
  const evil = Buffer.from(raw); evil[5] ^= 1;
  fs.writeFileSync(gz, zlib.gzipSync(evil));
  await assert.rejects(U.gunzipVerify(gz, out + '2', m.asar));
  assert.ok(!fs.existsSync(out + '2'));
  // קובץ שאינו gzip נדחה
  fs.writeFileSync(gz, 'לא דחוס');
  await assert.rejects(U.gunzipVerify(gz, out + '3', m.asar));
});

test('החלטת עדכון: קוד בלבד, הורדה מלאה, או כלום', () => {
  const m = { version: '1.9.1', electron: '44.7.0', asar: { name: 'camp-manager-app-1.9.1.asar.gz', sha256: 'a'.repeat(64), size: 10 } };
  const assets = [{ name: 'camp-manager-app-1.9.1.asar.gz', browser_download_url: 'u1' }, { name: 'camp-manager-fast-portable-1.9.1.zip', browser_download_url: 'u2' }];
  const base = { latest: '1.9.1', current: '1.9.0', electron: '44.7.0', manifest: m, assets };
  assert.strictEqual(U.planFolderUpdate(base).kind, 'asar');
  assert.strictEqual(U.planFolderUpdate({ ...base, current: '1.9.1' }).kind, 'none');
  const full = U.planFolderUpdate({ ...base, electron: '43.0.0' });
  assert.deepStrictEqual(full, { kind: 'full', url: 'u2' });
  assert.strictEqual(U.planFolderUpdate({ ...base, assets: [assets[1]] }).kind, 'full');
  assert.strictEqual(U.planFolderUpdate({ ...base, manifest: { ...m, version: '1.9.2' } }).kind, 'full');
  assert.throws(() => U.planFolderUpdate({ ...base, latest: '1.9.1/../x' }));
});

test('החלפת קובץ הקוד: מחכה שהתוכנה תיסגר, ומפעילה מחדש', async () => {
  const dir = tmp();
  const to = path.join(dir, 'app.asar');
  const from = path.join(dir, 'new.asar');
  fs.writeFileSync(to, 'ישן');
  fs.writeFileSync(from, 'חדש');
  const log = path.join(dir, 'log.txt');
  const marker = path.join(dir, 'relaunched.txt');
  // "התוכנה": תהליך שנסגר אחרי רבע שנייה
  const parent = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 300)'], { stdio: 'ignore' });
  // "הפעלה מחדש": מפעילים את node עצמו עם סקריפט קטן שרושם סימן (קובץ .cmd אי אפשר להפעיל ישירות בווינדוס)
  const relaunchScript = path.join(dir, 'relaunch.js');
  fs.writeFileSync(relaunchScript, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`);
  const t0 = Date.now();
  const ok = await applySwap({ from, to, parentPid: parent.pid, exe: process.execPath, exeArgs: [relaunchScript], relaunch: true, log, delayMs: 50 });
  assert.ok(ok);
  assert.ok(Date.now() - t0 >= 200, 'לא חיכה לסגירה');
  assert.strictEqual(fs.readFileSync(to, 'utf8'), 'חדש');
  assert.ok(!fs.existsSync(from) && !fs.existsSync(to + '.new'));
  assert.match(fs.readFileSync(log, 'utf8'), /replace-ok/);
  for (let i = 0; i < 40 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(fs.existsSync(marker), 'לא הופעלה מחדש');
});

test('החלפה שנכשלת נרשמת ולא משאירה קובץ חצי כתוב', async () => {
  const dir = tmp();
  const to = path.join(dir, 'app.asar');
  fs.mkdirSync(to); // יעד שאי אפשר להחליף
  const from = path.join(dir, 'new.asar');
  fs.writeFileSync(from, 'חדש');
  const log = path.join(dir, 'log.txt');
  const ok = await applySwap({ from, to, parentPid: 0, relaunch: false, log, delayMs: 5, retries: 3 });
  assert.ok(!ok);
  assert.match(fs.readFileSync(log, 'utf8'), /replace-FAILED/);
  assert.ok(fs.existsSync(from));
});

test('סקריפט הבנייה יוצר קובץ דחוס וקובץ עדכון תקינים', async () => {
  const dir = tmp();
  const asar = path.join(dir, 'app.asar');
  fs.writeFileSync(asar, Buffer.alloc(5000, 7));
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'make-update-manifest.js'), '1.9.0', asar, path.join(dir, 'out')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const m = U.parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'out', U.MANIFEST_NAME), 'utf8')));
  await U.gunzipVerify(path.join(dir, 'out', m.asar.name), path.join(dir, 'check.asar'), m.asar);
  assert.strictEqual(m.electron, require('electron/package.json').version);
});
