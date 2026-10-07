const test = require('node:test');
const assert = require('node:assert');
const L = require('../renderer/logic.js');

function setup() {
  const people = [
    { id: 'a', firstName: 'רחל', lastName: 'כהן', cls: 'א', momPhone: '052-7000001' },
    { id: 'b', firstName: 'שרה', lastName: 'כהן', cls: 'ב', momPhone: '0527000001' },
    { id: 'c', firstName: 'לאה', lastName: 'לוי', cls: 'א', dadPhone: '+972 53-111-2222' },
    { id: 'd', firstName: 'חנה', lastName: 'לוי', cls: 'ג', momPhone: '050-9999999', dadPhone: '053-1112222' },
    { id: 'e', firstName: 'מרים', lastName: 'גרין', cls: 'ג' },
  ];
  const pr = L.newProject('קייטנה', 'camp');
  pr.pricing = { mode: 'flat', flat: 170, groups: {} };
  return { people, pr };
}

test('מחיר אחיד, הנחה ודריסה ידנית', () => {
  const { people, pr } = setup();
  L.ensureEnrollment(pr, 'a').registered = true;
  assert.strictEqual(L.amountDue(pr, people[0]), 170);
  pr.enrollments.a.discount = 20;
  assert.strictEqual(L.amountDue(pr, people[0]), 150);
  pr.enrollments.a.override = 100;
  assert.strictEqual(L.amountDue(pr, people[0]), 100);
  assert.strictEqual(L.amountDue(pr, people[1]), 0, 'לא נרשמה = לא חייבת');
});

test('מחיר לפי כיתה עם ברירת מחדל', () => {
  const { people, pr } = setup();
  pr.pricing = { mode: 'group', flat: 150, groups: { 'א': 200 } };
  L.ensureEnrollment(pr, 'a').registered = true;
  L.ensureEnrollment(pr, 'e').registered = true;
  assert.strictEqual(L.amountDue(pr, people[0]), 200);
  assert.strictEqual(L.amountDue(pr, people[4]), 150);
});

test('מכירת מוצרים: כמות כפול מחיר, בלי דמי רישום', () => {
  const { people } = setup();
  const pr = L.newProject('ספרים', 'sale');
  pr.products = [{ id: 'p1', name: 'חומש', price: 45 }, { id: 'p2', name: 'סידור', price: 30.5 }];
  const e = L.ensureEnrollment(pr, 'a');
  e.items = { p1: 2, p2: 1 };
  assert.strictEqual(L.amountDue(pr, people[0]), 120.5);
  assert.ok(L.isParticipant(pr, people[0]));
  assert.ok(!L.isParticipant(pr, people[1]));
});

test('מצב תשלום: לא שולם, חלקי, מלא, ביתר', () => {
  assert.strictEqual(L.status(170, 0), 'unpaid');
  assert.strictEqual(L.status(170, 50), 'partial');
  assert.strictEqual(L.status(170, 170), 'paid');
  assert.strictEqual(L.status(170, 200), 'over');
  assert.strictEqual(L.status(0, 0), 'none');
});

test('משפחות לפי טלפון הורים, כולל שרשרת ופורמטים שונים', () => {
  const { people } = setup();
  const fams = L.families(people).map((f) => f.map((p) => p.id).sort().join(','));
  assert.ok(fams.includes('a,b'), 'אותו נייד אם בפורמט שונה');
  assert.ok(fams.includes('c,d'), '+972 ונייד אב משותף');
  assert.ok(fams.includes('e'));
});

