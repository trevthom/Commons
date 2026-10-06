const { useState, useEffect, useRef, useCallback } = React;
const {
  Users, MapPin, Shield, Send, Eye, EyeOff, Link2, QrCode, Search,
  X, Trash2, UserMinus, Crown, LogIn, Plus, Copy, Check, MessageSquare, ChevronLeft, Ban, Key, LogOut,
  MoreVertical, CornerUpLeft, Bell, BellOff, Smile, Pin, PinOff, ChevronDown
} = lucide;

// ---------- API ----------
// Every call resolves to a value or null — a dropped connection or a non-JSON
// error page must never leave a button stuck in its "busy" state.
const api = {
  async post(path, body) { try { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); return await r.json(); } catch { return null; } },
  async get(path) { try { const r = await fetch(path); return await r.json(); } catch { return null; } },
};
const sget = async (k) => { const j = await api.get("/api/get?key=" + encodeURIComponent(k)); return j ? j.value : null; };
const slist = async (prefix) => { const j = await api.get("/api/list?prefix=" + encodeURIComponent(prefix)); return j ? j.keys : []; };
// ---------- authenticated content calls ----------
// The server derives the author from { key, sessionId } and ignores anything
// else we send, so a client can neither forge nor delete somebody else's post.
const auth = (s, extra) => ({ key: s.key, sessionId: s.sessionId, ...extra });
const messageSend = (s, gid, text, anon, replyTo) => api.post("/api/message/send", auth(s, { gid, text, anon, replyTo }));
const messageDelete = (s, gid, msgKey) => api.post("/api/message/delete", auth(s, { gid, msgKey }));
const messageSearch = (s, gid, q) => api.post("/api/message/search", auth(s, { gid, q }));
const postCreate = (s, gid, title, text, anon) => api.post("/api/post/create", auth(s, { gid, title, text, anon }));
const postDelete = (s, gid, postKey) => api.post("/api/post/delete", auth(s, { gid, postKey }));
const postReply = (s, gid, postKey, text, anon) => api.post("/api/post/reply", auth(s, { gid, postKey, text, anon }));
const postDeleteReply = (s, gid, postKey, replyId) => api.post("/api/post/deleteReply", auth(s, { gid, postKey, replyId }));
const setPin = (s, gid, msgKey, on) => api.post(on ? "/api/group/pin" : "/api/group/unpin", auth(s, { gid, msgKey }));
// Batch read: fetch every value under a prefix in a single request. Passing
// `since` (the newest timestamp we already hold) fetches only what is newer —
// the polling path, which normally transfers nothing instead of the history.
const slistValues = async (prefix, since) => {
  const j = await api.get("/api/mget?prefix=" + encodeURIComponent(prefix) + (since ? "&since=" + since : ""));
  if (!j || !j.items) return [];
  return j.items.map(([k, v]) => ({ ...v, _key: k }));
};

// ---------- shared room cache ----------
// One in-memory copy of each room's history, shared by the community list
// (previews + unread counts) and the room itself. Opening a room therefore
// paints instantly from what the list already polled; polls then ask the
// server only for messages newer than the newest one held, and a full refresh
// runs occasionally (and after every mutation) so deletions and edits land.
const roomCache = new Map();   // prefix -> sorted items
const roomFullAt = new Map();  // prefix -> when the cache was last fully fetched
const ROOM_FULL_MS = 20000;
// Cheap identity of a list: two lists with the same shape hold the same
// messages, so a poll that changed nothing must not re-render the room.
const sigOf = (list) => (list && list.length ? list.length + ":" + list[0]._key + ":" + list[list.length - 1]._key : "0");
const mergeItems = (base, delta) => {
  const byKey = new Map(base.map((m) => [m._key, m]));
  for (const m of delta) byKey.set(m._key, m);
  return [...byKey.values()].sort((a, b) => a.ts - b.ts);
};
async function syncRoom(prefix, forceFull) {
  const cached = roomCache.get(prefix) || [];
  const full = forceFull || !cached.length || Date.now() - (roomFullAt.get(prefix) || 0) > ROOM_FULL_MS;
  const fetched = await slistValues(prefix, full ? 0 : cached[cached.length - 1].ts);
  const next = (full ? fetched : mergeItems(cached, fetched)).sort((a, b) => a.ts - b.ts);
  roomCache.set(prefix, next);
  if (full) roomFullAt.set(prefix, Date.now());
  return next;
}

// ---------- session storage ----------
// The session lives in localStorage so an installed PWA (or a closed tab)
// opens straight back into the same account, and every tab shares one session.
// Only "Log out" clears it — or the session poll, when the account signs in
// somewhere else and the server rotates the session id.
const SK = "cc_session_v2";
const readSession = (store) => { try { return JSON.parse(store.getItem(SK)) || null; } catch { return null; } };
const loadSession = () => {
  try {
    const local = readSession(localStorage);
    if (local) return local;
    // Migrate a tab-scoped session left behind by an older build.
    const tab = readSession(sessionStorage);
    if (tab) { localStorage.setItem(SK, JSON.stringify(tab)); sessionStorage.removeItem(SK); return tab; }
  } catch {}
  return null;
};
const saveSession = (s) => {
  const v = JSON.stringify(s);
  try { localStorage.setItem(SK, v); } catch { try { sessionStorage.setItem(SK, v); } catch {} }
};
const clearSession = () => { try { localStorage.removeItem(SK); } catch {} try { sessionStorage.removeItem(SK); } catch {} };

const uid = () => Math.random().toString(36).slice(2, 10);
// clipboard with fallback for non-HTTPS origins (http://192.168.x.x etc.)
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.top = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
  } catch { return false; }
}
const now = () => Date.now();
const groupKey = (id) => `group:${id}`;
const msgPrefix = (g) => `msg:${g}:general:`;
const postPrefix = (g) => `post:${g}:`;
// Enter should fire a screen's primary button, the way submitting a form does.
const onEnter = (fn) => (e) => { if (e.key === "Enter") { e.preventDefault(); fn(); } };

const ANON_NAMES = ["Maple", "Cedar", "Willow", "Birch", "Aspen", "Sage", "Fern", "Heron", "Otter", "Robin", "Wren", "Lark"];
const anonLabel = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return "Anon " + ANON_NAMES[h % ANON_NAMES.length] + " " + (h % 90 + 10); };

// ---------- QR ----------
let _qrLibPromise = null;
function loadQRLib() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (_qrLibPromise) return _qrLibPromise;
  _qrLibPromise = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "qrcode.min.js"; s.onload = () => res(window.QRCode); s.onerror = rej; document.head.appendChild(s); });
  return _qrLibPromise;
}
function QRCodeView({ text, size = 200 }) {
  const ref = useRef(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let c = false; loadQRLib().then((QR) => { if (c || !ref.current) return; ref.current.innerHTML = ""; try { new QR(ref.current, { text, width: size, height: size, colorDark: "#0b0f14", colorLight: "#e8eef2", correctLevel: QR.CorrectLevel.M }); } catch { setFailed(true); } }).catch(() => setFailed(true)); return () => { c = true; }; }, [text, size]);
  if (failed) return <div style={{ width: size, fontSize: 12, color: "#7b8a96", textAlign: "center" }}>QR unavailable — use the link below.</div>;
  return <div ref={ref} style={{ borderRadius: 12, overflow: "hidden", lineHeight: 0 }} />;
}

// ============================================================
function CommunityChat() {
  // The stored session picks the first screen, so a returning user (including
  // an installed PWA that was closed) never sees a loading or login flash.
  const [session, setSession] = useState(loadSession);
  const [view, setView] = useState(() => (session ? "home" : "login")); // login | home | app
  const [group, setGroup] = useState(null);
  const [tab, setTab] = useState("general");
  const [pendingInvite, setPendingInvite] = useState(null);
  const [kicked, setKicked] = useState(false);

  const setSess = (s) => { if (s) { saveSession(s); } else { clearSession(); } setSession(s); };

  useEffect(() => {
    const m = (window.location.hash || "").match(/join=([A-Za-z0-9_-]+)/);
    if (m) setPendingInvite(m[1]);
  }, []);

  // poll: if our session was invalidated (the account signed in elsewhere),
  // follow the newer session another tab of this browser saved, else log out.
  useEffect(() => {
    if (!session) return;
    let stop = false;
    const check = async () => {
      const r = await api.get(`/api/account/session?key=${encodeURIComponent(session.key)}&sessionId=${encodeURIComponent(session.sessionId)}`);
      if (stop || !r || r.valid !== false) return;
      const stored = loadSession();
      if (stored && stored.key === session.key && stored.sessionId !== session.sessionId) return setSess(stored);
      setKicked(true); setSess(null); setGroup(null); setView("login");
    };
    const t = setInterval(check, 4000); check();
    return () => { stop = true; clearInterval(t); };
  }, [session]);

  // The session is shared across tabs, so logging out in one logs the rest out.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === SK && !loadSession()) { setSess(null); setGroup(null); setView("login"); } };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {view === "login" && <Login kicked={kicked} clearKicked={() => setKicked(false)} onAuthed={(s) => { setSess(s); setView("home"); }} />}
      {view === "home" && session && <Home session={session} pendingInvite={pendingInvite} clearInvite={() => setPendingInvite(null)} onOpen={(g) => { setGroup(g); setTab("general"); setView("app"); }} onLogout={() => { setSess(null); setView("login"); }} />}
      {view === "app" && group && session && <GroupApp session={session} group={group} setGroup={setGroup} tab={tab} setTab={setTab} onLeave={() => { setGroup(null); setView("home"); }} onLogout={() => { setSess(null); setGroup(null); setView("login"); }} />}
    </div>
  );
}

