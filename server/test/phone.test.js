const test = require('node:test');
const assert = require('node:assert');
const P = require('../phone.js');

test('טקסט להקראה: בלי סימנים אסורים', () => {
  assert.strictEqual(P.ttsClean('שלום. נשאר (120) - תודה!'), 'שלום, נשאר, 120, תודה!');
  assert.strictEqual(P.ttsClean('ג\'ני "בת-שבע" <x>'), 'גני בת, שבע x');
  assert.strictEqual(P.spokenAmount(120), '120 שקלים');
  assert.strictEqual(P.spokenAmount(85.5), '85 שקלים ו 50 אגורות');
});
