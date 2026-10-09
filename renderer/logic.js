// חישובים טהורים: בלי DOM ובלי קבצים, כדי שאפשר לבדוק אותם ב-node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PERSON_FIELDS = [
    { key: 'cls', label: 'כיתה / קבוצה' },
    { key: 'lastName', label: 'שם משפחה' },
    { key: 'firstName', label: 'שם פרטי' },
    { key: 'teacher', label: 'מורה / מדריכה' },
    { key: 'motherName', label: 'שם האם' },
    { key: 'momPhone', label: 'נייד אם', phone: true },
    { key: 'dadPhone', label: 'נייד אב', phone: true },
    { key: 'homePhone', label: 'טלפון בית', phone: true },
    { key: 'email', label: 'מייל' },
    { key: 'address', label: 'כתובת' },
    { key: 'notes', label: 'הערות' },
  ];

  const PAYMENT_METHODS = ['מזומן', 'העברה בנקאית', 'צ\'ק', 'אשראי', 'ביט / פייבוקס', 'אחר'];

  // ערך של עמודת סימון: V / ✓ / כן / 1 = מסומן. X או ריק = לא מסומן.
  function isYes(v) {
    return /^(v|✓|✔|כן|1|true|y|yes)$/i.test(String(v === null || v === undefined ? '' : v).trim());
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,₪\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function emptyDb() {
    return {
      schema: 1,
      settings: { orgName: '', receiptFooter: 'תודה רבה!', nextReceiptNo: 1, theme: 'light', templates: {} },
      projects: [],
    };
  }

  function newProject(name, kind) {
    return {
      id: uid(),
      name: name || 'פרויקט חדש',
      kind: kind || 'camp', // camp = רישום במחיר קבוע, sale = מכירת מוצרים, list = רשימה בלבד (למשל רישום דרך העירייה)
      createdAt: new Date().toISOString(),
      archived: false,
      // לכל פרויקט רשימת אנשים ועמודות משלו. אפשר להעתיק רשימה מפרויקט אחר.
      people: [],
      columns: [],
      hiddenFields: [],
      links: [], // [{id, projectId, label, condition, cover: 'full'|'amount', amount}]
      reminders: [], // יומן תזכורות: [{date, channel, sent, failed}]
      // מחיר הרישום: none (אין), flat (שווה לכולם), group (לפי כיתה/קבוצה)
      pricing: { mode: kind === 'camp' || !kind ? 'flat' : 'none', flat: 0, groups: {} },
      products: [], // [{id, name, price, cost?, supplierId?}] - cost = מחיר מהספק (אם שונה ממחיר המכירה)
      suppliers: [], // [{id, name, contact, phone, email, address, notes}]
      marks: [], // עמודות סימון נוספות לפרויקט, למשל "אישור הורים"
      enrollments: {},
      payments: [],
      expenses: [],
      notes: '',
    };
  }

  function enrollment(project, personId) {
    return project.enrollments[personId] || null;
  }

  function ensureEnrollment(project, personId) {
    if (!project.enrollments[personId]) {
      project.enrollments[personId] = { registered: false, items: {}, discount: 0, override: null, delivered: false, marks: {}, note: '' };
    }
    return project.enrollments[personId];
  }

  function basePrice(project, person) {
    const p = project.pricing || {};
    if (p.mode === 'flat') return num(p.flat);
    if (p.mode === 'group') {
      const g = (person && person.cls ? String(person.cls).trim() : '');
      if (p.groups && Object.prototype.hasOwnProperty.call(p.groups, g)) return num(p.groups[g]);
      return num(p.flat);
    }
    return 0;
  }

  // האם האדם "משתתף" בפרויקט: נרשם, או רכש לפחות פריט אחד.
  function isParticipant(project, person) {
    const e = enrollment(project, person.id);
    if (!e) return false;
    if (e.registered) return true;
    return Object.values(e.items || {}).some((q) => num(q) > 0);
  }

  // קישור בין פרויקטים: מי שמופיע/נרשם/שילם בפרויקט מקושר (למשל "רישום דרך העירייה") פטור
  // מתשלום כאן, או מקבל הנחה קבועה. כל הפרויקטים נמסרים ב-setProjects, כי החישוב צריך לראות גם אותם.
  let ALL = [];
  let indexCache = new Map();
  const resolving = new Set();

  function setProjects(list) {
    ALL = list || [];
    indexCache = new Map();
  }

  function nameKey(p, withClass) {
    const n = (x) => String(x || '').replace(/\s+/g, '').trim();
    return n(p.firstName) + '|' + n(p.lastName) + (withClass ? '|' + n(p.cls) : '');
  }

  // אותו שם פרטי, משפחה וכיתה; אם באחד הצדדים אין כיתה - מספיק שם מלא, כל עוד הוא יחיד ברשימה.
  function findMatch(src, person) {
    let idx = indexCache.get(src.id);
    if (!idx) {
      idx = { full: new Map(), name: new Map() };
      for (const p of src.people || []) {
        const fk = nameKey(p, true), nk = nameKey(p, false);
        if (!idx.full.has(fk)) idx.full.set(fk, p);
        idx.name.set(nk, idx.name.has(nk) ? null : p);
      }
      indexCache.set(src.id, idx);
    }
    if (nameKey(person, false) === '|') return null;
    const hit = idx.full.get(nameKey(person, true));
    if (hit) return hit;
    const byName = idx.name.get(nameKey(person, false));
    if (byName && (!String(person.cls || '').trim() || !String(byName.cls || '').trim())) return byName;
    return null;
  }

  const LINK_CONDITIONS = [
    ['listed', 'מופיע/ה ברשימה שם'],
    ['registered', 'נרשם/ה או השתתף/ה שם'],
    ['paid', 'שילם/ה שם הכול'],
  ];

  function coverage(project, person) {
    if (!project.links || !project.links.length || resolving.has(project.id)) return null;
    resolving.add(project.id);
    try {
      for (const link of project.links) {
        const src = ALL.find((x) => x.id === link.projectId);
        if (!src || src === project) continue;
        const m = findMatch(src, person);
        if (!m) continue;
        let ok = link.condition === 'listed';
        if (link.condition === 'registered') ok = isParticipant(src, m);
        if (link.condition === 'paid') { const r = personRow(src, m); ok = r.status === 'paid' || r.status === 'over'; }
        if (ok) return { label: link.label || src.name, full: link.cover !== 'amount', amount: num(link.amount) };
      }
      return null;
    } finally {
      resolving.delete(project.id);
    }
  }

  function grossDue(project, person) {
    const e = enrollment(project, person.id);
    if (!e) return 0;
    if (e.override !== null && e.override !== undefined && e.override !== '') return round2(num(e.override));
    let total = 0;
    if (e.registered) total += basePrice(project, person);
    for (const prod of project.products || []) {
      total += num((e.items || {})[prod.id]) * num(prod.price);
    }
    total -= num(e.discount);
    return round2(Math.max(0, total));
  }

  // כמה מכוסה דרך פרויקט מקושר, ועל ידי מי.
  function coveredPart(project, person) {
    const gross = grossDue(project, person);
    if (gross <= 0) return { gross, covered: 0, label: '' };
    const c = coverage(project, person);
    if (!c) return { gross, covered: 0, label: '' };
    return { gross, covered: round2(c.full ? gross : Math.min(gross, c.amount)), label: c.label };
  }

  function amountDue(project, person) {
    const c = coveredPart(project, person);
    return round2(c.gross - c.covered);
  }

  function paidBy(project, personId) {
    let s = 0;
    for (const pay of project.payments || []) if (pay.personId === personId) s += num(pay.amount);
    return round2(s);
  }

  function status(due, paid) {
    if (due <= 0 && paid <= 0) return 'none';
    if (paid >= due && due > 0) return paid > due ? 'over' : 'paid';
    if (paid > 0) return 'partial';
    return 'unpaid';
  }

  const STATUS_LABEL = { none: '—', paid: 'שולם', over: 'שולם ביתר', partial: 'שולם חלקית', unpaid: 'לא שולם', covered: 'פטור' };

  function personRow(project, person) {
    const c = coveredPart(project, person);
    const due = round2(c.gross - c.covered);
    const paid = paidBy(project, person.id);
    let st = status(due, paid);
    if (c.covered > 0 && due <= 0 && paid <= 0) st = 'covered';
    return { due, paid, balance: round2(due - paid), status: st, participant: isParticipant(project, person), gross: c.gross, covered: c.covered, coverLabel: c.label };
  }

  // ספרות בלבד, ובלי קידומת בינלאומית, כדי ש-"050-1234567" ו-"+972501234567" יהיו אותו מספר.
  function normPhone(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('972')) d = '0' + d.slice(3);
    return d.length >= 9 ? d : '';
  }

  // משפחות: אנשים שחולקים טלפון הורה כלשהו. איחוד קבוצות כדי שגם שרשרת (אם משותפת לאחד, אב לשני) תחובר.
  function families(people) {
    const parent = new Map();
    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const byPhone = new Map();
    for (const p of people) {
      parent.set(p.id, p.id);
      for (const k of ['momPhone', 'dadPhone']) {
        const ph = normPhone(p[k]);
        if (!ph) continue;
        if (byPhone.has(ph)) union(p.id, byPhone.get(ph));
        else byPhone.set(ph, p.id);
      }
    }
    const groups = new Map();
    for (const p of people) {
      const r = find(p.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(p);
    }
    return [...groups.values()];
  }

  function familyName(members) {
    const names = [...new Set(members.map((m) => (m.lastName || '').trim()).filter(Boolean))];
    return names.join(' / ') || 'ללא שם';
  }

  function summary(project, people) {
    const s = {
      participants: 0, due: 0, paid: 0, balance: 0, overpaid: 0,
      counts: { paid: 0, partial: 0, unpaid: 0, over: 0, covered: 0 },
      covered: 0, coveredBy: {},
      byMethod: {}, byGroup: {}, products: {}, delivered: 0,
      expenses: 0, expensesByMethod: {},
    };
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const person of people) {
      const r = personRow(project, person);
      if (!r.participant && r.paid === 0) continue;
      if (r.participant) s.participants++;
      s.due += r.due;
      s.paid += r.paid;
      if (r.balance > 0) s.balance += r.balance;
      else s.overpaid += -r.balance;
      if (s.counts[r.status] !== undefined) s.counts[r.status]++;
      if (r.covered > 0) {
        s.covered += r.covered;
        const cb = s.coveredBy[r.coverLabel] || (s.coveredBy[r.coverLabel] = { count: 0, amount: 0 });
        cb.count++;
        cb.amount = round2(cb.amount + r.covered);
      }
      const g = (person.cls || 'ללא קבוצה').toString().trim() || 'ללא קבוצה';
      const bg = s.byGroup[g] || (s.byGroup[g] = { participants: 0, due: 0, paid: 0, balance: 0 });
      if (r.participant) bg.participants++;
      bg.due += r.due;
      bg.paid += r.paid;
      bg.balance += Math.max(0, r.balance);
      const e = enrollment(project, person.id);
      if (e && e.delivered) s.delivered++;
      for (const prod of project.products || []) {
        const q = num(e && e.items ? e.items[prod.id] : 0);
        if (q > 0) {
          const ps = s.products[prod.id] || (s.products[prod.id] = { qty: 0, amount: 0, buyers: 0 });
          ps.qty += q;
          ps.amount += q * num(prod.price);
          ps.buyers++;
        }
      }
    }
    for (const pay of project.payments || []) {
      if (!byId.has(pay.personId)) continue;
      const m = pay.method || 'אחר';
      s.byMethod[m] = round2((s.byMethod[m] || 0) + num(pay.amount));
    }
    for (const ex of project.expenses || []) {
      s.expenses += num(ex.amount);
      const m = ex.method || 'אחר';
      s.expensesByMethod[m] = round2((s.expensesByMethod[m] || 0) + num(ex.amount));
    }
    s.due = round2(s.due);
    s.paid = round2(s.paid);
    s.balance = round2(s.balance);
    s.overpaid = round2(s.overpaid);
    s.covered = round2(s.covered);
    s.expenses = round2(s.expenses);
    s.net = round2(s.paid - s.expenses); // מה שיש בפועל
    s.expectedNet = round2(s.due - s.expenses); // מה שיהיה כשכולם ישלמו
    s.cashOnHand = round2((s.byMethod['מזומן'] || 0) - (s.expensesByMethod['מזומן'] || 0));
    return s;
  }

  // חלוקת תשלום משפחתי בין הילדים: קודם למי שחייב, לפי הסדר; עודף נרשם על הראשון.
  function splitFamilyPayment(project, members, amount) {
    let left = round2(num(amount));
    const parts = [];
    for (const m of members) {
      if (left <= 0) break;
      const bal = round2(amountDue(project, m) - paidBy(project, m.id));
      if (bal <= 0) continue;
      const take = Math.min(bal, left);
      parts.push({ personId: m.id, amount: round2(take) });
      left = round2(left - take);
    }
    if (left > 0 && members.length) {
      const first = parts.find((p) => p.personId === members[0].id);
      if (first) first.amount = round2(first.amount + left);
      else parts.unshift({ personId: members[0].id, amount: left });
    }
    return parts;
  }

  function fullName(p) {
    return [p.firstName, p.lastName].filter((x) => x && String(x).trim()).join(' ').trim();
  }

  function money(n) {
    const v = round2(num(n));
    return v.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ₪';
  }

  // השלמת שדות שנוספו בגרסאות מאוחרות יותר, כדי שקובץ ישן ייפתח בלי שגיאות.
  // בגרסאות הראשונות הייתה רשימת אנשים אחת לכל הפרויקטים; היא מועתקת לכל פרויקט (באותם מזהים,
  // כדי שהרישומים והתשלומים יישארו מחוברים), ואם אין פרויקטים - נשמרת בפרויקט חדש.
  function migrate(db) {
    const base = emptyDb();
    db.settings = Object.assign({}, base.settings, db.settings || {});
    db.projects = db.projects || [];
    if (Array.isArray(db.people)) {
      const legacy = JSON.stringify({ people: db.people, columns: db.columns || [], hidden: db.settings.hiddenFields || [] });
      if (db.people.length && !db.projects.length) {
        const pr = newProject('רשימה מהגרסה הקודמת', 'camp');
        pr.pricing.mode = 'none';
        delete pr.people; // כדי שהלולאה הבאה תעתיק אליו את הרשימה
        db.projects.push(pr);
      }
      for (const pr of db.projects) {
        if (pr.people) continue;
        const copy = JSON.parse(legacy);
        pr.people = copy.people;
        pr.columns = copy.columns;
        pr.hiddenFields = copy.hidden;
      }
      delete db.people;
      delete db.columns;
      delete db.settings.hiddenFields;
    }
    // נתונים פגומים (קובץ ישן, או פרויקט משותף שהגיע פגום) לא מקריסים את התוכנה - מתקנים.
    db.projects = db.projects.filter((pr) => pr && typeof pr === 'object' && !Array.isArray(pr));
    for (const pr of db.projects) {
      const np = newProject(pr.name, pr.kind);
      for (const k of Object.keys(np)) {
        if (pr[k] === undefined || pr[k] === null || (Array.isArray(np[k]) && !Array.isArray(pr[k]))) pr[k] = np[k];
      }
      if (typeof pr.enrollments !== 'object' || Array.isArray(pr.enrollments)) pr.enrollments = {};
      for (const k of Object.keys(np)) if (Array.isArray(np[k])) pr[k] = pr[k].filter((e) => typeof e !== 'object' || (e && !Array.isArray(e)));
      pr.pricing = Object.assign({ mode: 'none', flat: 0, groups: {} }, typeof pr.pricing === 'object' && !Array.isArray(pr.pricing) ? pr.pricing : {});
      pr.people = pr.people.filter((p) => p && typeof p === 'object');
      for (const p of pr.people) p.custom = p.custom && typeof p.custom === 'object' ? p.custom : {};
    }
    return db;
  }

  // תזכורות: מקבצים את החייבים לפי טלפון (או מייל) של ההורה - הודעה אחת למשפחה, עם כל הילדים והסכום.
  function reminderGroups(project, people, by) {
    const groups = new Map();
    for (const p of people) {
      const r = personRow(project, p);
      if (r.balance <= 0) continue;
      let key = '';
      if (by === 'email') key = String(p.email || '').trim().toLowerCase();
      else key = normPhone(p.momPhone) || normPhone(p.dadPhone) || normPhone(p.homePhone);
      const g = groups.get(key || 'none:' + p.id) || { key, members: [], total: 0 };
      g.members.push({ person: p, balance: r.balance });
      g.total = round2(g.total + r.balance);
      groups.set(key || 'none:' + p.id, g);
    }
    return [...groups.values()];
  }

  // מילוי תבנית הודעה: {שמות}, {משפחה}, {סכום}, {פרויקט}, {ארגון}, {פירוט}.
  function fillTemplate(tpl, project, group, settings) {
    const names = group.members.map((m) => m.person.firstName || fullName(m.person)).filter(Boolean);
    const joined = names.length > 1 ? names.slice(0, -1).join(', ') + ' ו' + names[names.length - 1] : (names[0] || '');
    const lastNames = [...new Set(group.members.map((m) => m.person.lastName).filter(Boolean))].join(' / ');
    const detail = group.members.map((m) => `${fullName(m.person)}: ${round2(m.balance)} ש"ח`).join('\n');
    const vars = {
      'שמות': joined, 'משפחה': lastNames, 'סכום': String(round2(group.total)),
      'פרויקט': project.name, 'ארגון': (settings && settings.orgName) || '', 'פירוט': detail,
    };
    return String(tpl || '').replace(/\{([^}]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k.trim()) ? vars[k.trim()] : m));
  }

  const DEFAULT_TEMPLATES = {
    emailSubject: 'תזכורת תשלום - {פרויקט}',
    emailBody: 'שלום רב,\n\nזוהי תזכורת ידידותית: עבור {שמות} ב{פרויקט} נשאר לתשלום {סכום} ש"ח.\n\n{פירוט}\n\nתודה רבה,\n{ארגון}',
    voice: 'שלום. זוהי תזכורת מ{ארגון}. עבור {שמות} ב{פרויקט} נשאר לתשלום {סכום} שקלים. תודה רבה.',
  };

  // יתרות לשלוחת הטלפון באתר: {טלפון: [{name, project, due, paid, balance, covered}]}. מחושב כאן,
  // כדי שהאתר רק יקרא תשובה מוכנה כשהורה מתקשר.
  // סיכום סופי של ההכנסות: מה ששילמו המשתתפים + מה שמגיע מגורמים מקושרים (למשל המנהל / העירייה), פחות
  // הוצאות. s = תוצאת summary.
  function finalSummary(project, s) {
    const fromPeople = round2(s.paid);
    const fromSources = round2(s.covered);
    const bySource = Object.entries(s.coveredBy || {}).map(([label, v]) => ({ label, count: v.count, amount: v.amount }));
    const income = round2(fromPeople + fromSources);
    const net = round2(income - s.expenses);
    return {
      fromPeople, fromSources, bySource, income, expenses: s.expenses, net,
      stillToCollect: s.balance, expectedIncome: round2(income + s.balance), expectedNet: round2(net + s.balance),
    };
  }

  // ---------- ספקים ----------
  // כל מוצר יכול להיות משויך לספק (product.supplierId). ההזמנה מתחלקת לפי ספק, עם סה"כ לכל ספק. מחיר
  // ההזמנה הוא "מחיר מהספק" (product.cost) אם הוזן, ואחרת מחיר המכירה. s = תוצאת summary (כמויות לכל מוצר).
  function unitCost(prod) {
    const c = prod.cost;
    return c === undefined || c === null || c === '' ? num(prod.price) : num(c);
  }

  function supplierOrders(project, s) {
    const mk = (supplier) => ({ supplier, items: [], total: 0 });
    const groups = (project.suppliers || []).map(mk);
    const byId = new Map(groups.map((g) => [g.supplier.id, g]));
    const none = mk(null); // מוצרים שעוד לא שויכו לספק
    for (const prod of project.products || []) {
      const qty = num(((s && s.products) || {})[prod.id] && s.products[prod.id].qty);
      const price = unitCost(prod);
      const g = (prod.supplierId && byId.get(prod.supplierId)) || none;
      g.items.push({ product: prod, qty, price, total: round2(qty * price) });
      g.total = round2(g.total + qty * price);
    }
    return { groups, none, total: round2(groups.reduce((a, g) => a + g.total, none.total)) };
  }

  // דוח לכל ספק: הפרטים, מה להזמין ובכמה, כמה כבר שולם לו (הוצאות שסומנו על שמו) וכמה נשאר.
  function supplierReport(project, s) {
    return supplierOrders(project, s).groups.map((g) => {
      const expenses = (project.expenses || []).filter((x) => x.supplierId === g.supplier.id);
      const paid = round2(expenses.reduce((a, x) => a + num(x.amount), 0));
      return { supplier: g.supplier, items: g.items, total: g.total, expenses, paid, balance: round2(g.total - paid) };
    });
  }

  function phoneBalances(project) {
    const out = {};
    if (!project || project.archived || project.kind === 'list') return out;
    for (const p of project.people || []) {
      const r = personRow(project, p);
      if (!r.participant && !r.paid) continue;
      const item = { name: fullName(p), project: project.name, due: r.due, paid: r.paid, balance: r.balance, covered: r.coverLabel || '' };
      for (const ph of new Set([p.momPhone, p.dadPhone, p.homePhone].map(normPhone).filter(Boolean))) {
        (out[ph] = out[ph] || []).push(item);
      }
    }
    return out;
  }

  return {
    phoneBalances, unitCost, supplierOrders, supplierReport, finalSummary,
    reminderGroups, fillTemplate, DEFAULT_TEMPLATES,
    isYes, migrate, setProjects, coverage, coveredPart, grossDue, findMatch, LINK_CONDITIONS,
    PERSON_FIELDS, PAYMENT_METHODS, STATUS_LABEL,
    uid, num, round2, emptyDb, newProject, enrollment, ensureEnrollment,
    basePrice, isParticipant, amountDue, paidBy, status, personRow,
    normPhone, families, familyName, summary, splitFamilyPayment, fullName, money,
  };
});
