/**
 * তিন দানা (Tin Dana) — core game engine
 *
 * Pure, deterministic, side-effect-free game logic. No I/O, no timers,
 * no networking. This module is the single source of truth for rules and
 * is meant to be required both by the authoritative server and (optionally)
 * by the browser client for instant local validation/prediction.
 *
 * Board layout (indices):
 *   0 --- 1 --- 2
 *   3 --- 4 --- 5
 *   6 --- 7 --- 8
 *
 * Drawn lines (movement edges + win lines):
 *   rows:     0-1-2   3-4-5   6-7-8
 *   columns:  0-3-6   1-4-7   2-5-8
 *   diagonals:0-4-8   2-4-6
 *
 * A player wins by completing any one of the eight lines above.
 */

'use strict';

const PLAYERS = Object.freeze({ A: 'A', B: 'B' });

const OPPONENT = Object.freeze({ A: 'B', B: 'A' });

/** Adjacency graph derived from the drawn board lines (used for movement legality). */
const ADJACENCY = Object.freeze({
  0: Object.freeze([1, 3, 4]),
  1: Object.freeze([0, 2, 4]),
  2: Object.freeze([1, 4, 5]),
  3: Object.freeze([0, 4, 6]),
  4: Object.freeze([0, 1, 2, 3, 5, 6, 7, 8]),
  5: Object.freeze([2, 4, 8]),
  6: Object.freeze([3, 4, 7]),
  7: Object.freeze([4, 6, 8]),
  8: Object.freeze([5, 7, 4]),
});

/** All eight three-in-a-row lines on the board. */
const ALL_LINES = Object.freeze([
  Object.freeze([0, 1, 2]),
  Object.freeze([3, 4, 5]),
  Object.freeze([6, 7, 8]),
  Object.freeze([0, 3, 6]),
  Object.freeze([1, 4, 7]),
  Object.freeze([2, 5, 8]),
  Object.freeze([0, 4, 8]),
  Object.freeze([2, 4, 6]),
]);

const BEADS_PER_PLAYER = 3;
const TOTAL_PLACEMENTS = BEADS_PER_PLAYER * 2;

const DIAGONAL_LINES = Object.freeze([
  Object.freeze([0, 4, 8]),
  Object.freeze([2, 4, 6]),
]);

/** Create a fresh game state. */
function createGame(mode = 'standard') {
  if (mode !== 'standard' && mode !== 'diagonal') {
    throw new Error(`Unknown mode: ${mode}`);
  }
  return {
    mode,
    phase: 'drop', // 'drop' | 'move' | 'over'
    board: new Array(9).fill(null), // null | 'A' | 'B'
    beadsPlaced: { A: 0, B: 0 },
    turn: PLAYERS.A, // Player A places/moves first
    winner: null, // null | 'A' | 'B'
    winLine: null, // null | [a,b,c]
    drawn: false,
    // History of "position keys" (board arrangement + whose turn) used for
    // threefold-repetition draw detection during the move phase.
    positionHistory: [],
  };
}

/** Build a repetition key from board contents + whose turn it is. */
function positionKey(board, turn) {
  return board.map((c) => c || '_').join('') + '|' + turn;
}

function cloneState(state) {
  return {
    ...state,
    board: state.board.slice(),
    beadsPlaced: { ...state.beadsPlaced },
    winLine: state.winLine ? state.winLine.slice() : null,
    positionHistory: state.positionHistory.slice(),
  };
}

function checkWin(board, player, mode = 'standard') {
  const lines = mode === 'diagonal' ? DIAGONAL_LINES : ALL_LINES;
  for (const line of lines) {
    if (line.every((pos) => board[pos] === player)) {
      if (mode === 'standard') {
        if (player === PLAYERS.A && line[0] === 6 && line[1] === 7 && line[2] === 8) {
          continue; // A's home row does not count as a win
        }
        if (player === PLAYERS.B && line[0] === 0 && line[1] === 1 && line[2] === 2) {
          continue; // B's home row does not count as a win
        }
      }
      return line.slice();
    }
  }
  return null;
}

/**
 * Apply a placement (drop phase) for `player` at `position`.
 * Returns a new state. Throws on illegal moves — callers (server) should
 * validate before calling, or catch and treat as a rejected action.
 */
