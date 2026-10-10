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
  assert.deepStrictEqual(s.counts, { paid: 1, partial: 1, unpaid: 1, over: 0, covered: 0 });
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

test('קישור לפרויקט "עירייה": מי שמופיע שם פטור, ואחרים משלמים רגיל', () => {
  const city = L.newProject('רישום דרך העירייה', 'list');
  city.people = [
    { id: 'c1', firstName: 'רחל', lastName: 'כהן', cls: 'א' },
    { id: 'c2', firstName: 'לאה', lastName: 'לוי', cls: '' }, // בלי כיתה - מספיק שם מלא
  ];
  const camp = L.newProject('קייטנה', 'camp');
  camp.pricing = { mode: 'flat', flat: 170, groups: {} };
  camp.people = [
    { id: 'a', firstName: 'רחל', lastName: 'כהן', cls: 'א' },
    { id: 'b', firstName: 'לאה', lastName: 'לוי', cls: 'ב' },
    { id: 'd', firstName: 'שרה', lastName: 'כהן', cls: 'א' },
    { id: 'e', firstName: 'רחל', lastName: 'כהן', cls: 'ב' }, // שם זהה בכיתה אחרת - לא אותה ילדה
  ];
  for (const p of camp.people) L.ensureEnrollment(camp, p.id).registered = true;
  camp.links = [{ id: 'l', projectId: city.id, label: 'עירייה', condition: 'listed', cover: 'full' }];
  L.setProjects([city, camp]);
  const row = (id) => L.personRow(camp, camp.people.find((p) => p.id === id));
  assert.deepStrictEqual([row('a').due, row('a').status, row('a').coverLabel], [0, 'covered', 'עירייה']);
  assert.strictEqual(row('b').due, 0, 'בלי כיתה ברשימת העירייה - מתאים לפי שם');
  assert.strictEqual(row('d').due, 170);
  assert.strictEqual(row('e').due, 170);
  const s = L.summary(camp, camp.people);
  assert.strictEqual(s.due, 340);
  assert.strictEqual(s.covered, 340);
  assert.deepStrictEqual(s.coveredBy['עירייה'], { count: 2, amount: 340 });
  assert.strictEqual(s.counts.covered, 2);
});

test('קישור: כיתה שונה בכל רשימה - מתאים לפי שם, רק כשהשם יחיד בשני הפרויקטים', () => {
  const mgr = L.newProject('רישום דרך המנהל', 'list');
  mgr.people = [
    { id: 'm1', firstName: 'רחל', lastName: 'כהן', cls: 'ג' },
    { id: 'm2', firstName: 'לאה', lastName: 'לוי', cls: 'א' },
    { id: 'm3', firstName: 'לאה', lastName: 'לוי', cls: 'ב' },
    { id: 'm4', firstName: 'שרה', lastName: 'גרין', cls: 'א' },
  ];
  const camp = L.newProject('קייטנה', 'camp');
  camp.pricing = { mode: 'flat', flat: 170, groups: {} };
  camp.people = [
    { id: 'a', firstName: 'רחל', lastName: 'כהן', cls: 'ד' },
    { id: 'b', firstName: 'לאה', lastName: 'לוי', cls: 'ג' },
    { id: 'c', firstName: 'שרה', lastName: 'גרין', cls: 'ב' },
    { id: 'd', firstName: 'שרה', lastName: 'גרין', cls: 'ג' },
  ];
  for (const p of camp.people) L.ensureEnrollment(camp, p.id).registered = true;
  camp.links = [{ id: 'l', projectId: mgr.id, label: 'מנהל', condition: 'listed', cover: 'full' }];
  L.setProjects([mgr, camp]);
  const due = (id) => L.amountDue(camp, camp.people.find((p) => p.id === id));
  assert.strictEqual(due('a'), 0, 'שם יחיד בשני הצדדים - אותה ילדה גם בכיתה אחרת');
  assert.strictEqual(due('b'), 170, 'שתי לאה לוי אצל המנהל - לא מנחשים');
  assert.strictEqual(due('c'), 170, 'שתי שרה גרין בקייטנה - לא מנחשים');
  assert.strictEqual(due('d'), 170);
  L.setProjects([]);
});

