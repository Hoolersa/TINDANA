# তিন দানা (Tin Dana) — Project Status

Real-time multiplayer Bengali strategy board game. Node.js/WebSocket backend,
plain HTML/JS frontend, deployed to Google Cloud Run.

**Last updated:** 2026-07-21
**Test status:** 42/42 automated tests passing (`npm test`)
**Not yet run:** a real browser session or the real `express`/`ws` server —
the build environment that produced this had no network access to
`npm install`, so integration was verified via a fake-transport test harness
(`test/integration.test.js`), not a live socket. Recommend a manual
playtest (`npm install && npm start`, two browser tabs) before trusting it
fully.

## What's built

| Piece | File(s) | Status |
|---|---|---|
| Game rules engine | `engine/gameEngine.js` | ✅ Done, 14 tests |
| Match state machine (timers, reconnect, revisions) | `server/match.js` | ✅ Done, 12 tests |
| Match/lobby manager | `server/matchManager.js` | ✅ Done |
| Guest sessions (signed tokens) | `server/sessionStore.js` | ✅ Done, 7 tests |
| WS message routing | `server/messageRouter.js` | ✅ Done, 9 integration tests |
| Transport wiring (Express + ws) | `server/wsServer.js` | ✅ Written, untested live (no network in build sandbox) |
| Frontend (lobby, board, i18n, a11y) | `public/*` | ✅ Written, untested in a real browser |
| Docker/Cloud Run deploy config | `Dockerfile`, `.dockerignore` | ✅ Done |
| **Global chat** | — | ❌ Not started |
| **Google Drive match archiving** | — | ❌ Not started |

## Key design decisions worth knowing

- **Server-authoritative timers.** `match.js` uses revision numbers
  (`turnRevision`/`gameRevision`) so a stale `setTimeout` firing after a turn
  has already resolved is a guaranteed no-op. Tested explicitly.
- **Turn clock keeps running during disconnects**, per spec — separate from
  the 30s reconnect grace timer, which is independent.
- **Transport-agnostic core.** `match.js`/`matchManager.js` never touch a
  socket directly; they emit events. `wsServer.js` is the only file that
  imports `ws`/`express`. This is what made deep testing possible without
  real network access.
- **Single-instance architecture.** Match state and live-socket routing are
  in-memory per process. Fine for `--min-instances 1 --max-instances 1` on
  Cloud Run; would need Redis pub/sub to scale beyond one instance.
- **Client never decides a timeout.** The browser only displays a countdown
  derived from the server's absolute `turnDeadline`.

## How to run it

```bash
npm install
npm test                                    # run all 42 tests
SESSION_SECRET=$(openssl rand -hex 32) npm start
# open http://localhost:8080 in two browser tabs/windows
```

## How to deploy (Cloud Run)

```bash
gcloud run deploy tin-dana \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --set-env-vars SESSION_SECRET=$(openssl rand -hex 32)
```

## Next steps, in order

1. **Manual playtest** — run locally, two tabs, confirm placement/movement/
   win detection/timers/reconnect actually work end-to-end in a browser.
2. **Global chat** — needs a small backend piece (broadcast, 300-char cap,
   rate limiting, mute/report) plus a UI panel. Not started.
3. **Google Drive archiving** — write completed matches to Drive on
   `match.on('finished', ...)`, scrubbed of session/IP/chat data per spec.
4. **Deploy to Cloud Run** and do a real public smoke test.

## If picking this back up in a new conversation

Memory isn't enabled for this account, so a fresh conversation won't recall
this project automatically. Either turn on memory in Settings, or just
attach this whole `tin-dana` folder and say "continue the তিন দানা build" —
this file plus the code itself is enough context to resume from exactly
here.
