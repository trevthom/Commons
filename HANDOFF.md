# HANDOFF — Commons

Everything a new contributor (human or LLM) needs to safely change this project.

## Stack reality check

This is **not** a Vite / React-SPA-with-a-bundler / Convex app. It is:

- a **zero-runtime-dependency Node HTTP server** (`server.js`, CommonJS, built-ins only), and
- a **vanilla static PWA** in `public/` that loads React from a *vendored* UMD
  build (`public/react.min.js`, `react-dom.min.js`) plus two small vendored libs
  (`lucide.js` icon shim, `qrcode.min.js`).

There is no framework router, no TypeScript, no npm runtime dependencies.
Any instructions elsewhere describing TanStack Start, Vite, Convex, or shadcn
**do not apply to this repository** — do not introduce them.

## Repo layout

| Path | Role |
| --- | --- |
| `server.js` | The whole backend: static file server + JSON API + JSON-file store. |
| `src/app.src.jsx` | **Source of truth for the UI.** JSX, one big file, no imports (reads globals `React` and `lucide`). |
| `public/app.js` | **Generated** from `src/app.src.jsx`. Never edit by hand. |
| `public/index.html` | App shell: loads the vendored libs then `app.js`, renders `window.CommunityChat`. |
| `public/sw.js` | Service worker (app-shell cache). |
| `public/*.min.js`, `lucide.js`, `qrcode.min.js` | Vendored libraries. Do not hand-edit. |
| `tools/smoke.mjs` | Dependency-free API test (needs a running server). |
| `tools/render-test.mjs` | Loads the real page in jsdom and drives the sign-up flow. |
| `data.json` | Runtime database. **Never commit** (gitignored). |

## Build & run

```bash
bun install          # dev deps only: esbuild (transpile) + jsdom (render test)
bun run build        # src/app.src.jsx  ->  public/app.js
bun run build:watch  # rebuild on save
node server.js       # run the app (PORT=8080 by default; PORT env overrides)
```

**Whenever you edit the UI you must edit `src/app.src.jsx` and then run
`bun run build`.** `public/app.js` is the artifact the browser actually loads,
and the service worker caches it — see below.

Verification (with a server running):

```bash
node tools/smoke.mjs http://localhost:8080      # API + access guards
node tools/render-test.mjs http://localhost:8080 # mounts the UI and signs up
```

On Freebuff, the managed preview runs `node server.js` on port 8080; start it
with `freebuff-preview start`.

## Data model (single JSON file, flat key/value)

`server.js` keeps one object in memory and persists it to `data.json`
(debounced + atomic temp-file rename; flushed on SIGINT/SIGTERM).

| Key pattern | Value |
| --- | --- |
| `account:<16-char key>` | `{ key, createdAt, sessionId }` — **the login credential itself** |
| `group:<id>` | `{ id, name, createdAt, ownerKey, admins[], members{key:{username,joinedAt,lastNameChange}}, usernames{lowercased→key}, banned[], invite }` |
| `msg:<gid>:general:<ts>:<uid>` | `{ id, ts, text, anon, author, authorName, gid }` (or `{ system:true, text }`) |
| `post:<gid>:<ts>:<uid>` | `{ id, ts, title, text, anon, author, authorName, gid, replies[] }` |

Accounts are anonymous login keys; there is no email/password and no recovery.
Logging in rotates `sessionId`, which invalidates other devices.

## API reference (`server.js`)

Accounts / sessions:

- `POST /api/account/create` → `{ key, sessionId }`
- `POST /api/account/login` `{ key }` → `{ ok, sessionId }` (rotates session)
- `GET  /api/account/session?key&sessionId` → `{ valid }` (polled every 4s)

Groups:

