'use strict';
// מופעל על ידי התוכנה ברגע שהיא נסגרת (באותו קובץ הפעלה, במצב Node): מחכה שהתוכנה תיסגר, מחליף את קובץ
// הקוד (app.asar) בחדש, ומפעיל את התוכנה מחדש אם ביקשו. לא נשען על שום דבר מתוך ה-asar, כי הוא מוחלף.
// הנתונים (תיקיית "נתוני ניהול קייטנות") לא נוגעים בהם.
// ב-Electron כל נתיב שמסתיים ב-.asar מטופל כארכיון ולא כקובץ רגיל - כאן צריך להחליף את הקובץ עצמו.
process.noAsar = true;
const fs = require('fs');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function note(log, text) {
  try { fs.appendFileSync(log, new Date().toISOString() + ' ' + text + '\n'); } catch (_) { /* היומן הוא עזר בלבד */ }
}

async function applySwap({ from, to, parentPid, exe, exeArgs = [], relaunch, log, delayMs = 500, waitTries = 120, retries = 120 }) {
  // קודם מחכים שהתוכנה תיסגר - אחרת ההחלפה יכולה להצליח בזמן שהיא עוד רצה, וההפעלה מחדש תיחסם.
  for (let i = 0; parentPid && alive(parentPid) && i < waitTries; i++) await sleep(delayMs);
  let ok = false;
  let lastErr = '';
  for (let i = 0; i < retries && !ok; i++) {
    try {
      // מעתיקים לשם זמני באותה תיקייה ואז מחליפים - כך אף פעם לא נשאר קובץ קוד חצי כתוב.
      fs.copyFileSync(from, to + '.new');
      fs.renameSync(to + '.new', to);
      ok = true;
    } catch (e) {
      lastErr = String((e && e.message) || e);
      await sleep(delayMs);
    }
  }
  if (ok) { try { fs.unlinkSync(from); } catch (_) { /* ננקה בהפעלה הבאה */ } }
  note(log, ok ? 'replace-ok' : 'replace-FAILED ' + lastErr);
  if (relaunch && exe) {
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (k === 'ELECTRON_RUN_AS_NODE' || k.startsWith('CM_')) delete env[k];
    const child = spawn(exe, exeArgs, { detached: true, stdio: 'ignore', env });
    child.on('error', (e) => note(log, 'relaunch-FAILED ' + e.message));
    child.unref();
    await sleep(300); // נותנים ל-spawn להתחיל לפני שהתהליך הזה מסתיים
  }
  return ok;
}

module.exports = { applySwap };

if (require.main === module) {
  const e = process.env;
  applySwap({ from: e.CM_FROM, to: e.CM_TO, parentPid: Number(e.CM_PARENT) || 0, exe: e.CM_EXE, relaunch: e.CM_RELAUNCH === '1', log: e.CM_LOG })
    .then(() => process.exit(0), () => process.exit(1));
}
