// מסך הפרויקטים: כרטיס לכל פרויקט, יצירה, שכפול והיסטוריה (ארכיון).
(function () {
  'use strict';
  const { el, Store, modal, field, select, toast, confirmBox } = UI;
  window.Views = window.Views || {};

  const KIND_LABEL = { camp: '🏕️ קייטנה / רישום', sale: '📚 מכירה / רכישת מוצרים' };
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
        showArchive ? null : el('p', null, 'פרויקט הוא למשל "קייטנת קיץ", "קייטנת אחרי סוכות" או "מכירת ספרים". לכל פרויקט מחיר, רישום, תשלומים והוצאות משלו, על אותה רשימת אנשים.'),
        showArchive ? null : el('button', { class: 'btn primary', onclick: () => newProjectDialog() }, '➕ פרויקט ראשון')));
      return;
    }
    const cards = el('div', { class: 'project-cards' });
    for (const pr of list) {
      const s = Logic.summary(pr, db.people);
      const pct = s.due > 0 ? Math.min(100, Math.round((s.paid / s.due) * 100)) : 0;
      cards.appendChild(el('div', { class: 'card project-card', onclick: () => App.go('project', { id: pr.id }) },
        el('div', { class: 'kind' }, KIND_LABEL[pr.kind] || ''),
        el('h2', { style: { margin: '4px 0 2px' } }, pr.name),
        el('div', { class: 'muted small' }, 'נוצר ' + UI.fmtDate(pr.createdAt)),
        el('div', { class: 'progress' }, el('div', { style: { width: pct + '%' } })),
        el('div', { class: 'small' }, `${s.participants} משתתפים · שולם ${Logic.money(s.paid)} מתוך ${Logic.money(s.due)} (${pct}%)`),
        s.balance > 0 ? el('div', { class: 'small neg' }, 'נשאר לגבות ' + Logic.money(s.balance)) : null));
    }
    main.appendChild(cards);
  };

  function newProjectDialog() {
    const db = Store.db;
    const name = el('input', { type: 'text', placeholder: 'למשל: קייטנת אחרי סוכות תשפ"ז' });
    const kind = select([['camp', 'קייטנה / רישום (מחיר לכל משתתף)'], ['sale', 'מכירה (רשימת מוצרים ומחירים)']], 'camp');
    const copyFrom = select([['', 'פרויקט חדש לגמרי'], ...db.projects.map((p) => [p.id, 'להעתיק הגדרות מ: ' + p.name])], '');
    const copyPeople = el('input', { type: 'checkbox' });
    const copyPeopleRow = el('label', { class: 'check hidden' }, copyPeople, 'להעתיק גם את רשימת הנרשמים (בלי תשלומים)');
    copyFrom.addEventListener('change', () => copyPeopleRow.classList.toggle('hidden', !copyFrom.value));
    modal({
      title: 'פרויקט חדש',
      body: el('div', null,
        el('div', { class: 'form-row' }, field('שם הפרויקט', name)),
        el('div', { class: 'form-row' }, field('סוג', kind)),
        db.projects.length ? el('div', { class: 'form-row' }, field('מבוסס על', copyFrom)) : null,
        copyPeopleRow,
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
            if (copyPeople.checked) {
              for (const [pid, e] of Object.entries(src.enrollments)) {
                if (!e.registered && !Object.values(e.items || {}).some((q) => Logic.num(q) > 0)) continue;
                pr.enrollments[pid] = { registered: e.registered, items: Object.assign({}, e.items), discount: e.discount || 0, override: null, delivered: false, marks: {}, note: '' };
              }
            }
          }
          db.projects.push(pr);
          Store.commit();
          App.go('project', { id: pr.id, tab: 'settings' });
          toast('הפרויקט נוצר. עכשיו מגדירים מחיר' + (pr.kind === 'sale' ? ' ומוצרים' : ''));
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
