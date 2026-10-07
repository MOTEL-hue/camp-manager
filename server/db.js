// חיבור למסד הנתונים (PostgreSQL ב-Neon) ויצירת הטבלאות אם אינן קיימות.
'use strict';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT NOT NULL,
  invited_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS phone_lines (
  user_id INTEGER PRIMARY KEY,
  line TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL UNIQUE,
  greeting TEXT NOT NULL DEFAULT ''
);
`;

async function init(pool) {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
}

function createPool() {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('חסר DATABASE_URL');
  return new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 5 });
}

module.exports = { init, createPool, SCHEMA };
