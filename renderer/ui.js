// כלים משותפים לממשק: בניית אלמנטים, חלונות, הודעות, ושמירה עם ביטול פעולה.
(function () {
  'use strict';

  // el('div', {class: 'x', onclick: fn}, 'טקסט', child) - טקסט תמיד כ-textContent, כך ששמות מקובץ לא יוכלו להזריק HTML.
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'value') node.value = v;
        else if (k === 'checked') node.checked = !!v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  let toastTimer;
  function toast(msg, action) {
    const t = document.getElementById('toast');
    clear(t);
    t.appendChild(document.createTextNode(msg));
    if (action) t.appendChild(el('button', { class: 'btn small', onclick: () => { t.classList.add('hidden'); action.fn(); } }, action.label));
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), action ? 7000 : 3000);
  }

  // modal({title, body, buttons:[{label, primary, danger, onclick(close) -> false להשאיר פתוח}], wide})
  function modal(opts) {
    const root = document.getElementById('modal-root');
    let back;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (opts.onclose) opts.onclose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const foot = el('div', { class: 'modal-foot' });
    for (const b of opts.buttons || [{ label: 'סגור' }]) {
      foot.appendChild(el('button', {
        class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
        onclick: async () => {
          if (b.onclick) { const r = await b.onclick(close); if (r === false) return; }
          close();
        },
      }, b.label));
    }
    back = el('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back && !opts.sticky) close(); } },
      el('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
        el('div', { class: 'modal-head' }, el('h2', null, opts.title || ''), el('button', { class: 'btn ghost', onclick: close, title: 'סגור' }, '✕')),
        el('div', { class: 'modal-body' }, opts.body),
        foot));
    root.appendChild(back);
    document.addEventListener('keydown', onKey);
    const first = back.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return close;
  }

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      let answered = false;
      modal({
        title,
        body: el('p', null, text),
        buttons: [
          { label: okLabel || 'אישור', primary: true, danger: true, onclick: () => { answered = true; resolve(true); } },
          { label: 'ביטול' },
        ],
        onclose: () => { if (!answered) resolve(false); },
      });
    });
  }

  function promptBox(title, label, value) {
    return new Promise((resolve) => {
      let done = false;
      const input = el('input', { type: 'text', value: value || '', style: { width: '100%' } });
      const close = modal({
        title,
        body: el('label', { class: 'field' }, el('span', null, label), input),
        buttons: [
          { label: 'אישור', primary: true, onclick: () => { done = true; resolve(input.value.trim()); } },
          { label: 'ביטול' },
        ],
        onclose: () => { if (!done) resolve(null); },
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; resolve(input.value.trim()); close(); } });
    });
  }

  function field(label, input) {
    return el('label', { class: 'field' }, el('span', null, label), input);
  }

  function select(options, value, attrs) {
    const s = el('select', attrs || null);
    for (const o of options) {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      const opt = el('option', { value: v }, l);
      if (String(v) === String(value)) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  function kpi(label, value, sub, cls) {
    return el('div', { class: 'kpi ' + (cls || '') }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), sub ? el('div', { class: 'sub' }, sub) : null);
  }

  function pill(status) {
    return el('span', { class: 'pill ' + status }, Logic.STATUS_LABEL[status]);
  }

  // מאגר הנתונים: שמירה מושהית קצרה, וביטול פעולה (Ctrl+Z) על ידי צילומי מצב.
  const Store = {
    db: null,
    undoStack: [],
    redoStack: [],
    saveTimer: null,
    lastSnapshot: null,
    async load() {
      const data = await window.api.loadDb();
      this.db = data || Logic.emptyDb();
      migrate(this.db);
      this.lastSnapshot = JSON.stringify(this.db);
      if (!data) await window.api.saveDb(this.db);
    },
    // לקרוא אחרי כל שינוי ב-db. מצב הקודם נשמר לביטול.
    commit() {
      const now = JSON.stringify(this.db);
      if (now === this.lastSnapshot) return;
      this.undoStack.push(this.lastSnapshot);
      if (this.undoStack.length > 60) this.undoStack.shift();
      this.redoStack = [];
      this.lastSnapshot = now;
      this.scheduleSave();
    },
    scheduleSave() {
      const st = document.getElementById('save-state');
      st.textContent = 'שומר...';
      st.classList.add('dirty');
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.flush(), 400);
    },
    async flush() {
      clearTimeout(this.saveTimer);
      const st = document.getElementById('save-state');
      try {
        await window.api.saveDb(this.db);
        st.textContent = 'נשמר ✓';
        st.classList.remove('dirty');
      } catch (e) {
        st.textContent = 'שגיאה בשמירה!';
        toast('השמירה נכשלה: ' + e.message);
      }
    },
    undo() {
      if (!this.undoStack.length) { toast('אין מה לבטל'); return false; }
      this.redoStack.push(this.lastSnapshot);
      this.lastSnapshot = this.undoStack.pop();
      this.db = JSON.parse(this.lastSnapshot);
      this.scheduleSave();
      return true;
    },
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.lastSnapshot);
      this.lastSnapshot = this.redoStack.pop();
      this.db = JSON.parse(this.lastSnapshot);
      this.scheduleSave();
      return true;
    },
  };

  const migrate = Logic.migrate;

  window.UI = { el, clear, toast, modal, confirmBox, promptBox, field, select, today, fmtDate, kpi, pill, Store, migrate };
})();
