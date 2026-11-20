import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);

// --- SQLite tuning -----------------------------------------------------------
db.pragma('journal_mode = WAL');      // readers never block the writer
db.pragma('synchronous = NORMAL');    // safe with WAL, much faster
db.pragma('foreign_keys = ON');       // enforce relations
db.pragma('busy_timeout = 5000');     // wait instead of failing on a locked DB
db.pragma('temp_store = MEMORY');

/** Run fn inside a transaction (BEGIN IMMEDIATE avoids upgrade deadlocks on writes). */
export function tx(fn) {
  return db.transaction(fn).immediate();
}

/** Prepared-statement cache so hot queries are compiled once. */
const cache = new Map();
export function q(sql) {
  let st = cache.get(sql);
  if (!st) { st = db.prepare(sql); cache.set(sql, st); }
  return st;
}
export const all = (sql, ...p) => q(sql).all(...p);
export const get = (sql, ...p) => q(sql).get(...p);
export const run = (sql, ...p) => q(sql).run(...p);

/** Gap-free named sequence, must be called inside a transaction. */
export function nextSeq(name, prefix, pad = 4) {
  run('INSERT INTO counters(name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING', name);
  run('UPDATE counters SET value = value + 1 WHERE name = ?', name);
  const { value } = get('SELECT value FROM counters WHERE name = ?', name);
  return `${prefix}-${String(value).padStart(pad, '0')}`;
}

export function getSetting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
