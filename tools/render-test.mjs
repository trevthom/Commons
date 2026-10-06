// Renders the real page in jsdom and drives the sign-up flow, proving the
// shipped bundle mounts and talks to the server through the browser interface.
//
//   node server.js &            # or: freebuff-preview start
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
// jsdom ships no fetch; wire the page's relative calls to the real server.
dom.window.fetch = (input, init) => fetch(new URL(String(input), BASE), init);

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
const click = (label) => {
  const btn = [...document.querySelectorAll("button")].find((b) => !b.disabled && (b.textContent || "").includes(label));
  if (!btn) return false;
  btn.click();
  return true;
};

await sleep(3000);
console.log(`\nRender test against ${BASE}\n`);

check("React and ReactDOM loaded", typeof dom.window.React === "object" && typeof dom.window.ReactDOM === "object");
check("lucide icons loaded", typeof dom.window.lucide === "object");
check("app bundle defined CommunityChat", typeof dom.window.CommunityChat === "function");
check("the app mounted into #root", document.getElementById("root").childElementCount > 0);
check("the sign-in screen rendered", /Create a new account/.test(screen()));

// --- create an account through the UI ---
check("clicked 'Create a new account'", click("Create a new account"));
await sleep(800);
const keyScreen = screen();
check("the one-time key screen appeared", /Save this login key/.test(keyScreen));
const key = (keyScreen.match(/[A-Z0-9]{4}(?: [A-Z0-9]{4}){3}/) || [])[0];
check("a formatted login key is shown", !!key, keyScreen.slice(0, 120));

// --- continue into the signed-in home screen ---
check("clicked 'I saved it — continue'", click("I saved it — continue"));
await sleep(800);
const homeScreen = screen();
check("the home screen rendered", /Your communities/.test(homeScreen));
check("it starts with no communities", /No communities yet/.test(homeScreen));
check("a create-your-account control is present", /Create/.test(homeScreen));

check("no uncaught script errors", errors.length === 0);
if (errors.length) console.log("\njsdom errors:\n" + errors.join("\n"));

console.log(`\n${pass} passed, ${fail} failed\n`);
dom.window.close();
process.exit(fail ? 1 : 0);
