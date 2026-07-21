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
  SEND_CHAT: 'send_chat',
  REPORT_CHAT: 'report_chat',
};
const S2C = {
  MATCH_SNAPSHOT: 'match_snapshot',
  MATCH_ERROR: 'match_error',
  MATCH_ENDED: 'match_ended',
  OPPONENT_DISCONNECTED: 'opponent_disconnected',
  OPPONENT_RECONNECTED: 'opponent_reconnected',
  REMATCH_OFFERED: 'rematch_offered',
  LOBBY_UPDATE: 'lobby_update',
  CHAT_MESSAGE: 'chat_message',
  CHAT_HISTORY: 'chat_history',
  CHAT_ERROR: 'chat_error',
  CHAT_ACK: 'chat_ack',
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
  snapshot: null, // last MATCH_SNAPSHOT
  selectedFrom: null, // move-phase: bead currently selected for a move
  opponentDisconnectNotice: false,
  lastError: null,
  chatMessages: [],
  chatDraft: '',
  chatError: null,
  timerIntervalHandle: null,
};

const root = document.getElementById('view-root');
const liveRegion = document.getElementById('live-region');

function tr(key, vars) { return t(state.lang, key, vars); }

function announce(text) {
  liveRegion.textContent = '';
  // Re-set on next tick so repeated identical announcements still fire.
  requestAnimationFrame(() => { liveRegion.textContent = text; });
}

function applyLangToChrome() {
  document.documentElement.lang = state.lang;
  document.body.dataset.lang = state.lang;
  document.getElementById('app-title').textContent = tr('game_title');
  document.getElementById('app-tagline').textContent = tr('tagline');
  document.getElementById('lang-toggle').textContent = tr('lang_toggle');
  const nickEl = document.getElementById('nickname-display');
  nickEl.textContent = state.nickname ? `${tr('you_label')}: ${state.nickname}` : '';
}

document.getElementById('lang-toggle').addEventListener('click', () => {
  state.lang = state.lang === 'bn' ? 'en' : 'bn';
  localStorage.setItem(LANG_KEY, state.lang);
  applyLangToChrome();
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

function handleServerMessage(msg) {
  switch (msg.type) {
    case S2C.LOBBY_UPDATE:
      state.lobbyMatches = msg.matches;
      if (state.view === 'lobby') render();
      return;
    case S2C.CHAT_HISTORY:
      state.chatMessages = msg.messages || [];
      if (state.view !== 'gate') render();
      return;
    case S2C.CHAT_MESSAGE:
      state.chatMessages = [...state.chatMessages, msg.message];
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
    case S2C.REMATCH_OFFERED:
      send(C2S.REQUEST_SNAPSHOT, { matchId: msg.newMatchId });
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

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

async function createMatch(mode) {
  const res = await fetch('/api/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    credentials: 'same-origin',
  });
  const data = await res.json();
  joinMatch(data.matchId, 'player');
}

function joinMatch(matchId, as) {
  send(C2S.JOIN_MATCH, { matchId, as });
}

function leaveMatch() {
  if (state.currentMatchId) send(C2S.LEAVE_MATCH, { matchId: state.currentMatchId });
  state.currentMatchId = null;
  state.snapshot = null;
  localStorage.removeItem(MATCH_KEY);
  state.view = 'lobby';
  refreshLobbyOnce().then(render);
}

function requestRematch() {
  send(C2S.REQUEST_REMATCH, { matchId: state.currentMatchId });
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
  return `
    <div class="match-card">
      <div>
        <div class="who">${names || tr('waiting_matches')}</div>
        <div class="meta">${m.mode === 'diagonal' ? tr('mode_diagonal') : tr('mode_standard')}
          ${m.spectatorCount ? ` · ${m.spectatorCount} ${tr('spectators')}` : ''}</div>
      </div>
      ${m.status !== 'finished' ? `<button data-match="${m.matchId}" data-action="${action}">${actionLabel}</button>` : ''}
    </div>
  `;
}

function renderLobby() {
  const waiting = state.lobbyMatches.filter((m) => m.status === 'waiting');
  const live = state.lobbyMatches.filter((m) => m.status === 'live');
  const finished = state.lobbyMatches.filter((m) => m.status === 'finished');

  root.innerHTML = `
    <div class="panel">
      <h2>${tr('create_match')}</h2>
      <div class="mode-buttons">
        <button type="button" data-create="standard">${tr('mode_standard')}</button>
        <button type="button" data-create="diagonal">${tr('mode_diagonal')}</button>
      </div>
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
      ${renderChatPanel()}
    </div>
  `;

  root.querySelectorAll('[data-create]').forEach((btn) => {
    btn.addEventListener('click', () => createMatch(btn.dataset.create));
  });
  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => joinMatch(btn.dataset.match, btn.dataset.action === 'join' ? 'player' : 'spectator'));
  });
  attachChatHandlers();
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
      <button type="button" class="link-button" id="back-to-lobby">${tr('back_to_lobby')}</button>
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
    <div class="board-wrap">${renderBoardHTML(snap)}</div>
    ${renderChatPanel()}
    ${isFinished && isPlayer ? `
      <div class="action-row">
        <button type="button" class="rematch-btn" id="rematch-btn">${tr('request_rematch')}</button>
        <button type="button" class="leave-btn" id="leave-btn-2">${tr('leave_match')}</button>
      </div>` : `
      <div class="action-row">
        <button type="button" class="leave-btn" id="leave-btn">${tr('leave_match')}</button>
      </div>`}
  `;

  document.getElementById('back-to-lobby').addEventListener('click', leaveMatch);
  const leaveBtn = document.getElementById('leave-btn') || document.getElementById('leave-btn-2');
  if (leaveBtn) leaveBtn.addEventListener('click', leaveMatch);
  const rematchBtn = document.getElementById('rematch-btn');
  if (rematchBtn) rematchBtn.addEventListener('click', () => {
    requestRematch();
    rematchBtn.disabled = true;
    rematchBtn.textContent = tr('rematch_waiting');
  });

  root.querySelectorAll('.board-point').forEach((btn) => {
    btn.addEventListener('click', () => onPointActivate(Number(btn.dataset.pos)));
  });

  const grid = document.getElementById('board-grid');
  if (grid) grid.addEventListener('keydown', handleBoardArrowNav);

  attachChatHandlers();
  startOrRefreshTimerLoop(snap);
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
        <h3>${tr('global_chat')}</h3>
        <span class="chat-caption">${tr('chat_help')}</span>
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
  if (!form || !input) return;

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

  document.querySelectorAll('.chat-report').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportChat(btn.dataset.messageId);
    });
  });
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
