// מסך הפרויקטים: כרטיס לכל פרויקט, יצירה, שכפול והיסטוריה (ארכיון).
(function () {
  'use strict';
  const { el, Store, modal, field, select, toast, confirmBox } = UI;
  window.Views = window.Views || {};

  const KIND_LABEL = { camp: '🏕️ קייטנה / רישום', sale: '📚 מכירה / רכישת מוצרים', list: '📝 רשימה (רישום דרך גורם אחר)' };
  let showArchive = false;

  Views.projects = function (main) {
    const db = Store.db;
    main.appendChild(el('div', { class: 'page-head' },
      el('h1', null, 'פרויקטים'),
      el('div', { class: 'grow' }),
      el('button', { class: 'btn primary', onclick: () => newProjectDialog() }, '➕ פרויקט חדש'),
      el('button', { class: 'btn', onclick: () => { showArchive = !showArchive; App.render(); } }, showArchive ? 'הצג פעילים' : '🗂️ היסטוריה / ארכיון')));

    const list = db.projects.filter((p) => !!p.archived === showArchive).slice().reverse();
    if (!list.length) {
      main.appendChild(el('div', { class: 'card empty' },
        el('div', { class: 'big' }, showArchive ? '🗂️' : '📁'),
        el('h2', null, showArchive ? 'אין פרויקטים בארכיון' : 'עוד אין פרויקטים'),
        showArchive ? null : el('p', null, 'פרויקט הוא למשל "קייטנת קיץ", "קייטנת אחרי סוכות" או "מכירת ספרים". לכל פרויקט רשימת אנשים, מחיר, רישום, תשלומים והוצאות משלו.'),
        showArchive ? null : el('button', { class: 'btn primary', onclick: () => newProjectDialog() }, '➕ פרויקט ראשון')));
      return;
    }
    const cards = el('div', { class: 'project-cards' });
    for (const pr of list) {
      const s = Logic.summary(pr, pr.people);
      const pct = s.due > 0 ? Math.min(100, Math.round((s.paid / s.due) * 100)) : 0;
      cards.appendChild(el('div', { class: 'card project-card', onclick: () => App.go('project', { id: pr.id }) },
        el('div', { class: 'kind' }, KIND_LABEL[pr.kind] || ''),
        el('h2', { style: { margin: '4px 0 2px' } }, pr.name),
        el('div', { class: 'muted small' }, 'נוצר ' + UI.fmtDate(pr.createdAt)),
        pr.kind === 'list' ? el('div', { class: 'small', style: { marginTop: '10px' } }, `${pr.people.length} ברשימה`) : [
          el('div', { class: 'progress' }, el('div', { style: { width: pct + '%' } })),
          el('div', { class: 'small' }, `${pr.people.length} ברשימה · ${s.participants} משתתפים · שולם ${Logic.money(s.paid)} מתוך ${Logic.money(s.due)} (${pct}%)`),
          s.covered ? el('div', { class: 'small', style: { color: '#6b3fd1' } }, Object.entries(s.coveredBy).map(([l, v]) => `${v.count} פטורים דרך ${l}`).join(' · ')) : null,
          s.balance > 0 ? el('div', { class: 'small neg' }, 'נשאר לגבות ' + Logic.money(s.balance)) : null]));
    }
    main.appendChild(cards);
  };

  function newProjectDialog() {
    const db = Store.db;
    const name = el('input', { type: 'text', placeholder: 'למשל: קייטנת אחרי סוכות תשפ"ז' });
    const kind = select([['camp', 'קייטנה / רישום (מחיר לכל משתתף)'], ['sale', 'מכירה (רשימת מוצרים ומחירים)'], ['list', 'רשימה בלבד - למשל רישום דרך העירייה / המנהל']], 'camp');
    const copyFrom = select([['', 'פרויקט חדש לגמרי'], ...db.projects.slice().reverse().map((p) => [p.id, 'להעתיק הגדרות מ: ' + p.name])], '');
    const peopleFrom = select([['', 'רשימת אנשים ריקה (אקליד או אייבא)'], ...db.projects.slice().reverse().filter((p) => p.people.length).map((p) => [p.id, 'להעתיק את רשימת האנשים מ: ' + p.name + ` (${p.people.length})`])], '');
    const onlyIn = el('input', { type: 'checkbox' });
    const copyMarks = el('input', { type: 'checkbox' });
    const peopleOpts = el('div', { class: 'hidden' },
      el('label', { class: 'check', style: { display: 'flex', marginBottom: '6px' } }, onlyIn, 'רק מי שהשתתף/ה שם'),
      el('label', { class: 'check', style: { display: 'flex' } }, copyMarks, 'להעתיק גם מי נרשם/ה ומה הזמין/ה (בלי תשלומים)'));
    copyFrom.addEventListener('change', () => { if (copyFrom.value && !peopleFrom.value && db.projects.find((p) => p.id === copyFrom.value).people.length) peopleFrom.value = copyFrom.value; peopleFrom.dispatchEvent(new Event('change')); });
    peopleFrom.addEventListener('change', () => peopleOpts.classList.toggle('hidden', !peopleFrom.value));
    modal({
      title: 'פרויקט חדש',
      body: el('div', null,
        el('div', { class: 'form-row' }, field('שם הפרויקט', name)),
        el('div', { class: 'form-row' }, field('סוג', kind)),
        db.projects.length ? el('div', { class: 'form-row' }, field('הגדרות (מחיר, מוצרים, עמודות סימון)', copyFrom)) : null,
        db.projects.some((p) => p.people.length) ? el('div', { class: 'form-row' }, field('רשימת אנשים', peopleFrom)) : null,
        peopleOpts,
        el('p', { class: 'muted small' }, 'אפשר לשנות הכול אחר כך: מחיר, מוצרים, עמודות סימון.')),
      buttons: [
        { label: 'צור', primary: true, onclick: () => {
          if (!name.value.trim()) { name.focus(); return false; }
          const pr = Logic.newProject(name.value.trim(), kind.value);
          const src = db.projects.find((p) => p.id === copyFrom.value);
          if (src) {
            pr.kind = src.kind;
            pr.pricing = JSON.parse(JSON.stringify(src.pricing));
            pr.products = src.products.map((x) => Object.assign({}, x));
            pr.marks = src.marks.map((x) => Object.assign({}, x));
          }
          const psrc = db.projects.find((p) => p.id === peopleFrom.value);
          if (psrc) {
            const chosen = psrc.people.filter((p) => !onlyIn.checked || Logic.isParticipant(psrc, p));
            const copied = Importer.copyPeople(chosen, psrc.columns, pr.columns, true);
            pr.hiddenFields = (psrc.hiddenFields || []).slice();
            Importer.merge(pr.people, copied.map((c) => c.person));
            // מוצרים מועתקים לפי שם, כי לכל פרויקט מזהים משלו.
            if (copyMarks.checked) {
              const prodByName = new Map(pr.products.map((x) => [x.name, x.id]));
              copied.forEach((c, i) => {
                const e = psrc.enrollments[c.srcId];
                if (!e) return;
                const target = pr.people[pr.people.length - copied.length + i];
                if (!target) return;
                const items = {};
                for (const x of psrc.products) { const id = prodByName.get(x.name); if (id && Logic.num((e.items || {})[x.id])) items[id] = e.items[x.id]; }
                pr.enrollments[target.id] = { registered: !!e.registered, items, discount: e.discount || 0, override: null, delivered: false, marks: {}, note: '' };
              });
            }
          }
          db.projects.push(pr);
          Store.commit();
          App.go('project', { id: pr.id, tab: 'settings' });
          toast('הפרויקט נוצר. עכשיו מגדירים מחיר' + (pr.kind === 'sale' ? ' ומוצרים' : '') + (pr.people.length ? '' : ', ואז מוסיפים אנשים'));
        } },
        { label: 'ביטול' },
      ],
    });
  }

  Views.duplicateProject = function (pr) {
    const copy = JSON.parse(JSON.stringify(pr));
    copy.id = Logic.uid();
    copy.name = pr.name + ' (עותק)';
    copy.createdAt = new Date().toISOString();
    copy.payments = [];
    copy.expenses = [];
    copy.archived = false;
    for (const e of Object.values(copy.enrollments)) { e.delivered = false; e.marks = {}; }
    Store.db.projects.push(copy);
    Store.commit();
    App.go('project', { id: copy.id, tab: 'settings' });
  };

  Views.deleteProject = async function (pr) {
    if (!(await confirmBox('מחיקת פרויקט', `למחוק לגמרי את "${pr.name}" עם כל הרישומים, התשלומים וההוצאות? (אפשר במקום זה להעביר לארכיון)`, 'מחק לגמרי'))) return;
    Store.db.projects = Store.db.projects.filter((p) => p !== pr);
    Store.commit();
    App.go('projects');
    toast('הפרויקט נמחק', { label: 'בטל', fn: () => { Store.undo(); App.render(); } });
  };

  Views.KIND_LABEL = KIND_LABEL;
})();
