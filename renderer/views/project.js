// מסך פרויקט: רישום/רכישות, תשלומים, הוצאות, סיכום, הזמנה וחלוקה, הגדרות.
(function () {
  'use strict';
  const { el, clear, Store, toast, modal, confirmBox, field, select, kpi, pill, fmtDate, today } = UI;
  const L = Logic;
  window.Views = window.Views || {};

  const TABS = [
    ['people', '👥 אנשים'],
    ['list', '📋 רישום ורכישות'],
    ['payments', '💰 תשלומים'],
    ['expenses', '🧾 הוצאות'],
    ['summary', '📊 סיכום'],
    ['supply', '📦 הזמנה וחלוקה'],
    ['settings', '⚙️ הגדרות הפרויקט'],
  ];

  // מצב סינון לכל פרויקט, נשמר בזמן המעבר בין לשוניות.
  const filters = {};
  function F(pr) {
    return filters[pr.id] || (filters[pr.id] = { q: '', cls: '', show: 'all', family: false });
  }

  // הפרויקט שמוצג. לכל פרויקט רשימת אנשים משלו.
  let cur = null;
  function people() { return cur.people; }
  function personById(id) { return cur.people.find((p) => p.id === id); }
  function label(p) { return p ? (L.fullName(p) || '(ללא שם)') + (p.cls ? ' · ' + p.cls : '') : '(נמחק)'; }

  Views.project = function (main, pr, tab) {
    cur = pr;
    if (!tab) tab = pr.people.length ? 'list' : 'people';
    main.appendChild(el('div', { class: 'page-head' },
      el('button', { class: 'btn ghost', onclick: () => App.go('projects'), title: 'לכל הפרויקטים' }, '→'),
      el('div', null, el('div', { class: 'muted small' }, Views.KIND_LABEL[pr.kind] + (pr.archived ? ' · בארכיון' : '')), el('h1', null, pr.name)),
      el('div', { class: 'grow' }),
      pr.kind === 'list' ? null : el('button', { class: 'btn', onclick: () => paymentDialog(pr) }, '💰 תשלום חדש'),
      el('button', { class: 'btn', onclick: () => exportProject(pr) }, '📤 ייצוא לאקסל')));
    const hide = pr.kind === 'list' ? ['payments', 'expenses', 'supply'] : [];
    main.appendChild(el('div', { class: 'tabs' }, TABS.filter(([k]) => !hide.includes(k)).map(([k, l]) => [k, pr.kind === 'list' && k === 'list' ? '📋 מי רשום' : l]).map(([k, l]) =>
      el('button', { class: 'tab' + (k === tab ? ' active' : ''), onclick: () => App.go('project', { id: pr.id, tab: k }) }, l))));
    const body = el('div');
    main.appendChild(body);
    ({ people: Views.projectPeople, list: listTab, payments: paymentsTab, expenses: expensesTab, summary: summaryTab, supply: supplyTab, settings: settingsTab }[tab] || listTab)(body, pr);
  };

  // ---------- רישום ורכישות ----------
  function listTab(root, pr) {
    const f = F(pr);
    // פרויקט מסוג "רשימה" (למשל רישום דרך העירייה): רק מי רשום וסימונים, בלי כסף.
    const isList = pr.kind === 'list';
    const hasBase = pr.pricing.mode !== 'none' || isList;
    const money = !isList;
    if (!hasBase && !pr.products.length) {
      root.appendChild(el('div', { class: 'card empty' },
        el('div', { class: 'big' }, '⚙️'),
        el('h2', null, 'קודם מגדירים מחיר או מוצרים'),
        el('p', null, pr.kind === 'sale' ? 'הוסיפו את רשימת המוצרים (למשל ספרים) והמחיר של כל אחד.' : 'הגדירו את מחיר הקייטנה (אחיד, או לפי כיתה).'),
        el('button', { class: 'btn primary', onclick: () => App.go('project', { id: pr.id, tab: 'settings' }) }, 'להגדרות הפרויקט')));
      return;
    }
    if (!people().length) {
      root.appendChild(el('div', { class: 'card empty' },
        el('div', { class: 'big' }, '👥'), el('h2', null, 'אין עדיין אנשים ברשימה'),
        el('p', null, 'מקלידים שמות, מעתיקים רשימה מפרויקט אחר, או מייבאים מקובץ - בלשונית "אנשים".'),
        el('button', { class: 'btn primary', onclick: () => App.go('project', { id: pr.id, tab: 'people' }) }, 'ללשונית האנשים')));
      return;
    }

    const search = el('input', { type: 'search', placeholder: 'חיפוש...', value: f.q, style: { width: '220px' } });
    const classes = [...new Set(people().map((p) => (p.cls || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
    const clsSel = select([['', 'כל הכיתות'], ...classes], f.cls);
    const showSel = select([
      ['all', 'כולם'], ['in', 'רק משתתפים'], ['out', 'לא משתתפים'],
      ['unpaid', 'לא שילמו'], ['partial', 'שילמו חלקית'], ['debt', 'כל מי שחייב'], ['paid', 'שילמו הכול'], ['covered', 'פטורים / מכוסים מפרויקט מקושר'],
    ], f.show);
    const famBox = el('input', { type: 'checkbox', checked: f.family });
    const info = el('span', { class: 'muted small' });
    root.appendChild(el('div', { class: 'toolbar' }, search, clsSel, showSel,
      el('label', { class: 'check' }, famBox, 'תצוגת משפחות'), el('div', { class: 'grow' }), info));
    const wrap = el('div', { class: 'table-wrap' });
    root.appendChild(wrap);

    const pidList = pr.products;
    const marks = pr.marks;
    // עמודות סימון מרשימת האנשים (למשל "אישור" שיובא מאקסל) מוצגות גם כאן - אותו נתון בשני המקומות.
    const pcols = pr.columns.filter((c) => c.type === 'check' && c.showInList !== false);

    function passes(p) {
      if (f.cls && (p.cls || '').trim() !== f.cls) return false;
      if (f.q) {
        const hay = [p.firstName, p.lastName, p.cls, p.teacher, p.momPhone, p.dadPhone].join(' ');
        if (!f.q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (f.show === 'all') return true;
      const r = L.personRow(pr, p);
      switch (f.show) {
        case 'in': return r.participant;
        case 'out': return !r.participant;
        case 'unpaid': return r.status === 'unpaid';
        case 'partial': return r.status === 'partial';
        case 'debt': return r.balance > 0;
        case 'paid': return r.status === 'paid' || r.status === 'over';
        case 'covered': return r.covered > 0;
      }
      return true;
    }

    let footer;
    function draw() {
      const list = people().filter(passes);
      const head = el('tr', null,
        el('th', null, 'שם'), el('th', null, 'כיתה'),
        hasBase ? el('th', { class: 'center' }, pr.kind === 'sale' ? 'דמי השתתפות' : 'נרשם/ה') : null,
        pidList.map((x) => el('th', { class: 'center', title: L.money(x.price) }, x.name, el('div', { class: 'muted small' }, L.money(x.price)))),
        marks.map((m) => el('th', { class: 'center' }, m.name)),
        pcols.map((c) => el('th', { class: 'center', title: 'עמודה מלשונית האנשים' }, c.name)),
        money ? [el('th', { class: 'num' }, 'הנחה'), el('th', { class: 'num' }, 'לתשלום'), el('th', { class: 'num' }, 'שולם'),
          el('th', { class: 'num' }, 'יתרה'), el('th', null, 'מצב')] : null, el('th', null, 'הערה'), money ? el('th', null, '') : null);
      const body = el('tbody');

      const addRow = (p) => {
        const e = L.enrollment(pr, p.id) || {};
        const cells = {};
        const recalc = () => {
          const r = L.personRow(pr, p);
          if (!money) { tr.classList.toggle('dim', !r.participant); return; }
          cells.due.textContent = r.due ? L.money(r.due) : '';
          cells.paid.textContent = r.paid ? L.money(r.paid) : '';
          cells.bal.textContent = r.balance ? L.money(r.balance) : '';
          cells.bal.className = 'num ' + (r.balance > 0 ? 'neg' : r.balance < 0 ? 'pos' : '');
          clear(cells.st).appendChild(r.status === 'covered' || r.covered
            ? el('span', { class: 'pill covered', title: `${L.money(r.covered)} מכוסה דרך "${r.coverLabel}"` }, (r.status === 'covered' ? 'פטור · ' : 'הנחה · ') + r.coverLabel)
            : pill(r.status));
          tr.classList.toggle('dim', !r.participant && !r.paid);
        };
        const touch = (fn) => { const en = L.ensureEnrollment(pr, p.id); fn(en); Store.commit(); recalc(); updateFooter(); };
        const tr = el('tr', null,
          el('td', null, L.fullName(p) || '(ללא שם)'),
          el('td', null, p.cls || ''),
          hasBase ? el('td', { class: 'center' }, el('input', { type: 'checkbox', checked: !!e.registered, title: L.money(L.basePrice(pr, p)), onchange: (ev) => touch((en) => { en.registered = ev.target.checked; }) })) : null,
          pidList.map((x) => el('td', { class: 'center' }, el('input', { type: 'number', min: 0, class: 'qty', value: (e.items || {})[x.id] || '', placeholder: '0',
            onchange: (ev) => touch((en) => { en.items[x.id] = Math.max(0, L.num(ev.target.value)); if (!en.items[x.id]) delete en.items[x.id]; }) }))),
          marks.map((m) => el('td', { class: 'center' }, el('input', { type: 'checkbox', checked: !!(e.marks || {})[m.id], onchange: (ev) => touch((en) => { en.marks[m.id] = ev.target.checked; }) }))),
          pcols.map((c) => el('td', { class: 'center' }, el('input', { type: 'checkbox', checked: L.isYes((p.custom || {})[c.id]),
            onchange: (ev) => { p.custom = p.custom || {}; p.custom[c.id] = ev.target.checked ? 'V' : ''; Store.commit(); updateFooter(); } }))),
          money ? [el('td', { class: 'num' }, el('input', { type: 'number', min: 0, class: 'qty', value: e.discount || '', placeholder: '0', title: 'הנחה בשקלים',
            onchange: (ev) => touch((en) => { en.discount = Math.max(0, L.num(ev.target.value)); }) })),
          cells.due = el('td', { class: 'num' }),
          cells.paid = el('td', { class: 'num' }),
          cells.bal = el('td', { class: 'num' }),
          cells.st = el('td')] : null,
          el('td', null, el('input', { type: 'text', value: e.note || '', placeholder: '', style: { minWidth: '120px' }, onchange: (ev) => touch((en) => { en.note = ev.target.value.trim(); }) })),
          money ? el('td', null,
            el('button', { class: 'btn small', title: 'רישום תשלום', onclick: () => paymentDialog(pr, p) }, '💰'),
            ' ',
            el('button', { class: 'btn small', title: 'קבלה / פירוט', onclick: () => receiptDialog(pr, p) }, '🧾')) : null);
        recalc();
        body.appendChild(tr);
      };

      if (f.family) {
        const fams = L.families(list).sort((a, b) => L.familyName(a).localeCompare(L.familyName(b), 'he'));
        const span = 2 + (hasBase ? 1 : 0) + pidList.length + marks.length + pcols.length;
        // קודם משפחות עם כמה ילדים (עם שורת סיכום משפחתית), ואחריהן ילדים יחידים בלי כותרת.
        const multi = fams.filter((fam) => fam.length > 1);
        const singles = fams.filter((fam) => fam.length === 1).map((fam) => fam[0]);
        for (const fam of multi) {
          if (!money) {
            body.appendChild(el('tr', { class: 'group-head' }, el('td', { colspan: 99 }, '👪 ' + L.familyName(fam) + ` (${fam.length})`)));
            fam.forEach(addRow);
            continue;
          }
          const due = fam.reduce((s, m) => s + L.amountDue(pr, m), 0);
          const paid = fam.reduce((s, m) => s + L.paidBy(pr, m.id), 0);
          body.appendChild(el('tr', { class: 'group-head' },
            el('td', { colspan: span }, '👪 ' + L.familyName(fam) + ` (${fam.length}) `, el('span', { dir: 'ltr', class: 'muted' }, fam[0].momPhone || fam[0].dadPhone || '')),
            el('td'), el('td', { class: 'num' }, L.money(due)), el('td', { class: 'num' }, L.money(paid)),
            el('td', { class: 'num ' + (due - paid > 0 ? 'neg' : '') }, L.money(due - paid)), el('td'), el('td'),
            el('td', null, due - paid > 0 ? el('button', { class: 'btn small', onclick: () => paymentDialog(pr, fam[0], fam) }, '💰 למשפחה') : null)));
          fam.forEach(addRow);
        }
        if (singles.length && multi.length) body.appendChild(el('tr', { class: 'group-head' }, el('td', { colspan: 99 }, 'ללא אחים ברשימה')));
        singles.forEach(addRow);
      } else {
        list.forEach(addRow);
      }
      footer = el('tfoot');
      clear(wrap).appendChild(el('table', { class: 'data' }, el('thead', null, head), body, footer));
      info.textContent = list.length === people().length ? `${list.length} אנשים` : `מוצגים ${list.length} מתוך ${people().length}`;
      updateFooter();

      function updateFooter() {
        const s = L.summary(pr, list);
        const regCount = list.filter((p) => (L.enrollment(pr, p.id) || {}).registered).length;
        clear(footer).appendChild(el('tr', null,
          el('td', null, 'סה"כ'), el('td', null, s.participants + ' משתתפים'),
          hasBase ? el('td', { class: 'center' }, regCount) : null,
          pidList.map((x) => el('td', { class: 'center' }, (s.products[x.id] || {}).qty || 0)),
          marks.map((m) => el('td', { class: 'center' }, list.filter((p) => ((L.enrollment(pr, p.id) || {}).marks || {})[m.id]).length)),
          pcols.map((c) => el('td', { class: 'center' }, list.filter((p) => L.isYes((p.custom || {})[c.id])).length)),
          money ? [el('td'), el('td', { class: 'num' }, L.money(s.due)), el('td', { class: 'num' }, L.money(s.paid)),
            el('td', { class: 'num neg' }, L.money(s.balance)), el('td', null, s.counts.covered ? s.counts.covered + ' פטורים' : '')] : null, el('td'), money ? el('td') : null));
      }
    }

    search.addEventListener('input', () => { f.q = search.value.trim(); draw(); });
    clsSel.addEventListener('change', () => { f.cls = clsSel.value; draw(); });
    showSel.addEventListener('change', () => { f.show = showSel.value; draw(); });
    famBox.addEventListener('change', () => { f.family = famBox.checked; draw(); });
    draw();
  }

  // ---------- תשלום ----------
  function personPicker(selected) {
    const input = el('input', { type: 'text', list: 'people-dl', placeholder: 'התחילו להקליד שם...', value: selected ? label(selected) : '' });
    const dl = el('datalist', { id: 'people-dl' }, people().map((p) => el('option', { value: label(p) })));
    const wrap = el('div', null, input, dl);
    wrap.getPerson = () => people().find((p) => label(p) === input.value.trim()) || null;
    wrap.input = input;
    return wrap;
  }

  function paymentDialog(pr, person, family, existing) {
    cur = pr;
    const picker = personPicker(person);
    const amount = el('input', { type: 'number', min: 0, step: 'any' });
    const method = select(L.PAYMENT_METHODS, existing ? existing.method : (Store.db.settings.lastMethod || 'מזומן'));
    const date = el('input', { type: 'date', value: existing ? existing.date : today() });
    const note = el('input', { type: 'text', placeholder: 'למשל: מספר צ\'ק, שם המעביר', value: existing ? existing.note || '' : '' });
    const balInfo = el('div', { class: 'muted small', style: { marginTop: '4px' } });
    const famBox = el('input', { type: 'checkbox', checked: !!family });
    const famRow = el('label', { class: 'check hidden', style: { marginBottom: '10px' } }, famBox, el('span'));
    const receiptBox = el('input', { type: 'checkbox', checked: !existing });

    const familyOf = (p) => (p ? L.families(people()).find((fam) => fam.some((m) => m.id === p.id)) || [p] : []);
    const refresh = () => {
      const p = picker.getPerson();
      if (!p) { balInfo.textContent = ''; famRow.classList.add('hidden'); return; }
      const fam = familyOf(p);
      const useFam = famBox.checked && fam.length > 1;
      const members = useFam ? fam : [p];
      const bal = members.reduce((s, m) => s + L.amountDue(pr, m) - L.paidBy(pr, m.id), 0);
      balInfo.textContent = (useFam ? 'יתרה של כל המשפחה: ' : 'יתרה לתשלום: ') + L.money(bal);
      famRow.classList.toggle('hidden', fam.length < 2 || !!existing);
      famRow.lastChild.textContent = `תשלום לכל המשפחה (${fam.map((m) => m.firstName).join(', ')}) - יתחלק אוטומטית לפי החובות`;
      if (!existing && !amount.dataset.touched) amount.value = bal > 0 ? L.round2(bal) : '';
    };
    amount.addEventListener('input', () => { amount.dataset.touched = '1'; });
    if (existing) { amount.value = existing.amount; amount.dataset.touched = '1'; }
    picker.input.addEventListener('change', refresh);
    picker.input.addEventListener('input', refresh);
    famBox.addEventListener('change', refresh);
    refresh();

    modal({
      title: existing ? 'עריכת תשלום' : 'רישום תשלום',
      body: el('div', null,
        el('div', { class: 'form-row' }, field('מי שילם/ה', picker)),
        famRow,
        el('div', { class: 'form-row' }, el('div', null, field('סכום (₪)', amount), balInfo), field('אמצעי תשלום', method)),
        el('div', { class: 'form-row' }, field('תאריך', date), field('הערה', note)),
        existing ? null : el('label', { class: 'check' }, receiptBox, 'להציג קבלה אחרי השמירה')),
      buttons: [
        { label: 'שמור', primary: true, onclick: () => {
          const p = picker.getPerson();
          const amt = L.round2(L.num(amount.value));
          if (!p) { picker.input.focus(); toast('בחרו אדם מהרשימה'); return false; }
          if (!amt) { amount.focus(); return false; }
          Store.db.settings.lastMethod = method.value;
          if (existing) {
            Object.assign(existing, { personId: p.id, amount: amt, method: method.value, date: date.value, note: note.value.trim() });
            App.changed();
            return;
          }
          const fam = familyOf(p);
          const parts = famBox.checked && fam.length > 1 ? L.splitFamilyPayment(pr, fam, amt) : [{ personId: p.id, amount: amt }];
          const receiptNo = Store.db.settings.nextReceiptNo++;
          const created = parts.map((part) => ({ id: L.uid(), personId: part.personId, amount: part.amount, method: method.value, date: date.value, note: note.value.trim(), receiptNo, createdAt: new Date().toISOString() }));
          pr.payments.push(...created);
          for (const part of parts) L.ensureEnrollment(pr, part.personId);
          App.changed();
          toast(`נרשם תשלום ${L.money(amt)} · קבלה מס' ${receiptNo}`);
          if (receiptBox.checked) setTimeout(() => receiptDialog(pr, p, receiptNo), 50);
        } },
        { label: 'ביטול' },
      ],
    });
  }
  Views.paymentDialog = paymentDialog;

  // ---------- תשלומים ----------
  function paymentsTab(root, pr) {
    const search = el('input', { type: 'search', placeholder: 'חיפוש לפי שם או הערה...' });
    const methodSel = select([['', 'כל אמצעי התשלום'], ...L.PAYMENT_METHODS], '');
    const total = el('strong');
    root.appendChild(el('div', { class: 'toolbar' }, search, methodSel, el('div', { class: 'grow' }), total,
      el('button', { class: 'btn primary', onclick: () => paymentDialog(pr) }, '➕ תשלום חדש')));
    const wrap = el('div', { class: 'table-wrap' });
    root.appendChild(wrap);
    const draw = () => {
      const q = search.value.trim();
      const list = pr.payments.filter((x) => {
        if (methodSel.value && x.method !== methodSel.value) return false;
        if (!q) return true;
        return (label(personById(x.personId)) + ' ' + (x.note || '')).includes(q);
      }).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
      total.textContent = `${list.length} תשלומים · ${L.money(list.reduce((s, x) => s + L.num(x.amount), 0))}`;
      if (!pr.payments.length) {
        clear(wrap).appendChild(el('div', { class: 'empty' }, el('div', { class: 'big' }, '💰'), 'עוד לא נרשמו תשלומים. אפשר לרשום מכאן, או בכפתור 💰 ליד כל שם ברשימה.'));
        return;
      }
      const body = el('tbody', null, list.map((x) => {
        const p = personById(x.personId);
        return el('tr', null,
          el('td', null, fmtDate(x.date)), el('td', null, label(p)), el('td', { class: 'num' }, L.money(x.amount)),
          el('td', null, x.method || ''), el('td', null, x.note || ''), el('td', { class: 'num' }, x.receiptNo || ''),
          el('td', null,
            el('button', { class: 'btn small', title: 'קבלה', onclick: () => p && receiptDialog(pr, p, x.receiptNo) }, '🧾'), ' ',
            el('button', { class: 'btn small', title: 'עריכה', onclick: () => paymentDialog(pr, p, null, x) }, '✏️'), ' ',
            el('button', { class: 'btn small danger', title: 'מחיקה', onclick: async () => {
              if (!(await confirmBox('מחיקת תשלום', `למחוק תשלום של ${L.money(x.amount)} מ${label(p)}?`, 'מחק'))) return;
              pr.payments = pr.payments.filter((y) => y !== x);
              App.changed();
            } }, '🗑')));
      }));
      clear(wrap).appendChild(el('table', { class: 'data' },
        el('thead', null, el('tr', null, ['תאריך', 'שם', 'סכום', 'אמצעי', 'הערה', 'קבלה', ''].map((h, i) => el('th', { class: i === 2 || i === 5 ? 'num' : '' }, h)))), body));
    };
    search.addEventListener('input', draw);
    methodSel.addEventListener('change', draw);
    draw();
  }

  // ---------- הוצאות ----------
  function expensesTab(root, pr) {
    const name = el('input', { type: 'text', placeholder: 'על מה? (למשל: זמרת, גרפיכל, נסיעות)', list: 'exp-dl' });
    const dl = el('datalist', { id: 'exp-dl' }, [...new Set(Store.db.projects.flatMap((p) => p.expenses.map((x) => x.name)))].map((n) => el('option', { value: n })));
    const amount = el('input', { type: 'number', min: 0, step: 'any', placeholder: 'סכום', style: { width: '110px' } });
    const method = select(L.PAYMENT_METHODS, 'מזומן');
    const date = el('input', { type: 'date', value: today() });
    const note = el('input', { type: 'text', placeholder: 'הערה' });
    const supplierOptions = [['', 'ספק (לא חובה)']].concat(pr.suppliers.map((x) => [x.id, x.name]));
    const supplier = pr.suppliers.length ? select(supplierOptions, '') : null;
    const add = () => {
      if (!name.value.trim() || !L.num(amount.value)) { (name.value.trim() ? amount : name).focus(); return; }
      const ex = { id: L.uid(), name: name.value.trim(), amount: L.round2(L.num(amount.value)), method: method.value, date: date.value, note: note.value.trim() };
      if (supplier && supplier.value) ex.supplierId = supplier.value;
      pr.expenses.push(ex);
      App.changed();
      setTimeout(() => { const n = document.querySelector('main input[list=exp-dl]'); if (n) n.focus(); }, 20);
    };
    for (const i of [name, amount, note]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    const s = L.summary(pr, people());
    root.appendChild(Views.suppliersCard(pr, s));
    root.appendChild(el('div', { class: 'card', style: { marginBottom: '14px' } },
      el('h3', null, 'הוספת הוצאה'),
      el('div', { class: 'toolbar', style: { marginBottom: 0 } }, name, dl, amount, supplier, method, date, note, el('button', { class: 'btn primary', onclick: add }, 'הוסף'))));
    root.appendChild(el('div', { class: 'grid kpis', style: { marginBottom: '14px' } },
      kpi('סה"כ הוצאות', L.money(s.expenses), pr.expenses.length + ' פריטים', 'bad'),
      kpi('נגבה עד עכשיו', L.money(s.paid), null, 'ok'),
      kpi('נשאר בקופה', L.money(s.net), 'גבייה פחות הוצאות', s.net >= 0 ? 'ok' : 'bad'),
      kpi('צפוי בסוף', L.money(s.expectedNet), 'אם כולם ישלמו', 'accent')));
    if (!pr.expenses.length) return;
    const list = pr.expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    root.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', null, el('tr', null, el('th', null, 'תאריך'), el('th', null, 'הוצאה'), pr.suppliers.length ? el('th', null, 'ספק') : null, el('th', { class: 'num' }, 'סכום'), el('th', null, 'אמצעי'), el('th', null, 'הערה'), el('th', null, ''))),
      el('tbody', null, list.map((x) => el('tr', null,
        el('td', null, el('input', { type: 'date', value: x.date, onchange: (e) => { x.date = e.target.value; Store.commit(); } })),
        el('td', null, el('input', { type: 'text', value: x.name, onchange: (e) => { x.name = e.target.value.trim(); Store.commit(); } })),
        pr.suppliers.length ? el('td', null, select(supplierOptions, x.supplierId || '', { onchange: (e) => { if (e.target.value) x.supplierId = e.target.value; else delete x.supplierId; App.changed(); } })) : null,
        el('td', { class: 'num' }, el('input', { type: 'number', value: x.amount, style: { width: '110px' }, onchange: (e) => { x.amount = L.round2(L.num(e.target.value)); App.changed(); } })),
        el('td', null, select(L.PAYMENT_METHODS, x.method, { onchange: (e) => { x.method = e.target.value; App.changed(); } })),
        el('td', null, el('input', { type: 'text', value: x.note || '', onchange: (e) => { x.note = e.target.value.trim(); Store.commit(); } })),
        el('td', null, el('button', { class: 'btn small danger', onclick: () => { pr.expenses = pr.expenses.filter((y) => y !== x); App.changed(); toast('ההוצאה נמחקה', { label: 'בטל', fn: () => { Store.undo(); App.render(); } }); } }, '🗑'))))),
      el('tfoot', null, el('tr', null, el('td'), el('td', null, 'סה"כ'), pr.suppliers.length ? el('td') : null, el('td', { class: 'num' }, L.money(s.expenses)), el('td'), el('td'), el('td'))))));
  }

  // ---------- סיכום סופי: כל ההכנסות, כולל מה שמגיע מהמנהל / גורמים מקושרים ----------
  function finalRows(f) {
    const rows = [['שולם על ידי המשתתפים', f.fromPeople]];
    for (const x of f.bySource) rows.push([`${x.label} (${x.count} משתתפים)`, x.amount]);
    return rows;
  }

  function finalCard(pr, s) {
    const f = L.finalSummary(pr, s);
    const row = (label, val, cls) => el('tr', { class: cls || '' }, el('td', null, label), el('td', { class: 'num' }, L.money(val)));
    return el('div', { class: 'card final-card', style: { marginBottom: '16px' } },
      el('div', { class: 'toolbar' }, el('h3', { style: { margin: 0 } }, '🧮 סיכום סופי - כל ההכנסות'), el('div', { class: 'grow' }),
        el('button', { class: 'btn small', onclick: () => printFinal(pr, f) }, '🖨️ הדפסה')),
      el('table', { class: 'data' }, el('tbody', null,
        finalRows(f).map(([l, v]) => row(l, v)),
        row('סה"כ הכנסות', f.income, 'total'),
        row('הוצאות', -f.expenses),
        row('רווח נקי (אחרי הוצאות)', f.net, 'total ' + (f.net >= 0 ? 'pos' : 'neg')))),
      f.stillToCollect > 0 ? el('p', { class: 'muted small', style: { marginTop: '8px' } },
        `עוד נשאר לגבות מהמשתתפים ${L.money(f.stillToCollect)}. כשכולם ישלמו: הכנסות ${L.money(f.expectedIncome)}, רווח נקי ${L.money(f.expectedNet)}.`) : null,
      f.fromSources ? el('p', { class: 'muted small' }, 'הסכום מהמנהל / גורמים מקושרים נלקח מהרישום בפרויקטים המקושרים (הגדרות הפרויקט ← קישור).') : null);
  }

  function printFinal(pr, f) {
    printNode(printTable(`${pr.name} - סיכום סופי`, ['סעיף', 'סכום'],
      finalRows(f).map(([l, v]) => [l, L.money(v)])
        .concat([['סה"כ הכנסות', L.money(f.income)], ['הוצאות', L.money(-f.expenses)], ['רווח נקי (אחרי הוצאות)', L.money(f.net)]])
        .concat(f.stillToCollect > 0 ? [['עוד נשאר לגבות מהמשתתפים', L.money(f.stillToCollect)], ['רווח נקי כשכולם ישלמו', L.money(f.expectedNet)]] : [])));
  }

  // ---------- סיכום ----------
  function summaryTab(root, pr) {
    const s = L.summary(pr, people());
    const pct = s.due ? Math.round((s.paid / s.due) * 100) : 0;
    root.appendChild(finalCard(pr, s));
    root.appendChild(el('div', { class: 'grid kpis', style: { marginBottom: '16px' } },
      kpi('משתתפים', s.participants, `${s.counts.paid + s.counts.over} שילמו הכול · ${s.counts.partial} חלקית · ${s.counts.unpaid} לא שילמו`),
      kpi('סה"כ לתשלום', L.money(s.due), 'של כל המשתתפים', 'accent'),
      kpi('שולם', L.money(s.paid), pct + '% מהסכום', 'ok'),
      kpi('נשאר לגבות', L.money(s.balance), s.overpaid ? 'שולם ביתר: ' + L.money(s.overpaid) : null, s.balance ? 'bad' : 'ok'),
      s.covered ? kpi('מכוסה דרך פרויקטים מקושרים', L.money(s.covered), Object.entries(s.coveredBy).map(([l, v]) => `${l}: ${v.count} (${L.money(v.amount)})`).join(' · '), 'accent') : null,
      kpi('הוצאות', L.money(s.expenses)),
      kpi('מאזן עכשיו', L.money(s.net), 'שולם פחות הוצאות', s.net >= 0 ? 'ok' : 'bad'),
      kpi('מאזן צפוי', L.money(s.expectedNet), 'כשכולם ישלמו', 'accent'),
      kpi('מזומן שאמור להיות בקופה', L.money(s.cashOnHand), 'מזומן שהתקבל פחות הוצאות במזומן')));

    const groups = Object.entries(s.byGroup).sort((a, b) => a[0].localeCompare(b[0], 'he'));
    const maxDue = Math.max(1, ...groups.map(([, g]) => g.due));
    const byGroupCard = el('div', { class: 'card' }, el('h3', null, 'לפי כיתה / קבוצה'),
      groups.map(([name, g]) => el('div', { class: 'bar-row' },
        el('div', null, name, el('span', { class: 'muted small' }, ` (${g.participants})`)),
        el('div', { class: 'bar', title: `שולם ${L.money(g.paid)} מתוך ${L.money(g.due)}` },
          el('div', { class: 'paid', style: { width: (Math.min(g.paid, g.due) / maxDue) * 100 + '%' } }),
          el('div', { class: 'due', style: { width: (Math.max(0, g.due - g.paid) / maxDue) * 100 + '%' } })),
        el('div', { class: 'small' }, L.money(g.paid) + ' / ' + L.money(g.due)))),
      groups.length ? el('div', { class: 'muted small' }, '🟩 שולם  ·  🟥 נשאר לגבות') : el('p', { class: 'muted' }, 'אין עדיין נתונים'));

    const methodCard = el('div', { class: 'card' }, el('h3', null, 'לפי אמצעי תשלום'),
      el('table', { class: 'data' }, el('tbody', null,
        Object.entries(s.byMethod).map(([m, v]) => el('tr', null, el('td', null, m), el('td', { class: 'num' }, L.money(v)), el('td', { class: 'num muted' }, s.expensesByMethod[m] ? 'הוצאות: ' + L.money(s.expensesByMethod[m]) : ''))),
        Object.keys(s.byMethod).length ? null : el('tr', null, el('td', { class: 'muted' }, 'עוד אין תשלומים')))));

    const prodCard = pr.products.length ? el('div', { class: 'card' }, el('h3', null, 'לפי מוצר'),
      el('table', { class: 'data' }, el('thead', null, el('tr', null, el('th', null, 'מוצר'), el('th', { class: 'num' }, 'כמות'), el('th', { class: 'num' }, 'קונים'), el('th', { class: 'num' }, 'סכום'))),
        el('tbody', null, pr.products.map((x) => { const ps = s.products[x.id] || { qty: 0, buyers: 0, amount: 0 }; return el('tr', null, el('td', null, x.name), el('td', { class: 'num' }, ps.qty), el('td', { class: 'num' }, ps.buyers), el('td', { class: 'num' }, L.money(ps.amount))); })))) : null;

    root.appendChild(el('div', { class: 'grid cols-2', style: { marginBottom: '16px' } }, byGroupCard, methodCard, prodCard));

    // חייבים
    const debtors = people().map((p) => ({ p, r: L.personRow(pr, p) })).filter((x) => x.r.balance > 0)
      .sort((a, b) => (a.p.cls || '').localeCompare(b.p.cls || '', 'he') || (a.p.lastName || '').localeCompare(b.p.lastName || '', 'he'));
    const debtCard = el('div', { class: 'card' },
      el('div', { class: 'toolbar' }, el('h3', { style: { margin: 0 } }, `מי עוד חייב/ת (${debtors.length})`), el('div', { class: 'grow' }),
        debtors.length ? el('button', { class: 'btn small primary', onclick: () => Views.reminderDialog(pr) }, '📣 שליחת תזכורות') : null,
        debtors.length ? el('button', { class: 'btn small', onclick: () => printDebtors(pr, debtors) }, '🖨️ הדפסה') : null,
        debtors.length ? el('button', { class: 'btn small', onclick: () => {
          const phones = [...new Set(debtors.map((d) => L.normPhone(d.p.momPhone) || L.normPhone(d.p.dadPhone)).filter(Boolean))];
          navigator.clipboard.writeText(phones.join('\n'));
          toast(`הועתקו ${phones.length} מספרי טלפון`);
        } }, '📋 העתק טלפונים') : null),
      debtors.length ? el('div', { class: 'table-wrap', style: { maxHeight: '420px' } }, el('table', { class: 'data' },
        el('thead', null, el('tr', null, ['שם', 'כיתה', 'טלפון', 'לתשלום', 'שולם', 'יתרה', 'תזכורת אחרונה', ''].map((h, i) => el('th', { class: i >= 3 && i <= 5 ? 'num' : '' }, h)))),
        el('tbody', null, debtors.map(({ p, r }) => el('tr', null,
          el('td', null, L.fullName(p)), el('td', null, p.cls || ''), el('td', { dir: 'ltr' }, p.momPhone || p.dadPhone || p.homePhone || ''),
          el('td', { class: 'num' }, L.money(r.due)), el('td', { class: 'num' }, L.money(r.paid)), el('td', { class: 'num neg' }, L.money(r.balance)),
          el('td', { class: 'muted' }, UI.fmtDate((L.enrollment(pr, p.id) || {}).lastReminder || '')),
          el('td', null, el('button', { class: 'btn small', onclick: () => paymentDialog(pr, p) }, '💰'))))))) : el('p', { class: 'pos' }, '🎉 כולם שילמו!'));
    if ((pr.reminders || []).length) {
      const names = { email: 'מייל', tts: 'הודעה קולית', tzintuk: 'צינוק' };
      debtCard.appendChild(el('p', { class: 'muted small', style: { marginTop: '10px' } }, 'תזכורות אחרונות: ' + pr.reminders.slice(-5).reverse()
        .map((x) => `${UI.fmtDate(x.date)} ${names[x.channel] || x.channel} (${x.sent}${x.failed ? ', ' + x.failed + ' נכשלו' : ''})`).join(' · ')));
    }
    root.appendChild(debtCard);
  }

  // ---------- הזמנה וחלוקה ----------
  function supplyTab(root, pr) {
    const s = L.summary(pr, people());
    if (pr.products.length) root.appendChild(Views.supplierOrderCard(pr, s));
    const parts = people().filter((p) => L.isParticipant(pr, p)).sort((a, b) => (a.cls || '').localeCompare(b.cls || '', 'he') || (a.lastName || '').localeCompare(b.lastName || '', 'he'));
    const delivered = parts.filter((p) => (L.enrollment(pr, p.id) || {}).delivered).length;
    root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'toolbar' }, el('h3', { style: { margin: 0 } }, `חלוקה: ${delivered} מתוך ${parts.length} קיבלו`), el('div', { class: 'grow' }),
        el('button', { class: 'btn small', onclick: () => printDistribution(pr, parts) }, '🖨️ הדפסת רשימת חלוקה')),
      parts.length ? el('div', { class: 'table-wrap', style: { maxHeight: '520px' } }, el('table', { class: 'data' },
        el('thead', null, el('tr', null, el('th', { class: 'center' }, 'קיבל/ה'), el('th', null, 'שם'), el('th', null, 'כיתה'), el('th', null, 'מה'), el('th', null, 'מצב תשלום'))),
        el('tbody', null, parts.map((p) => {
          const e = L.enrollment(pr, p.id);
          return el('tr', null,
            el('td', { class: 'center' }, el('input', { type: 'checkbox', checked: !!e.delivered, onchange: (ev) => { e.delivered = ev.target.checked; App.changed(); } })),
            el('td', null, L.fullName(p)), el('td', null, p.cls || ''), el('td', null, itemsText(pr, e)),
            el('td', null, pill(L.personRow(pr, p).status)));
        })))) : el('p', { class: 'muted' }, 'אין עדיין משתתפים.')));
  }

  function itemsText(pr, e) {
    const out = [];
    if (e.registered && pr.pricing.mode !== 'none') out.push(pr.kind === 'sale' ? 'דמי השתתפות' : 'רישום');
    for (const x of pr.products) { const q = L.num((e.items || {})[x.id]); if (q) out.push(q > 1 ? `${x.name} ×${q}` : x.name); }
    return out.join(', ');
  }

  // ---------- הגדרות ----------
  function settingsTab(root, pr) {
    const db = Store.db;
    const isListKind = pr.kind === 'list';
    const name = el('input', { type: 'text', value: pr.name, onchange: (e) => { pr.name = e.target.value.trim() || pr.name; App.changed(); } });
    const kind = select([['camp', 'קייטנה / רישום'], ['sale', 'מכירת מוצרים'], ['list', 'רשימה בלבד (למשל רישום דרך עירייה / מנהל)']], pr.kind, { onchange: (e) => { pr.kind = e.target.value; App.changed(); } });
    root.appendChild(el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, 'כללי'),
      el('div', { class: 'form-row' }, field('שם הפרויקט', name), field('סוג', kind)),
      field('הערות לפרויקט', el('textarea', { value: pr.notes || '', onchange: (e) => { pr.notes = e.target.value; Store.commit(); } }))));

    // מחיר
    const mode = select([['none', 'אין מחיר רישום (רק מוצרים)'], ['flat', 'מחיר שווה לכולם'], ['group', 'מחיר לפי כיתה / קבוצה']], pr.pricing.mode,
      { onchange: (e) => { pr.pricing.mode = e.target.value; App.changed(); } });
    const priceCard = el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, pr.kind === 'sale' ? 'דמי השתתפות (לא חובה)' : 'מחיר הרישום'),
      el('div', { class: 'form-row' }, field('איך נקבע המחיר', mode),
        pr.pricing.mode !== 'none' ? field(pr.pricing.mode === 'group' ? 'מחיר ברירת מחדל (לכיתה בלי מחיר)' : 'מחיר למשתתף (₪)',
          el('input', { type: 'number', min: 0, step: 'any', value: pr.pricing.flat || '', onchange: (e) => { pr.pricing.flat = L.num(e.target.value); App.changed(); } })) : el('div')));
    if (pr.pricing.mode === 'group') {
      const classes = [...new Set([...pr.people.map((p) => (p.cls || '').trim()).filter(Boolean), ...Object.keys(pr.pricing.groups)])].sort((a, b) => a.localeCompare(b, 'he'));
      if (!classes.length) priceCard.appendChild(el('p', { class: 'muted' }, 'אין עדיין כיתות ברשימת האנשים של הפרויקט.'));
      priceCard.appendChild(el('div', { class: 'grid kpis' }, classes.map((c) => field('כיתה ' + c,
        el('input', { type: 'number', min: 0, step: 'any', value: pr.pricing.groups[c] === undefined ? '' : pr.pricing.groups[c], placeholder: String(pr.pricing.flat || 0),
          onchange: (e) => { if (e.target.value === '') delete pr.pricing.groups[c]; else pr.pricing.groups[c] = L.num(e.target.value); Store.commit(); } })))));
    }
    if (!isListKind) root.appendChild(priceCard);

    // מוצרים
    const prodCard = el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, pr.kind === 'sale' ? 'רשימת מוצרים ומחירים' : 'תוספות בתשלום (לא חובה, למשל: טיול, חולצה)'));
    for (const x of pr.products) {
      prodCard.appendChild(el('div', { class: 'toolbar' },
        el('input', { type: 'text', value: x.name, style: { flex: 1 }, onchange: (e) => { x.name = e.target.value.trim() || x.name; Store.commit(); } }),
        el('input', { type: 'number', min: 0, step: 'any', value: x.price, style: { width: '120px' }, onchange: (e) => { x.price = L.num(e.target.value); Store.commit(); } }), '₪',
        el('button', { class: 'btn small danger', onclick: async () => {
          const used = Object.values(pr.enrollments).filter((e) => L.num((e.items || {})[x.id]) > 0).length;
          if (used && !(await confirmBox('מחיקת מוצר', `${used} אנשים סימנו את "${x.name}". למחוק בכל זאת?`, 'מחק'))) return;
          pr.products = pr.products.filter((y) => y !== x);
          for (const e of Object.values(pr.enrollments)) if (e.items) delete e.items[x.id];
          App.changed();
        } }, 'מחק')));
    }
    const pName = el('input', { type: 'text', placeholder: pr.kind === 'sale' ? 'שם המוצר (למשל: חומש בראשית)' : 'שם התוספת', style: { flex: 1 } });
    const pPrice = el('input', { type: 'number', min: 0, step: 'any', placeholder: 'מחיר', style: { width: '120px' } });
    const addProd = () => {
      if (!pName.value.trim()) { pName.focus(); return; }
      pr.products.push({ id: L.uid(), name: pName.value.trim(), price: L.num(pPrice.value) });
      App.changed();
      setTimeout(() => { const i = document.querySelector('#add-prod-name'); if (i) i.focus(); }, 20);
    };
    pName.id = 'add-prod-name';
    for (const i of [pName, pPrice]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') addProd(); });
    prodCard.appendChild(el('div', { class: 'toolbar' }, pName, pPrice, '₪', el('button', { class: 'btn primary', onclick: addProd }, 'הוסף')));
    if (!isListKind) root.appendChild(prodCard);

    // קישור לפרויקטים אחרים
    const others = db.projects.filter((x) => x !== pr);
    const linksCard = el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, '🔗 קישור לפרויקטים אחרים (פטור / מימון)'),
      el('p', { class: 'muted small' }, 'למשל: מי שרשום/ה בפרויקט "רישום דרך העירייה" או "רישום דרך המנהל" לא משלם/ת כאן, או מקבל/ת הנחה. ההתאמה לפי שם פרטי, שם משפחה וכיתה (ואם אין כיתה באחת הרשימות - לפי שם מלא).'));
    if (!others.length) linksCard.appendChild(el('p', { class: 'muted' }, 'צריך קודם ליצור פרויקט נוסף (למשל מסוג "רשימה בלבד") ולהכניס אליו את הרשימה.'));
    for (const link of pr.links) {
      const src = db.projects.find((x) => x.id === link.projectId);
      const amount = el('input', { type: 'number', min: 0, step: 'any', value: link.amount || '', placeholder: 'סכום', style: { width: '100px' }, class: link.cover === 'amount' ? '' : 'hidden',
        onchange: (e) => { link.amount = L.num(e.target.value); Store.commit(); } });
      linksCard.appendChild(el('div', { class: 'toolbar' },
        el('span', null, 'מי ש'),
        select(L.LINK_CONDITIONS, link.condition, { onchange: (e) => { link.condition = e.target.value; Store.commit(); } }),
        el('span', null, 'ב'),
        el('strong', null, src ? src.name : '(פרויקט שנמחק)'),
        el('span', null, '←'),
        select([['full', 'פטור מלא'], ['amount', 'הנחה של סכום קבוע']], link.cover, { onchange: (e) => { link.cover = e.target.value; amount.classList.toggle('hidden', link.cover !== 'amount'); Store.commit(); } }),
        amount,
        el('span', null, 'כיתוב:'),
        el('input', { type: 'text', value: link.label || '', placeholder: 'למשל: עירייה', style: { width: '130px' }, onchange: (e) => { link.label = e.target.value.trim(); Store.commit(); } }),
        el('button', { class: 'btn small danger', onclick: () => { pr.links = pr.links.filter((y) => y !== link); App.changed(); } }, 'הסר')));
    }
    if (others.length) {
      const srcSel = select(others.slice().reverse().map((x) => [x.id, x.name]), '');
      linksCard.appendChild(el('div', { class: 'toolbar', style: { marginTop: '10px' } }, el('span', null, 'קישור חדש ל:'), srcSel,
        el('button', { class: 'btn primary', onclick: () => {
          const src = db.projects.find((x) => x.id === srcSel.value);
          pr.links.push({ id: L.uid(), projectId: src.id, label: src.name, condition: src.kind === 'list' ? 'listed' : 'registered', cover: 'full', amount: 0 });
          App.changed();
        } }, 'הוסף קישור')));
    }
    if (!isListKind) root.appendChild(linksCard);

    // סימונים
    const marksCard = el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, 'עמודות סימון בפרויקט'),
      el('p', { class: 'muted small' }, 'עמודות V נוספות לפרויקט הזה בלבד, למשל: "אישור הורים", "הביאה טופס", "הגיעה ביום הראשון".'));
    for (const m of pr.marks) {
      marksCard.appendChild(el('div', { class: 'toolbar' },
        el('input', { type: 'text', value: m.name, onchange: (e) => { m.name = e.target.value.trim() || m.name; Store.commit(); } }),
        el('button', { class: 'btn small danger', onclick: () => { pr.marks = pr.marks.filter((y) => y !== m); App.changed(); } }, 'מחק')));
    }
    const mName = el('input', { type: 'text', placeholder: 'שם העמודה' });
    marksCard.appendChild(el('div', { class: 'toolbar' }, mName, el('button', { class: 'btn', onclick: () => {
      if (!mName.value.trim()) return;
      pr.marks.push({ id: L.uid(), name: mName.value.trim() });
      App.changed();
    } }, 'הוסף')));
    root.appendChild(marksCard);

    Views.projectCloudCard(root, pr);

    root.appendChild(el('div', { class: 'card' }, el('h3', null, 'פעולות'),
      el('div', { class: 'toolbar' },
        el('button', { class: 'btn primary', onclick: () => App.go('project', { id: pr.id }) }, 'סיימתי - להמשך'),
        el('button', { class: 'btn', onclick: () => Views.duplicateProject(pr) }, '📑 שכפל לפרויקט חדש'),
        el('button', { class: 'btn', onclick: () => { pr.archived = !pr.archived; App.changed(); toast(pr.archived ? 'הועבר לארכיון' : 'הוחזר לפעילים'); } }, pr.archived ? '↩️ החזר מהארכיון' : '🗂️ העבר לארכיון'),
        el('button', { class: 'btn danger', onclick: () => Views.deleteProject(pr) }, '🗑 מחק פרויקט'))));
  }

  // ---------- קבלות והדפסות ----------
  function receiptHtml(pr, p, receiptNo) {
    const settings = Store.db.settings;
    const e = L.enrollment(pr, p.id) || { items: {} };
    const pays = pr.payments.filter((x) => x.personId === p.id);
    const thisPay = receiptNo ? pr.payments.filter((x) => x.receiptNo === receiptNo) : [];
    const r = L.personRow(pr, p);
    const lines = [];
    if (e.registered && pr.pricing.mode !== 'none') lines.push([pr.kind === 'sale' ? 'דמי השתתפות' : 'רישום ל' + pr.name, 1, L.basePrice(pr, p)]);
    for (const x of pr.products) { const q = L.num((e.items || {})[x.id]); if (q) lines.push([x.name, q, L.num(x.price)]); }
    const famPaid = thisPay.length > 1 ? thisPay.reduce((s, x) => s + L.num(x.amount), 0) : 0;
    return el('div', { class: 'receipt' },
      el('h1', null, settings.orgName || pr.name),
      el('div', { class: 'r-sub' }, (receiptNo ? `קבלה מס' ${receiptNo}` : 'פירוט חשבון') + ' · ' + fmtDate(today())),
      el('p', null, el('strong', null, 'לכבוד: '), L.fullName(p) + (p.cls ? ' (כיתה ' + p.cls + ')' : '') + (p.motherName ? ' · ' + p.motherName : '')),
      el('p', null, el('strong', null, 'עבור: '), pr.name),
      thisPay.length ? el('p', { class: 'r-total' }, 'התקבל סך ' + L.money(thisPay.reduce((s, x) => s + L.num(x.amount), 0)) + ' ב' + (thisPay[0].method || '') + (thisPay[0].note ? ' (' + thisPay[0].note + ')' : '')) : null,
      famPaid ? el('p', { class: 'small' }, 'התשלום כולל את: ' + thisPay.map((x) => L.fullName(personById(x.personId) || {})).join(', ')) : null,
      lines.length ? el('table', null, el('thead', null, el('tr', null, el('th', null, 'פריט'), el('th', null, 'כמות'), el('th', null, 'מחיר'), el('th', null, 'סה"כ'))),
        el('tbody', null, lines.map(([n, q, pz]) => el('tr', null, el('td', null, n), el('td', null, q), el('td', null, L.money(pz)), el('td', null, L.money(q * pz)))),
          L.num(e.discount) ? el('tr', null, el('td', { colspan: 3 }, 'הנחה'), el('td', null, '-' + L.money(e.discount))) : null,
          r.covered ? el('tr', null, el('td', { colspan: 3 }, 'מכוסה דרך ' + r.coverLabel), el('td', null, '-' + L.money(r.covered))) : null)) : null,
      pays.length ? el('table', null, el('thead', null, el('tr', null, el('th', null, 'תאריך'), el('th', null, 'תשלום'), el('th', null, 'אמצעי'), el('th', null, 'קבלה'))),
        el('tbody', null, pays.map((x) => el('tr', null, el('td', null, fmtDate(x.date)), el('td', null, L.money(x.amount)), el('td', null, x.method || ''), el('td', null, x.receiptNo || ''))))) : null,
      el('p', { class: 'r-total' }, `סה"כ לתשלום: ${L.money(r.due)} · שולם: ${L.money(r.paid)} · ` + (r.balance > 0 ? `נשאר: ${L.money(r.balance)}` : r.balance < 0 ? `זיכוי: ${L.money(-r.balance)}` : 'שולם במלואו ✓')),
      el('div', { class: 'r-foot' }, settings.receiptFooter || ''));
  }

  function receiptDialog(pr, p, receiptNo) {
    cur = pr;
    const preview = el('div', { class: 'receipt-preview' }, receiptHtml(pr, p, receiptNo));
    const fileName = `קבלה ${receiptNo || ''} ${L.fullName(p)}.pdf`.replace(/\s+/g, ' ');
    modal({
      title: receiptNo ? `קבלה מס' ${receiptNo}` : 'פירוט חשבון',
      wide: true,
      body: preview,
      buttons: [
        { label: '🖨️ הדפסה', primary: true, onclick: () => { printNode(receiptHtml(pr, p, receiptNo)); return false; } },
        { label: '📧 שליחה במייל', onclick: async () => { await Views.emailReceipt(pr, p, receiptNo, () => receiptHtml(pr, p, receiptNo)); return false; } },
        { label: '📄 שמירה כ-PDF', onclick: async () => { await printNode(receiptHtml(pr, p, receiptNo), fileName); return false; } },
        { label: 'סגור' },
      ],
    });
  }
  Views.receiptDialog = receiptDialog;

  Views.printNode = (node, pdfName) => printNode(node, pdfName);

  async function printNode(node, pdfName) {
    const root = clear(document.getElementById('print-root'));
    root.appendChild(node);
    try {
      if (pdfName) await window.api.printToPdf({ defaultName: pdfName });
      else await window.api.print();
    } finally {
      clear(root);
    }
  }

  function printTable(title, headers, rows) {
    return el('div', { class: 'print-list' }, el('h1', null, title), el('p', null, fmtDate(today())),
      el('table', null, el('thead', null, el('tr', null, headers.map((h) => el('th', null, h)))), el('tbody', null, rows.map((r) => el('tr', null, r.map((c) => el('td', null, c)))))));
  }

  function printDebtors(pr, debtors) {
    printNode(printTable(`${pr.name} - רשימת חייבים`, ['שם', 'כיתה', 'טלפון', 'לתשלום', 'שולם', 'יתרה'],
      debtors.map(({ p, r }) => [L.fullName(p), p.cls || '', p.momPhone || p.dadPhone || '', L.money(r.due), L.money(r.paid), L.money(r.balance)])));
  }

  function printDistribution(pr, parts) {
    printNode(printTable(`${pr.name} - רשימת חלוקה`, ['✓', 'שם', 'כיתה', 'מה', 'יתרה'],
      parts.map((p) => { const r = L.personRow(pr, p); return ['☐', L.fullName(p), p.cls || '', itemsText(pr, L.enrollment(pr, p.id)), r.balance > 0 ? L.money(r.balance) : '']; })));
  }

  // ---------- ייצוא ----------
  function exportProject(pr) {
    const ppl = people();
    const head = ['שם פרטי', 'שם משפחה', 'כיתה', 'טלפון'];
    if (pr.pricing.mode !== 'none') head.push(pr.kind === 'sale' ? 'דמי השתתפות' : 'נרשם/ה');
    pr.products.forEach((x) => head.push(x.name));
    pr.marks.forEach((m) => head.push(m.name));
    head.push('הנחה', 'פטור / מימון', 'לתשלום', 'שולם', 'יתרה', 'מצב', 'הערה');
    const list = [head];
    for (const p of ppl) {
      const r = L.personRow(pr, p);
      if (!r.participant && !r.paid) continue;
      const e = L.enrollment(pr, p.id) || {};
      const row = [p.firstName || '', p.lastName || '', p.cls || '', p.momPhone || p.dadPhone || ''];
      if (pr.pricing.mode !== 'none') row.push(e.registered ? 'V' : '');
      pr.products.forEach((x) => row.push(L.num((e.items || {})[x.id]) || ''));
      pr.marks.forEach((m) => row.push((e.marks || {})[m.id] ? 'V' : ''));
      row.push(L.num(e.discount) || '', r.covered ? `${r.coverLabel} (${r.covered})` : '', r.due, r.paid, r.balance, L.STATUS_LABEL[r.status], e.note || '');
      list.push(row);
    }
    const pays = [['תאריך', 'שם', 'כיתה', 'סכום', 'אמצעי', 'הערה', 'קבלה']].concat(pr.payments.map((x) => {
      const p = personById(x.personId) || {};
      return [fmtDate(x.date), L.fullName(p), p.cls || '', L.num(x.amount), x.method || '', x.note || '', x.receiptNo || ''];
    }));
    const supName = (id) => (pr.suppliers.find((y) => y.id === id) || {}).name || '';
    const exps = [['תאריך', 'הוצאה', 'ספק', 'סכום', 'אמצעי', 'הערה']].concat(pr.expenses.map((x) => [fmtDate(x.date), x.name, supName(x.supplierId), L.num(x.amount), x.method || '', x.note || '']));
    const s = L.summary(pr, ppl);
    const fin = L.finalSummary(pr, s);
    const sum = [['נושא', 'סכום'], ['--- סיכום סופי ---', ''], ...finalRows(fin), ['סה"כ הכנסות', fin.income], ['הוצאות', fin.expenses], ['רווח נקי', fin.net], [], ['משתתפים', s.participants], ['סה"כ לתשלום', s.due], ['שולם', s.paid], ['נשאר לגבות', s.balance], ['הוצאות', s.expenses], ['מאזן עכשיו', s.net], ['מאזן צפוי', s.expectedNet], ['מזומן בקופה', s.cashOnHand], [], ['כיתה', 'משתתפים', 'לתשלום', 'שולם', 'יתרה']]
      .concat(Object.entries(s.byGroup).map(([g, v]) => [g, v.participants, v.due, v.paid, v.balance]));
    if (pr.products.length) sum.push([], ['מוצר', 'כמות', 'סכום'], ...pr.products.map((x) => [x.name, (s.products[x.id] || {}).qty || 0, (s.products[x.id] || {}).amount || 0]));
    Views.saveXlsx(pr.name + '.xlsx', [{ name: 'רישום', rows: list }, { name: 'תשלומים', rows: pays }, { name: 'הוצאות', rows: exps }, ...Views.suppliersSheets(pr, s), { name: 'סיכום', rows: sum }]);
  }
})();