test('סיכום: סכומים, אמצעי תשלום, הוצאות ומזומן בקופה', () => {
  const { people, pr } = setup();
  for (const id of ['a', 'b', 'c']) L.ensureEnrollment(pr, id).registered = true;
  pr.payments.push({ personId: 'a', amount: 170, method: 'מזומן' });
  pr.payments.push({ personId: 'b', amount: 50, method: 'העברה בנקאית' });
  pr.payments.push({ personId: 'zzz', amount: 999, method: 'מזומן' }); // אדם שנמחק לא נספר
  pr.expenses.push({ name: 'זמרת', amount: 100, method: 'מזומן' }, { name: 'גרפיכל', amount: 40, method: 'העברה בנקאית' });
  const s = L.summary(pr, people);
  assert.strictEqual(s.participants, 3);
  assert.strictEqual(s.due, 510);
  assert.strictEqual(s.paid, 220);
  assert.strictEqual(s.balance, 290);
  assert.deepStrictEqual(s.counts, { paid: 1, partial: 1, unpaid: 1, over: 0 });
  assert.strictEqual(s.byMethod['מזומן'], 170);
  assert.strictEqual(s.expenses, 140);
  assert.strictEqual(s.net, 80);
  assert.strictEqual(s.expectedNet, 370);
  assert.strictEqual(s.cashOnHand, 70);
  assert.strictEqual(s.byGroup['א'].participants, 2);
});

test('תשלום משפחתי מתחלק לפי החובות, ועודף נרשם על הראשון', () => {
  const { people, pr } = setup();
  L.ensureEnrollment(pr, 'a').registered = true;
  L.ensureEnrollment(pr, 'b').registered = true;
  pr.payments.push({ personId: 'a', amount: 100 });
  const fam = [people[0], people[1]];
  assert.deepStrictEqual(L.splitFamilyPayment(pr, fam, 240), [{ personId: 'a', amount: 70 }, { personId: 'b', amount: 170 }]);
  assert.deepStrictEqual(L.splitFamilyPayment(pr, fam, 300), [{ personId: 'a', amount: 130 }, { personId: 'b', amount: 170 }]);
  assert.deepStrictEqual(L.splitFamilyPayment(pr, fam, 50), [{ personId: 'a', amount: 50 }]);
});

test('num מקבל סכומים עם פסיקים ושקלים', () => {
  assert.strictEqual(L.num('1,250 ₪'), 1250);
  assert.strictEqual(L.num(''), 0);
  assert.strictEqual(L.num('abc'), 0);
});

test('מעבר מרשימה כללית לרשימה לכל פרויקט: הרישומים והתשלומים נשארים מחוברים', () => {
  const old = {
    settings: { hiddenFields: ['email'] },
    columns: [{ id: 'c', name: 'אלרגיות', type: 'text' }],
    people: [{ id: 'a', firstName: 'רחל', lastName: 'כהן', cls: 'א' }],
    projects: [L.newProject('קייטנה', 'camp'), L.newProject('ספרים', 'sale')],
  };
  delete old.projects[0].people; delete old.projects[0].columns; delete old.projects[0].hiddenFields;
  delete old.projects[1].people; delete old.projects[1].columns; delete old.projects[1].hiddenFields;
  old.projects[0].pricing = { mode: 'flat', flat: 100, groups: {} };
  L.ensureEnrollment(old.projects[0], 'a').registered = true;
  const db = L.migrate(old);
  assert.strictEqual(db.people, undefined);
  assert.strictEqual(db.columns, undefined);
  assert.strictEqual(db.projects[0].people.length, 1);
  assert.strictEqual(db.projects[1].people.length, 1);
  assert.notStrictEqual(db.projects[0].people[0], db.projects[1].people[0], 'עותקים נפרדים');
  assert.strictEqual(L.amountDue(db.projects[0], db.projects[0].people[0]), 100);
  assert.deepStrictEqual(db.projects[1].hiddenFields, ['email']);
  assert.strictEqual(db.projects[1].columns[0].name, 'אלרגיות');
});

test('מעבר: רשימה כללית בלי פרויקטים נשמרת בפרויקט חדש', () => {
  const db = L.migrate({ people: [{ id: 'a', firstName: 'רחל' }], columns: [], projects: [] });
  assert.strictEqual(db.projects.length, 1);
  assert.strictEqual(db.projects[0].people[0].firstName, 'רחל');
  const empty = L.migrate({ people: [], projects: [] });
  assert.strictEqual(empty.projects.length, 0);
});
