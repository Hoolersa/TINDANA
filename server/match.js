'use strict';

const { EventEmitter } = require('events');
const engine = require('../engine/gameEngine');
const { TURN_DURATION_MS, RECONNECT_GRACE_MS } = require('./protocol');

class MatchFullError extends Error {}
class NotAPlayerError extends Error {}
class IllegalActionError extends Error {
  constructor(message) {
    super(message);
    this.code = 'illegal_action';
  }
}

let matchCounter = 0;
function generateMatchId() {
  matchCounter += 1;
  return `m${Date.now().toString(36)}${matchCounter.toString(36)}`;
}

/**
 * A single, isolated match. Owns:
 *  - the authoritative game state (via engine.js)
 *  - server-side turn timers, guarded by revision numbers so a stale
 *    setTimeout firing after the turn has already advanced is a no-op
 *  - reconnect grace timers for each player seat
 *
 * Emits (no payload unless noted):
 *   'stateChanged'        - snapshot should be rebuilt & pushed to everyone
 *   'finished'             - { winner, drawn, reason }
 *   'playerDisconnected'   - { seat, graceMs }
 *   'playerReconnected'    - { seat }
 *   'rematchReady'         - both seated players requested a rematch
 */
class Match extends EventEmitter {
  constructor({ id, scheduler, rng = Math.random, hostSessionId, hostNickname, mode = 'standard' }) {
    super();
    this.id = id || generateMatchId();
    this.scheduler = scheduler;
    this.rng = rng;
    this.mode = mode === 'diagonal' ? 'diagonal' : 'standard';

    this.status = 'waiting'; // 'waiting' | 'live' | 'finished'
    this.game = engine.createGame(this.mode);
    this.gameRevision = 0;
    this.turnRevision = 0;
    this.turnDeadline = null;
    this._timerHandle = null;
    this.finishReason = null; // 'win' | 'draw' | 'no_legal_moves' | 'disconnect_forfeit' | 'timeout_forfeit'*
    // (*timeout_forfeit isn't used - timeouts resolve via random action, not forfeit)

    this.seats = { A: null, B: null }; // { sessionId, nickname, connected, graceHandle }
    this.spectators = new Map(); // sessionId -> { nickname }
    this.rematchRequests = new Set();
    this.createdAt = scheduler.now();

    if (hostSessionId) {
      this.joinAsPlayer(hostSessionId, hostNickname);
    }
  }

  // ---------- membership ----------

  seatForSession(sessionId) {
    if (this.seats.A && this.seats.A.sessionId === sessionId) return 'A';
    if (this.seats.B && this.seats.B.sessionId === sessionId) return 'B';
    return null;
  }

  joinAsPlayer(sessionId, nickname) {
    const existing = this.seatForSession(sessionId);
    if (existing) return existing;

    const openSeat = !this.seats.A ? 'A' : !this.seats.B ? 'B' : null;
    if (!openSeat) throw new MatchFullError('Both seats are taken');

    this.seats[openSeat] = { sessionId, nickname, connected: true, graceHandle: null };
    this.spectators.delete(sessionId);

    if (this.seats.A && this.seats.B) {
      this.status = 'live';
      this._startTurnTimer();
    }
    this.emit('stateChanged');
    return openSeat;
  }

  joinAsSpectator(sessionId, nickname) {
    if (this.seatForSession(sessionId)) return; // players don't also spectate
    this.spectators.set(sessionId, { nickname });
    this.emit('stateChanged');
  }

  markConnected(sessionId) {
    const seat = this.seatForSession(sessionId);
    if (seat) {
      const seatData = this.seats[seat];
      const wasDisconnected = !seatData.connected;
      seatData.connected = true;
      if (seatData.graceHandle !== null) {
        this.scheduler.cancel(seatData.graceHandle);
        seatData.graceHandle = null;
      }
      if (wasDisconnected) this.emit('playerReconnected', { seat });
      this.emit('stateChanged');
      return;
    }
    // Spectator (re)connecting doesn't affect game state beyond visibility;
    // callers should call joinAsSpectator for a brand-new spectator.
  }

  markDisconnected(sessionId) {
    const seat = this.seatForSession(sessionId);
    if (seat) {
      const seatData = this.seats[seat];
      seatData.connected = false;
      if (this.status === 'live') {
        this._startGraceTimer(seat);
      }
      this.emit('playerDisconnected', { seat, graceMs: RECONNECT_GRACE_MS });
      this.emit('stateChanged');
      return;
    }
    if (this.spectators.has(sessionId)) {
      this.spectators.delete(sessionId);
      this.emit('stateChanged');
    }
  }

  // ---------- gameplay actions ----------

  place(sessionId, position) {
    this._assertLive();
    const seat = this._assertIsPlayer(sessionId);
    if (this.game.turn !== seat) throw new IllegalActionError('Not your turn');
    this.game = engine.applyPlacement(this.game, seat, position); // throws IllegalActionError-ish on bad move
    this._afterStateMutation();
  }

  move(sessionId, from, to) {
    this._assertLive();
    const seat = this._assertIsPlayer(sessionId);
    if (this.game.turn !== seat) throw new IllegalActionError('Not your turn');
    this.game = engine.applyMove(this.game, seat, from, to);
    this._afterStateMutation();
  }