// ---------- login ----------
function Login({ onAuthed, kicked, clearKicked }) {
  const [mode, setMode] = useState("choose"); // choose | haveKey | created
  const [keyInput, setKeyInput] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [createdSession, setCreatedSession] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true); setErr("");
    const r = await api.post("/api/account/create", {});
    setBusy(false);
    if (r && r.key) { setCreatedKey(r.key); setCreatedSession({ key: r.key, sessionId: r.sessionId }); setMode("created"); }
    else setErr("Could not create account.");
  };
  const login = async () => {
    if (!keyInput.trim() || busy) return;
    setBusy(true); setErr("");
    const key = keyInput.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const r = await api.post("/api/account/login", { key });
    setBusy(false);
    if (r && r.ok) onAuthed({ key, sessionId: r.sessionId });
    else setErr("That login key isn't valid for this server.");
  };

  return (
    <div style={S.center}>
      <div style={S.card} className="reveal">
        <div style={S.brand}>◇ Commons</div>
        <p style={S.sub}>A space for communities.</p>
        {kicked && <div style={S.warn}>You were logged out because your account signed in on another device.</div>}

        {mode === "choose" && (
          <>
            <button style={{ ...S.primary, marginTop: 8 }} disabled={busy} onClick={create}><Key size={18} /> Create a new account</button>
            <button style={{ ...S.secondaryFull, marginTop: 10 }} onClick={() => { setMode("haveKey"); clearKicked(); }}><LogIn size={18} /> I have a login key</button>
            {err && <div style={S.error}>{err}</div>}
          </>
        )}

        {mode === "haveKey" && (
          <>
            <label style={S.label}>Login key</label>
            <input style={{ ...S.input, fontFamily: "monospace", letterSpacing: 1 }} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} onKeyDown={onEnter(login)} placeholder="your 16-character key" />
            {err && <div style={S.error}>{err}</div>}
            <button style={{ ...S.primary, marginTop: 14, opacity: keyInput.trim() ? 1 : .5 }} disabled={!keyInput.trim() || busy} onClick={login}>{busy ? "Checking…" : "Log in"}</button>
            <button style={S.ghost} onClick={() => { setMode("choose"); setErr(""); }}>Back</button>
          </>
        )}

        {mode === "created" && (
          <>
            <div style={S.warn}>Save this login key. It's the only way back into your account, and it only works on <b>this server</b>. We can't recover it.</div>
            <div style={S.keyBox}>
              <span style={{ fontFamily: "monospace", fontSize: 16, letterSpacing: 1, flex: 1, wordBreak: "break-all" }}>{createdKey.replace(/(.{4})/g, "$1 ").trim()}</span>
              <button style={S.iconBtn} onClick={async () => { await copyText(createdKey); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={16} color="#2dd4bf" /> : <Copy size={16} />}</button>
            </div>
            <button style={{ ...S.primary, marginTop: 14 }} onClick={() => onAuthed(createdSession)}>I saved it — continue</button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- home ----------
function Home({ session, pendingInvite, clearInvite, onOpen, onLogout }) {
  const [groups, setGroups] = useState([]);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [newName, setNewName] = useState("");
  const [inbox, setInbox] = useState({}); // gid -> { unread, preview }
  const groupsSig = useRef("");
  const inboxSig = useRef("");

  const refresh = useCallback(async () => {
    const all = await slistValues("group:");
    const gs = all.filter((g) => g && g.members && g.members[session.key] && !(g.banned || []).includes(session.key));
    gs.sort((a, b) => b.createdAt - a.createdAt);
    // Skip the state write (and the re-render) while nothing has changed.
    const gsig = JSON.stringify(gs);
    if (gsig !== groupsSig.current) { groupsSig.current = gsig; setGroups(gs); }
    // Telegram-style inbox: how many messages are waiting and the newest one.
    // Reading each room goes through the shared cache, so this poll is also
    // what makes opening a room instant — its history is already in memory.
    const next = {};
    await Promise.all(gs.map(async (g) => {
      const msgs = await syncRoom(msgPrefix(g.id));
      const member = g.members[session.key];
      const seen = getSeen(g.id, session.key) || (member && member.joinedAt) || 0;
      const unread = msgs.filter((m) => !m.system && m.author !== session.key && m.ts > seen).length;
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      next[g.id] = { unread, preview: last ? previewOf(last, session.key) : "" };
    }));
    const isig = JSON.stringify(next);
    if (isig !== inboxSig.current) { inboxSig.current = isig; setInbox(next); }
  }, [session.key]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { if (pendingInvite) setJoining(true); }, [pendingInvite]);

  // Groups are created server-side so a client can't hand itself ownership.
  const createGroup = async () => {
    const name = newName.trim();
    if (!name) return;
    const r = await api.post("/api/group/create", { key: session.key, sessionId: session.sessionId, name });
    if (!r || !r.ok) return;
    setCreating(false); setNewName(""); refresh(); onOpen(r.group);
  };

  return (
    <div style={S.screen}>
      <div style={S.appHeader}>
        <div style={{ flex: 1, fontWeight: 700, fontSize: 18 }}>Your communities</div>
        <button style={S.iconBtn} title="Log out" onClick={onLogout}><LogOut size={18} /></button>
      </div>
      <div style={S.scroll}>
        {groups.length === 0 && <div style={S.empty} className="reveal"><Users size={34} style={{ opacity: .5 }} /><p>No communities yet.</p><p style={S.muted}>Create one or join with an invite.</p></div>}
        {groups.map((g) => {
          const info = inbox[g.id] || {};
          return (
            <button key={g.id} data-role="group-card" style={S.groupCard} className="reveal" onClick={() => onOpen(g)}>
              <div style={S.groupAvatar}>{g.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</div>
                <div style={{ ...S.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {info.preview || "No messages yet"}
                </div>
              </div>
              {info.unread > 0 && <span data-role="unread-badge" style={S.badge}>{info.unread > 99 ? "99+" : info.unread}</span>}
            </button>
          );
        })}
      </div>
      <div style={S.bottomBar}>
        <button style={S.secondary} onClick={() => setJoining(true)}><LogIn size={18} /> Join</button>
        <button style={S.primary} onClick={() => setCreating(true)}><Plus size={18} /> Create</button>
      </div>

      {creating && <Modal onClose={() => setCreating(false)} title="Create community">
        <label style={S.label}>Community name</label>
        <input style={S.input} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={onEnter(createGroup)} placeholder="Oak Street Neighbors" maxLength={40} />
        <button style={{ ...S.primary, marginTop: 16, opacity: newName.trim() ? 1 : .5 }} disabled={!newName.trim()} onClick={createGroup}>Create</button>
      </Modal>}
      {joining && <JoinModal session={session} prefill={pendingInvite} onClose={() => { setJoining(false); clearInvite(); }} onJoined={(g) => { setJoining(false); clearInvite(); refresh(); onOpen(g); }} />}
    </div>
  );
}

function JoinModal({ session, prefill, onClose, onJoined }) {
  const [code, setCode] = useState(prefill || "");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const doJoin = async () => {
    const raw = code.trim();
    if (!raw || busy) return;
    setBusy(true); setErr("");
    const r = await api.post("/api/group/join", { key: session.key, sessionId: session.sessionId, code: raw });
    setBusy(false);
    if (r && r.ok) return onJoined(r.group);
    if (r && r.error === "banned") return setErr("You've been removed from this community and can't rejoin.");
    if (r && r.error === "not-found") return setErr("No community found for that code.");
    setErr("Could not join.");
  };
  return <Modal onClose={onClose} title="Join community">
    <label style={S.label}>Invite code or link</label>
    <input style={S.input} value={code} onChange={(e) => { const v = e.target.value; const m = v.match(/join=([A-Za-z0-9_-]+)/); setCode(m ? m[1] : v); }} onKeyDown={onEnter(doJoin)} placeholder="paste invite link or code" />
    {err && <div style={S.error}>{err}</div>}
    <button style={{ ...S.primary, marginTop: 16, opacity: code.trim() ? 1 : .5 }} disabled={!code.trim() || busy} onClick={doJoin}>{busy ? "Joining…" : "Join community"}</button>
  </Modal>;
}

// ---------- group app ----------
function GroupApp({ session, group, setGroup, tab, setTab, onLeave, onLogout }) {
  const [showInvite, setShowInvite] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [changingName, setChangingName] = useState(false);
  const me = group.members[session.key];
  const isOwner = group.ownerKey === session.key;
  const isAdmin = isOwner || (group.admins || []).includes(session.key);
  const memberCount = Object.keys(group.members).length;
  const needsName = !me || !me.username;
  const [mutes, toggleMute] = useMutes(group.id, session.key);
  const lastGroup = useRef("");

  const reloadGroup = useCallback(async () => {
    const g = await sget(groupKey(group.id));
    if (!g) return;
    if (!g.members[session.key] || (g.banned || []).includes(session.key)) { onLeave(); return; } // removed/banned elsewhere
    // Only touch state when the document really changed: a fresh object every
    // 3s would re-render the whole room (every bubble) for nothing.
    const sig = JSON.stringify(g);
    if (sig !== lastGroup.current) { lastGroup.current = sig; setGroup(g); }
  }, [group.id, session.key, setGroup, onLeave]);
  useEffect(() => { const t = setInterval(reloadGroup, 3000); return () => clearInterval(t); }, [reloadGroup]);

  if (needsName) return <UsernamePicker session={session} group={group} onSet={(g) => setGroup(g)} onLeave={onLeave} />;

  return (
    <div style={S.screen}>
      <div style={S.appHeader}>
        <button style={S.iconBtn} title="Back to your communities" onClick={onLeave}><ChevronLeft size={20} /></button>
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", lineHeight: 1.25 }}>
          <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{group.name}</div>
          <div data-role="member-count" style={{ ...S.muted, fontSize: 12 }}>{memberCount} member{memberCount === 1 ? "" : "s"}</div>
          <button style={{ ...S.nameBtn, textAlign: "center", maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title="Change your username" onClick={() => setChangingName(true)}>{me.username} ✎{isOwner ? " · owner" : isAdmin ? " · admin" : ""}</button>
        </div>
        <button style={S.iconBtn} title="Invite people" onClick={() => setShowInvite(true)}><QrCode size={18} /></button>
        {isAdmin && <button style={S.iconBtn} title="Manage members" onClick={() => setShowAdmin(true)}><Shield size={18} /></button>}
        <button style={S.iconBtn} title="Log out" onClick={onLogout}><LogOut size={18} /></button>
      </div>
      <div style={S.tabs}>
        <button style={{ ...S.tab, ...(tab === "general" ? S.tabActive : {}) }} onClick={() => setTab("general")}><MessageSquare size={16} /> General</button>
        <button style={{ ...S.tab, ...(tab === "forum" ? S.tabActive : {}) }} onClick={() => setTab("forum")}><MapPin size={16} /> Forum</button>
      </div>
      {tab === "general"
        ? <GeneralChat session={session} group={group} me={me} isAdmin={isAdmin} mutes={mutes} onToggleMute={toggleMute} onGroupChange={reloadGroup} />
        : <Forum session={session} group={group} me={me} isAdmin={isAdmin} mutes={mutes} />}
      {showInvite && <InviteModal group={group} session={session} onClose={() => setShowInvite(false)} onChange={reloadGroup} />}
      {showAdmin && isAdmin && <AdminModal session={session} group={group} isOwner={isOwner} onClose={() => setShowAdmin(false)} onChange={reloadGroup} onDeleted={onLeave} />}
      {changingName && <ChangeNameModal session={session} group={group} me={me} onClose={() => setChangingName(false)} onChanged={(g) => { setGroup(g); }} />}
    </div>
  );
}

// ---------- username picker / change ----------
function UsernamePicker({ session, group, onSet, onLeave }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr("");
    const r = await api.post("/api/group/claimname", { key: session.key, sessionId: session.sessionId, gid: group.id, username: name.trim() });
    setBusy(false);
    if (r && r.ok) return onSet(r.group);
    if (r && r.error === "taken") return setErr("That username is unavailable in this community.");
    if (r && r.error === "invalid") return setErr("Pick a name up to 24 characters.");
    setErr("Could not set username.");
  };
  return <div style={S.center}>
    <div style={S.card} className="reveal">
      <div style={S.brand}>Pick your name</div>
      <p style={S.sub}>Choose a username for <b>{group.name}</b>. Once taken, it's reserved for you and no one else can use it.</p>
      <label style={S.label}>Username</label>
      <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(submit)} placeholder="e.g. jordan_m" maxLength={24} />
      {err && <div style={S.error}>{err}</div>}
      <button style={{ ...S.primary, marginTop: 14, opacity: name.trim() ? 1 : .5 }} disabled={!name.trim() || busy} onClick={submit}>{busy ? "Checking…" : "Join community"}</button>
      <button style={S.ghost} onClick={onLeave}>Back</button>
    </div>
  </div>;
}

// ---------- change name (60-day cooldown, system message on success) ----------
function ChangeNameModal({ session, group, me, onClose, onChanged }) {
  const [name, setName] = useState(me.username || "");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr("");
    // The rename notice is written server-side, so it can't be forged or skipped.
    const r = await api.post("/api/group/claimname", { key: session.key, sessionId: session.sessionId, gid: group.id, username: name.trim() });
    setBusy(false);
    if (r && r.ok) { onChanged(r.group); onClose(); return; }
    if (r && r.error === "taken") return setErr("That username is unavailable in this community.");
    if (r && r.error === "cooldown") return setErr(`You can change your name again in ${r.daysLeft} day(s).`);
    if (r && r.error === "invalid") return setErr("Pick a name up to 24 characters.");
    setErr("Could not change name.");
  };
  return <Modal onClose={onClose} title="Change username">
    <p style={S.muted}>You can change your name once every 60 days. Everyone will see a note that your name changed. Your old name stays reserved to you.</p>
    <label style={{ ...S.label, marginTop: 12 }}>New username</label>
    <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter(submit)} maxLength={24} />
    {err && <div style={S.error}>{err}</div>}
    <button style={{ ...S.primary, marginTop: 14, opacity: name.trim() ? 1 : .5 }} disabled={!name.trim() || busy} onClick={submit}>{busy ? "Saving…" : "Save"}</button>
  </Modal>;
}

// ---------- room items hook ----------
// Seeds from the shared cache (so a room opens with its history already
// painted), then keeps it fresh. A poll that changed nothing does not touch
// state, so idle rooms cost no React reconciliation at all, and polls only
// transfer messages newer than the newest one held.
function useItems(prefix, ms = 2500) {
  const [items, setItems] = useState(() => roomCache.get(prefix) || []);
  const [ready, setReady] = useState(() => roomCache.has(prefix));
  const sigRef = useRef(sigOf(roomCache.get(prefix)));
  const apply = useCallback((list) => {
    const sig = sigOf(list);
    if (sig !== sigRef.current) { sigRef.current = sig; setItems(list); }
  }, []);
  const reload = useCallback(async () => { apply(await syncRoom(prefix, true)); }, [prefix, apply]);
  const poll = useCallback(async () => {
    apply(await syncRoom(prefix));
    setReady(true);
  }, [prefix, apply]);
  useEffect(() => {
    poll();
    const t = setInterval(poll, ms);
    // Catch up immediately when the app comes back to the foreground.
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [poll, ms]);
  // A local edit (optimistic send/delete) that the next reload reconciles.
  const mutate = useCallback((fn) => {
    const next = fn(roomCache.get(prefix) || []);
    if (!next) return;
    roomCache.set(prefix, next);
    sigRef.current = sigOf(next);
    setItems(next);
  }, [prefix]);
  return [items, reload, mutate, ready];
}

// One-line preview text for reply chains (Telegram-style).
const excerptOf = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 90);

// Read marks are per viewer, per community, and live only in this browser — the
// same trade-off as mutes. A missing mark falls back to when the viewer joined,
// so history from before they arrived is never counted as unread.
const seenKey = (gid, meKey) => `cc_seen:${gid}:${meKey}`;
const getSeen = (gid, meKey) => { try { return Number(localStorage.getItem(seenKey(gid, meKey))) || 0; } catch { return 0; } };
const markSeen = (gid, meKey, ts) => { try { localStorage.setItem(seenKey(gid, meKey), String(ts)); } catch {} };

// Mutes are per viewer, per community, and live only in this browser.
function useMutes(gid, meKey) {
  const key = `cc_mutes:${gid}:${meKey}`;
  const [mutes, setMutes] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(mutes)); } catch {} }, [key, mutes]);
  const toggle = useCallback((authorKey) => setMutes((prev) => prev.includes(authorKey) ? prev.filter((k) => k !== authorKey) : [...prev, authorKey]), []);
  return [mutes, toggle];
}

