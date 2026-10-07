# CLAUDE.md

תוכנת Electron בעברית (RTL) לניהול קייטנות ומכירות. משתמש יחיד, עובדת אופליין.
פרטים למשתמש ב-`README.md`, ושלבים הבאים ב-`docs/BACKLOG.md`.

## מבנה

| קובץ | תפקיד |
|---|---|
| `main.js` | חלון, שמירת הנתונים (`db.json` בתיקיית המשתמש, או ליד הקובץ בגרסה הניידת, + גיבוי יומי), דיאלוגי קבצים, הדפסה, עדכון אוטומטי |
| `preload.js` | הגשר היחיד בין הממשק למערכת (`window.api`) |
| `renderer/logic.js` | **כל החישובים** (לתשלום, יתרה, משפחות, סיכומים). טהור, נבדק ב-node |
| `renderer/importer.js` | זיהוי עמודות מאקסל/PDF ומיזוג לרשימה. טהור, נבדק ב-node |
| `renderer/ui.js` | בניית אלמנטים (`el`), חלונות, `Store` (שמירה + ביטול פעולה) |
| `renderer/views/*.js` | המסכים |

- הנתונים הם אובייקט JSON אחד (`Store.db`): `settings` ו-`projects`. לכל פרויקט רשימת אנשים משלו:
  `people`, `columns` (עמודות מותאמות), `hiddenFields`, ובנוסף `pricing`, `products`, `marks`,
  `enrollments` (לפי מזהה אדם), `payments`, `expenses`. העתקה בין פרויקטים: `Importer.copyPeople`.
- קישור בין פרויקטים (`project.links`): `Logic.coverage` מוצא את האדם בפרויקט המקושר לפי שם+כיתה.
  החישוב צריך את כל הפרויקטים, ולכן `Logic.setProjects` נקרא ב-`Store.commit` וב-`App.render`.
- עדכון אוטומטי: בגרסה המותקנת `electron-updater`; בגרסה הניידת `setupPortableUpdater` ב-`main.js`
  מוריד את ה-EXE החדש ומחליף אותו ב-PowerShell כשהתוכנה נסגרת. כל שלב נרשם ל-`update-log.txt`
  בתיקיית הנתונים ומוצג בפס העליון ובמסך ההגדרות - שגיאת עדכון אף פעם לא נבלעת בשקט.
- התראות (`renderer/views/notify.js`): מייל דרך Gmail SMTP עם סיסמת אפליקציה (nodemailer ב-`main.js`),
  והודעה קולית/צינוק דרך API של ימות המשיח (`yemot:call`, רק פקודות מרשימה סגורה). הסיסמאות ב-
  `secrets.json` מוצפנות ב-`safeStorage`, ואף פעם לא ב-`db.json`. קיבוץ למשפחה: `Logic.reminderGroups`.
- `Logic.migrate` מעדכן קבצים ישנים (כולל המעבר מרשימה כללית לרשימה לכל פרויקט).
- אחרי כל שינוי ב-`Store.db` קוראים ל-`Store.commit()` (שומר ומאפשר Ctrl+Z), או ל-`App.changed()`
  כשצריך לצייר את המסך מחדש.
- שדה חדש בנתונים: להוסיף ערך ברירת מחדל ב-`Logic.emptyDb`/`Logic.newProject`, ו-`Logic.migrate`
  ישלים אותו בקבצים ישנים.
- הכול בעברית, כולל קובץ ההתקנה (`nsis.language` = 1037).
- טקסט מהמשתמש או מקבצים נכנס רק דרך `el(...)` (textContent), לא דרך innerHTML.

## בדיקות

```bash
npm test
```

- כל באג שמתוקן מקבל בדיקה ב-`test/` שנכשלת לפניו ועוברת אחריו.
- חישוב חדש נכנס ל-`logic.js` (לא לקוד המסכים), כדי שאפשר יהיה לבדוק אותו.

## גרסאות

- מעלים `version` ב-`package.json` ודוחפים ל-`main`. `release.yml` בונה על ווינדוס ומפרסם
  ל-GitHub Releases; `electron-updater` בתוכנה המותקנת מוריד ומתקין בסגירה.
- בלי הערות גרסה בקוד. היסטוריה שייכת ל-git.

## תקשורת עם בעל/ת הפרויקט

- עברית פשוטה, בלי ז'רגון, קודם מה השתנה מבחינת המשתמש.
