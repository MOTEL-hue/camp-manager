'use strict';
const { createApp } = require('./app.js');
const db = require('./db.js');

(async () => {
  const pool = db.createPool();
  await db.init(pool);
  const port = process.env.PORT || 3000;
  createApp(pool).listen(port, () => console.log('camp-manager server on port ' + port));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
