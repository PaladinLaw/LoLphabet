#!/usr/bin/env node
// One-off migration: old data.json  ->  lolphabet.db (SQLite).
//
//   node migrate.js                          dry run: builds a throw-away database, verifies it, reports, changes nothing
//   node migrate.js --apply                  creates lolphabet.db next to data.json (data.json is never modified or deleted)
//   node migrate.js --apply --prune-legacy   same, and also drops the retired Random / Random Hard / Random Insanity lists
//
// Safety rules:
//  * The source file is only ever read.
//  * The new database is built under a temporary name, re-opened from disk, and compared with the source piece by piece.
//    It is only moved into place if every comparison passes. Any difference stops the migration with nothing written.
//  * Pruned legacy progress is not thrown away: it is saved to migration-<time>/removed-legacy-progress.json.
//
// Paths: DATA_DIR (default: the folder of DATA_FILE, else ./data). Source = <DATA_DIR>/data.json, target = <DATA_DIR>/lolphabet.db.
// Run it with the app stopped, e.g.:  docker compose run --rm lol-tracker node migrate.js --apply --prune-legacy
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const S = require("./store.js");

const args = process.argv.slice(2), flag = f => args.includes(f);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const APPLY = flag("--apply"), PRUNE = flag("--prune-legacy");
const DATA_DIR = val("--dir") || process.env.DATA_DIR || (process.env.DATA_FILE ? path.dirname(process.env.DATA_FILE) : path.join(__dirname, "data"));
const SRC = val("--source") || path.join(DATA_DIR, "data.json");
const TARGET = path.join(DATA_DIR, "lolphabet.db");

const isObj = o => o !== null && typeof o === "object" && !Array.isArray(o);
const canon = v => v === undefined ? "undefined" : JSON.stringify(v, (k, x) => isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(kk => [kk, x[kk]])) : x);
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const die = m => { console.error("\nSTOPPED: " + m + "\nNothing was changed.\n"); process.exit(1); };
const winsOf = l => isObj(l) ? Object.keys(l).filter(n => n !== "__meta" && l[n] && l[n].won === true).length : 0;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------- 1. read the source ----------
if (!fs.existsSync(SRC)) die("Source file not found: " + SRC);
const raw = fs.readFileSync(SRC);
const sha = crypto.createHash("sha256").update(raw).digest("hex");
let legacy; try { legacy = JSON.parse(raw.toString("utf8")); } catch (e) { die("The source file is not valid JSON (" + e.message + "). Not touching it."); }
if (!isObj(legacy)) die("The source file is not a JSON object.");
for (const k of Object.keys(legacy)) if (!S.LEGACY_SECTIONS.includes(k)) die("Unknown section \"" + k + "\" in the source file. Add it to the store before migrating so it is not lost.");
if (!isObj(legacy.users)) die("The source file has no users section.");
for (const [id, u] of Object.entries(legacy.users)) if (!isObj(u) || !isObj(u.progress)) die("User " + id + " has no usable progress object. Check it by hand first.");

console.log("Source : " + SRC + "  (" + raw.length + " bytes, sha256 " + sha.slice(0, 16) + "…)");
console.log("Target : " + TARGET + (APPLY ? "" : "   [dry run]"));
console.log("Mode   : " + (PRUNE ? "split + remove legacy lists" : "split only (lossless)") + "\n");
if (APPLY && fs.existsSync(TARGET)) die(TARGET + " already exists. Move it away first if you really want to redo the migration.");

// ---------- 2. what the finished database must contain ----------
const expected = clone(legacy);
const removed = {};            // userId -> { listKey: data }
if (PRUNE) for (const [id, u] of Object.entries(expected.users)) for (const k of Object.keys(u.progress)) if (S.isLegacyKey(k)) { (removed[id] = removed[id] || {})[k] = u.progress[k]; delete u.progress[k]; }
S.normalise(expected);

