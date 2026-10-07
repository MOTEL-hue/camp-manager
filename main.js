'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// בגרסה הניידת electron-builder מגדיר PORTABLE_EXECUTABLE_DIR, והנתונים נשמרים בתיקייה ליד הקובץ,
// כך שהם עוברים יחד איתו (למשל בדיסק-און-קי).
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR;
const DATA_DIR = process.env.CAMP_MANAGER_DATA
  || (PORTABLE_DIR ? path.join(PORTABLE_DIR, 'נתוני ניהול קייטנות') : path.join(app.getPath('userData'), 'data'));
const RELEASES_URL = 'https://github.com/MOTEL-hue/camp-manager/releases/latest';
// תיקיית נתונים מפורשת (בבדיקות) מקבלת גם פרופיל דפדפן משלה, כדי ששני מופעים לא יחסמו זה את זה.
if (process.env.CAMP_MANAGER_DATA) app.setPath('userData', path.join(process.env.CAMP_MANAGER_DATA, 'profile'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 30;

let win;

function ensureDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function loadDb() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    // קובץ פגום (למשל כיבוי באמצע שמירה): חוזרים לגיבוי האחרון שנקרא בהצלחה.
    const backups = listBackups();
    for (const b of backups) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, b), 'utf8'));
        fs.copyFileSync(DB_FILE, DB_FILE + '.corrupt-' + Date.now());
        return data;
      } catch (_) { /* ממשיכים לגיבוי הבא */ }
    }
    throw err;
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort().reverse();
}

// כתיבה לקובץ זמני ואז החלפה, כדי שכיבוי פתאומי לא ישאיר קובץ חצי כתוב.
function saveDb(data) {
  ensureDirs();
  const json = JSON.stringify(data);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, DB_FILE);
  const today = new Date().toISOString().slice(0, 10);
  const daily = path.join(BACKUP_DIR, 'backup-' + today + '.json');
  fs.writeFileSync(daily, json, 'utf8');
  for (const old of listBackups().slice(KEEP_BACKUPS)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) { /* לא קריטי */ }
  }
  return true;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'ניהול קייטנות ומכירות',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel):/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
}

// סיסמאות (Gmail, ימות המשיח) נשמרות מוצפנות בהצפנה של ווינדוס, בקובץ נפרד - לא ב-db.json,
// כדי שלא ייכנסו לקובצי גיבוי שאולי נשלחים הלאה.
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
function readSecrets() {
  try {
    const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = v.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : (v.plain || '');
    }
    return out;
  } catch (_) {
    return {};
  }
}
function writeSecrets(values) {
  ensureDirs();
  const cur = readSecrets();
  Object.assign(cur, values);
  const raw = {};
  for (const [k, v] of Object.entries(cur)) {
    if (!v) continue;
    raw[k] = safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(String(v)).toString('base64') } : { plain: String(v) };
  }
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(raw), 'utf8');
}
// לממשק מוחזר רק מה מוגדר - לא הסיסמאות עצמן.
ipcMain.handle('secrets:status', () => {
  const s = readSecrets();
  return { gmailUser: s.gmailUser || '', hasGmail: !!(s.gmailUser && s.gmailPass), yemotLine: s.yemotLine || '', hasYemot: !!(s.yemotLine && s.yemotPass),
    cloudUrl: cloudBase(s), cloudEmail: s.cloudEmail || '', cloudName: s.cloudName || '', hasCloud: !!s.cloudToken };
});
ipcMain.handle('secrets:set', (_e, values) => {
  const allowed = ['gmailUser', 'gmailPass', 'yemotLine', 'yemotPass'];
  const clean = {};
  for (const k of allowed) if (values && typeof values[k] === 'string') clean[k] = k === 'gmailPass' ? values[k].replace(/\s+/g, '') : values[k].trim();
  writeSecrets(clean);
  return true;
});

// מייל מה-Gmail של המשתמש, עם "סיסמת אפליקציה" של גוגל.
let transport = null;
function mailer() {
  const s = readSecrets();
  if (!s.gmailUser || !s.gmailPass) throw new Error('לא הוגדר חשבון Gmail (בהגדרות)');
  const key = s.gmailUser + ':' + s.gmailPass;
  if (!transport || transport.key !== key) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: s.gmailUser, pass: s.gmailPass },
      connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000 });
    transport.key = key;
    transport.from = s.gmailUser;
  }
  return transport;
}
ipcMain.handle('mail:send', async (_e, msg) => {
  try {
    const t = mailer();
    const fromName = (msg.fromName || '').replace(/["<>]/g, '');
    await t.sendMail({
      from: fromName ? `"${fromName}" <${t.from}>` : t.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })),
    });
    return { ok: true };
  } catch (err) {
    transport = null;
    const m = String(err && err.message || err);
    const friendly = /Invalid login|Username and Password not accepted|535/.test(m)
      ? 'גוגל לא קיבל את הכתובת או את סיסמת האפליקציה. בדקו שהעתקתם את 16 התווים נכון.'
      : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout/i.test(m) ? 'אין חיבור לשרת הדואר של גוגל (אינטרנט או חומת אש).' : m;
    return { ok: false, error: friendly };
  }
});

