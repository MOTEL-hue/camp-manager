'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// גרסה ניידת בתיקייה (הגרסה המהירה): תיקייה שנפרסה מקובץ zip, עם הקובץ portable.flag ליד קובץ ההפעלה.
// אין פירוק בכל פתיחה, ולכן היא נפתחת מיד. גרסה ניידת בקובץ יחיד (הישנה): electron-builder מגדיר
// PORTABLE_EXECUTABLE_DIR והיא מתפרקת בכל פתיחה. בשתיהן הנתונים נשמרים בתיקייה ליד התוכנה,
// כך שהם עוברים יחד איתה (למשל בדיסק-און-קי).
const EXE_DIR = path.dirname(process.execPath);
const FOLDER_PORTABLE = app.isPackaged && fs.existsSync(path.join(EXE_DIR, 'portable.flag'));
const LEGACY_PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR;
const PORTABLE_DIR = LEGACY_PORTABLE_DIR || (FOLDER_PORTABLE ? EXE_DIR : undefined);
const DATA_DIR = process.env.CAMP_MANAGER_DATA
  || (PORTABLE_DIR ? path.join(PORTABLE_DIR, 'נתוני ניהול קייטנות') : path.join(app.getPath('userData'), 'data'));
const RELEASES_URL = 'https://github.com/MOTEL-hue/camp-manager/releases/latest';
// כתובת בדיקת הגרסאות; בבדיקות אפשר להפנות למחשב המקומי בלבד.
const UPDATE_API = /^http:\/\/127\.0\.0\.1[:/]/.test(process.env.CAMP_UPDATE_API || '')
  ? process.env.CAMP_UPDATE_API
  : 'https://api.github.com/repos/MOTEL-hue/camp-manager/releases/latest';
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
  // החלון הראשי מציג רק את הממשק המקומי: אין מעבר לדפים אחרים (שהיו מקבלים גישה ל-window.api),
  // ובקשות הרשאה נדחות.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
}