test('סיכום סופי: כמה התקבל בפועל מהמנהל וכמה חסר', () => {
  const s = { paid: 0, covered: 900, coveredBy: { 'מנהל': { count: 9, amount: 900 }, 'עירייה': { count: 2, amount: 340 } }, expenses: 0, balance: 0 };
  const pr = { links: [{ projectId: 'x', label: 'מנהל', received: 600 }, { projectId: 'y', label: 'עירייה', received: '' }] };
  const f = L.finalSummary(pr, s);
  assert.deepStrictEqual(f.bySource[0], { label: 'מנהל', count: 9, amount: 900, received: 600, missing: 300 });
  assert.strictEqual(f.bySource[1].received, undefined, 'לא סומן - לא מציגים');
  assert.strictEqual(f.income, 900, 'ההכנסה הצפויה לא משתנה');
});

test('קישור עם תנאי "שילם שם" והנחה קבועה במקום פטור מלא', () => {
  const mgr = L.newProject('רישום דרך המנהל', 'camp');
  mgr.pricing = { mode: 'flat', flat: 50, groups: {} };
  mgr.people = [{ id: 'm1', firstName: 'רחל', lastName: 'כהן', cls: 'א' }, { id: 'm2', firstName: 'שרה', lastName: 'לוי', cls: 'א' }];
  L.ensureEnrollment(mgr, 'm1').registered = true;
  L.ensureEnrollment(mgr, 'm2').registered = true;
  mgr.payments.push({ personId: 'm1', amount: 50 });
  const camp = L.newProject('קייטנה', 'camp');
  camp.pricing = { mode: 'flat', flat: 170, groups: {} };
  camp.people = [{ id: 'a', firstName: 'רחל', lastName: 'כהן', cls: 'א' }, { id: 'b', firstName: 'שרה', lastName: 'לוי', cls: 'א' }];
  for (const p of camp.people) L.ensureEnrollment(camp, p.id).registered = true;
  camp.links = [{ id: 'l', projectId: mgr.id, label: 'מנהל', condition: 'paid', cover: 'amount', amount: 100 }];
  // קישור הפוך לא נתקע בלולאה
  mgr.links = [{ id: 'x', projectId: camp.id, label: 'קייטנה', condition: 'paid', cover: 'full' }];
  L.setProjects([mgr, camp]);
  assert.strictEqual(L.amountDue(camp, camp.people[0]), 70, 'שילמה במנהל - הנחה של 100');
  assert.strictEqual(L.amountDue(camp, camp.people[1]), 170, 'לא שילמה במנהל');
  L.setProjects([]);
});

test('תזכורות: הודעה אחת למשפחה לפי טלפון, עם הסכום הכולל והשמות', () => {
  const { people, pr } = setup();
  for (const id of ['a', 'b', 'c', 'e']) L.ensureEnrollment(pr, id).registered = true;
  pr.payments.push({ personId: 'b', amount: 70 });
  pr.payments.push({ personId: 'c', amount: 170 });
  const groups = L.reminderGroups(pr, people, 'phone');
  const fam = groups.find((g) => g.key === '0527000001');
  assert.deepStrictEqual(fam.members.map((m) => m.person.id), ['a', 'b']);
  assert.strictEqual(fam.total, 270);
  assert.ok(!groups.some((g) => g.members.some((m) => m.person.id === 'c')), 'מי ששילם לא מקבל');
  const noPhone = groups.find((g) => g.members[0].person.id === 'e');
  assert.strictEqual(noPhone.key, '', 'בלי טלפון - קבוצה בלי יעד');
  const txt = L.fillTemplate('עבור {שמות} ב{פרויקט} נשאר {סכום} ש"ח {לא_קיים}', pr, fam, { orgName: 'ת"ת' });
  assert.strictEqual(txt, 'עבור רחל ושרה בקייטנה נשאר 270 ש"ח {לא_קיים}');
});

test('תזכורות במייל: קיבוץ לפי כתובת מייל', () => {
  const { people, pr } = setup();
  people[0].email = 'Mom@x.com'; people[1].email = 'mom@x.com ';
  for (const id of ['a', 'b']) L.ensureEnrollment(pr, id).registered = true;
  const g = L.reminderGroups(pr, people, 'email');
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].key, 'mom@x.com');
  assert.strictEqual(g[0].total, 340);
});