// ---------- 3. build, re-open, compare ----------
function build(file) {
  for (const x of ["", "-wal", "-shm"]) try { fs.unlinkSync(file + x); } catch (e) {}
  const st = S.open(file, { allowEmpty: true });
  st.importLegacy(PRUNE ? expected : legacy);
  st.close();
}
function verify(file) {
  const st = S.open(file), db = st.db, problems = [];
  const cmp = (name, a, b) => { if (canon(a) !== canon(b)) problems.push(name + " differs"); };
  const ids = new Set([...Object.keys(expected.users), ...Object.keys(db.users)]);
  for (const id of ids) {
    if (!hasOwn(db.users, id)) { problems.push("user " + id + " is missing from the new database"); continue; }
    if (!hasOwn(expected.users, id)) { problems.push("user " + id + " appeared from nowhere"); continue; }
    const a = expected.users[id], b = db.users[id];
    const { progress: pa, ...ra } = a, { progress: pb, ...rb } = b;
    cmp("user " + id + " profile", ra, rb);
    const ka = Object.keys(pa), kb = Object.keys(pb);
    if (ka.length !== kb.length) problems.push("user " + id + ": " + ka.length + " lists expected, " + kb.length + " stored");
    for (const k of ka) if (!hasOwn(pb, k)) problems.push("user " + id + ": list \"" + k + "\" is missing"); else cmp("user " + id + " list \"" + k + "\"", pa[k], pb[k]);
    for (const k of kb) if (!hasOwn(pa, k)) problems.push("user " + id + ": unexpected list \"" + k + "\"");
  }
  for (const k of ["sessions", "shares", "templates", "authTokens", "adminMeta", "roles", "visits", "mail"]) cmp(k, expected[k], db[k]);
  const info = { users: Object.keys(db.users).length, sessions: Object.keys(db.sessions).length, shares: Object.keys(db.shares).length, templates: Object.keys(db.templates).length, authTokens: Object.keys(db.authTokens).length };
  // Informational consistency checks (they describe the data as it already was; they are not migration errors).
  const notes = [];
  const orphan = (what, n) => { if (n) notes.push(n + " " + what); };
  orphan("session(s) belonging to a deleted account", Object.values(db.sessions).filter(s => !hasOwn(db.users, s.sub)).length);
  orphan("share link(s) pointing at a deleted account", Object.values(db.shares).filter(s => !hasOwn(db.users, s)).length);
  orphan("shared list(s) owned by a deleted account", Object.values(db.templates).filter(t => !hasOwn(db.users, t.sub)).length);
  orphan("account(s) whose share token is not in the shares table", Object.values(db.users).filter(u => u.share && db.shares[u.share] === undefined).length);
  const imgDir = path.join(DATA_DIR, "share-images");
  orphan("share link(s) with no preview image file", Object.keys(db.shares).filter(t => /^[\w-]+$/.test(t) && !fs.existsSync(path.join(imgDir, t + ".jpg"))).length);
  const integ = st.sql.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integ !== "ok") problems.push("SQLite integrity_check: " + integ);
  const table = Object.keys(db.users).map(id => { const u = db.users[id], o = legacy.users[id]; return { id, name: u.given || u.name || "", before: Object.keys(o.progress).length + " lists / " + Object.values(o.progress).reduce((n, l) => n + winsOf(l), 0) + " wins", after: Object.keys(u.progress).length + " lists / " + Object.values(u.progress).reduce((n, l) => n + winsOf(l), 0) + " wins" }; });
  st.close();
  return { problems, info, notes, table };
}

const tmp = APPLY ? TARGET + ".migrating" : path.join(os.tmpdir(), "lolphabet-dryrun-" + process.pid + ".db");
let res;
try { build(tmp); res = verify(tmp); }
catch (e) { for (const x of ["", "-wal", "-shm"]) try { fs.unlinkSync(tmp + x); } catch (_) {} die("Building the new database failed: " + e.message); }

console.log("Accounts:");
for (const r of res.table) console.log("  " + (r.id.slice(0, 8) + "…").padEnd(11) + r.name.slice(0, 22).padEnd(24) + r.before.padEnd(24) + "->  " + r.after);
console.log("\nRows   : " + Object.entries(res.info).map(([k, v]) => k + " " + v).join(", "));
if (PRUNE) {
  const n = Object.values(removed).reduce((a, o) => a + Object.keys(o).length, 0);
  console.log("\nLegacy lists " + (APPLY ? "removed" : "that would be removed") + " (" + n + "):");
  for (const [id, o] of Object.entries(removed)) for (const [k, l] of Object.entries(o)) console.log("  " + (legacy.users[id].given || legacy.users[id].name || id).toString().slice(0, 20).padEnd(22) + k.padEnd(26) + winsOf(l) + " wins, " + Object.keys(l).filter(c => c !== "__meta").length + " champions");
  if (!n) console.log("  none found");
}
if (res.notes.length) console.log("\nNotes (already true of the old data, not caused by migrating):\n  - " + res.notes.join("\n  - "));

const cleanup = () => { for (const x of ["", "-wal", "-shm"]) try { fs.unlinkSync(tmp + x); } catch (e) {} };
if (res.problems.length) {
  console.log("\nVERIFICATION FAILED:\n  - " + res.problems.slice(0, 20).join("\n  - ") + (res.problems.length > 20 ? "\n  … and " + (res.problems.length - 20) + " more" : ""));
  cleanup(); die("The new database does not match the source, so it was discarded.");
}
console.log("\nVerification passed: every account, list, session, share and setting in the new database matches the source" + (PRUNE ? " (minus the legacy lists above)." : "."));

if (!APPLY) { cleanup(); console.log("\nDry run only. Re-run with --apply to create " + path.basename(TARGET) + ".\n"); process.exit(0); }

// ---------- 4. move into place ----------
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const rep = path.join(DATA_DIR, "migration-" + stamp);
fs.mkdirSync(rep, { recursive: true });
fs.writeFileSync(path.join(rep, "source-sha256.txt"), sha + "  " + path.basename(SRC) + "\n");
fs.copyFileSync(SRC, path.join(rep, "data.json.original"));                                   // second, untouched copy of the source
if (PRUNE) fs.writeFileSync(path.join(rep, "removed-legacy-progress.json"), JSON.stringify(removed, null, 1), { mode: 0o600 });
fs.writeFileSync(path.join(rep, "report.txt"), res.table.map(r => r.id + "  " + r.name + "  " + r.before + " -> " + r.after).join("\n") + "\n" + JSON.stringify(res.info) + "\n");
for (const x of ["-wal", "-shm"]) try { fs.unlinkSync(tmp + x); } catch (e) {}
fs.renameSync(tmp, TARGET);
console.log("\nDone. Created " + TARGET + "\nSaved a report, an extra copy of the source" + (PRUNE ? " and the removed legacy lists" : "") + " in " + rep + "\n");
console.log("Next: start the app on the new image. Keep data.json where it is for a couple of weeks as your rollback; the app no longer reads it.\n");
