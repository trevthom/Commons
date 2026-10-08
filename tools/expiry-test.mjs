// Commons 30-day expiry test — no dependencies, starts its own server.
//
//   node tools/expiry-test.mjs
//
// Seeds a store with a chat message older than 30 days (with a picture file
// and a pin), a fresh message, an old and a fresh forum post, and a stray
// picture file no message refers to; starts server.js on that store; and
// checks what the start-up sweep deleted.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commons-expiry-"));
const imgDir = path.join(dir, "images"); fs.mkdirSync(imgDir);
const DAY = 86400000, now = Date.now();
const oldTs = now - 31 * DAY, newTs = now - 29 * DAY;
const oldKey = `msg:g1:general:${oldTs}:aaaa`, newKey = `msg:g1:general:${newTs}:bbbb`;
const postKey = `post:g1:${oldTs}:cccc`, newPostKey = `post:g1:${newTs}:dddd`;
const img = { id: "0123456789abcdef01234567", ext: "png", w: 1, h: 1 };
fs.writeFileSync(path.join(imgDir, `${img.id}.png`), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));
// A picture uploaded two hours ago that no message ever claimed.
const stray = path.join(imgDir, "fedcba9876543210fedcba98.png");
fs.writeFileSync(stray, "x");
fs.utimesSync(stray, new Date(now - 2 * 3600000), new Date(now - 2 * 3600000));
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({
  "group:g1": { id: "g1", name: "Old", createdAt: oldTs, ownerKey: "K", admins: [], members: { K: { username: "k" } }, usernames: {}, banned: [], pins: [{ key: oldKey, id: "aaaa", ts: oldTs }] },
  [oldKey]: { id: "aaaa", ts: oldTs, text: "old", author: "K", gid: "g1", image: img },
  [newKey]: { id: "bbbb", ts: newTs, text: "new", author: "K", gid: "g1" },
  [postKey]: { id: "cccc", ts: oldTs, title: "", text: "old post", author: "K", gid: "g1", replies: [] },
  [newPostKey]: { id: "dddd", ts: newTs, title: "", text: "new post", author: "K", gid: "g1", replies: [] },
}));

const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, [path.join(root, "server.js")], { env: { ...process.env, PORT: String(PORT), DATA_FILE: path.join(dir, "data.json"), IMAGE_DIR: imgDir }, stdio: "ignore" });
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
try {
  console.log("\nCommons expiry test\n");
  let items = null;
  for (let i = 0; i < 40 && !items; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { items = (await (await fetch(`http://localhost:${PORT}/api/mget?prefix=msg:g1:`)).json()).items; } catch {}
  }
  const keys = (items || []).map(([k]) => k);
  ok("a message older than 30 days is deleted", !keys.includes(oldKey));
  ok("a message younger than 30 days stays", keys.includes(newKey));
  ok("the old message's picture file is deleted", !fs.existsSync(path.join(imgDir, `${img.id}.png`)));
  const g = (await (await fetch(`http://localhost:${PORT}/api/get?key=group:g1`)).json()).value;
  ok("the old message's pin is removed", g && g.pins.length === 0);
  const posts = (await (await fetch(`http://localhost:${PORT}/api/mget?prefix=post:g1:`)).json()).items;
  ok("a forum post older than 30 days is deleted", !posts.some(([k]) => k === postKey));
  ok("a forum post younger than 30 days stays", posts.some(([k]) => k === newPostKey));
  ok("an unclaimed upload older than an hour is deleted", !fs.existsSync(stray));
} finally {
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
