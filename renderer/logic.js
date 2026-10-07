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
      settings: { orgName: '', receiptFooter: 'תודה רבה!', nextReceiptNo: 1, theme: 'light' },
      projects: [],
    };
  }

  function newProject(name, kind) {
    return {
      id: uid(),
      name: name || 'פרויקט חדש',
      kind: kind || 'camp', // camp = רישום במחיר קבוע, sale = מכירת מוצרים
      createdAt: new Date().toISOString(),
      archived: false,
      // לכל פרויקט רשימת אנשים ועמודות משלו. אפשר להעתיק רשימה מפרויקט אחר.
      people: [],
      columns: [],
      hiddenFields: [],
      // מחיר הרישום: none (אין), flat (שווה לכולם), group (לפי כיתה/קבוצה)
      pricing: { mode: kind === 'sale' ? 'none' : 'flat', flat: 0, groups: {} },
      products: [],
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

  function amountDue(project, person) {
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

  const STATUS_LABEL = { none: '—', paid: 'שולם', over: 'שולם ביתר', partial: 'שולם חלקית', unpaid: 'לא שולם' };

  function personRow(project, person) {
    const due = amountDue(project, person);
    const paid = paidBy(project, person.id);
    return { due, paid, balance: round2(due - paid), status: status(due, paid), participant: isParticipant(project, person) };
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
      counts: { paid: 0, partial: 0, unpaid: 0, over: 0 },
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
    for (const pr of db.projects) {
      const np = newProject(pr.name, pr.kind);
      for (const k of Object.keys(np)) if (pr[k] === undefined) pr[k] = np[k];
      pr.pricing = Object.assign({ mode: 'none', flat: 0, groups: {} }, pr.pricing);
      for (const p of pr.people) p.custom = p.custom || {};
    }
    return db;
  }

  return {
    migrate,
    PERSON_FIELDS, PAYMENT_METHODS, STATUS_LABEL,
    uid, num, round2, emptyDb, newProject, enrollment, ensureEnrollment,
    basePrice, isParticipant, amountDue, paidBy, status, personRow,
    normPhone, families, familyName, summary, splitFamilyPayment, fullName, money,
  };
});