// סיסמאות (Gmail, ימות המשיח) נשמרות מוצפנות בהצפנה של ווינדוס, בקובץ נפרד - לא ב-db.json,
// כדי שלא ייכנסו לקובצי גיבוי שאולי נשלחים הלאה.
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
// רק בהרצת פיתוח/בדיקות על לינוקס (בלי מאגר מפתחות): שמירה בלי הצפנה. בתוכנה המותקנת - אף פעם.
const DEV_PLAIN_SECRETS = !app.isPackaged && process.platform === 'linux';
function readSecrets() {
  try {
    const raw = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      // מפתח שהוצפן במחשב אחר (למשל גרסה ניידת שעברה מחשב) לא נפתח - מדלגים רק עליו.
      try {
        out[k] = v.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : (DEV_PLAIN_SECRETS && v.plain) || '';
      } catch (_) { out[k] = ''; }
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
    // בלי ההצפנה של ווינדוס לא שומרים סיסמאות בכלל (ולא בטקסט גלוי).
    if (!safeStorage.isEncryptionAvailable()) {
      if (DEV_PLAIN_SECRETS) { raw[k] = { plain: String(v) }; continue; }
      throw new Error('ההצפנה של ווינדוס לא זמינה במחשב הזה, ולכן אי אפשר לשמור סיסמאות');
    }
    raw[k] = { enc: safeStorage.encryptString(String(v)).toString('base64') };
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
  try { writeSecrets(clean); } catch (err) { return { ok: false, error: err.message }; }
  return { ok: true };
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
// כתובת אתר הסנכרון: רק https (או מחשב מקומי לבדיקות). כתובת שמשתנה מנתקת את החשבון, כדי שהטוקן
// והנתונים לא יישלחו לאתר אחר.
function setCloudUrl(url) {
  url = String(url || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch (_) { return 'כתובת האתר לא תקינה'; }
  const local = u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !local) return 'כתובת האתר חייבת להתחיל ב-https://';
  const s = readSecrets();
  if (url !== cloudBase(s)) {
    try { writeSecrets({ cloudUrl: url, cloudToken: '', cloudEmail: '', cloudName: '' }); } catch (err) { return err.message; }
  }
  return null;
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
  const bad = setCloudUrl(url);
  if (bad) return { ok: false, error: bad };
  const r = await cloudFetch('POST', mode === 'register' ? '/api/register' : '/api/login', { email, password, name, device: require('os').hostname() }, '');
  if (r.ok) {
    try { writeSecrets({ cloudToken: r.data.token, cloudEmail: r.data.user.email, cloudName: r.data.user.name || '' }); } catch (err) { return { ok: false, error: err.message }; }
  }
  return r.ok ? { ok: true, user: r.data.user } : r;
});
// כניסה עם Google או עם החשבון באתר הראשי: נפתחת בדפדפן הרגיל (Google חוסמת כניסה מחלון בתוך תוכנה,
// ולכן "הבא" לא ממשיך שם). בדפדפן מופיע קוד אימות קצר (אותו קוד מוצג בתוכנה), ואחרי שמסיימים שם - התוכנה,
// ששואלת את האתר כל כמה שניות עם סוד שרק היא מכירה, מקבלת טוקן פעם אחת. הסיסמה נשארת אצל Google / האתר.
let browserLogin = null; // {verifier, challenge, base, cancelled}
const challengeOf = (verifier) => require('crypto').createHash('sha256').update(verifier).digest('hex');
const loginCode = (challenge) => String(parseInt(challenge.slice(0, 8), 16) % 10000).padStart(4, '0');

ipcMain.handle('cloud:browser-login-start', async (_e, { url, via } = {}) => {
  const bad = setCloudUrl(url);
  if (bad) return { ok: false, error: bad };
  const base = cloudBase(readSecrets());
  const verifier = require('crypto').randomBytes(32).toString('hex');
  const challenge = challengeOf(verifier);
  browserLogin = { verifier, challenge, base, cancelled: false };
  const target = base + '/app-login?c=' + challenge + (via === 'google' ? '&via=google' : '&via=site');
  if (process.env.CAMP_MANAGER_DATA) { // בבדיקות: לא פותחים דפדפן, רושמים את הכתובת
    try { ensureDirs(); fs.writeFileSync(path.join(DATA_DIR, 'last-login-url.txt'), target); } catch (_) { /* בדיקה בלבד */ }
  } else {
    await shell.openExternal(target);
  }
  return { ok: true, code: loginCode(challenge) };
});
ipcMain.handle('cloud:browser-login-wait', async () => {
  const cur = browserLogin;
  if (!cur) return { ok: false, error: 'לא התחילה כניסה' };
  const deadline = Date.now() + 5 * 60 * 1000;
  let last = null;
  while (!cur.cancelled && Date.now() < deadline) {
    const r = await cloudFetch('POST', '/api/app-login', { verifier: cur.verifier }, '');
    if (r.ok && r.data.token) {
      browserLogin = null;
      try { writeSecrets({ cloudToken: r.data.token, cloudEmail: r.data.user.email, cloudName: r.data.user.name || '' }); } catch (err) { return { ok: false, error: err.message }; }
      return { ok: true, user: r.data.user };
    }
    last = r.ok ? null : r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  if (browserLogin === cur) browserLogin = null;
  if (cur.cancelled) return { ok: false, cancelled: true };
  return last && last.offline ? last : { ok: false, error: 'הכניסה לא הושלמה בזמן. אפשר לנסות שוב.' };
});
ipcMain.handle('cloud:browser-login-cancel', () => { if (browserLogin) browserLogin.cancelled = true; return true; });
ipcMain.handle('cloud:logout', async () => {
  await cloudFetch('POST', '/api/logout');
  writeSecrets({ cloudToken: '', cloudEmail: '', cloudName: '' });
  return true;
});

ipcMain.handle('db:load', () => loadDb());
ipcMain.handle('db:save', (_e, data) => saveDb(data));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA_DIR, packaged: app.isPackaged, portable: !!PORTABLE_DIR, folderPortable: FOLDER_PORTABLE, legacyPortable: !!LEGACY_PORTABLE_DIR, releasesUrl: RELEASES_URL }));
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
function logUpdate(text) {
  try {
    ensureDirs();
    const logFile = path.join(DATA_DIR, 'update-log.txt');
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 200000) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + text + '\n', 'utf8');
  } catch (_) { /* יומן הוא עזר בלבד */ }
}
let lastLoggedPct = -1;
function sendUpdate(state, extra) {
  updateStatus = Object.assign({ state, at: new Date().toISOString(), url: RELEASES_URL }, extra || {});
  // בהורדה נרשמת שורה רק כל 10%, כדי שהיומן לא יתמלא.
  const pct = state === 'downloading' ? Math.floor(((extra || {}).percent || 0) / 10) : -1;
  if (pct !== lastLoggedPct || state !== 'downloading') logUpdate(state + ' ' + JSON.stringify(extra || {}));
  lastLoggedPct = pct;
  if (win && !win.isDestroyed()) win.webContents.send('update:status', updateStatus);
}
ipcMain.handle('update:status', () => updateStatus);