// ימות המשיח: רק הפקודות שהתוכנה צריכה, עם הטוקן מהסיסמאות המוצפנות.
const YEMOT_COMMANDS = new Set(['SendTTS', 'RunTzintuk', 'GetSession']);
ipcMain.handle('yemot:call', async (_e, command, params) => {
  if (!YEMOT_COMMANDS.has(command)) return { ok: false, error: 'פקודה לא מורשית' };
  const s = readSecrets();
  if (!s.yemotLine || !s.yemotPass) return { ok: false, error: 'לא הוגדר קו ימות המשיח (בהגדרות)' };
  const qs = new URLSearchParams(Object.assign({ token: s.yemotLine + ':' + s.yemotPass }, params || {}));
  try {
    const res = await net.fetch('https://www.call2all.co.il/ym/api/' + command + '?' + qs.toString());
    const raw = (await res.text()).trim();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = Object.fromEntries(new URLSearchParams(raw)); }
    const status = String(data.responseStatus || data.ResponseStatus || '').toUpperCase();
    if (status && status !== 'OK') {
      const msg = String(data.message || data.Message || raw);
      return { ok: false, error: /iskodesh/i.test(raw) ? 'שבת או חג - ימות המשיח לא מוציאים שיחות עכשיו.' : /token|login|pass/i.test(msg) ? 'מספר הקו או הסיסמה של ימות המשיח שגויים.' : msg, data };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: 'אין חיבור לאינטרנט: ' + String(err && err.message || err) };
  }
});

ipcMain.handle('print:pdfBuffer', async () => win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }));

// אתר הסנכרון. הטוקן נשמר מוצפן כמו הסיסמאות, והממשק לא רואה אותו.
// מרכז הקייטנות בתוך האתר הקיים (כבר מאושר בסינון), עם חשבונות נפרדים משלו.
const DEFAULT_CLOUD_URL = 'https://voice-chat-suite-rir5.onrender.com/camps';
// כתובת שנשמרה מהאתר הנפרד הקודם (שהוחלף במרכז הקייטנות) - עוברת לכתובת החדשה.
function cloudBase(s) {
  const url = s.cloudUrl && !/camp-manager-sync\.onrender\.com/.test(s.cloudUrl) ? s.cloudUrl : DEFAULT_CLOUD_URL;
  return url.replace(/\/+$/, '');
}
async function cloudFetch(method, urlPath, body, tokenOverride) {
  const s = readSecrets();
  const base = cloudBase(s);
  const token = tokenOverride !== undefined ? tokenOverride : s.cloudToken;
  try {
    const res = await net.fetch(base + urlPath, {
      method,
      headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) writeSecrets({ cloudToken: '' });
    return res.ok ? { ok: true, status: res.status, data } : { ok: false, status: res.status, error: data.error || ('שגיאה ' + res.status) };
  } catch (err) {
    return { ok: false, status: 0, offline: true, error: 'אין חיבור לאתר הסנכרון' };
  }
}
ipcMain.handle('cloud:request', (_e, method, urlPath, body) => {
  if (!/^\/api\/[\w\-/]+$/.test(String(urlPath))) return { ok: false, error: 'כתובת לא תקינה' };
  return cloudFetch(String(method || 'GET'), urlPath, body);
});
ipcMain.handle('cloud:login', async (_e, { mode, url, email, password, name }) => {
  if (url) writeSecrets({ cloudUrl: String(url).trim() });
  const r = await cloudFetch('POST', mode === 'register' ? '/api/register' : '/api/login', { email, password, name, device: require('os').hostname() }, '');
  if (r.ok) writeSecrets({ cloudToken: r.data.token, cloudEmail: r.data.user.email, cloudName: r.data.user.name || '' });
  return r.ok ? { ok: true, user: r.data.user } : r;
});
ipcMain.handle('cloud:logout', async () => {
  await cloudFetch('POST', '/api/logout');
  writeSecrets({ cloudToken: '', cloudEmail: '', cloudName: '' });
  return true;
});

ipcMain.handle('db:load', () => loadDb());
ipcMain.handle('db:save', (_e, data) => saveDb(data));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA_DIR, packaged: app.isPackaged, portable: !!PORTABLE_DIR }));
ipcMain.handle('app:openDataDir', () => shell.openPath(DATA_DIR));

