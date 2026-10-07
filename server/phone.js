// שלוחת "בירור יתרה" בימות המשיח: ההורה מתקשר, ולפי המספר המזוהה שומע כמה נשאר לשלם.
'use strict';
const Logic = require('../renderer/logic.js');

// ימות המשיח מקריאים רק אותיות, ספרות, רווח ופסיק/נקודתיים/סימני שאלה וקריאה. נקודה ומקף מפרידים
// בין חלקי ההודעה בפרוטוקול, ולכן אסור שיופיעו בטקסט.
function ttsClean(text) {
  return String(text || '')
    .replace(/['"׳״`]/g, '')
    .replace(/[.;()\[\]{}…–—-]+/g, ', ')
    .replace(/[^א-תa-zA-Z0-9\s,:?!]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,[\s,]*/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
}

function spokenAmount(n) {
  const v = Logic.round2(n);
  const shekels = Math.floor(v);
  const agorot = Math.round((v - shekels) * 100);
  return agorot ? `${shekels} שקלים ו ${agorot} אגורות` : `${shekels} שקלים`;
}

// כל הילדים שאחד מטלפוני ההורים שלהם הוא המספר המתקשר, בכל הפרויקטים הפעילים.
function balancesFor(projects, callerPhone) {
  const phone = Logic.normPhone(callerPhone);
  const out = [];
  if (!phone) return out;
  Logic.setProjects(projects);
  for (const pr of projects) {
    if (pr.archived || pr.kind === 'list') continue;
    for (const p of pr.people || []) {
      const phones = [p.momPhone, p.dadPhone, p.homePhone].map(Logic.normPhone);
      if (!phones.includes(phone)) continue;
      const r = Logic.personRow(pr, p);
      if (!r.participant && !r.paid) continue;
      out.push({ project: pr.name, name: Logic.fullName(p), due: r.due, paid: r.paid, balance: r.balance, covered: r.coverLabel });
    }
  }
  Logic.setProjects([]);
  return out;
}

function balanceText(items, greeting) {
  const parts = [greeting ? ttsClean(greeting) : 'שלום'];
  if (!items.length) {
    parts.push('המספר שממנו התקשרתם לא נמצא ברשימות שלנו, לבירור אפשר לפנות למשרד');
    return parts.join(', ');
  }
  let total = 0;
  for (const it of items) {
    let s = `עבור ${it.name} ב${it.project}, `;
    if (it.balance > 0) s += `נשאר לתשלום ${spokenAmount(it.balance)}`;
    else if (it.covered && it.due === 0) s += `הרישום דרך ${it.covered}, אין חיוב`;
    else s += 'הכל שולם, תודה';
    parts.push(ttsClean(s));
    total += Math.max(0, it.balance);
  }
  if (items.length > 1 && total > 0) parts.push(`סך הכל נשאר לתשלום ${spokenAmount(total)}`);
  parts.push('תודה ולהתראות');
  return parts.join(', ');
}

function yemotResponse(text) {
  // הודעה ארוכה מחולקת לחלקים של עד כ-100 מילים (מגבלת ההקראה של ימות המשיח).
  const words = ttsClean(text).split(' ');
  const segs = [];
  for (let i = 0; i < words.length; i += 90) segs.push(words.slice(i, i + 90).join(' '));
  return 'id_list_message=' + encodeURIComponent(segs.map((s) => 't-' + s).join('.')) + '&go_to_folder=hangup';
}

module.exports = { ttsClean, spokenAmount, balancesFor, balanceText, yemotResponse };