function errText(err) {
  return String((err && (err.message || err.code)) || err);
}

const updatelib = require('./updatelib');
const { newerVersion } = updatelib;

// ---------- הורדה ובדיקה של קובצי עדכון (משותף לשתי הגרסאות הניידות) ----------
const STALL_MS = 15 * 60 * 1000;
const FIRST_BYTE_MS = 25 * 1000;

// טביעת האצבע (SHA-256) של הקובץ שירד מול זו ש-GitHub מפרסם לקובץ. בלי טביעה מ-GitHub
// (גרסאות ישנות) נשארת רק בדיקת הגודל.
async function sameAsPublished(file, asset) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest || ''));
  if (!m) { logUpdate('no digest for ' + asset.name + ' - size check only'); return true; }
  const hash = await updatelib.sha256File(file);
  if (hash.toLowerCase() !== m[1].toLowerCase()) { logUpdate('digest mismatch for ' + file); return false; }
  return true;
}

// מנהל ההורדות של הדפדפן (כמו בכרום): עוקב אחרי הפניות, ממשיך אחרי ניתוק קצר, ומדווח התקדמות
// מדויקת. הורדה ידנית בזרם הציגה אצל משתמש התקדמות של מאות אחוזים ולא הסתיימה.
function chromiumDownload(url, tmp, expectedSize) {
  return new Promise((resolve, reject) => {
    const ses = win.webContents.session;
    const onWill = (_e, item) => {
      if (item.getURL() !== url && !item.getURLChain().includes(url)) return;
      ses.removeListener('will-download', onWill);
      item.setSavePath(tmp);
      let lastMb = -1;
      let lastBytes = 0;
      let lastMove = Date.now();
      // הורדה שלא זזה רבע שעה (חיבור שנתקע, או סינון שלא משחרר את הקובץ) - מבטלים ומדווחים,
      // במקום להישאר על 0% לנצח. הבדיקה הבאה (כל שעתיים, או "בדוק עכשיו") מתחילה מחדש.
      let stalled = false;
      const watchdog = setInterval(() => {
        const got = item.getReceivedBytes();
        if (got !== lastBytes) { lastBytes = got; lastMove = Date.now(); return; }
        if (Date.now() - lastMove > STALL_MS) { stalled = true; item.cancel(); }
      }, 30 * 1000);
      item.on('updated', (_ev, state) => {
        if (state === 'interrupted') {
          logUpdate('download interrupted, canResume=' + item.canResume());
          if (item.canResume()) item.resume(); else item.cancel();
          return;
        }
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes() || expectedSize;
        const mb = Math.floor(received / (1024 * 1024));
        if (mb !== lastMb) {
          lastMb = mb;
          sendUpdate('downloading', { percent: Math.min(100, Math.floor((received / total) * 100)), received, total });
        }
      });
      item.once('done', (_ev, state) => {
        clearInterval(watchdog);
        if (state === 'completed') resolve();
        else if (stalled) reject(new Error('ההורדה נתקעה ולא התקדמה רבע שעה. ננסה שוב אוטומטית בעוד שעתיים'));
        else reject(new Error('ההורדה נעצרה (' + state + ')'));
      });
    };
    ses.on('will-download', onWill);
    ses.downloadURL(url);
  });
}