test('יתרות לשלוחת הטלפון: לפי כל טלפון של הורה, רק משתתפים', () => {
  const { people, pr } = setup();
  pr.people = people;
  for (const id of ['a', 'b', 'd']) L.ensureEnrollment(pr, id).registered = true;
  pr.payments.push({ personId: 'b', amount: 170 });
  const map = L.phoneBalances(pr);
  assert.deepStrictEqual(map['0527000001'].map((x) => [x.name, x.balance]), [['רחל כהן', 170], ['שרה כהן', 0]]);
  assert.deepStrictEqual(Object.keys(map).sort(), ['0509999999', '0527000001', '0531112222'].sort());
  assert.strictEqual(map['0531112222'][0].name, 'חנה לוי');
  assert.strictEqual(map['0531112222'].length, 1, 'אותו ילד לא נכפל באותו מספר');
  pr.archived = true;
  assert.deepStrictEqual(L.phoneBalances(pr), {});
});

test('ספקים: הזמנה לפי ספק, מחיר מהספק, ודוח עם מה ששולם', () => {
  const p = L.newProject('מכירת ספרים', 'sale');
  p.people = [{ id: 'a', firstName: 'א', custom: {} }, { id: 'b', firstName: 'ב', custom: {} }, { id: 'c', firstName: 'ג', custom: {} }];
  p.products = [
    { id: 'h', name: 'חומש', price: 50, supplierId: 's1' },
    { id: 'g', name: 'גיאוגרפיה', price: 39, cost: 30, supplierId: 's2' },
    { id: 'n', name: 'נפלאות הבורא', price: 25, supplierId: 's2' },
    { id: 'x', name: 'אלגברה', price: 23 },
  ];
  p.suppliers = [{ id: 's1', name: 'חיים' }, { id: 's2', name: 'שמעון' }, { id: 's3', name: 'ספק בלי מוצרים' }];
  L.ensureEnrollment(p, 'a').items = { h: 2, g: 1 };
  L.ensureEnrollment(p, 'b').items = { h: 1, g: 1, n: 3 };
  L.ensureEnrollment(p, 'c').items = { x: 2 };
  const s = L.summary(p, p.people);
  const o = L.supplierOrders(p, s);
  const by = (id) => o.groups.find((g) => g.supplier.id === id);
  assert.strictEqual(by('s1').total, 150); // 3 חומשים * 50
  assert.strictEqual(by('s2').total, 135); // גיאוגרפיה 2*30 (מחיר מהספק) + נפלאות הבורא 3*25
  assert.deepStrictEqual(by('s2').items.map((i) => i.price), [30, 25]);
  assert.strictEqual(by('s3').items.length, 0);
  assert.strictEqual(o.none.total, 46); // אלגברה, בלי ספק
  assert.strictEqual(o.total, 150 + 135 + 46);
  // מוצר ששויך לספק שנמחק נחשב "בלי ספק"
  p.products[0].supplierId = 'gone';
  assert.strictEqual(L.supplierOrders(p, s).none.items.length, 2);
  p.products[0].supplierId = 's1';
  p.expenses = [{ id: 'e1', name: 'מקדמה', amount: 100, supplierId: 's1' }, { id: 'e2', name: 'נסיעות', amount: 40 }];
  const rep = L.supplierReport(p, s);
  assert.deepStrictEqual([rep[0].total, rep[0].paid, rep[0].balance], [150, 100, 50]);
  assert.strictEqual(rep[1].paid, 0);
  // פרויקט חדש ופרויקט ישן מקבלים רשימת ספקים
  assert.deepStrictEqual(L.newProject('x', 'sale').suppliers, []);
  const old = L.migrate({ settings: {}, projects: [{ id: 'z', name: 'ישן', people: [], products: [] }] });
  assert.deepStrictEqual(old.projects[0].suppliers, []);
});

test('סיכום סופי: הכנסות מהמשתתפים + מהמנהל, פחות הוצאות', () => {
  const s = { paid: 11050, covered: 9180, coveredBy: { 'מנהל': { count: 54, amount: 9180 } }, expenses: 6122, balance: 170 };
  const f = L.finalSummary({}, s);
  assert.strictEqual(f.income, 20230);
  assert.strictEqual(f.net, 14108);
  assert.deepStrictEqual(f.bySource, [{ label: 'מנהל', count: 54, amount: 9180 }]);
  assert.strictEqual(f.expectedNet, 14278); // אחרי שיגבו גם את 170 שנשארו
  // בלי גורם מקושר: רק מה ששילמו
  const g = L.finalSummary({}, { paid: 1000, covered: 0, coveredBy: {}, expenses: 300, balance: 0 });
  assert.deepStrictEqual([g.income, g.net, g.bySource.length], [1000, 700, 0]);
});
