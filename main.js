'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');

// בגרסה הניידת electron-builder מגדיר PORTABLE_EXECUTABLE_DIR, והנתונים נשמרים בתיקייה ליד הקובץ,
// כך שהם עוברים יחד איתו (למשל בדיסק-און-קי).
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR;
const DATA_DIR = process.env.CAMP_MANAGER_DATA
  || (PORTABLE_DIR ? path.join(PORTABLE_DIR, 'נתוני ניהול קייטנות') : path.join(app.getPath('userData'), 'data'));
const RELEASES_URL = 'https://github.com/MOTEL-hue/camp-manager/releases/latest';
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
