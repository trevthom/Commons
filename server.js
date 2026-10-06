// Commons — single-file server. Serves the PWA + an authoritative API for
// accounts, sessions, per-community usernames, and bans. No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, "public");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

let store = {};
try { store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { store = {}; }
let saveTimer = null;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(store), () => {}), 100);
};

// serial mutex so claims/bans/logins can't race
let chain = Promise.resolve();
const atomic = (fn) => (chain = chain.then(fn, fn));

const newKey = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.randomBytes(16); let s = "";
  for (let i = 0; i < 16; i++) s += a[b[i] % a.length];
  return s; // 16 chars, no hyphens, e.g. K7QF2M9PRT4XHB2N
};
// normalize any user-entered key: uppercase + strip everything but A-Z0-9
const normKey = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const newId = () => crypto.randomBytes(6).toString("hex");
const now = () => Date.now();
const DAY = 86400000;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

const sendJSON = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { r(JSON.parse(d || "{}")); } catch { r({}); } }); });

const acctKey = (k) => "account:" + k;
const groupKey = (id) => "group:" + id;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // ===== ACCOUNTS / SESSIONS =====
  if (p === "/api/account/create" && req.method === "POST") {
    return atomic(() => {
      const key = newKey(); const sessionId = newId();
      store[acctKey(key)] = { key, createdAt: now(), sessionId }; persist();
      sendJSON(res, 200, { key, sessionId });
    });
  }
  if (p === "/api/account/login" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key);
    return atomic(() => {
      const a = store[acctKey(key)];
      if (!a) return sendJSON(res, 200, { ok: false, error: "invalid-key" });
      a.sessionId = newId(); persist();              // rotate => kicks other device
      sendJSON(res, 200, { ok: true, sessionId: a.sessionId });
    });
  }
  if (p === "/api/account/session") {
    const a = store[acctKey(normKey(url.searchParams.get("key")))];
    return sendJSON(res, 200, { valid: !!a && a.sessionId === url.searchParams.get("sessionId") });
  }

  // ===== GROUP MEMBERSHIP / NAMES / BANS =====
  if (p === "/api/group/join" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const code = body.code;
    return atomic(() => {
      if (!store[acctKey(key)]) return sendJSON(res, 200, { ok: false, error: "invalid-key" });
      let g = null;
      for (const k of Object.keys(store)) if (k.startsWith("group:")) { const gg = store[k]; if (gg.id === code || gg.invite === code) { g = gg; break; } }
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if ((g.banned || []).includes(key)) return sendJSON(res, 200, { ok: false, error: "banned" });
      if (!g.members[key]) { g.members[key] = { username: null, joinedAt: now(), lastNameChange: 0 }; persist(); }
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  if (p === "/api/group/claimname" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const gid = body.gid; const username = body.username;
    return atomic(() => {
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      const clean = String(username || "").trim();
      if (!clean || clean.length > 24) return sendJSON(res, 200, { ok: false, error: "invalid" });
      const lc = clean.toLowerCase();
      g.usernames = g.usernames || {};
      const holder = g.usernames[lc];
      if (holder && holder !== key) return sendJSON(res, 200, { ok: false, error: "taken" });
      const mem = g.members[key];
      const isFirst = !mem.username;
      if (!isFirst) {
        if (lc === mem.username.toLowerCase()) return sendJSON(res, 200, { ok: true, group: g, unchanged: true });
        const since = now() - (mem.lastNameChange || 0);
        if (since < 60 * DAY) return sendJSON(res, 200, { ok: false, error: "cooldown", daysLeft: Math.ceil((60 * DAY - since) / DAY) });
      }
      const oldName = mem.username;
      g.usernames[lc] = key;            // old reservation intentionally kept
      mem.username = clean;
      if (!isFirst) mem.lastNameChange = now();
      persist();
      sendJSON(res, 200, { ok: true, group: g, changedFrom: isFirst ? null : oldName });
    });
  }

  if (p === "/api/group/ban" && req.method === "POST") {
    const body = await readBody(req); const ownerKey = normKey(body.ownerKey); const gid = body.gid; const targetKey = normKey(body.targetKey);
    return atomic(() => {
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (g.ownerKey !== ownerKey) return sendJSON(res, 200, { ok: false, error: "not-owner" });
      if (targetKey === g.ownerKey) return sendJSON(res, 200, { ok: false, error: "cant-ban-owner" });
      g.banned = g.banned || [];
      if (!g.banned.includes(targetKey)) g.banned.push(targetKey);
      delete g.members[targetKey];
      g.admins = (g.admins || []).filter((k) => k !== targetKey);
      persist();
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  if (p === "/api/group/delete" && req.method === "POST") {
    const body = await readBody(req); const ownerKey = normKey(body.ownerKey); const gid = body.gid;
    return atomic(() => {
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (g.ownerKey !== ownerKey) return sendJSON(res, 200, { ok: false, error: "not-owner" });
      // remove the group doc + all its messages and neighborhood posts
      const dead = [groupKey(gid), `msg:${gid}:`, `post:${gid}:`];
      for (const k of Object.keys(store)) {
        if (k === groupKey(gid) || k.startsWith(`msg:${gid}:`) || k.startsWith(`post:${gid}:`)) delete store[k];
      }
      persist();
      sendJSON(res, 200, { ok: true });
    });
  }

  // ===== GENERIC KV =====
  if (p === "/api/get") { const key = url.searchParams.get("key"); return sendJSON(res, 200, key in store ? { key, value: store[key] } : null); }
  if (p === "/api/set" && req.method === "POST") { const { key, value } = await readBody(req); if (!key) return sendJSON(res, 400, { error: "key required" }); store[key] = value; persist(); return sendJSON(res, 200, { key, value }); }
  if (p === "/api/delete" && req.method === "POST") { const { key } = await readBody(req); const existed = key in store; delete store[key]; persist(); return sendJSON(res, 200, { key, deleted: existed }); }
  if (p === "/api/list") { const prefix = url.searchParams.get("prefix") || ""; return sendJSON(res, 200, { keys: Object.keys(store).filter((k) => k.startsWith(prefix)), prefix }); }

  // ===== STATIC =====
  let file = p === "/" ? "/index.html" : decodeURIComponent(p);
  let full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(full, (err, buf) => {
    if (err) return fs.readFile(path.join(PUBLIC, "index.html"), (e2, html) => { if (e2) { res.writeHead(404); return res.end("not found"); } res.writeHead(200, { "Content-Type": MIME[".html"] }); res.end(html); });
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" }); res.end(buf);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Commons running:`);
  console.log(`    On this device:  http://localhost:${PORT}`);
  const nets = require("os").networkInterfaces();
  for (const name of Object.keys(nets)) for (const ni of nets[name]) if (ni.family === "IPv4" && !ni.internal)
    console.log(`    On your phone:    http://${ni.address}:${PORT}  (same Wi-Fi)`);
  console.log("");
});
