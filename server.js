// Commons — single-file server. Serves the PWA + an authoritative API for
// accounts, sessions, per-community usernames, and bans. No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, "public");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const MAX_BODY = 1e6; // 1 MB — reject absurd payloads before they hit memory

// ===== STORE =====
// Loading never destroys data: a file we cannot parse is moved aside rather
// than silently replaced with an empty store.
let store = {};
try {
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected a JSON object");
  store = parsed;
} catch (err) {
  store = {};
  if (err.code !== "ENOENT") {
    console.error(`[commons] could not read ${DATA_FILE}: ${err.message}`);
    try {
      const aside = `${DATA_FILE}.corrupt-${Date.now()}`;
      fs.renameSync(DATA_FILE, aside);
      console.error(`[commons] moved the unreadable file to ${aside}; starting with an empty store`);
    } catch {}
  }
}

// Debounced, atomic persistence: write a temp file then rename it over the
// real one, so a crash mid-write can never truncate data.json.
let saveTimer = null;
const writeNow = () => {
  saveTimer = null;
  const tmp = DATA_FILE + ".tmp";
  fs.writeFile(tmp, JSON.stringify(store), (err) => {
    if (err) return console.error("[commons] save failed:", err.message);
    fs.rename(tmp, DATA_FILE, (e) => { if (e) console.error("[commons] save rename failed:", e.message); });
  });
};
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 100);
};
// Flush pending writes on shutdown so the last messages aren't lost.
const flush = () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.writeFileSync(DATA_FILE + ".tmp", JSON.stringify(store));
    fs.renameSync(DATA_FILE + ".tmp", DATA_FILE);
  } catch {}
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { flush(); process.exit(0); });

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
const newGroupId = () => crypto.randomBytes(5).toString("hex"); // 10 hex chars, URL-safe
const newInvite = () => {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.randomBytes(12); let s = "";
  for (let i = 0; i < 12; i++) s += a[b[i] % a.length];
  return s;
};
const now = () => Date.now();
const DAY = 86400000;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

const sendJSON = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => {
  let d = ""; let done = false;
  const finish = (v) => { if (!done) { done = true; r(v); } };
  req.on("data", (c) => { d += c; if (d.length > MAX_BODY) finish({}); });
  req.on("end", () => { try { finish(JSON.parse(d || "{}")); } catch { finish({}); } });
  req.on("error", () => finish({}));
});