ipcMain.handle('file:open', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts && opts.title,
    properties: ['openFile'],
    filters: (opts && opts.filters) || [],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const p = r.filePaths[0];
  return { name: path.basename(p), data: fs.readFileSync(p) };
});

ipcMain.handle('file:save', async (_e, { defaultName, filters, data }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: filters || [] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data));
  return r.filePath;
});

ipcMain.handle('print:pdf', async (_e, { defaultName }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  fs.writeFileSync(r.filePath, pdf);
  shell.openPath(r.filePath);
  return r.filePath;
});

ipcMain.handle('print:print', () => new Promise((resolve) => {
  win.webContents.print({ printBackground: true }, (ok) => resolve(ok));
}));

// עדכון גרסה אוטומטי מ-GitHub Releases. רק בתוכנה מותקנת; בפיתוח אין מה לעדכן.
// מצב העדכון האחרון נשמר כדי שמסך ההגדרות יוכל להציג אותו, וכל שלב נרשם ליומן בתיקיית הנתונים -
// כך אפשר לראות מה נכשל אצל המשתמש, בלי כלי פיתוח.
let updateStatus = { state: 'idle' };
function sendUpdate(state, extra) {
  updateStatus = Object.assign({ state, at: new Date().toISOString(), url: RELEASES_URL }, extra || {});
  const quiet = state === 'downloading' && (extra || {}).percent % 10 !== 0;
  if (!quiet) try {
    ensureDirs();
    const line = new Date().toISOString() + ' ' + state + ' ' + JSON.stringify(extra || {}) + '\n';
    const logFile = path.join(DATA_DIR, 'update-log.txt');
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 200000) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, line, 'utf8');
  } catch (_) { /* יומן הוא עזר בלבד */ }
  if (win && !win.isDestroyed()) win.webContents.send('update:status', updateStatus);
}
ipcMain.handle('update:status', () => updateStatus);

function errText(err) {
  return String((err && (err.message || err.code)) || err);
}

