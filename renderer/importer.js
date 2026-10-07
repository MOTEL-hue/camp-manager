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
  function analyze(rows) {
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
      if (g && !used.has(g)) { target = g; used.add(g); }
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

  function rowsToPeople(analysis, mapping, newColumnIds) {
    const out = [];
    for (const r of analysis.rows) {
      const p = { custom: {} };
      mapping.forEach((target, c) => {
        const v = clean(r[c]);
        if (!v || target === 'ignore') return;
        if (target === 'new') p.custom[newColumnIds[c]] = v;
        else if (target.startsWith('col:')) p.custom[target.slice(4)] = v;
        else p[target] = p[target] ? p[target] + ' ' + v : v;
      });
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
      } else {
        existing.push(Object.assign({ id: Logic.uid(), createdAt: new Date().toISOString() }, inc));
        added++;
      }
    }
    return { added, updated, same };
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

  return { SYNONYMS, clean, guessField, findHeaderRow, analyze, rowsToPeople, personKey, merge, copyPeople, pdfItemsToRows, reverseHebrew };
});
