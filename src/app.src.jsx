const { useState, useEffect, useRef, useCallback } = React;
const {
  Users, MapPin, Shield, Send, Eye, EyeOff, Link2, QrCode, Search,
  X, Trash2, UserMinus, Crown, LogIn, Plus, Copy, Check, MessageSquare, ChevronLeft, Ban, Key, LogOut
} = lucide;

// ---------- API ----------
// Every call resolves to a value or null — a dropped connection or a non-JSON
// error page must never leave a button stuck in its "busy" state.
const api = {
  async post(path, body) { try { const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }); return await r.json(); } catch { return null; } },
  async get(path) { try { const r = await fetch(path); return await r.json(); } catch { return null; } },
};
const sget = async (k) => { const j = await api.get("/api/get?key=" + encodeURIComponent(k)); return j ? j.value : null; };
const sset = async (k, v) => !!(await api.post("/api/set", { key: k, value: v }));
const sdelete = async (k) => !!(await api.post("/api/delete", { key: k }));
const slist = async (prefix) => { const j = await api.get("/api/list?prefix=" + encodeURIComponent(prefix)); return j ? j.keys : []; };
// Batch read: fetch every value under a prefix in a single request.
const slistValues = async (prefix) => {
  const j = await api.get("/api/mget?prefix=" + encodeURIComponent(prefix));
  if (!j || !j.items) return [];
  return j.items.map(([k, v]) => ({ ...v, _key: k }));
};

