// מיזוג פרויקט בין כמה מחשבים (דרך האתר). משותף לתוכנה ולשרת, ונבדק ב-node.
//
// כל פריט בפרויקט (אדם, רישום, תשלום, הוצאה, מוצר...) מקבל חותמת זמן _t של השינוי האחרון שלו,
// ומחיקה נרשמת ב-tombstones. במיזוג: לכל פריט נבחרת הגרסה עם החותמת המאוחרת, ופריט שנמחק אחרי
// השינוי האחרון שלו לא חוזר. כך שני אנשים יכולים לעבוד בלי אינטרנט, וכשמתחברים - הכול מתאחד.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // אוספים שהפריטים בהם הם מערך עם id.
  const ARRAYS = ['people', 'payments', 'expenses', 'products', 'marks', 'columns', 'links', 'reminders'];
  // שדות שלא עוברים בסנכרון (מצב מקומי של המחשב).
  const LOCAL = new Set(['cloud']);
  const SPECIAL = new Set(['id', 'tombstones', '_metaT', 'enrollments', ...ARRAYS, ...LOCAL]);

  function bare(o) {
    if (!o || typeof o !== 'object') return JSON.stringify(o);
    const c = Object.assign({}, o);
    delete c._t;
    return JSON.stringify(c);
  }

  function metaOf(p) {
    const m = {};
    for (const k of Object.keys(p).sort()) if (!SPECIAL.has(k)) m[k] = p[k];
    return JSON.stringify(m);
  }

  // הרשאות בשיתוף. "שלו" = פריט שהוא הוסיף (_by = מזהה החשבון שלו). פריטים בלי _by שייכים ליוצר הפרויקט.
  // רישום (enrollments) נחשב הוספת נתונים: מי שמותר לו להוסיף יכול גם לסמן רישום.
  const ROLES = {
    editor: { label: 'עריכה מלאה', add: true, editAll: true, editOwn: true, delAll: true, delOwn: true, meta: true },
    nodelete: { label: 'הוספה ועריכה, בלי מחיקה', add: true, editAll: true, editOwn: true, delAll: false, delOwn: false, meta: true },
    own: { label: 'הוספה, ועריכה ומחיקה רק של מה שהוסיף/ה', add: true, editAll: false, editOwn: true, delAll: false, delOwn: true, meta: false },
    add: { label: 'הוספה בלבד (תיקון רק של מה שהוסיף/ה, בלי מחיקה)', add: true, editAll: false, editOwn: true, delAll: false, delOwn: false, meta: false },
    viewer: { label: 'צפייה בלבד', add: false, editAll: false, editOwn: false, delAll: false, delOwn: false, meta: false },
  };
  const rights = (role) => ROLES[role] || ROLES.editor; // owner, וגם "editor" של גרסאות קודמות

  // מה מהשינוי prev -> cur אסור לפי ההרשאה. [] = הכול מותר.
  function violations(prev, cur, role, me) {
    const r = rights(role);
    if (!prev || (r.editAll && r.delAll && r.meta)) return [];
    const out = [];
    const mine = (e) => e && e._by != null && String(e._by) === String(me);
    for (const k of ARRAYS) {
      const before = new Map((prev[k] || []).map((e) => [e.id, e]));
      const ids = new Set();
      for (const e of cur[k] || []) {
        ids.add(e.id);
        const b = before.get(e.id);
        if (!b) { if (!r.add) out.push({ k, id: e.id, what: 'add' }); }
        else if (bare(b) !== bare(e) && !(r.editAll || (r.editOwn && mine(b)))) out.push({ k, id: e.id, what: 'edit' });
      }
      for (const [id, b] of before) if (!ids.has(id) && !(r.delAll || (r.delOwn && mine(b)))) out.push({ k, id, what: 'delete' });
    }
    const be = prev.enrollments || {};
    const ce = cur.enrollments || {};
    for (const [id, e] of Object.entries(ce)) if ((!be[id] || bare(be[id]) !== bare(e)) && !r.add) out.push({ k: 'enrollments', id, what: be[id] ? 'edit' : 'add' });
    for (const [id, b] of Object.entries(be)) if (!ce[id] && !(r.delAll || (r.delOwn && mine(b)))) out.push({ k: 'enrollments', id, what: 'delete' });
    if (metaOf(prev) !== metaOf(cur) && !r.meta) out.push({ k: 'meta', what: 'meta' });
    return out;
  }

  // אחרי כל שינוי מקומי: מסמנים זמן לפריטים שהשתנו, ורושמים מחיקות. me = מי הוסיף פריטים חדשים.
  function stamp(prev, cur, now, me) {
    cur.tombstones = cur.tombstones || {};
    if (!prev) {
      for (const k of ARRAYS) for (const e of cur[k] || []) if (!e._t) e._t = now;
      for (const e of Object.values(cur.enrollments || {})) if (!e._t) e._t = now;
      if (!cur._metaT) cur._metaT = now;
      return cur;
    }
    for (const k of ARRAYS) {
      const before = new Map((prev[k] || []).map((e) => [e.id, e]));
      const ids = new Set();
      for (const e of cur[k] || []) {
        ids.add(e.id);
        const b = before.get(e.id);
        if (!b && me != null && e._by == null) e._by = me;
        if (!b || bare(b) !== bare(e)) e._t = now;
        else if (b._t && !e._t) e._t = b._t;
      }
      for (const id of before.keys()) if (!ids.has(id)) cur.tombstones[k + ':' + id] = now;
    }
    const be = prev.enrollments || {};
    const ce = cur.enrollments || {};
    for (const [id, e] of Object.entries(ce)) {
      if (!be[id] && me != null && e._by == null) e._by = me;
      if (!be[id] || bare(be[id]) !== bare(e)) e._t = now;
    }
    for (const id of Object.keys(be)) if (!ce[id]) cur.tombstones['enrollments:' + id] = now;
    if (metaOf(prev) !== metaOf(cur)) cur._metaT = now;
    else if (prev._metaT && !cur._metaT) cur._metaT = prev._metaT;
    return cur;
  }

  function pick(x, y) {
    if (!x) return y;
    if (!y) return x;
    return (y._t || 0) >= (x._t || 0) ? y : x;
  }

  // מיזוג שתי גרסאות של אותו פרויקט. לא משנה את הקלט.
  function merge(a, b) {
    if (!a) return JSON.parse(JSON.stringify(b));
    if (!b) return JSON.parse(JSON.stringify(a));
    const tomb = Object.assign({}, a.tombstones || {});
    for (const [k, t] of Object.entries(b.tombstones || {})) tomb[k] = Math.max(tomb[k] || 0, t);
    const base = (b._metaT || 0) >= (a._metaT || 0) ? b : a;
    const out = {};
    for (const k of Object.keys(base)) if (!SPECIAL.has(k) || k === 'id' || k === '_metaT') out[k] = base[k];
    out.id = a.id || b.id;
    out._metaT = Math.max(a._metaT || 0, b._metaT || 0);
    const alive = (k, e) => e && !((tomb[k + ':' + e.id] || 0) >= (e._t || 0) && tomb[k + ':' + e.id]);
    for (const k of ARRAYS) {
      const am = new Map((a[k] || []).map((e) => [e.id, e]));
      const bm = new Map((b[k] || []).map((e) => [e.id, e]));
      const order = [...am.keys(), ...[...bm.keys()].filter((id) => !am.has(id))];
      out[k] = order.map((id) => pick(am.get(id), bm.get(id))).filter((e) => alive(k, e));
    }
    out.enrollments = {};
    const ids = new Set([...Object.keys(a.enrollments || {}), ...Object.keys(b.enrollments || {})]);
    for (const id of ids) {
      const e = pick((a.enrollments || {})[id], (b.enrollments || {})[id]);
      const t = tomb['enrollments:' + id];
      if (t && t >= (e._t || 0)) continue;
      out.enrollments[id] = e;
    }
    out.tombstones = tomb;
    return JSON.parse(JSON.stringify(out));
  }

  // לשליחה לשרת: בלי השדות המקומיים.
  function forUpload(p) {
    const c = JSON.parse(JSON.stringify(p));
    for (const k of LOCAL) delete c[k];
    return c;
  }

  return { ARRAYS, ROLES, rights, violations, stamp, merge, forUpload };
});
