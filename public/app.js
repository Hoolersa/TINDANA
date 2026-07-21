'use strict';

/* Mirrors server/protocol.js message type strings. Kept in sync manually
   since this is a plain-script frontend with no bundler/shared import. */
const C2S = {
  JOIN_MATCH: 'join_match',
  PLACE: 'place',
  MOVE: 'move',
  REQUEST_SNAPSHOT: 'request_snapshot',
  LEAVE_MATCH: 'leave_match',
  REQUEST_REMATCH: 'request_rematch',
  DECLINE_REMATCH: 'decline_rematch',
  SEND_CHAT: 'send_chat',
  REPORT_CHAT: 'report_chat',
  VOICE_OFFER: 'voice_offer',
  VOICE_ANSWER: 'voice_answer',
  VOICE_ICE_CANDIDATE: 'voice_ice_candidate',
};
const S2C = {
  MATCH_SNAPSHOT: 'match_snapshot',
  MATCH_ERROR: 'match_error',
  MATCH_ENDED: 'match_ended',
  OPPONENT_DISCONNECTED: 'opponent_disconnected',
  OPPONENT_RECONNECTED: 'opponent_reconnected',
  REMATCH_PROPOSED: 'rematch_proposed',
  REMATCH_DECLINED: 'rematch_declined',
  REMATCH_OFFERED: 'rematch_offered',
  LOBBY_UPDATE: 'lobby_update',
  CHAT_MESSAGE: 'chat_message',
  CHAT_HISTORY: 'chat_history',
  CHAT_ERROR: 'chat_error',
  CHAT_ACK: 'chat_ack',
  VOICE_OFFER: 'voice_offer',
  VOICE_ANSWER: 'voice_answer',
  VOICE_ICE_CANDIDATE: 'voice_ice_candidate',
};

const LANG_KEY = 'tindana_lang';
const MATCH_KEY = 'tindana_current_match';

const state = {
  lang: localStorage.getItem(LANG_KEY) || 'bn',
  nickname: null,
  sessionId: null,
  ws: null,
  reconnectAttempts: 0,
  view: 'gate', // 'gate' | 'lobby' | 'match'
  lobbyMatches: [],
  currentMatchId: localStorage.getItem(MATCH_KEY) || null,
  createPrivateMatch: false,
  privateMatchId: '',
  lastPrivateMatchPassKey: null,
  snapshot: null, // last MATCH_SNAPSHOT
  rematchProposalBy: null,
  rematchDeclinedBy: null,
  selectedFrom: null, // move-phase: bead currently selected for a move
  opponentDisconnectNotice: false,
  lastError: null,
  chatMessages: [],
  chatDraft: '',
  chatError: null,
  chatOpen: false,
  unreadChatCount: 0,
  voiceStatus: 'idle',
  voiceMuted: false,
  peerConnection: null,
  localStream: null,
  timerIntervalHandle: null,
  lobbyRefreshHandle: null,
};

const root = document.getElementById('view-root');
let chatAudioContext = null;

document.getElementById('lang-toggle').addEventListener('click', () => {
  state.lang = state.lang === 'bn' ? 'en' : 'bn';
  localStorage.setItem(LANG_KEY, state.lang);
  applyLangToChrome(state.lang);
  render();
});

// ---------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------

async function bootstrapSession(nickname) {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
    credentials: 'same-origin',
  });
  const data = await res.json();
  state.sessionId = data.sessionId;
  state.nickname = data.nickname;
  applyLangToChrome();
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;

  ws.addEventListener('open', () => {
    state.reconnectAttempts = 0;
    state.opponentDisconnectNotice = false;
    if (state.currentMatchId) {
      send(C2S.REQUEST_SNAPSHOT, { matchId: state.currentMatchId });
    }
    render();
  });

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    state.ws = null;
    render(); // shows "reconnecting" banner if we're mid-match
    const delay = Math.min(1000 * 2 ** state.reconnectAttempts, 10000);
    state.reconnectAttempts += 1;
    setTimeout(connectWS, delay);
  });

  ws.addEventListener('error', () => ws.close());
}

function send(type, payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, ...payload }));
  }
}

function sendChat(text) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.chatError = null;
    send(C2S.SEND_CHAT, { text });
  }
}

function reportChat(messageId) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    send(C2S.REPORT_CHAT, { messageId });
  }
}

