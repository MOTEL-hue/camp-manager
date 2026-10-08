// התראות: תזכורות לחייבים (מייל / הודעה קולית / צינוק) ושליחת קבלה במייל.
(function () {
  'use strict';
  const { el, clear, Store, toast, modal, confirmBox, field, select, today } = UI;
  const L = Logic;
  window.Views = window.Views || {};

  const CHANNELS = [
    ['email', '📧 מייל'],
    ['tts', '📞 הודעה קולית עם הסכום'],
    ['tzintuk', '📳 צינוק (צלצול קצר)'],
  ];

  function templates() {
    const s = Store.db.settings;
    s.templates = Object.assign({}, L.DEFAULT_TEMPLATES, s.templates || {});
    return s.templates;
  }

  Views.reminderDialog = async function (pr) {
    const status = await window.api.secretsStatus();
    const tpl = templates();
    let channel = status.hasGmail ? 'email' : 'tts';
    const body = el('div');
    let groups = [];
    let chosen = new Set();

    const draw = () => {
      clear(body);
      groups = L.reminderGroups(pr, pr.people, channel === 'email' ? 'email' : 'phone');
      chosen = new Set(groups.filter((g) => g.key).map((g) => g.key));
      const ready = channel === 'email' ? status.hasGmail : status.hasYemot;
      body.appendChild(el('div', { class: 'toolbar' }, field('איך לשלוח', select(CHANNELS, channel, { onchange: (e) => { channel = e.target.value; draw(); } }))));
      if (!ready) {
        body.appendChild(el('div', { class: 'help' }, channel === 'email'
          ? 'צריך קודם להגדיר את חשבון ה-Gmail במסך "הגדרות וגיבוי".'
          : 'צריך קודם להגדיר את קו ימות המשיח במסך "הגדרות וגיבוי".',
        ' ', el('button', { class: 'btn small', onclick: () => { document.querySelector('.modal-back').remove(); App.go('settings'); } }, 'להגדרות')));
      }
      if (channel === 'email') {
        body.appendChild(field('נושא', el('input', { type: 'text', value: tpl.emailSubject, style: { width: '100%' }, onchange: (e) => { tpl.emailSubject = e.target.value; Store.commit(); preview(); } })));
        body.appendChild(field('נוסח המייל', el('textarea', { value: tpl.emailBody, style: { minHeight: '120px' }, onchange: (e) => { tpl.emailBody = e.target.value; Store.commit(); preview(); } })));
      } else if (channel === 'tts') {
        body.appendChild(field('הנוסח שיוקרא', el('textarea', { value: tpl.voice, onchange: (e) => { tpl.voice = e.target.value; Store.commit(); preview(); } })));
      } else {
        body.appendChild(el('p', { class: 'muted' }, 'צינוק הוא צלצול קצר מהקו, בלי לענות. ההורה רואה שיחה שלא נענתה ויכול להתקשר חזרה לבירור היתרה.'));
      }
      if (channel !== 'tzintuk') body.appendChild(el('p', { class: 'muted small' }, 'אפשר להשתמש ב: {שמות} {משפחה} {סכום} {פרויקט} {ארגון}' + (channel === 'email' ? ' {פירוט}' : '')));
      const pv = el('div', { class: 'help', style: { whiteSpace: 'pre-wrap' } });
      body.appendChild(pv);
      const preview = () => {
        const g = groups.find((x) => x.key);
        if (channel === 'tzintuk' || !g) { pv.classList.add('hidden'); return; }
        pv.classList.remove('hidden');
        pv.textContent = 'דוגמה: ' + (channel === 'email' ? L.fillTemplate(tpl.emailSubject, pr, g, Store.db.settings) + '\n\n' + L.fillTemplate(tpl.emailBody, pr, g, Store.db.settings) : L.fillTemplate(tpl.voice, pr, g, Store.db.settings));
      };
      preview();

      const count = el('strong');
      const updateCount = () => { count.textContent = `נבחרו ${chosen.size} מתוך ${groups.filter((g) => g.key).length}`; };
      body.appendChild(el('div', { class: 'toolbar', style: { marginTop: '10px' } }, count, el('div', { class: 'grow' }),
        el('button', { class: 'btn small', onclick: () => { chosen = new Set(groups.filter((g) => g.key).map((g) => g.key)); drawList(); } }, 'בחר הכול'),
        el('button', { class: 'btn small', onclick: () => { chosen.clear(); drawList(); } }, 'נקה')));
      const listWrap = el('div', { class: 'table-wrap', style: { maxHeight: '260px' } });
      body.appendChild(listWrap);
      const drawList = () => {
        updateCount();
        clear(listWrap).appendChild(el('table', { class: 'data' },
          el('thead', null, el('tr', null, el('th'), el('th', null, 'מי'), el('th', null, channel === 'email' ? 'מייל' : 'טלפון'), el('th', { class: 'num' }, 'יתרה'), el('th', null, 'תזכורת אחרונה'))),
          el('tbody', null, groups.map((g) => {
            const last = g.members.map((m) => (L.enrollment(pr, m.person.id) || {}).lastReminder).filter(Boolean).sort().pop();
            return el('tr', { class: g.key ? '' : 'dim' },
              el('td', null, g.key ? el('input', { type: 'checkbox', checked: chosen.has(g.key), onchange: (e) => { e.target.checked ? chosen.add(g.key) : chosen.delete(g.key); updateCount(); } }) : ''),
              el('td', null, g.members.map((m) => L.fullName(m.person)).join(', ')),
              el('td', { dir: 'ltr' }, g.key || (channel === 'email' ? 'אין מייל' : 'אין טלפון')),
              el('td', { class: 'num' }, L.money(g.total)),
              el('td', null, last ? UI.fmtDate(last) : ''));
          }))));
      };
      drawList();
    };

    draw();
    modal({
      title: '📣 תזכורות לחייבים - ' + pr.name,
      wide: true,
      body,
      buttons: [
        { label: 'שלח', primary: true, onclick: async () => {
          const targets = groups.filter((g) => g.key && chosen.has(g.key));
          if (!targets.length) { toast('לא נבחר אף נמען'); return false; }
          const what = { email: 'מיילים', tts: 'הודעות קוליות (עולות יחידות בימות המשיח)', tzintuk: 'צינוקים' }[channel];
          if (!(await confirmBox('שליחה', `לשלוח ${targets.length} ${what}?`, 'שלח'))) return false;
          await send(pr, channel, targets);
        } },
        { label: 'סגור' },
      ],
    });
  };

  async function send(pr, channel, targets) {
    const tpl = templates();
    const settings = Store.db.settings;
    let sent = 0;
    const failed = [];
    const progress = (i) => toast(`שולח... ${i} מתוך ${targets.length}`);
    if (channel === 'tzintuk') {
      // צינוק אחד לכל הרשימה: ימות המשיח מקבלים כמה מספרים בבת אחת.
      for (let i = 0; i < targets.length; i += 100) {
        const chunk = targets.slice(i, i + 100);
        const r = await window.api.yemot('RunTzintuk', { phones: chunk.map((g) => g.key).join(':') });
        if (r.ok) sent += chunk.length; else chunk.forEach((g) => failed.push([g, r.error]));
      }
    } else {
      for (let i = 0; i < targets.length; i++) {
        const g = targets[i];
        progress(i + 1);
        let r;
        if (channel === 'email') {
          r = await window.api.sendMail({
            to: g.key, fromName: settings.orgName,
            subject: L.fillTemplate(tpl.emailSubject, pr, g, settings),
            text: L.fillTemplate(tpl.emailBody, pr, g, settings),
          });
        } else {
          r = await window.api.yemot('SendTTS', { phones: g.key, ttsMessage: L.fillTemplate(tpl.voice, pr, g, settings).slice(0, 2000), repeatFile: 2 });
        }
        if (r.ok) sent++; else failed.push([g, r.error]);
        // הודעה ראשונה שנכשלה בגלל הגדרות שגויות - אין טעם להמשיך לכל הרשימה.
        if (!r.ok && i === 0 && /סיסמ|שגוי|הוגדר|חיבור/.test(r.error || '')) { targets.slice(1).forEach((x) => failed.push([x, 'לא נשלח'])); break; }
      }
    }
    const date = today();
    const failedSet = new Set(failed.map(([g]) => g));
    for (const g of targets) {
      if (failedSet.has(g)) continue;
      for (const m of g.members) L.ensureEnrollment(pr, m.person.id).lastReminder = date;
    }
    pr.reminders = pr.reminders || [];
    pr.reminders.push({ date, channel, sent, failed: failed.length });
    App.changed();
    if (!failed.length) { toast(`נשלחו ${sent} תזכורות ✓`); return; }
    modal({
      title: `נשלחו ${sent}, נכשלו ${failed.length}`,
      body: el('div', null, el('p', null, 'אלה לא נשלחו:'),
        el('ul', null, failed.slice(0, 50).map(([g, err]) => el('li', null, g.members.map((m) => L.fullName(m.person)).join(', ') + ' (' + g.key + '): ' + err)))),
    });
  }

  // שליחת קבלה במייל: הקבלה עצמה כקובץ PDF מצורף.
  Views.emailReceipt = async function (pr, p, receiptNo, buildNode) {
    const status = await window.api.secretsStatus();
    if (!status.hasGmail) { toast('צריך קודם להגדיר את חשבון ה-Gmail במסך "הגדרות וגיבוי"'); return; }
    const to = await UI.promptBox('שליחת קבלה במייל', 'לאיזו כתובת?', p.email || '');
    if (!to) return;
    if (!p.email) { p.email = to; Store.commit(); }
    const root = clear(document.getElementById('print-root'));
    root.appendChild(buildNode());
    let pdf;
    try { pdf = await window.api.pdfBuffer(); } finally { clear(root); }
    const settings = Store.db.settings;
    const title = (receiptNo ? `קבלה מס' ${receiptNo}` : 'פירוט חשבון') + ' - ' + pr.name;
    const r = await window.api.sendMail({
      to, fromName: settings.orgName, subject: title,
      text: `שלום רב,\n\nמצורפת ${receiptNo ? 'קבלה' : 'פירוט חשבון'} עבור ${L.fullName(p)} ב${pr.name}.\n\nתודה רבה,\n${settings.orgName || ''}`,
      attachments: [{ filename: title.replace(/[\\/:*?"<>|]/g, ' ') + '.pdf', content: pdf }],
    });
    toast(r.ok ? 'הקבלה נשלחה ל-' + to + ' ✓' : 'השליחה נכשלה: ' + r.error);
  };

  // כרטיסי ההגדרות: Gmail וקו ימות המשיח.
  Views.notifySettings = async function (main) {
    const st = await window.api.secretsStatus();
    const gUser = el('input', { type: 'email', value: st.gmailUser, placeholder: 'name@gmail.com', dir: 'ltr' });
    const gPass = el('input', { type: 'password', placeholder: st.hasGmail ? '•••••••• (שמורה - להחלפה הקלידו חדשה)' : '16 תווים מגוגל', dir: 'ltr' });
    main.appendChild(el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, '📧 שליחת מיילים מה-Gmail שלך'),
      el('div', { class: 'help' }, 'צריך "סיסמת אפליקציה" של גוגל (לא הסיסמה הרגילה): ',
        el('a', { href: 'https://myaccount.google.com/apppasswords', target: '_blank' }, 'myaccount.google.com/apppasswords'),
        ' ← כותבים שם (למשל "קייטנות") ← "יצירה" ← מעתיקים את 16 התווים לכאן. אם הדף לא נפתח - קודם מפעילים "אימות דו-שלבי" בחשבון גוגל.'),
      el('div', { class: 'form-row' }, field('כתובת Gmail', gUser), field('סיסמת אפליקציה', gPass)),
      el('div', { class: 'toolbar' },
        el('button', { class: 'btn primary', onclick: async () => {
          const v = { gmailUser: gUser.value };
          if (gPass.value) v.gmailPass = gPass.value;
          const saved = await window.api.setSecrets(v);
          if (saved && saved.ok === false) { toast(saved.error); return; }
          toast('נשמר. שולח מייל בדיקה...');
          const r = await window.api.sendMail({ to: gUser.value, subject: 'בדיקה מתוכנת ניהול הקייטנות', text: 'אם הגיע אליך המייל הזה - הכול מוגדר נכון ✓' });
          toast(r.ok ? 'מייל בדיקה נשלח ל-' + gUser.value + ' ✓' : 'הבדיקה נכשלה: ' + r.error);
          App.render();
        } }, 'שמור ובדוק'),
        st.hasGmail ? el('span', { class: 'pos' }, '✓ מוגדר') : el('span', { class: 'muted' }, 'לא מוגדר'))));

    const yLine = el('input', { type: 'text', value: st.yemotLine, placeholder: 'למשל 0773137770', dir: 'ltr' });
    const yPass = el('input', { type: 'password', placeholder: st.hasYemot ? '•••••••• (שמורה)' : 'הסיסמה של הקו', dir: 'ltr' });
    main.appendChild(el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, '📞 קו ימות המשיח לקייטנה (הודעות קוליות וצינוקים)'),
      el('p', { class: 'muted' }, 'מספר הקו והסיסמה שלו (כמו בכניסה לאתר ימות המשיח). הודעה קולית עולה יחידות לפי התעריף של ימות המשיח.'),
      el('div', { class: 'form-row' }, field('מספר הקו', yLine), field('סיסמה', yPass)),
      el('div', { class: 'toolbar' },
        el('button', { class: 'btn primary', onclick: async () => {
          const v = { yemotLine: yLine.value };
          if (yPass.value) v.yemotPass = yPass.value;
          const saved = await window.api.setSecrets(v);
          if (saved && saved.ok === false) { toast(saved.error); return; }
          const r = await window.api.yemot('GetSession', {});
          toast(r.ok ? 'החיבור לקו תקין ✓' + (r.data && r.data.units !== undefined ? ' · יחידות: ' + r.data.units : '') : 'הבדיקה נכשלה: ' + r.error);
          App.render();
        } }, 'שמור ובדוק'),
        st.hasYemot ? el('span', { class: 'pos' }, '✓ מוגדר') : el('span', { class: 'muted' }, 'לא מוגדר'))));
  };
})();
