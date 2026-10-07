// ייבוא (אופציונלי) מאקסל, CSV או PDF: זיהוי עמודות, תצוגה מקדימה ומיזוג לרשימה.
(function () {
  'use strict';
  const { el, clear, Store, toast, modal, select, field } = UI;
  window.Views = window.Views || {};

  async function readPdfRows(bytes) {
    const base = new URL('../node_modules/pdfjs-dist/build/', document.baseURI).href;
    const pdfjs = await import(base + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const rows = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items = tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
      rows.push(...Importer.pdfItemsToRows(items));
    }
    return rows;
  }

  function readWorkbook(bytes) {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
    return wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' }),
    })).filter((s) => s.rows.some((r) => r.some((c) => String(c).trim())));
  }

  Views.importDialog = async function (pr, opts) {
    opts = opts || {};
    let sheets;
    let fileName = opts.name || '';
    if (opts.rows) {
      sheets = [{ name: fileName, rows: opts.rows }];
    } else {
      const f = opts.file || await window.api.openFile({
        title: 'בחירת קובץ עם רשימת שמות',
        filters: [{ name: 'אקסל / PDF / CSV', extensions: ['xlsx', 'xls', 'csv', 'pdf', 'ods'] }],
      });
      if (!f) return;
      fileName = f.name;
      try {
        if (/\.pdf$/i.test(f.name)) sheets = [{ name: f.name, rows: await readPdfRows(new Uint8Array(f.data)), pdf: true }];
        else sheets = readWorkbook(new Uint8Array(f.data));
      } catch (e) {
        console.error(e);
        toast('לא הצלחתי לקרוא את הקובץ: ' + e.message);
        return;
      }
      if (!sheets.length || !sheets.some((s) => s.rows.length)) {
        toast(/\.pdf$/i.test(f.name) ? 'לא נמצא טקסט ב-PDF (אולי זה קובץ סרוק כתמונה). אפשר להקליד את השמות ידנית.' : 'הקובץ ריק');
        return;
      }
    }
    mappingDialog(pr, sheets, fileName);
  };

  function mappingDialog(pr, sheets, fileName) {
    const db = pr;
    const body = el('div');
    let sheetIdx = 0;
    let reversed = false;
    let analysis, mapping;

    const targets = [
      ['ignore', '— לא לייבא —'],
      ...Logic.PERSON_FIELDS.map((f) => [f.key, f.label]),
      ...db.columns.map((c) => ['col:' + c.id, 'עמודה שלי: ' + c.name]),
      ['new', '➕ עמודה חדשה בשם הכותרת'],
      ...(pr.kind === 'list' || pr.pricing.mode !== 'none' ? [['reg', '📋 נרשם/ה בפרויקט (V)']] : []),
      ...(pr.kind === 'list' ? [] : [['paidFull', '💰 שולם הכול (V)'], ['paidAmount', '💰 סכום ששולם (מספר)']]),
      ...pr.marks.map((m) => ['mark:' + m.id, '☑ סימון בפרויקט: ' + m.name]),
      ...pr.products.map((x) => ['qty:' + x.id, '📦 כמות: ' + x.name]),
    ];
    const regBox = el('input', { type: 'checkbox' });
    const regLabel = pr.pricing.mode !== 'none' ? el('label', { class: 'check' }, regBox, 'לסמן את כולם כנרשמים') : null;

    const run = () => {
      const sheet = sheets[sheetIdx];
      const rows = reversed ? sheet.rows.map((r) => r.map((c) => Importer.reverseHebrew(c))) : sheet.rows;
      analysis = Importer.analyze(rows, { marks: pr.marks, products: pr.products, columns: pr.columns });
      mapping = analysis.columns.map((c) => c.target);
      draw();
    };

    const draw = () => {
      clear(body);
      body.appendChild(el('div', { class: 'help' }, 'בדקו שכל עמודה בקובץ משויכת לשדה הנכון. עמודה של V יכולה להיכנס לרישום ("נרשם/ה"), לתשלום ("שולם הכול") או לעמודת סימון. אנשים שכבר קיימים ברשימה (אותו שם וכיתה) לא יוכפלו - רק יושלמו פרטים חסרים.'));
      const tools = el('div', { class: 'toolbar' });
      if (sheets.length > 1) {
        tools.appendChild(field('גיליון', select(sheets.map((s, i) => [i, s.name]), sheetIdx, { onchange: (e) => { sheetIdx = +e.target.value; run(); } })));
      }
      if (sheets[sheetIdx].pdf) {
        tools.appendChild(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: reversed, onchange: (e) => { reversed = e.target.checked; run(); } }), 'הטקסט הפוך (תקן כיוון עברית)'));
      }
      if (regLabel) tools.appendChild(regLabel);
      body.appendChild(tools);

      const cols = analysis.columns.filter((c) => c.filled > 0 || mapping[c.index] !== 'ignore');
      body.appendChild(el('div', { class: 'table-wrap', style: { maxHeight: '260px', marginBottom: '12px' } }, el('table', { class: 'data' },
        el('thead', null, el('tr', null, el('th', null, 'עמודה בקובץ'), el('th', null, 'דוגמאות'), el('th', null, 'לאן לייבא'))),
        el('tbody', null, cols.map((c) => el('tr', null,
          el('td', null, c.title), el('td', { class: 'muted small' }, c.sample.join(' · ')),
          el('td', null, select(targets, mapping[c.index], { onchange: (e) => { mapping[c.index] = e.target.value; preview(); } }))))))));
      const pv = el('div');
      body.appendChild(pv);
      const preview = () => {
        const tmpIds = {};
        mapping.forEach((t, i) => { if (t === 'new') tmpIds[i] = 'tmp' + i; });
        const ppl = Importer.rowsToPeople(analysis, mapping, tmpIds);
        const shown = Logic.PERSON_FIELDS.filter((f) => mapping.includes(f.key));
        const pds = ppl.map((p) => p.projectData).filter(Boolean);
        const extra = [
          pds.length ? `${pds.filter((d) => d.reg || ((d.paidFull || d.paidAmount > 0) && pr.pricing.mode !== 'none')).length} יסומנו כנרשמים` : '',
          mapping.includes('paidFull') ? `${pds.filter((d) => d.paidFull).length} יסומנו כשילמו הכול` : '',
          mapping.includes('paidAmount') ? `${pds.filter((d) => d.paidAmount > 0).length} עם סכום ששולם` : '',
        ].filter(Boolean).join(' · ');
        clear(pv).appendChild(el('h3', null, `תצוגה מקדימה: ${ppl.length} אנשים` + (extra ? ' · ' + extra : '')));
        if (!ppl.length) { pv.appendChild(el('p', { class: 'neg' }, 'לא נמצאו שמות. ודאו שעמודה אחת לפחות משויכת ל"שם פרטי" או "שם משפחה".')); return; }
        pv.appendChild(el('div', { class: 'table-wrap', style: { maxHeight: '220px' } }, el('table', { class: 'data' },
          el('thead', null, el('tr', null, shown.map((f) => el('th', null, f.label)))),
          el('tbody', null, ppl.slice(0, 50).map((p) => el('tr', null, shown.map((f) => el('td', null, p[f.key] || '')))),
            ppl.length > 50 ? el('tr', null, el('td', { colspan: shown.length, class: 'muted' }, `ועוד ${ppl.length - 50}...`)) : null))));
      };
      preview();
    };

    run();
    modal({
      title: 'ייבוא מ' + (fileName || 'קובץ'),
      wide: true,
      sticky: true,
      body,
      buttons: [
        { label: 'ייבא', primary: true, onclick: () => {
          const newIds = {};
          mapping.forEach((t, i) => {
            if (t !== 'new') return;
            const title = analysis.columns[i].title;
            let col = db.columns.find((c) => c.name === title);
            if (!col) {
              const vals = analysis.rows.map((r) => (r[i] || '').trim()).filter(Boolean);
              const isCheck = vals.length && vals.every((v) => /^[vVxX✓✔]$|^כן$|^לא$/.test(v));
              col = { id: Logic.uid(), name: title, type: isCheck ? 'check' : 'text' };
              db.columns.push(col);
            }
            newIds[i] = col.id;
          });
          const incoming = Importer.rowsToPeople(analysis, mapping, newIds);
          if (!incoming.length) { toast('לא נמצאו שמות לייבוא'); return false; }
          const before = new Set(db.people.map((p) => p.id));
          const r = Importer.merge(db.people, incoming);
          const pd = Importer.applyProjectData(pr, incoming, r.targets, { date: UI.today() });
          if (regBox.checked) {
            // מסמנים את כל מי שבקובץ, גם מי שכבר היה ברשימה.
            const keys = new Set(incoming.map(Importer.personKey));
            for (const p of db.people) if (keys.has(Importer.personKey(p))) Logic.ensureEnrollment(pr, p.id).registered = true;
          }
          App.changed();
          const added = db.people.filter((p) => !before.has(p.id)).length;
          toast(`יובאו ${added} חדשים, ${r.updated} עודכנו, ${r.same} כבר היו` + (regBox.checked ? ' · סומנו כנרשמים' : '')
            + (pd.registered ? ` · ${pd.registered} סומנו כנרשמים` : '') + (pd.payments ? ` · נרשמו ${pd.payments} תשלומים (${Logic.money(pd.paidSum)})` : '')
            + (pd.unpriced ? ` · ${pd.unpriced} מסומנים "שולם" אבל אין להם מחיר - קודם קובעים מחיר בהגדרות` : ''));
        } },
        { label: 'ביטול' },
      ],
    });
  }
})();