// A small built-in emoji palette — emoji are just text, so they travel through
// the same authenticated send path as any other message.
const EMOJI = ["😀","😄","😂","🥹","😊","😍","😎","🤔","😅","😉","🙃","😴","😢","😭","😡","🤯","👍","👎","👏","🙌","🙏","💪","🤝","👋","✌️","🤞","❤️","🧡","💚","💙","🔥","✨","🎉","🎂","☕","🍕","⚽","🎮","🎵","📷","✅","❌","⚠️","🎯","💡","🚀","🌧️","🌞"];

function Composer({ me, onSend, placeholder }) {
  const [text, setText] = useState("");
  const [anonOverride, setAnonOverride] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef(null);
  const anon = !!anonOverride;
  const send = () => { if (!text.trim()) return; onSend(text.trim(), anon); setText(""); setEmojiOpen(false); };
  const addEmoji = (e) => { setText((t) => t + e); if (inputRef.current) inputRef.current.focus(); };
  useEffect(() => {
    if (!emojiOpen) return;
    const close = () => setEmojiOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [emojiOpen]);
  return <div style={S.composer}>
    {emojiOpen && <div data-role="emoji-panel" style={S.emojiPanel} onClick={(e) => e.stopPropagation()}>
      {EMOJI.map((e) => <button key={e} style={S.emojiBtn} onClick={() => addEmoji(e)}>{e}</button>)}
    </div>}
    <button style={{ ...S.iconBtn, color: anon ? "#2dd4bf" : "#9fb0bd" }} title={anon ? "Sending anonymously" : "Sending as " + me.username} onClick={() => setAnonOverride(!anon)}>{anon ? <EyeOff size={20} /> : <Eye size={20} />}</button>
    <button style={{ ...S.iconBtn, color: emojiOpen ? ACCENT : "#9fb0bd" }} title="Emoji" onClick={(e) => { e.stopPropagation(); setEmojiOpen((v) => !v); }}><Smile size={20} /></button>
    <input ref={inputRef} style={S.composerInput} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
    <button style={S.sendBtn} onClick={send}><Send size={18} /></button>
  </div>;
}

const senderLabel = (m) => m.system ? null : (m.anon ? anonLabel((m.author || "x") + (m.gid || "")) : m.authorName);
// Telegram-style "who: what" line for a community card's newest message.
const previewOf = (m, meKey) => m.system ? m.text : `${m.author === meKey ? "You" : (senderLabel(m) || "member")}: ${excerptOf(m.text)}`;
// A long room mounts only the tail of its history; the rest stays one tap away.
// Threads, reply previews and search still resolve against the full list.
const WINDOW = 150;

function GeneralChat({ session, group, me, isAdmin, mutes, onToggleMute, onGroupChange }) {
  const prefix = msgPrefix(group.id);
  const [items, reload, mutate, ready] = useItems(prefix);
  const [shown, setShown] = useState(WINDOW);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [threadRoot, setThreadRoot] = useState(null);
  const [revealed, setRevealed] = useState(() => new Set());
  const [pinIdx, setPinIdx] = useState(0);
  const [highlight, setHighlight] = useState(null);
  const [jumpTo, setJumpTo] = useState(null);
  const [anchor, setAnchor] = useState(null); // the first unseen message this visit opened on
  const [atBottom, setAtBottom] = useState(true);
  const endRef = useRef(null);
  const feedRef = useRef(null);
  const openedRef = useRef(false);
  // Freeze the read mark for the visit: the room opens on the first message the
  // viewer hasn't seen, and only then does the mark narrow to the newest one.
  const [openSeen] = useState(() => getSeen(group.id, session.key) || (me && me.joinedAt) || 0);
  // Opening the room lands on the first unseen message (Telegram-style), so the
  // reader can scroll down through what they missed. After that, new messages
  // only follow the view when the reader is already at the bottom.
  useEffect(() => {
    if (!items.length) return;
    if (!openedRef.current) {
      openedRef.current = true;
      const firstUnseen = items.find((m) => !m.system && m.author !== session.key && m.ts > openSeen);
      markSeen(group.id, session.key, items[items.length - 1].ts);
      if (firstUnseen) {
        const el = document.getElementById("msg-" + firstUnseen.id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        flash(firstUnseen.id);
        setAnchor(firstUnseen.id);
        setAtBottom(false);
        return;
      }
    }
    if (atBottom) endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [items.length]);
  const onFeedScroll = () => { const el = feedRef.current; if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60); };
  const jumpToBottom = () => { setAnchor(null); setAtBottom(true); endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" }); };
  const showDown = !!anchor || !atBottom;
  // A click anywhere outside an open message menu dismisses it.
  useEffect(() => {
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  // A reveal only bypasses the mute that was active when the reader tapped it.
  // Without this, unmuting and muting the same person again leaves a stale
  // reveal behind, so the re-muted messages (and their reply previews) still
  // look visible — the whole point of muting stops working.
  const muteStamp = (mutes || []).join("|");
  useEffect(() => { setRevealed(new Set()); }, [muteStamp]);

  const pins = group.pins || [];
  useEffect(() => { setPinIdx(0); }, [pins.length]);
  const trimmed = query.trim();
  // Search is executed by the server over the group's entire history, so it is
  // not limited to (or dependent on) what this client has loaded.
  useEffect(() => {
    if (!trimmed) { setResults(null); return; }
    let dead = false;
    const t = setTimeout(async () => {
      const r = await messageSearch(session, group.id, trimmed);
      if (!dead) setResults(r && r.ok ? r.results : []);
    }, 150);
    return () => { dead = true; clearTimeout(t); };
  }, [trimmed, session.key, session.sessionId, group.id]);

  const flash = (id) => { setHighlight(id); setTimeout(() => setHighlight(null), 1800); };
  const scrollToId = (id) => { const el = document.getElementById("msg-" + id); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); flash(id); } };
  // After a search result is picked the query clears; scroll once the list is back.
  useEffect(() => {
    if (!jumpTo) return;
    scrollToId(jumpTo);
    setJumpTo(null);
  }, [jumpTo, items.length]);
  const cyclePin = () => {
    if (!pins.length) return;
    const next = pins.length > 1 ? (pinIdx + 1) % pins.length : pinIdx;
    setPinIdx(next);
    scrollToId(pins[next].id);
  };

  const mutedSet = new Set(mutes || []);
  const byKey = new Map(items.map((m) => [m._key, m]));
  const references = new Set(items.filter((m) => m.replyTo && m.replyTo.key).map((m) => m.replyTo.key));
  const reveal = (k) => setRevealed((prev) => { const n = new Set(prev); n.add(k); return n; });
  // Walk up the reply chain to the message that started the thread.
  const rootOf = (m) => { let cur = m; const seen = new Set(); while (cur && cur.replyTo && cur.replyTo.key) { const up = byKey.get(cur.replyTo.key); if (!up || seen.has(cur._key)) break; seen.add(cur._key); cur = up; } return cur; };
  // Every message that replies to `key`, directly or transitively.
  const descendants = (key) => { const out = []; const seen = new Set([key]); let frontier = [key]; while (frontier.length) { const next = []; for (const fk of frontier) for (const m of items) { if (m.replyTo && m.replyTo.key === fk && !seen.has(m._key)) { seen.add(m._key); out.push(m); next.push(m._key); } } frontier = next; } return out; };

  // Show local edits immediately; the reload that follows reconciles them.
  const addLocal = useCallback((m) => mutate((cur) => (cur.some((x) => x._key === m._key) ? null : [...cur, m].sort((a, b) => a.ts - b.ts))), [mutate]);
  const dropLocal = useCallback((key) => mutate((cur) => { const next = cur.filter((m) => m._key !== key); return next.length === cur.length ? null : next; }), [mutate]);
  const postMessage = async (text, anon, parent) => {
    const r = await messageSend(session, group.id, text, anon, parent ? { key: parent._key } : null);
    if (r && r.ok && r.message) addLocal({ ...r.message, _key: r.key });
    reload();
  };
  const send = (text, anon) => { const parent = replyTo; setReplyTo(null); postMessage(text, anon, parent); };
  const del = async (m) => { const r = await messageDelete(session, group.id, m._key); if (r && r.ok) dropLocal(m._key); reload(); };
  const togglePin = async (m) => {
    await setPin(session, group.id, m._key, !pins.some((p) => p.key === m._key));
    if (onGroupChange) onGroupChange();
  };
  const openThread = (m) => setThreadRoot(rootOf(m));
  const pinText = (pin) => { const m = byKey.get(pin.key); return m ? `${senderLabel(m)}: ${excerptOf(m.text)}` : "Deleted message"; };
  // Render only the newest slice of a long room; the window always stretches
  // to include the first unseen message, so opening still lands on it.
  const unseenIdx = items.findIndex((m) => !m.system && m.author !== session.key && m.ts > openSeen);
  const shownCount = Math.max(shown, unseenIdx >= 0 ? items.length - unseenIdx + 20 : 0);
  const visible = items.length > shownCount ? items.slice(items.length - shownCount) : items;
  return <div style={S.chatArea}>
    <div style={S.searchBar}>
      <Search size={16} style={{ color: "#7b8a96", flexShrink: 0 }} />
      <input style={S.searchInput} value={query} placeholder="Search all messages" onChange={(e) => setQuery(e.target.value)} />
      {query && <button style={S.iconBtn} title="Clear search" onClick={() => setQuery("")}><X size={16} /></button>}
    </div>
    {!trimmed && pins.length > 0 && <button data-role="pin-bar" style={S.pinBar} onClick={cyclePin} title={pins.length > 1 ? "Pinned messages — tap for the next" : "Pinned message"}>
      <Pin size={15} style={{ color: ACCENT, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <div style={S.pinBarLabel}>Pinned message{pins.length > 1 ? ` ${pinIdx + 1}/${pins.length}` : ""}</div>
        <div style={S.pinBarText}>{pinText(pins[pinIdx] || pins[0])}</div>
      </div>
    </button>}
    {trimmed ? <div style={S.messages}>
      <div style={{ ...S.muted, padding: "2px 4px" }}>{results === null ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"} across the whole history`}</div>
      {results && results.map((r) => <button key={r.key} style={S.result} onClick={() => { setResults(null); setQuery(""); setJumpTo(r.id); }}>
        <span style={{ color: SENDER, fontWeight: 600, fontSize: 13 }}>{r.anon ? anonLabel(r.author + group.id) : (r.authorName || "member")}</span>
        <div style={S.resultText}>{r.text}</div>
        <div data-role="msg-stamp" style={S.stamp}>{fmtStamp(r.ts)}</div>
      </button>)}
      {results && results.length === 0 && <div style={S.empty}><p style={S.muted}>No messages match “{trimmed}”.</p></div>}
    </div> : <div ref={feedRef} onScroll={onFeedScroll} data-role="feed" data-unread-anchor={anchor || undefined} style={S.messages}>
      {items.length === 0 && <div style={S.empty}><p style={S.muted}>{ready ? "Be the first to say hello 👋" : "Loading messages…"}</p></div>}
      {visible.length < items.length && <button data-role="show-earlier" style={S.showEarlier} onClick={() => setShown(shownCount + WINDOW)}>Show earlier messages</button>}
      {visible.map((m) => {
        if (m.system) return <div key={m.id} id={"msg-" + m.id} style={S.systemMsg} className="reveal">{m.text}</div>;
        const mine = m.author === session.key;
        const isMuted = mutedSet.has(m.author);
        const inChain = references.has(m._key) || !!m.replyTo;
        const pinned = pins.some((p) => p.key === m._key);
        // A muted author's messages leave the room — unless someone replied to
        // them (or they reply to something), when they stay in the chain as a
        // collapsed placeholder the reader can reveal.
        if (isMuted && !inChain) return null;
        if (isMuted && !revealed.has(m._key)) {
          return <div key={m.id} id={"msg-" + m.id} style={{ ...S.bubbleRow, justifyContent: mine ? "flex-end" : "flex-start" }} className="reveal">
            <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : {}), ...S.mutedBubble, ...(highlight === m.id ? S.bubbleFlash : {}) }}>
              <div style={S.bubbleHead}>
                <span style={{ color: MUTED, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><BellOff size={11} /> Muted message</span>
                <button style={S.showBtn} title="Show this message" onClick={() => reveal(m._key)}>Show</button>
              </div>
              <div style={{ fontSize: 13, color: MUTED, fontStyle: "italic" }}>Hidden because you muted this user.</div>
              <div data-role="msg-stamp" style={S.stamp}>{fmtStamp(m.ts)}</div>
            </div>
          </div>;
        }
        const root = rootOf(m);
        const hasThread = !!root && descendants(root._key).length > 0;
        return <div key={m.id} id={"msg-" + m.id} style={{ ...S.bubbleRow, justifyContent: mine ? "flex-end" : "flex-start", ...(menuFor === m.id ? S.bubbleRowActive : {}) }} className="reveal">
          <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : {}), ...(highlight === m.id ? S.bubbleFlash : {}) }}>
            <div style={S.bubbleHead}>
              <span style={{ color: SENDER, fontWeight: 600 }}>{m.anon && <EyeOff size={11} style={{ verticalAlign: -1, marginRight: 3 }} />}{senderLabel(m)}</span>
              {pinned && <Pin size={11} style={{ color: ACCENT, flexShrink: 0 }} />}
              <button style={S.miniDel} title="Message options" onClick={(e) => { e.stopPropagation(); setMenuFor((v) => (v === m.id ? null : m.id)); }}><MoreVertical size={14} /></button>
            </div>
            {menuFor === m.id && <MsgMenu mine={mine} isAdmin={isAdmin} hasThread={hasThread} muted={isMuted} pinned={pinned}
              onClose={() => setMenuFor(null)} onReply={() => setReplyTo(m)} onThread={() => openThread(m)}
              onToggleMute={() => onToggleMute(m.author)} onTogglePin={() => togglePin(m)} onDelete={() => del(m)} />}
            {m.replyTo && <ReplyPreview replyTo={m.replyTo} byKey={byKey} mutedSet={mutedSet} revealed={revealed} onReveal={reveal} />}
            <div>{m.text}</div>
            <div data-role="msg-stamp" style={S.stamp}>{fmtStamp(m.ts)}</div>
          </div>
        </div>;
      })}
      <div ref={endRef} />
    </div>}
    {showDown && <button data-role="scroll-down" title="Jump to the newest messages" style={S.scrollDown} onClick={jumpToBottom}><ChevronDown size={20} /></button>}
    {replyTo && <div style={S.replyBanner}>
      <CornerUpLeft size={14} style={{ flexShrink: 0, color: ACCENT }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.replyBannerName}>Replying to {senderLabel(replyTo) || "message"}</div>
        <div style={S.replyBannerText}>{excerptOf(replyTo.text)}</div>
      </div>
      <button style={S.iconBtn} title="Cancel reply" onClick={() => setReplyTo(null)}><X size={16} /></button>
    </div>}
    <Composer me={me} onSend={send} placeholder="Message the whole community…" />
    {threadRoot && <ThreadModal root={threadRoot} items={items} byKey={byKey} me={me} onClose={() => setThreadRoot(null)} onReply={(t, a) => postMessage(t, a, threadRoot)} />}
  </div>;
}

// The per-message menu (opened from the ⋮ button in a bubble's header).
function MsgMenu({ mine, isAdmin, hasThread, muted, pinned, onClose, onReply, onThread, onToggleMute, onTogglePin, onDelete }) {
  const item = (icon, label, onClick, danger) => (
    <button key={label} style={{ ...S.menuItem, ...(danger ? S.menuItemDanger : {}) }}
      onClick={(e) => { e.stopPropagation(); onClose(); onClick(); }}>{icon}<span>{label}</span></button>
  );
  return <div data-role="msg-menu" style={{ ...S.menu, ...(mine ? S.menuMine : S.menuTheirs) }} onClick={(e) => e.stopPropagation()}>
    {item(<CornerUpLeft size={15} />, "Reply", onReply)}
    {hasThread && item(<MessageSquare size={15} />, "View message thread", onThread)}
    {isAdmin && item(pinned ? <PinOff size={15} /> : <Pin size={15} />, pinned ? "Unpin message" : "Pin message", onTogglePin)}
    {!mine && item(muted ? <BellOff size={15} /> : <Bell size={15} />, muted ? "Unmute user" : "Mute user", onToggleMute)}
    {(mine || isAdmin) && item(<Trash2 size={15} />, "Delete message", onDelete, true)}
  </div>;
}

// Telegram-style "in reply to" preview above a message's text.
function ReplyPreview({ replyTo, byKey, mutedSet, revealed, onReveal }) {
  // The stored reply only carries the parent's key/author, so the name and
  // excerpt always come from the live message (and stay "Deleted" if it's gone).
  const parent = byKey.get(replyTo.key);
  const hiddenMuted = !!parent && mutedSet.has(parent.author) && !revealed.has(replyTo.key);
  return <div data-role="reply-preview" data-muted={hiddenMuted ? "1" : "0"}
    style={{ ...S.replyPreview, ...(hiddenMuted ? S.replyPreviewMuted : {}) }}
    onClick={hiddenMuted ? () => onReveal(replyTo.key) : undefined}
    title={hiddenMuted ? "Show the muted message" : undefined}>
    <CornerUpLeft size={13} style={{ flexShrink: 0, marginTop: 1 }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      {!parent
        ? <div style={{ ...S.replyPreviewName, color: MUTED, fontStyle: "italic" }}>Deleted</div>
        : hiddenMuted
          ? <div style={{ ...S.replyPreviewName, color: MUTED }}>Muted — tap to show</div>
          : <div style={S.replyPreviewName}>{senderLabel(parent)}</div>}
      {parent && !hiddenMuted && <div style={S.replyPreviewText}>{excerptOf(parent.text)}</div>}
    </div>
  </div>;
}

// A whole reply chain, opened by "View message thread".
function ThreadModal({ root, items, byKey, me, onClose, onReply }) {
  const chain = [];
  const seen = new Set([root._key]); let frontier = [root._key];
  while (frontier.length) {
    const next = [];
    for (const fk of frontier) for (const m of items) {
      if (m.replyTo && m.replyTo.key === fk && !seen.has(m._key)) { seen.add(m._key); chain.push(m); next.push(m._key); }
    }
    frontier = next;
  }
  const all = [root, ...chain].sort((a, b) => a.ts - b.ts);
  return <Modal onClose={onClose} title="Message thread">
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "52vh", overflowY: "auto" }}>
      {all.map((m, i) => <div key={m.id} style={{ ...S.reply, ...(i === 0 ? S.threadRoot : {}) }}>
        <div style={S.bubbleHead}>
          <span style={{ color: SENDER, fontWeight: 600, fontSize: 12 }}>{m.anon && <EyeOff size={10} style={{ verticalAlign: -1, marginRight: 3 }} />}{senderLabel(m)}</span>
          {i === 0 && <span style={{ ...S.pill, background: "#2dd4bf22", color: ACCENT, marginLeft: "auto" }}>ORIGINAL</span>}
        </div>
        {m.replyTo && <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>↩ {(() => { const par = byKey && byKey.get(m.replyTo.key); return par ? senderLabel(par) : "Deleted"; })()}</div>}
        <div style={{ fontSize: 14 }}>{m.text}</div>
        <div data-role="msg-stamp" style={S.stamp}>{fmtStamp(m.ts)}</div>
      </div>)}
    </div>
    <div style={{ marginTop: 10 }}><Composer me={me} onSend={(t, a) => onReply(t, a)} placeholder="Reply in this thread…" /></div>
  </Modal>;
}

function Forum({ session, group, me, isAdmin, mutes }) {
  const prefix = postPrefix(group.id);
  const [items, reload, mutate] = useItems(prefix, 3000);
  const [composing, setComposing] = useState(false);
  const [shown, setShown] = useState(40);
  // Show local edits immediately; the reload that follows reconciles them.
  const addLocal = useCallback((p) => mutate((cur) => (cur.some((x) => x._key === p._key) ? null : [...cur, p].sort((a, b) => a.ts - b.ts))), [mutate]);
  const replaceLocal = useCallback((key, p) => mutate((cur) => { const i = cur.findIndex((x) => x._key === key); if (i < 0) return null; const next = cur.slice(); next[i] = p; return next; }), [mutate]);
  const dropLocal = useCallback((key) => mutate((cur) => { const next = cur.filter((p) => p._key !== key); return next.length === cur.length ? null : next; }), [mutate]);
  const post = async (title, body, anon) => {
    const r = await postCreate(session, group.id, title, body, anon);
    if (r && r.ok && r.post) addLocal({ ...r.post, _key: r.key });
    reload();
  };
  const del = async (p) => { const r = await postDelete(session, group.id, p._key); if (r && r.ok) dropLocal(p._key); reload(); };
  const addReply = async (p, text, anon) => {
    const r = await postReply(session, group.id, p._key, text, anon);
    if (r && r.ok && r.post) replaceLocal(p._key, { ...r.post, _key: p._key });
    reload();
  };
  const delReply = async (p, rid) => {
    const r = await postDeleteReply(session, group.id, p._key, rid);
    if (r && r.ok && r.post) replaceLocal(p._key, { ...r.post, _key: p._key });
    reload();
  };
  // A muted member's posts never reach the forum for the person who muted them.
  const mutedSet = new Set(mutes || []);
  const sorted = items.filter((p) => !mutedSet.has(p.author)).sort((a, b) => b.ts - a.ts);
  // Newest posts first, and only the newest page is mounted for a long forum.
  const visible = sorted.slice(0, shown);
  return <div style={S.chatArea}>
    <div style={S.feed}>
      {sorted.length === 0 && <div style={S.empty}><MapPin size={28} style={{ opacity: .5 }} /><p style={S.muted}>No posts yet. Share something with the forum.</p></div>}
      {visible.map((p) => <PostCard key={p.id} post={p} session={session} me={me} isAdmin={isAdmin} onDelete={() => del(p)} onReply={(t, a) => addReply(p, t, a)} onDeleteReply={(rid) => delReply(p, rid)} />)}
      {visible.length < sorted.length && <button data-role="show-earlier" style={S.showEarlier} onClick={() => setShown(shown + 40)}>Show older posts ({sorted.length - visible.length})</button>}
    </div>
    <div style={S.composer}><button style={S.primary} onClick={() => setComposing(true)}><Plus size={18} /> New post</button></div>
    {composing && <PostComposer me={me} onClose={() => setComposing(false)} onPost={(t, b, a) => { post(t, b, a); setComposing(false); }} />}
  </div>;
}

function PostCard({ post, session, me, isAdmin, onDelete, onReply, onDeleteReply }) {
  const [open, setOpen] = useState(false);
  const mine = post.author === session.key;
  const replies = post.replies || [];
  return <div style={S.post} className="reveal">
    <div style={S.bubbleHead}>
      <span style={{ color: post.anon ? "#2dd4bf" : "#7dd3fc", fontWeight: 600 }}>{post.anon && <EyeOff size={11} style={{ verticalAlign: -1, marginRight: 3 }} />}{senderLabel(post)}</span>
      {(isAdmin || mine) && <button style={S.miniDel} onClick={onDelete}><Trash2 size={12} /></button>}
    </div>
    {post.title && <div style={S.postTitle}>{post.title}</div>}
    <div style={{ color: "#cdd9e1" }}>{post.text}</div>
    <div data-role="msg-stamp" style={S.stamp}>{fmtStamp(post.ts)}</div>
    <button style={S.replyToggle} onClick={() => setOpen((o) => !o)}>{replies.length} repl{replies.length === 1 ? "y" : "ies"} {open ? "▴" : "▾"}</button>
    {open && <div style={S.replyZone}>
      {replies.map((r) => { const rmine = r.author === session.key; return <div key={r.id} style={S.reply}>
        <div style={S.bubbleHead}>
          <span style={{ color: r.anon ? "#2dd4bf" : "#7dd3fc", fontWeight: 600, fontSize: 12 }}>{r.anon && <EyeOff size={10} style={{ verticalAlign: -1, marginRight: 3 }} />}{senderLabel(r)}</span>
          {(isAdmin || rmine) && <button style={S.miniDel} onClick={() => onDeleteReply(r.id)}><Trash2 size={11} /></button>}
        </div>
        <div style={{ fontSize: 14 }}>{r.text}</div>
        <div data-role="msg-stamp" style={S.stamp}>{fmtStamp(r.ts)}</div>
      </div>; })}
      <Composer me={me} onSend={(t, a) => onReply(t, a)} placeholder="Add a reply…" />
    </div>}
  </div>;
}

function PostComposer({ me, onClose, onPost }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState("");
  const [anonOverride, setAnonOverride] = useState(null);
  const anon = !!anonOverride;
  return <Modal onClose={onClose} title="New forum post">
    <label style={S.label}>Title (optional)</label>
    <input style={S.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lost cat, recommendation, alert…" maxLength={80} />
    <label style={{ ...S.label, marginTop: 10 }}>What's happening?</label>
    <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} value={body} onChange={(e) => setBody(e.target.value)} />
    <button style={{ ...S.toggleRow, marginTop: 12 }} onClick={() => setAnonOverride(!anon)}>{anon ? <EyeOff size={16} /> : <Eye size={16} />}<span style={{ flex: 1, textAlign: "left" }}>{anon ? "Posting anonymously" : "Posting as " + me.username}</span><span style={{ ...S.pill, background: anon ? "#2dd4bf22" : "#ffffff14", color: anon ? "#2dd4bf" : "#9fb0bd" }}>{anon ? "ANON" : "NAMED"}</span></button>
    <button style={{ ...S.primary, marginTop: 14, opacity: body.trim() ? 1 : .5 }} disabled={!body.trim()} onClick={() => onPost(title.trim(), body.trim(), anon)}>Post</button>
  </Modal>;
}

// ---------- invite ----------
function InviteModal({ group, session, onClose, onChange }) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const [mode, setMode] = useState("reusable"); // reusable | once
  const [once, setOnce] = useState(group.inviteOnce || null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const copy = async (which, text) => { await copyText(text); setCopied(which); setTimeout(() => setCopied(""), 1500); };
  const genOnce = async () => {
    setBusy(true);
    const r = await api.post("/api/group/invite", { key: session.key, sessionId: session.sessionId, gid: group.id });
    setBusy(false);
    if (r && r.ok) { setOnce(r.code); if (onChange) onChange(); }
  };
  const reusableLink = `${base}#join=${group.invite}`;
  const onceLink = once ? `${base}#join=${once}` : "";
  const codeBlock = (which, link) => <>
    <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 14px" }}><QRCodeView text={link} size={190} /></div>
    <div style={S.linkBox}>
      <Link2 size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{link}</span>
      <button style={S.iconBtn} title="Copy link" onClick={() => copy(which, link)}>{copied === which ? <Check size={16} color="#2dd4bf" /> : <Copy size={16} />}</button>
    </div>
  </>;
  return <Modal onClose={onClose} title="Invite people">
    <div style={S.segment}>
      <button style={{ ...S.segBtn, ...(mode === "reusable" ? S.segBtnActive : {}) }} onClick={() => setMode("reusable")}>Indefinite link</button>
      <button style={{ ...S.segBtn, ...(mode === "once" ? S.segBtnActive : {}) }} onClick={() => setMode("once")}>One-time link</button>
    </div>
    {mode === "reusable" ? <>
      <p style={{ ...S.muted, textAlign: "center" }}>Anyone with this link can join, as many times as you like.</p>
      {codeBlock("reusable", reusableLink)}
      <p style={{ ...S.muted, textAlign: "center", marginTop: 10 }}>Invite code: <b>{group.invite}</b></p>
    </> : <>
      <p style={{ ...S.muted, textAlign: "center" }}>This link works <b>once</b> — it stops working as soon as one person joins.</p>
      {once ? <>
        {codeBlock("once", onceLink)}
        <p style={{ ...S.muted, textAlign: "center", marginTop: 10 }}>Invite code: <b>{once}</b></p>
      </> : <div style={S.empty}><QrCode size={28} style={{ opacity: .5 }} /><p style={S.muted}>No one-time link yet.</p></div>}
      <button style={{ ...S.secondaryFull, marginTop: 12 }} disabled={busy} onClick={genOnce}>
        <Plus size={16} /> {busy ? "Creating…" : once ? "Generate a new one-time link" : "Create one-time link"}
      </button>
    </>}
  </Modal>;
}

// ---------- admin ----------
function AdminModal({ session, group, isOwner, onClose, onChange, onDeleted }) {
  const members = Object.entries(group.members);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busyDel, setBusyDel] = useState(false);
  // owner-only permanent ban
  const banUser = async (targetKey) => {
    await api.post("/api/group/ban", { key: session.key, sessionId: session.sessionId, gid: group.id, targetKey });
    onChange();
  };
  // Both actions are validated server-side; the client can't just rewrite the group doc.
  // admin (non-permanent) remove: just drop membership (can rejoin)
  const removeUser = async (targetKey) => {
    if (targetKey === group.ownerKey) return;
    await api.post("/api/group/remove", { key: session.key, sessionId: session.sessionId, gid: group.id, targetKey });
    onChange();
  };
  const toggleAdmin = async (targetKey) => {
    await api.post("/api/group/toggleadmin", { key: session.key, sessionId: session.sessionId, gid: group.id, targetKey });
    onChange();
  };
  return <Modal onClose={onClose} title="Manage members">
    <p style={S.muted}>Admins can remove members & delete messages. {isOwner ? "As owner, you can permanently ban." : "Only the owner can permanently ban."}</p>
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {members.map(([mKey, info]) => {
        const isAdm = (group.admins || []).includes(mKey);
        const isOwn = mKey === group.ownerKey;
        return <div key={mKey} style={S.memberRow}>
          <div style={S.groupAvatar}>{(info.username || "?").slice(0, 1).toUpperCase()}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{info.username || "(no name yet)"} {mKey === session.key && "(you)"}</div>
            <div style={S.muted}>{isOwn ? "Owner" : isAdm ? "Admin" : "Member"}</div>
          </div>
          {!isOwn && <>
            {isOwner && <button style={S.miniBtn} title="Toggle admin" onClick={() => toggleAdmin(mKey)}><Crown size={14} color={isAdm ? "#fbbf24" : "#6b7a85"} /></button>}
            <button style={S.miniBtn} title="Remove (can rejoin)" onClick={() => removeUser(mKey)}><UserMinus size={14} color="#f59e0b" /></button>
            {isOwner && <button style={S.miniBtn} title="Ban permanently" onClick={() => banUser(mKey)}><Ban size={14} color="#f87171" /></button>}
          </>}
        </div>;
      })}
    </div>
    {isOwner && <div style={S.dangerZone}>
      <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 6 }}>Danger zone</div>
      {!confirmDel
        ? <button style={S.dangerBtn} onClick={() => setConfirmDel(true)}><Trash2 size={15} /> Delete this community</button>
        : <>
            <p style={{ ...S.muted, marginBottom: 8 }}>This permanently deletes <b>{group.name}</b> and all its messages and posts for everyone. This can't be undone.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...S.secondaryFull, flex: 1 }} disabled={busyDel} onClick={() => setConfirmDel(false)}>Cancel</button>
              <button style={{ ...S.dangerBtn, flex: 1 }} disabled={busyDel} onClick={async () => {
                setBusyDel(true);
                const r = await api.post("/api/group/delete", { key: session.key, sessionId: session.sessionId, gid: group.id });
                setBusyDel(false);
                if (r && r.ok) { onClose(); onDeleted(); }
              }}>{busyDel ? "Deleting…" : "Yes, delete forever"}</button>
            </div>
          </>}
    </div>}
  </Modal>;
}