- `POST /api/group/create` `{ key, name }` → `{ ok, group }`
- `POST /api/group/join` `{ key, code }` (code = group id or invite) → `{ ok, group }`
- `POST /api/group/claimname` `{ key, gid, username }` → first claim wins; renames have a 60-day cooldown
- `POST /api/group/remove` `{ key, gid, targetKey }` — admin/owner; non-permanent (may rejoin)
- `POST /api/group/toggleadmin` `{ key, gid, targetKey }` — **owner only**
- `POST /api/group/ban` `{ ownerKey, gid, targetKey }` — owner only; permanent
- `POST /api/group/delete` `{ ownerKey, gid }` — owner only; also deletes the group's `msg:`/`post:` keys

Generic content KV (messages and posts only):

- `GET  /api/get?key=` → `{ key, value }` or `null`
- `GET  /api/mget?prefix=` → `{ prefix, items: [[key, value], …] }` (batch read, used by all polling)
- `POST /api/set` `{ key, value }` — **only keys starting with `msg:` or `post:`**
- `POST /api/delete` `{ key }` — same restriction
- `GET  /api/list?prefix=` → `{ keys }`

### Access rules (important — do not weaken)

- `account:*` keys are **invisible and unwritable** through the generic KV
  endpoints (`/api/get`, `/api/mget`, `/api/list`, `/api/set`, `/api/delete`).
  Removing this guard would let anyone enumerate every login key and take over
  every account.
- `group:*` documents are **readable** through the KV endpoints (the client
  reads them directly) but **not writable** — all group mutations go through
  the validated `/api/group/*` endpoints. This prevents self-promotion to admin
  and un-banning via a raw `/api/set`.
- Static responses 404 for missing assets (`/foo.js`) instead of falling back to
  `index.html`.

## Client notes

- `src/app.src.jsx` reads `React` and `lucide` as **globals** and ends with
  `window.CommunityChat = CommunityChat`. Keep it that way; it is not a module.
- All reads that need many values use `/api/mget` (one request per poll instead
  of 1 + N).
- Polling intervals: session 4s, group 3s, messages 2.5s, posts 3s.
- `api.get/post` return `null` on any failure, so callers can `if (r && r.ok)`.
- Anonymity is per-community and per-message; anonymous labels are derived from
  `author + gid` (`anonLabel`), so they are stable within a community.
- After changing any file in `public/`, **bump `CACHE` in `public/sw.js`**
  (`commons-v2` → `commons-v3`, …) so installed clients drop the old shell. The
  worker is network-first now, so the bump mainly guarantees eviction.

## Known issues / where to go next

1. **Message/post writes are unauthenticated.** The KV endpoints accept any
   `msg:`/`post:` key from anyone, so a determined user could forge or delete
   content (the UI only shows delete buttons to authors/admins, but the API
   doesn't enforce it). The correct fix is a `/api/message` endpoint that
   validates `{ key, sessionId }` server-side and sets `author` itself, then
   removing client writes. This is the top follow-up.
2. **`data.json` scalability.** Fine for dozens of users; move to SQLite beyond
   that. `/api/mget` scans every key in the store, and the whole store is held
   in memory.
3. **No rate limiting** on `/api/account/create`, `/api/account/login`, or
   `/api/group/join`.
4. **Group ids are short** (10 hex chars) and are accepted as join codes; only
   the invite code is meant to be shared. Consider requiring `invite` for joins.
5. **Polling** rather than SSE/WebSocket — acceptable at this scale, but the
   obvious scaling step.
6. `Access-Control-Allow-Origin: *` on the API. Harmless today because there are
   no cookies/credentials, but revisit if auth changes.

## Debugging checklist

- Blank page: confirm `bun run build` was run after editing the JSX, and check
  the browser console. `node tools/render-test.mjs` reproduces mount failures.
- "Did you forget to run convex dev?" or any Vite/TanStack error: wrong repo
  instructions — this project has none of that.
- Stale UI after a change: service worker cache — bump `CACHE` and hard-reload.
- Lost data: check for `data.json.corrupt-<ts>` next to `data.json`; a file that
  fails to parse is moved aside rather than overwritten.