const acctKey = (k) => "account:" + k;
const groupKey = (id) => "group:" + id;
// Account records hold login keys and live session ids. They must never be
// reachable through the generic KV endpoints, or /api/list would hand out
// every account (and therefore every login) on the server.
const isAccountKey = (k) => typeof k === "string" && k.startsWith("account:");
const isGroupKey = (k) => typeof k === "string" && k.startsWith("group:");
// The generic KV surface is only for content written by clients under a group:
// messages and neighborhood posts. Groups are created/edited via /api/group/*.
const isWritableKey = (k) => typeof k === "string" && (k.startsWith("msg:") || k.startsWith("post:"));

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

  // ===== GROUPS =====
  if (p === "/api/group/create" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key);
    const name = String(body.name || "").trim().slice(0, 40);
    return atomic(() => {
      if (!store[acctKey(key)]) return sendJSON(res, 200, { ok: false, error: "invalid-key" });
      if (!name) return sendJSON(res, 200, { ok: false, error: "invalid-name" });
      const id = newGroupId();
      const g = { id, name, createdAt: now(), ownerKey: key, admins: [key],
        members: { [key]: { username: null, joinedAt: now(), lastNameChange: 0 } },
        usernames: {}, banned: [], invite: newInvite(), inviteOnce: null };
      store[groupKey(id)] = g; persist();
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  if (p === "/api/group/join" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const code = String(body.code || "").trim();
    return atomic(() => {
      if (!store[acctKey(key)]) return sendJSON(res, 200, { ok: false, error: "invalid-key" });
      let g = null, onceUsed = false;
      for (const k of Object.keys(store)) {
        if (!isGroupKey(k)) continue;
        const gg = store[k];
        // gg.id (the raw group id) and gg.invite are reusable; gg.inviteOnce is
        // a single-use code that is spent the moment one person joins with it.
        if (gg.id === code || gg.invite === code) { g = gg; break; }
        if (gg.inviteOnce && gg.inviteOnce === code) { g = gg; onceUsed = true; break; }
      }
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if ((g.banned || []).includes(key)) return sendJSON(res, 200, { ok: false, error: "banned" });
      if (!g.members[key]) {
        g.members[key] = { username: null, joinedAt: now(), lastNameChange: 0 };
        if (onceUsed) g.inviteOnce = null;   // burn the one-time code
        persist();
      }
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  // Mint (or rotate) the group's one-time invite. Any member can hand one out;
  // the previous unused code is replaced the moment a new one is generated.
  if (p === "/api/group/invite" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const gid = body.gid;
    return atomic(() => {
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (!g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      g.inviteOnce = newInvite(); persist();
      sendJSON(res, 200, { ok: true, code: g.inviteOnce, group: g });
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

  // Admin removes a member. Non-permanent: they may rejoin.
  if (p === "/api/group/remove" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const gid = body.gid; const targetKey = normKey(body.targetKey);
    return atomic(() => {
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (g.ownerKey !== key && !(g.admins || []).includes(key)) return sendJSON(res, 200, { ok: false, error: "not-admin" });
      if (targetKey === g.ownerKey) return sendJSON(res, 200, { ok: false, error: "cant-remove-owner" });
      delete g.members[targetKey];
      g.admins = (g.admins || []).filter((k) => k !== targetKey);
      persist();
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  // Admin/owner grants or revokes admin. Only the owner can appoint admins.
  if (p === "/api/group/toggleadmin" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const gid = body.gid; const targetKey = normKey(body.targetKey);
    return atomic(() => {
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (g.ownerKey !== key) return sendJSON(res, 200, { ok: false, error: "not-owner" });
      if (targetKey === g.ownerKey) return sendJSON(res, 200, { ok: false, error: "cant-change-owner" });
      if (!g.members[targetKey]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      g.admins = (g.admins || []).includes(targetKey)
        ? g.admins.filter((k) => k !== targetKey)
        : [...(g.admins || []), targetKey];
      persist();
      sendJSON(res, 200, { ok: true, group: g });
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
      for (const k of Object.keys(store)) {
        if (k === groupKey(gid) || k.startsWith(`msg:${gid}:`) || k.startsWith(`post:${gid}:`)) delete store[k];
      }
      persist();
      sendJSON(res, 200, { ok: true });
    });
  }

  // ===== GENERIC KV (message + post content only) =====
  if (p === "/api/get") {
    const key = url.searchParams.get("key");
    if (isAccountKey(key)) return sendJSON(res, 403, { error: "forbidden" });
    return sendJSON(res, 200, key in store ? { key, value: store[key] } : null);
  }
  if (p === "/api/mget") {
    // Batch read: one request for a whole prefix (chat polls used to issue
    // 1 + N requests per tick).
    const prefix = url.searchParams.get("prefix") || "";
    const items = [];
    for (const k of Object.keys(store)) if (k.startsWith(prefix) && !isAccountKey(k)) items.push([k, store[k]]);
    return sendJSON(res, 200, { prefix, items });
  }
  if (p === "/api/set" && req.method === "POST") {
    const { key, value } = await readBody(req);
    if (!key) return sendJSON(res, 400, { error: "key required" });
    if (!isWritableKey(key)) return sendJSON(res, 403, { error: "forbidden" });
    store[key] = value; persist();
    return sendJSON(res, 200, { key, value });
  }
  if (p === "/api/delete" && req.method === "POST") {
    const { key } = await readBody(req);
    if (!isWritableKey(key)) return sendJSON(res, 403, { error: "forbidden" });
    const existed = key in store; delete store[key]; persist();
    return sendJSON(res, 200, { key, deleted: existed });
  }
  if (p === "/api/list") {
    const prefix = url.searchParams.get("prefix") || "";
    return sendJSON(res, 200, { keys: Object.keys(store).filter((k) => k.startsWith(prefix) && !isAccountKey(k)), prefix });
  }

  // ===== STATIC =====
  let file = p === "/" ? "/index.html" : decodeURIComponent(p);
  let full = path.join(PUBLIC, file);
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(full, (err, buf) => {
    if (err) {
      // Only fall back to the app shell for navigations — a missing .js or .png
      // must 404 rather than answer with HTML.
      const ext = path.extname(full);
      if (ext && ext !== ".html") { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
      return fs.readFile(path.join(PUBLIC, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end("not found"); }
        res.writeHead(200, { "Content-Type": MIME[".html"] }); res.end(html);
      });
    }
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
