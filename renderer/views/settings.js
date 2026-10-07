// הגדרות כלליות, גיבוי ושחזור.
(function () {
  'use strict';
  const { el, Store, toast, field, confirmBox } = UI;
  window.Views = window.Views || {};

  Views.settings = async function (main) {
    const s = Store.db.settings;
    main.appendChild(el('div', { class: 'page-head' }, el('h1', null, 'הגדרות וגיבוי')));

    main.appendChild(el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, 'פרטים לקבלות'),
      el('div', { class: 'form-row' },
        field('שם הארגון / המוסד (מופיע בראש הקבלה)', el('input', { type: 'text', value: s.orgName || '', onchange: (e) => { s.orgName = e.target.value.trim(); Store.commit(); } })),
        field('מספר הקבלה הבא', el('input', { type: 'number', min: 1, value: s.nextReceiptNo, onchange: (e) => { s.nextReceiptNo = Math.max(1, parseInt(e.target.value, 10) || 1); Store.commit(); } }))),
      field('שורת סיום בקבלה', el('input', { type: 'text', value: s.receiptFooter || '', onchange: (e) => { s.receiptFooter = e.target.value; Store.commit(); } }))));

    await Views.notifySettings(main);
    const info = await window.api.info();
    main.appendChild(el('div', { class: 'card', style: { marginBottom: '14px' } }, el('h3', null, 'גיבוי'),
      el('p', { class: 'muted' }, 'התוכנה שומרת לבד כל שינוי, ושומרת גיבוי יומי של 30 הימים האחרונים. כדאי מדי פעם לשמור גיבוי גם בדיסק-און-קי או במייל.'),
      el('div', { class: 'toolbar' },
        el('button', { class: 'btn primary', onclick: backup }, '💾 שמירת קובץ גיבוי'),
        el('button', { class: 'btn', onclick: restore }, '♻️ שחזור מקובץ גיבוי'),
        el('button', { class: 'btn', onclick: () => window.api.openDataDir() }, '📂 פתח את תיקיית הנתונים')),
      el('p', { class: 'muted small', dir: 'ltr', style: { textAlign: 'right' } }, info.dataDir)));

    main.appendChild(el('div', { class: 'card' }, el('h3', null, 'עדכוני גרסה'),
      el('p', null, 'גרסה נוכחית: ' + info.version),
      el('p', { class: 'muted' }, info.portable
        ? 'זו הגרסה הניידת. כשיש אינטרנט היא מורידה לבד גרסה חדשה, ומחליפה את הקובץ כשסוגרים את התוכנה. הנתונים (בתיקייה שליד הקובץ) נשארים.'
        : 'כשיש אינטרנט, התוכנה בודקת לבד אם יש גרסה חדשה ומורידה אותה. ההתקנה נעשית כשסוגרים את התוכנה. הנתונים שלך לא נפגעים בעדכון.'),
      el('p', { class: App.updateStatus.state === 'error' ? 'neg' : '' }, 'מצב: ' + App.updateText(App.updateStatus)),
      info.packaged ? el('div', { class: 'toolbar' },
        el('button', { class: 'btn', onclick: () => { toast('בודק עדכונים...'); window.api.checkUpdate(); } }, '🔄 בדוק עכשיו'),
        el('button', { class: 'btn', onclick: () => window.open('https://github.com/MOTEL-hue/camp-manager/releases/latest') }, '⬇️ הורדה ידנית'),
        el('button', { class: 'btn', onclick: () => window.api.openDataDir() }, '📄 יומן העדכונים (update-log.txt)'))
        : el('p', { class: 'muted small' }, '(גרסת פיתוח - בלי עדכונים)')));
  };

  async function backup() {
    const data = new TextEncoder().encode(JSON.stringify(Store.db, null, 1));
    const saved = await window.api.saveFile({ defaultName: 'גיבוי ניהול קייטנות ' + UI.today() + '.json', filters: [{ name: 'גיבוי', extensions: ['json'] }], data });
    if (saved) toast('הגיבוי נשמר');
  }

  async function restore() {
    const f = await window.api.openFile({ title: 'בחירת קובץ גיבוי', filters: [{ name: 'גיבוי', extensions: ['json'] }] });
    if (!f) return;
    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(f.data));
      if (!Array.isArray(data.projects)) throw new Error('הקובץ לא נראה כמו גיבוי של התוכנה');
    } catch (e) {
      toast('לא ניתן לקרוא את הקובץ: ' + e.message);
      return;
    }
    if (!(await confirmBox('שחזור', `לשחזר מהגיבוי (${data.projects.length} פרויקטים)? הנתונים הנוכחיים יוחלפו. אפשר לבטל עם Ctrl+Z.`, 'שחזר'))) return;
    UI.migrate(data);
    Store.db = data;
    App.changed();
    toast('השחזור הושלם');
  }
})();