function playChatSound() {
  if (typeof window.AudioContext === 'undefined' && typeof window.webkitAudioContext === 'undefined') return;
  try {
    if (!chatAudioContext) {
      const ctor = window.AudioContext || window.webkitAudioContext;
      chatAudioContext = new ctor();
    }
    if (chatAudioContext.state === 'suspended') {
      chatAudioContext.resume().catch(() => {});
    }
    const oscillator = chatAudioContext.createOscillator();
    const gain = chatAudioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.12;
    oscillator.connect(gain);
    gain.connect(chatAudioContext.destination);
    oscillator.start();
    oscillator.stop(chatAudioContext.currentTime + 0.08);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  } catch (_) {}
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case S2C.LOBBY_UPDATE:
      state.lobbyMatches = msg.matches;
      if (state.view === 'lobby') render();
      return;
    case S2C.CHAT_HISTORY:
      state.chatMessages = msg.messages || [];
      if (state.view !== 'gate') {
        state.unreadChatCount = 0;
        render();
      }
      return;
    case S2C.CHAT_MESSAGE:
      state.chatMessages = [...state.chatMessages, msg.message];
      if (msg.message.nickname !== state.nickname) {
        if (!state.chatOpen) state.unreadChatCount += 1;
        playChatSound();
      }
      if (state.view !== 'gate') render();
      return;
    case S2C.CHAT_ERROR:
      state.chatError = msg.message || msg.code;
      if (state.view !== 'gate') render();
      return;
    case S2C.MATCH_SNAPSHOT: {
      const wasNewMatch = state.currentMatchId !== msg.snapshot.matchId;
      state.snapshot = msg.snapshot;
      state.currentMatchId = msg.snapshot.matchId;
      localStorage.setItem(MATCH_KEY, msg.snapshot.matchId);
      state.view = 'match';
      state.opponentDisconnectNotice = false;
      if (wasNewMatch) state.selectedFrom = null;
      render();
      return;
    }
    case S2C.MATCH_ERROR:
      state.lastError = msg.message || msg.code;
      announce(tr('server_rejected'));
      render();
      return;
    case S2C.MATCH_ENDED:
      // MATCH_SNAPSHOT (status: finished) arrives alongside this; the
      // banner/result text is driven off snapshot state in renderMatch().
      return;
    case S2C.OPPONENT_DISCONNECTED:
      state.opponentDisconnectNotice = true;
      announce(tr('opponent_disconnected'));
      render();
      return;
    case S2C.OPPONENT_RECONNECTED:
      state.opponentDisconnectNotice = false;
      announce(tr('opponent_reconnected'));
      render();
      return;
    case S2C.REMATCH_PROPOSED:
      state.rematchProposalBy = msg.by;
      state.rematchDeclinedBy = null;
      render();
      return;
    case S2C.REMATCH_DECLINED:
      state.rematchDeclinedBy = msg.by;
      state.rematchProposalBy = null;
      render();
      return;
    case S2C.REMATCH_OFFERED:
      state.rematchProposalBy = null;
      state.rematchDeclinedBy = null;
      send(C2S.REQUEST_SNAPSHOT, { matchId: msg.newMatchId });
      return;
    case S2C.VOICE_OFFER:
      handleRemoteVoiceOffer(msg);
      return;
    case S2C.VOICE_ANSWER:
      handleRemoteVoiceAnswer(msg);
      return;
    case S2C.VOICE_ICE_CANDIDATE:
      handleRemoteVoiceIceCandidate(msg);
      return;
    default:
      return;
  }
}

async function refreshLobbyOnce() {
  const res = await fetch('/api/lobby', { credentials: 'same-origin' });
  const data = await res.json();
  state.lobbyMatches = data.matches;
}

function startLobbyAutoRefresh() {
  if (state.lobbyRefreshHandle) return;
  state.lobbyRefreshHandle = setInterval(async () => {
    if (state.view !== 'lobby') return;
    await refreshLobbyOnce();
    render();
  }, 10000);
}

function stopLobbyAutoRefresh() {
  if (!state.lobbyRefreshHandle) return;
  clearInterval(state.lobbyRefreshHandle);
  state.lobbyRefreshHandle = null;
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

async function createMatch(mode) {
  const res = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, private: state.createPrivateMatch }),
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (!res.ok) {
    state.lastError = data.message || data.error || tr('create_match_failed');
    announce(state.lastError);
    render();
    return;
  }
  state.lastPrivateMatchPassKey = data.passKey || null;
  await refreshLobbyOnce();
  render();
  joinMatch(data.matchId, 'player');
}