// הורדה בזרם ישיר דרך מנוע הרשת של Electron (כמו electron-updater וכמו תוכנות אחרות): ההתקדמות נראית
// בזמן אמת, בלי מנהל ההורדות של הדפדפן. נכשל (ואז עוברים לשיטה הקודמת) אם לא מתחיל להגיע מידע, אם
// מגיע יותר מדי מידע (הקובץ גדול ממה שפורסם), או בכל שגיאת רשת.
function streamDownload(url, tmp, expectedSize, extra) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    req.setHeader('User-Agent', 'camp-manager-updater');
    req.setHeader('Accept', 'application/octet-stream');
    let out = null;
    let got = 0;
    let started = false;
    let finished = false;
    let lastActivity = Date.now();
    let lastSend = 0;
    const t0 = Date.now();
    const fail = (err) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      try { req.abort(); } catch (_) { /* כבר נסגר */ }
      if (out) out.destroy();
      reject(err);
    };
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivity;
      if (!started && idle > FIRST_BYTE_MS) fail(new Error('לא התחיל להגיע מידע תוך ' + Math.round(FIRST_BYTE_MS / 1000) + ' שניות'));
      else if (idle > STALL_MS) fail(new Error('ההורדה נתקעה ולא התקדמה רבע שעה'));
      else if (!started) sendUpdate('downloading', Object.assign({ percent: 0, received: 0, total: expectedSize, waiting: Math.round((Date.now() - t0) / 1000) }, extra));
    }, 1000);
    req.on('error', fail);
    req.on('response', (res) => {
      if (res.statusCode !== 200) return fail(new Error('השרת החזיר ' + res.statusCode));
      const len = Number([].concat(res.headers['content-length'] || [])[0]);
      if (len && expectedSize && len !== expectedSize) return fail(new Error('גודל הקובץ בשרת שונה ממה שפורסם'));
      out = fs.createWriteStream(tmp);
      out.on('error', fail);
      res.on('error', fail);
      res.on('data', (chunk) => {
        started = true;
        lastActivity = Date.now();
        got += chunk.length;
        if (expectedSize && got > expectedSize) return fail(new Error('הגיע יותר מידע מגודל הקובץ שפורסם'));
        if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()); }
        if (Date.now() - lastSend > 250) {
          lastSend = Date.now();
          sendUpdate('downloading', Object.assign({ percent: Math.min(100, Math.floor((got / (expectedSize || got)) * 100)), received: got, total: expectedSize || got }, extra));
        }
      });
      res.on('end', () => {
        if (finished) return;
        out.end(() => {
          if (finished) return;
          finished = true;
          clearInterval(timer);
          sendUpdate('downloading', Object.assign({ percent: 100, received: got, total: expectedSize || got }, extra));
          resolve();
        });
      });
    });
    req.end();
  });
}

// מוריד קובץ ל-target, בודק שהוא שלם ושהוא בדיוק הקובץ שפורסם, ורק אז נותן לו את השם הסופי.
// קודם בזרם ישיר; אם נכשל - דרך מנהל ההורדות של הדפדפן (שיטה שעבדה גם ברשת מסוננת, לאט).
async function downloadVerified(asset, target, extra) {
  const tmp = target + '.part';
  try { fs.unlinkSync(tmp); } catch (_) { /* אין קובץ ישן */ }
  try {
    await streamDownload(asset.browser_download_url, tmp, asset.size, extra);
  } catch (err) {
    logUpdate('stream download failed (' + errText(err) + ') - falling back to the browser download manager');
    try { fs.unlinkSync(tmp); } catch (_) { /* לא נוצר */ }
    await chromiumDownload(asset.browser_download_url, tmp, asset.size);
  }
  // קובץ חסר (חיבור שנקטע) לא מחליף את התוכנה.
  const got = fs.statSync(tmp).size;
  if (got !== asset.size) { fs.unlinkSync(tmp); throw new Error(`ההורדה לא הושלמה (${got} מתוך ${asset.size} בתים)`); }
  if (!(await sameAsPublished(tmp, asset))) { fs.unlinkSync(tmp); throw new Error('הקובץ שירד שונה מהקובץ שפורסם - לא מתקינים אותו'); }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, target); break; } catch (e) {
      if (i >= 10) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return target;
}

