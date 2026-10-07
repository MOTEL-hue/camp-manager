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
  const send = (state, extra) => win && win.webContents.send('update:status', Object.assign({ state }, extra || {}));
  let downloading = false;
  let ready = null; // {version, file}

  async function download(asset, version) {
    const target = path.join(PORTABLE_DIR, '.camp-manager-update-' + version + '.exe');
    if (fs.existsSync(target) && fs.statSync(target).size === asset.size) return target;
    const res = await net.fetch(asset.browser_download_url);
    if (!res.ok || !res.body) throw new Error('הורדה נכשלה: ' + res.status);
    const tmp = target + '.part';
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let got = 0, lastPct = -1;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        const pct = Math.floor((got / asset.size) * 100);
        if (pct !== lastPct) { lastPct = pct; send('downloading', { percent: pct }); }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    // קובץ חסר (חיבור שנקטע) לא מחליף את התוכנה.
    if (fs.statSync(tmp).size !== asset.size) { fs.unlinkSync(tmp); throw new Error('ההורדה לא הושלמה'); }
    fs.renameSync(tmp, target);
    return target;
  }

  const check = async () => {
    if (downloading || ready || !exePath) return;
    try {
      const res = await net.fetch('https://api.github.com/repos/MOTEL-hue/camp-manager/releases/latest', { headers: { 'User-Agent': 'camp-manager' } });
      if (!res.ok) return;
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!latest || !newerVersion(latest, app.getVersion())) { send('none'); return; }
      const asset = (rel.assets || []).find((a) => /portable.*\.exe$/i.test(a.name));
      if (!asset) { send('portable', { version: latest, url: RELEASES_URL }); return; }
      downloading = true;
      send('available', { version: latest });
      const file = await download(asset, latest);
      ready = { version: latest, file };
      send('ready', { version: latest });
    } catch (err) {
      send('error', { message: String(err && err.message || err) });
    } finally {
      downloading = false;
    }
  };

  function applyOnExit(relaunch) {
    if (!ready || !exePath) return;
    const script = [
      '$n = $env:CM_NEW; $o = $env:CM_OLD',
      'for ($i = 0; $i -lt 240; $i++) {',
      '  try { Move-Item -LiteralPath $n -Destination $o -Force -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 }',
      '}',
      'if ($env:CM_RELAUNCH -eq "1") { Start-Process -FilePath $o }',
    ].join('\n');
    const env = Object.assign({}, process.env, { CM_NEW: ready.file, CM_OLD: exePath, CM_RELAUNCH: relaunch ? '1' : '0' });
    // משתני הגרסה הניידת שייכים לתהליך הנוכחי; המופע החדש יקבל משלו.
    delete env.PORTABLE_EXECUTABLE_DIR;
    delete env.PORTABLE_EXECUTABLE_FILE;
    delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
    const child = require('child_process').spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script],
      { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.unref();
    ready = null;
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
  const send = (state, extra) => win && win.webContents.send('update:status', Object.assign({ state }, extra || {}));
  autoUpdater.on('checking-for-update', () => send('checking'));
  autoUpdater.on('update-available', (i) => send('available', { version: i.version }));
  autoUpdater.on('update-not-available', () => send('none'));
  autoUpdater.on('download-progress', (p) => send('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('ready', { version: i.version }));
  autoUpdater.on('error', (err) => send('error', { message: String(err && err.message || err) }));
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => null));
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
