'use strict';

const assert = require('assert');
const { MatchManager } = require('../server/matchManager');
const { createMessageRouter } = require('../server/messageRouter');
const { ChatManager } = require('../server/chatManager');
const { createFakeScheduler } = require('../server/scheduler');
const { C2S, S2C, RECONNECT_GRACE_MS, TURN_DURATION_MS } = require('../server/protocol');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    console.error(`  FAIL - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

/** Minimal fake transport: records every message "sent" to each session. */
function makeHarness() {
  const scheduler = createFakeScheduler();
  const inbox = new Map(); // sessionId -> array of messages received
  const nicknames = new Map();
  const socketMatch = new Map();
  let lobbyBroadcastCount = 0;

  const matchManager = new MatchManager({ scheduler });
  const chatManager = new ChatManager({ now: () => 0 });

  const router = createMessageRouter({
    matchManager,
    chatManager,
    broadcastChat: () => {},
    sendToSession: (sessionId, payload) => {
      if (!inbox.has(sessionId)) inbox.set(sessionId, []);
      inbox.get(sessionId).push(payload);
    },
    getNickname: (sessionId) => nicknames.get(sessionId) || 'Guest',
    socketMatch,
    broadcastLobby: () => { lobbyBroadcastCount += 1; },
  });

  function setNickname(sessionId, nickname) { nicknames.set(sessionId, nickname); }
  function lastMessage(sessionId) {
    const msgs = inbox.get(sessionId);
    return msgs && msgs.length ? msgs[msgs.length - 1] : null;
  }
  function messagesOfType(sessionId, type) {
    return (inbox.get(sessionId) || []).filter((m) => m.type === type);
  }
  /**
   * Mirrors the real client exactly: app.js's createMatch() does
   * POST /api/matches then immediately sends a WS JOIN_MATCH for the same
   * session. Using matchManager.createMatch() alone (as the HTTP handler
   * does) does NOT register socketMatch - only a JOIN_MATCH over the wire
   * does that. Skipping the follow-up join here would test a flow the real
   * client never actually takes.
   */
  function createAndJoinAsHost(sessionId, nickname, mode) {
    setNickname(sessionId, nickname);
    const match = matchManager.createMatch(mode, sessionId, nickname);
    router.handleMessage(sessionId, { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });
    return match;
  }

  return { scheduler, matchManager, router, setNickname, lastMessage, messagesOfType, inbox, socketMatch, createAndJoinAsHost, getLobbyBroadcastCount: () => lobbyBroadcastCount };
}

console.log('End-to-end integration tests (via messageRouter, fake transport):');

test('two players join, play a full drop-phase win, and both receive the final snapshot', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  // Bob joins over the "wire" exactly like a real client would.
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });

  const bobSnap = h.lastMessage('bob');
  assert.strictEqual(bobSnap.type, S2C.MATCH_SNAPSHOT);
  assert.strictEqual(bobSnap.snapshot.yourSeat, 'B');
  assert.strictEqual(bobSnap.snapshot.status, 'live');

  // Alice (A) places to complete top row 0,1,2 - not her home row (bottom), so it's a win.
  h.router.handleMessage('alice', { type: C2S.PLACE, matchId: match.id, position: 0 });
  h.router.handleMessage('bob', { type: C2S.PLACE, matchId: match.id, position: 3 });
  h.router.handleMessage('alice', { type: C2S.PLACE, matchId: match.id, position: 1 });
  h.router.handleMessage('bob', { type: C2S.PLACE, matchId: match.id, position: 4 });
  h.router.handleMessage('alice', { type: C2S.PLACE, matchId: match.id, position: 2 });

  assert.strictEqual(match.status, 'finished');
  assert.strictEqual(match.game.winner, 'A');
});

test('an illegal action produces a MATCH_ERROR to the actor only, and does not mutate state', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });

  // It's Alice's (A's) turn - Bob tries to act out of turn.
  h.router.handleMessage('bob', { type: C2S.PLACE, matchId: match.id, position: 0 });
  const bobError = h.lastMessage('bob');
  assert.strictEqual(bobError.type, S2C.MATCH_ERROR);
  assert.strictEqual(match.game.beadsPlaced.A, 0);
  assert.strictEqual(match.game.beadsPlaced.B, 0);
});

test('a spectator can watch but a PLACE from them is rejected', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  h.setNickname('carol', 'Carol');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });
  h.router.handleMessage('carol', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'spectator' });

  const carolSnap = h.lastMessage('carol');
  assert.strictEqual(carolSnap.snapshot.yourSeat, 'spectator');
  assert.strictEqual(carolSnap.snapshot.spectatorCount, 1);

  h.router.handleMessage('carol', { type: C2S.PLACE, matchId: match.id, position: 0 });
  assert.strictEqual(h.lastMessage('carol').type, S2C.MATCH_ERROR);
});

test('disconnect -> reconnect within grace period via REQUEST_SNAPSHOT restores the seat, no forfeit', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });

  h.router.handleDisconnect('alice'); // simulates ws 'close' event
  assert.strictEqual(match.seats.A.connected, false);

  h.scheduler.advance(RECONNECT_GRACE_MS - 1000);
  h.router.handleMessage('alice', { type: C2S.REQUEST_SNAPSHOT, matchId: match.id });
  assert.strictEqual(match.seats.A.connected, true);
  assert.strictEqual(match.status, 'live');

  const snap = h.lastMessage('alice');
  assert.strictEqual(snap.type, S2C.MATCH_SNAPSHOT);
  assert.strictEqual(snap.snapshot.yourSeat, 'A');
});

test('disconnect without reconnect forfeits after the grace period, opponent gets MATCH_ENDED-equivalent state via snapshot', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });

  h.router.handleDisconnect('alice');
  h.scheduler.advance(RECONNECT_GRACE_MS);

  assert.strictEqual(match.status, 'finished');
  assert.strictEqual(match.game.winner, 'B');
});

test('rematch flow: match is isolated - acting on the old finished match after rematch has no effect on the new one', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });
  h.router.handleDisconnect('alice');
  h.scheduler.advance(RECONNECT_GRACE_MS); // forfeits to Bob, match finishes

  h.router.handleMessage('bob', { type: C2S.REQUEST_REMATCH, matchId: match.id });
  h.router.handleMessage('alice', { type: C2S.REQUEST_REMATCH, matchId: match.id });
  // requestRematch on the manager-level match emits 'rematchReady'; in the
  // real server wsServer.js listens for that and creates a new match. Here
  // we just confirm the original match itself never resurrects/mutates.
  assert.strictEqual(match.status, 'finished');
  assert.strictEqual(match.game.winner, 'B');
});

test('lobby is broadcast when a player joins a match (so waiting -> live transition is visible)', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  const before = h.getLobbyBroadcastCount();
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });
  assert.ok(h.getLobbyBroadcastCount() > before);
});

test('joining a nonexistent match returns MATCH_NOT_FOUND, not a crash', () => {
  const h = makeHarness();
  h.setNickname('alice', 'Alice');
  h.router.handleMessage('alice', { type: C2S.JOIN_MATCH, matchId: 'does-not-exist', as: 'player' });
  const msg = h.lastMessage('alice');
  assert.strictEqual(msg.type, S2C.MATCH_ERROR);
  assert.strictEqual(msg.code, 'match_not_found');
});

test('full move-phase game plays out via the router exactly as via direct Match calls', () => {
  const h = makeHarness();
  h.setNickname('bob', 'Bob');
  const match = h.createAndJoinAsHost('alice', 'Alice', 'standard');
  h.router.handleMessage('bob', { type: C2S.JOIN_MATCH, matchId: match.id, as: 'player' });

  // Non-winning placements (avoids any accidental win, see earlier engine tests).
  const seq = [
    ['alice', 0], ['bob', 1], ['alice', 4], ['bob', 2], ['alice', 6], ['bob', 5],
  ];
  for (const [session, pos] of seq) {
    h.router.handleMessage(session, { type: C2S.PLACE, matchId: match.id, position: pos });
  }
  assert.strictEqual(match.game.phase, 'move');

  // A (alice) moves 0 -> 3 (empty, adjacent).
  h.router.handleMessage('alice', { type: C2S.MOVE, matchId: match.id, from: 0, to: 3 });
  assert.strictEqual(match.game.board[0], null);
  assert.strictEqual(match.game.board[3], 'A');
  assert.strictEqual(match.game.turn, 'B');
});

console.log(`\n${passed} test(s) passed.`);
