'use strict';

const { Match, MatchFullError, generateMatchId } = require('./match');

const FINISHED_RETENTION_MS = 10 * 60 * 1000; // keep finished matches visible in lobby for 10 min

class MatchManager {
  constructor({ scheduler, onMatchFinished } = {}) {
    if (!scheduler) throw new Error('MatchManager requires a scheduler');
    this.scheduler = scheduler;
    this.matches = new Map(); // matchId -> Match
    this.onMatchFinished = onMatchFinished || null;
  }

  createMatch(mode, hostSessionId, hostNickname, isPrivate = false) {
    if (this.hasActiveMatch(hostSessionId)) {
      const err = new Error('Already has an active match');
      err.code = 'already_has_active_match';
      throw err;
    }
    if (mode !== 'standard' && mode !== 'diagonal') {
      throw new Error(`Unknown mode: ${mode}`);
    }
    const id = generateMatchId();
    const match = new Match({
      id,
      mode,
      scheduler: this.scheduler,
      hostSessionId,
      hostNickname,
      isPrivate,
    });
    this.matches.set(id, match);

    match.on('finished', (result) => {
      // Schedule cleanup so finished matches don't accumulate forever, but
      // stay visible/rejoinable-as-spectator in the lobby for a while.
      this.scheduler.schedule(() => {
        this.matches.delete(id);
      }, FINISHED_RETENTION_MS);
      if (this.onMatchFinished) this.onMatchFinished(match, result);
    });

    return match;
  }

  getMatch(matchId) {
    return this.matches.get(matchId) || null;
  }

  hasActiveMatch(sessionId) {
    for (const match of this.matches.values()) {
      if (match.status === 'finished') continue;
      const seat = match.seatForSession(sessionId);
      if (!seat) continue;
      const seatData = match.seats[seat];
      // A waiting match is only considered active if the player is still connected.
      if (match.status === 'waiting' && seatData && !seatData.connected) continue;
      return true;
    }
    return false;
  }

  /** Join an existing match as a player; throws MatchFullError if both seats taken. */
  joinAsPlayer(matchId, sessionId, nickname) {
    const match = this.getMatch(matchId);
    if (!match) throw new Error('Match not found');
    return match.joinAsPlayer(sessionId, nickname); // may throw MatchFullError
  }

  joinAsSpectator(matchId, sessionId, nickname) {
    const match = this.getMatch(matchId);
    if (!match) throw new Error('Match not found');
    match.joinAsSpectator(sessionId, nickname);
    return match;
  }

  /**
   * Lobby listing: waiting matches first (need a second player), then live,
   * then recently finished. Waiting matches whose host is offline are hidden.
   * Each match's data is fully isolated - this only reads summary fields.
   */
  listLobby(includePrivate = true) {
    let all = Array.from(this.matches.values())
      .filter((match) => {
        if (match.status !== 'waiting') return true;
        const hostSeat = match.seats.A || match.seats.B;
        return hostSeat && hostSeat.connected;
      })
      .map((m) => m.buildLobbySummary());
    if (!includePrivate) {
      all = all.filter((summary) => !summary.private);
    }
    const order = { waiting: 0, live: 1, finished: 2 };
    all.sort((a, b) => order[a.status] - order[b.status]);
    return all;
  }
}

module.exports = { MatchManager, MatchFullError };
