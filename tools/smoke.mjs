// Commons API smoke test — no dependencies.
//
//   node server.js &            # or: freebuff-preview start
//   node tools/smoke.mjs http://localhost:8080
//
// Exercises the account/group lifecycle plus the access guards on the generic
// KV surface. Exits non-zero if anything fails.
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
  return { status: r.status, json, text: json ? "" : await r.text() };
};

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

  // --- group lifecycle ---
  const create = await post("/api/group/create", { key: ownerKey, name: "Smoke Test" });
  ok("create group returns an owned group", create.json && create.json.ok && create.json.group.ownerKey === ownerKey);
  const gid = create.json.group.id, invite = create.json.group.invite;

  const named = await post("/api/group/claimname", { key: ownerKey, gid, username: "OwnerOne" });
  ok("owner claims a username", named.json && named.json.ok && named.json.group.members[ownerKey].username === "OwnerOne");

  const other = await post("/api/account/create", {});
  const memberKey = other.json.key;
  const joined = await post("/api/group/join", { key: memberKey, code: invite });
  ok("second account joins by invite code", joined.json && joined.json.ok && !!joined.json.group.members[memberKey]);

  // --- messaging via generic KV + batch read ---
  const msgKey = `msg:${gid}:general:1:smoke`;
  const wrote = await post("/api/set", { key: msgKey, value: { id: "smoke", ts: 1, text: "hi", author: memberKey, gid } });
  ok("members can write message content", wrote.json && wrote.json.key === msgKey);
  const batch = await get(`/api/mget?prefix=${encodeURIComponent(`msg:${gid}:`)}`);
  ok("batch read returns the message", batch.json && batch.json.items.some(([k]) => k === msgKey));
  const postKey = `post:${gid}:1:smoke`;
  await post("/api/set", { key: postKey, value: { id: "p", ts: 2, text: "post", author: memberKey, gid } });

  // --- access guards ---
  const grabAccount = await get(`/api/get?key=${encodeURIComponent("account:" + ownerKey)}`);
  ok("account records are not readable via generic get", grabAccount.status === 403);
  const listAccounts = await get("/api/list?prefix=account:");
  ok("account keys are not listed", listAccounts.status === 200 && !(listAccounts.json.keys || []).some((k) => k === "account:" + ownerKey));
  const writeAccount = await post("/api/set", { key: "account:" + ownerKey, value: { sessionId: "pwn" } });
  ok("account records are not writable via generic set", writeAccount.status === 403);
  const writeGroup = await post("/api/set", { key: `group:${gid}`, value: { ownerKey: memberKey } });
  ok("group docs are not writable via generic set (no self-promotion)", writeGroup.status === 403);

  // --- authorization ---
  const selfPromote = await post("/api/group/toggleadmin", { key: memberKey, gid, targetKey: memberKey });
  ok("a plain member cannot grant themselves admin", selfPromote.json && selfPromote.json.ok === false);
  const memberRemove = await post("/api/group/remove", { key: memberKey, gid, targetKey: ownerKey });
  ok("a plain member cannot remove anyone", memberRemove.json && memberRemove.json.ok === false);
  const ownerPromote = await post("/api/group/toggleadmin", { key: ownerKey, gid, targetKey: memberKey });
  ok("the owner can promote a member to admin", ownerPromote.json && ownerPromote.json.ok && ownerPromote.json.group.admins.includes(memberKey));

  // --- removal + permanent ban ---
  const third = await post("/api/account/create", {});
  const thirdKey = third.json.key;
  await post("/api/group/join", { key: thirdKey, code: gid });
  const adminRemove = await post("/api/group/remove", { key: memberKey, gid, targetKey: thirdKey });
  ok("an admin can remove a member", adminRemove.json && adminRemove.json.ok && !adminRemove.json.group.members[thirdKey]);
  const rejoin = await post("/api/group/join", { key: thirdKey, code: gid });
  ok("a removed member may rejoin", rejoin.json && rejoin.json.ok);
  const banned = await post("/api/group/ban", { ownerKey, gid, targetKey: thirdKey });
  ok("the owner can ban a member", banned.json && banned.json.ok && banned.json.group.banned.includes(thirdKey));
  const blocked = await post("/api/group/join", { key: thirdKey, code: gid });
  ok("a banned member cannot rejoin", blocked.json && blocked.json.error === "banned");

  // --- group deletion cleans up content ---
  const del = await post("/api/group/delete", { ownerKey, gid });
  ok("the owner can delete the group", del.json && del.json.ok);
  const afterDelete = await get(`/api/mget?prefix=${encodeURIComponent(`msg:${gid}:`)}`);
  ok("deleting a group removes its messages", afterDelete.json && afterDelete.json.items.length === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("smoke test crashed:", e); process.exit(2); });