async function fetchJson(url) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'camp-manager' } });
  if (!res.ok) throw new Error('GitHub החזיר ' + res.status);
  return res.json();
}

// ---------- גרסה ניידת בתיקייה (המהירה) ----------
// בודקים את קובץ העדכון הקטן (app-update.json). אם רכיב הדפדפן (Electron) לא השתנה - מורידים רק את קוד
// התוכנה (כמה מגה, דחוס), בודקים אותו מול טביעת האצבע שפורסמה, ובסגירה מחליפים את resources/app.asar.
// אם הוא השתנה - צריך להוריד את קובץ ה-zip המלא (מוצג כקישור להורדה ידנית).
function setupFolderUpdater() {
  const send = sendUpdate;
  const asarPath = path.join(EXE_DIR, 'resources', 'app.asar');
  let busy = false;
  let ready = null; // {version, file}

  const stagingDir = () => {
    try { fs.accessSync(EXE_DIR, fs.constants.W_OK); return EXE_DIR; } catch (_) { return app.getPath('temp'); }
  };
  const fileMatches = async (file, a) => {
    try { return fs.statSync(file).size === a.size && (await updatelib.sha256File(file)) === a.sha256; } catch (_) { return false; }
  };

  const check = async () => {
    if (busy || ready) return updateStatus;
    busy = true;
    send('checking');
    try {
      const rel = await fetchJson(UPDATE_API);
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!updatelib.VERSION_RE.test(latest)) throw new Error('מספר גרסה לא תקין מ-GitHub');
      if (!newerVersion(latest, app.getVersion())) { send('none', { version: app.getVersion() }); return updateStatus; }
      const mAsset = (rel.assets || []).find((a) => a.name === updatelib.MANIFEST_NAME);
      let manifest = null;
      if (mAsset) manifest = updatelib.parseManifest(await fetchJson(mAsset.browser_download_url));
      const plan = updatelib.planFolderUpdate({ latest, current: app.getVersion(), electron: process.versions.electron, manifest, assets: rel.assets });
      if (plan.kind === 'none') { send('none', { version: app.getVersion() }); return updateStatus; }
      if (plan.kind === 'full') { send('portable', { version: latest, url: plan.url || RELEASES_URL, full: true }); return updateStatus; }

      send('available', { version: latest });
      const dir = stagingDir();
      const file = path.join(dir, '.camp-manager-update-' + latest + '.bin'); // לא .asar: Electron מתייחס לשם כזה כאל ארכיון
      if (!(await fileMatches(file, manifest.asar))) {
        const gz = await downloadVerified(plan.asset, path.join(dir, '.camp-manager-update-' + latest + '.gz'), { manualUrl: updatelib.fastZipUrl(rel.assets, latest) });
        try {
          await updatelib.gunzipVerify(gz, file + '.part', manifest.asar);
          fs.renameSync(file + '.part', file);
        } finally {
          try { fs.unlinkSync(gz); } catch (_) { /* ננקה בהפעלה הבאה */ }
        }
      }
      ready = { version: latest, file };
      send('ready', { version: latest });
    } catch (err) {
      send('error', { message: errText(err) });
    } finally {
      busy = false;
    }
    return updateStatus;
  };

  // בסגירה: סקריפט קטן (באותו קובץ הפעלה, במצב Node) מחכה שהתוכנה תיסגר, מחליף את app.asar
  // ומפעיל מחדש אם ביקשו. את הסקריפט מעתיקים החוצה, כי app.asar עצמו מוחלף.
  function applyOnExit(relaunch) {
    if (!ready) return;
    const script = path.join(app.getPath('temp'), 'camp-manager-apply-update-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'apply-update.js')));
    } catch (err) {
      sendUpdate('error', { message: 'החלפת הקוד נכשלה: ' + errText(err) });
      return;
    }
    sendUpdate('applying', { from: ready.file, to: asarPath });
    const env = Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1', CM_FROM: ready.file, CM_TO: asarPath, CM_PARENT: String(process.pid),
      CM_EXE: process.execPath, CM_RELAUNCH: relaunch ? '1' : '0', CM_LOG: path.join(DATA_DIR, 'update-log.txt'),
    });
    const child = require('child_process').spawn(process.execPath, [script], { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.on('error', (err) => sendUpdate('error', { message: 'החלפת הקוד נכשלה: ' + errText(err) }));
    child.unref();
    ready = null;
  }

  // שאריות מעדכון קודם: קבצים של גרסאות שכבר הותקנו נמחקים. קובץ חדש יותר לא נסמך כאן - הבדיקה
  // מול GitHub (עוד כמה שניות) מאשרת שהוא בדיוק הקוד שפורסם, ורק אז מחליפים בו.
  for (const dir of [EXE_DIR, app.getPath('temp')]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      const m = /^\.camp-manager-update-(\d+\.\d+\.\d+)\.(gz|bin)(\.part)?$/.exec(name);
      if (!m || (!m[3] && m[2] === 'bin' && newerVersion(m[1], app.getVersion()))) continue;
      try { fs.unlinkSync(path.join(dir, name)); } catch (_) { /* ננסה בפעם הבאה */ }
    }
  }

  app.on('will-quit', () => applyOnExit(false));
  ipcMain.handle('update:install', () => { applyOnExit(true); app.quit(); });
  ipcMain.handle('update:check', check);
  setTimeout(check, 5000);
  setInterval(check, 2 * 60 * 60 * 1000);
}

