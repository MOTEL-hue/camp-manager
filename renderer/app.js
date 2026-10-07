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
      Logic.setProjects(Store.db.projects);
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

  // מצב העדכון: בתיבה בצד, ובמסך ההגדרות (App.updateStatus).
  function updateText(s) {
    switch (s.state) {
      case 'checking': return 'בודק אם יש גרסה חדשה...';
      case 'none': return 'יש לך את הגרסה העדכנית ביותר (' + (s.version || '') + ').';
      case 'available': return 'נמצאה גרסה ' + s.version + ', מתחיל להוריד...';
      case 'downloading': return 'מוריד גרסה חדשה... ' + (s.percent || 0) + '%';
      case 'ready': return 'גרסה ' + s.version + ' מוכנה. היא תותקן לבד כשתסגור את התוכנה.';
      case 'applying': return 'מחליף לגרסה החדשה...';
      case 'portable': return 'יש גרסה חדשה (' + s.version + ').';
      case 'error': return 'העדכון האוטומטי נכשל: ' + (s.message || '') + '. אפשר להוריד את הגרסה החדשה ידנית.';
      default: return 'עוד לא נבדק.';
    }
  }

  // פס עליון בולט כשיש עדכון: מוריד / מוכן / נכשל.
  let bannerClosed = '';
  function renderBanner(s) {
    const b = document.getElementById('update-banner');
    clear(b);
    const show = ['available', 'downloading', 'ready', 'portable', 'error'].includes(s.state) && bannerClosed !== s.state + s.version;
    b.classList.toggle('hidden', !show);
    b.classList.toggle('error', s.state === 'error');
    document.body.classList.toggle('has-banner', show);
    if (!show) return;
    const title = s.state === 'error' ? '⚠️ ' : '🎉 יש עדכון חדש · ';
    b.appendChild(el('span', null, title + updateText(s)));
    if (s.state === 'downloading') b.appendChild(el('div', { class: 'bar' }, el('div', { style: { width: (s.percent || 0) + '%' } })));
    b.appendChild(el('div', { class: 'grow' }));
    if (s.state === 'ready') b.appendChild(el('button', { class: 'btn small primary', onclick: installNow }, 'עדכן עכשיו'));
    if (s.state === 'portable' || s.state === 'error') b.appendChild(el('button', { class: 'btn small primary', onclick: () => window.open(s.url) }, 'להורדה ידנית'));
    b.appendChild(el('button', { class: 'btn small', title: 'הסתר', onclick: () => { bannerClosed = s.state + s.version; renderBanner(s); } }, '✕'));
  }

  async function installNow() {
    await Store.flush();
    window.api.installUpdate();
  }

  function readyPopup(s) {
    UI.modal({
      title: '🎉 יש עדכון חדש!',
      body: el('div', null,
        el('p', null, `גרסה ${s.version} הורדה ומוכנה להתקנה.`),
        el('p', { class: 'muted' }, 'אפשר לעדכן עכשיו (התוכנה תיסגר ותיפתח מחדש תוך כמה שניות), או להמשיך לעבוד - העדכון יותקן לבד כשסוגרים את התוכנה. הנתונים לא נפגעים.')),
      buttons: [
        { label: 'עדכן עכשיו', primary: true, onclick: installNow },
        { label: 'אחר כך' },
      ],
    });
  }

  function setupUpdates() {
    const box = document.getElementById('update-box');
    window.api.updateStatus && window.api.updateStatus().then((s) => { if (s) App.updateStatus = s; });
    window.api.onUpdate((s) => {
      const changed = App.updateStatus.state !== s.state;
      App.updateStatus = s;
      if (changed && App.route.view === 'settings') App.render();
      renderBanner(s);
      if (s.state === 'ready' && changed) readyPopup(s);
      clear(box);
      if (s.state === 'downloading') {
        box.classList.remove('hidden');
        box.appendChild(document.createTextNode('מוריד גרסה חדשה... ' + (s.percent || 0) + '%'));
      } else if (s.state === 'ready') {
        box.classList.remove('hidden');
        box.appendChild(document.createTextNode('גרסה ' + s.version + ' מוכנה. היא תותקן לבד כשתסגור את התוכנה.'));
        box.appendChild(el('button', { class: 'btn small primary', onclick: async () => { await Store.flush(); window.api.installUpdate(); } }, 'עדכן עכשיו'));
      } else if (s.state === 'portable' || s.state === 'error') {
        box.classList.remove('hidden');
        box.appendChild(document.createTextNode(updateText(s)));
        box.appendChild(el('button', { class: 'btn small primary', onclick: () => window.open(s.url) }, 'להורדה ידנית'));
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

  App.updateStatus = { state: 'idle' };
  App.updateText = updateText;
  window.App = App;

  (async function start() {
    await Store.load();
    const info = await window.api.info();
    document.getElementById('version').textContent = 'גרסה ' + info.version;
    setupUpdates();
    App.render();
  })();
})();
