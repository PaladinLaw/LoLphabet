// Riot static data + image cache, served from our own origin.
//
// Why: the browser used to build the rune page and champion icons from several sequential requests to Riot's Data Dragon
// (versions.json -> champion.json / runesReforged.json -> then ~30 icons, each from a cold third-party connection).
// That chain is what made rune icons "slow load". Now:
//   GET /api/riot                    version + champion ids/classes + rune trees in ONE small cached response (refreshed daily here)
//   GET /img/champ/<name>.png        champion icon by NAME, so icons never wait for any data to arrive first
//   GET /img/ddragon/<path>          whitelisted Data Dragon images (items, spells, runes), fetched once and kept on disk
//   GET /img/cdragon/<path>          whitelisted Community Dragon images (stat shards)
// If Riot can't be reached, images redirect to the original URL, so nothing is worse than before.
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const DD = process.env.RIOT_DD_URL || "https://ddragon.leagueoflegends.com";
const CD = process.env.RIOT_CD_URL || "https://raw.communitydragon.org";
const OK_DD = /^\/cdn\/(?:\d+\.\d+\.\d+\/img\/(?:champion|item|spell|passive|profileicon)\/[\w.-]+\.png|img\/perk-images\/[\w/.-]+\.(?:png|jpg))$/;
const OK_CD = /^\/(?:latest|\d+\.\d+)\/(?:plugins|game)\/[\w/.-]+\.(?:png|jpg|webp)$/;
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const clean = p => p.length < 220 && !p.includes("..") && !p.includes("//");
const sha1 = s => crypto.createHash("sha1").update(s).digest("hex");

