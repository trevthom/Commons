# Commons

A small, self-hosted chat app for communities. Every community has a **General**
chat and a **Forum** for bulletin-board posts. Accounts are anonymous login
**keys** — no email, no password, no recovery. Everything runs on one Node
process with zero runtime dependencies and one JSON file for storage.

Open the app in a browser, or install it as a PWA on a phone.

## Features

**General chat**
- Telegram-style bubbles: your messages sit on the right in their own color,
  everyone else's on the left. 92% max width.
- A **⋮ menu** on every message: **Reply**, **View message thread** (once the
  message is part of a chain), **Pin/Unpin message** (admins), **Mute/Unmute
  user**, and **Delete message** (your own; admins can delete any).
- **Reply chains** — a reply shows who it answered plus a one-line preview of
  their message. If that message is deleted later the preview reads "Deleted".
- **Message threads** open the whole chain, with a composer that replies to the
  original.
- **Pinned messages** — admins can pin several. The bar at the top shows the
  most recent pin; tap it to scroll through the others (the counter reads
  "1/3", "2/3", …). Deleting a message removes its pin.
- **Search** — tap the magnifying glass beside the Settings gear. It runs on the
  server across the community's *entire* history, not just what your device has
  loaded. Results list the sender, time, and message; tapping a result jumps to
  it in the chat. The X closes the search bar.
- **Pictures** — the picture button beside the emoji button attaches a photo or
  GIF; type an optional caption and send. Photos are shrunk to 1600px and
  re-encoded as JPEG on your device (which also strips their location data);
  GIFs keep their animation. A picture starts uploading the moment you pick it,
  so pressing send is quick. Tap a picture to see it full screen.
- **GIFs from your keyboard** — the message box accepts GIFs and stickers from
  phone keyboards (such as Gboard's GIF button) and pasted pictures. They are
  attached like any picture. iPhone keyboards copy a GIF instead: paste it into
  the box.
- **Emoji picker** in the composer — emoji are ordinary text, so they send
  through the same path as any message.
- **Reactions** on any message: the ⋮ menu opens with 👍 👎 ❤️ 🔥 💯, and the ▼
  beside them expands the rest of the palette. Counts show under the message and
  tapping a reaction toggles yours.
- A room you have already read opens on its **newest message**; a room with
  unread ones opens on the first you missed, and the arrow back to the bottom
  disappears as soon as the newest message is in view.
- **Muting** hides that member's Forum posts and their General messages for
  *you*. If the muted person's message is part of a reply chain it stays
  collapsed behind a "Muted" placeholder you can tap to reveal.

**Forum**
- Posts with an optional title, plus threaded replies.
- Compose as yourself or anonymously, per post.

**Anonymity**
- Chosen **per message or post** with the eye button beside the composer.
- Anonymous labels ("Anon Cedar 42") **change every 24 hours**, at midnight
  Eastern time. Within one community and one day, the same person keeps the
  same label, so a conversation stays readable; the next day they get a new
  one, so their anonymous messages can't be linked across days. A message
  keeps the label of the day it was sent.

**Messages are deleted after 30 days**
- Every General chat message, picture and Forum post (with its replies) is
  deleted **30 days after it is sent**. The server checks every hour, so
  nothing lasts more than about an hour past its 30 days. There is no way to
  get a deleted message back.

**Moderation**
- Admins can remove members (who may rejoin), delete any message or post, and
  pin messages.
- The **owner** can also permanently ban someone — they can never rejoin — and
  delete the community with all its content.

## Accounts

- Tap **Create a new account** to get a one-time **login key** like
  `K7QF-2M9P-...`. Save it: it is the only way back in, it only works on the
  server that issued it, and there is no recovery.
- **I have a login key** signs you in on another device. Logging in
  **rotates your session and logs you out everywhere else** — one active
  session per account.
- Your session is remembered: closing the tab or quitting the installed app
  and reopening it takes you straight back in, and two tabs of the same browser
  share the session. Signing in with your key elsewhere, or the **Log out**
  button, is what ends it.

## Members

Inside a community, the community name and your username sit at the top left,
and the member count sits in the middle. Tap the member count to see everyone
in the community. The list shows the owner first, then the admins, then
everyone else, and marks the owner and admins.

## Usernames

- You choose a username **when you enter a community**. It's reserved to you
  permanently — nobody else can take it, even after you change yours.
- You can change it **once every 60 days**. Everyone in the community sees a
  notice that your name changed (the server writes that notice, so it can't be
  forged). Your old name stays reserved to you.

## Invites

The invite screen has two tabs:

| Type | Behaviour |
| --- | --- |
| **Indefinite link** | Works any number of times, forever. |
| **One-time link** | Works exactly once; it stops working the moment one person joins. Generate a fresh one whenever you need it. |

Each shows a QR code, a copyable link, and the raw code. A community has one
unused one-time code at a time — generating a new one replaces it.

## Security model

- **Writes are authenticated.** Posting a message, post, or reply — and
  deleting one — requires your account key **and** its current session id, sent
  to a validated endpoint (`/api/message/*`, `/api/post/*`, `/api/group/*`).
  The server sets the author itself, so text and identity can't be forged by
  crafting a request. There is no raw "write any key" endpoint any more.
- **Account records are unreachable** through the read API: login keys are never
  readable or listable, so nobody can enumerate accounts.
- **Group records are read-only** through the read API. All group changes
  (members, admins, bans, invites, pins, deletion) go through validated
  endpoints that check the session and your role.
- **Reads are open** to anyone who knows a group's id or invite — the invite is
  the capability. Treat an invite link like a key to the room.
- Anonymity hides your name from other members, not from the server: every
  message still records who wrote it for moderation.

## Run it

    node server.js

The terminal prints a `localhost` URL (this device) and a `192.168.x.x` URL you
can open on a phone on the same Wi-Fi. Data is stored in `data.json`.

Environment: `PORT=3000 node server.js` to change the port,
`DATA_FILE=/path/to/db.json node server.js` to relocate storage (useful with a
mounted disk). Pictures are stored as files in `images/` next to `server.js`;
`IMAGE_DIR=/path/to/images` moves them. Keep that folder between restarts, the
same as `data.json`.

## Develop the UI

`src/app.src.jsx` is the source of truth; `public/app.js` is the generated file
the browser actually loads.

    bun install          # esbuild + jsdom (dev only)
    bun run build        # regenerate public/app.js from src/app.src.jsx
    bun run build:watch  # rebuild on save

After changing anything in `public/`, bump `CACHE` in `public/sw.js` so
installed clients drop the old shell.

## Tests

With a server running:

    node tools/smoke.mjs http://localhost:8080       # API, auth, pins, search
    node tools/render-test.mjs http://localhost:8080 # loads the real page in jsdom and drives it
    node tools/expiry-test.mjs                       # starts its own server; checks the 30-day deletion

Both exit non-zero on failure. See **HANDOFF.md** for the architecture, data
model, full API reference, and access rules.

## Install as an app (PWA)

iPhone Safari: Share → Add to Home Screen. Android Chrome: menu → Install app.
Desktop: install icon in the address bar. (Requires HTTPS when hosted publicly.)

## Notes

- `data.json` is fine for dozens of users; move to SQLite beyond that. A file
  that fails to parse is moved aside as `data.json.corrupt-<timestamp>` rather
  than overwritten.
- The client keeps one in-memory copy of each room's history and shares it
  between the community list and the room, so opening a room is instant; polls
  then fetch only messages newer than the newest one it already has.
- Reset everything: stop the server and delete `data.json`.