  requestRematch(sessionId) {
    if (this.status !== 'finished') return false;
    const seat = this.seatForSession(sessionId);
    if (!seat) throw new NotAPlayerError('Only seated players can request a rematch');
    this.rematchRequests.add(sessionId);
    const bothWant =
      this.seats.A &&
      this.seats.B &&
      this.rematchRequests.has(this.seats.A.sessionId) &&
      this.rematchRequests.has(this.seats.B.sessionId);
    if (bothWant) this.emit('rematchReady');
    return bothWant;
  }

  // ---------- snapshot ----------

  /** Build a client-facing snapshot. `forSessionId` determines the `yourSeat` field. */
  buildSnapshot(forSessionId) {
    const seat = this.seatForSession(forSessionId);
    return {
      matchId: this.id,
      status: this.status,
      phase: this.game.phase,
      board: this.game.board.slice(),
      turn: this.game.turn,
      beadsPlaced: { ...this.game.beadsPlaced },
      winner: this.game.winner,
      winLine: this.game.winLine,
      drawn: this.game.drawn,
      finishReason: this.finishReason,
      gameRevision: this.gameRevision,
      turnRevision: this.turnRevision,
      turnDeadline: this.turnDeadline, // absolute epoch ms, or null; client only *displays* countdown
      players: {
        A: this.seats.A && { nickname: this.seats.A.nickname, connected: this.seats.A.connected },
        B: this.seats.B && { nickname: this.seats.B.nickname, connected: this.seats.B.connected },
      },
      spectatorCount: this.spectators.size,
      yourSeat: seat || (this.spectators.has(forSessionId) ? 'spectator' : null),
    };
  }

  /** Summary used in the lobby list (no per-user fields). */
  buildLobbySummary() {
    return {
      matchId: this.id,
      status: this.status,
      mode: this.mode,
      players: {
        A: this.seats.A ? this.seats.A.nickname : null,
        B: this.seats.B ? this.seats.B.nickname : null,
      },
      spectatorCount: this.spectators.size,
    };
  }

  // ---------- internals ----------

  _assertLive() {
    if (this.status !== 'live') throw new IllegalActionError('Match is not live');
  }

  _assertIsPlayer(sessionId) {
    const seat = this.seatForSession(sessionId);
    if (!seat) throw new NotAPlayerError('Not a seated player in this match');
    return seat;
  }

  _afterStateMutation() {
    this.gameRevision += 1;
    this._clearTurnTimer();
    if (this.game.phase === 'over') {
      this._finalize(this.game.drawn ? 'draw' : this.game.winner ? 'win' : 'no_legal_moves');
    } else {
      this._startTurnTimer();
    }
    this.emit('stateChanged');
  }

  _startTurnTimer() {
    this._clearTurnTimer();
    const duration = TURN_DURATION_MS[this.game.phase];
    if (!duration) return; // phase 'over' - no timer
    this.turnRevision += 1;
    const expectedTurnRevision = this.turnRevision;
    this.turnDeadline = this.scheduler.now() + duration;
    this._timerHandle = this.scheduler.schedule(() => {
      this._onTimerFire(expectedTurnRevision);
    }, duration);
  }

  _clearTurnTimer() {
    if (this._timerHandle !== null) {
      this.scheduler.cancel(this._timerHandle);
      this._timerHandle = null;
    }
    this.turnDeadline = null;
  }

  _onTimerFire(expectedTurnRevision) {
    // Guard: if the turn has already advanced (another action already
    // resolved this turn), this callback is stale - ignore it entirely.
    if (expectedTurnRevision !== this.turnRevision) return;
    if (this.status !== 'live' || this.game.phase === 'over') return;

    const player = this.game.turn;
    if (this.game.phase === 'drop') {
      const pos = engine.randomEmptyPosition(this.game.board, this.rng);
      this.game = engine.applyPlacement(this.game, player, pos);
    } else if (this.game.phase === 'move') {
      const legalMove = engine.randomLegalMove(this.game.board, player, this.rng);
      // getLegalMoves emptiness is already handled inside applyMove's caller
      // path (engine marks the mover's opponent the winner when they have
      // no legal moves on their turn), so legalMove should exist here.
      const [from, to] = legalMove;
      this.game = engine.applyMove(this.game, player, from, to);
    }
    this._afterStateMutation();
  }

  _startGraceTimer(seat) {
    const seatData = this.seats[seat];
    if (seatData.graceHandle !== null) this.scheduler.cancel(seatData.graceHandle);
    seatData.graceHandle = this.scheduler.schedule(() => {
      this._onGraceExpire(seat);
    }, RECONNECT_GRACE_MS);
  }

  _onGraceExpire(seat) {
    const seatData = this.seats[seat];
    if (!seatData || seatData.connected) return; // reconnected already; stale
    if (this.status !== 'live') return;
    seatData.graceHandle = null;
    const opponent = engine.OPPONENT[seat];
    this.game = { ...this.game, phase: 'over', winner: opponent, winLine: null };
    this.gameRevision += 1;
    this._clearTurnTimer();
    this._finalize('disconnect_forfeit');
    this.emit('stateChanged');
  }

  _finalize(reason) {
    this.status = 'finished';
    this.finishReason = reason;
    this._clearTurnTimer();
    this.emit('finished', { winner: this.game.winner, drawn: this.game.drawn, reason });
  }
}

module.exports = { Match, MatchFullError, NotAPlayerError, IllegalActionError, generateMatchId };
