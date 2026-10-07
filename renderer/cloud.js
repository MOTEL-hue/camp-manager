// סנכרון עם האתר: פרויקטים שסומנו "לסנכרן" נשלחים ומתמזגים, ופרויקטים ששותפו איתי נמשכים מהאתר.
(function () {
  'use strict';
  const { el, clear, Store, toast, field, confirmBox } = UI;
  window.Views = window.Views || {};

  const Cloud = {
    status: { state: 'off', at: null, error: '' },
    account: null, // {email, name} כשמחובר
    running: false,
    again: false,
    timer: null,

    async refreshAccount() {
      const st = await window.api.secretsStatus();
      this.account = st.hasCloud ? { email: st.cloudEmail, name: st.cloudName, url: st.cloudUrl } : null;
      this.url = st.cloudUrl;
      return this.account;
    },

    setStatus(state, error) {
      this.status = { state, at: new Date(), error: error || '' };
      const box = document.getElementById('cloud-state');
      if (!box) return;
      const t = this.status.at.toTimeString().slice(0, 5);
      box.textContent = { off: '', syncing: '☁️ מסנכרן...', ok: '☁️ מסונכרן ' + t, offline: '☁️ אין חיבור - יסונכרן אחר כך', error: '☁️ שגיאה בסנכרון' }[state] || '';
      box.title = error || '';
      box.className = 'cloud-state ' + state;
    },

    // אחרי שינוי מקומי: סנכרון קצר אחרי שמפסיקים להקליד.
    soon() {
      if (!this.account || !Store.db.projects.some((p) => p.cloud && p.cloud.sync)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.syncAll(), 4000);
    },

    async syncAll() {
      if (!this.account) return;
      if (this.running) { this.again = true; return; }
      this.running = true;
      this.setStatus('syncing');
      let changed = false;
      try {
        // 1. פרויקטים ששותפו איתי (או שסונכרנו ממחשב אחר) ועוד אין במחשב הזה
        const list = await window.api.cloud('GET', '/api/projects');
        if (!list.ok) throw list;
        const remote = new Map(list.data.projects.map((p) => [p.id, p]));
        for (const rp of list.data.projects) {
          const local = Store.db.projects.find((p) => p.id === rp.id);
          if (local && local.cloud && local.cloud.sync) continue;
          if (local && local.cloud && local.cloud.declined) continue;
          if (local) continue; // קיים מקומית בלי סנכרון - לא דורסים; המשתמש יכול לסמן לסנכרן
          const r = await window.api.cloud('GET', '/api/projects/' + rp.id);
          if (!r.ok) continue;
          const pr = r.data.data;
          pr.cloud = { sync: true, role: rp.role, owner: rp.owner_name || rp.owner_email };
          Store.replaceProject(pr);
          changed = true;
          toast(`הפרויקט "${pr.name}" נוסף מהאתר`);
        }
        // 2. כל פרויקט מסומן: שולחים, מקבלים את המאוחד, וממזגים עם מה שהשתנה בינתיים
        for (const pr of Store.db.projects.filter((p) => p.cloud && p.cloud.sync)) {
          if (pr.cloud.synced && !remote.has(pr.id)) {
            // היה מסונכרן ונעלם מהאתר: השיתוף בוטל או שהפרויקט נמחק מהאתר. נשאר במחשב, בלי סנכרון.
            pr.cloud = { sync: false };
            Store.replaceProject(pr);
            changed = true;
            toast(`הפרויקט "${pr.name}" כבר לא משותף באתר - הוא נשאר במחשב בלבד`);
            continue;
          }
          const sent = JSON.stringify(pr);
          const r = await window.api.cloud('POST', '/api/projects/' + pr.id + '/sync', { data: Sync.forUpload(pr) });
          if (!r.ok) throw r;
          const current = Store.db.projects.find((p) => p.id === pr.id);
          if (!current) continue;
          const merged = Sync.merge(current, r.data.data);
          merged.cloud = Object.assign({}, current.cloud, { synced: true, rev: r.data.rev, role: (remote.get(pr.id) || {}).role || current.cloud.role || 'owner' });
          if (JSON.stringify(merged) !== JSON.stringify(current)) {
            const stillSame = JSON.stringify(current) === sent;
            Store.replaceProject(merged);
            if (!stillSame || JSON.stringify(Sync.forUpload(merged)) !== JSON.stringify(Sync.forUpload(current))) changed = true;
          }
        }
        this.setStatus('ok');
      } catch (e) {
        this.setStatus(e && e.offline ? 'offline' : 'error', e && e.error);
        if (e && e.status === 401) { this.account = null; toast('החיבור לאתר פג - צריך להתחבר מחדש בהגדרות'); }
      } finally {
        this.running = false;
      }
      if (changed) safeRender();
      if (this.again) { this.again = false; this.syncAll(); }
    },
  };

  // לא מציירים מחדש באמצע הקלדה בשדה - מחכים שהשדה ייעזב.
  let pendingRender = false;
  function safeRender() {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('main, .modal')) {
      if (!pendingRender) {
        pendingRender = true;
        a.addEventListener('blur', () => { pendingRender = false; setTimeout(() => App.render(), 50); }, { once: true });
      }
      return;
    }
    if (document.querySelector('.modal-back')) return; // חלון פתוח - הנתונים יוצגו כשייסגר
    App.render();
  }

  // ---------- מסך ההגדרות: חשבון באתר ----------
  Views.cloudSettings = async function (main) {
    await Cloud.refreshAccount();
    const card = el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, '☁️ חשבון באתר הסנכרון'));
    main.appendChild(card);
    if (Cloud.account) {
      card.appendChild(el('p', null, 'מחובר/ת כ: ', el('strong', null, Cloud.account.name || Cloud.account.email), Cloud.account.name ? ' (' + Cloud.account.email + ')' : ''));
      card.appendChild(el('p', { class: 'muted small' }, 'כדי לסנכרן פרויקט: בהגדרות הפרויקט מסמנים "לסנכרן לאתר". פרויקטים ששותפו איתך מופיעים כאן לבד. ' + (Cloud.status.state !== 'off' ? 'מצב: ' + (document.getElementById('cloud-state') || {}).textContent : '')));
      card.appendChild(el('div', { class: 'toolbar' },
        el('button', { class: 'btn', onclick: () => Cloud.syncAll() }, '🔄 סנכרן עכשיו'),
        el('button', { class: 'btn', onclick: () => window.open(Cloud.url) }, '🌐 פתח את האתר'),
        el('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmBox('התנתקות', 'להתנתק מהאתר? הפרויקטים נשארים במחשב, אבל לא יסונכרנו עד שתתחבר/י שוב.', 'התנתק'))) return;
          await window.api.cloudLogout(); Cloud.account = null; Cloud.setStatus('off'); App.render();
        } }, 'התנתקות')));
      return;
    }
    const url = el('input', { type: 'text', value: Cloud.url || '', dir: 'ltr' });
    const name = el('input', { type: 'text', placeholder: 'השם שלך (לחשבון חדש)' });
    const email = el('input', { type: 'email', dir: 'ltr' });
    const pass = el('input', { type: 'password', dir: 'ltr', placeholder: 'לפחות 8 תווים' });
    const go = async (mode) => {
      const r = await window.api.cloudLogin({ mode, url: url.value, email: email.value, password: pass.value, name: name.value });
      if (!r.ok) { toast(r.error); return; }
      toast(mode === 'register' ? 'החשבון נפתח ✓' : 'מחובר/ת ✓');
      await Cloud.refreshAccount();
      Cloud.syncAll();
      App.render();
    };
    card.appendChild(el('p', { class: 'muted' }, 'חשבון משלך באתר הסנכרון: מסנכרן בין המחשבים שלך, ומאפשר לשתף פרויקט עם חשבון של מישהו אחר. רק פרויקטים שמסמנים עולים לאתר.'));
    card.appendChild(el('div', { class: 'form-row' }, field('מייל', email), field('סיסמה', pass)));
    card.appendChild(el('div', { class: 'form-row' }, field('שם (רק לחשבון חדש)', name), field('כתובת האתר', url)));
    card.appendChild(el('div', { class: 'toolbar' },
      el('button', { class: 'btn primary', onclick: () => go('login') }, 'כניסה'),
      el('button', { class: 'btn', onclick: () => go('register') }, 'פתיחת חשבון חדש')));
  };

  // ---------- הגדרות הפרויקט: סנכרון ושיתוף ----------
  Views.projectCloudCard = function (root, pr) {
    const card = el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, '☁️ סנכרון ושיתוף'));
    root.appendChild(card);
    if (!Cloud.account) {
      card.appendChild(el('p', { class: 'muted' }, 'כדי לסנכרן או לשתף, קודם מתחברים לחשבון באתר במסך "הגדרות וגיבוי".'),
        el('button', { class: 'btn', onclick: () => App.go('settings') }, 'להגדרות'));
      return;
    }
    const synced = !!(pr.cloud && pr.cloud.sync);
    card.appendChild(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: synced, onchange: async (e) => {
      if (e.target.checked) {
        pr.cloud = { sync: true, role: 'owner' };
        Sync.stamp(null, pr, Date.now());
        Store.commit();
        toast('הפרויקט יסונכרן לאתר');
        await Cloud.syncAll();
      } else {
        const owner = !pr.cloud || pr.cloud.role === 'owner';
        const ok = await confirmBox('הפסקת סנכרון', owner
          ? 'להפסיק לסנכרן? הפרויקט יימחק מהאתר (ושותפים לא יראו אותו יותר), אבל יישאר אצלך במחשב.'
          : 'לצאת מהשיתוף? הפרויקט יישאר אצלך במחשב, בלי עדכונים מהאתר.', 'הפסק');
        if (!ok) { e.target.checked = true; return; }
        await window.api.cloud('DELETE', '/api/projects/' + pr.id);
        pr.cloud = { sync: false, declined: true };
        Store.commit();
      }
      App.render();
    } }), 'לסנכרן את הפרויקט הזה לאתר'));
    if (!synced) return;
    if (pr.cloud.role && pr.cloud.role !== 'owner') {
      card.appendChild(el('p', { class: 'muted' }, 'הפרויקט שותף איתך' + (pr.cloud.owner ? ' על ידי ' + pr.cloud.owner : '') + '. שינויים שלך ושלהם מתעדכנים אצל כולם.'));
      return;
    }
    const list = el('div', { class: 'muted small' }, 'טוען שותפים...');
    const email = el('input', { type: 'email', dir: 'ltr', placeholder: 'מייל של מי שאיתו משתפים' });
    card.appendChild(list);
    card.appendChild(el('div', { class: 'toolbar', style: { marginTop: '8px' } }, email,
      el('button', { class: 'btn primary', onclick: async () => {
        await Cloud.syncAll();
        const r = await window.api.cloud('POST', '/api/projects/' + pr.id + '/invite', { email: email.value });
        if (!r.ok) { toast(r.error); return; }
        toast(r.data.joined ? 'השותף/ה נוסף/ה ✓ - הפרויקט יופיע אצלו/ה בסנכרון הבא' : 'נשלחה הזמנה: הפרויקט יופיע אצלו/ה ברגע שייפתח חשבון עם המייל הזה');
        email.value = '';
        loadMembers();
      } }, 'שיתוף')));
    async function loadMembers() {
      const r = await window.api.cloud('GET', '/api/projects/' + pr.id + '/members');
      clear(list);
      if (!r.ok) { list.textContent = r.offline ? 'אין חיבור לאתר' : 'עוד לא סונכרן'; return; }
      list.appendChild(el('div', null, 'שותפים: ', r.data.members.map((m, i) => [i ? ', ' : '', (m.name || m.email) + (m.role === 'owner' ? ' (את/ה)' : ''),
        m.role !== 'owner' ? el('button', { class: 'btn small ghost danger', onclick: async () => { await window.api.cloud('DELETE', '/api/projects/' + pr.id + '/members/' + m.id); loadMembers(); } }, '✕') : null])));
      if (r.data.invites.length) list.appendChild(el('div', null, 'ממתינים לפתיחת חשבון: ' + r.data.invites.join(', ')));
    }
    loadMembers();
  };

  window.Cloud = Cloud;
})();