function joinMatch(matchId, as, passKey) {
  send(C2S.JOIN_MATCH, { matchId, as, passKey });
}

function requestPrivateJoin(matchId, as) {
  const passKey = window.prompt(tr('enter_private_match_passkey'));
  if (passKey === null) return;
  joinMatch(matchId, as, passKey.trim());
}

function joinMatchById() {
  const matchId = state.privateMatchId.trim();
  if (!matchId) return;
  const passKey = window.prompt(tr('enter_private_match_passkey'));
  if (passKey === null) return;
  state.privateMatchId = '';
  render();
  joinMatch(matchId, 'player', passKey.trim());
}

function leaveMatch() {
  if (state.currentMatchId) send(C2S.LEAVE_MATCH, { matchId: state.currentMatchId });
  state.currentMatchId = null;
  state.snapshot = null;
  state.lastPrivateMatchPassKey = null;
  state.rematchProposalBy = null;
  state.rematchDeclinedBy = null;
  localStorage.removeItem(MATCH_KEY);
  state.view = 'lobby';
  stopVoiceChat();
  refreshLobbyOnce().then(render);
}

function requestRematch() {
  send(C2S.REQUEST_REMATCH, { matchId: state.currentMatchId });
}

function goToLobby() {
  state.view = 'lobby';
  render();
}

function returnToMatch() {
  if (!state.currentMatchId) return;
  state.view = 'match';
  render();
}

function declineRematch() {
  const confirmed = window.confirm(tr('confirm_decline_rematch')); 
  if (!confirmed) return;
  send(C2S.DECLINE_REMATCH, { matchId: state.currentMatchId });
  state.rematchProposalBy = null;
  render();
}

function onPointActivate(position) {
  const snap = state.snapshot;
  if (!snap || snap.status !== 'live' || snap.yourSeat === 'spectator' || !snap.yourSeat) return;
  if (snap.turn !== snap.yourSeat) return;

  if (snap.phase === 'drop') {
    if (snap.board[position] !== null) return;
    send(C2S.PLACE, { matchId: state.currentMatchId, position });
    return;
  }

  if (snap.phase === 'move') {
    const isOwnBead = snap.board[position] === snap.yourSeat;
    if (state.selectedFrom === null) {
      if (isOwnBead) {
        state.selectedFrom = position;
        render();
      }
      return;
    }
    if (position === state.selectedFrom) {
      state.selectedFrom = null; // deselect
      render();
      return;
    }
    if (isOwnBead) {
      state.selectedFrom = position; // switch selection to another bead
      render();
      return;
    }
    if (snap.board[position] === null) {
      send(C2S.MOVE, { matchId: state.currentMatchId, from: state.selectedFrom, to: position });
      state.selectedFrom = null;
    }
  }
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function render() {
  if (state.view === 'gate') return renderGate();
  if (state.view === 'lobby') return renderLobby();
  if (state.view === 'match') return renderMatch();
}

function renderGate() {
  stopLobbyAutoRefresh();
  root.innerHTML = `
    <div class="panel gate">
      <h2>${tr('nickname_label')}</h2>
      <p>${tr('tagline')}</p>
      <form id="gate-form">
        <label class="sr-only" for="nickname-input">${tr('nickname_label')}</label>
        <input type="text" id="nickname-input" maxlength="24" autocomplete="off"
               placeholder="${tr('nickname_placeholder')}" required />
        <button type="submit" class="primary-button">${tr('enter_lobby')}</button>
      </form>
    </div>
  `;
  document.getElementById('gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const nickname = document.getElementById('nickname-input').value.trim() || 'Guest';
    await bootstrapSession(nickname);
    await refreshLobbyOnce();
    connectWS();
    state.view = 'lobby';
    render();
  });
}

