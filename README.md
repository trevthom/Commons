# Commons

A community chat PWA: every community has a **General** chat and a **Forum** for
bulletin-board posts. Accounts are anonymous login **keys** (no
email/password). Usernames are chosen per community and reserved permanently.
No private user-to-user messaging.

Running the app needs only **Node.js** (v16+). Editing the UI needs a
[build step](HANDOFF.md): `src/app.src.jsx` is the source and
`public/app.js` is the generated file the browser loads.

## Run it

    node server.js

The terminal prints a `localhost` URL (this device) and a `192.168.x.x` URL
(open on a phone on the same Wi-Fi). Data is stored in `data.json`.

## Develop the UI

    bun install          # installs esbuild + jsdom (dev only)
    bun run build        # regenerates public/app.js from src/app.src.jsx
    bun run build:watch  # rebuild on save

Run `node tools/smoke.mjs` and `node tools/render-test.mjs` (against a running
server) to check the API and the rendered UI. See **HANDOFF.md** for the full
architecture, API reference, and known issues.

## How accounts work

- On first use, tap **Create a new account**. You get a one-time **login key**
  like `K7QF-2M9P-...`. Save it — it's the only way back into your account and
  it only works on the server that issued it. There is no recovery.
- Log in on another device with **I have a login key**. Logging in there
  **logs you out everywhere else** (one active session per account).
- Closing the browser/tab logs you out (you'll need your key again). There's
  also a **Log out** button in the app.

## Usernames

- You pick a username **when you enter a community**. It's reserved to you
  forever — no one else can take it, even if you later change yours.
- You can change your username **once every 60 days**; everyone in the
  community sees a note that your name changed.

## Chat

- Every message bubble has a **⋮ menu**: reply to it, view its **message
  thread** (once it's part of a reply chain), mute its author, and — on your own
  messages — delete it.
- **Replies** show who you replied to plus a one-line preview of their message,
  like Telegram. If that message is deleted later, the preview reads
  "Deleted".
- **Muting** a member hides their Forum posts and their messages in General for
  you. If you mute someone whose message is part of a reply chain, it stays
  collapsed behind a "Muted" placeholder you can tap to reveal. Mutes are kept
  in your browser only.

## Anonymity

Chosen **per message/post** with the eye button beside the composer. Anonymous
labels ("Anon Cedar 42") are stable within a community.

## Invites

- **Indefinite link** — works any number of times.
- **One-time link** — works exactly once, then stops. Generate a fresh one from
  the invite screen whenever you need it.

## Moderation

- Admins can remove members (who may rejoin) and delete any message/post.
- The **owner** can **permanently ban** a member — they can never rejoin.

## Install as an app (PWA)

iPhone Safari: Share → Add to Home Screen. Android Chrome: menu → Install app.
Desktop: install icon in the address bar. (Requires HTTPS when hosted publicly.)

## Notes

- `PORT=3000 node server.js` to change port. `DATA_FILE=/path node server.js`
  to relocate storage (useful with a mounted disk on a host).
- Reset everything: stop the server, delete `data.json`.
- `data.json` is fine for dozens of users; move to SQLite beyond that.
