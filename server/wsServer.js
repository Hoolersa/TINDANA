/**
 * Requires: npm install express ws cookie
 *
 * Run: SESSION_SECRET=<32+ char random string> node server/wsServer.js
 *
 * This file is intentionally thin: all game rules live in engine.js,
 * all match/timer/reconnect logic lives in match.js + matchManager.js,
 * all session logic lives in sessionStore.js. This file just moves bytes
 * between real sockets and those modules.
 */
'use strict';

const http = require('http');
const express = require('express');
const cookie = require('cookie');
const { WebSocketServer } = require('ws');

const { createRealScheduler } = require('./scheduler');
const { SessionStore } = require('./sessionStore');
const { MatchManager } = require('./matchManager');
const { createMessageRouter } = require('./messageRouter');
const { ChatManager } = require('./chatManager');
const { S2C } = require('./protocol');

const PORT = process.env.PORT || 8080;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_COOKIE_NAME = 'tindana_session';

if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET env var is required (32+ random chars).');
  process.exit(1);
}

const sessionStore = new SessionStore(SESSION_SECRET);
const scheduler = createRealScheduler();
const chatManager = new ChatManager();

// sessionId -> live sender for THIS process. Cloud Run may run multiple
// instances/containers; for a true multi-instance deployment this registry
// (and match state) would need to live in a shared store (e.g. Redis) with
// sticky sessions or a pub/sub relay. For the MVP (single instance / min
// instances = 1 on Cloud Run) an in-memory registry is sufficient.
const liveSockets = new Map(); // sessionId -> WebSocket
// sessionId -> matchId currently joined, so we know where to route inbound
// game actions and where to remove the connection from on close.
const socketMatch = new Map();

function broadcastLobby() {
  const message = { type: S2C.LOBBY_UPDATE, matches: matchManager.listLobby() };
  for (const ws of liveSockets.values()) {
    safeSend(ws, message);
  }
}

function broadcastChat(payload) {
  for (const ws of liveSockets.values()) {
    safeSend(ws, payload);
  }
}

const matchManager = new MatchManager({
  scheduler,
  onMatchFinished: () => broadcastLobby(),
});

function safeSend(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function pushSnapshotToMatch(match) {
  const recipients = [
    match.seats.A && match.seats.A.sessionId,
    match.seats.B && match.seats.B.sessionId,
    ...match.spectators.keys(),
  ].filter(Boolean);
  for (const sessionId of recipients) {
    const ws = liveSockets.get(sessionId);
    if (!ws) continue;
    safeSend(ws, { type: S2C.MATCH_SNAPSHOT, snapshot: match.buildSnapshot(sessionId) });
  }
}

function wireMatchEvents(match) {
  match.on('stateChanged', () => pushSnapshotToMatch(match));
  match.on('finished', (result) => {
    pushSnapshotToMatch(match);
    for (const sessionId of [match.seats.A?.sessionId, match.seats.B?.sessionId].filter(Boolean)) {
      safeSend(liveSockets.get(sessionId), { type: S2C.MATCH_ENDED, ...result });
    }
  });
  match.on('playerDisconnected', ({ seat, graceMs }) => {
    const opponentSeat = seat === 'A' ? 'B' : 'A';
    const opponentSessionId = match.seats[opponentSeat] && match.seats[opponentSeat].sessionId;
    if (opponentSessionId) {
      safeSend(liveSockets.get(opponentSessionId), {
        type: S2C.OPPONENT_DISCONNECTED,
        graceMsRemaining: graceMs,
      });
    }
  });
  match.on('playerReconnected', ({ seat }) => {
    const opponentSeat = seat === 'A' ? 'B' : 'A';
    const opponentSessionId = match.seats[opponentSeat] && match.seats[opponentSeat].sessionId;
    if (opponentSessionId) {
      safeSend(liveSockets.get(opponentSessionId), { type: S2C.OPPONENT_RECONNECTED });
    }
  });
  match.on('rematchReady', () => {
    const newMatch = matchManager.createMatch(match.mode, match.seats.A.sessionId, match.seats.A.nickname);
    newMatch.joinAsPlayer(match.seats.B.sessionId, match.seats.B.nickname);
    wireMatchEvents(newMatch);
    for (const sessionId of [match.seats.A.sessionId, match.seats.B.sessionId]) {
      safeSend(liveSockets.get(sessionId), { type: S2C.REMATCH_OFFERED, newMatchId: newMatch.id });
    }
    broadcastLobby();
  });
}

// ---------------- HTTP: guest session issuance + static frontend ----------------

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/api/session', (req, res) => {
  const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname : 'Guest';
  const existingToken = parseSessionCookie(req);
  const existing = existingToken && sessionStore.verifyToken(existingToken);
  if (existing) {
    // Already has a valid session (e.g. page refresh) - reuse it so seat
    // reclaim works; per spec we don't force a new identity on refresh.
    nicknamesBySession.set(existing.sessionId, existing.nickname);
    return res.json({ sessionId: existing.sessionId, nickname: existing.nickname });
  }
  const { sessionId, token, nickname: cleanNickname } = sessionStore.createGuestSession(nickname);
  nicknamesBySession.set(sessionId, cleanNickname);
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24h
      path: '/',
    })
  );
  res.json({ sessionId, nickname: cleanNickname });
});