function matchCard(m) {
  const you = state.sessionId;
  const isMine = m.players.A === state.nickname || m.players.B === state.nickname;
  const actionLabel = m.status === 'waiting' ? tr('join_seat') : tr('watch');
  const action = m.status === 'waiting' ? 'join' : 'watch';
  const names = [m.players.A, m.players.B].filter(Boolean).join(' vs ');
  const badge = m.private ? `<span class="match-badge">${tr('private_label')}</span>` : '';
  const actionButton = m.status !== 'finished'
    ? `<button data-match="${m.matchId}" data-action="${action}" data-private="${m.private}">${actionLabel}</button>`
    : '';
  return `
    <div class="match-card">
      <div>
        <div class="who">${names || tr('waiting_matches')} ${badge}</div>
        <div class="meta">${m.mode === 'diagonal' ? tr('mode_diagonal') : tr('mode_standard')}
          ${m.spectatorCount ? ` · ${m.spectatorCount} ${tr('spectators')}` : ''}</div>
      </div>
      ${actionButton}
    </div>
  `;
}

function renderLobby() {
  const waiting = state.lobbyMatches.filter((m) => m.status === 'waiting');
  const live = state.lobbyMatches.filter((m) => m.status === 'live');
  const finished = state.lobbyMatches.filter((m) => m.status === 'finished');

  root.innerHTML = `
    <div class="panel">
      <div class="lobby-panel-header">
        <h2>${tr('create_match')}</h2>
        ${state.currentMatchId ? `<button type="button" class="pill-button" id="return-to-game-btn">${tr('return_to_game')}</button>` : ''}
      </div>
      <div class="mode-buttons">
        <button type="button" data-create="standard" ${state.snapshot && state.snapshot.status !== 'finished' && state.snapshot.yourSeat && state.snapshot.yourSeat !== 'spectator' ? 'disabled' : ''}>${tr('mode_standard')}</button>
        <button type="button" data-create="diagonal" ${state.snapshot && state.snapshot.status !== 'finished' && state.snapshot.yourSeat && state.snapshot.yourSeat !== 'spectator' ? 'disabled' : ''}>${tr('mode_diagonal')}</button>
      </div>
      <label class="private-match-toggle">
        <input id="private-match-checkbox" type="checkbox" ${state.createPrivateMatch ? 'checked' : ''}>
        ${tr('private_match')}
      </label>
      <div class="private-join">
        <input id="join-match-id" type="text" maxlength="40"
               placeholder="${tr('join_private_match_id_placeholder')}"
               title="${tr('private_match_id_tooltip')}"
               value="${escapeHtml(state.privateMatchId)}" />
        <button type="button" id="join-match-id-btn">${tr('join_private_match_by_id')}</button>
      </div>
      ${state.lastPrivateMatchPassKey ? `<div class="private-passkey-note">${tr('private_match_created_key', { key: escapeHtml(state.lastPrivateMatchPassKey) })}</div>` : ''}
      <div class="private-join-help">${tr('private_match_help_text')}</div>
    </div>
    <div class="panel lobby-grid">
      <div class="match-column">
        <div class="match-section">
          <h3>${tr('waiting_matches')}</h3>
          <div class="match-list">${waiting.length ? waiting.map(matchCard).join('') : `<div class="empty-note">${tr('no_matches')}</div>`}</div>
        </div>
        <div class="match-section">
          <h3>${tr('live_matches')}</h3>
          <div class="match-list">${live.length ? live.map(matchCard).join('') : `<div class="empty-note">${tr('no_matches')}</div>`}</div>
        </div>
        <div class="match-section">
          <h3>${tr('finished_matches')}</h3>
          <div class="match-list">${finished.length ? finished.map(matchCard).join('') : `<div class="empty-note">${tr('no_matches')}</div>`}</div>
        </div>
      </div>
    </div>
    ${renderChatWidget()}
  `;

  root.querySelectorAll('[data-create]').forEach((btn) => {
    btn.addEventListener('click', () => createMatch(btn.dataset.create));
  });
  const privateCheckbox = document.getElementById('private-match-checkbox');
  if (privateCheckbox) {
    privateCheckbox.addEventListener('change', () => {
      state.createPrivateMatch = privateCheckbox.checked;
    });
  }
  const joinByIdBtn = document.getElementById('join-match-id-btn');
  const joinByIdInput = document.getElementById('join-match-id');
  const returnToGameBtn = document.getElementById('return-to-game-btn');
  if (returnToGameBtn) returnToGameBtn.addEventListener('click', returnToMatch);
  if (joinByIdBtn && joinByIdInput) {
    joinByIdInput.addEventListener('input', () => {
      state.privateMatchId = joinByIdInput.value;
    });
    joinByIdBtn.addEventListener('click', joinMatchById);
    joinByIdInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinMatchById();
      }
    });
  }
  root.querySelectorAll('[data-action]').forEach((btn) => {
    const action = btn.dataset.action === 'join' ? 'player' : 'spectator';
    const needsPassKey = btn.dataset.private === 'true';
    btn.addEventListener('click', () => {
      if (needsPassKey) {
        requestPrivateJoin(btn.dataset.match, action);
      } else {
        joinMatch(btn.dataset.match, action);
      }
    });
  });
  attachChatWidgetHandlers();
  attachVoiceHandlers();
  startLobbyAutoRefresh();
}