// ---------- session storage (cleared when browser/tab closes) ----------
const SK = "cc_session_v2";
const loadSession = () => { try { return JSON.parse(sessionStorage.getItem(SK)) || null; } catch { return null; } };
const saveSession = (s) => { try { sessionStorage.setItem(SK, JSON.stringify(s)); } catch {} };
const clearSession = () => { try { sessionStorage.removeItem(SK); } catch {} };

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
  const [session, setSession] = useState(loadSession());
  const [view, setView] = useState("loading"); // loading | login | home | app
  const [group, setGroup] = useState(null);
  const [tab, setTab] = useState("general");
  const [pendingInvite, setPendingInvite] = useState(null);
  const [kicked, setKicked] = useState(false);

  const setSess = (s) => { if (s) { saveSession(s); } else { clearSession(); } setSession(s); };

  useEffect(() => {
    const m = (window.location.hash || "").match(/join=([A-Za-z0-9_-]+)/);
    if (m) setPendingInvite(m[1]);
    const s = loadSession();
    setView(s ? "home" : "login");
  }, []);

  // poll: if our session was invalidated (logged in elsewhere) -> force logout
  useEffect(() => {
    if (!session) return;
    let stop = false;
    const check = async () => {
      const r = await api.get(`/api/account/session?key=${encodeURIComponent(session.key)}&sessionId=${encodeURIComponent(session.sessionId)}`);
      if (!stop && r && r.valid === false) { setKicked(true); setSess(null); setGroup(null); setView("login"); }
    };
    const t = setInterval(check, 4000); check();
    return () => { stop = true; clearInterval(t); };
  }, [session]);

  return (
    <div style={S.root}>
      <style>{CSS}</style>
      {view === "loading" && <div style={S.center}><div className="pulse" style={{ fontSize: 40 }}>◇</div></div>}
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
            <input style={{ ...S.input, fontFamily: "monospace", letterSpacing: 1 }} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="your 16-character key" />
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

  const refresh = useCallback(async () => {
    const all = await slistValues("group:");
    const gs = all.filter((g) => g && g.members && g.members[session.key] && !(g.banned || []).includes(session.key));
    gs.sort((a, b) => b.createdAt - a.createdAt);
    setGroups(gs);
  }, [session.key]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (pendingInvite) setJoining(true); }, [pendingInvite]);

  // Groups are created server-side so a client can't hand itself ownership.
  const createGroup = async () => {
    const name = newName.trim();
    const r = await api.post("/api/group/create", { key: session.key, name });
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
          const me = g.members[session.key];
          return (
            <button key={g.id} style={S.groupCard} className="reveal" onClick={() => onOpen(g)}>
              <div style={S.groupAvatar}>{g.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>{g.name}</div>
                <div style={S.muted}>{Object.keys(g.members).length} member(s){me && me.username ? " · " + me.username : " · pick a name"}</div>
              </div>
              {g.ownerKey === session.key ? <Crown size={16} color="#fbbf24" /> : (g.admins || []).includes(session.key) ? <Shield size={15} color="#7dd3fc" /> : null}
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
        <input style={S.input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Oak Street Neighbors" maxLength={40} />
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
    setBusy(true); setErr("");
    const raw = code.trim();
    const r = await api.post("/api/group/join", { key: session.key, code: raw });
    setBusy(false);
    if (r && r.ok) return onJoined(r.group);
    if (r && r.error === "banned") return setErr("You've been removed from this community and can't rejoin.");
    if (r && r.error === "not-found") return setErr("No community found for that code.");
    setErr("Could not join.");
  };
  return <Modal onClose={onClose} title="Join community">
    <label style={S.label}>Invite code or link</label>
    <input style={S.input} value={code} onChange={(e) => { const v = e.target.value; const m = v.match(/join=([A-Za-z0-9_-]+)/); setCode(m ? m[1] : v); }} placeholder="paste invite link or code" />
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
  const needsName = !me || !me.username;

  const reloadGroup = useCallback(async () => {
    const g = await sget(groupKey(group.id));
    if (!g) return;
    if (!g.members[session.key] || (g.banned || []).includes(session.key)) { onLeave(); return; } // removed/banned elsewhere
    setGroup(g);
  }, [group.id, session.key, setGroup, onLeave]);
  useEffect(() => { const t = setInterval(reloadGroup, 3000); return () => clearInterval(t); }, [reloadGroup]);

  if (needsName) return <UsernamePicker session={session} group={group} onSet={(g) => setGroup(g)} onLeave={onLeave} />;

  return (
    <div style={S.screen}>
      <div style={S.appHeader}>
        <button style={S.iconBtn} onClick={onLeave}><ChevronLeft size={20} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{group.name}</div>
          <button style={S.nameBtn} onClick={() => setChangingName(true)}>{me.username}{isOwner ? " · owner" : isAdmin ? " · admin" : ""} ✎</button>
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
        ? <GeneralChat session={session} group={group} me={me} isAdmin={isAdmin} />
        : <Forum session={session} group={group} me={me} isAdmin={isAdmin} />}
      {showInvite && <InviteModal group={group} onClose={() => setShowInvite(false)} />}
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
    setBusy(true); setErr("");
    const r = await api.post("/api/group/claimname", { key: session.key, gid: group.id, username: name.trim() });
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
      <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. jordan_m" maxLength={24} />
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
    setBusy(true); setErr("");
    const r = await api.post("/api/group/claimname", { key: session.key, gid: group.id, username: name.trim() });
    setBusy(false);
    if (r && r.ok) {
      if (r.changedFrom) {
        const id = uid(), ts = now();
        await sset(`${msgPrefix(group.id)}${ts}:${id}`, { id, ts, system: true, text: `${r.changedFrom} changed their name to ${name.trim()}` });
      }
      onChanged(r.group); onClose(); return;
    }
    if (r && r.error === "taken") return setErr("That username is unavailable in this community.");
    if (r && r.error === "cooldown") return setErr(`You can change your name again in ${r.daysLeft} day(s).`);
    if (r && r.error === "invalid") return setErr("Pick a name up to 24 characters.");
    setErr("Could not change name.");
  };
  return <Modal onClose={onClose} title="Change username">
    <p style={S.muted}>You can change your name once every 60 days. Everyone will see a note that your name changed. Your old name stays reserved to you.</p>
    <label style={{ ...S.label, marginTop: 12 }}>New username</label>
    <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
    {err && <div style={S.error}>{err}</div>}
    <button style={{ ...S.primary, marginTop: 14, opacity: name.trim() ? 1 : .5 }} disabled={!name.trim() || busy} onClick={submit}>{busy ? "Saving…" : "Save"}</button>
  </Modal>;
}

// ---------- messages hook ----------
function useItems(prefix, ms = 2500) {
  const [items, setItems] = useState([]);
  const load = useCallback(async () => {
    const all = await slistValues(prefix);
    all.sort((a, b) => a.ts - b.ts); setItems(all);
  }, [prefix]);
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return [items, load];
}

function Composer({ me, onSend, placeholder }) {
  const [text, setText] = useState("");
  const [anonOverride, setAnonOverride] = useState(null);
  const anon = !!anonOverride;
  const send = () => { if (!text.trim()) return; onSend(text.trim(), anon); setText(""); };
  return <div style={S.composer}>
    <button style={{ ...S.iconBtn, color: anon ? "#2dd4bf" : "#9fb0bd" }} title={anon ? "Sending anonymously" : "Sending as " + me.username} onClick={() => setAnonOverride(!anon)}>{anon ? <EyeOff size={20} /> : <Eye size={20} />}</button>
    <input style={S.composerInput} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
    <button style={S.sendBtn} onClick={send}><Send size={18} /></button>
  </div>;
}

const senderLabel = (m) => m.system ? null : (m.anon ? anonLabel((m.author || "x") + (m.gid || "")) : m.authorName);

function GeneralChat({ session, group, me, isAdmin }) {
  const prefix = msgPrefix(group.id);
  const [items, reload] = useItems(prefix);
  const [query, setQuery] = useState("");
  const endRef = useRef(null);
  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" }); }, [items.length]);
  const send = async (text, anon) => { const id = uid(), ts = now(); await sset(`${prefix}${ts}:${id}`, { id, ts, text, anon, author: session.key, authorName: me.username, gid: group.id }); reload(); };
  const del = async (m) => { await sdelete(m._key); reload(); };
  // Case-insensitive search across this group's messages. System notices are
  // excluded so a search only returns actual conversation.
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((m) => !m.system && (m.text || "").toLowerCase().includes(q)) : items;
  return <div style={S.chatArea}>
    <div style={S.searchBar}>
      <Search size={16} style={{ color: "#7b8a96", flexShrink: 0 }} />
      <input style={S.searchInput} value={query} placeholder="Search messages" onChange={(e) => setQuery(e.target.value)} />
      {query && <button style={S.iconBtn} title="Clear search" onClick={() => setQuery("")}><X size={16} /></button>}
    </div>
    <div style={S.messages}>
      {shown.length === 0 && <div style={S.empty}><p style={S.muted}>{q ? `No messages match “${query.trim()}”.` : "Be the first to say hello 👋"}</p></div>}
      {shown.map((m) => {
        if (m.system) return <div key={m.id} style={S.systemMsg} className="reveal">{m.text}</div>;
        const mine = m.author === session.key;
        return <div key={m.id} style={{ ...S.bubbleRow, justifyContent: mine ? "flex-end" : "flex-start" }} className="reveal">
          <div style={{ ...S.bubble, ...(mine ? S.bubbleMine : {}) }}>
            <div style={S.bubbleHead}>
              <span style={{ color: m.anon ? "#2dd4bf" : "#7dd3fc", fontWeight: 600 }}>{m.anon && <EyeOff size={11} style={{ verticalAlign: -1, marginRight: 3 }} />}{senderLabel(m)}</span>
              <span style={S.time}>{fmtTime(m.ts)}</span>
              {(isAdmin || mine) && <button style={S.miniDel} onClick={() => del(m)}><Trash2 size={12} /></button>}
            </div>
            <div>{m.text}</div>
          </div>
        </div>;
      })}
      <div ref={endRef} />
    </div>
    <Composer me={me} onSend={send} placeholder="Message the whole community…" />
  </div>;
}

function Forum({ session, group, me, isAdmin }) {
  const prefix = postPrefix(group.id);
  const [items, reload] = useItems(prefix, 3000);
  const [composing, setComposing] = useState(false);
  const post = async (title, body, anon) => { const id = uid(), ts = now(); await sset(`${prefix}${ts}:${id}`, { id, ts, title, text: body, anon, author: session.key, authorName: me.username, gid: group.id, replies: [] }); reload(); };
  const del = async (p) => { await sdelete(p._key); reload(); };
  const stripKey = (o) => { const { _key, ...r } = o; return r; };
  const addReply = async (p, text, anon) => { const reply = { id: uid(), ts: now(), text, anon, author: session.key, authorName: me.username, gid: group.id }; await sset(p._key, stripKey({ ...p, replies: [...(p.replies || []), reply] })); reload(); };
  const delReply = async (p, rid) => { await sset(p._key, stripKey({ ...p, replies: (p.replies || []).filter((r) => r.id !== rid) })); reload(); };
  const sorted = [...items].sort((a, b) => b.ts - a.ts);
  return <div style={S.chatArea}>
    <div style={S.feed}>
      {sorted.length === 0 && <div style={S.empty}><MapPin size={28} style={{ opacity: .5 }} /><p style={S.muted}>No posts yet. Share something with the forum.</p></div>}
      {sorted.map((p) => <PostCard key={p.id} post={p} session={session} me={me} isAdmin={isAdmin} onDelete={() => del(p)} onReply={(t, a) => addReply(p, t, a)} onDeleteReply={(rid) => delReply(p, rid)} />)}
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
      <span style={S.time}>{fmtTime(post.ts)}</span>
      {(isAdmin || mine) && <button style={S.miniDel} onClick={onDelete}><Trash2 size={12} /></button>}
    </div>
    {post.title && <div style={S.postTitle}>{post.title}</div>}
    <div style={{ color: "#cdd9e1" }}>{post.text}</div>
    <button style={S.replyToggle} onClick={() => setOpen((o) => !o)}>{replies.length} repl{replies.length === 1 ? "y" : "ies"} {open ? "▴" : "▾"}</button>
    {open && <div style={S.replyZone}>
      {replies.map((r) => { const rmine = r.author === session.key; return <div key={r.id} style={S.reply}>
        <div style={S.bubbleHead}>
          <span style={{ color: r.anon ? "#2dd4bf" : "#7dd3fc", fontWeight: 600, fontSize: 12 }}>{r.anon && <EyeOff size={10} style={{ verticalAlign: -1, marginRight: 3 }} />}{senderLabel(r)}</span>
          <span style={S.time}>{fmtTime(r.ts)}</span>
          {(isAdmin || rmine) && <button style={S.miniDel} onClick={() => onDeleteReply(r.id)}><Trash2 size={11} /></button>}
        </div>
        <div style={{ fontSize: 14 }}>{r.text}</div>
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
function InviteModal({ group, onClose }) {
  const link = `${window.location.origin}${window.location.pathname}#join=${group.invite}`;
  const [copied, setCopied] = useState(false);
  return <Modal onClose={onClose} title="Invite people">
    <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 14px" }}><QRCodeView text={link} size={200} /></div>
    <p style={{ ...S.muted, textAlign: "center" }}>Scan to join, or share the link below.</p>
    <div style={S.linkBox}><Link2 size={16} style={{ flexShrink: 0 }} /><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{link}</span><button style={S.iconBtn} onClick={async () => { await copyText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check size={16} color="#2dd4bf" /> : <Copy size={16} />}</button></div>
    <p style={{ ...S.muted, textAlign: "center", marginTop: 10 }}>Invite code: <b>{group.invite}</b></p>
  </Modal>;
}

// ---------- admin ----------
function AdminModal({ session, group, isOwner, onClose, onChange, onDeleted }) {
  const members = Object.entries(group.members);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busyDel, setBusyDel] = useState(false);
  // owner-only permanent ban
  const banUser = async (targetKey) => {
    await api.post("/api/group/ban", { ownerKey: session.key, gid: group.id, targetKey });
    onChange();
  };
  // Both actions are validated server-side; the client can't just rewrite the group doc.
  // admin (non-permanent) remove: just drop membership (can rejoin)
  const removeUser = async (targetKey) => {
    if (targetKey === group.ownerKey) return;
    await api.post("/api/group/remove", { key: session.key, gid: group.id, targetKey });
    onChange();
  };
  const toggleAdmin = async (targetKey) => {
    await api.post("/api/group/toggleadmin", { key: session.key, gid: group.id, targetKey });
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
                const r = await api.post("/api/group/delete", { ownerKey: session.key, gid: group.id });
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
function fmtTime(ts) { const d = new Date(ts), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); }

const BG = "#0b0f14", PANEL = "#11171f", PANEL2 = "#161e28", LINE = "#1f2a36", TEXT = "#e8eef2", MUTED = "#7b8a96", ACCENT = "#2dd4bf";
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
  chatArea: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
  messages: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 },
  searchBar: { display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: `1px solid ${LINE}`, background: PANEL },
  searchInput: { flex: 1, background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 20, padding: "8px 14px", outline: "none", fontSize: 14, fontFamily: "inherit" },
  feed: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 },
  bubbleRow: { display: "flex" },
  bubble: { maxWidth: "80%", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 14, padding: "9px 12px", fontSize: 15, lineHeight: 1.4 },
  bubbleMine: { background: "#10302c", border: "1px solid #1b4d46" },
  bubbleHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 3, fontSize: 12 },
  time: { color: MUTED, fontSize: 11 },
  systemMsg: { alignSelf: "center", fontSize: 12, color: MUTED, background: PANEL2, borderRadius: 20, padding: "4px 12px", margin: "2px 0" },
  miniDel: { background: "transparent", border: "none", color: "#6b7a85", cursor: "pointer", padding: 2, display: "flex", marginLeft: "auto" },
  composer: { display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${LINE}`, background: PANEL, alignItems: "center" },
  composerInput: { flex: 1, background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 22, padding: "11px 16px", outline: "none", fontSize: 15, fontFamily: "inherit" },
  sendBtn: { background: ACCENT, color: "#04201d", border: "none", borderRadius: "50%", width: 42, height: 42, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  post: { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: 14 },
  postTitle: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, margin: "4px 0 6px" },
  replyToggle: { background: "transparent", border: "none", color: ACCENT, cursor: "pointer", fontSize: 13, marginTop: 10, padding: 0 },
  replyZone: { marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 },
  reply: { background: PANEL2, borderRadius: 10, padding: "7px 10px" },
  bottomBar: { display: "flex", gap: 10, padding: 14, borderTop: `1px solid ${LINE}`, background: PANEL },
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
