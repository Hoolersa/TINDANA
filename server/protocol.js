'use strict';

/** Client -> Server message types */
const C2S = Object.freeze({
  JOIN_MATCH: 'join_match', // { matchId, as: 'player' | 'spectator' }
  PLACE: 'place', // { matchId, position }
  MOVE: 'move', // { matchId, from, to }
  REQUEST_SNAPSHOT: 'request_snapshot', // { matchId } - used after reconnect
  LEAVE_MATCH: 'leave_match', // { matchId }
  REQUEST_REMATCH: 'request_rematch', // { matchId }
  DECLINE_REMATCH: 'decline_rematch', // { matchId }
  SEND_CHAT: 'send_chat', // { text }
  REPORT_CHAT: 'report_chat', // { messageId }
  VOICE_OFFER: 'voice_offer', // { matchId, sdp }
  VOICE_ANSWER: 'voice_answer', // { matchId, sdp }
  VOICE_ICE_CANDIDATE: 'voice_ice_candidate', // { matchId, candidate }
});

/** Server -> Client message types */
const S2C = Object.freeze({
  MATCH_SNAPSHOT: 'match_snapshot', // full authoritative state, see buildSnapshot()
  MATCH_ERROR: 'match_error', // { code, message } - rejected action, not fatal
  MATCH_ENDED: 'match_ended', // { winner, drawn, reason }
  OPPONENT_DISCONNECTED: 'opponent_disconnected', // { graceMsRemaining }
  OPPONENT_RECONNECTED: 'opponent_reconnected', // {}
  REMATCH_PROPOSED: 'rematch_proposed', // { by }
  REMATCH_DECLINED: 'rematch_declined', // { by }
  REMATCH_OFFERED: 'rematch_offered', // { newMatchId }
  LOBBY_UPDATE: 'lobby_update', // { matches: [...] }
  CHAT_MESSAGE: 'chat_message', // { message }
  CHAT_HISTORY: 'chat_history', // { messages: [...] }
  CHAT_ERROR: 'chat_error', // { code, message }
  CHAT_ACK: 'chat_ack', // { action, messageId }
  VOICE_OFFER: 'voice_offer', // { matchId, sdp }
  VOICE_ANSWER: 'voice_answer', // { matchId, sdp }
  VOICE_ICE_CANDIDATE: 'voice_ice_candidate', // { matchId, candidate }
});

/** Turn durations, per spec: 15s for placement, 30s for movement. */
const TURN_DURATION_MS = Object.freeze({
  drop: 15000,
  move: 30000,
});

/** How long a disconnected player has to reconnect before forfeiting. */
const RECONNECT_GRACE_MS = 30000;

/** Error codes returned in MATCH_ERROR so the client can react appropriately. */
const ERROR_CODES = Object.freeze({
  NOT_YOUR_TURN: 'not_your_turn',
  ILLEGAL_ACTION: 'illegal_action',
  NOT_A_PLAYER: 'not_a_player',
  INVALID_PASSKEY: 'invalid_passkey',
  MATCH_NOT_FOUND: 'match_not_found',
  MATCH_FULL: 'match_full',
  MATCH_OVER: 'match_over',
  STALE_REVISION: 'stale_revision',
  CHAT_TOO_LONG: 'chat_too_long',
  CHAT_RATE_LIMITED: 'chat_rate_limited',
  CHAT_REPORT_INVALID: 'chat_report_invalid',
});

module.exports = { C2S, S2C, TURN_DURATION_MS, RECONNECT_GRACE_MS, ERROR_CODES };
