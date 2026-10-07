// רשימת האנשים של פרויקט: הקלדה ידנית, עריכה בטבלה, עמודות מותאמות אישית, ייבוא (אופציונלי) וייצוא.
(function () {
  'use strict';
  const { el, clear, Store, toast, modal, confirmBox, field, select } = UI;
  window.Views = window.Views || {};

  // הפרויקט שמוצג עכשיו. לכל פרויקט רשימה משלו, ומצב החיפוש נשמר לכל פרויקט בנפרד.
  let cur = null;
  const states = {};
  let state = { q: '', cls: '', sort: null, dir: 1 };

  function visibleFields() {
    const hidden = new Set(cur.hiddenFields || []);
    return Logic.PERSON_FIELDS.filter((f) => !hidden.has(f.key));
  }

  function allColumns() {
    return [
      ...visibleFields().map((f) => ({ key: f.key, label: f.label, builtin: true })),
      ...cur.columns.map((c) => ({ key: 'col:' + c.id, label: c.name, type: c.type, colId: c.id })),
    ];
  }

  function getVal(p, col) {
    return col.colId ? (p.custom || {})[col.colId] : p[col.key];
  }

  function setVal(p, col, v) {
    if (col.colId) { p.custom = p.custom || {}; p.custom[col.colId] = v; } else p[col.key] = v;
  }

  function matches(p, q) {
    if (!q) return true;
    const hay = [p.firstName, p.lastName, p.cls, p.teacher, p.motherName, p.momPhone, p.dadPhone, p.homePhone, p.address, p.email, ...Object.values(p.custom || {})].join(' ').toLowerCase();
    const digits = hay.replace(/\D/g, '');
    // טלפון אפשר לחפש גם בלי מקפים: "0527" ימצא את "052-7..."
    return q.toLowerCase().split(/\s+/).every((w) => {
      const d = w.replace(/\D/g, '');
      return hay.includes(w) || (d.length >= 3 && d === w.replace(/-/g, '') && digits.includes(d));
    });
  }

  function classes() {
    return [...new Set(cur.people.map((p) => (p.cls || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  }

  function newPerson(data) {
    return Object.assign({ id: Logic.uid(), createdAt: new Date().toISOString(), firstName: '', lastName: '', cls: '', custom: {} }, data || {});
  }

  Views.projectPeople = function (main, project) {
    cur = project;
    state = states[project.id] || (states[project.id] = { q: '', cls: '', sort: null, dir: 1 });
    const db = { people: project.people };
    const famSize = new Map();
    for (const fam of Logic.families(db.people)) for (const m of fam) famSize.set(m.id, fam.length);

    const search = el('input', { type: 'search', placeholder: 'חיפוש לפי שם, טלפון, כתובת...', value: state.q, style: { width: '260px' } });
    const clsSel = select([['', 'כל הכיתות'], ...classes()], state.cls);
    const countEl = el('span', { class: 'muted' });

    main.appendChild(el('div', { class: 'toolbar' },
      el('strong', null, 'האנשים בפרויקט: ' + db.people.length),
      el('div', { class: 'grow' }),
      el('button', { class: 'btn primary', onclick: addOne }, '➕ הוסף אדם'),
      el('button', { class: 'btn', onclick: addMany }, '📝 הקלדת רשימה'),
      el('button', { class: 'btn', onclick: () => Views.importDialog(cur) }, '📥 ייבוא מאקסל / PDF'),
      otherProjects().length ? el('button', { class: 'btn', onclick: importFromProject }, '📋 ייבוא מפרויקט אחר') : null,
      el('button', { class: 'btn', onclick: exportPeople }, '📤 ייצוא לאקסל'),
      el('button', { class: 'btn', onclick: manageColumns }, '🧩 עמודות'),
    ));

    if (!db.people.length) {
      main.appendChild(el('div', { class: 'card empty' },
        el('div', { class: 'big' }, '👥'),
        el('h2', null, 'הרשימה ריקה'),
        el('p', null, 'אפשר להקליד שמות ישירות בתוכנה, להעתיק רשימה מפרויקט אחר, או (רק אם נוח) לייבא מקובץ אקסל או PDF.'),
        el('div', { class: 'toolbar', style: { justifyContent: 'center' } },
          el('button', { class: 'btn primary', onclick: addOne }, '➕ הוסף אדם'),
          el('button', { class: 'btn', onclick: addMany }, '📝 הקלדת רשימה'),
          otherProjects().length ? el('button', { class: 'btn', onclick: importFromProject }, '📋 ייבוא מפרויקט אחר') : null,
          el('button', { class: 'btn', onclick: () => Views.importDialog(cur) }, '📥 ייבוא מקובץ'))));
      return;
    }

    main.appendChild(el('div', { class: 'toolbar' }, search, clsSel, countEl));
    const wrap = el('div', { class: 'table-wrap' });
    main.appendChild(wrap);

    const cols = allColumns();

    function draw() {
      let list = db.people.filter((p) => matches(p, state.q) && (!state.cls || (p.cls || '').trim() === state.cls));
      if (state.sort) {
        const col = cols.find((c) => c.key === state.sort);
        if (col) list = list.slice().sort((a, b) => String(getVal(a, col) || '').localeCompare(String(getVal(b, col) || ''), 'he', { numeric: true }) * state.dir);
      }
      countEl.textContent = list.length === db.people.length ? '' : `מוצגים ${list.length} מתוך ${db.people.length}`;
      const head = el('tr', null, el('th', null, '#'),
        cols.map((c) => el('th', {
          class: 'sortable' + (c.type === 'check' ? ' center' : ''),
          onclick: () => { state.dir = state.sort === c.key ? -state.dir : 1; state.sort = c.key; draw(); },
        }, c.label + (state.sort === c.key ? (state.dir > 0 ? ' ▲' : ' ▼') : ''))),
        el('th', { title: 'מספר ילדים באותה משפחה (לפי טלפון הורים)' }, 'משפחה'), el('th', null, ''));
      const body = el('tbody');
      list.forEach((p, i) => {
        const tr = el('tr', null, el('td', { class: 'muted' }, i + 1));
        for (const c of cols) {
          let input;
          if (c.type === 'check') {
            input = el('input', { type: 'checkbox', checked: !!getVal(p, c), onchange: (e) => { setVal(p, c, e.target.checked ? 'V' : ''); Store.commit(); } });
            tr.appendChild(el('td', { class: 'center' }, input));
          } else {
            input = el('input', { type: 'text', value: getVal(p, c) || '', dir: Logic.PERSON_FIELDS.find((f) => f.key === c.key && f.phone) || c.key === 'email' ? 'ltr' : null,
              onchange: (e) => { setVal(p, c, e.target.value.trim()); Store.commit(); } });
            tr.appendChild(el('td', null, input));
          }
        }
        const fs = famSize.get(p.id) || 1;
        tr.appendChild(el('td', { class: 'center', title: fs > 1 ? 'ילדים מאותה משפחה: ' + fs : '' }, fs > 1 ? '👪 ' + fs : ''));
        tr.appendChild(el('td', null, el('button', { class: 'btn small ghost danger', title: 'מחק', onclick: () => removePerson(p) }, '🗑')));
        body.appendChild(tr);
      });
      clear(wrap).appendChild(el('table', { class: 'data' }, el('thead', null, head), body));
    }

    search.addEventListener('input', () => { state.q = search.value.trim(); draw(); });
    clsSel.addEventListener('change', () => { state.cls = clsSel.value; draw(); });
    draw();
  };

  function addOne() {
    const p = newPerson({ cls: state.cls || '' });
    cur.people.unshift(p);
    state.q = '';
    state.sort = null;
    App.changed();
    const first = document.querySelector('main table.data tbody tr td input[type=text]');
    if (first) first.focus();
  }

  // הדבקה או הקלדה של כמה שמות בבת אחת: שורה לכל אדם. אפשר להדביק עמודות מאקסל (עם טאבים).
  function addMany() {
    const ta = el('textarea', { style: { minHeight: '220px' }, placeholder: 'שורה לכל אדם, למשל:\nרחל כהן\nשרה לוי\n\nאו להדביק עמודות מאקסל (כולל שורת כותרת)' });
    const cls = el('input', { type: 'text', placeholder: 'למשל: א' });
    modal({
      title: 'הקלדת רשימת שמות',
      body: el('div', null,
        el('div', { class: 'help' }, 'כל שורה היא אדם אחד. מילה ראשונה = שם פרטי, השאר = שם משפחה. אם מדביקים מאקסל (עמודות עם טאב), התוכנה תזהה את העמודות לבד.'),
        ta, el('div', { style: { marginTop: '10px' } }, field('כיתה / קבוצה לכולם (לא חובה)', cls))),
      buttons: [
        { label: 'הוסף', primary: true, onclick: () => {
          const lines = ta.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          if (!lines.length) return false;
          if (lines.some((l) => l.includes('\t'))) {
            Views.importDialog(cur, { rows: lines.map((l) => l.split('\t')), name: 'הדבקה' });
            return;
          }
          const people = lines.map((l) => {
            const parts = l.split(/\s+/);
            return { firstName: parts[0], lastName: parts.slice(1).join(' '), cls: cls.value.trim() };
          });
          const r = Importer.merge(cur.people, people);
          App.changed();
          toast(`נוספו ${r.added} אנשים` + (r.same ? ` (${r.same} כבר היו ברשימה)` : ''));
        } },
        { label: 'ביטול' },
      ],
    });
  }

  async function removePerson(p) {
    const pr = cur;
    const name = Logic.fullName(p) || 'שורה ריקה';
    const pays = pr.payments.filter((x) => x.personId === p.id);
    const txt = pays.length
      ? `ל${name} רשומים ${pays.length} תשלומים בפרויקט. המחיקה תמחק גם אותם. אפשר לבטל עם Ctrl+Z.`
      : `למחוק את ${name} מהפרויקט? אפשר לבטל עם Ctrl+Z.`;
    if (Logic.fullName(p) && !(await confirmBox('מחיקה', txt, 'מחק'))) return;
    pr.people = pr.people.filter((x) => x.id !== p.id);
    delete pr.enrollments[p.id];
    pr.payments = pr.payments.filter((x) => x.personId !== p.id);
    App.changed();
    toast('נמחק', { label: 'בטל', fn: () => { Store.undo(); App.render(); } });
  }

  function otherProjects() {
    return Store.db.projects.filter((x) => x !== cur && x.people.length);
  }

  // העתקת רשימה מפרויקט אחר: כולם או רק חלק, עם או בלי העמודות, ואפשר לסמן מיד כנרשמים.
  function importFromProject() {
    const pr = cur;
    const srcSel = select(otherProjects().slice().reverse().map((x) => [x.id, x.name + ` (${x.people.length})`]), '');
    const who = select([
      ['all', 'כל האנשים'], ['in', 'רק מי שהשתתף/ה שם'], ['paid', 'רק מי ששילם/ה שם הכול'], ['debt', 'רק מי שחייב/ת שם'], ['out', 'רק מי שלא השתתף/ה שם'],
    ], 'all');
    const withCols = el('input', { type: 'checkbox', checked: true });
    const register = el('input', { type: 'checkbox' });
    const count = el('p', { class: 'muted' });
    const pick = () => {
      const src = Store.db.projects.find((x) => x.id === srcSel.value);
      if (!src) return [];
      return src.people.filter((p) => {
        const r = Logic.personRow(src, p);
        switch (who.value) {
          case 'in': return r.participant;
          case 'out': return !r.participant;
          case 'paid': return r.status === 'paid' || r.status === 'over';
          case 'debt': return r.balance > 0;
        }
        return true;
      });
    };
    const refresh = () => { count.textContent = `ייובאו ${pick().length} אנשים. מי שכבר ברשימה (אותו שם וכיתה) לא יוכפל - רק יושלמו פרטים חסרים.`; };
    srcSel.addEventListener('change', refresh);
    who.addEventListener('change', refresh);
    refresh();
    modal({
      title: 'ייבוא רשימה מפרויקט אחר',
      body: el('div', null,
        el('div', { class: 'form-row' }, field('מאיזה פרויקט', srcSel)),
        el('div', { class: 'form-row' }, field('את מי', who)),
        el('label', { class: 'check', style: { display: 'flex', marginBottom: '8px' } }, withCols, 'להעתיק גם את העמודות שלי (כמו "אלרגיות")'),
        pr.pricing.mode !== 'none' ? el('label', { class: 'check', style: { display: 'flex', marginBottom: '8px' } }, register, 'לסמן את כולם כנרשמים בפרויקט הזה') : null,
        count),
      buttons: [
        { label: 'ייבא', primary: true, onclick: () => {
          const src = Store.db.projects.find((x) => x.id === srcSel.value);
          const chosen = pick();
          if (!src || !chosen.length) { toast('אין את מי לייבא'); return false; }
          const copied = Importer.copyPeople(chosen, src.columns, pr.columns, withCols.checked);
          const r = Importer.merge(pr.people, copied.map((c) => c.person));
          if (register.checked) {
            const keys = new Set(copied.map((c) => Importer.personKey(c.person)));
            for (const p of pr.people) if (keys.has(Importer.personKey(p))) Logic.ensureEnrollment(pr, p.id).registered = true;
          }
          App.changed();
          toast(`נוספו ${r.added} אנשים מ"${src.name}"` + (r.updated ? `, ${r.updated} עודכנו` : '') + (r.same ? `, ${r.same} כבר היו` : ''));
        } },
        { label: 'ביטול' },
      ],
    });
  }

  function manageColumns() {
    const db = cur;
    const body = el('div');
    const draw = () => {
      clear(body);
      body.appendChild(el('h3', null, 'עמודות קבועות'));
      body.appendChild(el('p', { class: 'muted small' }, 'אפשר להסתיר עמודות שלא צריך. הנתונים לא נמחקים.'));
      const hidden = new Set(db.hiddenFields || []);
      body.appendChild(el('div', { class: 'chips', style: { marginBottom: '16px' } }, Logic.PERSON_FIELDS.map((f) =>
        el('label', { class: 'chip check' }, el('input', { type: 'checkbox', checked: !hidden.has(f.key), onchange: (e) => {
          const h = new Set(db.hiddenFields || []);
          e.target.checked ? h.delete(f.key) : h.add(f.key);
          db.hiddenFields = [...h];
          Store.commit();
        } }), f.label))));
      body.appendChild(el('h3', null, 'עמודות שלי'));
      if (!db.columns.length) body.appendChild(el('p', { class: 'muted' }, 'עוד אין. למשל: "אלרגיות", "אישור הורים", "מספר נעליים".'));
      for (const c of db.columns) {
        body.appendChild(el('div', { class: 'toolbar' },
          el('input', { type: 'text', value: c.name, onchange: (e) => { c.name = e.target.value.trim() || c.name; Store.commit(); } }),
          select([['text', 'טקסט'], ['check', 'סימון V']], c.type, { onchange: (e) => { c.type = e.target.value; Store.commit(); } }),
          el('button', { class: 'btn small danger', onclick: async () => {
            if (!(await confirmBox('מחיקת עמודה', `למחוק את העמודה "${c.name}" ואת כל הערכים שבה?`, 'מחק'))) return;
            db.columns = db.columns.filter((x) => x !== c);
            for (const p of db.people) if (p.custom) delete p.custom[c.id];
            Store.commit();
            draw();
          } }, 'מחק')));
      }
      const name = el('input', { type: 'text', placeholder: 'שם העמודה החדשה' });
      const type = select([['text', 'טקסט'], ['check', 'סימון V']], 'text');
      body.appendChild(el('div', { class: 'toolbar', style: { marginTop: '12px' } }, name, type,
        el('button', { class: 'btn primary', onclick: () => {
          if (!name.value.trim()) return;
          db.columns.push({ id: Logic.uid(), name: name.value.trim(), type: type.value });
          Store.commit();
          draw();
        } }, 'הוסף עמודה')));
    };
    draw();
    modal({ title: 'ניהול עמודות', body, onclose: () => App.render() });
  }

  function exportPeople() {
    const cols = [...Logic.PERSON_FIELDS.map((f) => ({ key: f.key, label: f.label })), ...cur.columns.map((c) => ({ key: 'col:' + c.id, label: c.name, colId: c.id }))];
    const rows = [cols.map((c) => c.label)];
    for (const p of cur.people) rows.push(cols.map((c) => (c.colId ? (p.custom || {})[c.colId] : p[c.key]) || ''));
    Views.saveXlsx(cur.name + ' - רשימת אנשים.xlsx', [{ name: 'אנשים', rows }]);
  }

  Views.saveXlsx = async function (name, sheets) {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      ws['!cols'] = (s.rows[0] || []).map((_, i) => ({ wch: Math.min(40, Math.max(8, ...s.rows.map((r) => String(r[i] === undefined ? '' : r[i]).length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    }
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const saved = await window.api.saveFile({ defaultName: name, filters: [{ name: 'Excel', extensions: ['xlsx'] }], data });
    if (saved) toast('נשמר: ' + saved);
  };

  Views.newPerson = newPerson;
})();