function beadInnerHTML(owner) {
  if (owner === 'A') return turmericBeadSVG();
  if (owner === 'B') return indigoBeadSVG();
  return '';
}

function pointLabel(snap, i, owner) {
  if (owner === null) return tr('empty_cell_label', { n: i + 1 });
  const isYours = owner === snap.yourSeat;
  return isYours ? tr('your_bead_label', { n: i + 1 }) : tr('opponent_bead_label', { n: i + 1 });
}

function renderBoardHTML(snap) {
  const rotated = snap.yourSeat === 'B';
  const points = snap.board.map((owner, i) => {
    const [x, y] = POINT_COORDS[i];
    const isYourTurn = snap.status === 'live' && snap.turn === snap.yourSeat;
    let disabled = !isYourTurn;
    let extraClass = '';
    if (isYourTurn && snap.phase === 'move') {
      if (state.selectedFrom !== null) {
        if (i === state.selectedFrom) extraClass = 'selected';
        else if (owner === null && ADJACENCY[state.selectedFrom].includes(i)) extraClass = 'legal-target';
        else if (owner === snap.yourSeat) disabled = false; // can switch selection
        else disabled = true;
      } else {
        disabled = owner !== snap.yourSeat;
      }
    } else if (isYourTurn && snap.phase === 'drop') {
      disabled = owner !== null;
    }
    return `<button type="button" class="board-point ${extraClass}" data-pos="${i}"
              style="left:${x}%; top:${y}%"
              aria-label="${pointLabel(snap, i, owner)}"
              aria-disabled="${disabled}">${beadInnerHTML(owner)}</button>`;
  }).join('');
  return `<div class="board ${rotated ? 'rotated' : ''}" id="board-grid">${buildLinesSVG()}${points}</div>`;
}

function statusText(snap) {
  if (snap.status === 'finished') {
    const winnerName = snap.winner === snap.yourSeat ? tr('you_label')
      : (snap.winner ? (snap.winner === 'A' ? snap.players.A?.nickname : snap.players.B?.nickname) : '');
    if (snap.drawn) return tr('match_over_reason_draw');
    if (snap.finishReason === 'disconnect_forfeit') return tr('match_over_reason_disconnect', { winner: winnerName });
    if (snap.finishReason === 'no_legal_moves') return tr('match_over_reason_no_moves', { winner: winnerName });
    return tr('match_over_reason_win', { winner: winnerName });
  }
  if (snap.yourSeat === 'spectator') return tr('spectating');
  const phaseLabel = snap.phase === 'drop' ? tr('phase_drop') : tr('phase_move');
  if (snap.turn === snap.yourSeat) {
    if (snap.phase === 'move') {
      return state.selectedFrom !== null
        ? `${phaseLabel} · ${tr('select_destination_hint')}`
        : `${phaseLabel} · ${tr('select_bead_hint')}`;
    }
    return `${phaseLabel} · ${tr('your_turn')}`;
  }
  const oppName = snap.turn === 'A' ? snap.players.A?.nickname : snap.players.B?.nickname;
  return `${phaseLabel} · ${tr('opponent_turn', { name: oppName || '' })}`;
}

function resultBannerHTML(snap) {
  if (snap.status !== 'finished' || snap.yourSeat === 'spectator' || !snap.yourSeat) return '';
  let cls = 'draw', text = tr('draw');
  if (!snap.drawn) {
    const youWon = snap.winner === snap.yourSeat;
    cls = youWon ? 'win' : 'lose';
    text = youWon ? tr('you_win') : tr('you_lose');
  }
  return `<div class="result-banner ${cls}">${text}</div>`;
}

