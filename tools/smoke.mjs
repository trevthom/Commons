// Commons API smoke test — no dependencies.
//
//   node server.js &            # or: freebuff-preview start
//   node tools/smoke.mjs http://localhost:8080
//
// Exercises the account/group lifecycle, the authenticated content endpoints
// (messages, posts, replies, pins, search), and the access guards. Exits
// non-zero if anything fails.
const BASE = process.argv[2] || "http://localhost:8080";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + JSON.stringify(extra) : ""}`); }
};

const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
};
const get = async (path) => {
  const r = await fetch(BASE + path);
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
};
// Create an account and return the { key, sessionId } credential pair.
const newAccount = async () => (await post("/api/account/create", {})).json;

(async () => {
  console.log(`\nCommons smoke test against ${BASE}\n`);

  // --- static shell ---
  const home = await fetch(BASE + "/");
  ok("GET / serves the app shell", home.status === 200 && (await home.text()).includes("<div id=\"root\">"));
  const js = await fetch(BASE + "/app.js");
  ok("GET /app.js serves javascript", js.status === 200 && (js.headers.get("content-type") || "").includes("javascript"));
  const missing = await fetch(BASE + "/does-not-exist.js");
  ok("missing asset 404s (not HTML)", missing.status === 404);

  // --- accounts ---
  const a = await post("/api/account/create", {});
  ok("create account returns a 16-char key", a.json && /^[A-Z0-9]{16}$/.test(a.json.key));
  const ownerKey = a.json.key, ownerSid = a.json.sessionId;

  const login = await post("/api/account/login", { key: ownerKey });
  ok("login rotates the session id", login.json && login.json.ok && login.json.sessionId !== ownerSid);
  const ownerSid2 = login.json.sessionId;
  const oldSession = await get(`/api/account/session?key=${ownerKey}&sessionId=${ownerSid}`);
  ok("the previous session is invalidated", oldSession.json && oldSession.json.valid === false);

  // --- group lifecycle (every mutation is session-validated) ---
  const noSess = await post("/api/group/create", { key: ownerKey, name: "No Session" });
  ok("a group cannot be created without the live session", noSess.json && noSess.json.ok === false);

  const create = await post("/api/group/create", { key: ownerKey, sessionId: ownerSid2, name: "Smoke Test" });
  ok("create group returns an owned group", create.json && create.json.ok && create.json.group.ownerKey === ownerKey);
  const gid = create.json.group.id, invite = create.json.group.invite;
  ok("a new group starts with no pins", Array.isArray(create.json.group.pins) && create.json.group.pins.length === 0);

  const named = await post("/api/group/claimname", { key: ownerKey, sessionId: ownerSid2, gid, username: "OwnerOne" });
  ok("owner claims a username", named.json && named.json.ok && named.json.group.members[ownerKey].username === "OwnerOne");

  const other = await newAccount();
  const memberKey = other.key, memberSid = other.sessionId;
  const joined = await post("/api/group/join", { key: memberKey, sessionId: memberSid, code: invite });
  ok("second account joins by invite code", joined.json && joined.json.ok && !!joined.json.group.members[memberKey]);
  const joinedNoSess = await post("/api/group/join", { key: memberKey, code: invite });
  ok("joining requires a session", joinedNoSess.json && joinedNoSess.json.ok === false);

  // --- invites: indefinite vs one-time ---
  const outsider = await newAccount();
  const outsiderKey = outsider.key, outsiderSid = outsider.sessionId;
  const deniedInvite = await post("/api/group/invite", { key: outsiderKey, sessionId: outsiderSid, gid });
  ok("a non-member cannot mint an invite", deniedInvite.json && deniedInvite.json.ok === false);

  const minted = await post("/api/group/invite", { key: ownerKey, sessionId: ownerSid2, gid });
  ok("a member can mint a one-time code", minted.json && minted.json.ok && typeof minted.json.code === "string" && minted.json.code.length >= 8);
  const onceCode = minted.json.code;
  ok("the one-time code differs from the indefinite one", onceCode !== invite);

  const onceJoin = await post("/api/group/join", { key: outsiderKey, sessionId: outsiderSid, code: onceCode });
  ok("the one-time code lets exactly one account in", onceJoin.json && onceJoin.json.ok && !!onceJoin.json.group.members[outsiderKey]);
  const spent = await get(`/api/get?key=${encodeURIComponent("group:" + gid)}`);
  ok("the one-time code is spent after that join", spent.json && spent.json.value.inviteOnce === null);

  const gateCrasher = await newAccount();
  const reuse = await post("/api/group/join", { key: gateCrasher.key, sessionId: gateCrasher.sessionId, code: onceCode });
  ok("a spent one-time code no longer works", reuse.json && reuse.json.error === "not-found");
  const reusableAgain = await post("/api/group/join", { key: gateCrasher.key, sessionId: gateCrasher.sessionId, code: invite });
  ok("the indefinite code keeps working", reusableAgain.json && reusableAgain.json.ok);

  // --- messages: write authentication ---
  const unauth = await post("/api/message/send", { key: memberKey, sessionId: "not-the-session", gid, text: "forged" });
  ok("a bogus session cannot post a message", unauth.json && unauth.json.ok === false && unauth.json.error === "auth");

  const stranger = await newAccount();
  const notMember = await post("/api/message/send", { key: stranger.key, sessionId: stranger.sessionId, gid, text: "hi" });
  ok("a non-member cannot post into the group", notMember.json && notMember.json.error === "not-member");

  const sent = await post("/api/message/send", {
    key: memberKey, sessionId: memberSid, gid, text: "hello 👋🔥",
    author: ownerKey, authorName: "spoofed", anon: false,
  });
  ok("a member can send a message", sent.json && sent.json.ok && !!sent.json.key);
  ok("the author is taken from the session, never the payload", sent.json.message.author === memberKey && sent.json.message.authorName === null, sent.json.message);
  ok("emoji survive the round trip", sent.json.message.text === "hello 👋🔥");

  const msgKey1 = sent.json.key;
  const second = await post("/api/message/send", { key: memberKey, sessionId: memberSid, gid, text: "second message" });
  const empty = await post("/api/message/send", { key: memberKey, sessionId: memberSid, gid, text: "   " });
  ok("empty messages are rejected", empty.json && empty.json.ok === false);

  const reply = await post("/api/message/send", { key: ownerKey, sessionId: ownerSid2, gid, text: "a reply", replyTo: { key: msgKey1 } });
  ok("a reply stores a server-derived pointer to the parent", reply.json && reply.json.ok && reply.json.message.replyTo && reply.json.message.replyTo.key === msgKey1, reply.json && reply.json.message && reply.json.message.replyTo);
  const badReply = await post("/api/message/send", { key: ownerKey, sessionId: ownerSid2, gid, text: "x", replyTo: { key: "msg:" + gid + ":general:0:nope" } });
  ok("a reply to a non-existent message is dropped", badReply.json.ok && !badReply.json.message.replyTo);

  // --- delta reads (mget?since) are what the client polls with ---
  const hist = await get(`/api/mget?prefix=${encodeURIComponent(`msg:${gid}:general:`)}`);
  const firstKey = hist.json.items[0][0], firstTs = hist.json.items[0][1].ts;
  const delta = await get(`/api/mget?prefix=${encodeURIComponent(`msg:${gid}:general:`)}&since=${firstTs}`);
  ok("mget?since returns only what is newer than the cursor",
    delta.json.items.every(([, v]) => v.ts > firstTs) && delta.json.items.length < hist.json.items.length && !delta.json.items.some(([k]) => k === firstKey),
    { all: hist.json.items.length, delta: delta.json.items.length });
  const nothingNew = await get(`/api/mget?prefix=${encodeURIComponent(`msg:${gid}:general:`)}&since=${hist.json.items[hist.json.items.length - 1][1].ts}`);
  ok("mget?since returns nothing when the cursor is at the newest message", nothingNew.json.items.length === 0);

  // --- reactions: authenticated toggle, carried by delta reads ---
  const strangerReact = await post("/api/message/react", { key: stranger.key, sessionId: stranger.sessionId, gid, msgKey: msgKey1, emoji: "👍" });
  ok("a non-member cannot react", strangerReact.json && strangerReact.json.error === "not-member");
  const badEmoji = await post("/api/message/react", { key: memberKey, sessionId: memberSid, gid, msgKey: msgKey1, emoji: "🚀" });
  ok("an emoji outside the palette is rejected", badEmoji.json && badEmoji.json.ok === false);
  const reacted = await post("/api/message/react", { key: ownerKey, sessionId: ownerSid2, gid, msgKey: msgKey1, emoji: "🔥" });
  ok("a member can react to a message", reacted.json && reacted.json.ok && (reacted.json.message.reactions["🔥"] || []).includes(ownerKey));
  const afterReact = await get(`/api/mget?prefix=${encodeURIComponent(`msg:${gid}:general:`)}&since=${reacted.json.message.ts}`);
  ok("a reacted (edited) message comes through a delta read", afterReact.json.items.some(([k]) => k === msgKey1));
  const unreacted = await post("/api/message/react", { key: ownerKey, sessionId: ownerSid2, gid, msgKey: msgKey1, emoji: "🔥" });
  ok("reacting again removes the reaction", unreacted.json && unreacted.json.ok && !(unreacted.json.message.reactions || {})["🔥"]);

  // --- search runs server-side over the whole history ---
  const search = await post("/api/message/search", { key: memberKey, sessionId: memberSid, gid, q: "🔥" });
  ok("search finds a message by emoji", search.json && search.json.ok && search.json.results.length === 1 && search.json.results[0].key === msgKey1);
  // Searches must reach back past newer messages to the very first one.
  const searchOld = await post("/api/message/search", { key: memberKey, sessionId: memberSid, gid, q: "hello" });
  ok("search reaches the first message in the history", searchOld.json && searchOld.json.ok && searchOld.json.results.some((r) => r.key === msgKey1));
  const searchAuth = await post("/api/message/search", { key: memberKey, sessionId: "nope", gid, q: "hello" });
  ok("search requires a session", searchAuth.json && searchAuth.json.ok === false);
  const searchOutsider = await post("/api/message/search", { key: stranger.key, sessionId: stranger.sessionId, gid, q: "hello" });
  ok("search requires membership", searchOutsider.json && searchOutsider.json.error === "not-member");

  // --- pins (admins only, newest first) ---
  const memberPin = await post("/api/group/pin", { key: memberKey, sessionId: memberSid, gid, msgKey: msgKey1 });
  ok("a plain member cannot pin", memberPin.json && memberPin.json.error === "not-admin");
  const pin1 = await post("/api/group/pin", { key: ownerKey, sessionId: ownerSid2, gid, msgKey: msgKey1 });
  ok("the admin can pin a message", pin1.json && pin1.json.ok && pin1.json.group.pins.length === 1);
  const pin2 = await post("/api/group/pin", { key: ownerKey, sessionId: ownerSid2, gid, msgKey: second.json.key });
  ok("pinning again prepends the newest pin", pin2.json && pin2.json.group.pins[0].key === second.json.key && pin2.json.group.pins.length === 2);
  const unpin = await post("/api/group/unpin", { key: ownerKey, sessionId: ownerSid2, gid, msgKey: second.json.key });
  ok("the admin can unpin", unpin.json && unpin.json.ok && unpin.json.group.pins.length === 1 && unpin.json.group.pins[0].key === msgKey1);
  const pinMissing = await post("/api/group/pin", { key: ownerKey, sessionId: ownerSid2, gid, msgKey: "msg:" + gid + ":general:0:nope" });
  ok("a missing message cannot be pinned", pinMissing.json && pinMissing.json.error === "not-found");

  // --- deletes are author/admin only ---
  const memberDelete = await post("/api/message/delete", { key: stranger.key, sessionId: stranger.sessionId, gid, msgKey: msgKey1 });
  ok("a non-member cannot delete", memberDelete.json && memberDelete.json.error === "not-member");
  const otherDelete = await post("/api/message/delete", { key: ownerKey, sessionId: ownerSid2, gid, msgKey: msgKey1 });
  ok("an admin can delete another member's message", otherDelete.json && otherDelete.json.ok);
  const pinGone = await get(`/api/get?key=${encodeURIComponent("group:" + gid)}`);
  ok("deleting a message also clears its pin", pinGone.json && pinGone.json.value.pins.length === 0);
  const ownDelete = await post("/api/message/delete", { key: memberKey, sessionId: memberSid, gid, msgKey: second.json.key });
  ok("the author can delete their own message", ownDelete.json && ownDelete.json.ok);

  // --- posts + replies are authenticated too ---
  const created = await post("/api/post/create", { key: memberKey, sessionId: memberSid, gid, title: "T", text: "a forum post", anon: false });
  ok("a member can create a post", created.json && created.json.ok && !!created.json.key);
  ok("the post author comes from the session", created.json.post.author === memberKey);
  const postKey = created.json.key;
  const replyAdded = await post("/api/post/reply", { key: ownerKey, sessionId: ownerSid2, gid, postKey, text: "nice", anon: false });
  ok("a member can reply to a post", replyAdded.json && replyAdded.json.ok && replyAdded.json.post.replies.length === 1);
  const replyId = replyAdded.json.post.replies[0].id;
  const strangerReplyDelete = await post("/api/post/deleteReply", { key: stranger.key, sessionId: stranger.sessionId, gid, postKey, replyId });
  ok("a non-member cannot delete a post reply", strangerReplyDelete.json && strangerReplyDelete.json.error === "not-member");
  // Reply deletion follows the message rule: its author, or a group admin.
  const replyAuthorDelete = await post("/api/post/deleteReply", { key: ownerKey, sessionId: ownerSid2, gid, postKey, replyId });
  ok("the reply's author can delete it", replyAuthorDelete.json && replyAuthorDelete.json.ok && replyAuthorDelete.json.post.replies.length === 0);
  const postDelete = await post("/api/post/delete", { key: memberKey, sessionId: memberSid, gid, postKey });
  ok("the author can delete their post", postDelete.json && postDelete.json.ok);

  // --- access guards ---
  const grabAccount = await get(`/api/get?key=${encodeURIComponent("account:" + ownerKey)}`);
  ok("account records are not readable via generic get", grabAccount.status === 403);
  const listAccounts = await get("/api/list?prefix=account:");
  ok("account keys are not listed", listAccounts.status === 200 && !(listAccounts.json.keys || []).some((k) => k === "account:" + ownerKey));
  const rawSet = await post("/api/set", { key: `msg:${gid}:general:1:forged`, value: { text: "forged", author: ownerKey } });
  ok("the raw key-write endpoint is gone", rawSet.status === 404);
  const rawDelete = await post("/api/delete", { key: `msg:${gid}:general:1:forged` });
  ok("the raw key-delete endpoint is gone", rawDelete.status === 404);
  const unknownApi = await get("/api/nope");
  ok("unknown /api routes 404 as JSON", unknownApi.status === 404);

  // --- authorization ---
  const selfPromote = await post("/api/group/toggleadmin", { key: memberKey, sessionId: memberSid, gid, targetKey: memberKey });
  ok("a plain member cannot grant themselves admin", selfPromote.json && selfPromote.json.ok === false);
  const badSessionAdmin = await post("/api/group/toggleadmin", { key: ownerKey, sessionId: "nope", gid, targetKey: memberKey });
  ok("a stale session cannot promote anyone", badSessionAdmin.json && badSessionAdmin.json.error === "auth");
  const memberRemove = await post("/api/group/remove", { key: memberKey, sessionId: memberSid, gid, targetKey: ownerKey });
  ok("a plain member cannot remove anyone", memberRemove.json && memberRemove.json.ok === false);
  const ownerPromote = await post("/api/group/toggleadmin", { key: ownerKey, sessionId: ownerSid2, gid, targetKey: memberKey });
  ok("the owner can promote a member to admin", ownerPromote.json && ownerPromote.json.ok && ownerPromote.json.group.admins.includes(memberKey));

  // --- removal + permanent ban ---
  const third = await newAccount();
  const thirdKey = third.key, thirdSid = third.sessionId;
  await post("/api/group/join", { key: thirdKey, sessionId: thirdSid, code: gid });
  const adminRemove = await post("/api/group/remove", { key: memberKey, sessionId: memberSid, gid, targetKey: thirdKey });
  ok("an admin can remove a member", adminRemove.json && adminRemove.json.ok && !adminRemove.json.group.members[thirdKey]);
  const rejoin = await post("/api/group/join", { key: thirdKey, sessionId: thirdSid, code: gid });
  ok("a removed member may rejoin", rejoin.json && rejoin.json.ok);
  const banned = await post("/api/group/ban", { key: ownerKey, sessionId: ownerSid2, gid, targetKey: thirdKey });
  ok("the owner can ban a member", banned.json && banned.json.ok && banned.json.group.banned.includes(thirdKey));
  const blocked = await post("/api/group/join", { key: thirdKey, sessionId: thirdSid, code: gid });
  ok("a banned member cannot rejoin", blocked.json && blocked.json.error === "banned");

  // --- group deletion cleans up content ---
  const del = await post("/api/group/delete", { key: ownerKey, sessionId: ownerSid2, gid });
  ok("the owner can delete the group", del.json && del.json.ok);
  const afterDelete = await get(`/api/mget?prefix=${encodeURIComponent(`msg:${gid}:`)}`);
  ok("deleting a group removes its messages", afterDelete.json && afterDelete.json.items.length === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("smoke test crashed:", e); process.exit(2); });
