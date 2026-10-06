const { useState, useEffect, useRef, useCallback } = React;
const {
  Users,
  MapPin,
  Shield,
  Send,
  Eye,
  EyeOff,
  Link2,
  QrCode,
  Search,
  X,
  Trash2,
  UserMinus,
  Crown,
  LogIn,
  Plus,
  Copy,
  Check,
  MessageSquare,
  ChevronLeft,
  Ban,
  Key,
  LogOut,
  MoreVertical,
  CornerUpLeft,
  Bell,
  BellOff,
  Smile,
  Pin,
  PinOff,
  ChevronDown
} = lucide;
const api = {
  async post(path, body) {
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      return await r.json();
    } catch {
      return null;
    }
  },
  async get(path) {
    try {
      const r = await fetch(path);
      return await r.json();
    } catch {
      return null;
    }
  }
};
const sget = async (k) => {
  const j = await api.get("/api/get?key=" + encodeURIComponent(k));
  return j ? j.value : null;
};
const slist = async (prefix) => {
  const j = await api.get("/api/list?prefix=" + encodeURIComponent(prefix));
  return j ? j.keys : [];
};
const auth = (s, extra) => ({ key: s.key, sessionId: s.sessionId, ...extra });
const messageSend = (s, gid, text, anon, replyTo) => api.post("/api/message/send", auth(s, { gid, text, anon, replyTo }));
const messageDelete = (s, gid, msgKey) => api.post("/api/message/delete", auth(s, { gid, msgKey }));
const messageSearch = (s, gid, q) => api.post("/api/message/search", auth(s, { gid, q }));
const postCreate = (s, gid, title, text, anon) => api.post("/api/post/create", auth(s, { gid, title, text, anon }));
const postDelete = (s, gid, postKey) => api.post("/api/post/delete", auth(s, { gid, postKey }));
const postReply = (s, gid, postKey, text, anon) => api.post("/api/post/reply", auth(s, { gid, postKey, text, anon }));
const postDeleteReply = (s, gid, postKey, replyId) => api.post("/api/post/deleteReply", auth(s, { gid, postKey, replyId }));
const setPin = (s, gid, msgKey, on) => api.post(on ? "/api/group/pin" : "/api/group/unpin", auth(s, { gid, msgKey }));
const slistValues = async (prefix) => {
  const j = await api.get("/api/mget?prefix=" + encodeURIComponent(prefix));
  if (!j || !j.items) return [];
  return j.items.map(([k, v]) => ({ ...v, _key: k }));
};
const SK = "cc_session_v2";
const loadSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem(SK)) || null;
  } catch {
    return null;
  }
};
const saveSession = (s) => {
  try {
    sessionStorage.setItem(SK, JSON.stringify(s));
  } catch {
  }
};
const clearSession = () => {
  try {
    sessionStorage.removeItem(SK);
  } catch {
  }
};
const uid = () => Math.random().toString(36).slice(2, 10);
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
const now = () => Date.now();
const groupKey = (id) => `group:${id}`;
const msgPrefix = (g) => `msg:${g}:general:`;
const postPrefix = (g) => `post:${g}:`;
const onEnter = (fn) => (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    fn();
  }
};
const ANON_NAMES = ["Maple", "Cedar", "Willow", "Birch", "Aspen", "Sage", "Fern", "Heron", "Otter", "Robin", "Wren", "Lark"];
const anonLabel = (seed) => {
  let h = 0;
  for (const c of String(seed)) h = h * 31 + c.charCodeAt(0) >>> 0;
  return "Anon " + ANON_NAMES[h % ANON_NAMES.length] + " " + (h % 90 + 10);
};
let _qrLibPromise = null;
function loadQRLib() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (_qrLibPromise) return _qrLibPromise;
  _qrLibPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "qrcode.min.js";
    s.onload = () => res(window.QRCode);
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return _qrLibPromise;
}
function QRCodeView({ text, size = 200 }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let c = false;
    loadQRLib().then((QR) => {
      if (c || !ref.current) return;
      ref.current.innerHTML = "";
      try {
        new QR(ref.current, { text, width: size, height: size, colorDark: "#0b0f14", colorLight: "#e8eef2", correctLevel: QR.CorrectLevel.M });
      } catch {
        setFailed(true);
      }
    }).catch(() => setFailed(true));
    return () => {
      c = true;
    };
  }, [text, size]);
  if (failed) return /* @__PURE__ */ React.createElement("div", { style: { width: size, fontSize: 12, color: "#7b8a96", textAlign: "center" } }, "QR unavailable \u2014 use the link below.");
  return /* @__PURE__ */ React.createElement("div", { ref, style: { borderRadius: 12, overflow: "hidden", lineHeight: 0 } });
}
function CommunityChat() {
  const [session, setSession] = useState(loadSession());
  const [view, setView] = useState("loading");
  const [group, setGroup] = useState(null);
  const [tab, setTab] = useState("general");
  const [pendingInvite, setPendingInvite] = useState(null);
  const [kicked, setKicked] = useState(false);
  const setSess = (s) => {
    if (s) {
      saveSession(s);
    } else {
      clearSession();
    }
    setSession(s);
  };
  useEffect(() => {
    const m = (window.location.hash || "").match(/join=([A-Za-z0-9_-]+)/);
    if (m) setPendingInvite(m[1]);
    const s = loadSession();
    setView(s ? "home" : "login");
  }, []);
  useEffect(() => {
    if (!session) return;
    let stop = false;
    const check = async () => {
      const r = await api.get(`/api/account/session?key=${encodeURIComponent(session.key)}&sessionId=${encodeURIComponent(session.sessionId)}`);
      if (!stop && r && r.valid === false) {
        setKicked(true);
        setSess(null);
        setGroup(null);
        setView("login");
      }
    };
    const t = setInterval(check, 4e3);
    check();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [session]);
  return /* @__PURE__ */ React.createElement("div", { style: S.root }, /* @__PURE__ */ React.createElement("style", null, CSS), view === "loading" && /* @__PURE__ */ React.createElement("div", { style: S.center }, /* @__PURE__ */ React.createElement("div", { className: "pulse", style: { fontSize: 40 } }, "\u25C7")), view === "login" && /* @__PURE__ */ React.createElement(Login, { kicked, clearKicked: () => setKicked(false), onAuthed: (s) => {
    setSess(s);
    setView("home");
  } }), view === "home" && session && /* @__PURE__ */ React.createElement(Home, { session, pendingInvite, clearInvite: () => setPendingInvite(null), onOpen: (g) => {
    setGroup(g);
    setTab("general");
    setView("app");
  }, onLogout: () => {
    setSess(null);
    setView("login");
  } }), view === "app" && group && session && /* @__PURE__ */ React.createElement(GroupApp, { session, group, setGroup, tab, setTab, onLeave: () => {
    setGroup(null);
    setView("home");
  }, onLogout: () => {
    setSess(null);
    setGroup(null);
    setView("login");
  } }));
}
function Login({ onAuthed, kicked, clearKicked }) {
  const [mode, setMode] = useState("choose");
  const [keyInput, setKeyInput] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [createdSession, setCreatedSession] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const create = async () => {
    setBusy(true);
    setErr("");
    const r = await api.post("/api/account/create", {});
    setBusy(false);
    if (r && r.key) {
      setCreatedKey(r.key);
      setCreatedSession({ key: r.key, sessionId: r.sessionId });
      setMode("created");
    } else setErr("Could not create account.");
  };
  const login = async () => {
    if (!keyInput.trim() || busy) return;
    setBusy(true);
    setErr("");
    const key = keyInput.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const r = await api.post("/api/account/login", { key });
    setBusy(false);
    if (r && r.ok) onAuthed({ key, sessionId: r.sessionId });
    else setErr("That login key isn't valid for this server.");
  };
  return /* @__PURE__ */ React.createElement("div", { style: S.center }, /* @__PURE__ */ React.createElement("div", { style: S.card, className: "reveal" }, /* @__PURE__ */ React.createElement("div", { style: S.brand }, "\u25C7 Commons"), /* @__PURE__ */ React.createElement("p", { style: S.sub }, "A space for communities."), kicked && /* @__PURE__ */ React.createElement("div", { style: S.warn }, "You were logged out because your account signed in on another device."), mode === "choose" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 8 }, disabled: busy, onClick: create }, /* @__PURE__ */ React.createElement(Key, { size: 18 }), " Create a new account"), /* @__PURE__ */ React.createElement("button", { style: { ...S.secondaryFull, marginTop: 10 }, onClick: () => {
    setMode("haveKey");
    clearKicked();
  } }, /* @__PURE__ */ React.createElement(LogIn, { size: 18 }), " I have a login key"), err && /* @__PURE__ */ React.createElement("div", { style: S.error }, err)), mode === "haveKey" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { style: S.label }, "Login key"), /* @__PURE__ */ React.createElement("input", { style: { ...S.input, fontFamily: "monospace", letterSpacing: 1 }, value: keyInput, onChange: (e) => setKeyInput(e.target.value), onKeyDown: onEnter(login), placeholder: "your 16-character key" }), err && /* @__PURE__ */ React.createElement("div", { style: S.error }, err), /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 14, opacity: keyInput.trim() ? 1 : 0.5 }, disabled: !keyInput.trim() || busy, onClick: login }, busy ? "Checking\u2026" : "Log in"), /* @__PURE__ */ React.createElement("button", { style: S.ghost, onClick: () => {
    setMode("choose");
    setErr("");
  } }, "Back")), mode === "created" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: S.warn }, "Save this login key. It's the only way back into your account, and it only works on ", /* @__PURE__ */ React.createElement("b", null, "this server"), ". We can't recover it."), /* @__PURE__ */ React.createElement("div", { style: S.keyBox }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "monospace", fontSize: 16, letterSpacing: 1, flex: 1, wordBreak: "break-all" } }, createdKey.replace(/(.{4})/g, "$1 ").trim()), /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, onClick: async () => {
    await copyText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  } }, copied ? /* @__PURE__ */ React.createElement(Check, { size: 16, color: "#2dd4bf" }) : /* @__PURE__ */ React.createElement(Copy, { size: 16 }))), /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 14 }, onClick: () => onAuthed(createdSession) }, "I saved it \u2014 continue"))));
}
function Home({ session, pendingInvite, clearInvite, onOpen, onLogout }) {
  const [groups, setGroups] = useState([]);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [newName, setNewName] = useState("");
  const [inbox, setInbox] = useState({});
  const refresh = useCallback(async () => {
    const all = await slistValues("group:");
    const gs = all.filter((g) => g && g.members && g.members[session.key] && !(g.banned || []).includes(session.key));
    gs.sort((a, b) => b.createdAt - a.createdAt);
    setGroups(gs);
    const next = {};
    await Promise.all(gs.map(async (g) => {
      const msgs = await slistValues(msgPrefix(g.id));
      msgs.sort((a, b) => a.ts - b.ts);
      const member = g.members[session.key];
      const seen = getSeen(g.id, session.key) || member && member.joinedAt || 0;
      const unread = msgs.filter((m) => !m.system && m.author !== session.key && m.ts > seen).length;
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      next[g.id] = { unread, preview: last ? previewOf(last, session.key) : "" };
    }));
    setInbox(next);
  }, [session.key]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4e3);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    if (pendingInvite) setJoining(true);
  }, [pendingInvite]);
  const createGroup = async () => {
    const name = newName.trim();
    if (!name) return;
    const r = await api.post("/api/group/create", { key: session.key, sessionId: session.sessionId, name });
    if (!r || !r.ok) return;
    setCreating(false);
    setNewName("");
    refresh();
    onOpen(r.group);
  };
  return /* @__PURE__ */ React.createElement("div", { style: S.screen }, /* @__PURE__ */ React.createElement("div", { style: S.appHeader }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontWeight: 700, fontSize: 18 } }, "Your communities"), /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Log out", onClick: onLogout }, /* @__PURE__ */ React.createElement(LogOut, { size: 18 }))), /* @__PURE__ */ React.createElement("div", { style: S.scroll }, groups.length === 0 && /* @__PURE__ */ React.createElement("div", { style: S.empty, className: "reveal" }, /* @__PURE__ */ React.createElement(Users, { size: 34, style: { opacity: 0.5 } }), /* @__PURE__ */ React.createElement("p", null, "No communities yet."), /* @__PURE__ */ React.createElement("p", { style: S.muted }, "Create one or join with an invite.")), groups.map((g) => {
    const me = g.members[session.key];
    const info = inbox[g.id] || {};
    return /* @__PURE__ */ React.createElement("button", { key: g.id, "data-role": "group-card", style: S.groupCard, className: "reveal", onClick: () => onOpen(g) }, /* @__PURE__ */ React.createElement("div", { style: S.groupAvatar }, g.name.slice(0, 1).toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, textAlign: "left" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600 } }, g.name), g.ownerKey === session.key ? /* @__PURE__ */ React.createElement(Crown, { size: 14, color: "#fbbf24" }) : (g.admins || []).includes(session.key) ? /* @__PURE__ */ React.createElement(Shield, { size: 13, color: "#7dd3fc" }) : null), /* @__PURE__ */ React.createElement("div", { style: { ...S.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, info.preview || `${Object.keys(g.members).length} member(s)${me && me.username ? " \xB7 " + me.username : " \xB7 pick a name"}`)), info.unread > 0 && /* @__PURE__ */ React.createElement("span", { "data-role": "unread-badge", style: S.badge }, info.unread > 99 ? "99+" : info.unread));
  })), /* @__PURE__ */ React.createElement("div", { style: S.bottomBar }, /* @__PURE__ */ React.createElement("button", { style: S.secondary, onClick: () => setJoining(true) }, /* @__PURE__ */ React.createElement(LogIn, { size: 18 }), " Join"), /* @__PURE__ */ React.createElement("button", { style: S.primary, onClick: () => setCreating(true) }, /* @__PURE__ */ React.createElement(Plus, { size: 18 }), " Create")), creating && /* @__PURE__ */ React.createElement(Modal, { onClose: () => setCreating(false), title: "Create community" }, /* @__PURE__ */ React.createElement("label", { style: S.label }, "Community name"), /* @__PURE__ */ React.createElement("input", { style: S.input, value: newName, onChange: (e) => setNewName(e.target.value), onKeyDown: onEnter(createGroup), placeholder: "Oak Street Neighbors", maxLength: 40 }), /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 16, opacity: newName.trim() ? 1 : 0.5 }, disabled: !newName.trim(), onClick: createGroup }, "Create")), joining && /* @__PURE__ */ React.createElement(JoinModal, { session, prefill: pendingInvite, onClose: () => {
    setJoining(false);
    clearInvite();
  }, onJoined: (g) => {
    setJoining(false);
    clearInvite();
    refresh();
    onOpen(g);
  } }));
}
function JoinModal({ session, prefill, onClose, onJoined }) {
  const [code, setCode] = useState(prefill || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const doJoin = async () => {
    const raw = code.trim();
    if (!raw || busy) return;
    setBusy(true);
    setErr("");
    const r = await api.post("/api/group/join", { key: session.key, sessionId: session.sessionId, code: raw });
    setBusy(false);
    if (r && r.ok) return onJoined(r.group);
    if (r && r.error === "banned") return setErr("You've been removed from this community and can't rejoin.");
    if (r && r.error === "not-found") return setErr("No community found for that code.");
    setErr("Could not join.");
  };
  return /* @__PURE__ */ React.createElement(Modal, { onClose, title: "Join community" }, /* @__PURE__ */ React.createElement("label", { style: S.label }, "Invite code or link"), /* @__PURE__ */ React.createElement("input", { style: S.input, value: code, onChange: (e) => {
    const v = e.target.value;
    const m = v.match(/join=([A-Za-z0-9_-]+)/);
    setCode(m ? m[1] : v);
  }, onKeyDown: onEnter(doJoin), placeholder: "paste invite link or code" }), err && /* @__PURE__ */ React.createElement("div", { style: S.error }, err), /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 16, opacity: code.trim() ? 1 : 0.5 }, disabled: !code.trim() || busy, onClick: doJoin }, busy ? "Joining\u2026" : "Join community"));
}
function GroupApp({ session, group, setGroup, tab, setTab, onLeave, onLogout }) {
  const [showInvite, setShowInvite] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [changingName, setChangingName] = useState(false);
  const me = group.members[session.key];
  const isOwner = group.ownerKey === session.key;
  const isAdmin = isOwner || (group.admins || []).includes(session.key);
  const needsName = !me || !me.username;
  const [mutes, toggleMute] = useMutes(group.id, session.key);
  const reloadGroup = useCallback(async () => {
    const g = await sget(groupKey(group.id));
    if (!g) return;
    if (!g.members[session.key] || (g.banned || []).includes(session.key)) {
      onLeave();
      return;
    }
    setGroup(g);
  }, [group.id, session.key, setGroup, onLeave]);
  useEffect(() => {
    const t = setInterval(reloadGroup, 3e3);
    return () => clearInterval(t);
  }, [reloadGroup]);
  if (needsName) return /* @__PURE__ */ React.createElement(UsernamePicker, { session, group, onSet: (g) => setGroup(g), onLeave });
  return /* @__PURE__ */ React.createElement("div", { style: S.screen }, /* @__PURE__ */ React.createElement("div", { style: S.appHeader }, /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Back to your communities", onClick: onLeave }, /* @__PURE__ */ React.createElement(ChevronLeft, { size: 20 })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700 } }, group.name), /* @__PURE__ */ React.createElement("button", { style: S.nameBtn, title: "Change your username", onClick: () => setChangingName(true) }, me.username, isOwner ? " \xB7 owner" : isAdmin ? " \xB7 admin" : "", " \u270E")), /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Invite people", onClick: () => setShowInvite(true) }, /* @__PURE__ */ React.createElement(QrCode, { size: 18 })), isAdmin && /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Manage members", onClick: () => setShowAdmin(true) }, /* @__PURE__ */ React.createElement(Shield, { size: 18 })), /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Log out", onClick: onLogout }, /* @__PURE__ */ React.createElement(LogOut, { size: 18 }))), /* @__PURE__ */ React.createElement("div", { style: S.tabs }, /* @__PURE__ */ React.createElement("button", { style: { ...S.tab, ...tab === "general" ? S.tabActive : {} }, onClick: () => setTab("general") }, /* @__PURE__ */ React.createElement(MessageSquare, { size: 16 }), " General"), /* @__PURE__ */ React.createElement("button", { style: { ...S.tab, ...tab === "forum" ? S.tabActive : {} }, onClick: () => setTab("forum") }, /* @__PURE__ */ React.createElement(MapPin, { size: 16 }), " Forum")), tab === "general" ? /* @__PURE__ */ React.createElement(GeneralChat, { session, group, me, isAdmin, mutes, onToggleMute: toggleMute, onGroupChange: reloadGroup }) : /* @__PURE__ */ React.createElement(Forum, { session, group, me, isAdmin, mutes }), showInvite && /* @__PURE__ */ React.createElement(InviteModal, { group, session, onClose: () => setShowInvite(false), onChange: reloadGroup }), showAdmin && isAdmin && /* @__PURE__ */ React.createElement(AdminModal, { session, group, isOwner, onClose: () => setShowAdmin(false), onChange: reloadGroup, onDeleted: onLeave }), changingName && /* @__PURE__ */ React.createElement(ChangeNameModal, { session, group, me, onClose: () => setChangingName(false), onChanged: (g) => {
    setGroup(g);
  } }));
}
function UsernamePicker({ session, group, onSet, onLeave }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr("");
    const r = await api.post("/api/group/claimname", { key: session.key, sessionId: session.sessionId, gid: group.id, username: name.trim() });
    setBusy(false);
    if (r && r.ok) return onSet(r.group);
    if (r && r.error === "taken") return setErr("That username is unavailable in this community.");
    if (r && r.error === "invalid") return setErr("Pick a name up to 24 characters.");
    setErr("Could not set username.");
  };
  return /* @__PURE__ */ React.createElement("div", { style: S.center }, /* @__PURE__ */ React.createElement("div", { style: S.card, className: "reveal" }, /* @__PURE__ */ React.createElement("div", { style: S.brand }, "Pick your name"), /* @__PURE__ */ React.createElement("p", { style: S.sub }, "Choose a username for ", /* @__PURE__ */ React.createElement("b", null, group.name), ". Once taken, it's reserved for you and no one else can use it."), /* @__PURE__ */ React.createElement("label", { style: S.label }, "Username"), /* @__PURE__ */ React.createElement("input", { style: S.input, value: name, onChange: (e) => setName(e.target.value), onKeyDown: onEnter(submit), placeholder: "e.g. jordan_m", maxLength: 24 }), err && /* @__PURE__ */ React.createElement("div", { style: S.error }, err), /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 14, opacity: name.trim() ? 1 : 0.5 }, disabled: !name.trim() || busy, onClick: submit }, busy ? "Checking\u2026" : "Join community"), /* @__PURE__ */ React.createElement("button", { style: S.ghost, onClick: onLeave }, "Back")));
}
function ChangeNameModal({ session, group, me, onClose, onChanged }) {
  const [name, setName] = useState(me.username || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr("");
    const r = await api.post("/api/group/claimname", { key: session.key, sessionId: session.sessionId, gid: group.id, username: name.trim() });
    setBusy(false);
    if (r && r.ok) {
      onChanged(r.group);
      onClose();
      return;
    }
    if (r && r.error === "taken") return setErr("That username is unavailable in this community.");
    if (r && r.error === "cooldown") return setErr(`You can change your name again in ${r.daysLeft} day(s).`);
    if (r && r.error === "invalid") return setErr("Pick a name up to 24 characters.");
    setErr("Could not change name.");
  };
  return /* @__PURE__ */ React.createElement(Modal, { onClose, title: "Change username" }, /* @__PURE__ */ React.createElement("p", { style: S.muted }, "You can change your name once every 60 days. Everyone will see a note that your name changed. Your old name stays reserved to you."), /* @__PURE__ */ React.createElement("label", { style: { ...S.label, marginTop: 12 } }, "New username"), /* @__PURE__ */ React.createElement("input", { style: S.input, value: name, onChange: (e) => setName(e.target.value), onKeyDown: onEnter(submit), maxLength: 24 }), err && /* @__PURE__ */ React.createElement("div", { style: S.error }, err), /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 14, opacity: name.trim() ? 1 : 0.5 }, disabled: !name.trim() || busy, onClick: submit }, busy ? "Saving\u2026" : "Save"));
}
function useItems(prefix, ms = 2500) {
  const [items, setItems] = useState([]);
  const load = useCallback(async () => {
    const all = await slistValues(prefix);
    all.sort((a, b) => a.ts - b.ts);
    setItems(all);
  }, [prefix]);
  useEffect(() => {
    load();
    const t = setInterval(load, ms);
    return () => clearInterval(t);
  }, [load, ms]);
  return [items, load];
}
const excerptOf = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 90);
const seenKey = (gid, meKey) => `cc_seen:${gid}:${meKey}`;
const getSeen = (gid, meKey) => {
  try {
    return Number(localStorage.getItem(seenKey(gid, meKey))) || 0;
  } catch {
    return 0;
  }
};
const markSeen = (gid, meKey, ts) => {
  try {
    localStorage.setItem(seenKey(gid, meKey), String(ts));
  } catch {
  }
};
function useMutes(gid, meKey) {
  const key = `cc_mutes:${gid}:${meKey}`;
  const [mutes, setMutes] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(mutes));
    } catch {
    }
  }, [key, mutes]);
  const toggle = useCallback((authorKey) => setMutes((prev) => prev.includes(authorKey) ? prev.filter((k) => k !== authorKey) : [...prev, authorKey]), []);
  return [mutes, toggle];
}
const EMOJI = ["\u{1F600}", "\u{1F604}", "\u{1F602}", "\u{1F979}", "\u{1F60A}", "\u{1F60D}", "\u{1F60E}", "\u{1F914}", "\u{1F605}", "\u{1F609}", "\u{1F643}", "\u{1F634}", "\u{1F622}", "\u{1F62D}", "\u{1F621}", "\u{1F92F}", "\u{1F44D}", "\u{1F44E}", "\u{1F44F}", "\u{1F64C}", "\u{1F64F}", "\u{1F4AA}", "\u{1F91D}", "\u{1F44B}", "\u270C\uFE0F", "\u{1F91E}", "\u2764\uFE0F", "\u{1F9E1}", "\u{1F49A}", "\u{1F499}", "\u{1F525}", "\u2728", "\u{1F389}", "\u{1F382}", "\u2615", "\u{1F355}", "\u26BD", "\u{1F3AE}", "\u{1F3B5}", "\u{1F4F7}", "\u2705", "\u274C", "\u26A0\uFE0F", "\u{1F3AF}", "\u{1F4A1}", "\u{1F680}", "\u{1F327}\uFE0F", "\u{1F31E}"];
function Composer({ me, onSend, placeholder }) {
  const [text, setText] = useState("");
  const [anonOverride, setAnonOverride] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef(null);
  const anon = !!anonOverride;
  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim(), anon);
    setText("");
    setEmojiOpen(false);
  };
  const addEmoji = (e) => {
    setText((t) => t + e);
    if (inputRef.current) inputRef.current.focus();
  };
  useEffect(() => {
    if (!emojiOpen) return;
    const close = () => setEmojiOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [emojiOpen]);
  return /* @__PURE__ */ React.createElement("div", { style: S.composer }, emojiOpen && /* @__PURE__ */ React.createElement("div", { "data-role": "emoji-panel", style: S.emojiPanel, onClick: (e) => e.stopPropagation() }, EMOJI.map((e) => /* @__PURE__ */ React.createElement("button", { key: e, style: S.emojiBtn, onClick: () => addEmoji(e) }, e))), /* @__PURE__ */ React.createElement("button", { style: { ...S.iconBtn, color: anon ? "#2dd4bf" : "#9fb0bd" }, title: anon ? "Sending anonymously" : "Sending as " + me.username, onClick: () => setAnonOverride(!anon) }, anon ? /* @__PURE__ */ React.createElement(EyeOff, { size: 20 }) : /* @__PURE__ */ React.createElement(Eye, { size: 20 })), /* @__PURE__ */ React.createElement("button", { style: { ...S.iconBtn, color: emojiOpen ? ACCENT : "#9fb0bd" }, title: "Emoji", onClick: (e) => {
    e.stopPropagation();
    setEmojiOpen((v) => !v);
  } }, /* @__PURE__ */ React.createElement(Smile, { size: 20 })), /* @__PURE__ */ React.createElement("input", { ref: inputRef, style: S.composerInput, value: text, placeholder, onChange: (e) => setText(e.target.value), onKeyDown: (e) => {
    if (e.key === "Enter") send();
  } }), /* @__PURE__ */ React.createElement("button", { style: S.sendBtn, onClick: send }, /* @__PURE__ */ React.createElement(Send, { size: 18 })));
}
const senderLabel = (m) => m.system ? null : m.anon ? anonLabel((m.author || "x") + (m.gid || "")) : m.authorName;
const previewOf = (m, meKey) => m.system ? m.text : `${m.author === meKey ? "You" : senderLabel(m) || "member"}: ${excerptOf(m.text)}`;
function GeneralChat({ session, group, me, isAdmin, mutes, onToggleMute, onGroupChange }) {
  const prefix = msgPrefix(group.id);
  const [items, reload] = useItems(prefix);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [threadRoot, setThreadRoot] = useState(null);
  const [revealed, setRevealed] = useState(() => /* @__PURE__ */ new Set());
  const [pinIdx, setPinIdx] = useState(0);
  const [highlight, setHighlight] = useState(null);
  const [jumpTo, setJumpTo] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [atBottom, setAtBottom] = useState(true);
  const endRef = useRef(null);
  const feedRef = useRef(null);
  const openedRef = useRef(false);
  const [openSeen] = useState(() => getSeen(group.id, session.key) || me && me.joinedAt || 0);
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
  const onFeedScroll = () => {
    const el = feedRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };
  const jumpToBottom = () => {
    setAnchor(null);
    setAtBottom(true);
    endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" });
  };
  const showDown = !!anchor || !atBottom;
  useEffect(() => {
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const muteStamp = (mutes || []).join("|");
  useEffect(() => {
    setRevealed(/* @__PURE__ */ new Set());
  }, [muteStamp]);
  const pins = group.pins || [];
  useEffect(() => {
    setPinIdx(0);
  }, [pins.length]);
  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) {
      setResults(null);
      return;
    }
    let dead = false;
    const t = setTimeout(async () => {
      const r = await messageSearch(session, group.id, trimmed);
      if (!dead) setResults(r && r.ok ? r.results : []);
    }, 150);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [trimmed, session.key, session.sessionId, group.id]);
  const flash = (id) => {
    setHighlight(id);
    setTimeout(() => setHighlight(null), 1800);
  };
  const scrollToId = (id) => {
    const el = document.getElementById("msg-" + id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      flash(id);
    }
  };
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
  const reveal = (k) => setRevealed((prev) => {
    const n = new Set(prev);
    n.add(k);
    return n;
  });
  const rootOf = (m) => {
    let cur = m;
    const seen = /* @__PURE__ */ new Set();
    while (cur && cur.replyTo && cur.replyTo.key) {
      const up = byKey.get(cur.replyTo.key);
      if (!up || seen.has(cur._key)) break;
      seen.add(cur._key);
      cur = up;
    }
    return cur;
  };
  const descendants = (key) => {
    const out = [];
    const seen = /* @__PURE__ */ new Set([key]);
    let frontier = [key];
    while (frontier.length) {
      const next = [];
      for (const fk of frontier) for (const m of items) {
        if (m.replyTo && m.replyTo.key === fk && !seen.has(m._key)) {
          seen.add(m._key);
          out.push(m);
          next.push(m._key);
        }
      }
      frontier = next;
    }
    return out;
  };
  const postMessage = async (text, anon, parent) => {
    await messageSend(session, group.id, text, anon, parent ? { key: parent._key } : null);
    reload();
  };
  const send = (text, anon) => {
    const parent = replyTo;
    setReplyTo(null);
    postMessage(text, anon, parent);
  };
  const del = async (m) => {
    await messageDelete(session, group.id, m._key);
    reload();
  };
  const togglePin = async (m) => {
    await setPin(session, group.id, m._key, !pins.some((p) => p.key === m._key));
    if (onGroupChange) onGroupChange();
  };
  const openThread = (m) => setThreadRoot(rootOf(m));
  const pinText = (pin) => {
    const m = byKey.get(pin.key);
    return m ? `${senderLabel(m)}: ${excerptOf(m.text)}` : "Deleted message";
  };
  return /* @__PURE__ */ React.createElement("div", { style: S.chatArea }, /* @__PURE__ */ React.createElement("div", { style: S.searchBar }, /* @__PURE__ */ React.createElement(Search, { size: 16, style: { color: "#7b8a96", flexShrink: 0 } }), /* @__PURE__ */ React.createElement("input", { style: S.searchInput, value: query, placeholder: "Search all messages", onChange: (e) => setQuery(e.target.value) }), query && /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Clear search", onClick: () => setQuery("") }, /* @__PURE__ */ React.createElement(X, { size: 16 }))), !trimmed && pins.length > 0 && /* @__PURE__ */ React.createElement("button", { "data-role": "pin-bar", style: S.pinBar, onClick: cyclePin, title: pins.length > 1 ? "Pinned messages \u2014 tap for the next" : "Pinned message" }, /* @__PURE__ */ React.createElement(Pin, { size: 15, style: { color: ACCENT, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, textAlign: "left" } }, /* @__PURE__ */ React.createElement("div", { style: S.pinBarLabel }, "Pinned message", pins.length > 1 ? ` ${pinIdx + 1}/${pins.length}` : ""), /* @__PURE__ */ React.createElement("div", { style: S.pinBarText }, pinText(pins[pinIdx] || pins[0])))), trimmed ? /* @__PURE__ */ React.createElement("div", { style: S.messages }, /* @__PURE__ */ React.createElement("div", { style: { ...S.muted, padding: "2px 4px" } }, results === null ? "Searching\u2026" : `${results.length} result${results.length === 1 ? "" : "s"} across the whole history`), results && results.map((r) => /* @__PURE__ */ React.createElement("button", { key: r.key, style: S.result, onClick: () => {
    setResults(null);
    setQuery("");
    setJumpTo(r.id);
  } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { style: { color: SENDER, fontWeight: 600, fontSize: 13 } }, r.anon ? anonLabel(r.author + group.id) : r.authorName || "member"), /* @__PURE__ */ React.createElement("span", { style: S.time }, fmtTime(r.ts))), /* @__PURE__ */ React.createElement("div", { style: S.resultText }, r.text))), results && results.length === 0 && /* @__PURE__ */ React.createElement("div", { style: S.empty }, /* @__PURE__ */ React.createElement("p", { style: S.muted }, "No messages match \u201C", trimmed, "\u201D."))) : /* @__PURE__ */ React.createElement("div", { ref: feedRef, onScroll: onFeedScroll, "data-role": "feed", "data-unread-anchor": anchor || void 0, style: S.messages }, items.length === 0 && /* @__PURE__ */ React.createElement("div", { style: S.empty }, /* @__PURE__ */ React.createElement("p", { style: S.muted }, "Be the first to say hello \u{1F44B}")), items.map((m) => {
    if (m.system) return /* @__PURE__ */ React.createElement("div", { key: m.id, id: "msg-" + m.id, style: S.systemMsg, className: "reveal" }, m.text);
    const mine = m.author === session.key;
    const isMuted = mutedSet.has(m.author);
    const inChain = references.has(m._key) || !!m.replyTo;
    const pinned = pins.some((p) => p.key === m._key);
    if (isMuted && !inChain) return null;
    if (isMuted && !revealed.has(m._key)) {
      return /* @__PURE__ */ React.createElement("div", { key: m.id, id: "msg-" + m.id, style: { ...S.bubbleRow, justifyContent: mine ? "flex-end" : "flex-start" }, className: "reveal" }, /* @__PURE__ */ React.createElement("div", { style: { ...S.bubble, ...mine ? S.bubbleMine : {}, ...S.mutedBubble, ...highlight === m.id ? S.bubbleFlash : {} } }, /* @__PURE__ */ React.createElement("div", { style: S.bubbleHead }, /* @__PURE__ */ React.createElement("span", { style: { color: MUTED, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 } }, /* @__PURE__ */ React.createElement(BellOff, { size: 11 }), " Muted message"), /* @__PURE__ */ React.createElement("button", { style: S.showBtn, title: "Show this message", onClick: () => reveal(m._key) }, "Show")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: MUTED, fontStyle: "italic" } }, "Hidden because you muted this user."), /* @__PURE__ */ React.createElement("div", { "data-role": "msg-stamp", style: S.stamp }, fmtStamp(m.ts))));
    }
    const root = rootOf(m);
    const hasThread = !!root && descendants(root._key).length > 0;
    return /* @__PURE__ */ React.createElement("div", { key: m.id, id: "msg-" + m.id, style: { ...S.bubbleRow, justifyContent: mine ? "flex-end" : "flex-start", ...menuFor === m.id ? S.bubbleRowActive : {} }, className: "reveal" }, /* @__PURE__ */ React.createElement("div", { style: { ...S.bubble, ...mine ? S.bubbleMine : {}, ...highlight === m.id ? S.bubbleFlash : {} } }, /* @__PURE__ */ React.createElement("div", { style: S.bubbleHead }, /* @__PURE__ */ React.createElement("span", { style: { color: SENDER, fontWeight: 600 } }, m.anon && /* @__PURE__ */ React.createElement(EyeOff, { size: 11, style: { verticalAlign: -1, marginRight: 3 } }), senderLabel(m)), pinned && /* @__PURE__ */ React.createElement(Pin, { size: 11, style: { color: ACCENT, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("button", { style: S.miniDel, title: "Message options", onClick: (e) => {
      e.stopPropagation();
      setMenuFor((v) => v === m.id ? null : m.id);
    } }, /* @__PURE__ */ React.createElement(MoreVertical, { size: 14 }))), menuFor === m.id && /* @__PURE__ */ React.createElement(
      MsgMenu,
      {
        mine,
        isAdmin,
        hasThread,
        muted: isMuted,
        pinned,
        onClose: () => setMenuFor(null),
        onReply: () => setReplyTo(m),
        onThread: () => openThread(m),
        onToggleMute: () => onToggleMute(m.author),
        onTogglePin: () => togglePin(m),
        onDelete: () => del(m)
      }
    ), m.replyTo && /* @__PURE__ */ React.createElement(ReplyPreview, { replyTo: m.replyTo, byKey, mutedSet, revealed, onReveal: reveal }), /* @__PURE__ */ React.createElement("div", null, m.text), /* @__PURE__ */ React.createElement("div", { "data-role": "msg-stamp", style: S.stamp }, fmtStamp(m.ts))));
  }), /* @__PURE__ */ React.createElement("div", { ref: endRef })), showDown && /* @__PURE__ */ React.createElement("button", { "data-role": "scroll-down", title: "Jump to the newest messages", style: S.scrollDown, onClick: jumpToBottom }, /* @__PURE__ */ React.createElement(ChevronDown, { size: 20 })), replyTo && /* @__PURE__ */ React.createElement("div", { style: S.replyBanner }, /* @__PURE__ */ React.createElement(CornerUpLeft, { size: 14, style: { flexShrink: 0, color: ACCENT } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: S.replyBannerName }, "Replying to ", senderLabel(replyTo) || "message"), /* @__PURE__ */ React.createElement("div", { style: S.replyBannerText }, excerptOf(replyTo.text))), /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Cancel reply", onClick: () => setReplyTo(null) }, /* @__PURE__ */ React.createElement(X, { size: 16 }))), /* @__PURE__ */ React.createElement(Composer, { me, onSend: send, placeholder: "Message the whole community\u2026" }), threadRoot && /* @__PURE__ */ React.createElement(ThreadModal, { root: threadRoot, items, byKey, me, onClose: () => setThreadRoot(null), onReply: (t, a) => postMessage(t, a, threadRoot) }));
}
function MsgMenu({ mine, isAdmin, hasThread, muted, pinned, onClose, onReply, onThread, onToggleMute, onTogglePin, onDelete }) {
  const item = (icon, label, onClick, danger) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: label,
      style: { ...S.menuItem, ...danger ? S.menuItemDanger : {} },
      onClick: (e) => {
        e.stopPropagation();
        onClose();
        onClick();
      }
    },
    icon,
    /* @__PURE__ */ React.createElement("span", null, label)
  );
  return /* @__PURE__ */ React.createElement("div", { "data-role": "msg-menu", style: { ...S.menu, ...mine ? S.menuMine : S.menuTheirs }, onClick: (e) => e.stopPropagation() }, item(/* @__PURE__ */ React.createElement(CornerUpLeft, { size: 15 }), "Reply", onReply), hasThread && item(/* @__PURE__ */ React.createElement(MessageSquare, { size: 15 }), "View message thread", onThread), isAdmin && item(pinned ? /* @__PURE__ */ React.createElement(PinOff, { size: 15 }) : /* @__PURE__ */ React.createElement(Pin, { size: 15 }), pinned ? "Unpin message" : "Pin message", onTogglePin), !mine && item(muted ? /* @__PURE__ */ React.createElement(BellOff, { size: 15 }) : /* @__PURE__ */ React.createElement(Bell, { size: 15 }), muted ? "Unmute user" : "Mute user", onToggleMute), (mine || isAdmin) && item(/* @__PURE__ */ React.createElement(Trash2, { size: 15 }), "Delete message", onDelete, true));
}
function ReplyPreview({ replyTo, byKey, mutedSet, revealed, onReveal }) {
  const parent = byKey.get(replyTo.key);
  const hiddenMuted = !!parent && mutedSet.has(parent.author) && !revealed.has(replyTo.key);
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      "data-role": "reply-preview",
      "data-muted": hiddenMuted ? "1" : "0",
      style: { ...S.replyPreview, ...hiddenMuted ? S.replyPreviewMuted : {} },
      onClick: hiddenMuted ? () => onReveal(replyTo.key) : void 0,
      title: hiddenMuted ? "Show the muted message" : void 0
    },
    /* @__PURE__ */ React.createElement(CornerUpLeft, { size: 13, style: { flexShrink: 0, marginTop: 1 } }),
    /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, !parent ? /* @__PURE__ */ React.createElement("div", { style: { ...S.replyPreviewName, color: MUTED, fontStyle: "italic" } }, "Deleted") : hiddenMuted ? /* @__PURE__ */ React.createElement("div", { style: { ...S.replyPreviewName, color: MUTED } }, "Muted \u2014 tap to show") : /* @__PURE__ */ React.createElement("div", { style: S.replyPreviewName }, senderLabel(parent)), parent && !hiddenMuted && /* @__PURE__ */ React.createElement("div", { style: S.replyPreviewText }, excerptOf(parent.text)))
  );
}
function ThreadModal({ root, items, byKey, me, onClose, onReply }) {
  const chain = [];
  const seen = /* @__PURE__ */ new Set([root._key]);
  let frontier = [root._key];
  while (frontier.length) {
    const next = [];
    for (const fk of frontier) for (const m of items) {
      if (m.replyTo && m.replyTo.key === fk && !seen.has(m._key)) {
        seen.add(m._key);
        chain.push(m);
        next.push(m._key);
      }
    }
    frontier = next;
  }
  const all = [root, ...chain].sort((a, b) => a.ts - b.ts);
  return /* @__PURE__ */ React.createElement(Modal, { onClose, title: "Message thread" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, maxHeight: "52vh", overflowY: "auto" } }, all.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: m.id, style: { ...S.reply, ...i === 0 ? S.threadRoot : {} } }, /* @__PURE__ */ React.createElement("div", { style: S.bubbleHead }, /* @__PURE__ */ React.createElement("span", { style: { color: SENDER, fontWeight: 600, fontSize: 12 } }, m.anon && /* @__PURE__ */ React.createElement(EyeOff, { size: 10, style: { verticalAlign: -1, marginRight: 3 } }), senderLabel(m)), /* @__PURE__ */ React.createElement("span", { style: S.time }, fmtTime(m.ts)), i === 0 && /* @__PURE__ */ React.createElement("span", { style: { ...S.pill, background: "#2dd4bf22", color: ACCENT, marginLeft: "auto" } }, "ORIGINAL")), m.replyTo && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: MUTED, marginBottom: 2 } }, "\u21A9 ", (() => {
    const par = byKey && byKey.get(m.replyTo.key);
    return par ? senderLabel(par) : "Deleted";
  })()), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14 } }, m.text)))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement(Composer, { me, onSend: (t, a) => onReply(t, a), placeholder: "Reply in this thread\u2026" })));
}
function Forum({ session, group, me, isAdmin, mutes }) {
  const prefix = postPrefix(group.id);
  const [items, reload] = useItems(prefix, 3e3);
  const [composing, setComposing] = useState(false);
  const post = async (title, body, anon) => {
    await postCreate(session, group.id, title, body, anon);
    reload();
  };
  const del = async (p) => {
    await postDelete(session, group.id, p._key);
    reload();
  };
  const addReply = async (p, text, anon) => {
    await postReply(session, group.id, p._key, text, anon);
    reload();
  };
  const delReply = async (p, rid) => {
    await postDeleteReply(session, group.id, p._key, rid);
    reload();
  };
  const mutedSet = new Set(mutes || []);
  const sorted = items.filter((p) => !mutedSet.has(p.author)).sort((a, b) => b.ts - a.ts);
  return /* @__PURE__ */ React.createElement("div", { style: S.chatArea }, /* @__PURE__ */ React.createElement("div", { style: S.feed }, sorted.length === 0 && /* @__PURE__ */ React.createElement("div", { style: S.empty }, /* @__PURE__ */ React.createElement(MapPin, { size: 28, style: { opacity: 0.5 } }), /* @__PURE__ */ React.createElement("p", { style: S.muted }, "No posts yet. Share something with the forum.")), sorted.map((p) => /* @__PURE__ */ React.createElement(PostCard, { key: p.id, post: p, session, me, isAdmin, onDelete: () => del(p), onReply: (t, a) => addReply(p, t, a), onDeleteReply: (rid) => delReply(p, rid) }))), /* @__PURE__ */ React.createElement("div", { style: S.composer }, /* @__PURE__ */ React.createElement("button", { style: S.primary, onClick: () => setComposing(true) }, /* @__PURE__ */ React.createElement(Plus, { size: 18 }), " New post")), composing && /* @__PURE__ */ React.createElement(PostComposer, { me, onClose: () => setComposing(false), onPost: (t, b, a) => {
    post(t, b, a);
    setComposing(false);
  } }));
}
function PostCard({ post, session, me, isAdmin, onDelete, onReply, onDeleteReply }) {
  const [open, setOpen] = useState(false);
  const mine = post.author === session.key;
  const replies = post.replies || [];
  return /* @__PURE__ */ React.createElement("div", { style: S.post, className: "reveal" }, /* @__PURE__ */ React.createElement("div", { style: S.bubbleHead }, /* @__PURE__ */ React.createElement("span", { style: { color: post.anon ? "#2dd4bf" : "#7dd3fc", fontWeight: 600 } }, post.anon && /* @__PURE__ */ React.createElement(EyeOff, { size: 11, style: { verticalAlign: -1, marginRight: 3 } }), senderLabel(post)), /* @__PURE__ */ React.createElement("span", { style: S.time }, fmtTime(post.ts)), (isAdmin || mine) && /* @__PURE__ */ React.createElement("button", { style: S.miniDel, onClick: onDelete }, /* @__PURE__ */ React.createElement(Trash2, { size: 12 }))), post.title && /* @__PURE__ */ React.createElement("div", { style: S.postTitle }, post.title), /* @__PURE__ */ React.createElement("div", { style: { color: "#cdd9e1" } }, post.text), /* @__PURE__ */ React.createElement("button", { style: S.replyToggle, onClick: () => setOpen((o) => !o) }, replies.length, " repl", replies.length === 1 ? "y" : "ies", " ", open ? "\u25B4" : "\u25BE"), open && /* @__PURE__ */ React.createElement("div", { style: S.replyZone }, replies.map((r) => {
    const rmine = r.author === session.key;
    return /* @__PURE__ */ React.createElement("div", { key: r.id, style: S.reply }, /* @__PURE__ */ React.createElement("div", { style: S.bubbleHead }, /* @__PURE__ */ React.createElement("span", { style: { color: r.anon ? "#2dd4bf" : "#7dd3fc", fontWeight: 600, fontSize: 12 } }, r.anon && /* @__PURE__ */ React.createElement(EyeOff, { size: 10, style: { verticalAlign: -1, marginRight: 3 } }), senderLabel(r)), /* @__PURE__ */ React.createElement("span", { style: S.time }, fmtTime(r.ts)), (isAdmin || rmine) && /* @__PURE__ */ React.createElement("button", { style: S.miniDel, onClick: () => onDeleteReply(r.id) }, /* @__PURE__ */ React.createElement(Trash2, { size: 11 }))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14 } }, r.text));
  }), /* @__PURE__ */ React.createElement(Composer, { me, onSend: (t, a) => onReply(t, a), placeholder: "Add a reply\u2026" })));
}
function PostComposer({ me, onClose, onPost }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonOverride, setAnonOverride] = useState(null);
  const anon = !!anonOverride;
  return /* @__PURE__ */ React.createElement(Modal, { onClose, title: "New forum post" }, /* @__PURE__ */ React.createElement("label", { style: S.label }, "Title (optional)"), /* @__PURE__ */ React.createElement("input", { style: S.input, value: title, onChange: (e) => setTitle(e.target.value), placeholder: "Lost cat, recommendation, alert\u2026", maxLength: 80 }), /* @__PURE__ */ React.createElement("label", { style: { ...S.label, marginTop: 10 } }, "What's happening?"), /* @__PURE__ */ React.createElement("textarea", { style: { ...S.input, minHeight: 90, resize: "vertical" }, value: body, onChange: (e) => setBody(e.target.value) }), /* @__PURE__ */ React.createElement("button", { style: { ...S.toggleRow, marginTop: 12 }, onClick: () => setAnonOverride(!anon) }, anon ? /* @__PURE__ */ React.createElement(EyeOff, { size: 16 }) : /* @__PURE__ */ React.createElement(Eye, { size: 16 }), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, textAlign: "left" } }, anon ? "Posting anonymously" : "Posting as " + me.username), /* @__PURE__ */ React.createElement("span", { style: { ...S.pill, background: anon ? "#2dd4bf22" : "#ffffff14", color: anon ? "#2dd4bf" : "#9fb0bd" } }, anon ? "ANON" : "NAMED")), /* @__PURE__ */ React.createElement("button", { style: { ...S.primary, marginTop: 14, opacity: body.trim() ? 1 : 0.5 }, disabled: !body.trim(), onClick: () => onPost(title.trim(), body.trim(), anon) }, "Post"));
}
function InviteModal({ group, session, onClose, onChange }) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const [mode, setMode] = useState("reusable");
  const [once, setOnce] = useState(group.inviteOnce || null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const copy = async (which, text) => {
    await copyText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  };
  const genOnce = async () => {
    setBusy(true);
    const r = await api.post("/api/group/invite", { key: session.key, sessionId: session.sessionId, gid: group.id });
    setBusy(false);
    if (r && r.ok) {
      setOnce(r.code);
      if (onChange) onChange();
    }
  };
  const reusableLink = `${base}#join=${group.invite}`;
  const onceLink = once ? `${base}#join=${once}` : "";
  const codeBlock = (which, link) => /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", margin: "8px 0 14px" } }, /* @__PURE__ */ React.createElement(QRCodeView, { text: link, size: 190 })), /* @__PURE__ */ React.createElement("div", { style: S.linkBox }, /* @__PURE__ */ React.createElement(Link2, { size: 16, style: { flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 } }, link), /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, title: "Copy link", onClick: () => copy(which, link) }, copied === which ? /* @__PURE__ */ React.createElement(Check, { size: 16, color: "#2dd4bf" }) : /* @__PURE__ */ React.createElement(Copy, { size: 16 }))));
  return /* @__PURE__ */ React.createElement(Modal, { onClose, title: "Invite people" }, /* @__PURE__ */ React.createElement("div", { style: S.segment }, /* @__PURE__ */ React.createElement("button", { style: { ...S.segBtn, ...mode === "reusable" ? S.segBtnActive : {} }, onClick: () => setMode("reusable") }, "Indefinite link"), /* @__PURE__ */ React.createElement("button", { style: { ...S.segBtn, ...mode === "once" ? S.segBtnActive : {} }, onClick: () => setMode("once") }, "One-time link")), mode === "reusable" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { style: { ...S.muted, textAlign: "center" } }, "Anyone with this link can join, as many times as you like."), codeBlock("reusable", reusableLink), /* @__PURE__ */ React.createElement("p", { style: { ...S.muted, textAlign: "center", marginTop: 10 } }, "Invite code: ", /* @__PURE__ */ React.createElement("b", null, group.invite))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { style: { ...S.muted, textAlign: "center" } }, "This link works ", /* @__PURE__ */ React.createElement("b", null, "once"), " \u2014 it stops working as soon as one person joins."), once ? /* @__PURE__ */ React.createElement(React.Fragment, null, codeBlock("once", onceLink), /* @__PURE__ */ React.createElement("p", { style: { ...S.muted, textAlign: "center", marginTop: 10 } }, "Invite code: ", /* @__PURE__ */ React.createElement("b", null, once))) : /* @__PURE__ */ React.createElement("div", { style: S.empty }, /* @__PURE__ */ React.createElement(QrCode, { size: 28, style: { opacity: 0.5 } }), /* @__PURE__ */ React.createElement("p", { style: S.muted }, "No one-time link yet.")), /* @__PURE__ */ React.createElement("button", { style: { ...S.secondaryFull, marginTop: 12 }, disabled: busy, onClick: genOnce }, /* @__PURE__ */ React.createElement(Plus, { size: 16 }), " ", busy ? "Creating\u2026" : once ? "Generate a new one-time link" : "Create one-time link")));
}
function AdminModal({ session, group, isOwner, onClose, onChange, onDeleted }) {
  const members = Object.entries(group.members);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busyDel, setBusyDel] = useState(false);
  const banUser = async (targetKey) => {
    await api.post("/api/group/ban", { key: session.key, sessionId: session.sessionId, gid: group.id, targetKey });
    onChange();
  };
  const removeUser = async (targetKey) => {
    if (targetKey === group.ownerKey) return;
    await api.post("/api/group/remove", { key: session.key, sessionId: session.sessionId, gid: group.id, targetKey });
    onChange();
  };
  const toggleAdmin = async (targetKey) => {
    await api.post("/api/group/toggleadmin", { key: session.key, sessionId: session.sessionId, gid: group.id, targetKey });
    onChange();
  };
  return /* @__PURE__ */ React.createElement(Modal, { onClose, title: "Manage members" }, /* @__PURE__ */ React.createElement("p", { style: S.muted }, "Admins can remove members & delete messages. ", isOwner ? "As owner, you can permanently ban." : "Only the owner can permanently ban."), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, display: "flex", flexDirection: "column", gap: 8 } }, members.map(([mKey, info]) => {
    const isAdm = (group.admins || []).includes(mKey);
    const isOwn = mKey === group.ownerKey;
    return /* @__PURE__ */ React.createElement("div", { key: mKey, style: S.memberRow }, /* @__PURE__ */ React.createElement("div", { style: S.groupAvatar }, (info.username || "?").slice(0, 1).toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600 } }, info.username || "(no name yet)", " ", mKey === session.key && "(you)"), /* @__PURE__ */ React.createElement("div", { style: S.muted }, isOwn ? "Owner" : isAdm ? "Admin" : "Member")), !isOwn && /* @__PURE__ */ React.createElement(React.Fragment, null, isOwner && /* @__PURE__ */ React.createElement("button", { style: S.miniBtn, title: "Toggle admin", onClick: () => toggleAdmin(mKey) }, /* @__PURE__ */ React.createElement(Crown, { size: 14, color: isAdm ? "#fbbf24" : "#6b7a85" })), /* @__PURE__ */ React.createElement("button", { style: S.miniBtn, title: "Remove (can rejoin)", onClick: () => removeUser(mKey) }, /* @__PURE__ */ React.createElement(UserMinus, { size: 14, color: "#f59e0b" })), isOwner && /* @__PURE__ */ React.createElement("button", { style: S.miniBtn, title: "Ban permanently", onClick: () => banUser(mKey) }, /* @__PURE__ */ React.createElement(Ban, { size: 14, color: "#f87171" }))));
  })), isOwner && /* @__PURE__ */ React.createElement("div", { style: S.dangerZone }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, color: "#f87171", marginBottom: 6 } }, "Danger zone"), !confirmDel ? /* @__PURE__ */ React.createElement("button", { style: S.dangerBtn, onClick: () => setConfirmDel(true) }, /* @__PURE__ */ React.createElement(Trash2, { size: 15 }), " Delete this community") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { style: { ...S.muted, marginBottom: 8 } }, "This permanently deletes ", /* @__PURE__ */ React.createElement("b", null, group.name), " and all its messages and posts for everyone. This can't be undone."), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("button", { style: { ...S.secondaryFull, flex: 1 }, disabled: busyDel, onClick: () => setConfirmDel(false) }, "Cancel"), /* @__PURE__ */ React.createElement("button", { style: { ...S.dangerBtn, flex: 1 }, disabled: busyDel, onClick: async () => {
    setBusyDel(true);
    const r = await api.post("/api/group/delete", { key: session.key, sessionId: session.sessionId, gid: group.id });
    setBusyDel(false);
    if (r && r.ok) {
      onClose();
      onDeleted();
    }
  } }, busyDel ? "Deleting\u2026" : "Yes, delete forever")))));
}
function Modal({ title, children, onClose }) {
  return /* @__PURE__ */ React.createElement("div", { style: S.modalWrap, onClick: onClose }, /* @__PURE__ */ React.createElement("div", { style: S.modal, className: "sheet", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: S.modalHead }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700 } }, title), /* @__PURE__ */ React.createElement("button", { style: S.iconBtn, onClick: onClose }, /* @__PURE__ */ React.createElement(X, { size: 18 }))), children));
}
function fmtTime(ts) {
  const d = new Date(ts), n = /* @__PURE__ */ new Date();
  return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtStamp(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return `${date} \xB7 ${time} EST`;
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
  time: { color: MUTED, fontSize: 11 },
  stamp: { fontSize: 10, color: MUTED, textAlign: "right", marginTop: 3, letterSpacing: 0.2 },
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
  mutedBubble: { borderStyle: "dashed", opacity: 0.92 },
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
  pinBarLabel: { fontSize: 10, fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: 0.6 },
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
  dangerBtn: { width: "100%", background: "#2a1518", color: "#f87171", border: "1px solid #5b2730", borderRadius: 12, padding: "12px", fontWeight: 700, cursor: "pointer", display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }
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