// ---------- גרסה ניידת בקובץ יחיד (הישנה) ----------
// electron-updater לא תומך בה, ולכן מורידים לבד את קובץ ה-EXE החדש לתיקייה שליד הקובץ,
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
    let dir = LEGACY_PORTABLE_DIR;
    try { fs.accessSync(dir, fs.constants.W_OK); } catch (_) { dir = app.getPath('temp'); }
    const target = path.join(dir, '.camp-manager-update-' + version + '.bin');
    // קובץ שכבר ירד (למשל החלפה שנכשלה בפעם הקודמת) - רק אם הוא בדיוק הקובץ שפורסם.
    if (fs.existsSync(target) && fs.statSync(target).size === asset.size && (await sameAsPublished(target, asset))) return target;
    return downloadVerified(asset, target, { manualUrl: asset.browser_download_url });
  }

  const check = async () => {
    if (!exePath) { send('error', { message: 'לא נמצא נתיב קובץ התוכנה (PORTABLE_EXECUTABLE_FILE)' }); return updateStatus; }
    if (downloading || ready) return updateStatus;
    downloading = true; // מיד, לפני כל המתנה - כדי ששתי בדיקות צמודות לא יורידו פעמיים
    send('checking');
    try {
      const rel = await fetchJson(UPDATE_API);
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('מספר גרסה לא תקין מ-GitHub');
      if (!newerVersion(latest, app.getVersion())) { send('none', { version: app.getVersion() }); return updateStatus; }
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
  // אם הוא חדש יותר - ההחלפה בפעם הקודמת נכשלה. סומכים עליו רק אחרי שהבדיקה מול GitHub (עוד כמה
  // שניות) מאשרת שהוא בדיוק הקובץ שפורסם - לא סתם כי הוא נמצא בתיקייה.
  for (const dir of [LEGACY_PORTABLE_DIR, app.getPath('temp')]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      const m = /^\.camp-manager-update-(\d+\.\d+\.\d+)\.(bin|exe)(\.part)?$/.exec(name);
      if (!m) continue;
      const file = path.join(dir, name);
      if (!m[3] && m[2] === 'bin' && newerVersion(m[1], app.getVersion())) {
        logUpdate('pending update file found: ' + file);
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
  if (FOLDER_PORTABLE) return setupFolderUpdater();
  if (LEGACY_PORTABLE_DIR) return setupPortableUpdater();
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (_) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = sendUpdate;
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (i) => send('available', { version: i.version }));
  autoUpdater.on('update-not-available', () => send('none', { version: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => send('downloading', { percent: Math.round(p.percent), received: p.transferred, total: p.total }));
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
