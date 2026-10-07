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

test('מיזוג: שם כפול באותו קובץ נשמר כשני אנשים, ייבוא חוזר לא מכפיל ומשלים שדות', () => {
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
  assert.strictEqual(existing.length, 4, 'הרחל השנייה מהקובץ שוב נחשבת כפילות בתוך הקובץ');
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
