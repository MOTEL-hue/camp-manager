// ספקים: רשימת הספקים של הפרויקט, שיוך מוצרים לספק, רשימת הזמנה לכל ספק עם סה"כ, והדפסה
// (הזמנה לספק אחד, ודוח סופי של כל הספקים עם כל הפרטים).
(function () {
  'use strict';
  const { el, Store, toast, modal, confirmBox, field, select, fmtDate, today } = UI;
  const L = Logic;
  window.Views = window.Views || {};

  const detailsText = (sp) => [sp.contact, sp.phone, sp.email, sp.address].filter(Boolean).join(' · ');
  const productsText = (pr, sp) => pr.products.filter((x) => x.supplierId === sp.id).map((x) => x.name).join(', ');

  // ---------- הוספה / עריכה ----------
  Views.supplierDialog = function (pr, sp) {
    const cur = sp || { id: L.uid(), name: '', contact: '', phone: '', email: '', address: '', notes: '' };
    const inputs = {
      name: el('input', { type: 'text', value: cur.name, placeholder: 'למשל: חיים' }),
      contact: el('input', { type: 'text', value: cur.contact || '', placeholder: 'שם איש הקשר, אם שונה' }),
      phone: el('input', { type: 'text', value: cur.phone || '', dir: 'ltr' }),
      email: el('input', { type: 'email', value: cur.email || '', dir: 'ltr' }),
      address: el('input', { type: 'text', value: cur.address || '' }),
      notes: el('textarea', { rows: 3 }, cur.notes || ''),
    };
    inputs.notes.value = cur.notes || '';
    const checks = pr.products.map((x) => {
      const other = x.supplierId && x.supplierId !== cur.id && pr.suppliers.find((y) => y.id === x.supplierId);
      return { x, box: el('input', { type: 'checkbox', checked: x.supplierId === cur.id }), other };
    });
    const prodBox = pr.products.length
      ? el('div', { class: 'field' }, el('span', null, 'מה הספק הזה מספק (סימון מעביר את המוצר אליו)'),
        el('div', { class: 'checklist' }, checks.map(({ x, box, other }) =>
          el('label', { class: 'check' }, box, ' ' + x.name, other ? el('span', { class: 'muted small' }, '  (כרגע אצל ' + other.name + ')') : null))))
      : el('p', { class: 'muted' }, 'עוד אין מוצרים בפרויקט. מוצרים מוגדרים בהגדרות הפרויקט, ואז אפשר לשייך אותם לספק.');
    modal({
      title: sp ? 'עריכת ספק' : 'ספק חדש',
      wide: true,
      body: el('div', null,
        el('div', { class: 'form-row' }, field('שם הספק', inputs.name), field('איש קשר', inputs.contact)),
        el('div', { class: 'form-row' }, field('טלפון', inputs.phone), field('מייל', inputs.email)),
        field('כתובת', inputs.address),
        field('הערות (תנאי תשלום, זמן אספקה...)', inputs.notes),
        prodBox),
      buttons: [
        {
          label: 'שמירה', primary: true, onclick: () => {
            if (!inputs.name.value.trim()) { toast('צריך שם לספק'); inputs.name.focus(); return false; }
            for (const k of Object.keys(inputs)) cur[k] = inputs[k].value.trim();
            if (!sp) pr.suppliers.push(cur);
            for (const { x, box } of checks) {
              if (box.checked) x.supplierId = cur.id;
              else if (x.supplierId === cur.id) delete x.supplierId;
            }
            App.changed();
            return true;
          },
        },
        { label: 'ביטול' },
      ],
    });
  };

  Views.deleteSupplier = async function (pr, sp) {
    const used = pr.products.filter((x) => x.supplierId === sp.id).length + pr.expenses.filter((x) => x.supplierId === sp.id).length;
    if (!(await confirmBox('מחיקת ספק', used ? `"${sp.name}" משויך ל-${used} מוצרים והוצאות. הם יישארו, בלי ספק. למחוק?` : `למחוק את "${sp.name}"?`, 'מחק'))) return;
    pr.suppliers = pr.suppliers.filter((x) => x !== sp);
    for (const x of pr.products) if (x.supplierId === sp.id) delete x.supplierId;
    for (const x of pr.expenses) if (x.supplierId === sp.id) delete x.supplierId;
    App.changed();
    toast('הספק נמחק', { label: 'בטל', fn: () => { Store.undo(); App.render(); } });
  };

  // ספקים שהוגדרו בפרויקט אחר (למשל מהשנה שעברה) - מעתיקים את הפרטים, בלי כפילויות לפי שם.
  Views.importSuppliers = function (pr) {
    const others = Store.db.projects.filter((p) => p !== pr && (p.suppliers || []).length);
    if (!others.length) { toast('אין ספקים בפרויקטים אחרים'); return; }
    const pick = select(others.map((p) => [p.id, `${p.name} (${p.suppliers.length} ספקים)`]), others[0].id);
    modal({
      title: 'העתקת ספקים מפרויקט אחר',
      body: el('div', null, field('מאיזה פרויקט', pick), el('p', { class: 'muted' }, 'מועתקים רק פרטי הספקים. שיוך מוצרים לספקים מגדירים מחדש.')),
      buttons: [{
        label: 'העתק', primary: true, onclick: () => {
          const src = others.find((p) => p.id === pick.value);
          const have = new Set(pr.suppliers.map((x) => x.name.trim()));
          let n = 0;
          for (const sp of src.suppliers) {
            if (have.has(sp.name.trim())) continue;
            pr.suppliers.push(Object.assign({}, sp, { id: L.uid() }));
            n++;
          }
          App.changed();
          toast(n ? `הועתקו ${n} ספקים` : 'כל הספקים כבר קיימים');
        },
      }, { label: 'ביטול' }],
    });
  };

  // ---------- כרטיס "ספקים" (בלשונית הוצאות) ----------
  Views.suppliersCard = function (pr, s) {
    const rep = L.supplierReport(pr, s);
    const card = el('div', { class: 'card', style: { marginBottom: '14px' } },
      el('div', { class: 'toolbar' }, el('h3', { style: { margin: 0 } }, '🏭 ספקים'), el('div', { class: 'grow' }),
        el('button', { class: 'btn small', onclick: () => Views.importSuppliers(pr) }, '📥 מפרויקט אחר'),
        rep.length ? el('button', { class: 'btn small', onclick: () => Views.printSuppliersReport(pr, s) }, '🖨️ דוח ספקים') : null,
        el('button', { class: 'btn small primary', onclick: () => Views.supplierDialog(pr) }, '➕ ספק חדש')));
    if (!rep.length) {
      card.appendChild(el('p', { class: 'muted' }, 'הגדירו ספקים כדי לפצל את רשימת ההזמנה לפי ספק ולקבל סה"כ לכל אחד. למשל: חומש אצל חיים, וגיאוגרפיה ונפלאות הבורא אצל ספק אחר. בכל הוצאה אפשר לסמן לאיזה ספק שולם.'));
      return card;
    }
    card.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', null, el('tr', null, ['ספק', 'פרטים', 'מה מספק', 'סה"כ הזמנה', 'שולם לו', 'נשאר לשלם', ''].map((h, i) => el('th', { class: i >= 3 && i <= 5 ? 'num' : '' }, h)))),
      el('tbody', null, rep.map((r) => el('tr', null,
        el('td', null, el('strong', null, r.supplier.name)),
        el('td', { class: 'small' }, detailsText(r.supplier)),
        el('td', { class: 'small' }, productsText(pr, r.supplier) || el('span', { class: 'muted' }, 'עוד לא שויכו מוצרים')),
        el('td', { class: 'num' }, L.money(r.total)),
        el('td', { class: 'num' }, L.money(r.paid)),
        el('td', { class: 'num' + (r.balance > 0 ? ' neg' : '') }, L.money(r.balance)),
        el('td', null, el('button', { class: 'btn small', onclick: () => Views.supplierDialog(pr, r.supplier) }, '✏️'), ' ',
          el('button', { class: 'btn small danger', onclick: () => Views.deleteSupplier(pr, r.supplier) }, '🗑'))))))));
    return card;
  };

  // ---------- רשימת הזמנה לפי ספק (בלשונית הזמנה וחלוקה) ----------
  function groupTable(pr, g, withSupplierSelect) {
    const options = [['', 'ללא ספק']].concat(pr.suppliers.map((x) => [x.id, x.name]));
    return el('table', { class: 'data' },
      el('thead', null, el('tr', null, el('th', null, 'מוצר'), withSupplierSelect ? el('th', null, 'ספק') : null,
        el('th', { class: 'num' }, 'כמות להזמנה'), el('th', { class: 'num' }, 'מחיר מהספק'), el('th', { class: 'num' }, 'סה"כ'))),
      el('tbody', null, g.items.map((it) => el('tr', null,
        el('td', null, it.product.name),
        withSupplierSelect ? el('td', null, select(options, it.product.supplierId || '', { onchange: (e) => { if (e.target.value) it.product.supplierId = e.target.value; else delete it.product.supplierId; App.changed(); } })) : null,
        el('td', { class: 'num' }, it.qty),
        el('td', { class: 'num' }, el('input', {
          type: 'number', min: 0, step: 'any', style: { width: '90px' }, value: it.product.cost === undefined || it.product.cost === null ? '' : it.product.cost,
          placeholder: String(L.num(it.product.price)), title: 'מחיר שהספק גובה. אם ריק - מחשבים לפי מחיר המכירה',
          onchange: (e) => { if (e.target.value === '') delete it.product.cost; else it.product.cost = L.num(e.target.value); App.changed(); },
        })),
        el('td', { class: 'num' }, L.money(it.total))))),
      el('tfoot', null, el('tr', null, el('td', { colspan: withSupplierSelect ? 4 : 3 }, g.supplier ? `סה"כ להזמנה מ${g.supplier.name}` : 'סה"כ'), el('td', { class: 'num' }, L.money(g.total)))));
  }

  Views.supplierOrderCard = function (pr, s) {
    const o = L.supplierOrders(pr, s);
    const card = el('div', { class: 'card', style: { marginBottom: '16px' } });
    if (!pr.suppliers.length) {
      card.appendChild(el('div', { class: 'toolbar' }, el('h3', { style: { margin: 0 } }, 'רשימת הזמנה לספק'), el('div', { class: 'grow' }),
        el('button', { class: 'btn small primary', onclick: () => Views.supplierDialog(pr) }, '➕ ספק חדש'),
        el('button', { class: 'btn small', onclick: () => Views.printSupplierOrder(pr, o.none) }, '🖨️ הדפסה')));
      card.appendChild(groupTable(pr, o.none, false));
      card.appendChild(el('p', { class: 'muted small', style: { marginTop: '8px' } }, 'יש כמה ספקים? "ספק חדש" מאפשר לשייך כל מוצר לספק, ואז ההזמנה מתפצלת לפי ספק, עם סה"כ ופרטים לכל אחד. אפשר גם להזין "מחיר מהספק" אם הוא שונה ממחיר המכירה.'));
      return card;
    }
    card.appendChild(el('div', { class: 'toolbar' }, el('h3', { style: { margin: 0 } }, 'רשימת הזמנה לפי ספק'), el('div', { class: 'grow' }),
      el('button', { class: 'btn small primary', onclick: () => Views.supplierDialog(pr) }, '➕ ספק חדש'),
      el('button', { class: 'btn small', onclick: () => Views.printSuppliersReport(pr, s) }, '🖨️ דוח כל הספקים')));
    const groups = (o.none.items.length ? [o.none] : []).concat(o.groups);
    for (const g of groups) {
      const sp = g.supplier;
      card.appendChild(el('div', { class: 'toolbar', style: { marginTop: '14px' } },
        el('h4', { style: { margin: 0 } }, sp ? '🏭 ' + sp.name : '⚠️ מוצרים בלי ספק'),
        sp && detailsText(sp) ? el('span', { class: 'muted small' }, detailsText(sp)) : null,
        el('div', { class: 'grow' }),
        sp ? el('button', { class: 'btn small', onclick: () => Views.supplierDialog(pr, sp) }, '✏️ פרטים') : null,
        sp && g.items.length ? el('button', { class: 'btn small', onclick: () => Views.printSupplierOrder(pr, g) }, '🖨️ הדפסת הזמנה') : null));
      if (g.items.length) card.appendChild(groupTable(pr, g, true));
      else card.appendChild(el('p', { class: 'muted small' }, 'אין מוצרים משויכים לספק הזה. בחרו אותו ברשימת "ספק" ליד מוצר, או בעריכת הספק.'));
    }
    card.appendChild(el('p', { class: 'r-total', style: { marginTop: '12px', fontWeight: '600' } }, 'סה"כ הזמנה מכל הספקים: ' + L.money(o.total)));
    return card;
  };

  // ---------- הדפסה ----------
  function detailsTable(sp) {
    const rows = [['איש קשר', sp.contact], ['טלפון', sp.phone], ['מייל', sp.email], ['כתובת', sp.address], ['הערות', sp.notes]].filter((r) => r[1]);
    return rows.length ? el('table', { class: 'sup-details' }, el('tbody', null, rows.map(([k, v]) => el('tr', null, el('th', null, k), el('td', null, v))))) : null;
  }

  function itemsTable(items) {
    const ordered = items.filter((i) => i.qty > 0);
    if (!ordered.length) return el('p', null, 'אין פריטים להזמנה.');
    return el('table', null, el('thead', null, el('tr', null, ['מוצר', 'כמות', 'מחיר ליחידה', 'סה"כ'].map((h) => el('th', null, h)))),
      el('tbody', null, ordered.map((i) => el('tr', null, el('td', null, i.product.name), el('td', null, i.qty), el('td', null, L.money(i.price)), el('td', null, L.money(i.total))))));
  }

  Views.printSupplierOrder = function (pr, g) {
    const sp = g.supplier;
    Views.printNode(el('div', { class: 'print-list' },
      el('h1', null, sp ? `הזמנה מ${sp.name}` : `${pr.name} - הזמנה`), el('p', null, pr.name + ' · ' + fmtDate(today())),
      sp ? detailsTable(sp) : null, itemsTable(g.items),
      el('p', { class: 'r-total' }, `סה"כ להזמנה: ${L.money(g.total)}`)));
  };

  // הדוח הסופי: עמוד סיכום, ואחריו עמוד לכל ספק עם כל הפרטים, מה להזמין, מה שולם לו ומה נשאר.
  Views.printSuppliersReport = function (pr, s) {
    const rep = L.supplierReport(pr, s);
    const o = L.supplierOrders(pr, s);
    const sum = el('div', { class: 'print-list', style: { pageBreakAfter: 'always' } },
      el('h1', null, `${pr.name} - דוח ספקים`), el('p', null, fmtDate(today())),
      el('table', null, el('thead', null, el('tr', null, ['ספק', 'טלפון', 'סה"כ הזמנה', 'שולם', 'נשאר לשלם'].map((h) => el('th', null, h)))),
        el('tbody', null, rep.map((r) => el('tr', null, el('td', null, r.supplier.name), el('td', { dir: 'ltr' }, r.supplier.phone || ''), el('td', null, L.money(r.total)), el('td', null, L.money(r.paid)), el('td', null, L.money(r.balance)))),
          el('tr', null, el('td', null, el('strong', null, 'סה"כ')), el('td'),
            el('td', null, el('strong', null, L.money(rep.reduce((a, r) => a + r.total, 0)))), el('td', null, el('strong', null, L.money(rep.reduce((a, r) => a + r.paid, 0)))),
            el('td', null, el('strong', null, L.money(rep.reduce((a, r) => a + r.balance, 0))))))),
      o.none.items.some((i) => i.qty > 0) ? el('p', null, `שימו לב: יש מוצרים בלי ספק, בסך ${L.money(o.none.total)}.`) : null);
    const pages = rep.map((r, i) => el('div', { class: 'print-list', style: i < rep.length - 1 ? { pageBreakAfter: 'always' } : null },
      el('h2', null, r.supplier.name), el('p', null, pr.name + ' · ' + fmtDate(today())),
      detailsTable(r.supplier), itemsTable(r.items),
      el('p', { class: 'r-total' }, `סה"כ להזמנה: ${L.money(r.total)}`),
      r.expenses.length ? el('table', null, el('thead', null, el('tr', null, ['תאריך', 'תשלום לספק', 'סכום', 'אמצעי'].map((h) => el('th', null, h)))),
        el('tbody', null, r.expenses.map((x) => el('tr', null, el('td', null, fmtDate(x.date)), el('td', null, x.name), el('td', null, L.money(x.amount)), el('td', null, x.method || ''))))) : null,
      el('p', { class: 'r-total' }, `שולם עד עכשיו: ${L.money(r.paid)} · ` + (r.balance > 0 ? `נשאר לשלם: ${L.money(r.balance)}` : r.balance < 0 ? `שולם ביתר: ${L.money(-r.balance)}` : 'שולם במלואו ✓'))));
    Views.printNode(el('div', null, sum, pages));
  };

  // לייצוא לאקסל: גיליון ספקים, וגיליון הזמנה לפי ספק.
  Views.suppliersSheets = function (pr, s) {
    const rep = L.supplierReport(pr, s);
    if (!rep.length) return [];
    const sup = [['ספק', 'איש קשר', 'טלפון', 'מייל', 'כתובת', 'הערות', 'סה"כ הזמנה', 'שולם לספק', 'נשאר לשלם']]
      .concat(rep.map((r) => [r.supplier.name, r.supplier.contact || '', r.supplier.phone || '', r.supplier.email || '', r.supplier.address || '', r.supplier.notes || '', r.total, r.paid, r.balance]));
    const orders = [['ספק', 'מוצר', 'כמות', 'מחיר ליחידה', 'סה"כ']];
    const o = L.supplierOrders(pr, s);
    for (const g of o.groups.concat([o.none])) for (const i of g.items) if (i.qty > 0) orders.push([g.supplier ? g.supplier.name : 'ללא ספק', i.product.name, i.qty, i.price, i.total]);
    return [{ name: 'ספקים', rows: sup }, { name: 'הזמנה לפי ספק', rows: orders }];
  };
})();
