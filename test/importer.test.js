const test = require('node:test');
const assert = require('node:assert');
const I = require('../renderer/importer.js');

// דומה לקובץ הקייטנה האמיתי: כותרות בעברית, עמודה ריקה, סימוני V.
const ROWS = [
  ['כתה', 'שם משפחה', 'שם תלמידה', '', 'שולם', 'אישור', 'הערות', 'אח"ס', 'נייד אם', 'טל', 'נייד אב', 'כתובת', 'מורה', 'שם האם'],
  ['א', 'אנשין', 'רחל', 'V', 'V', 'V', '', '', '052-1', '', '', '', 'רבינוביץ', ''],
  ['א', 'אנשין', 'רחל', '', '', '', '', '', '', '', '', '', 'רבינוביץ', ''],
  ['ב', 'דויטש', 'רחל', '', 'V', 'V', '', '', ' (050) 418-8486', ' (02) 645-9056', '', 'חב"ד 11/3', 'רבינוביץ', 'גיטל'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
];

test('זיהוי כותרות בעברית', () => {
  assert.strictEqual(I.guessField('כתה'), 'cls');
  assert.strictEqual(I.guessField('שם תלמידה'), 'firstName');
  assert.strictEqual(I.guessField('שם משפחה'), 'lastName');
  assert.strictEqual(I.guessField('נייד אם'), 'momPhone');
  assert.strictEqual(I.guessField('נייד אב'), 'dadPhone');
  assert.strictEqual(I.guessField('טל'), 'homePhone');
  assert.strictEqual(I.guessField('שם האם'), 'motherName');
  assert.strictEqual(I.guessField('מורה'), 'teacher');
  assert.strictEqual(I.guessField('אח"ס'), null);
});

test('ניתוח טבלה: עמודות לא מוכרות עם תוכן הופכות לעמודה חדשה, ריקות מתעלמים', () => {
  const a = I.analyze(ROWS);
  assert.strictEqual(a.headerRow, 0);
  assert.strictEqual(a.rows.length, 3, 'שורה ריקה לא נספרת');
  const t = a.columns.map((c) => c.target);
  assert.deepStrictEqual(t.slice(0, 3), ['cls', 'lastName', 'firstName']);
  assert.strictEqual(t[3], 'ignore', 'עמודה בלי כותרת');
  assert.strictEqual(t[4], 'new');
  assert.strictEqual(t[6], 'notes', 'כותרת מוכרת ממופה גם כשהעמודה ריקה');
});

test('בלי שורת כותרת: עמודה ראשונה שם פרטי, שנייה שם משפחה', () => {
  const a = I.analyze([['רחל', 'כהן'], ['שרה', 'לוי']]);
  assert.strictEqual(a.headerRow, -1);
  const ppl = I.rowsToPeople(a, a.columns.map((c) => c.target), {});
  assert.deepStrictEqual(ppl.map((p) => p.firstName + ' ' + p.lastName), ['רחל כהן', 'שרה לוי']);
});

test('מיזוג: שם כפול באותו קובץ נשמר כשני אנשים, וייבוא חוזר לא מכפיל אף אחד ומשלים שדות', () => {
  const a = I.analyze(ROWS);
  const mapping = a.columns.map((c) => c.target);
  const existing = [];
  let r = I.merge(existing, I.rowsToPeople(a, mapping, { 4: 'c4', 5: 'c5', 7: 'c7' }));
  assert.strictEqual(r.added, 3);
  assert.strictEqual(existing.length, 3);
  existing[2].address = 'כתובת שהוקלדה ידנית';
  existing[2].email = '';
  const again = I.rowsToPeople(a, mapping, { 4: 'c4', 5: 'c5', 7: 'c7' });
  again[2].email = 'x@y.com';
  r = I.merge(existing, again);
  assert.strictEqual(existing.length, 3, 'ייבוא חוזר לא מוסיף את הרחל השנייה שוב');
  assert.deepStrictEqual([r.added, r.updated, r.same], [0, 1, 2]);
  assert.strictEqual(existing[2].address, 'כתובת שהוקלדה ידנית', 'לא דורסים');
  assert.strictEqual(existing[2].email, 'x@y.com', 'משלימים חסר');
});

test('PDF: פריטים לשורות ותאים מימין לשמאל', () => {
  const items = [
    { str: 'שם', x: 500, y: 700, w: 20 }, { str: 'פרטי', x: 470, y: 700, w: 25 },
    { str: 'משפחה', x: 380, y: 701, w: 40 },
    { str: 'רחל', x: 500, y: 680, w: 20 }, { str: 'כהן', x: 390, y: 680, w: 20 },
  ];
  const rows = I.pdfItemsToRows(items);
  assert.deepStrictEqual(rows, [['שם פרטי', 'משפחה'], ['רחל', 'כהן']]);
});

test('היפוך עברית שנשמרה הפוך ב-PDF', () => {
  assert.strictEqual(I.reverseHebrew('ןהכ לחר'), 'רחל כהן');
});

test('העתקת אנשים מפרויקט אחר: עמודות לפי שם, נוצרות כשחסרות, ומיזוג בלי כפילויות', () => {
  const src = [
    { id: 's1', firstName: 'רחל', lastName: 'כהן', cls: 'א', momPhone: '052', custom: { a: 'בוטנים', b: 'V' } },
    { id: 's2', firstName: 'שרה', lastName: 'לוי', cls: 'ב', custom: {} },
  ];
  const srcCols = [{ id: 'a', name: 'אלרגיות', type: 'text' }, { id: 'b', name: 'אישור', type: 'check' }];
  const dest = [{ id: 'x', name: 'אלרגיות', type: 'text' }];
  const out = I.copyPeople(src, srcCols, dest, true);
  assert.strictEqual(dest.length, 2, 'נוצרה עמודת "אישור"');
  const ishur = dest.find((c) => c.name === 'אישור');
  assert.deepStrictEqual(out[0].person.custom, { x: 'בוטנים', [ishur.id]: 'V' });
  assert.strictEqual(out[0].srcId, 's1');
  assert.strictEqual(out[0].person.id, undefined, 'מזהה חדש נקבע במיזוג, לא מועתק');
  const people = [{ id: 'p', firstName: 'רחל', lastName: 'כהן', cls: 'א', custom: {} }];
  const r = I.merge(people, out.map((o) => o.person));
  assert.deepStrictEqual([r.added, r.updated], [1, 1]);
  assert.strictEqual(people[0].momPhone, '052');

  const noCols = I.copyPeople(src, srcCols, [], false);
  assert.deepStrictEqual(noCols[0].person.custom, {});
});

test('ייבוא לעמודות הפרויקט: נרשם, שולם הכול, סכום ששולם וסימון "אישור הורים"', () => {
  const L = require('../renderer/logic.js');
  const pr = L.newProject('קייטנה', 'camp');
  pr.pricing = { mode: 'flat', flat: 170, groups: {} };
  pr.marks = [{ id: 'm1', name: 'אישור הורים' }];
  const rows = [
    ['כיתה', 'שם משפחה', 'שם פרטי', 'נרשמה', 'שולם', 'אישור', 'סכום ששולם'],
    ['א', 'כהן', 'רחל', 'V', 'V', 'V', ''],
    ['א', 'לוי', 'שרה', 'V', '', 'X', 'שולם 50'],
    ['א', 'גרין', 'לאה', '', '', '', ''],
    ['א', 'פרץ', 'מרים', '', 'V', '', ''], // שילמה בלי סימון "נרשמה" - נחשבת כנרשמת
  ];
  const a = I.analyze(rows, { marks: pr.marks, products: [], columns: [] });
  const t = a.columns.map((c) => c.target);
  assert.deepStrictEqual(t, ['cls', 'lastName', 'firstName', 'reg', 'paidFull', 'mark:m1', 'paidAmount']);
  const incoming = I.rowsToPeople(a, t, {});
  assert.strictEqual(incoming[0].projectData.reg, true);
  assert.strictEqual(JSON.stringify(incoming[0]).includes('projectData'), false, 'לא נשמר בפרטי האדם');
  const m = I.merge(pr.people, incoming);
  let r = I.applyProjectData(pr, incoming, m.targets, { date: '2026-10-07' });
  assert.deepStrictEqual([r.registered, r.payments, r.paidSum], [3, 3, 390]);
  const [rachel, sara, leah, miriam] = pr.people;
  assert.strictEqual(L.personRow(pr, miriam).status, 'paid');
  assert.strictEqual(L.personRow(pr, rachel).status, 'paid');
  assert.deepStrictEqual([L.personRow(pr, sara).paid, L.personRow(pr, sara).balance], [50, 120]);
  assert.strictEqual(pr.enrollments[rachel.id].marks.m1, true);
  assert.ok(!pr.enrollments[sara.id].marks.m1, 'X = לא מסומן');
  assert.ok(!L.isParticipant(pr, leah));

  // ייבוא חוזר של אותו קובץ לא מכפיל תשלומים
  const again = I.rowsToPeople(a, t, {});
  const m2 = I.merge(pr.people, again);
  r = I.applyProjectData(pr, again, m2.targets, {});
  assert.deepStrictEqual([r.registered, r.payments, pr.payments.length], [0, 0, 3]);
});

test('"שולם הכול" בלי מחיר לא רושם תשלום ומדווח', () => {
  const L = require('../renderer/logic.js');
  const pr = L.newProject('קייטנה', 'camp');
  const a = I.analyze([['שם פרטי', 'שם משפחה', 'שולם'], ['רחל', 'כהן', 'V']], { marks: [], products: [], columns: [] });
  const inc = I.rowsToPeople(a, a.columns.map((c) => c.target), {});
  const m = I.merge(pr.people, inc);
  const r = I.applyProjectData(pr, inc, m.targets, {});
  assert.deepStrictEqual([r.payments, r.unpriced], [0, 1]);
});

test('isYes: V/כן/✓ מסומן, X וריק לא', () => {
  const L = require('../renderer/logic.js');
  assert.deepStrictEqual(['V', 'v', ' ✓', 'כן', '1', 'X', 'x', '', null, 'לא'].map(L.isYes), [true, true, true, true, true, false, false, false, false, false]);
});
