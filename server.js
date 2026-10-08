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
// Pictures are stored as files, never inside data.json: every chat poll reads
// message records, and a picture there would ride along with each full read.
const IMAGE_DIR = process.env.IMAGE_DIR || path.join(__dirname, "images");
const MAX_IMAGE = 8e6;  // bytes; photos arrive as ~1600px JPEGs, GIFs as they are
// Chat messages, forum posts and their pictures are deleted this long after
// they are sent.
const MESSAGE_TTL = 30 * 86400000;
// An uploaded picture that no message claims within this time is deleted.
const UPLOAD_TTL = 3600000;
try { fs.mkdirSync(IMAGE_DIR, { recursive: true }); } catch {}

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

// A raw request body as a Buffer, or null once it passes `max` bytes.
const readRaw = (req, max) => new Promise((r) => {
  const chunks = []; let n = 0; let done = false;
  const finish = (v) => { if (!done) { done = true; r(v); } };
  req.on("data", (c) => { if (done) return; n += c.length; if (n > max) { finish(null); req.resume(); } else chunks.push(c); });
  req.on("end", () => finish(Buffer.concat(chunks)));
  req.on("error", () => finish(null));
});
const sendJSON = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(obj)); };
const readBody = (req, max = MAX_BODY) => new Promise((r) => {
  let d = ""; let done = false;
  const finish = (v) => { if (!done) { done = true; r(v); } };
  req.on("data", (c) => { d += c; if (d.length > max) finish({}); });
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

// ===== AUTH =====
// Every mutation must present the account key *and* its live session id. The
// session id rotates on each login (which kicks other devices), so merely
// knowing a key is not enough to write. Content endpoints derive the author
// from the authenticated session — nothing the client sends can set it.
const sessionOk = (key, sessionId) => {
  const a = store[acctKey(key)];
  return !!a && typeof sessionId === "string" && sessionId.length > 0 && a.sessionId === sessionId;
};
const isAdminOf = (g, key) => !!g && (g.ownerKey === key || (g.admins || []).includes(key));
const memberName = (g, key) => (g && g.members[key] && g.members[key].username) || null;

// The reaction set the client offers; the server accepts exactly these, so the
// store can never accumulate arbitrary keys. Keep in sync with `REACTIONS` in
// src/app.src.jsx (the first five are the quick bar).
const REACTIONS = ["👍", "👎", "❤️", "🔥", "💯", "😂", "😬", "🤡", "🤨", "🤔", "👀", "🫡", "🫠", "😍", "🤯", "😡", "🥴", "🤝", "💪"];

// ===== PICTURES =====
// A picture arrives as a data URL. Only real JPEG, PNG, WebP and GIF bytes are
// kept (checked by their magic numbers, never by the claimed type), so an
// upload can never be served back as HTML or SVG. The random id is the file
// name and the capability to read it, like a group id.
const IMAGE_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const sniffImage = (b) => {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (b.length > 6 && b.toString("ascii", 0, 4) === "GIF8") return "gif";
  return null;
};
const imageFile = (img) => path.join(IMAGE_DIR, `${img.id}.${img.ext}`);
const validImage = (img) => !!img && /^[0-9a-f]{24}$/.test(img.id || "") && !!IMAGE_TYPES[img.ext];
// Save raw picture bytes; returns the `image` record, or an error code.
const saveImage = (buf, w, h) => {
  if (!buf || !buf.length || buf.length > MAX_IMAGE) return { error: "image-too-large" };
  const ext = sniffImage(buf);
  if (!ext) return { error: "bad-image" };
  const img = { id: crypto.randomBytes(12).toString("hex"), ext,
    w: Math.max(1, Math.min(10000, Math.round(Number(w) || 0))) || 1, h: Math.max(1, Math.min(10000, Math.round(Number(h) || 0))) || 1 };
  try { fs.writeFileSync(imageFile(img), buf); } catch { return { error: "save-failed" }; }
  return { image: img };
};
// Pictures are uploaded as soon as they are picked, before the message is
// sent, so pressing send only has to attach one. Until a message claims it, an
// upload belongs to its uploader and community; unclaimed ones expire.
const pendingImages = new Map(); // id -> { key, gid, image, at }
const dropImage = (m) => { if (m && validImage(m.image)) fs.unlink(imageFile(m.image), () => {}); };
// Remove a chat message with everything that hangs off it: its picture file
// and any pin. Callers persist.
const dropMessage = (k) => {
  const m = store[k]; if (!m) return;
  dropImage(m);
  delete store[k];
  const gid = k.split(":")[1];
  const g = store[groupKey(gid)];
  if (g && Array.isArray(g.pins)) g.pins = g.pins.filter((pin) => pin.key !== k);
};

// ===== 30-DAY EXPIRY =====
// Every chat message (system notices included) and every forum post (with its
// replies) is deleted 30 days after it was sent. A sweep runs at start-up and
// then hourly, so nothing outlives its 30 days by more than an hour. The same
// sweep deletes uploads no message claimed, and any picture file that no
// message refers to (left behind by a crash or a restart).
const sweepExpired = () => atomic(() => {
  const cutoff = now() - MESSAGE_TTL;
  let n = 0;
  for (const k of Object.keys(store)) {
    const m = store[k];
    if (!m || typeof m.ts !== "number" || m.ts >= cutoff) continue;
    if (k.startsWith("msg:")) { dropMessage(k); n++; }
    else if (k.startsWith("post:")) { dropImage(m); delete store[k]; n++; }
  }
  if (n) { persist(); console.log(`[commons] deleted ${n} message(s) and post(s) older than 30 days`); }
  const stale = now() - UPLOAD_TTL;
  for (const [id, u] of pendingImages) if (u.at < stale) pendingImages.delete(id);
  const used = new Set([...pendingImages.keys()]);
  for (const v of Object.values(store)) if (v && v.image && v.image.id) used.add(v.image.id);
  let files = [];
  try { files = fs.readdirSync(IMAGE_DIR); } catch {}
  for (const f of files) {
    const id = f.split(".")[0];
    if (used.has(id)) continue;
    try { if (fs.statSync(path.join(IMAGE_DIR, f)).mtimeMs < stale) fs.unlinkSync(path.join(IMAGE_DIR, f)); } catch {}
  }
});
sweepExpired();
setInterval(sweepExpired, 3600000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Commons-Key, X-Commons-Session, X-Commons-Group" });
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
    const body = await readBody(req); const key = normKey(body.key); const sessionId = body.sessionId;
    const name = String(body.name || "").trim().slice(0, 40);
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "invalid-key" });
      if (!name) return sendJSON(res, 200, { ok: false, error: "invalid-name" });
      const id = newGroupId();
      const g = { id, name, createdAt: now(), ownerKey: key, admins: [key],
        members: { [key]: { username: null, joinedAt: now(), lastNameChange: 0 } },
        usernames: {}, banned: [], invite: newInvite(), inviteOnce: null, pins: [] };
      store[groupKey(id)] = g; persist();
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  if (p === "/api/group/join" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const sessionId = body.sessionId; const code = String(body.code || "").trim();
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "invalid-key" });
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
    const body = await readBody(req); const key = normKey(body.key); const sessionId = body.sessionId; const gid = body.gid;
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (!g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      g.inviteOnce = newInvite(); persist();
      sendJSON(res, 200, { ok: true, code: g.inviteOnce, group: g });
    });
  }

  if (p === "/api/group/claimname" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const sessionId = body.sessionId; const gid = body.gid; const username = body.username;
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
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
      if (!isFirst) {
        mem.lastNameChange = now();
        // The rename notice is written here rather than by the client, so it
        // can't be forged, altered, or skipped.
        const nid = newId(), nts = now();
        store[`msg:${gid}:general:${nts}:${nid}`] = { id: nid, ts: nts, system: true, text: `${oldName} changed their name to ${clean}` };
      }
      persist();
      sendJSON(res, 200, { ok: true, group: g, changedFrom: isFirst ? null : oldName });
    });
  }

  // Admin removes a member. Non-permanent: they may rejoin.
  if (p === "/api/group/remove" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const sessionId = body.sessionId; const gid = body.gid; const targetKey = normKey(body.targetKey);
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (!isAdminOf(g, key)) return sendJSON(res, 200, { ok: false, error: "not-admin" });
      if (targetKey === g.ownerKey) return sendJSON(res, 200, { ok: false, error: "cant-remove-owner" });
      delete g.members[targetKey];
      g.admins = (g.admins || []).filter((k) => k !== targetKey);
      persist();
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  // Admin/owner grants or revokes admin. Only the owner can appoint admins.
  if (p === "/api/group/toggleadmin" && req.method === "POST") {
    const body = await readBody(req); const key = normKey(body.key); const sessionId = body.sessionId; const gid = body.gid; const targetKey = normKey(body.targetKey);
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
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
    const body = await readBody(req); const ownerKey = normKey(body.key); const sessionId = body.sessionId; const gid = body.gid; const targetKey = normKey(body.targetKey);
    return atomic(() => {
      if (!sessionOk(ownerKey, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
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
    const body = await readBody(req); const ownerKey = normKey(body.key); const sessionId = body.sessionId; const gid = body.gid;
    return atomic(() => {
      if (!sessionOk(ownerKey, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (g.ownerKey !== ownerKey) return sendJSON(res, 200, { ok: false, error: "not-owner" });
      // remove the group doc + all its messages and forum posts
      for (const k of Object.keys(store)) {
        if (k === groupKey(gid) || k.startsWith(`msg:${gid}:`) || k.startsWith(`post:${gid}:`)) { dropImage(store[k]); delete store[k]; }
      }
      persist();
      sendJSON(res, 200, { ok: true });
    });
  }

  // ===== CONTENT (authenticated writes) =====
  // Messages, posts and replies are only ever written here. The author is taken
  // from the authenticated session, so neither the text nor the identity of a
  // post can be forged — there is no raw key-write path any more.
  // A message is text, a picture, or a picture with a caption. The picture
  // was uploaded first (/api/image/upload); `imageId` claims it.
  if (p === "/api/message/send" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId;
    const gid = String(body.gid || "");
    const text = String(body.text || "").trim().slice(0, 4000);
    const anon = !!body.anon;
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!text && !body.imageId) return sendJSON(res, 200, { ok: false, error: "empty" });
      let image = null;
      if (body.imageId) {
        const up = pendingImages.get(String(body.imageId));
        if (!up || up.key !== key || up.gid !== gid) return sendJSON(res, 200, { ok: false, error: "image-expired" });
        pendingImages.delete(String(body.imageId));
        image = up.image;
      }
      const id = newId(), ts = now();
      const msg = { id, ts, text, anon, author: key, authorName: memberName(g, key), gid };
      if (image) msg.image = image;
      // A reply may only point at a message that really exists in this group.
      if (body.replyTo && typeof body.replyTo === "object") {
        const pk = String(body.replyTo.key || "");
        const par = pk.startsWith(`msg:${gid}:general:`) ? store[pk] : null;
        if (par && !par.system) msg.replyTo = { key: pk, id: par.id, ts: par.ts, author: par.author, anon: !!par.anon };
      }
      const k = `msg:${gid}:general:${ts}:${id}`;
      store[k] = msg; persist();
      sendJSON(res, 200, { ok: true, key: k, message: msg });
    });
  }

  if (p === "/api/message/delete" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId;
    const gid = String(body.gid || ""); const msgKey = String(body.msgKey || "");
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!msgKey.startsWith(`msg:${gid}:general:`) || !store[msgKey]) return sendJSON(res, 200, { ok: false, error: "not-found" });
      const m = store[msgKey];
      if (m.author !== key && !isAdminOf(g, key)) return sendJSON(res, 200, { ok: false, error: "not-allowed" });
      // A pin (and a picture file) does not outlive its message.
      dropMessage(msgKey);
      persist();
      sendJSON(res, 200, { ok: true });
    });
  }

  // Reacting sets the caller's single emoji on a message (a new one replaces
  // the old; the same one again removes it). Like every other write
  // the author comes from the session, and `updatedAt` is bumped so delta
  // polls (mget?since) hand the edited message to everyone else quickly.
  if (p === "/api/message/react" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId;
    const gid = String(body.gid || ""); const msgKey = String(body.msgKey || ""); const emoji = String(body.emoji || "");
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!msgKey.startsWith(`msg:${gid}:general:`) || !store[msgKey]) return sendJSON(res, 200, { ok: false, error: "not-found" });
      const m = store[msgKey];
      if (m.system || !REACTIONS.includes(emoji)) return sendJSON(res, 200, { ok: false, error: "not-found" });
      m.reactions = (m.reactions && typeof m.reactions === "object") ? m.reactions : {};
      const had = Array.isArray(m.reactions[emoji]) && m.reactions[emoji].includes(key);
      // One reaction per member: clear the caller from every emoji, then add
      // the new one unless they tapped the emoji they already had (a removal).
      for (const [e, who] of Object.entries(m.reactions)) {
        const rest = Array.isArray(who) ? who.filter((k) => k !== key) : [];
        if (rest.length) m.reactions[e] = rest; else delete m.reactions[e];
      }
      if (!had) m.reactions[emoji] = [...(m.reactions[emoji] || []), key];
      if (!Object.keys(m.reactions).length) delete m.reactions;
      m.updatedAt = now();
      persist();
      sendJSON(res, 200, { ok: true, key: msgKey, message: m });
    });
  }

  // Only the author may edit a message (admins can delete, not rewrite). The
  // edit keeps the message's place and identity, stamps `editedAt` so every
  // client can mark it "edited", and bumps `updatedAt` for the delta polls.
  if (p === "/api/message/edit" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId;
    const gid = String(body.gid || ""); const msgKey = String(body.msgKey || "");
    const text = String(body.text || "").trim().slice(0, 4000);
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!msgKey.startsWith(`msg:${gid}:general:`) || !store[msgKey] || store[msgKey].system) return sendJSON(res, 200, { ok: false, error: "not-found" });
      const m = store[msgKey];
      if (m.author !== key) return sendJSON(res, 200, { ok: false, error: "forbidden" });
      if (!text && !m.image) return sendJSON(res, 200, { ok: false, error: "empty" });
      if (text !== m.text) { m.text = text; m.editedAt = now(); m.updatedAt = m.editedAt; persist(); }
      sendJSON(res, 200, { ok: true, key: msgKey, message: m });
    });
  }

  if (p === "/api/post/create" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId; const gid = String(body.gid || "");
    const title = String(body.title || "").trim().slice(0, 80);
    const text = String(body.text || "").trim().slice(0, 4000);
    const anon = !!body.anon;
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!text) return sendJSON(res, 200, { ok: false, error: "empty" });
      const id = newId(), ts = now();
      const post = { id, ts, title, text, anon, author: key, authorName: memberName(g, key), gid, replies: [] };
      const k = `post:${gid}:${ts}:${id}`;
      store[k] = post; persist();
      sendJSON(res, 200, { ok: true, key: k, post });
    });
  }

  if (p === "/api/post/delete" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId; const gid = String(body.gid || ""); const postKey = String(body.postKey || "");
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!postKey.startsWith(`post:${gid}:`) || !store[postKey]) return sendJSON(res, 200, { ok: false, error: "not-found" });
      const po = store[postKey];
      if (po.author !== key && !isAdminOf(g, key)) return sendJSON(res, 200, { ok: false, error: "not-allowed" });
      delete store[postKey]; persist();
      sendJSON(res, 200, { ok: true });
    });
  }

  if (p === "/api/post/reply" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId; const gid = String(body.gid || ""); const postKey = String(body.postKey || "");
    const text = String(body.text || "").trim().slice(0, 4000);
    const anon = !!body.anon;
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!postKey.startsWith(`post:${gid}:`) || !store[postKey]) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (!text) return sendJSON(res, 200, { ok: false, error: "empty" });
      const po = store[postKey];
      const reply = { id: newId(), ts: now(), text, anon, author: key, authorName: memberName(g, key), gid };
      po.replies = [...(po.replies || []), reply];
      persist();
      sendJSON(res, 200, { ok: true, post: po });
    });
  }

  if (p === "/api/post/deleteReply" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId; const gid = String(body.gid || "");
    const postKey = String(body.postKey || ""); const replyId = String(body.replyId || "");
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!postKey.startsWith(`post:${gid}:`) || !store[postKey]) return sendJSON(res, 200, { ok: false, error: "not-found" });
      const po = store[postKey];
      const reply = (po.replies || []).find((r) => r.id === replyId);
      if (!reply) return sendJSON(res, 200, { ok: false, error: "not-found" });
      if (reply.author !== key && !isAdminOf(g, key)) return sendJSON(res, 200, { ok: false, error: "not-allowed" });
      po.replies = (po.replies || []).filter((r) => r.id !== replyId);
      persist();
      sendJSON(res, 200, { ok: true, post: po });
    });
  }

  // Search runs over the group's entire history on the server, so it never
  // depends on what the client happens to have loaded. It needs a session and
  // membership, since it reads the whole room's text.
  if (p === "/api/message/search" && req.method === "POST") {
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId; const gid = String(body.gid || "");
    const q = String(body.q || "").trim();
    if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
    const g = store[groupKey(gid)];
    if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
    if (!q) return sendJSON(res, 200, { ok: true, results: [], total: 0 });
    const needle = q.toLowerCase();
    const prefix = `msg:${gid}:general:`;
    const results = [];
    for (const k of Object.keys(store)) {
      if (!k.startsWith(prefix)) continue;
      const m = store[k];
      if (m.system || !String(m.text || "").toLowerCase().includes(needle)) continue;
      results.push({ key: k, id: m.id, ts: m.ts, author: m.author, anon: !!m.anon, authorName: m.authorName, text: m.text });
    }
    results.sort((a, b) => b.ts - a.ts);
    return sendJSON(res, 200, { ok: true, results: results.slice(0, 200), total: results.length });
  }

  // ===== PINS (admins only) =====
  if ((p === "/api/group/pin" || p === "/api/group/unpin") && req.method === "POST") {
    const pinning = p === "/api/group/pin";
    const body = await readBody(req);
    const key = normKey(body.key); const sessionId = body.sessionId; const gid = String(body.gid || ""); const msgKey = String(body.msgKey || "");
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!isAdminOf(g, key)) return sendJSON(res, 200, { ok: false, error: "not-admin" });
      g.pins = Array.isArray(g.pins) ? g.pins : [];
      if (pinning) {
        if (!msgKey.startsWith(`msg:${gid}:general:`) || !store[msgKey]) return sendJSON(res, 200, { ok: false, error: "not-found" });
        const m = store[msgKey];
        // Newest pin first: pins[0] is what the pinned bar shows initially.
        if (!g.pins.some((x) => x.key === msgKey)) {
          g.pins.unshift({ key: msgKey, id: m.id, ts: m.ts, author: m.author, anon: !!m.anon, pinnedBy: key, pinnedAt: now() });
          g.pins = g.pins.slice(0, 20);
        }
      } else {
        g.pins = g.pins.filter((x) => x.key !== msgKey);
      }
      persist();
      sendJSON(res, 200, { ok: true, group: g });
    });
  }

  // ===== READS (open — a group id or invite is the capability) =====
  if (p === "/api/get") {
    const key = url.searchParams.get("key");
    if (isAccountKey(key)) return sendJSON(res, 403, { error: "forbidden" });
    return sendJSON(res, 200, key in store ? { key, value: store[key] } : null);
  }
  if (p === "/api/mget") {
    // Batch read: one request for a whole prefix (chat polls used to issue
    // 1 + N requests per tick). `since` makes it a delta read: values whose
    // numeric `ts` is not newer are skipped, so polling a quiet room transfers
    // (and serializes) almost nothing. Values without a `ts` are never filtered.
    const prefix = url.searchParams.get("prefix") || "";
    const since = Number(url.searchParams.get("since")) || 0;
    const items = [];
    for (const k of Object.keys(store)) {
      if (!k.startsWith(prefix) || isAccountKey(k)) continue;
      const v = store[k];
      if (since && v) {
        // Newest thing we know about the value: its message time, or a later
        // edit (reactions bump `updatedAt`), so edited messages come through a
        // delta read too. Values without either stamp are never filtered.
        const t = Math.max(typeof v.ts === "number" ? v.ts : 0, typeof v.updatedAt === "number" ? v.updatedAt : 0);
        if (t > 0 && t <= since) continue;
      }
      items.push([k, v]);
    }
    return sendJSON(res, 200, { prefix, items });
  }
  if (p === "/api/list") {
    const prefix = url.searchParams.get("prefix") || "";
    return sendJSON(res, 200, { keys: Object.keys(store).filter((k) => k.startsWith(prefix) && !isAccountKey(k)), prefix });
  }

  // Upload one picture as raw bytes. The credentials ride in headers (not the
  // URL, which proxies log). Only a member of the community may upload.
  if (p === "/api/image/upload" && req.method === "POST") {
    const key = normKey(req.headers["x-commons-key"]); const sessionId = String(req.headers["x-commons-session"] || "");
    const gid = String(req.headers["x-commons-group"] || "");
    const buf = await readRaw(req, MAX_IMAGE);
    return atomic(() => {
      if (!sessionOk(key, sessionId)) return sendJSON(res, 200, { ok: false, error: "auth" });
      const g = store[groupKey(gid)];
      if (!g || !g.members[key]) return sendJSON(res, 200, { ok: false, error: "not-member" });
      if (!buf) return sendJSON(res, 200, { ok: false, error: "image-too-large" });
      const saved = saveImage(buf, url.searchParams.get("w"), url.searchParams.get("h"));
      if (saved.error) return sendJSON(res, 200, { ok: false, error: saved.error });
      pendingImages.set(saved.image.id, { key, gid, image: saved.image, at: now() });
      sendJSON(res, 200, { ok: true, imageId: saved.image.id, image: saved.image });
    });
  }

  // Pictures: /api/image/<24-hex id>.<ext>. The name is fixed by the server,
  // so it can never point outside IMAGE_DIR.
  const im = /^\/api\/image\/([0-9a-f]{24})\.(jpg|png|webp|gif)$/.exec(p);
  if (im && req.method === "GET") {
    return fs.readFile(path.join(IMAGE_DIR, `${im[1]}.${im[2]}`), (err, buf) => {
      if (err) return sendJSON(res, 404, { error: "not-found" });
      res.writeHead(200, { "Content-Type": IMAGE_TYPES[im[2]], "Cache-Control": "private, max-age=2592000, immutable", "X-Content-Type-Options": "nosniff" });
      res.end(buf);
    });
  }

  // Any other /api/ path is a JSON 404 — it must never fall through to the
  // static handler, which would answer with index.html.
  if (p.startsWith("/api/")) return sendJSON(res, 404, { error: "not-found" });

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
