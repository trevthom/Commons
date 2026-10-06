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
check("a message search box is present", !!inputByPlaceholder("Search messages"));

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

setInput(inputByPlaceholder("Search messages"), "banana");
await sleep(300);
check("search keeps the matching message", /banana bread/.test(screen()));
check("search hides non-matching messages", !/hello world/.test(screen()));
setInput(inputByPlaceholder("Search messages"), "zzz-no-match");
await sleep(300);
check("an empty result explains itself", /No messages match/.test(screen()));

// --- per-message menu ---
setInput(inputByPlaceholder("Search messages"), "");
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

// --- reply chains ---
check("clicked Reply", click("Reply"));
await sleep(150);
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
const putJSON = (k, value) => fetch(BASE + "/api/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, value }) });
const bob = await (await fetch(BASE + "/api/account/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
const bobJoin = await (await fetch(BASE + "/api/group/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: bob.key, code: testGroup.invite }) })).json();
check("a second member joined the community", bobJoin.ok === true);
const bts = Date.now();
await putJSON(`msg:${testGroup.id}:general:${bts}:bob`, { id: "bob-msg", ts: bts, text: "from bob", anon: false, author: bob.key, authorName: "bob", gid: testGroup.id });
await putJSON(`msg:${testGroup.id}:general:${bts + 1}:bobsolo`, { id: "bob-solo", ts: bts + 1, text: "bob solo", anon: false, author: bob.key, authorName: "bob", gid: testGroup.id });
await putJSON(`post:${testGroup.id}:${bts}:bob`, { id: "bob-post", ts: bts, text: "bob forum post", anon: false, author: bob.key, authorName: "bob", gid: testGroup.id, replies: [] });
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
