// SQLite storage for LoLphabet (Node 22+, built-in node:sqlite, no npm packages).
//
// The rest of the app still works with one in-memory object, `db`, shaped exactly like the old data.json:
//   db.users[id] (with .progress), db.sessions, db.shares, db.templates, db.roles, db.visits, db.authTokens, db.adminMeta, db.mail
// What changed is how it is saved. Instead of rewriting one big file on every change, persist() writes only the rows that
// actually changed, inside one SQLite transaction. A crash can never leave a half-written database, and a user's progress is
// stored one row per list, so saving one list does not touch anyone else's data.
//
//   persist()                  everything (safe default: compares every row with what was last saved and writes the differences)
//   persist("user:<id>")       one account and its progress lists (also removes it if the account is gone)
//   persist("sessions") / ("tokens") / ("shares") / ("templates") / ("meta") / ("roles") / ("visits") / ("mail")
//   persist.soon()             visit counter: saved within a few seconds instead of on every visit
//
// Tables: users, progress (one row per user + list), sessions, auth_tokens, shares, templates, admin_meta, kv, meta.
"use strict";
const fs = require("fs"), path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 1;
const LEGACY_MODE = /\|(random|randhard|randhc)$/;       // retired challenge modes (Random, Random + Hard, Random + Insanity)
const isLegacyKey = k => LEGACY_MODE.test(String(k));
const isObj = o => o !== null && typeof o === "object" && !Array.isArray(o);
const setOwn = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });   // safe even for a key like "__proto__"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  name  TEXT GENERATED ALWAYS AS (json_extract(data,'$.name'))  VIRTUAL,
  email TEXT GENERATED ALWAYS AS (json_extract(data,'$.email')) VIRTUAL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS progress (
  user_id  TEXT NOT NULL,
  list_key TEXT NOT NULL,
  ord      INTEGER NOT NULL DEFAULT 0,
  data     TEXT NOT NULL,
  PRIMARY KEY (user_id, list_key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sessions (
  k TEXT PRIMARY KEY, data TEXT NOT NULL,
  sub TEXT GENERATED ALWAYS AS (json_extract(data,'$.sub')) VIRTUAL,
  exp INTEGER GENERATED ALWAYS AS (json_extract(data,'$.exp')) VIRTUAL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sessions_sub ON sessions(sub);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(exp);
CREATE TABLE IF NOT EXISTS auth_tokens (
  k TEXT PRIMARY KEY, data TEXT NOT NULL,
  exp INTEGER GENERATED ALWAYS AS (json_extract(data,'$.exp')) VIRTUAL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS shares (
  k TEXT PRIMARY KEY, data TEXT NOT NULL,
  sub TEXT GENERATED ALWAYS AS (json_extract(data,'$')) VIRTUAL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS templates (
  k TEXT PRIMARY KEY, data TEXT NOT NULL,
  sub TEXT GENERATED ALWAYS AS (json_extract(data,'$.sub')) VIRTUAL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS admin_meta (k TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
`;

// Top-level sections of the old data.json. Anything else found there makes the migration stop instead of silently dropping it.
const LEGACY_SECTIONS = ["users", "sessions", "shares", "templates", "roles", "visits", "authTokens", "adminMeta", "mail"];
const KEYED = [   // [db property, table]
  ["sessions", "sessions"], ["authTokens", "auth_tokens"], ["shares", "shares"], ["templates", "templates"], ["adminMeta", "admin_meta"],
];
const KV_KEYS = ["roles", "visits", "mail", "riot"];

const freshVisits = () => ({ total: 0, day: "", salt: "", seen: {}, ip: {} });
function normalise(db) {
  for (const [p] of KEYED) if (!isObj(db[p])) db[p] = {};
  if (!isObj(db.users)) db.users = {};
  if (!isObj(db.visits)) db.visits = freshVisits();
  return db;
}

class StoreError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

function open(file, opts = {}) {
  const legacyFile = opts.legacyFile || null;
  const existed = fs.existsSync(file);
  if (!existed && legacyFile && fs.existsSync(legacyFile) && !opts.allowEmpty)
    throw new StoreError("Found the old " + path.basename(legacyFile) + " but no " + path.basename(file) + " yet.\n" +
      "Run the migration first so no accounts are lost:\n  node migrate.js            (dry run, changes nothing)\n  node migrate.js --apply    (creates " + path.basename(file) + ")", "NEEDS_MIGRATION");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const sql = new DatabaseSync(file);
  sql.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF;");
  if (existed) {                       // refuse to run on a damaged database rather than start empty and overwrite it
    let qc = "?"; try { qc = sql.prepare("PRAGMA quick_check").get().quick_check; } catch (e) { qc = e.message; }
    if (qc !== "ok") { try { sql.close(); } catch (e) {} throw new StoreError("The database " + file + " failed its integrity check (" + qc + "). Not starting. Restore the newest file in the backups folder.", "CORRUPT"); }
  }
  sql.exec(SCHEMA);
  const getMeta = k => { const r = sql.prepare("SELECT v FROM meta WHERE k=?").get(k); return r ? r.v : null; };
  const setMeta = (k, v) => sql.prepare("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
  const ver = Number(getMeta("schema_version") || 0);
  if (ver > SCHEMA_VERSION) throw new StoreError("This database was made by a newer version of the app (schema " + ver + ").", "NEWER");
  if (!ver) { setMeta("schema_version", SCHEMA_VERSION); setMeta("created", new Date().toISOString()); }

  const db = normalise({});
  const snap = { users: new Map(), progress: new Map(), kv: new Map(), keyed: {} };
  for (const [, t] of KEYED) snap.keyed[t] = new Map();

  // ---------- load ----------
  function load() {
    for (const r of sql.prepare("SELECT id,data FROM users").all()) { const u = JSON.parse(r.data); u.progress = {}; db.users[r.id] = u; snap.users.set(r.id, r.data); snap.progress.set(r.id, new Map()); }
    for (const r of sql.prepare("SELECT user_id,list_key,data FROM progress ORDER BY user_id, ord, list_key").all()) {
      const u = db.users[r.user_id]; if (!u) continue;                                    // orphan rows are ignored (and cleaned up on the next save of that id)
      setOwn(u.progress, r.list_key, JSON.parse(r.data)); snap.progress.get(r.user_id).set(r.list_key, r.data);
    }
    for (const [p, t] of KEYED) for (const r of sql.prepare("SELECT k,data FROM " + t).all()) { setOwn(db[p], r.k, JSON.parse(r.data)); snap.keyed[t].set(r.k, r.data); }
    for (const r of sql.prepare("SELECT k,data FROM kv").all()) if (KV_KEYS.includes(r.k)) { db[r.k] = JSON.parse(r.data); snap.kv.set(r.k, r.data); }
    normalise(db);
  }
  load();

  // ---------- save ----------
  let pending = [];               // snapshot updates, applied only after COMMIT succeeds
  const st = {
    upUser: sql.prepare("INSERT INTO users(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data"),
    delUser: sql.prepare("DELETE FROM users WHERE id=?"),
    upProg: sql.prepare("INSERT INTO progress(user_id,list_key,ord,data) VALUES(?,?,?,?) ON CONFLICT(user_id,list_key) DO UPDATE SET ord=excluded.ord, data=excluded.data"),
    delProg: sql.prepare("DELETE FROM progress WHERE user_id=? AND list_key=?"),
    delProgAll: sql.prepare("DELETE FROM progress WHERE user_id=?"),
    up: {}, del: {},
    upKv: sql.prepare("INSERT INTO kv(k,data) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET data=excluded.data"),
    delKv: sql.prepare("DELETE FROM kv WHERE k=?"),
  };
  for (const [, t] of KEYED) { st.up[t] = sql.prepare("INSERT INTO " + t + "(k,data) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET data=excluded.data"); st.del[t] = sql.prepare("DELETE FROM " + t + " WHERE k=?"); }

  function saveUser(id) {
    const u = db.users[id];
    if (!u) {
      if (snap.users.has(id) || snap.progress.has(id)) { st.delProgAll.run(id); st.delUser.run(id); pending.push(() => { snap.users.delete(id); snap.progress.delete(id); }); }
      return;
    }
    const { progress, ...rest } = u, j = JSON.stringify(rest);
    if (snap.users.get(id) !== j) { st.upUser.run(id, j); pending.push(() => snap.users.set(id, j)); }
    const p = isObj(progress) ? progress : {}, old = snap.progress.get(id) || new Map(), nu = new Map(), keys = Object.keys(p);
    keys.forEach((k, i) => { const pj = JSON.stringify(p[k]); nu.set(k, pj); if (old.get(k) !== pj) st.upProg.run(id, k, i, pj); });
    for (const k of old.keys()) if (!nu.has(k)) st.delProg.run(id, k);
    pending.push(() => snap.progress.set(id, nu));
  }
  function saveUsers() {
    for (const id of Object.keys(db.users)) saveUser(id);
    for (const id of [...snap.users.keys()]) if (!hasOwn(db.users, id)) saveUser(id);          // accounts deleted since the last save
  }
  function saveKeyed(p, t) {
    const cur = isObj(db[p]) ? db[p] : {}, old = snap.keyed[t], nu = new Map();
    for (const k of Object.keys(cur)) { const j = JSON.stringify(cur[k]); nu.set(k, j); if (old.get(k) !== j) st.up[t].run(k, j); }
    for (const k of old.keys()) if (!nu.has(k)) st.del[t].run(k);
    pending.push(() => { snap.keyed[t] = nu; });
  }
  function saveKv(k) {
    const v = db[k];
    if (v === undefined || v === null) { if (snap.kv.has(k)) { st.delKv.run(k); pending.push(() => snap.kv.delete(k)); } return; }
    const j = JSON.stringify(v); if (snap.kv.get(k) !== j) { st.upKv.run(k, j); pending.push(() => snap.kv.set(k, j)); }
  }
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  let soonTimer = null;
  function persist(...scopes) {
    if (!scopes.length) scopes = ["all"];
    sql.exec("BEGIN IMMEDIATE");
    pending = [];
    try {
      const done = new Set();
      for (const s of scopes) {
        if (done.has(s)) continue; done.add(s);
        if (s === "all") { saveUsers(); for (const [p, t] of KEYED) saveKeyed(p, t); for (const k of KV_KEYS) saveKv(k); }
        else if (s === "users") saveUsers();
        else if (s.startsWith("user:")) saveUser(s.slice(5));
        else if (s === "sessions") saveKeyed("sessions", "sessions");
        else if (s === "tokens") saveKeyed("authTokens", "auth_tokens");
        else if (s === "shares") saveKeyed("shares", "shares");
        else if (s === "templates") saveKeyed("templates", "templates");
        else if (s === "meta") saveKeyed("adminMeta", "admin_meta");
        else if (KV_KEYS.includes(s)) saveKv(s);
        else throw new Error("persist: unknown scope " + s);
      }
      sql.exec("COMMIT");
    } catch (e) { try { sql.exec("ROLLBACK"); } catch (_) {} pending = []; throw e; }
    for (const f of pending) f(); pending = [];
  }
  // Visits are counted on every page load; saving them a few seconds later (and on shutdown) is plenty.
  persist.soon = () => { if (soonTimer) return; soonTimer = setTimeout(() => { soonTimer = null; try { persist("visits"); } catch (e) { console.log("visit save failed:", e.message); } }, 5000); if (soonTimer.unref) soonTimer.unref(); };
  persist.flush = () => { if (soonTimer) { clearTimeout(soonTimer); soonTimer = null; } persist("visits"); };

  // ---------- backups ----------
  // VACUUM INTO writes a consistent, self-contained copy even while the app is running (a plain file copy of a WAL database is not safe).
  function backup(dir, keep = 14, tag = "") {
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(), z = n => String(n).padStart(2, "0");
    const name = "lolphabet-" + d.getUTCFullYear() + z(d.getUTCMonth() + 1) + z(d.getUTCDate()) + "-" + z(d.getUTCHours()) + z(d.getUTCMinutes()) + z(d.getUTCSeconds()) + (tag ? "-" + tag : "") + ".db";
    const out = path.join(dir, name);
    sql.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'");
    const files = fs.readdirSync(dir).filter(f => /^lolphabet-\d{8}-\d{6}.*\.db$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} }
    return out;
  }

  function close() { try { persist.flush(); } catch (e) {} try { sql.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) {} try { sql.close(); } catch (e) {} }

  // Used by migrate.js: fill an empty database from the old data.json structure.
  function importLegacy(legacy) {
    for (const k of Object.keys(legacy)) if (!LEGACY_SECTIONS.includes(k)) throw new StoreError("Unknown section in the old file: " + k, "UNKNOWN_SECTION");
    for (const k of ["users", ...KEYED.map(x => x[0])]) db[k] = isObj(legacy[k]) ? legacy[k] : {};
    for (const k of KV_KEYS) if (legacy[k] !== undefined) db[k] = legacy[k];
    normalise(db);
    persist();
    setMeta("imported_from", "data.json"); setMeta("imported_at", new Date().toISOString());
  }

  return { db, persist, backup, close, file, sql, importLegacy, getMeta, setMeta, isEmpty: () => !Object.keys(db.users).length && !snap.users.size };
}

module.exports = { open, isLegacyKey, LEGACY_MODE, LEGACY_SECTIONS, StoreError, normalise, freshVisits, SCHEMA_VERSION };