function renderMatch() {
  stopLobbyAutoRefresh();
  const snap = state.snapshot;
  if (!snap) {
    root.innerHTML = `<div class="panel">${tr('reconnecting')}</div>`;
    return;
  }

  const isFinished = snap.status === 'finished';
  const isPlayer = snap.yourSeat === 'A' || snap.yourSeat === 'B';

  root.innerHTML = `
    ${!state.ws ? `<div class="connection-banner">${tr('connection_lost')}</div>` : ''}
    <div class="match-header">
      <button type="button" class="link-button" id="view-lobby-btn">${tr('view_lobby')}</button>
      <span class="spectator-count">${snap.spectatorCount} ${tr('spectators')}</span>
    </div>
    <div class="status-bar">
      <span class="player-chip a">
        <span class="swatch"></span>${snap.players.A ? snap.players.A.nickname : '—'}
        ${snap.players.A && !snap.players.A.connected ? '<span class="disconnected-dot" title="disconnected"></span>' : ''}
      </span>
      <span class="turn-timer ${msRemaining(snap) !== null && msRemaining(snap) < 5000 ? 'urgent' : ''}" id="turn-timer" aria-hidden="true">
        ${formatCountdown(snap)}
      </span>
      <span class="player-chip b">
        <span class="swatch"></span>${snap.players.B ? snap.players.B.nickname : '—'}
        ${snap.players.B && !snap.players.B.connected ? '<span class="disconnected-dot" title="disconnected"></span>' : ''}
      </span>
    </div>
    <div class="status-text" id="status-text">${statusText(snap)}</div>
    ${resultBannerHTML(snap)}
    ${renderVoiceControls(snap)}
    ${state.rematchDeclinedBy ? `<div class="rematch-notice">${tr('rematch_declined_by', { name: state.rematchDeclinedBy })}</div>` : ''}
    ${state.rematchProposalBy ? `
      <div class="rematch-proposal">
        <p>${tr('rematch_proposed_by', { name: state.rematchProposalBy })}</p>
        <button type="button" class="accept-rematch-btn" id="accept-rematch-btn">${tr('rematch_accept')}</button>
        <button type="button" class="decline-rematch-btn" id="decline-rematch-btn">${tr('rematch_decline')}</button>
      </div>` : ''}
    <div class="board-wrap">${renderBoardHTML(snap)}</div>
    ${renderChatWidget()}
    ${isFinished && isPlayer ? `
      <div class="action-row">
        <button type="button" class="rematch-btn" id="rematch-btn">${tr('request_rematch')}</button>
        <button type="button" class="leave-btn" id="leave-btn-2">${tr('leave_match')}</button>
      </div>` : `
      <div class="action-row">
        <button type="button" class="leave-btn" id="leave-btn">${tr('leave_match')}</button>
      </div>`}
  `;

  const viewLobbyBtn = document.getElementById('view-lobby-btn');
  if (viewLobbyBtn) viewLobbyBtn.addEventListener('click', goToLobby);
  const leaveBtn = document.getElementById('leave-btn') || document.getElementById('leave-btn-2');
  if (leaveBtn) leaveBtn.addEventListener('click', leaveMatch);
  const rematchBtn = document.getElementById('rematch-btn');
  if (rematchBtn) rematchBtn.addEventListener('click', () => {
    requestRematch();
    rematchBtn.disabled = true;
    rematchBtn.textContent = tr('rematch_waiting');
  });

  const acceptRematchBtn = document.getElementById('accept-rematch-btn');
  if (acceptRematchBtn) {
    acceptRematchBtn.addEventListener('click', () => {
      requestRematch();
    });
  }
  const declineRematchBtn = document.getElementById('decline-rematch-btn');
  if (declineRematchBtn) {
    declineRematchBtn.addEventListener('click', () => {
      declineRematchBtn.disabled = true;
      declineRematch();
    });
  }

  root.querySelectorAll('.board-point').forEach((btn) => {
    btn.addEventListener('click', () => onPointActivate(Number(btn.dataset.pos)));
  });

  const grid = document.getElementById('board-grid');
  if (grid) grid.addEventListener('keydown', handleBoardArrowNav);

  attachChatWidgetHandlers();
  attachVoiceHandlers();
  startOrRefreshTimerLoop(snap);
}

