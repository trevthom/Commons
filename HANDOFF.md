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
| `tools/render-test.mjs` | Loads the real page in jsdom and drives sign-up, community creation, invites, message search, the message menu, replies, muting, and the Forum tab. |
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
| `group:<id>` | `{ id, name, createdAt, ownerKey, admins[], members{key:{username,joinedAt,lastNameChange}}, usernames{lowercased→key}, banned[], invite, inviteOnce }` |
| `msg:<gid>:general:<ts>:<uid>` | `{ id, ts, text, anon, author, authorName, gid, replyTo? }` (or `{ system:true, text }`) |
| `post:<gid>:<ts>:<uid>` | `{ id, ts, title, text, anon, author, authorName, gid, replies[] }` |

Accounts are anonymous login keys; there is no email/password and no recovery.
Logging in rotates `sessionId`, which invalidates other devices.

Group invites come in two flavours: `invite` is the **indefinite** code (reusable
forever) and `inviteOnce` is a **single-use** code that `server.js` nulls out as
soon as one new member joins with it. `POST /api/group/invite` mints or rotates
`inviteOnce`, so at most one unused one-time code exists per community.

A message that replies to another carries
`replyTo: { key, id, ts, author, authorName, excerpt }`. The excerpt is captured
at send time, so the preview survives even if the parent is deleted — the client
detects that by looking for `replyTo.key` in the loaded messages and shows
`Deleted` instead.

## API reference (`server.js`)

Accounts / sessions:

- `POST /api/account/create` → `{ key, sessionId }`
- `POST /api/account/login` `{ key }` → `{ ok, sessionId }` (rotates session)
- `GET  /api/account/session?key&sessionId` → `{ valid }` (polled every 4s)

Groups:

- `POST /api/group/create` `{ key, name }` → `{ ok, group }`
- `POST /api/group/join` `{ key, code }` (code = group id, reusable `invite`, or one-time `inviteOnce`) → `{ ok, group }`
- `POST /api/group/invite` `{ key, gid }` — any member; mints/rotates `inviteOnce` (single use)
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
- The group's second tab is the **Forum** (bulletin-board posts under `post:
  keys`); the first is **General** (chat under `msg:` keys).
- Anonymity is **per-message only**, via the eye button beside the composer. The
  per-community default toggle was intentionally removed. Anonymous labels are
  derived from `author + gid` (`anonLabel`), so they are stable within a
  community.
- `GeneralChat` has client-side message search (`query`/`shown`); it filters the
  already-loaded messages, so no server support is needed.
- Every General bubble has a ⋮ menu (`MsgMenu`): **Reply**, **View message
  thread** (only when the message is part of a chain), **Mute/Unmute user**
  (hidden on your own messages), and **Delete message** (your own; admins keep
  the ability to delete any). Menu items close the menu before acting.
- Replies render a Telegram-style preview above the text (`ReplyPreview`), and
  `ThreadModal` shows the whole chain (root + every descendant) with a composer
  that replies to the root.
- Mutes are **client-side only** — `localStorage` key `cc_mutes:<gid>:<meKey>`
  read through `useMutes` in `GroupApp` and passed to `GeneralChat`/`Forum`. A
  muted author's forum posts are filtered out; their General messages are
  hidden too, unless they belong to a reply chain, in which case they stay as a
  collapsed "Muted message" the reader can reveal, and reply previews pointing
  at them read "Muted". Mutes do not follow the account to another browser.
- General-chat bubbles are Telegram-style and deliberately use **exactly two
  message colors**: the viewer's own (`bubbleMine`, `#123f38`) and everybody
  else's (`bubble`, `PANEL2`). Own bubbles align right, others left, both at
  `maxWidth: 92%` with a small radius on the "tail" corner. Sender names all use
  the single `SENDER` color, and anonymity is signalled by the eye-off icon plus
  the "Anon …" label rather than by a different name color — keep it that way
  when touching bubble styles.
- The Invite modal has two tabs: **Indefinite link** (`group.invite`) and
  **One-time link** (`group.inviteOnce`, with a button to generate/rotate it).
- After changing any file in `public/`, **bump `CACHE` in `public/sw.js`**
  (currently `commons-v5`; go to `commons-v6`, …) so installed clients drop the
  old shell. The worker is network-first now, so the bump mainly guarantees
  eviction.

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
   invite codes are meant to be shared. Consider requiring an invite to join.
   Also, one-time invites are a single slot (`inviteOnce`), so generating a new
   one invalidates the previous unused one; a per-creator list would fix that.
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