// ---------- shared ----------
function Modal({ title, children, onClose }) {
  return <div style={S.modalWrap} onClick={onClose}><div style={S.modal} className="sheet" onClick={(e) => e.stopPropagation()}>
    <div style={S.modalHead}><span style={{ fontWeight: 700 }}>{title}</span><button style={S.iconBtn} onClick={onClose}><X size={18} /></button></div>{children}
  </div></div>;
}
// Every message — General bubbles, forum posts and replies, thread items and
// search results — carries its date and time in Eastern time, tucked into the
// bottom-right corner (Telegram-style). "EST" is the label the user asked for
// even while the zone is on daylight time.
function fmtStamp(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return `${date} · ${time} EST`;
}

const BG = "#0b0f14", PANEL = "#11171f", PANEL2 = "#161e28", LINE = "#1f2a36", TEXT = "#e8eef2", MUTED = "#7b8a96", ACCENT = "#2dd4bf", SENDER = "#9fc3d6";
const S = {
  root: { fontFamily: "'Outfit', system-ui, sans-serif", background: BG, color: TEXT, height: "100vh", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" },
  screen: { display: "flex", flexDirection: "column", height: "100%" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 20 },
  card: { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 20, padding: 24, width: "100%", maxWidth: 400 },
  brand: { fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, marginBottom: 6 },
  sub: { color: MUTED, fontSize: 14, marginBottom: 18 },
  label: { fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: MUTED, display: "block", marginBottom: 6 },
  input: { width: "100%", background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 12, padding: "12px 14px", fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit" },
  primary: { width: "100%", background: ACCENT, color: "#04201d", border: "none", borderRadius: 12, padding: "13px", fontWeight: 700, fontSize: 15, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", justifyContent: "center" },
  secondary: { flex: 1, background: PANEL2, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 12, padding: "13px", fontWeight: 600, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", justifyContent: "center" },
  secondaryFull: { width: "100%", background: PANEL2, color: TEXT, border: `1px solid ${LINE}`, borderRadius: 12, padding: "13px", fontWeight: 600, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", justifyContent: "center" },
  ghost: { width: "100%", background: "transparent", color: MUTED, border: "none", padding: 10, cursor: "pointer", marginTop: 6 },
  toggleRow: { width: "100%", display: "flex", alignItems: "center", gap: 10, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "11px 13px", color: TEXT, cursor: "pointer", fontSize: 14 },
  pill: { fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20 },
  appHeader: { display: "flex", alignItems: "center", gap: 6, padding: "14px", borderBottom: `1px solid ${LINE}`, background: PANEL },
  iconBtn: { background: "transparent", border: "none", color: TEXT, cursor: "pointer", padding: 6, borderRadius: 8, display: "flex" },
  tabs: { display: "flex", borderBottom: `1px solid ${LINE}`, background: PANEL },
  tab: { flex: 1, background: "transparent", border: "none", borderBottom: "2px solid transparent", color: MUTED, padding: "13px", cursor: "pointer", display: "flex", gap: 7, alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14 },
  tabActive: { color: ACCENT, borderBottomColor: ACCENT },
  scroll: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 },
  chatArea: { position: "relative", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
  messages: { flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  searchBar: { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: `1px solid ${LINE}`, background: PANEL },
  searchInput: { flex: 1, background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 20, padding: "8px 14px", outline: "none", fontSize: 14, fontFamily: "inherit" },
  feed: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 },
  bubbleRow: { display: "flex" },
  // A message row is its own stacking context (the `.reveal` animation), which
  // traps the absolutely-positioned menu's z-index. While a menu is open we lift
  // the entire row so the following message can never paint over the menu.
  bubbleRowActive: { position: "relative", zIndex: 40 },
  // Telegram-style: bubbles use most of the width, and there are exactly two
  // message colors — the viewer's own (#123f38) and everybody else's (PANEL2).
  bubble: { position: "relative", maxWidth: "92%", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 16, borderBottomLeftRadius: 5, padding: "9px 13px", fontSize: 15, lineHeight: 1.4, boxShadow: "0 1px 2px rgba(0,0,0,.35)" },
  bubbleMine: { background: "#123f38", border: "1px solid #1d5a50", borderBottomLeftRadius: 16, borderBottomRightRadius: 5 },
  bubbleHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 3, fontSize: 12 },
  stamp: { fontSize: 10, color: MUTED, textAlign: "right", marginTop: 3, letterSpacing: .2 },
  systemMsg: { alignSelf: "center", fontSize: 12, color: MUTED, background: PANEL2, borderRadius: 20, padding: "4px 12px", margin: "2px 0" },
  miniDel: { background: "transparent", border: "none", color: "#6b7a85", cursor: "pointer", padding: 2, display: "flex", marginLeft: "auto" },
  menu: { position: "absolute", top: 24, zIndex: 30, minWidth: 178, background: "#0f1620", border: `1px solid ${LINE}`, borderRadius: 12, padding: 4, boxShadow: "0 12px 32px rgba(0,0,0,.55)" },
  // Anchor the menu to whichever edge the bubble is aligned to, so it always
  // grows inward. A short left-aligned message leaves almost no room to its
  // left, and a right-anchored 178px menu would run off the screen's left edge.
  menuMine: { right: 4 },
  menuTheirs: { left: 4 },
  menuItem: { display: "flex", alignItems: "center", gap: 9, width: "100%", background: "transparent", border: "none", color: TEXT, padding: "9px 10px", borderRadius: 8, cursor: "pointer", fontSize: 14, textAlign: "left", fontFamily: "inherit" },
  menuItemDanger: { color: "#f87171" },
  mutedBubble: { borderStyle: "dashed", opacity: .92 },
  showBtn: { background: "transparent", border: `1px solid ${LINE}`, color: ACCENT, cursor: "pointer", padding: "2px 9px", borderRadius: 20, fontSize: 11, marginLeft: "auto", fontFamily: "inherit" },
  // Translucent so the quote block is derived from whichever of the two
  // message colors it sits on — no third message surface color.
  replyPreview: { display: "flex", gap: 6, alignItems: "flex-start", background: "rgba(255,255,255,.06)", borderLeft: `3px solid ${ACCENT}`, borderRadius: 8, padding: "6px 9px", margin: "2px 0 5px" },
  replyPreviewMuted: { borderLeftColor: MUTED, cursor: "pointer" },
  replyPreviewName: { fontSize: 12, fontWeight: 700, color: ACCENT, lineHeight: 1.25 },
  replyPreviewText: { fontSize: 12, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  replyBanner: { display: "flex", gap: 8, alignItems: "center", padding: "9px 14px", background: PANEL, borderTop: `1px solid ${LINE}` },
  replyBannerName: { fontSize: 12, fontWeight: 700, color: ACCENT },
  replyBannerText: { fontSize: 12, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  threadRoot: { borderLeft: `3px solid ${ACCENT}` },
  segment: { display: "flex", gap: 4, padding: 4, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, marginBottom: 12 },
  segBtn: { flex: 1, background: "transparent", border: "none", color: MUTED, padding: "9px 6px", borderRadius: 9, cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: "inherit" },
  segBtnActive: { background: PANEL, color: TEXT },
  composer: { position: "relative", display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${LINE}`, background: PANEL, alignItems: "center" },
  emojiPanel: { position: "absolute", bottom: 58, left: 8, right: 8, zIndex: 40, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2, padding: 8, background: "#0f1620", border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: "0 12px 32px rgba(0,0,0,.55)", maxHeight: 200, overflowY: "auto" },
  emojiBtn: { background: "transparent", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 4, borderRadius: 8, fontFamily: "inherit" },
  pinBar: { display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "8px 14px", background: "#0f1620", border: "none", borderBottom: `1px solid ${LINE}`, color: TEXT, cursor: "pointer", fontFamily: "inherit" },
  pinBarLabel: { fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: .6 },
  pinBarText: { fontSize: 13, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  result: { display: "flex", flexDirection: "column", gap: 3, width: "100%", textAlign: "left", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "10px 12px", color: TEXT, cursor: "pointer", fontFamily: "inherit" },
  resultText: { fontSize: 14, color: "#cdd9e1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  bubbleFlash: { boxShadow: `0 0 0 2px ${ACCENT}` },
  composerInput: { flex: 1, background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 22, padding: "11px 16px", outline: "none", fontSize: 15, fontFamily: "inherit" },
  sendBtn: { background: ACCENT, color: "#04201d", border: "none", borderRadius: "50%", width: 42, height: 42, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  post: { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: 14 },
  postTitle: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, margin: "4px 0 6px" },
  replyToggle: { background: "transparent", border: "none", color: ACCENT, cursor: "pointer", fontSize: 13, marginTop: 10, padding: 0 },
  replyZone: { marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 },
  reply: { background: PANEL2, borderRadius: 10, padding: "7px 10px" },
  showEarlier: { alignSelf: "center", background: "transparent", border: `1px solid ${LINE}`, color: MUTED, borderRadius: 20, padding: "5px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" },
  bottomBar: { display: "flex", gap: 10, padding: 14, borderTop: `1px solid ${LINE}`, background: PANEL },
  badge: { background: ACCENT, color: "#04201d", fontWeight: 700, fontSize: 12, minWidth: 22, height: 22, padding: "0 7px", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  scrollDown: { position: "absolute", right: 14, bottom: 78, zIndex: 35, width: 38, height: 38, borderRadius: "50%", background: PANEL, border: `1px solid ${LINE}`, color: ACCENT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(0,0,0,.45)" },
  groupCard: { display: "flex", alignItems: "center", gap: 12, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12, cursor: "pointer", color: TEXT },
  groupAvatar: { width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#2dd4bf,#0e7490)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#04201d", flexShrink: 0 },
  empty: { textAlign: "center", padding: "40px 20px", color: MUTED, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  muted: { color: MUTED, fontSize: 13 },
  nameBtn: { background: "transparent", border: "none", color: MUTED, fontSize: 13, cursor: "pointer", padding: 0, textAlign: "left" },
  warn: { background: "#3a2a08", border: "1px solid #7c5e16", color: "#fcd34d", borderRadius: 12, padding: "10px 12px", fontSize: 13, marginBottom: 14, lineHeight: 1.4 },
  keyBox: { display: "flex", alignItems: "center", gap: 8, background: PANEL2, border: `1px solid ${ACCENT}`, borderRadius: 12, padding: "12px 14px", marginTop: 6 },
  modalWrap: { position: "absolute", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 },
  modal: { background: PANEL, borderTop: `1px solid ${LINE}`, borderRadius: "20px 20px 0 0", padding: 20, width: "100%", maxWidth: 480, maxHeight: "85%", overflowY: "auto", boxSizing: "border-box" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  linkBox: { display: "flex", alignItems: "center", gap: 8, background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "10px 12px", marginTop: 6 },
  memberRow: { display: "flex", alignItems: "center", gap: 10, background: PANEL2, borderRadius: 12, padding: 10 },
  miniBtn: { background: "transparent", border: `1px solid ${LINE}`, borderRadius: 8, padding: 7, cursor: "pointer", display: "flex" },
  error: { color: "#f87171", fontSize: 13, marginTop: 8 },
  dangerZone: { marginTop: 18, paddingTop: 14, borderTop: `1px solid #3a1f24` },
  dangerBtn: { width: "100%", background: "#2a1518", color: "#f87171", border: "1px solid #5b2730", borderRadius: 12, padding: "12px", fontWeight: 700, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", justifyContent: "center" },
};
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; }
::-webkit-scrollbar { width: 0; }
.reveal { animation: rise .25s ease both; }
@keyframes rise { from { opacity:0; transform: translateY(6px);} to {opacity:1; transform:none;} }
.sheet { animation: slideUp .25s cubic-bezier(.2,.8,.2,1) both; }
@keyframes slideUp { from { transform: translateY(100%);} to { transform: none;} }
.pulse { animation: p 1.2s ease-in-out infinite; color:${ACCENT}; }
@keyframes p { 0%,100%{opacity:.3;} 50%{opacity:1;} }
input::placeholder, textarea::placeholder { color:#54636e; }
`;
window.CommunityChat = CommunityChat;