function renderVoiceControls(snap) {
  if (!snap || !snap.yourSeat || snap.yourSeat === 'spectator') return '';
  const hasOpponent = !!snap.players.A && !!snap.players.B;
  const statusText = state.voiceStatus === 'idle'
    ? (hasOpponent ? tr('voice_ready') : tr('voice_waiting_for_opponent'))
    : tr(state.voiceStatus);
  const button = state.voiceStatus === 'connected' || state.voiceStatus === 'connecting'
    ? `<button type="button" class="voice-btn" id="voice-toggle">${state.voiceMuted ? tr('voice_unmute') : tr('voice_mute')}</button>`
    : `<button type="button" class="voice-btn" id="voice-start">${tr('voice_enable')}</button>`;
  return `
    <div class="voice-panel">
      <span class="voice-label">${tr('voice_chat')}</span>
      ${button}
      <span class="voice-status">${statusText}</span>
    </div>
  `;
}

function attachVoiceHandlers() {
  const startBtn = document.getElementById('voice-start');
  if (startBtn) startBtn.addEventListener('click', startVoiceChat);
  const toggleBtn = document.getElementById('voice-toggle');
  if (toggleBtn) toggleBtn.addEventListener('click', toggleVoiceMute);
}

function ensureRemoteAudioEl() {
  let audio = document.getElementById('remote-voice-audio');
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'remote-voice-audio';
    audio.autoplay = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
  }
  return audio;
}

function closeVoiceChat() {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
  }
  state.voiceStatus = 'idle';
  state.voiceMuted = false;
  const audio = document.getElementById('remote-voice-audio');
  if (audio) audio.srcObject = null;
}

function stopVoiceChat() {
  closeVoiceChat();
}

async function createPeerConnection() {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  pc.addEventListener('icecandidate', (event) => {
    if (!event.candidate || !state.currentMatchId) return;
    send(C2S.VOICE_ICE_CANDIDATE, {
      matchId: state.currentMatchId,
      candidate: event.candidate,
    });
  });
  pc.addEventListener('track', (event) => {
    const audio = ensureRemoteAudioEl();
    audio.srcObject = event.streams[0];
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.localStream = stream;
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
    updateVoiceMuteState();
  } catch (err) {
    state.voiceStatus = 'voice_error';
    state.voiceMuted = true;
    render();
    return null;
  }
  state.peerConnection = pc;
  return pc;
}

function updateVoiceMuteState() {
  if (!state.localStream) return;
  state.localStream.getAudioTracks().forEach((track) => {
    track.enabled = !state.voiceMuted;
  });
}

async function startVoiceChat() {
  if (state.peerConnection) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    state.voiceStatus = 'voice_no_mic';
    render();
    return;
  }

  state.voiceStatus = 'voice_connecting';
  render();

  const pc = await createPeerConnection();
  if (!pc) return;

  const snap = state.snapshot;
  if (!snap || !snap.yourSeat || snap.yourSeat === 'spectator' || !state.currentMatchId) {
    state.voiceStatus = 'voice_not_ready';
    render();
    return;
  }

  if (snap.yourSeat === 'A') {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send(C2S.VOICE_OFFER, { matchId: state.currentMatchId, sdp: offer });
    } catch (err) {
      state.voiceStatus = 'voice_error';
      render();
      return;
    }
  }

  // Wait for the remote peer to answer before marking the connection fully connected.
  state.voiceStatus = 'voice_connecting';
  render();
}

async function handleRemoteVoiceOffer(msg) {
  if (!state.currentMatchId || msg.matchId !== state.currentMatchId) return;
  if (!state.peerConnection) {
    await createPeerConnection();
  }
  if (!state.peerConnection) return;
  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    send(C2S.VOICE_ANSWER, { matchId: state.currentMatchId, sdp: answer });
    state.voiceStatus = 'voice_connected';
    render();
  } catch (err) {
    state.voiceStatus = 'voice_error';
    render();
  }
}

async function handleRemoteVoiceAnswer(msg) {
  if (!state.peerConnection) return;
  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    state.voiceStatus = 'voice_connected';
    render();
  } catch (err) {
    state.voiceStatus = 'voice_error';
    render();
  }
}

async function handleRemoteVoiceIceCandidate(msg) {
  if (!state.peerConnection || !msg.candidate) return;
  try {
    await state.peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
  } catch (err) {
    // ignore bad candidate
  }
}

function toggleVoiceMute() {
  state.voiceMuted = !state.voiceMuted;
  updateVoiceMuteState();
  render();
}

