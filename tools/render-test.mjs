// Renders the real page in jsdom and drives it, proving the shipped bundle
// mounts and talks to the server through the browser interface.
//
//   node server.js             # or: freebuff-preview start
//   node tools/render-test.mjs http://localhost:8080
import { JSDOM, VirtualConsole } from "jsdom";

const BASE = process.argv[2] || "http://localhost:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.message));

const dom = await JSDOM.fromURL(BASE + "/", {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { document } = dom.window;
// jsdom ships neither fetch nor scrollIntoView; wire them to real behaviour.
dom.window.fetch = (input, init) => fetch(new URL(String(input), BASE), init);
dom.window.Element.prototype.scrollIntoView = function () {};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`); }
};
// Text only — the app injects its stylesheet inside #root, which would otherwise
// pollute every assertion.
const screen = () => {
  const clone = document.getElementById("root").cloneNode(true);
  clone.querySelectorAll("style, script").forEach((n) => n.remove());
  return clone.textContent || "";
};
const buttons = (within) => [...(within || document).querySelectorAll("button")];
const click = (label, within) => {
  const btn = buttons(within).find((b) => !b.disabled && (b.textContent || "").includes(label));
  if (!btn) return false;
  btn.click();
  return true;
};
const modal = () => document.querySelector(".sheet");
const inputByPlaceholder = (p, within) =>
  [...(within || document).querySelectorAll("input, textarea")].find((i) => i.placeholder === p);
const setInput = (el, value) => {
  const proto = el.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
const titled = (t) => !!document.querySelector(`[title="${t}"]`);

await sleep(3000);
console.log(`\nRender test against ${BASE}\n`);

// --- shell + sign-in ---
check("React and ReactDOM loaded", typeof dom.window.React === "object" && typeof dom.window.ReactDOM === "object");
check("lucide icons loaded", typeof dom.window.lucide === "object");
check("app bundle defined CommunityChat", typeof dom.window.CommunityChat === "function");
check("the app mounted into #root", document.getElementById("root").childElementCount > 0);
check("the sign-in screen rendered", /Create a new account/.test(screen()));

check("clicked 'Create a new account'", click("Create a new account"));
await sleep(800);
const keyScreen = screen();
check("the one-time key screen appeared", /Save this login key/.test(keyScreen));
check("a formatted login key is shown", /[A-Z0-9]{4}(?: [A-Z0-9]{4}){3}/.test(keyScreen), keyScreen.slice(0, 120));

check("clicked 'I saved it — continue'", click("I saved it — continue"));
await sleep(800);
check("the home screen rendered", /Your communities/.test(screen()));

// --- create a community ---
check("clicked 'Create'", click("Create"));
await sleep(300);
check("the create-community modal is open", !!modal());
const nameInput = inputByPlaceholder("Oak Street Neighbors", modal());
check("the community-name field is present", !!nameInput);
setInput(nameInput, "Testville");
check("submitted the new community", click("Create", modal()));
await sleep(900);
check("the username picker appeared", /Pick your name/.test(screen()));

setInput(inputByPlaceholder("e.g. jordan_m"), "tester");
check("claimed a username", click("Join community"));
await sleep(900);
check("the group screen rendered", /Testville/.test(screen()));

// --- requested UI changes on the group screen ---
check("the second tab is labelled 'Forum'", /Forum/.test(screen()) && !/Neighborhood/.test(screen()));
check("the invite icon has hover text", titled("Invite people"));
check("the admin icon has hover text", titled("Manage members"));
check("the header anonymous toggle is gone", !titled("Posting anonymously by default") && !titled("Posting with your username"));
check("the per-message anonymous toggle remains", titled("Sending as tester"));
check("a search box is present", !!inputByPlaceholder("Search all messages"));

// --- invite codes: indefinite vs one-time ---
document.querySelector('[title="Invite people"]').click();
await sleep(300);
const inviteCode = (screen().match(/Invite code:\s*([a-z0-9]+)/) || [])[1];
check("the invite modal shows an indefinite code", !!inviteCode);
check("the indefinite link is described as reusable", /as many times as you like/.test(screen()));
check("switched to the one-time tab", click("One-time link"));
await sleep(200);
check("the one-time tab explains it works once", /works once/.test(screen()));
check("clicked Create one-time link", click("Create one-time link"));
await sleep(800);
const onceCode = (screen().match(/Invite code:\s*([a-z0-9]+)/) || [])[1];
check("a one-time code was generated", !!onceCode);
check("the one-time code differs from the indefinite code", !!onceCode && onceCode !== inviteCode);
document.querySelector(".sheet").querySelector("button").click();
await sleep(200);
check("the invite modal closed", !document.querySelector(".sheet"));

// --- search filters messages ---
const composer = inputByPlaceholder("Message the whole community…");
setInput(composer, "hello world");
composer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await sleep(600);
setInput(composer, "banana bread");
composer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await sleep(1600);
check("both messages were sent", /hello world/.test(screen()) && /banana bread/.test(screen()));

setInput(inputByPlaceholder("Search all messages"), "banana");
await sleep(600);
check("search lists the matching message", /banana bread/.test(screen()));
check("search shows only matches", !/hello world/.test(screen()));
check("search reports how many results it found", /1 result across the whole history/.test(screen()));
setInput(inputByPlaceholder("Search all messages"), "zzz-no-match");
await sleep(600);
check("an empty result explains itself", /No messages match/.test(screen()));

// --- emoji picker ---
setInput(inputByPlaceholder("Search all messages"), "");
await sleep(300);
document.querySelector('[title="Emoji"]').click();
await sleep(250);
check("the emoji picker opens", !!document.querySelector('[data-role="emoji-panel"]'));
const fireBtn = [...document.querySelectorAll("button")].find((b) => b.textContent === "🔥");
check("the palette renders emoji", !!fireBtn);
fireBtn.click();
await sleep(150);
const composerEmoji = inputByPlaceholder("Message the whole community…");
check("clicking an emoji appends it to the composer", (composerEmoji.value || "").includes("🔥"), composerEmoji.value);
setInput(composerEmoji, "emoji test 🔥");
composerEmoji.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await sleep(1500);
check("an emoji message was sent", /emoji test 🔥/.test(screen()));

// --- per-message menu ---
setInput(inputByPlaceholder("Search all messages"), "");
await sleep(200);
const optionsBtnFor = (text) => {
  for (const b of document.querySelectorAll('[title="Message options"]')) {
    const bubble = b.parentElement && b.parentElement.parentElement;
    if (bubble && (bubble.textContent || "").includes(text)) return b;
  }
  return null;
};
const previewFor = (text) => {
  for (const p of document.querySelectorAll('[data-role="reply-preview"]')) {
    const bubble = p.parentElement;
    if (bubble && (bubble.textContent || "").includes(text)) return p;
  }
  return null;
};
check("every message carries an options menu", document.querySelectorAll('[title="Message options"]').length >= 2);
const helloOpt = optionsBtnFor("hello world");
check("the options menu opens from a bubble", !!helloOpt);
helloOpt.click();
await sleep(150);
check("the menu offers Reply", /Reply/.test(screen()));
check("the menu hides Mute on your own message", !/Mute user/.test(screen()));
check("the menu offers Delete on your own message", /Delete message/.test(screen()));
check("no thread option before any replies exist", !/View message thread/.test(screen()));

// --- the open menu must not be covered by another message ---
// Every row animates in via `.reveal`, which makes each row its own stacking
// context and would trap the menu's z-index under the row below it. The row
// that hosts an open menu is lifted so later messages can never paint over it.
const menuNode = document.querySelector('[data-role="msg-menu"]');
check("the menu is present in the DOM", !!menuNode);
const menuRow = menuNode && menuNode.parentElement && menuNode.parentElement.parentElement;
check("the row carrying the open menu is lifted above its neighbours",
  !!menuRow && menuRow.style.position === "relative" && menuRow.style.zIndex === "40",
  menuRow ? `position=${menuRow.style.position} zIndex=${menuRow.style.zIndex}` : "no row");
const liftedRows = [...document.querySelectorAll('[title="Message options"]')]
  .map((b) => b.parentElement.parentElement.parentElement)
  .filter((row) => row && row.style.zIndex === "40");
check("only the open menu's row is lifted", liftedRows.length === 1 && liftedRows[0] === menuRow);
const coveredRows = [...document.querySelectorAll('[title="Message options"]')]
  .map((b) => b.parentElement.parentElement.parentElement)
  .filter((row) => row && row !== menuRow && row.style.zIndex);
check("no other message row competes with the menu", coveredRows.length === 0);

// --- reply chains ---
check("clicked Reply", click("Reply"));
await sleep(150);
check("closing the menu releases the lifted row",
  [...document.querySelectorAll('[title="Message options"]')]
    .every((b) => b.parentElement.parentElement.parentElement.style.zIndex !== "40"));
check("the reply banner names the parent author", /Replying to tester/.test(screen()));
setInput(inputByPlaceholder("Message the whole community…"), "replying to hello");
inputByPlaceholder("Message the whole community…").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await sleep(1500);
check("the reply was sent", /replying to hello/.test(screen()));
const preview = previewFor("replying to hello");
check("the reply previews the parent", !!preview && /tester/.test(preview.textContent) && /hello world/.test(preview.textContent));
// A reply is itself "part of a reply chain", so its menu offers the thread too.
optionsBtnFor("replying to hello").click();
await sleep(150);
check("a reply inside a chain also offers View message thread", /View message thread/.test(screen()));

// --- thread view ---
optionsBtnFor("hello world").click();
await sleep(150);
check("a message with replies offers View message thread", /View message thread/.test(screen()));
check("clicked View message thread", click("View message thread"));
await sleep(300);
const threadSheet = document.querySelector(".sheet");
check("the thread modal lists the chain", !!threadSheet && /Message thread/.test(threadSheet.textContent) && /ORIGINAL/.test(threadSheet.textContent) && /replying to hello/.test(threadSheet.textContent));
threadSheet.querySelector("button").click();
await sleep(200);
check("the thread modal closed", !document.querySelector(".sheet"));

// --- deleting a replied-to message ---
optionsBtnFor("hello world").click();
await sleep(150);
check("clicked Delete message", click("Delete message"));
await sleep(1500);
const deletedPreview = previewFor("replying to hello");
check("the reply preview now reads Deleted", !!deletedPreview && /Deleted/.test(deletedPreview.textContent));
check("the deleted message is gone", !/hello world/.test(screen()));

// --- a real second member, then muting them ---
const groupsRes = await (await fetch(BASE + "/api/mget?prefix=" + encodeURIComponent("group:"))).json();
const testGroup = groupsRes.items.map(([, v]) => v).find((g) => g.invite === inviteCode);
check("located the new community by its invite code", !!testGroup);
// Content writes are authenticated now, so Bob writes through the API with his
// own session rather than a raw key write.
const apiPost = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const bob = await apiPost("/api/account/create", {});
const bobJoin = await apiPost("/api/group/join", { key: bob.key, sessionId: bob.sessionId, code: testGroup.invite });
check("a second member joined the community", bobJoin.ok === true);
await apiPost("/api/group/claimname", { key: bob.key, sessionId: bob.sessionId, gid: testGroup.id, username: "bob" });
await apiPost("/api/message/send", { key: bob.key, sessionId: bob.sessionId, gid: testGroup.id, text: "from bob" });
await apiPost("/api/message/send", { key: bob.key, sessionId: bob.sessionId, gid: testGroup.id, text: "bob solo" });
await apiPost("/api/post/create", { key: bob.key, sessionId: bob.sessionId, gid: testGroup.id, text: "bob forum post" });
await sleep(3500);
check("the other member's message reached General", /from bob/.test(screen()));

// --- Telegram-style bubbles: width, alignment, exactly two colors ---
const bubbleFor = (text) => {
  for (const b of document.querySelectorAll("#root div")) {
    if (b.style.maxWidth === "92%" && (b.textContent || "").includes(text)) return b;
  }
  return null;
};
const myBubble = bubbleFor("banana bread");
const bobBubble = bubbleFor("from bob");
check("own and other bubbles both render", !!myBubble && !!bobBubble);
check("own messages sit to the right", myBubble.parentElement.style.justifyContent === "flex-end");
check("other members' messages sit to the left", bobBubble.parentElement.style.justifyContent === "flex-start");
check("own and other messages use different colors", !!myBubble.style.background && myBubble.style.background !== bobBubble.style.background, myBubble.style.background + " / " + bobBubble.style.background);
check("bubbles use most of the chat width", myBubble.style.maxWidth === "92%" && bobBubble.style.maxWidth === "92%");
const bubbles = [...document.querySelectorAll("#root div")].filter((d) => d.style.maxWidth === "92%");
const bubbleColors = new Set(bubbles.map((d) => d.style.background));
check("exactly two message colors exist", bubbleColors.size === 2, [...bubbleColors].join(", "));
const nameColors = new Set(bubbles.map((d) => d.querySelector("span") && d.querySelector("span").style.color));
check("sender names all share one color", nameColors.size === 1, [...nameColors].join(", "));

// --- the menu must never hang off the screen edge ---
// The menu is at least 178px wide, and a short left-aligned message leaves
// almost no room to its left. Anchoring it to the bubble's right edge would
// push it past the screen's left edge, so it anchors to whichever edge the
// bubble is aligned to and always grows inward.
const shortOther = optionsBtnFor("bob solo");
check("a short message from someone else has a menu", !!shortOther);
shortOther.click();
await sleep(150);
const shortMenu = document.querySelector('[data-role="msg-menu"]');
check("a short message's menu anchors to its left edge, not off-screen",
  !!shortMenu && shortMenu.style.left === "4px" && !shortMenu.style.right,
  shortMenu ? `left=${shortMenu.style.left} right=${shortMenu.style.right}` : "no menu");
shortOther.click(); // toggle it shut again
await sleep(150);

let anchoredOk = 0, anchoredBad = 0;
for (const b of document.querySelectorAll('[title="Message options"]')) {
  b.click();
  await sleep(120);
  const row = b.parentElement.parentElement.parentElement;
  const menu = document.querySelector('[data-role="msg-menu"]');
  const wantsRight = row.style.justifyContent === "flex-end";
  const ok = !!menu && (wantsRight
    ? menu.style.right === "4px" && !menu.style.left
    : menu.style.left === "4px" && !menu.style.right);
  ok ? anchoredOk++ : anchoredBad++;
  b.click(); // the same button toggles the menu shut again
  await sleep(120);
}
check("every menu anchors to the bubble's own edge", anchoredOk >= 4 && anchoredBad === 0, `${anchoredOk} ok, ${anchoredBad} wrong`);
check("no menu is left open after checking", !document.querySelector('[data-role="msg-menu"]'));

const bobOpt = optionsBtnFor("from bob");
check("the other member's message has a menu", !!bobOpt);
bobOpt.click();
await sleep(150);
check("the menu offers Mute user there", /Mute user/.test(screen()));
// The viewer is this community's admin; admins could already delete any message.
check("an admin still gets Delete on another member's message", /Delete message/.test(screen()));

// reply to the other member first, so their message is part of a chain
check("clicked Reply to the other member", click("Reply"));
await sleep(150);
setInput(inputByPlaceholder("Message the whole community…"), "reply to bob");
inputByPlaceholder("Message the whole community…").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
await sleep(1500);
check("the reply to the other member landed", /reply to bob/.test(screen()));
check("its preview names the other member", !!previewFor("reply to bob") && /bob/.test(previewFor("reply to bob").textContent));

// --- muting someone whose post is in a reply chain ---
optionsBtnFor("from bob").click();
await sleep(150);
check("clicked Mute user", click("Mute user"));
await sleep(400);
check("a muted author's un-replied message disappears", !/bob solo/.test(screen()));
check("the replied-to message stays behind a Muted placeholder", /Muted message/.test(screen()) && /Hidden because you muted this user/.test(screen()));
const mutedPreview = previewFor("reply to bob");
check("the reply preview reads Muted", !!mutedPreview && /Muted/.test(mutedPreview.textContent) && mutedPreview.getAttribute("data-muted") === "1");
mutedPreview.click();
await sleep(300);
check("tapping the preview reveals the muted message", /from bob/.test(screen()) && previewFor("reply to bob").getAttribute("data-muted") === "0");

// --- pinning (admins only, newest first, tap the bar to cycle) ---
optionsBtnFor("banana bread").click();
await sleep(150);
check("the admin's menu offers Pin message", /Pin message/.test(screen()));
check("clicked Pin message", click("Pin message"));
await sleep(800);
check("the pinned bar appears with the pin's preview", !!document.querySelector('[data-role="pin-bar"]') && /banana bread/.test(document.querySelector('[data-role="pin-bar"]').textContent));
optionsBtnFor("replying to hello").click();
await sleep(150);
check("clicked Pin message on a second message", click("Pin message"));
await sleep(1000);
const pinBar = () => document.querySelector('[data-role="pin-bar"]');
check("the bar reports it holds two pins", /1\/2/.test(pinBar().textContent), pinBar().textContent);
// The most recently pinned message is the one shown first.
check("it opens on the most recent pin", /replying to hello/.test(pinBar().textContent) && !/banana bread/.test(pinBar().textContent), pinBar().textContent);
const firstPinText = pinBar().textContent;
pinBar().click();
await sleep(400);
check("tapping the bar cycles to the next pin", /2\/2/.test(pinBar().textContent) && /banana bread/.test(pinBar().textContent) && pinBar().textContent !== firstPinText, pinBar().textContent);

// --- the Forum tab ---
check("switched to the Forum tab", click("Forum"));
await sleep(1200);
check("the forum renders its own composer", /New post/.test(screen()));
check("the muted author's post is hidden in the forum", !/bob forum post/.test(screen()));
const postsRes = await (await fetch(BASE + "/api/mget?prefix=" + encodeURIComponent("post:" + testGroup.id + ":"))).json();
check("(that post really exists server-side)", postsRes.items.some(([, v]) => v.text === "bob forum post"));
check("the forum copy says forum", /Share something with the forum/.test(screen()));

check("no uncaught script errors", errors.length === 0);
if (errors.length) console.log("\njsdom errors:\n" + errors.join("\n"));

console.log(`\n${pass} passed, ${fail} failed\n`);
dom.window.close();
process.exit(fail ? 1 : 0);