function applyPlacement(state, player, position) {
  if (state.phase !== 'drop') throw new Error('Not in drop phase');
  if (state.turn !== player) throw new Error('Not this player\'s turn');
  if (!Number.isInteger(position) || position < 0 || position > 8) {
    throw new Error('Position must be an intersection from 0 to 8');
  }
  if (state.board[position] !== null) throw new Error('Position occupied');
  if (state.beadsPlaced[player] >= BEADS_PER_PLAYER) {
    throw new Error('Player has no beads left to place');
  }

  const next = cloneState(state);
  next.board[position] = player;
  next.beadsPlaced[player] += 1;

  const win = checkWin(next.board, player, state.mode);
  if (win) {
    next.phase = 'over';
    next.winner = player;
    next.winLine = win;
    return next;
  }

  const totalPlaced = next.beadsPlaced.A + next.beadsPlaced.B;
  if (totalPlaced >= TOTAL_PLACEMENTS) {
    next.phase = 'move';
    // Move phase begins; per spec, players alternate — Player A moves first
    // since drop phase always ends after B's 3rd placement (A,B,A,B,A,B).
    next.turn = PLAYERS.A;
    next.positionHistory = [positionKey(next.board, next.turn)];
  } else {
    next.turn = OPPONENT[player];
  }

  return next;
}

/** Get all legal (from, to) moves for `player` in the move phase. */
function getLegalMoves(board, player) {
  const moves = [];
  for (let from = 0; from < 9; from++) {
    if (board[from] !== player) continue;
    for (const to of ADJACENCY[from]) {
      if (board[to] === null) {
        moves.push([from, to]);
      }
    }
  }
  return moves;
}

/**
 * Apply a move (move phase) for `player` from `from` to `to`.
 * Returns a new state, with `drawn: true` set if this move causes a
 * threefold repetition.
 */
function applyMove(state, player, from, to) {
  if (state.phase !== 'move') throw new Error('Not in move phase');
  if (state.turn !== player) throw new Error('Not this player\'s turn');
  if (!Number.isInteger(from) || from < 0 || from > 8 ||
      !Number.isInteger(to) || to < 0 || to > 8) {
    throw new Error('Move endpoints must be intersections from 0 to 8');
  }
  if (state.board[from] !== player) throw new Error('No bead of yours there');
  if (!ADJACENCY[from].includes(to)) throw new Error('Not an adjacent, connected point');
  if (state.board[to] !== null) throw new Error('Destination occupied');

  const next = cloneState(state);
  next.board[from] = null;
  next.board[to] = player;

  const win = checkWin(next.board, player, state.mode);
  if (win) {
    next.phase = 'over';
    next.winner = player;
    next.winLine = win;
    return next;
  }

  next.turn = OPPONENT[player];

  // Threefold repetition check
  const key = positionKey(next.board, next.turn);
  next.positionHistory.push(key);
  const occurrences = next.positionHistory.filter((k) => k === key).length;
  if (occurrences >= 3) {
    next.phase = 'over';
    next.drawn = true;
    return next;
  }

  // If the player to move now has no legal moves, they lose immediately.
  const legal = getLegalMoves(next.board, next.turn);
  if (legal.length === 0) {
    next.phase = 'over';
    next.winner = OPPONENT[next.turn];
    return next;
  }

  return next;
}

/** Pick a uniformly random empty intersection (server timeout: drop phase). */
function randomEmptyPosition(board, rng = Math.random) {
  const empties = [];
  for (let i = 0; i < 9; i++) if (board[i] === null) empties.push(i);
  if (empties.length === 0) return null;
  return empties[Math.floor(rng() * empties.length)];
}

/** Pick a uniformly random legal move (server timeout: move phase). */
function randomLegalMove(board, player, rng = Math.random) {
  const moves = getLegalMoves(board, player);
  if (moves.length === 0) return null;
  return moves[Math.floor(rng() * moves.length)];
}

module.exports = {
  PLAYERS,
  OPPONENT,
  ADJACENCY,
  ALL_LINES,
  BEADS_PER_PLAYER,
  TOTAL_PLACEMENTS,
  createGame,
  cloneState,
  positionKey,
  checkWin,
  applyPlacement,
  applyMove,
  getLegalMoves,
  randomEmptyPosition,
  randomLegalMove,
};
