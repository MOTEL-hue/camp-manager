const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/logic.js');
const S = require('../renderer/sync.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

function base() {
  const p = L.newProject('קייטנה', 'camp');
  p.pricing = { mode: 'flat', flat: 170, groups: {} };
  p.people = [{ id: 'a', firstName: 'רחל', lastName: 'כהן', custom: {} }, { id: 'b', firstName: 'שרה', lastName: 'לוי', custom: {} }];
  L.ensureEnrollment(p, 'a').registered = true;
  S.stamp(null, p, 100);
  return p;
}

// עריכה מקומית: משנים עותק, ואז stamp מול המצב הקודם.
function edit(p, now, fn) {
  const prev = clone(p);
  fn(p);
  S.stamp(prev, p, now);
  return p;
}

test('שני מחשבים עובדים בלי אינטרנט על דברים שונים - הכול מתאחד', () => {
  const server = base();
  const pc1 = clone(server);
  const pc2 = clone(server);
  edit(pc1, 200, (p) => { p.payments.push({ id: 'pay1', personId: 'a', amount: 100 }); });
  edit(pc2, 210, (p) => {
    p.people.push({ id: 'c', firstName: 'לאה', lastName: 'גרין', custom: {} });
    L.ensureEnrollment(p, 'b').registered = true;
  });
  const m1 = S.merge(server, S.forUpload(pc1));
  const m2 = S.merge(m1, S.forUpload(pc2));
  assert.deepStrictEqual(m2.people.map((x) => x.id), ['a', 'b', 'c']);
  assert.strictEqual(m2.payments.length, 1);
  assert.ok(m2.enrollments.b.registered && m2.enrollments.a.registered);
  // והמחשב הראשון מקבל את מה שהשני עשה
  const back = S.merge(pc1, m2);
  assert.deepStrictEqual(back.people.map((x) => x.id), ['a', 'b', 'c']);
  assert.strictEqual(L.amountDue(back, back.people[1]), 170);
});

test('אותו פריט שונה בשני מקומות - השינוי המאוחר גובר', () => {
  const server = base();
  const pc1 = edit(clone(server), 300, (p) => { p.people[0].momPhone = '050-1111111'; });
  const pc2 = edit(clone(server), 310, (p) => { p.people[0].momPhone = '052-2222222'; });
  assert.strictEqual(S.merge(S.merge(server, pc1), pc2).people[0].momPhone, '052-2222222');
  assert.strictEqual(S.merge(S.merge(server, pc2), pc1).people[0].momPhone, '052-2222222', 'לא תלוי בסדר');
});

test('מחיקה לא "חוזרת לחיים" אחרי סנכרון עם מחשב שעוד לא ידע עליה', () => {
  const server = base();
  const pc1 = edit(clone(server), 400, (p) => { p.people = p.people.filter((x) => x.id !== 'b'); });
  const pc2 = clone(server); // לא שינה כלום
  const m = S.merge(S.merge(server, pc1), pc2);
  assert.deepStrictEqual(m.people.map((x) => x.id), ['a']);
  // מחיקת רישום
  const pc3 = edit(clone(m), 500, (p) => { delete p.enrollments.a; });
  assert.strictEqual(S.merge(m, pc3).enrollments.a, undefined);
  // עריכה שנעשתה אחרי המחיקה (450 > 400) משאירה את האדם - מישהו עוד עבד עליו
  const pc4 = edit(clone(server), 450, (p) => { p.people[1].notes = 'עדכון'; });
  assert.deepStrictEqual(S.merge(m, pc4).people.map((x) => x.id), ['a', 'b']);
  // ועריכה שנעשתה לפני המחיקה לא מחזירה אותו
  const pc5 = edit(clone(server), 350, (p) => { p.people[1].notes = 'ישן'; });
  assert.deepStrictEqual(S.merge(m, pc5).people.map((x) => x.id), ['a']);
});

test('הגדרות הפרויקט (שם, מחיר) - הגרסה המאוחרת', () => {
  const server = base();
  const pc1 = edit(clone(server), 600, (p) => { p.pricing.flat = 200; });
  const pc2 = edit(clone(server), 590, (p) => { p.name = 'שם אחר'; });
  const m = S.merge(S.merge(server, pc1), pc2);
  assert.strictEqual(m.pricing.flat, 200);
  assert.strictEqual(m.name, 'קייטנה', 'הגדרות הן יחידה אחת - המאוחרת (600) גוברת');
});

test('שדות מקומיים (cloud) לא נשלחים לשרת', () => {
  const p = base();
  p.cloud = { sync: true, token: 'x' };
  assert.strictEqual(S.forUpload(p).cloud, undefined);
  assert.ok(p.cloud);
});

test('הרשאות שיתוף: מה מותר לכל תפקיד', () => {
  const owner = base();
  // שותף (חשבון 7) מוסיף תשלום - הפריט נרשם על שמו
  const mine = clone(owner);
  const prev = clone(mine);
  mine.payments.push({ id: 'p7', personId: 'a', amount: 50 });
  S.stamp(prev, mine, 300, 7);
  assert.strictEqual(mine.payments[0]._by, 7);
  for (const role of ['editor', 'nodelete', 'own', 'add']) assert.deepStrictEqual(S.violations(prev, mine, role, 7), [], role);
  assert.strictEqual(S.violations(prev, mine, 'viewer', 7)[0].what, 'add');

  // מחיקת אדם של היוצר: רק עריכה מלאה
  const delOther = clone(mine);
  delOther.people = delOther.people.filter((p) => p.id !== 'b');
  assert.deepStrictEqual(S.violations(mine, delOther, 'editor', 7), []);
  for (const role of ['nodelete', 'own', 'add']) assert.strictEqual(S.violations(mine, delOther, role, 7)[0].what, 'delete', role);

  // מחיקת התשלום שהוא עצמו הוסיף: מותר ב"own", אסור ב"add" וב"nodelete"
  const delMine = clone(mine);
  delMine.payments = [];
  assert.deepStrictEqual(S.violations(mine, delMine, 'own', 7), []);
  assert.strictEqual(S.violations(mine, delMine, 'add', 7).length, 1);
  assert.strictEqual(S.violations(mine, delMine, 'nodelete', 7).length, 1);
  assert.strictEqual(S.violations(mine, delMine, 'own', 8).length, 1); // לא שלו

  // שינוי שם של אדם של היוצר: מותר ב-nodelete, אסור ב-own/add
  const rename = clone(mine);
  rename.people[0].firstName = 'רחלי';
  assert.deepStrictEqual(S.violations(mine, rename, 'nodelete', 7), []);
  assert.strictEqual(S.violations(mine, rename, 'own', 7)[0].what, 'edit');

  // הגדרות הפרויקט (מחיר)
  const price = clone(mine);
  price.pricing.flat = 200;
  assert.strictEqual(S.violations(mine, price, 'own', 7)[0].what, 'meta');
  assert.deepStrictEqual(S.violations(mine, price, 'nodelete', 7), []);

  // סימון רישום = הוספת נתונים
  const reg = clone(mine);
  L.ensureEnrollment(reg, 'b').registered = true;
  assert.deepStrictEqual(S.violations(mine, reg, 'add', 7), []);
  assert.strictEqual(S.violations(mine, reg, 'viewer', 7).length, 1);
});

test('פרויקט פגום שהגיע מהאתר מנוקה ולא מקריס את התוכנה', () => {
  const bad = { id: 'x', name: 5, people: null, payments: [null, 'a', { id: 'p1', amount: 5 }, { id: 'p1' }], enrollments: [], tombstones: { 'people:a': 'zz', 'people:b': 3 }, pricing: 'free', __proto__: { evil: 1 } };
  const clean = S.sanitize(JSON.parse(JSON.stringify(bad)), 'x');
  assert.deepStrictEqual(clean.people, []);
  assert.deepStrictEqual(clean.payments.map((p) => p.id), ['p1']);
  assert.deepStrictEqual(clean.enrollments, {});
  assert.deepStrictEqual(clean.tombstones, { 'people:b': 3 });
  assert.strictEqual(clean.pricing, undefined);
  assert.strictEqual(S.sanitize(bad, 'other'), null);
  assert.strictEqual(S.sanitize([], 'x'), null);
  // וגם קובץ נתונים פגום נפתח
  const db = L.migrate({ settings: {}, projects: [null, { id: 'y', name: 'ק', people: null, payments: 'x', enrollments: [] }] });
  assert.strictEqual(db.projects.length, 1);
  assert.deepStrictEqual(db.projects[0].people, []);
  assert.deepStrictEqual(db.projects[0].payments, []);
});

test('רישום של אדם של אחר = עריכה; רישום חדש = הוספה', () => {
  const p = base();
  const prev = clone(p);
  p.enrollments.a.discount = 50;
  assert.strictEqual(S.violations(prev, p, 'add', 7)[0].what, 'edit');
  assert.deepStrictEqual(S.violations(prev, p, 'nodelete', 7), []);
});