app.get('/api/lobby', (req, res) => {
  res.json({ matches: matchManager.listLobby() });
});

app.post('/api/matches', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const mode = req.body?.mode === 'diagonal' ? 'diagonal' : 'standard';
  const match = matchManager.createMatch(mode, session.sessionId, session.nickname);
  wireMatchEvents(match);
  // Register the routing mapping now rather than waiting for the client's
  // follow-up WS JOIN_MATCH - if that message is ever lost in transit, the
  // host's later disconnect would otherwise never be routed to this match.
  socketMatch.set(session.sessionId, match.id);
  broadcastLobby();
  res.json({ matchId: match.id });
});

function parseSessionCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  return parsed[SESSION_COOKIE_NAME] || null;
}

function requireSession(req, res) {
  const token = parseSessionCookie(req);
  const session = token && sessionStore.verifyToken(token);
  if (!session) {
    res.status(401).json({ error: 'no_valid_session' });
    return null;
  }
  return session;
}

// ---------------- WebSocket: gameplay + chat ----------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const nicknamesBySession = new Map();
function currentNickname(sessionId) {
  return nicknamesBySession.get(sessionId) || 'Guest';
}

const router = createMessageRouter({
  matchManager,
  chatManager,
  sendToSession: (sessionId, payload) => safeSend(liveSockets.get(sessionId), payload),
  broadcastChat,
  getNickname: currentNickname,
  socketMatch,
  broadcastLobby,
});

wss.on('connection', (ws, req) => {
  const token = parseSessionCookie(req);
  const session = token && sessionStore.verifyToken(token);
  if (!session) {
    ws.close(4001, 'invalid_session');
    return;
  }
  const { sessionId } = session;
  liveSockets.set(sessionId, ws);
  safeSend(ws, { type: S2C.CHAT_HISTORY, messages: chatManager.getHistory() });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames
    }
    router.handleMessage(sessionId, msg);
  });

  ws.on('close', () => {
    liveSockets.delete(sessionId);
    router.handleDisconnect(sessionId);
    // Cloud Run WebSocket connections may close periodically for reasons
    // unrelated to the player leaving; the client is expected to
    // auto-reconnect and send REQUEST_SNAPSHOT, at which point
    // markConnected() restores them if the grace period hasn't lapsed.
  });
});
server.listen(PORT, () => {
  console.log(`তিন দানা server listening on :${PORT}`);
});

module.exports = { app, server };
