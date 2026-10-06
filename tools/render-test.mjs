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

// --- the Forum tab ---
setInput(inputByPlaceholder("Search messages"), "");
await sleep(200);
check("switched to the Forum tab", click("Forum"));
await sleep(300);
check("the forum renders its own composer", /New post/.test(screen()));
check("the forum copy says forum", /Share something with the forum/.test(screen()));

check("no uncaught script errors", errors.length === 0);
if (errors.length) console.log("\njsdom errors:\n" + errors.join("\n"));

console.log(`\n${pass} passed, ${fail} failed\n`);
dom.window.close();
process.exit(fail ? 1 : 0);
