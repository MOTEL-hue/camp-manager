// אתר הסנכרון: חשבונות, סנכרון ושיתוף פרויקטים, ושלוחת בירור יתרה לימות המשיח.
'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const Sync = require('../renderer/sync.js');
const phone = require('./phone.js');

const TOKEN_BYTES = 32;

function hashToken(t) {
  return crypto.createHash('sha256').update(String(t)).digest('hex');
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function checkPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// הגבלת ניסיונות כניסה: מונע ניחוש סיסמאות. בזיכרון - מספיק לשרת יחיד.
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length <= max;
  };
}

function createApp(pool) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '15mb' }));

  const q = (text, params) => pool.query(text, params);
  const loginLimit = limiter(10, 15 * 60 * 1000);

  const err = (res, status, message) => res.status(status).json({ error: message });

  async function newSession(userId, label) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    await q('INSERT INTO sessions (token_hash, user_id, label) VALUES ($1, $2, $3)', [hashToken(token), userId, String(label || '').slice(0, 80)]);
    return token;
  }

  // הזמנות שחיכו לכתובת המייל הזו הופכות לחברות בפרויקט ברגע שיש חשבון.
  async function acceptInvites(user) {
    const inv = await q('SELECT id, project_id FROM invites WHERE email = $1', [user.email]);
    for (const row of inv.rows) {
      await q('INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO NOTHING', [row.project_id, user.id, 'editor']);
      await q('DELETE FROM invites WHERE id = $1', [row.id]);
    }
  }

  async function auth(req, res, next) {
    const h = String(req.get('authorization') || '');
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!token) return err(res, 401, 'צריך להתחבר');
    const r = await q('SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1', [hashToken(token)]);
    if (!r.rows.length) return err(res, 401, 'החיבור פג - צריך להתחבר מחדש');
    req.user = r.rows[0];
    req.tokenHash = hashToken(token);
    q('UPDATE sessions SET last_used = now() WHERE token_hash = $1', [req.tokenHash]).catch(() => {});
    next();
  }

  async function membership(projectId, userId) {
    const r = await q('SELECT role FROM members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    return r.rows[0] ? r.rows[0].role : null;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  // ---------- חשבונות ----------
  app.post('/api/register', wrap(async (req, res) => {
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!validEmail(email)) return err(res, 400, 'כתובת המייל לא תקינה');
    if (password.length < 8) return err(res, 400, 'הסיסמה צריכה להיות לפחות 8 תווים');
    if (!loginLimit('reg:' + req.ip)) return err(res, 429, 'יותר מדי ניסיונות, נסו שוב בעוד רבע שעה');
    const exists = await q('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length) return err(res, 409, 'כבר יש חשבון עם המייל הזה - אפשר להתחבר');
    const r = await q('INSERT INTO users (email, name, pass_hash) VALUES ($1, $2, $3) RETURNING id, email, name', [email, name, hashPassword(password)]);
    const user = r.rows[0];
    await acceptInvites(user);
    res.json({ token: await newSession(user.id, req.body.device), user });
  }));

  app.post('/api/login', wrap(async (req, res) => {
    const email = normEmail(req.body.email);
    if (!loginLimit('login:' + req.ip) || !loginLimit('login:' + email)) return err(res, 429, 'יותר מדי ניסיונות, נסו שוב בעוד רבע שעה');
    const r = await q('SELECT id, email, name, pass_hash FROM users WHERE email = $1', [email]);
    const u = r.rows[0];
    if (!u || !checkPassword(req.body.password || '', u.pass_hash)) return err(res, 401, 'המייל או הסיסמה שגויים');
    const user = { id: u.id, email: u.email, name: u.name };
    await acceptInvites(user);
    res.json({ token: await newSession(user.id, req.body.device), user });
  }));

  app.post('/api/logout', wrap(auth), wrap(async (req, res) => {
    await q('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
    res.json({ ok: true });
  }));

  app.get('/api/me', wrap(auth), wrap(async (req, res) => {
    await acceptInvites(req.user);
    res.json({ user: req.user });
  }));

  // ---------- פרויקטים ----------
  app.get('/api/projects', wrap(auth), wrap(async (req, res) => {
    const r = await q(`SELECT p.id, p.name, p.rev, p.updated_at, m.role, u.email AS owner_email, u.name AS owner_name
      FROM members m JOIN projects p ON p.id = m.project_id JOIN users u ON u.id = p.owner_id
      WHERE m.user_id = $1 ORDER BY p.updated_at DESC`, [req.user.id]);
    res.json({ projects: r.rows });
  }));

  app.get('/api/projects/:id', wrap(auth), wrap(async (req, res) => {
    if (!(await membership(req.params.id, req.user.id))) return err(res, 404, 'הפרויקט לא נמצא');
    const r = await q('SELECT data, rev FROM projects WHERE id = $1', [req.params.id]);
    res.json({ data: r.rows[0].data, rev: r.rows[0].rev });
  }));

  // סנכרון: המחשב שולח את הגרסה שלו, השרת ממזג עם מה ששמור ומחזיר את התוצאה המאוחדת.
  app.post('/api/projects/:id/sync', wrap(auth), wrap(async (req, res) => {
    const id = String(req.params.id);
    const incoming = req.body && req.body.data;
    if (!incoming || typeof incoming !== 'object' || incoming.id !== id) return err(res, 400, 'נתונים לא תקינים');
    const client = pool.connect ? await pool.connect() : pool;
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT data, owner_id, rev FROM projects WHERE id = $1 FOR UPDATE', [id]);
      let merged;
      let rev;
      if (!cur.rows.length) {
        merged = Sync.merge(null, Sync.forUpload(incoming));
        rev = 1;
        await client.query('INSERT INTO projects (id, owner_id, name, data, rev) VALUES ($1, $2, $3, $4, $5)', [id, req.user.id, String(merged.name || ''), JSON.stringify(merged), rev]);
        await client.query('INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO NOTHING', [id, req.user.id, 'owner']);
      } else {
        const role = (await client.query('SELECT role FROM members WHERE project_id = $1 AND user_id = $2', [id, req.user.id])).rows[0];
        if (!role) { await client.query('ROLLBACK'); return err(res, 403, 'אין לך הרשאה לפרויקט הזה'); }
        const stored = typeof cur.rows[0].data === 'string' ? JSON.parse(cur.rows[0].data) : cur.rows[0].data;
        merged = Sync.merge(stored, Sync.forUpload(incoming));
        rev = cur.rows[0].rev + 1;
        await client.query('UPDATE projects SET data = $1, name = $2, rev = $3, updated_at = now() WHERE id = $4', [JSON.stringify(merged), String(merged.name || ''), rev, id]);
      }
      await client.query('COMMIT');
      res.json({ data: merged, rev });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      if (client.release) client.release();
    }
  }));

  // הפסקת סנכרון: הבעלים מוחק מהאתר (הנתונים נשארים במחשבים); חבר עוזב רק בשבילו.
  app.delete('/api/projects/:id', wrap(auth), wrap(async (req, res) => {
    const role = await membership(req.params.id, req.user.id);
    if (!role) return err(res, 404, 'הפרויקט לא נמצא');
    if (role === 'owner') {
      await q('DELETE FROM members WHERE project_id = $1', [req.params.id]);
      await q('DELETE FROM invites WHERE project_id = $1', [req.params.id]);
      await q('DELETE FROM projects WHERE id = $1', [req.params.id]);
    } else {
      await q('DELETE FROM members WHERE project_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    }
    res.json({ ok: true });
  }));

  // ---------- שיתוף ----------
  app.get('/api/projects/:id/members', wrap(auth), wrap(async (req, res) => {
    if (!(await membership(req.params.id, req.user.id))) return err(res, 404, 'הפרויקט לא נמצא');
    const m = await q('SELECT u.id, u.email, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY m.role DESC, u.email', [req.params.id]);
    const inv = await q('SELECT email FROM invites WHERE project_id = $1 ORDER BY created_at', [req.params.id]);
    res.json({ members: m.rows, invites: inv.rows.map((r) => r.email) });
  }));

  app.post('/api/projects/:id/invite', wrap(auth), wrap(async (req, res) => {
    const role = await membership(req.params.id, req.user.id);
    if (role !== 'owner') return err(res, 403, 'רק מי שיצר את הפרויקט יכול לשתף אותו');
    const email = normEmail(req.body.email);
    if (!validEmail(email)) return err(res, 400, 'כתובת המייל לא תקינה');
    const u = await q('SELECT id FROM users WHERE email = $1', [email]);
    if (u.rows.length) {
      await q('INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO NOTHING', [req.params.id, u.rows[0].id, 'editor']);
      return res.json({ ok: true, joined: true });
    }
    const dup = await q('SELECT id FROM invites WHERE project_id = $1 AND email = $2', [req.params.id, email]);
    if (!dup.rows.length) await q('INSERT INTO invites (project_id, email, invited_by) VALUES ($1, $2, $3)', [req.params.id, email, req.user.id]);
    res.json({ ok: true, joined: false });
  }));

  app.delete('/api/projects/:id/members/:userId', wrap(auth), wrap(async (req, res) => {
    if ((await membership(req.params.id, req.user.id)) !== 'owner') return err(res, 403, 'רק מי שיצר את הפרויקט יכול להסיר שותפים');
    await q("DELETE FROM members WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'", [req.params.id, Number(req.params.userId)]);
    res.json({ ok: true });
  }));

  app.delete('/api/projects/:id/invites', wrap(auth), wrap(async (req, res) => {
    if ((await membership(req.params.id, req.user.id)) !== 'owner') return err(res, 403, 'אין הרשאה');
    await q('DELETE FROM invites WHERE project_id = $1 AND email = $2', [req.params.id, normEmail(req.body.email)]);
    res.json({ ok: true });
  }));

  // ---------- שלוחת בירור יתרה ----------
  app.get('/api/phone', wrap(auth), wrap(async (req, res) => {
    const r = await q('SELECT line, key, greeting FROM phone_lines WHERE user_id = $1', [req.user.id]);
    res.json({ phone: r.rows[0] || null });
  }));

  app.post('/api/phone', wrap(auth), wrap(async (req, res) => {
    const line = String(req.body.line || '').replace(/\D/g, '').slice(0, 15);
    const greeting = String(req.body.greeting || '').slice(0, 200);
    const cur = await q('SELECT key FROM phone_lines WHERE user_id = $1', [req.user.id]);
    const key = cur.rows.length && !req.body.newKey ? cur.rows[0].key : crypto.randomBytes(16).toString('hex');
    if (cur.rows.length) await q('UPDATE phone_lines SET line = $1, key = $2, greeting = $3 WHERE user_id = $4', [line, key, greeting, req.user.id]);
    else await q('INSERT INTO phone_lines (user_id, line, key, greeting) VALUES ($1, $2, $3, $4)', [req.user.id, line, key, greeting]);
    res.json({ phone: { line, key, greeting } });
  }));

  // ימות המשיח קוראים לכתובת הזו (מודול API) עם ApiPhone של המתקשר. המפתח בכתובת מזהה את החשבון.
  app.all('/yemot/:key', wrap(async (req, res) => {
    const params = Object.assign({}, req.query, req.body || {});
    res.type('text/plain; charset=utf-8');
    const r = await q('SELECT user_id, line, greeting FROM phone_lines WHERE key = $1', [String(req.params.key)]);
    const lineRow = r.rows[0];
    if (!lineRow) return res.send(phone.yemotResponse('השלוחה לא מוגדרת'));
    const did = String(params.ApiDID || '').replace(/\D/g, '');
    if (lineRow.line && did && did !== lineRow.line && did.replace(/^0/, '') !== lineRow.line.replace(/^0/, '')) {
      return res.send(phone.yemotResponse('השלוחה לא מוגדרת לקו הזה'));
    }
    const pr = await q('SELECT p.data FROM members m JOIN projects p ON p.id = m.project_id WHERE m.user_id = $1', [lineRow.user_id]);
    const projects = pr.rows.map((x) => (typeof x.data === 'string' ? JSON.parse(x.data) : x.data));
    const items = phone.balancesFor(projects, params.ApiPhone);
    res.send(phone.yemotResponse(phone.balanceText(items, lineRow.greeting)));
  }));

  app.use(express.static(path.join(__dirname, 'public')));

  app.use((e, _req, res, _next) => {
    console.error(e);
    res.status(500).json({ error: 'שגיאה בשרת, נסו שוב' });
  });

  return app;
}

module.exports = { createApp, hashPassword, checkPassword };
