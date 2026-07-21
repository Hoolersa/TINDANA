'use strict';

const { MatchFullError } = require('./match');
const { C2S, S2C, ERROR_CODES } = require('./protocol');

/**
 * Builds a message handler for one server process's worth of connections.
 * Pure logic, no socket/HTTP objects touched directly - the caller supplies:
 *
 *  - matchManager:      a MatchManager instance
 *  - sendToSession(sessionId, payload): deliver a message to a session, or
 *                        no-op if that session isn't currently connected
 *  - getNickname(sessionId): -> string
 *  - socketMatch:        a Map<sessionId, matchId> the router reads/writes
 *                        to know which match a session's actions target
 *  - broadcastLobby():   push a fresh lobby listing to everyone
 *  - wireMatchEvents(match): attach event listeners for match state changes
 *                        (only invoked for matches created via rematch)
 */
function createMessageRouter({ matchManager, chatManager, broadcastChat, sendToSession, getNickname, socketMatch, broadcastLobby, wireMatchEvents }) {
  function err(code, message) {
    return { type: S2C.MATCH_ERROR, code, message: message || code };
  }

  function chatErr(code, message) {
    return { type: S2C.CHAT_ERROR, code, message: message || code };
  }

  function mapErrorCode(e) {
    if (e.code === 'illegal_action') return ERROR_CODES.ILLEGAL_ACTION;
    if (e.name === 'NotAPlayerError') return ERROR_CODES.NOT_A_PLAYER;
    return ERROR_CODES.ILLEGAL_ACTION;
  }

  function handleMessage(sessionId, msg) {
    switch (msg.type) {
      case C2S.JOIN_MATCH: {
        const match = matchManager.getMatch(msg.matchId);
        if (!match) return sendToSession(sessionId, err(ERROR_CODES.MATCH_NOT_FOUND));
        if (match.private && !match.seatForSession(sessionId)) {
          if (!msg.passKey || msg.passKey !== match.passKey) {
            return sendToSession(sessionId, err(ERROR_CODES.INVALID_PASSKEY, 'Invalid pass key'));
          }
        }
        try {
          if (msg.as === 'player') {
            match.joinAsPlayer(sessionId, getNickname(sessionId));
          } else {
            match.joinAsSpectator(sessionId, getNickname(sessionId));
          }
        } catch (e) {
          if (e instanceof MatchFullError) return sendToSession(sessionId, err(ERROR_CODES.MATCH_FULL));
          throw e;
        }
        match.markConnected(sessionId);
        socketMatch.set(sessionId, match.id);
        sendToSession(sessionId, { type: S2C.MATCH_SNAPSHOT, snapshot: match.buildSnapshot(sessionId) });
        broadcastLobby();
        return;
      }
      case C2S.REQUEST_SNAPSHOT: {
        const match = matchManager.getMatch(msg.matchId);
        if (!match) return sendToSession(sessionId, err(ERROR_CODES.MATCH_NOT_FOUND));
        match.markConnected(sessionId);
        socketMatch.set(sessionId, match.id);
        sendToSession(sessionId, { type: S2C.MATCH_SNAPSHOT, snapshot: match.buildSnapshot(sessionId) });
        return;
      }
      case C2S.PLACE: {
        const match = matchManager.getMatch(msg.matchId);
        if (!match) return sendToSession(sessionId, err(ERROR_CODES.MATCH_NOT_FOUND));
        try {
          match.place(sessionId, msg.position);
        } catch (e) {
          sendToSession(sessionId, err(mapErrorCode(e), e.message));
        }
        return;
      }
      case C2S.MOVE: {
        const match = matchManager.getMatch(msg.matchId);
        if (!match) return sendToSession(sessionId, err(ERROR_CODES.MATCH_NOT_FOUND));
        try {
          match.move(sessionId, msg.from, msg.to);
        } catch (e) {
          sendToSession(sessionId, err(mapErrorCode(e), e.message));
        }
        return;
      }
      case C2S.SEND_CHAT: {
        try {
          const message = chatManager.addMessage(sessionId, getNickname(sessionId), msg.text);
          broadcastChat({ type: S2C.CHAT_MESSAGE, message });
          return;
        } catch (e) {
          if (e.code) return sendToSession(sessionId, chatErr(e.code, e.message));
          throw e;
        }
      }
      case C2S.REPORT_CHAT: {
        try {
          const report = chatManager.reportMessage(msg.messageId);
          sendToSession(sessionId, { type: S2C.CHAT_ACK, action: 'report', messageId: report.messageId });
        } catch (e) {
          if (e.code) return sendToSession(sessionId, chatErr(e.code, e.message));
          throw e;
        }
        return;
      }
      case C2S.REQUEST_REMATCH: {
        const match = matchManager.getMatch(msg.matchId);
        if (!match) return sendToSession(sessionId, err(ERROR_CODES.MATCH_NOT_FOUND));
        try {
          const bothWant = match.requestRematch(sessionId);
          if (!bothWant) {
            const otherSessionId = match.otherPlayerSessionId(sessionId);
            if (otherSessionId) {
              sendToSession(otherSessionId, {
                type: S2C.REMATCH_PROPOSED,
                by: getNickname(sessionId),
              });
            }
          }
        } catch (e) {
          if (e.name === 'NotAPlayerError') return sendToSession(sessionId, err(ERROR_CODES.NOT_A_PLAYER));
          throw e;
        }
        return;
      }
      case C2S.DECLINE_REMATCH: {
        const match = matchManager.getMatch(msg.matchId);
        if (!match) return sendToSession(sessionId, err(ERROR_CODES.MATCH_NOT_FOUND));
        try {
          const declined = match.declineRematch(sessionId);
          if (declined) {
            const otherSessionId = match.otherPlayerSessionId(sessionId);
            if (otherSessionId) {
              sendToSession(otherSessionId, {
                type: S2C.REMATCH_DECLINED,
                by: getNickname(sessionId),
              });
            }
          }
        } catch (e) {
          if (e.name === 'NotAPlayerError') return sendToSession(sessionId, err(ERROR_CODES.NOT_A_PLAYER));
          throw e;
        }
        return;
      }
      case C2S.LEAVE_MATCH: {
        const matchId = socketMatch.get(sessionId);
        if (matchId) {
          const match = matchManager.getMatch(matchId);
          if (match) match.markDisconnected(sessionId);
        }
        socketMatch.delete(sessionId);
        return;
      }
      default:
        return;
    }
  }

  function handleDisconnect(sessionId) {
    const matchId = socketMatch.get(sessionId);
    socketMatch.delete(sessionId);
    if (matchId) {
      const match = matchManager.getMatch(matchId);
      if (match) match.markDisconnected(sessionId);
    }
  }

  return { handleMessage, handleDisconnect };
}

module.exports = { createMessageRouter };
