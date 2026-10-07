// ניווט בין המסכים, קיצורי מקלדת ועדכוני גרסה.
(function () {
  'use strict';
  const { el, clear, Store, toast } = UI;

  const App = {
    route: { view: 'projects' },
    go(view, params) {
      this.route = Object.assign({ view }, params || {});
      this.render();
    },
    render() {
      renderNav();
      const main = clear(document.getElementById('main'));
      const r = this.route;
      try {
        if (r.view === 'project') {
          const pr = Store.db.projects.find((p) => p.id === r.id);
          if (!pr) { this.route = { view: 'projects' }; return this.render(); }
          Views.project(main, pr, r.tab);
        } else if (r.view === 'settings') Views.settings(main);
        else Views.projects(main);
      } catch (e) {
        console.error(e);
        main.appendChild(el('div', { class: 'card' }, 'אירעה שגיאה בהצגת המסך: ' + e.message));
      }
    },
    // אחרי שינוי שמשפיע על כל המסך (מחיקה, הוספה, ייבוא).
    changed() {
      Store.commit();
      this.render();
    },
  };

  function renderNav() {
    const nav = clear(document.getElementById('nav'));
    const r = App.route;
    const item = (label, icon, active, onclick, extra) =>
      el('button', { class: 'nav-item' + (active ? ' active' : '') + (extra || ''), onclick }, el('span', null, icon), el('span', null, label));
    nav.appendChild(item('פרויקטים', '📁', r.view === 'projects', () => App.go('projects')));
    const active = Store.db.projects.filter((p) => !p.archived);
    for (const pr of active.slice(-8).reverse()) {
      nav.appendChild(item(pr.name, '•', r.view === 'project' && r.id === pr.id, () => App.go('project', { id: pr.id }), ' nav-sub'));
    }
    nav.appendChild(el('div', { class: 'nav-sep' }, 'כללי'));
    nav.appendChild(item('הגדרות וגיבוי', '⚙️', r.view === 'settings', () => App.go('settings')));
  }

  function setupUpdates() {
    const box = document.getElementById('update-box');
    window.api.onUpdate((s) => {
      clear(box);
      if (s.state === 'downloading') {
        box.classList.remove('hidden');
        box.appendChild(document.createTextNode('מוריד גרסה חדשה... ' + (s.percent || 0) + '%'));
      } else if (s.state === 'ready') {
        box.classList.remove('hidden');
        box.appendChild(document.createTextNode('גרסה ' + s.version + ' מוכנה. היא תותקן כשתסגור את התוכנה.'));
        box.appendChild(el('button', { class: 'btn small primary', onclick: async () => { await Store.flush(); window.api.installUpdate(); } }, 'עדכן עכשיו'));
      } else if (s.state === 'portable') {
        box.classList.remove('hidden');
        box.appendChild(document.createTextNode('יש גרסה חדשה (' + s.version + '). מורידים את הקובץ החדש ומחליפים את הישן; הנתונים נשארים בתיקייה.'));
        box.appendChild(el('button', { class: 'btn small primary', onclick: () => window.open(s.url) }, 'להורדה'));
      } else {
        box.classList.add('hidden');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !inField) {
      e.preventDefault();
      if (Store.undo()) { App.render(); toast('הפעולה האחרונה בוטלה'); }
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !inField) {
      e.preventDefault();
      if (Store.redo()) App.render();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      const s = document.querySelector('main input[type=search]');
      if (s) { e.preventDefault(); s.focus(); s.select(); }
    }
  });

  // גרירת קובץ אקסל או PDF לחלון = ייבוא.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls|csv|ods|pdf)$/i.test(file.name)) { toast('אפשר לגרור רק קובץ אקסל, CSV או PDF'); return; }
    const pr = App.route.view === 'project' && Store.db.projects.find((p) => p.id === App.route.id);
    if (!pr) { toast('קודם פותחים פרויקט, ואז גוררים אליו את הקובץ'); return; }
    Views.importDialog(pr, { file: { name: file.name, data: new Uint8Array(await file.arrayBuffer()) } });
  });

  window.addEventListener('beforeunload', () => { Store.flush(); });

  window.App = App;

  (async function start() {
    await Store.load();
    const info = await window.api.info();
    document.getElementById('version').textContent = 'גרסה ' + info.version;
    setupUpdates();
    App.render();
  })();
})();
