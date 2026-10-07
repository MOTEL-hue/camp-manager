const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');
const { createApp } = require('../app.js');
const db = require('../db.js');
const L = require('../../renderer/logic.js');
const S = require('../../renderer/sync.js');

let base, server;

test.before(async () => {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await db.init(pool);
  server = createApp(pool).listen(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

async function api(path, { token, method, body } = {}) {
  const res = await fetch(base + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data };
}

function project() {
  const p = L.newProject('קייטנת תשרי', 'camp');
  p.pricing = { mode: 'flat', flat: 170, groups: {} };
  p.people = [
    { id: 'a', firstName: 'רחל', lastName: 'כהן', cls: 'א', momPhone: '052-7000001', custom: {} },
    { id: 'b', firstName: 'שרה', lastName: 'כהן', cls: 'ב', dadPhone: '0527000001', custom: {} },
  ];
  L.ensureEnrollment(p, 'a').registered = true;
  L.ensureEnrollment(p, 'b').registered = true;
  p.payments.push({ id: 'p1', personId: 'b', amount: 50 });
  S.stamp(null, p, 1000);
  return p;
}

let tokA, tokB, pr;

test('הרשמה, כניסה, ושגיאות ברורות', async () => {
  let r = await api('/api/register', { body: { email: 'A@x.com', password: 'short' } });
  assert.strictEqual(r.status, 400);
  r = await api('/api/register', { body: { email: 'A@x.com', password: 'password1', name: 'אבא' } });
  assert.strictEqual(r.status, 200);
  tokA = r.data.token;
  r = await api('/api/register', { body: { email: 'a@x.com', password: 'password1' } });
  assert.strictEqual(r.status, 409, 'מייל באותיות שונות = אותו חשבון');
  r = await api('/api/login', { body: { email: 'a@x.com', password: 'wrong-pass' } });
  assert.strictEqual(r.status, 401);
  r = await api('/api/login', { body: { email: 'a@x.com', password: 'password1' } });
  assert.strictEqual(r.status, 200);
  r = await api('/api/me', { token: 'bad' });
  assert.strictEqual(r.status, 401);
});

test('סנכרון: יצירה, מיזוג, והרשאות', async () => {
  pr = project();
  let r = await api(`/api/projects/${pr.id}/sync`, { token: tokA, body: { data: Object.assign({}, pr, { cloud: { sync: true } }) } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.rev, 1);
  assert.strictEqual(r.data.data.cloud, undefined, 'שדות מקומיים לא נשמרים בשרת');
  r = await api('/api/register', { body: { email: 'b@x.com', password: 'password2' } });
  tokB = r.data.token;
  r = await api(`/api/projects/${pr.id}`, { token: tokB });
  assert.strictEqual(r.status, 404, 'חשבון אחר לא רואה בלי שיתוף');
  r = await api(`/api/projects/${pr.id}/sync`, { token: tokB, body: { data: pr } });
  assert.strictEqual(r.status, 403);
});

test('שיתוף עם חשבון אחר, ועבודה משותפת', async () => {
  let r = await api(`/api/projects/${pr.id}/invite`, { token: tokB, body: { email: 'c@x.com' } });
  assert.strictEqual(r.status, 404 === r.status ? 404 : 403);
  r = await api(`/api/projects/${pr.id}/invite`, { token: tokA, body: { email: 'b@x.com' } });
  assert.deepStrictEqual(r.data, { ok: true, joined: true });
  r = await api('/api/projects', { token: tokB });
  assert.strictEqual(r.data.projects[0].id, pr.id);
  assert.strictEqual(r.data.projects[0].role, 'editor');
  // ב' מוסיף תשלום, א' מוסיף ילדה - שניהם נשמרים
  const b = (await api(`/api/projects/${pr.id}`, { token: tokB })).data.data;
  const prevB = JSON.parse(JSON.stringify(b));
  b.payments.push({ id: 'p2', personId: 'a', amount: 170 });
  S.stamp(prevB, b, 2000);
  await api(`/api/projects/${pr.id}/sync`, { token: tokB, body: { data: b } });
  const a = JSON.parse(JSON.stringify(pr));
  a.people.push({ id: 'c', firstName: 'לאה', lastName: 'לוי', custom: {} });
  S.stamp(pr, a, 2100);
  r = await api(`/api/projects/${pr.id}/sync`, { token: tokA, body: { data: a } });
  assert.strictEqual(r.data.data.people.length, 3);
  assert.strictEqual(r.data.data.payments.length, 2);
  // הזמנה למי שעוד אין לו חשבון - מתקבלת כשנרשם
  r = await api(`/api/projects/${pr.id}/invite`, { token: tokA, body: { email: 'new@x.com' } });
  assert.deepStrictEqual(r.data, { ok: true, joined: false });
  r = await api('/api/register', { body: { email: 'new@x.com', password: 'password3' } });
  r = await api('/api/projects', { token: r.data.token });
  assert.strictEqual(r.data.projects.length, 1);
  r = await api(`/api/projects/${pr.id}/members`, { token: tokA });
  assert.deepStrictEqual(r.data.members.map((m) => m.role).sort(), ['editor', 'editor', 'owner']);
});

test('שלוחת בירור יתרה: לפי המספר המזוהה, בלי מפתח - לא עובד', async () => {
  let r = await api('/api/phone', { token: tokA, body: { line: '077-3137770', greeting: 'שלום מתלמוד תורה' } });
  const key = r.data.phone.key;
  r = await api(`/yemot/${key}?ApiPhone=0527000001&ApiDID=0773137770`);
  const text = decodeURIComponent(String(r.data).replace(/^id_list_message=/, '').replace(/&go_to_folder=hangup$/, ''));
  assert.match(text, /^t-שלום מתלמוד תורה/);
  assert.match(text, /רחל כהן בקייטנת תשרי, הכל שולם/);
  assert.match(text, /שרה כהן בקייטנת תשרי, נשאר לתשלום 120 שקלים/);
  assert.doesNotMatch(text.replace(/^t-|\.t-/g, ''), /[.\-]/, 'בלי נקודות ומקפים בתוך הטקסט');
  r = await api(`/yemot/${key}?ApiPhone=0500000000`);
  assert.match(decodeURIComponent(r.data), /לא נמצא/);
  r = await api(`/yemot/${key}?ApiPhone=0527000001&ApiDID=0790000000`);
  assert.match(decodeURIComponent(r.data), /לא מוגדרת לקו הזה/);
  r = await api('/yemot/wrong-key?ApiPhone=0527000001');
  assert.match(decodeURIComponent(r.data), /לא מוגדרת/);
});

test('הפסקת סנכרון: שותף עוזב, הבעלים מוחק', async () => {
  let r = await api(`/api/projects/${pr.id}`, { token: tokB, method: 'DELETE' });
  r = await api('/api/projects', { token: tokB });
  assert.strictEqual(r.data.projects.length, 0);
  r = await api(`/api/projects/${pr.id}`, { token: tokA, method: 'DELETE' });
  r = await api('/api/projects', { token: tokA });
  assert.strictEqual(r.data.projects.length, 0);
});