module.exports = function ({ db, persist, dir, packBuf, sendPacked }) {
  const CACHE = path.join(dir, "riot-cache");
  try { fs.mkdirSync(CACHE, { recursive: true }); } catch (e) { console.log("riot-cache dir:", e.message); }

  // ---------- 1. static data ----------
  let packed = null;
  function pack() {
    const r = db.riot;
    packed = r && r.trees ? packBuf(Buffer.from(JSON.stringify({ ver: r.ver, ids: r.ids, tags: r.tags, trees: r.trees }))) : null;
  }
  const getJson = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status + " for " + u); return r.json(); };
  async function refresh(force) {
    try {
      const vs = await getJson(DD + "/api/versions.json"), ver = Array.isArray(vs) ? vs[0] : "";
      if (!/^\d+\.\d+\.\d+$/.test(ver)) throw new Error("unexpected version " + ver);
      const cur = db.riot;
      if (!force && cur && cur.ver === ver && cur.trees && Date.now() - cur.t < 7 * 864e5) return;      // nothing new
      const [ch, ru] = await Promise.all([getJson(DD + "/cdn/" + ver + "/data/en_US/champion.json"), getJson(DD + "/cdn/" + ver + "/data/en_US/runesReforged.json")]);
      const ids = {}, tags = {};
      for (const k in ch.data) { const c = ch.data[k]; ids[c.name] = c.id; tags[c.name] = c.tags || []; }
      const trees = (Array.isArray(ru) ? ru : []).map(t => ({ id: t.id, name: t.name, icon: t.icon, slots: t.slots.map(sl => sl.runes.map(x => ({ id: x.id, name: x.name, icon: x.icon }))) }));
      if (Object.keys(ids).length < 100 || trees.length < 5) throw new Error("suspicious data (" + Object.keys(ids).length + " champions, " + trees.length + " rune trees)");
      db.riot = { ver, t: Date.now(), ids, tags, trees }; persist("riot"); pack();
      console.log("riot data refreshed: patch " + ver + ", " + Object.keys(ids).length + " champions, " + trees.length + " rune trees");
    } catch (e) { console.log("riot data refresh failed:", e.message); }
  }

  // ---------- 2. image cache ----------
  const inflight = new Map(), failed = new Map();
  async function fetchImg(base, pathname, file) {
    const r = await fetch(base + pathname, { signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (!/^image\//.test(String(r.headers.get("content-type") || ""))) throw new Error("not an image");
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 1e6) throw new Error("bad size");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + ".tmp"; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file);
    return buf;
  }
  async function serveImg(req, res, base, pathname, cc) {
    const ext = path.extname(pathname), key = sha1(base + pathname), file = path.join(CACHE, key.slice(0, 2), key + ext);
    const giveUp = () => { res.writeHead(302, { Location: base + pathname, "Cache-Control": "no-store" }); res.end(); };
    let st = null; try { st = fs.statSync(file); } catch (e) {}
    if (!st) {
      if ((failed.get(file) || 0) > Date.now()) return giveUp();                       // failed recently: don't hammer Riot
      let p = inflight.get(file);
      if (!p) {
        if (inflight.size >= 8) return giveUp();                                       // cap on parallel downloads
        p = fetchImg(base, pathname, file).finally(() => inflight.delete(file)); inflight.set(file, p);
      }
      try { await p; st = fs.statSync(file); } catch (e) { failed.set(file, Date.now() + 10 * 60e3); if (failed.size > 2000) failed.clear(); return giveUp(); }
    }
    const etag = '"' + st.size.toString(36) + "-" + Math.floor(st.mtimeMs).toString(36) + '"';
    const h = { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cc, ETag: etag, "X-Content-Type-Options": "nosniff" };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, h); return res.end(); }
    h["Content-Length"] = st.size; res.writeHead(200, h);
    if (req.method === "HEAD") return res.end();
    res.end(fs.readFileSync(file));
  }
  const IMMUTABLE = "public, max-age=31536000, immutable", WEEK = "public, max-age=604800", DAY = "public, max-age=86400, stale-while-revalidate=604800";

  async function route(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    if (url === "/api/riot") {
      if (!packed) { res.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end('{"error":"not ready"}'); return true; }
      sendPacked(req, res, packed, { "Content-Type": "application/json", "Cache-Control": "no-cache" }); return true;
    }
    let m = url.match(/^\/img\/champ\/([^/]+)\.png$/);
    if (m) {
      let name = ""; try { name = decodeURIComponent(m[1]); } catch (e) {}
      const r = db.riot, id = name && ((r && r.ids && Object.prototype.hasOwnProperty.call(r.ids, name) && r.ids[name]) || name.replace(/[^A-Za-z]/g, ""));
      if (!name || name.length > 40 || !id || !r || !r.ver) { res.writeHead(404, { "Cache-Control": "no-store" }); res.end(); return true; }
      await serveImg(req, res, DD, "/cdn/" + r.ver + "/img/champion/" + id + ".png", DAY); return true;
    }
    m = url.match(/^\/img\/ddragon(\/cdn\/.+)$/);
    if (m && OK_DD.test(m[1]) && clean(m[1])) { await serveImg(req, res, DD, m[1], /^\/cdn\/\d/.test(m[1]) ? IMMUTABLE : WEEK); return true; }
    m = url.match(/^\/img\/cdragon(\/.+)$/);
    if (m && OK_CD.test(m[1]) && clean(m[1])) { await serveImg(req, res, CD, m[1], WEEK); return true; }
    if (url.startsWith("/img/")) { res.writeHead(404, { "Cache-Control": "no-store" }); res.end(); return true; }
    return false;
  }

  // Turn an allowed absolute image URL (as the collector records them) into our own path; anything unexpected is left as it was.
  function proxied(u) {
    try {
      const x = new URL(String(u));
      if (x.protocol !== "https:") return u;
      if (x.hostname === "ddragon.leagueoflegends.com" && OK_DD.test(x.pathname) && clean(x.pathname)) return "/img/ddragon" + x.pathname;
      if (x.hostname === "raw.communitydragon.org" && OK_CD.test(x.pathname) && clean(x.pathname)) return "/img/cdragon" + x.pathname;
    } catch (e) {}
    return u;
  }

  function prune() {            // images not re-fetched for 60 days belong to old patches
    const cut = Date.now() - 60 * 864e5; let n = 0;
    try { for (const d of fs.readdirSync(CACHE)) { const dd = path.join(CACHE, d); let fl = []; try { fl = fs.readdirSync(dd); } catch (e) { continue; } for (const f of fl) { const p = path.join(dd, f); try { if (fs.statSync(p).mtimeMs < cut) { fs.unlinkSync(p); n++; } } catch (e) {} } } } catch (e) {}
    if (n) console.log("riot-cache: removed " + n + " old image(s)");
  }
  function start() {
    pack();
    setTimeout(() => refresh(false), 3000).unref();
    setInterval(() => refresh(false), 6 * 36e5).unref();       // cheap: only the tiny versions.json is fetched unless the patch changed
    setTimeout(prune, 60e3).unref(); setInterval(prune, 864e5).unref();
  }
  return { route, proxied, refresh, start };
};