/* Simple 3x3 spatial arrow-key navigation between board point buttons. */
function handleBoardArrowNav(e) {
  const key = e.key;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
  const current = document.activeElement;
  if (!current || !current.classList.contains('board-point')) return;
  const pos = Number(current.dataset.pos);
  const row = Math.floor(pos / 3), col = pos % 3;
  let nr = row, nc = col;
  if (key === 'ArrowUp') nr = Math.max(0, row - 1);
  if (key === 'ArrowDown') nr = Math.min(2, row + 1);
  if (key === 'ArrowLeft') nc = Math.max(0, col - 1);
  if (key === 'ArrowRight') nc = Math.min(2, col + 1);
  const target = document.querySelector(`.board-point[data-pos="${nr * 3 + nc}"]`);
  if (target) { e.preventDefault(); target.focus(); }
}

// ---------------------------------------------------------------------
// Timer display — the browser only ever DISPLAYS a countdown derived from
// the server's absolute deadline; it never decides a timeout occurred.
// ---------------------------------------------------------------------

function msRemaining(snap) {
  if (!snap.turnDeadline || snap.status !== 'live') return null;
  return Math.max(0, snap.turnDeadline - Date.now());
}

function formatCountdown(snap) {
  const ms = msRemaining(snap);
  if (ms === null) return '—';
  return String(Math.ceil(ms / 1000)).padStart(2, '0');
}

function startOrRefreshTimerLoop(snap) {
  if (state.timerIntervalHandle) clearInterval(state.timerIntervalHandle);
  if (snap.status !== 'live' || !snap.turnDeadline) return;
  state.timerIntervalHandle = setInterval(() => {
    const el = document.getElementById('turn-timer');
    if (!el || !state.snapshot) { clearInterval(state.timerIntervalHandle); return; }
    const ms = msRemaining(state.snapshot);
    el.textContent = formatCountdown(state.snapshot);
    el.classList.toggle('urgent', ms !== null && ms < 5000);
    if (ms === 0) clearInterval(state.timerIntervalHandle);
  }, 250);
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

function renderChatWidget() {
  if (state.view === 'gate') return '';
  const badge = state.unreadChatCount > 0
    ? `<span class="chat-badge" aria-hidden="true">${state.unreadChatCount}</span>`
    : '';

  if (!state.chatOpen) {
    return `
      <div class="chat-widget collapsed" id="chat-widget">
        <button type="button" class="chat-toggle" id="chat-toggle" aria-label="${tr('open_chat')}">
          ${tr('global_chat')} ${badge}
        </button>
      </div>
    `;
  }

  return `
    <div class="chat-widget open" id="chat-widget">
      ${renderChatPanel()}
    </div>
  `;
}

function renderChatPanel() {
  const rows = state.chatMessages.map((message) => `
      <div class="chat-message">
        <span class="chat-sender">${escapeHtml(message.nickname)}</span>
        <span class="chat-text">${escapeHtml(message.text)}</span>
        <button type="button" class="chat-report" data-message-id="${message.messageId}">${tr('report')}</button>
      </div>
    `).join('');

  return `
    <div class="panel chat-panel">
      <div class="chat-header">
        <div class="chat-title">
          <h3>${tr('global_chat')}</h3>
          <span class="chat-caption">${tr('chat_help')}</span>
        </div>
        <button type="button" class="chat-close" id="chat-minimize" aria-label="${tr('minimize_chat')}">×</button>
      </div>
      <div class="chat-history" id="chat-history">${rows || `<div class="empty-note">${tr('no_chat_messages')}</div>`}</div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" type="text" maxlength="300" autocomplete="off"
               placeholder="${tr('chat_placeholder')}" value="${escapeHtml(state.chatDraft)}" />
        <button type="submit" class="primary-button chat-send">${tr('chat_send')}</button>
      </form>
      ${state.chatError ? `<div class="chat-error">${escapeHtml(state.chatError)}</div>` : ''}
    </div>
  `;
}

function attachChatHandlers() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  if (form && input) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      sendChat(text);
      state.chatDraft = '';
      input.value = '';
    });

    input.addEventListener('input', () => {
      state.chatDraft = input.value;
    });
  }

  document.querySelectorAll('.chat-report').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportChat(btn.dataset.messageId);
    });
  });
}

function attachChatWidgetHandlers() {
  const toggle = document.getElementById('chat-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      state.chatOpen = true;
      state.unreadChatCount = 0;
      render();
    });
  }

  const minimize = document.getElementById('chat-minimize');
  if (minimize) {
    minimize.addEventListener('click', () => {
      state.chatOpen = false;
      render();
    });
  }

  attachChatHandlers();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

applyLangToChrome();
render();