function newerVersion(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// גרסה ניידת: electron-updater לא תומך בה, ולכן מורידים לבד את קובץ ה-EXE החדש לתיקייה שליד הקובץ,
// וכשהתוכנה נסגרת סקריפט PowerShell קטן מחליף את הקובץ (מחכה שהקובץ הישן ישתחרר) ומפעיל מחדש.
// הנתונים בתיקייה שליד הקובץ לא נוגעים בהם.
function setupPortableUpdater() {
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE;
  const send = sendUpdate;
  let downloading = false;
  let ready = null; // {version, file}

  async function download(asset, version) {
    // שם בלי סיומת exe עד ההחלפה, כדי שאנטי-וירוס לא ינעל את הקובץ באמצע; ואם אי אפשר לכתוב ליד
    // התוכנה (למשל תיקייה מוגנת) - לתיקייה הזמנית של המשתמש.
    let dir = PORTABLE_DIR;
    try { fs.accessSync(dir, fs.constants.W_OK); } catch (_) { dir = app.getPath('temp'); }
    const target = path.join(dir, '.camp-manager-update-' + version + '.bin');
    if (fs.existsSync(target) && fs.statSync(target).size === asset.size) return target;
    const tmp = target + '.part';
    try { fs.unlinkSync(tmp); } catch (_) { /* אין קובץ ישן */ }
    // מנהל ההורדות של הדפדפן (כמו בכרום): עוקב אחרי הפניות, ממשיך אחרי ניתוק קצר, ומדווח התקדמות
    // מדויקת. הורדה ידנית בזרם הציגה אצל משתמש התקדמות של מאות אחוזים ולא הסתיימה.
    await new Promise((resolve, reject) => {
      const ses = win.webContents.session;
      const onWill = (_e, item) => {
        if (item.getURL() !== asset.browser_download_url && !item.getURLChain().includes(asset.browser_download_url)) return;
        ses.removeListener('will-download', onWill);
        item.setSavePath(tmp);
        let lastPct = -1;
        item.on('updated', (_ev, state) => {
          if (state === 'interrupted' && item.canResume()) { item.resume(); return; }
          const total = item.getTotalBytes() || asset.size;
          const pct = Math.min(100, Math.floor((item.getReceivedBytes() / total) * 100));
          if (pct !== lastPct) { lastPct = pct; send('downloading', { percent: pct }); }
        });
        item.once('done', (_ev, state) => (state === 'completed' ? resolve() : reject(new Error('ההורדה נעצרה (' + state + ')'))));
      };
      ses.on('will-download', onWill);
      ses.downloadURL(asset.browser_download_url);
    });
    // קובץ חסר (חיבור שנקטע) לא מחליף את התוכנה.
    const got = fs.statSync(tmp).size;
    if (got !== asset.size) { fs.unlinkSync(tmp); throw new Error(`ההורדה לא הושלמה (${got} מתוך ${asset.size} בתים)`); }
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, target); break; } catch (e) {
        if (i >= 10) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return target;
  }

  const check = async () => {
    if (!exePath) { send('error', { message: 'לא נמצא נתיב קובץ התוכנה (PORTABLE_EXECUTABLE_FILE)' }); return updateStatus; }
    if (downloading || ready) return updateStatus;
    downloading = true; // מיד, לפני כל המתנה - כדי ששתי בדיקות צמודות לא יורידו פעמיים
    send('checking');
    try {
      const res = await net.fetch('https://api.github.com/repos/MOTEL-hue/camp-manager/releases/latest', { headers: { 'User-Agent': 'camp-manager' } });
      if (!res.ok) throw new Error('GitHub החזיר ' + res.status);
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!latest || !newerVersion(latest, app.getVersion())) { send('none', { version: app.getVersion() }); return updateStatus; }
      const asset = (rel.assets || []).find((a) => /portable.*\.exe$/i.test(a.name));
      if (!asset) { send('portable', { version: latest }); return updateStatus; }
      send('available', { version: latest });
      const file = await download(asset, latest);
      ready = { version: latest, file };
      send('ready', { version: latest });
    } catch (err) {
      send('error', { message: errText(err) });
    } finally {
      downloading = false;
    }
    return updateStatus;
  };

  function applyOnExit(relaunch) {
    if (!ready || !exePath) return;
    const script = [
      '$n = $env:CM_NEW; $o = $env:CM_OLD',
      'for ($i = 0; $i -lt 240; $i++) {',
      '  try { Move-Item -LiteralPath $n -Destination $o -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 }',
      '}',
      'if ($env:CM_RELAUNCH -eq "1") { Start-Process -FilePath $o }',
      'if (Test-Path -LiteralPath $n) { $r = "replace-FAILED" } else { $r = "replace-ok" }',
      'Add-Content -LiteralPath $env:CM_LOG -Value ((Get-Date).ToString("s") + " " + $r)',
    ].join('\n');
    const env = Object.assign({}, process.env, { CM_NEW: ready.file, CM_OLD: exePath, CM_RELAUNCH: relaunch ? '1' : '0', CM_LOG: path.join(DATA_DIR, 'update-log.txt') });
    sendUpdate('applying', { from: ready.file, to: exePath });
    // משתני הגרסה הניידת שייכים לתהליך הנוכחי; המופע החדש יקבל משלו.
    delete env.PORTABLE_EXECUTABLE_DIR;
    delete env.PORTABLE_EXECUTABLE_FILE;
    delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
    const child = require('child_process').spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script],
      { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.on('error', (err) => sendUpdate('error', { message: 'החלפת הקובץ נכשלה: ' + errText(err) }));
    child.unref();
    ready = null;
  }

  // קובץ עדכון שנשאר ליד התוכנה: אם הוא ישן או זהה לגרסה הנוכחית - ההחלפה הצליחה, מוחקים אותו.
  // אם הוא חדש יותר - ההחלפה בפעם הקודמת נכשלה, ומנסים שוב בסגירה הבאה.
  for (const dir of [PORTABLE_DIR, app.getPath('temp')]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      const m = /^\.camp-manager-update-(\d+\.\d+\.\d+)\.(bin|exe)(\.part)?$/.exec(name);
      if (!m) continue;
      const file = path.join(dir, name);
      if (!m[3] && newerVersion(m[1], app.getVersion())) {
        ready = { version: m[1], file };
        setTimeout(() => sendUpdate('ready', { version: m[1], retry: true }), 3000);
      } else {
        try { fs.unlinkSync(file); } catch (_) { /* ננסה בפעם הבאה */ }
      }
    }
  }

  app.on('will-quit', () => applyOnExit(false));
  ipcMain.handle('update:install', () => { applyOnExit(true); app.quit(); });
  ipcMain.handle('update:check', check);
  setTimeout(check, 5000);
  setInterval(check, 2 * 60 * 60 * 1000);
}

function setupUpdater() {
  if (!app.isPackaged) return;
  if (PORTABLE_DIR) return setupPortableUpdater();
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (_) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = sendUpdate;
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (i) => send('available', { version: i.version }));
  autoUpdater.on('update-not-available', () => send('none', { version: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => send('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('ready', { version: i.version }));
  autoUpdater.on('error', (err) => send('error', { message: errText(err) }));
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  ipcMain.handle('update:check', async () => { await autoUpdater.checkForUpdates().catch(() => null); return updateStatus; });
  // בלי אינטרנט הבדיקה פשוט נכשלת בשקט, ומנסים שוב כל שעתיים.
  const check = () => autoUpdater.checkForUpdates().catch(() => null);
  setTimeout(check, 5000);
  setInterval(check, 2 * 60 * 60 * 1000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    setupUpdater();
  });
  app.on('window-all-closed', () => app.quit());
}
