// זיהוי עמודות וטבלאות מקבצי אקסל ו-PDF, ומיזוג לרשימה הקיימת. בלי DOM, כדי שאפשר לבדוק ב-node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.Importer = factory(root.Logic);
})(typeof self !== 'undefined' ? self : this, function (Logic) {
  'use strict';

  // מילים שמזהות כל שדה בכותרת. הסדר חשוב: "שם האם" לפני "שם", "נייד אם" לפני "נייד".
  const SYNONYMS = [
    ['motherName', ['שם האם', 'שם אם', 'אמא']],
    ['momPhone', ['נייד אם', 'טלפון אם', 'פלאפון אם', 'נייד האם', 'טל אם']],
    ['dadPhone', ['נייד אב', 'טלפון אב', 'פלאפון אב', 'נייד האב', 'טל אב']],
    ['homePhone', ['טלפון בית', 'טל בית', 'טל', 'טלפון', 'בית']],
    ['lastName', ['שם משפחה', 'משפחה']],
    ['firstName', ['שם פרטי', 'שם תלמידה', 'שם תלמיד', 'שם הילד', 'שם הילדה', 'פרטי', 'שם']],
    ['cls', ['כיתה', 'כתה', 'קבוצה', 'שכבה']],
    ['teacher', ['מורה', 'מחנכת', 'מחנך', 'מדריכה', 'מדריך']],
    ['email', ['מייל', 'דוא"ל', 'דואל', 'email', 'אימייל']],
    ['address', ['כתובת', 'רחוב']],
    ['notes', ['הערות', 'הערה']],
  ];

  function clean(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  }

  function guessField(header) {
    const h = clean(header).replace(/["'״׳]/g, (c) => (c === '״' ? '"' : c)).toLowerCase();
    if (!h) return null;
    for (const [field, words] of SYNONYMS) {
      if (words.some((w) => h === w.toLowerCase())) return field;
    }
    for (const [field, words] of SYNONYMS) {
      if (words.some((w) => w.length > 2 && h.includes(w.toLowerCase()))) return field;
    }
    return null;
  }

  // שורת הכותרת: הראשונה (מבין 15 הראשונות) שבה לפחות שתי עמודות מזוהות.
  function findHeaderRow(rows) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const score = (rows[i] || []).filter((c) => guessField(c)).length;
      if (score > bestScore) { best = i; bestScore = score; }
      if (score >= 3) break;
    }
    return bestScore >= 2 ? best : -1;
  }

  // מחזיר עמודות עם הצעה למיפוי: לשדה קיים, לעמודה חדשה, או להתעלם (עמודה ריקה).
  function analyze(rows, ctx) {
    rows = (rows || []).map((r) => (r || []).map(clean));
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const h = findHeaderRow(rows);
    const header = h >= 0 ? rows[h] : [];
    const body = rows.slice(h + 1).filter((r) => r.some((c) => c));
    const used = new Set();
    const columns = [];
    for (let c = 0; c < width; c++) {
      const title = header[c] || '';
      const values = body.map((r) => r[c] || '');
      const filled = values.filter(Boolean).length;
      let target = 'ignore';
      const g = guessField(title);
      const pg = guessProjectTarget(title, values.filter(Boolean), ctx);
      if (pg && !used.has(pg)) { target = pg; used.add(pg); }
      else if (g && !used.has(g)) { target = g; used.add(g); }
      else if (filled > 0) target = title ? 'new' : 'ignore';
      columns.push({ index: c, title: title || ('עמודה ' + (c + 1)), sample: values.filter(Boolean).slice(0, 3), filled, target });
    }
    // בלי כותרת: מנחשים שהעמודה המלאה הראשונה היא שם פרטי והשנייה שם משפחה.
    if (h < 0) {
      const full = columns.filter((c) => c.filled > 0);
      if (full[0]) full[0].target = 'firstName';
      if (full[1]) full[1].target = 'lastName';
    }
    return { headerRow: h, columns, rows: body };
  }

  // יעדים שהם נתוני הפרויקט ולא פרטי האדם: רישום, תשלום, כמות ממוצר, עמודת סימון בפרויקט.
  function isProjectTarget(t) {
    return t === 'reg' || t === 'paidFull' || t === 'paidAmount' || t.startsWith('qty:') || t.startsWith('mark:');
  }

  function rowsToPeople(analysis, mapping, newColumnIds) {
    const out = [];
    for (const r of analysis.rows) {
      const p = { custom: {} };
      const pd = { items: {}, marks: {} };
      let hasPd = false;
      mapping.forEach((target, c) => {
        const v = clean(r[c]);
        if (!v || target === 'ignore') return;
        if (isProjectTarget(target)) {
          hasPd = true;
          if (target === 'reg') pd.reg = Logic.isYes(v);
          else if (target === 'paidFull') pd.paidFull = Logic.isYes(v);
          else if (target === 'paidAmount') pd.paidAmount = Logic.num((v.match(/[\d.,]+/) || [''])[0]);
          else if (target.startsWith('qty:')) pd.items[target.slice(4)] = Logic.isYes(v) ? 1 : Logic.num(v);
          else pd.marks[target.slice(5)] = Logic.isYes(v);
        } else if (target === 'new') p.custom[newColumnIds[c]] = v;
        else if (target.startsWith('col:')) p.custom[target.slice(4)] = v;
        else p[target] = p[target] ? p[target] + ' ' + v : v;
      });
      if (hasPd) Object.defineProperty(p, 'projectData', { value: pd, enumerable: false });
      if (!p.firstName && !p.lastName) continue;
      out.push(p);
    }
    return out;
  }

  function personKey(p) {
    return [p.firstName, p.lastName, p.cls].map((x) => clean(x).replace(/\s/g, '')).join('|');
  }

  // מיזוג: אותו שם פרטי+משפחה+כיתה = אותו אדם. משלימים שדות ריקים ולא דורסים מה שהוקלד ידנית.
  // שם כפול (למשל שתי "רחל אנשין" באותה כיתה) הוא שני אנשים: המופע השני בקובץ מותאם לאדם השני
  // ברשימה, כך שייבוא חוזר של אותו קובץ לא מוסיף אף אחד.
  function merge(existing, incoming) {
    const byKey = new Map();
    for (const p of existing) {
      const k = personKey(p);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(p);
    }
    const seen = new Map();
    const targets = [];
    let added = 0, updated = 0, same = 0;
    for (const inc of incoming) {
      const key = personKey(inc);
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      const cur = (byKey.get(key) || [])[n];
      if (cur) {
        let changed = false;
        for (const [k, v] of Object.entries(inc)) {
          if (k === 'custom') continue;
          if (v && !clean(cur[k])) { cur[k] = v; changed = true; }
        }
        cur.custom = cur.custom || {};
        for (const [k, v] of Object.entries(inc.custom || {})) {
          if (v && !clean(cur.custom[k])) { cur.custom[k] = v; changed = true; }
        }
        changed ? updated++ : same++;
        targets.push(cur);
      } else {
        const np = Object.assign({ id: Logic.uid(), createdAt: new Date().toISOString() }, inc);
        existing.push(np);
        targets.push(np);
        added++;
      }
    }
    return { added, updated, same, targets };
  }

  // טקסט מ-PDF: מקבצים פריטים לשורות לפי גובה, ומפצלים לתאים לפי רווח אופקי.
  // items: [{str, x, y, w}] - y עולה כלפי מעלה (כמו ב-pdf.js).
  function pdfItemsToRows(items, opts) {
    opts = opts || {};
    const tol = opts.lineTolerance || 3;
    const sorted = items.filter((it) => clean(it.str)).sort((a, b) => b.y - a.y);
    const lines = [];
    for (const it of sorted) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    const rows = [];
    for (const line of lines) {
      // עברית: מימין לשמאל, ולכן התא הראשון הוא הימני ביותר.
      const its = line.items.sort((a, b) => b.x - a.x);
      const cells = [];
      let prevLeft = null;
      for (const it of its) {
        const right = it.x + (it.w || 0);
        const gap = prevLeft === null ? Infinity : prevLeft - right;
        if (gap > (opts.cellGap || 8) || !cells.length) cells.push(clean(it.str));
        else cells[cells.length - 1] = clean(cells[cells.length - 1] + ' ' + it.str);
        prevLeft = it.x;
      }
      rows.push(cells);
    }
    return rows;
  }

  // החלת נתוני הפרויקט מהקובץ (נרשם, שולם, כמויות, סימונים) על האנשים שאליהם מוזגו השורות.
  // אפשר לייבא שוב את אותו קובץ: תשלום נרשם רק על ההפרש שעוד לא שולם.
  function applyProjectData(project, incoming, targets, opts) {
    opts = opts || {};
    const res = { registered: 0, payments: 0, paidSum: 0, unpriced: 0, marks: 0 };
    incoming.forEach((inc, i) => {
      const pd = inc.projectData;
      const person = targets[i];
      if (!pd || !person) return;
      const e = Logic.ensureEnrollment(project, person.id);
      // מי ששילם/ה על קייטנה נחשב/ת כנרשם/ה, גם אם בקובץ לא סומן "נרשם".
      const paidMark = pd.paidFull || pd.paidAmount > 0;
      const regByPay = paidMark && project.pricing.mode !== 'none';
      if ((pd.reg || regByPay) && !e.registered) { e.registered = true; res.registered++; }
      for (const [k, q] of Object.entries(pd.items)) if (q > 0) e.items[k] = q;
      for (const [k, on] of Object.entries(pd.marks)) if (on) { e.marks[k] = true; res.marks++; }
    });
    // תשלומים אחרי שכל הרישומים נקבעו, כדי ש"שולם הכול" יחושב לפי המחיר הנכון.
    incoming.forEach((inc, i) => {
      const pd = inc.projectData;
      const person = targets[i];
      if (!pd || !person) return;
      const paid = Logic.paidBy(project, person.id);
      let amount = 0;
      if (pd.paidAmount > 0) amount = pd.paidAmount - paid;
      else if (pd.paidFull) {
        const due = Logic.amountDue(project, person);
        if (due <= 0) { res.unpriced++; return; }
        amount = due - paid;
      }
      amount = Logic.round2(amount);
      if (amount <= 0) return;
      project.payments.push({ id: Logic.uid(), personId: person.id, amount, method: opts.method || 'אחר', date: opts.date || '', note: 'מייבוא', createdAt: new Date().toISOString() });
      res.payments++;
      res.paidSum = Logic.round2(res.paidSum + amount);
    });
    return res;
  }

  // ניחוש יעד לעמודה לפי הכותרת, כולל עמודות הפרויקט (סימונים, מוצרים) ועמודות קיימות.
  function guessProjectTarget(title, values, ctx) {
    const h = clean(title);
    if (!h || !ctx) return null;
    const yesNo = values.length && values.every((v) => /^[vVxX✓✔]$|^כן$|^לא$/.test(v));
    if (/שולם|שילם|תשלום/.test(h)) return yesNo ? 'paidFull' : (values.some((v) => /\d/.test(v)) ? 'paidAmount' : null);
    if (/^(נרשם|נרשמה|רשום|רשומה|הרשמה|רישום)/.test(h)) return 'reg';
    for (const m of ctx.marks || []) if (m.name === h || m.name.includes(h) || h.includes(m.name)) return 'mark:' + m.id;
    for (const x of ctx.products || []) if (x.name === h) return 'qty:' + x.id;
    for (const c of ctx.columns || []) if (c.name === h) return 'col:' + c.id;
    return null;
  }

  // העתקת אנשים מפרויקט אחר: שדות קבועים כמו שהם, ועמודות מותאמות לפי שם העמודה.
  // עמודה שאין ביעד נוצרת בו. מחזיר [{person, srcId}] כדי שאפשר יהיה להעתיק גם סימונים.
  function copyPeople(srcPeople, srcColumns, destColumns, withColumns) {
    const colMap = {};
    if (withColumns) {
      for (const c of srcColumns || []) {
        let d = destColumns.find((x) => x.name === c.name);
        if (!d) { d = { id: Logic.uid(), name: c.name, type: c.type }; destColumns.push(d); }
        colMap[c.id] = d.id;
      }
    }
    return srcPeople.map((p) => {
      const person = { custom: {} };
      for (const f of Logic.PERSON_FIELDS) if (p[f.key]) person[f.key] = p[f.key];
      for (const [k, v] of Object.entries(p.custom || {})) if (colMap[k] && v) person.custom[colMap[k]] = v;
      return { person, srcId: p.id };
    });
  }

  function reverseHebrew(s) {
    return String(s).split(' ').reverse().map((w) => (/[֐-׿]/.test(w) ? [...w].reverse().join('') : w)).join(' ');
  }

  return { applyProjectData, guessProjectTarget, isProjectTarget, SYNONYMS, clean, guessField, findHeaderRow, analyze, rowsToPeople, personKey, merge, copyPeople, pdfItemsToRows, reverseHebrew };
});
