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
| `tools/render-test.mjs` | Loads the real page in jsdom and drives sign-up, community creation, invites, server-backed search, the Settings sheets and login key, the emoji picker, the growing message box, the message menu, editing, replies, pinning, muting, and the Forum tab. |
| `tools/expiry-test.mjs` | Starts its own server on a seeded store and checks the 30-day message expiry. |
| `data.json` | Runtime database. **Never commit** (gitignored). |
| `images/` | Picture files sent in chat (`IMAGE_DIR` env overrides). **Never commit** (gitignored). |

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
node tools/expiry-test.mjs                       # starts its own server; checks 30-day expiry
```

On Freebuff, the managed preview runs `node server.js` on port 8080; start it
with `freebuff-preview start`.

## Data model (single JSON file, flat key/value)

`server.js` keeps one object in memory and persists it to `data.json`
(debounced + atomic temp-file rename; flushed on SIGINT/SIGTERM).

| Key pattern | Value |
| --- | --- |
| `account:<16-char key>` | `{ key, createdAt, sessionId }` — **the login credential itself** |
| `group:<id>` | `{ id, name, createdAt, ownerKey, admins[], members{key:{username,joinedAt,lastNameChange}}, usernames{lowercased→key}, banned[], invite, inviteOnce, pins[] }` |
| `msg:<gid>:general:<ts>:<uid>` | `{ id, ts, text, anon, author, authorName, gid, replyTo?, image?, reactions?, editedAt?, updatedAt? }` (or `{ system:true, text }`) |
| `post:<gid>:<ts>:<uid>` | `{ id, ts, title, text, anon, author, authorName, gid, replies[] }` |

Accounts are anonymous login keys; there is no email/password and no recovery.
Logging in rotates `sessionId`, which invalidates other devices.

Group invites come in two flavours: `invite` is the **indefinite** code (reusable
forever) and `inviteOnce` is a **single-use** code that `server.js` nulls out as
soon as one new member joins with it. `POST /api/group/invite` mints or rotates
`inviteOnce`, so at most one unused one-time code exists per community.

A message that replies to another carries
`replyTo: { key, id, ts, author, anon }`, all derived server-side from the
stored parent (a `replyTo` pointing at a key that doesn't exist in the group is
dropped). No display strings are stored, so the client renders the preview's
name and excerpt from the live parent — a parent that is gone shows `Deleted`,
and a renamed author's reply preview follows the new name.

`pins` is an array of `{ key, id, ts, author, anon, pinnedBy, pinnedAt }`,
newest first and capped at 20. Deleting a message also removes its pin.

## API reference (`server.js`)

Accounts / sessions:

- `POST /api/account/create` → `{ key, sessionId }`
- `POST /api/account/login` `{ key }` → `{ ok, sessionId }` (rotates session)
- `GET  /api/account/session?key&sessionId` → `{ valid }` (polled every 4s)

Groups — **every call must include the caller's `sessionId`**:

- `POST /api/group/create` `{ key, sessionId, name }` → `{ ok, group }`
- `POST /api/group/join` `{ key, sessionId, code }` (code = group id, reusable `invite`, or one-time `inviteOnce`) → `{ ok, group }`
- `POST /api/group/invite` `{ key, sessionId, gid }` — any member; mints/rotates `inviteOnce` (single use)
- `POST /api/group/claimname` `{ key, sessionId, gid, username }` → first claim wins; renames have a 60-day cooldown and append a server-written system notice
- `POST /api/group/remove` `{ key, sessionId, gid, targetKey }` — admin/owner; non-permanent (may rejoin)
- `POST /api/group/toggleadmin` `{ key, sessionId, gid, targetKey }` — **owner only**
- `POST /api/group/ban` `{ key, sessionId, gid, targetKey }` — owner only; permanent
- `POST /api/group/delete` `{ key, sessionId, gid }` — owner only; also deletes the group's `msg:`/`post:` keys
- `POST /api/group/pin` / `POST /api/group/unpin` `{ key, sessionId, gid, msgKey }` — **admin/owner only**

Content — authenticated; **the server sets `author`/`authorName` from the session**:

- `POST /api/message/send` `{ key, sessionId, gid, text, anon, replyTo? }` → `{ ok, key, message }`
- `POST /api/message/delete` `{ key, sessionId, gid, msgKey }` — author or admin
- `POST /api/message/send` may carry `image` (a data URL, up to 3 MB decoded) plus `imageW`/`imageH`; `text` may then be empty. The server keeps only real JPEG/PNG/WebP/GIF bytes (checked by magic number, never by the claimed type), writes the file to `images/<24-hex id>.<ext>`, and stores `image: { id, ext, w, h }` on the message. The picture is **never** stored in `data.json`, since every poll reads message records.
- `GET  /api/image/<id>.<ext>` → the picture file (`nosniff`, long private cache). The random id is the capability, like a group id. Deleting a message, deleting its group, or expiry deletes the file.
- `POST /api/message/edit` `{ key, sessionId, gid, msgKey, text }` → `{ ok, key, message }` — **author only** (admins may delete, never rewrite); replaces `text`, stamps `editedAt` and bumps `updatedAt`
- `POST /api/message/react` `{ key, sessionId, gid, msgKey, emoji }` → `{ ok, key, message }` — any member; sets the caller's one reaction (a different emoji replaces it, the same emoji removes it), only accepts the fixed `REACTIONS` set, and bumps `updatedAt`
- `POST /api/message/search` `{ key, sessionId, gid, q }` → `{ ok, results[], total }` — scans the whole history server-side
- `POST /api/post/create` `{ key, sessionId, gid, title, text, anon }` → `{ ok, key, post }`
- `POST /api/post/delete` `{ key, sessionId, gid, postKey }` — author or admin
- `POST /api/post/reply` `{ key, sessionId, gid, postKey, text, anon }`
- `POST /api/post/deleteReply` `{ key, sessionId, gid, postKey, replyId }` — reply author or admin

Reads — open; a group id or invite is the capability:

- `GET  /api/get?key=` → `{ key, value }` or `null`
- `GET  /api/mget?prefix=&since=<ms>` → `{ prefix, items: [[key, value], …] }`
  (batch read, used by all polling; `since` keeps only values whose newest stamp
  — `ts` or a later `updatedAt` edit — is newer, so an idle poll transfers almost
  nothing while reactions still arrive promptly. Values with neither stamp —
  group documents — are never filtered.)
- `GET  /api/list?prefix=` → `{ keys }`
- Any other `/api/…` path → JSON `404` (it must never fall through to the static handler)

### Access rules (important — do not weaken)

- **Every mutation requires `{ key, sessionId }`** and checks it with
  `sessionOk`. Because the session id rotates on each login, a leaked or
  guessed key alone cannot write.
- **The server owns `author`.** `/api/message/send`, `/api/post/create` and
  `/api/post/reply` ignore any identity in the payload and derive it from the
  session plus the group's member record.
- **There is no raw key-write endpoint.** `/api/set` and `/api/delete` were
  removed and unknown `/api/…` paths are JSON 404s. That closed the old hole
  where anyone could forge or delete `msg:`/`post:` content directly.
- `account:*` keys are **invisible** through the read endpoints (`/api/get`,
  `/api/mget`, `/api/list`). Removing this guard would let anyone enumerate
  every login key and take over every account.
- `group:*` documents are **readable** through the read endpoints (the client
  reads them directly) but **never writable** — all group changes go through
  `/api/group/*`, which check the session and the caller's role. This is what
  prevents self-promotion to admin, un-banning, and forge-pinning.
- Static responses 404 for missing assets (`/foo.js`) instead of falling back to
  `index.html`.

## Client notes

- `src/app.src.jsx` reads `React` and `lucide` as **globals** and ends with
  `window.CommunityChat = CommunityChat`. Keep it that way; it is not a module.
- All reads that need many values use `/api/mget` (one request per poll instead
  of 1 + N).
- Polling intervals: session 4s, group 3s, messages 2.5s, posts 3s.
- `api.get/post` return `null` on any failure, so callers can `if (r && r.ok)`.
- The login session lives in **`localStorage`** (`cc_session_v2`, through
  `loadSession`/`saveSession`/`clearSession`), so an installed PWA or a closed
  tab reopens straight into the account and every tab of a browser shares one
  session. Only Log out clears it; the 4 s session poll adopts a newer session
  another tab saved, and a `storage` listener logs the other tabs out when one
  logs out.
- Reads go through a **shared room cache** (`roomCache`, `syncRoom`): the
  community list's poll warms a room's history before it is opened, so the room
  paints instantly, and the room's polls then ask the server only for messages
  newer than the newest one held (`since`), with a full refresh every 20 s to
  reconcile deletions. The delta cursor (`roomCursor`) is the newest `ts` or
  `updatedAt` in the cache, so a reaction on an old message is fetched too.
  `useItems` skips `setItems` when the list signature (`sigOf`: length +
  first/last key + a hash of `updatedAt`) is unchanged, so an idle room
  re-renders nothing. Sends/deletes/reactions update the cache immediately
  (`mutate`); the full reload that follows reconciles it with the server.
- Long rooms and forums mount only their newest slice (`WINDOW` = 150 messages,
  40 posts; `data-role="show-earlier"` reveals more), so opening a room never
  renders the whole history at once. Reply previews, threads and search still
  resolve against the full list.
- The group's second tab is the **Forum** (bulletin-board posts under `post:
  keys`); the first is **General** (chat under `msg:` keys).
- Anonymity is **per-message only**, via the eye button beside the composer. The
  per-community default toggle was intentionally removed. Anonymous labels are
  derived from `author + gid` (`anonLabel`), so they are stable within a
  community.
- General-chat search is **server-backed** (`messageSearch` → `/api/message/search`,
  150 ms debounce). While a query is active the message list is replaced by a
  results list; picking a result clears the query and jumps to the message.
  Bubbles carry `id={"msg-" + m.id}` so `scrollToId` can scroll to `#msg-<id>`
  and flash it (`S.bubbleFlash`).
- The pinned bar (`data-role="pin-bar"`) shows `pins[pinIdx]`; `pins[0]` is the
  newest, so it is what appears first. Tapping the bar advances the index
  (wrapping) and scrolls to that pin — one control cycles through them all.
  Admins toggle a pin from the ⋮ menu; the result arrives via `onGroupChange`
  (`reloadGroup`), so the bar updates immediately instead of waiting for the poll.
- The composer has an emoji palette (`EMOJI`, `data-role="emoji-panel"`). Emoji
  are ordinary text and travel the same authenticated send path.
- `auth(session, extra)` builds every authenticated payload — keep it the only
  way the client issues mutations.
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
  A tapped reveal lives in `revealed` and is **cleared whenever the mute list
  changes**, so unmuting someone and muting them again re-hides everything.
  Without that reset a stale reveal makes a re-muted author look unmuted —
  muted "not working" — so keep the `muteStamp` effect in `GeneralChat`.
- Read marks are **client-side only** too — `localStorage` key
  `cc_seen:<gid>:<meKey>` (`getSeen`/`markSeen`). A missing mark falls back to
  the viewer's `joinedAt`, so history from before they arrived is never unread.
  `Home` counts `!system && author !== me && ts > seen` per community and polls
  every 4 s; `excerptOf`/`previewOf` build the one-line "who: what" preview. The
  count renders as `S.badge` (`data-role="unread-badge"`) on the right of the
  community card.
- Opening a room lands on the **first unseen message**: `GeneralChat` freezes
  the read mark for the visit (`openSeen`), scrolls to the first message from
  someone else newer than it, flashes it, and exposes the anchor as
  `data-unread-anchor` on the feed. A room with **nothing unseen** (returning
  from the Forum, reopening a read room) instead sets `scrollTop` in a
  `useLayoutEffect` — the newest message, instantly, with no flash of the top.
- The read mark follows the newest message **only while the reader is at the
  bottom** (`atBottomRef`, kept in sync by the feed's `onScroll`, `jumpToBottom`
  and the opening layout effect) — watching the newest message is what marks it
  read, clears the anchor and clears the community unread badge. New messages
  auto-scroll only when the reader is already at the bottom. The floating arrow
  (`data-role="scroll-down"`, `S.scrollDown`, `showDown = !atBottom`) therefore
  disappears the moment the newest message is in view, including after scrolling
  down by hand.
- Every message ends with a Telegram-style timestamp in its bottom-right corner
  (`data-role="msg-stamp"`, `S.stamp`): `fmtStamp` formats the date and time in
  `America/New_York` and appends a literal `EST`, as requested. General bubbles,
  forum posts and their replies, thread items and search results all use it, and
  headers never repeat the time (`fmtTime` is gone).
- Reactions live on the message itself as `reactions: {"👍": [accountKey, …]}`;
  the UI renders counts only (and highlights the viewer's own), but the stored
  keys are exposed through the open read endpoints exactly like `author` already
  is — see known issue 1. The message menu opens with a quick bar of the
  first five (`QUICK_REACTIONS`) plus a ▼ in the sixth slot
  (`data-role="react-more"`) that expands the remaining fourteen
  (`data-role="react-more-panel"`, a 5-column grid). Each member has **one**
  reaction per message: picking another replaces it (the menu stays open, so
  the last pick wins) and picking the same one removes it; chips under the message `text`
  (`data-role="reaction"`, viewer's own highlighted) toggle on tap. The server
  accepts only the fixed `REACTIONS` list — keep it in sync with the copy in
  `src/app.src.jsx`.
- The community list card shows only the name, the newest-message preview and
  the unread badge — role is not shown there. Inside a room the header's centre
  reads the community name, the member count (`data-role="member-count"`) and
  `<username> ✎ · owner|admin`: the pencil sits immediately right of the
  username and the role to its right.
- Each header has one **Settings gear** (`title="Settings"`) at the top right,
  which opens `SettingsModal`. On "Your communities" it holds the login key and
  Log out. Inside a community it also holds Invite people and (admins only)
  Manage members, which open the existing `InviteModal` / `AdminModal`. The
  login key starts hidden (`data-role="login-key-text"` shows dots) with Show
  and Copy buttons.
- The message box (`Composer`) is a `<textarea rows=1>` that grows with its
  text up to `COMPOSER_ROWS` (6) lines, then scrolls; the text itself has no
  client limit (the server caps a message at 4000 characters). Enter sends,
  Shift+Enter adds a line. The row is bottom-aligned, so the icons and send
  button stay put while the box grows upward; the emoji panel opens above it.
  Message text renders with `S.msgText` (`white-space: pre-wrap`), so line
  breaks survive.
- **30-day expiry**: every chat message (system notices included) is deleted
  30 days after its `ts`, with its picture file and any pin. `sweepExpired` in
  `server.js` runs at start-up and hourly. Forum posts are **not** affected.
  The room shows this at the top of the feed (`data-role="retention-note"`).
- **Pictures**: the General composer (and the thread composer) has a picture
  button (`title="Send a picture"`, hidden `data-role="image-input"`).
  `prepareImage` shrinks the photo to at most 1600px and re-encodes it as JPEG
  on a canvas before sending; the text becomes an optional caption. The bubble
  shows `MsgImage` (`data-role="msg-image"`, sized from the stored `w`/`h` so
  the feed does not jump), and a tap opens `Lightbox` (`data-role="lightbox"`,
  fixed full-screen; a tap, the X or Escape closes it). Previews of a picture
  without a caption read "📷 Photo" (`msgExcerpt`).
- **Editing**: the author's message menu has "Edit message". It opens an
  "Editing message" banner (`data-role="edit-banner"`, which replaces any reply
  banner) and loads the text into the box; the send button becomes a check and
  the anonymity toggle is locked, since an edit keeps the original name. The
  `Stamp` component shows `edited · ` (`data-role="edited"`) before the time of
  any message with `editedAt`, in the room and in threads.
- Enter activates a screen's primary button. `onEnter(fn)` wraps the handler for
  the login key, the create-community name, the join code, the username picker
  and the change-username dialog; the handlers themselves guard on emptiness and
  `busy`, so Enter and the (disabled) button behave identically.
- General-chat bubbles are Telegram-style and deliberately use **exactly two
  message colors**: the viewer's own (`bubbleMine`, `#123f38`) and everybody
  else's (`bubble`, `PANEL2`). Own bubbles align right, others left, both at
  `maxWidth: 92%` with a small radius on the "tail" corner. Sender names all use
  the single `SENDER` color, and anonymity is signalled by the eye-off icon plus
  the "Anon …" label rather than by a different name color — keep it that way
  when touching bubble styles.
- The Invite modal has two tabs: **Indefinite link** (`group.invite`) and
  **One-time link** (`group.inviteOnce`, with a button to generate/rotate it).
- The per-message menu lives inside its own row, and each row animates in with
  `.reveal` — which makes every row its own stacking context. An open menu would
  therefore be painted over by the message below it. The row hosting an open
  menu gets `S.bubbleRowActive` (`position: relative; zIndex: 40`) so it stacks
  above its siblings; don't remove that or the menu gets covered again.
- The same menu is 178px wide and is positioned inside the bubble, so it must
  anchor to **the edge the bubble is aligned to**, not always its right edge: a
  short left-aligned message leaves almost no room to its left, and a
  right-anchored menu runs off the screen's left edge. That is `S.menuMine`
  (`right: 4`) for own bubbles and `S.menuTheirs` (`left: 4`) for other people's,
  so the menu always grows inward.
- `S.menuWrap` positions the whole menu (reaction bar + items). When there is
  not enough room below the bubble (`toggleMenu` measures against the feed),
  it gets `S.menuUp` (`top: auto; bottom: 24`) so the newest message's menu
  opens upward instead of being clipped by the feed's edge and covered by the
  composer.
- After changing any file in `public/`, **bump `CACHE` in `public/sw.js`**
  (currently `commons-v14`; go to `commons-v15`, …) so installed clients drop the
  old shell. The worker is network-first now, so the bump mainly guarantees
  eviction.

## Known issues / where to go next

1. **Reads are not access-controlled.** `/api/get`, `/api/mget` and `/api/list`
   hand out any `group:` document — and every `msg:`/`post:` value under a
   prefix — to anyone who knows or guesses a group id. Invites are meant to be
   the capability, but group ids are only 10 hex chars. Next step: require a
   session + group membership on reads, and/or lengthen group ids. (Writes are
   already authenticated — see the access rules above.)
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
- A mutation returning `{ ok: false, error: "auth" }`: the request carried a
  stale `sessionId`. Sessions rotate on every login, so build bodies with
  `auth(session, …)` and don't cache the session id anywhere else.
- Both test suites mint their own accounts (and therefore their own sessions),
  so they never touch `data.json` data that belongs to a real user.
- Lost data: check for `data.json.corrupt-<ts>` next to `data.json`; a file that
  fails to parse is moved aside rather than overwritten.
