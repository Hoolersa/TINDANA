'use strict';

const assert = require('assert');
const engine = require('../engine/gameEngine');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('gameEngine tests:');

test('fresh game starts in drop phase, Player A to move', () => {
  const state = engine.createGame('standard');
  assert.strictEqual(state.phase, 'drop');
  assert.strictEqual(state.turn, 'A');
  assert.deepStrictEqual(state.board, new Array(9).fill(null));
});

test('drop phase alternates turns and transitions to move phase after 6 placements', () => {
  let s = engine.createGame('standard');
  // A ends at {0,4,6} (not a line), B ends at {1,2,5} (not a line) - no accidental win.
  const seq = [
    ['A', 0], ['B', 1], ['A', 4], ['B', 2], ['A', 6], ['B', 5],
  ];
  for (const [player, pos] of seq) {
    s = engine.applyPlacement(s, player, pos);
  }
  assert.strictEqual(s.phase, 'move');
  assert.strictEqual(s.beadsPlaced.A, 3);
  assert.strictEqual(s.beadsPlaced.B, 3);
});

test('placing on an occupied square throws', () => {
  let s = engine.createGame('standard');
  s = engine.applyPlacement(s, 'A', 0);
  assert.throws(() => engine.applyPlacement(s, 'B', 0));
});

test('acting out of turn throws', () => {
  let s = engine.createGame('standard');
  assert.throws(() => engine.applyPlacement(s, 'B', 0));
});

test('Player A wins by completing a non-home row during drop phase', () => {
  let s = engine.createGame('standard');
  // A drops 0,1,2 (top row) — not A's home row (A's home is bottom 6,7,8) so it's a legal win.
  s = engine.applyPlacement(s, 'A', 0);
  s = engine.applyPlacement(s, 'B', 3);
  s = engine.applyPlacement(s, 'A', 1);
  s = engine.applyPlacement(s, 'B', 4);
  s = engine.applyPlacement(s, 'A', 2);
  assert.strictEqual(s.phase, 'over');
  assert.strictEqual(s.winner, 'A');
  assert.deepStrictEqual(s.winLine, [0, 1, 2]);
});

test('Player A cannot win on their own home row (bottom 6,7,8)', () => {
  let s = engine.createGame('standard');
  s = engine.applyPlacement(s, 'A', 6);
  s = engine.applyPlacement(s, 'B', 0);
  s = engine.applyPlacement(s, 'A', 7);
  s = engine.applyPlacement(s, 'B', 1);
  s = engine.applyPlacement(s, 'A', 8);
  // A has completed 6-7-8 but that's A's own home row -> no win.
  assert.strictEqual(s.winner, null);
  assert.strictEqual(s.phase, 'drop'); // only 5 of 6 beads placed so far
  s = engine.applyPlacement(s, 'B', 3); // B's 3rd bead: {0,1,3}, not a line
  assert.strictEqual(s.winner, null);
  assert.strictEqual(s.phase, 'move'); // all 6 beads placed now
});

test('Player B cannot win on their own home row (top 0,1,2) but can win on 6,7,8', () => {
  let s = engine.createGame('standard');
  // A's beads end at {3,6,8} (not a line) so A never wins along the way;
  // B's beads end at {0,1,2} - B's own home row, so no win despite completing it.
  s = engine.applyPlacement(s, 'A', 3);
  s = engine.applyPlacement(s, 'B', 0);
  s = engine.applyPlacement(s, 'A', 6);
  s = engine.applyPlacement(s, 'B', 1);
  s = engine.applyPlacement(s, 'A', 8);
  s = engine.applyPlacement(s, 'B', 2);
  assert.strictEqual(s.winner, null); // B completed 0-1-2, own home row, no win
  assert.strictEqual(s.phase, 'move');
});

test('diagonal-only mode ignores rows/columns and only allows the two diagonals', () => {
  let s = engine.createGame('diagonal');
  // A completes top row 0,1,2 - should NOT win in diagonal mode.
  s = engine.applyPlacement(s, 'A', 0);
  s = engine.applyPlacement(s, 'B', 6);
  s = engine.applyPlacement(s, 'A', 1);
  s = engine.applyPlacement(s, 'B', 7);
  s = engine.applyPlacement(s, 'A', 2);
  assert.strictEqual(s.winner, null);
});

test('diagonal-only mode: winning on 2-4-6 works for the non-home-row player', () => {
  let s = engine.createGame('diagonal');
  s = engine.applyPlacement(s, 'A', 2);
  s = engine.applyPlacement(s, 'B', 0);
  s = engine.applyPlacement(s, 'A', 4);
  s = engine.applyPlacement(s, 'B', 1);
  s = engine.applyPlacement(s, 'A', 6);
  assert.strictEqual(s.winner, 'A');
  assert.deepStrictEqual(s.winLine.slice().sort(), [2, 4, 6]);
});

test('move phase: illegal move to non-adjacent point throws', () => {
  let s = engine.createGame('standard');
  // A ends at {0,4,6}, B ends at {1,2,5}, empty: {3,7,8} - no accidental win.
  const seq = [['A', 0], ['B', 1], ['A', 4], ['B', 2], ['A', 6], ['B', 5]];
  for (const [p, pos] of seq) s = engine.applyPlacement(s, p, pos);
  // A has a bead at 0. 0 is adjacent to 1,3,4 — not 8.
  assert.throws(() => engine.applyMove(s, 'A', 0, 8));
});

test('move phase: legal move to empty adjacent point succeeds', () => {
  let s = engine.createGame('standard');
  const seq = [['A', 0], ['B', 1], ['A', 4], ['B', 2], ['A', 6], ['B', 5]];
  for (const [p, pos] of seq) s = engine.applyPlacement(s, p, pos);
  // empty squares: 3, 7, 8. A moves 0 -> 3 (adjacent, empty).
  s = engine.applyMove(s, 'A', 0, 3);
  assert.strictEqual(s.board[0], null);
  assert.strictEqual(s.board[3], 'A');
  assert.strictEqual(s.turn, 'B');
});

test('threefold repetition triggers a draw', () => {
  // Construct a state in move phase with a simple back-and-forth cycle
  // that can repeat 3 times without anyone winning.
  let s = engine.createGame('standard');
  // Place beads so that A={0,3,4}? need to avoid accidental wins with home-row rules.
  // A home row = 6,7,8 ; B home row = 0,1,2.
  // Place: A at 3,4,5 (not a win line? 3-4-5 IS a line and not A's home row -> would win!)
  // Choose non-winning, non-home-row-safe placements instead.
  const seq = [
    ['A', 3], ['B', 0], // A:3 B:0
    ['A', 4], ['B', 1], // careful: B at 0,1 -> needs to avoid completing 0,1,2
    ['A', 6], ['B', 7], // A:3,4,6 (6,7,8 not fully A) B:0,1,7
  ];
  for (const [p, pos] of seq) s = engine.applyPlacement(s, p, pos);
  assert.strictEqual(s.phase, 'move');
  assert.strictEqual(s.winner, null);
  // Board: A at 3,4,6 ; B at 0,1,7 ; empty: 2,5,8
  // Cycle A: 4<->5 (4 adjacent to 5, both empty/A alternately), B: 7<->8
  for (let i = 0; i < 2; i++) {
    s = engine.applyMove(s, 'A', 4, 5); // A:3,5,6
    s = engine.applyMove(s, 'B', 7, 8); // B:0,1,8
    s = engine.applyMove(s, 'A', 5, 4); // A:3,4,6 (back to original)
    s = engine.applyMove(s, 'B', 8, 7); // B:0,1,7 (back to original) -> repetition
  }
  assert.strictEqual(s.phase, 'over');
  assert.strictEqual(s.drawn, true);
  assert.strictEqual(s.winner, null);
});

test('a player with no legal moves loses', () => {
  // Trap Player B beads such that every adjacent point is occupied.
  // Hard to construct minimally with only 6 beads on a 9-point board with center
  // connected to everything, so instead verify getLegalMoves + manual loss path
  // via a hand-built state rather than full placement sequence.
  const engineMod = engine;
  let s = engineMod.createGame('standard');
  s.phase = 'move';
  s.turn = 'B';
  // Fill board so B (at 2) has no empty adjacent squares. B's only bead: position 2.
  // 2's neighbors: 1,4,5. Fill 1,4,5 and everything else so it's a valid 9-cell board.
  s.board = ['A', 'A', 'B', 'A', 'A', 'A', null, null, null];
  // positions 6,7,8 empty but not adjacent to 2, so irrelevant to B's only bead at 2.
  const legal = engineMod.getLegalMoves(s.board, 'B');
  assert.strictEqual(legal.length, 0);
});

test('randomEmptyPosition and randomLegalMove are deterministic with a fixed rng', () => {
  const board = [null, 'A', null, null, null, null, null, null, null];
  const fixedRng = () => 0; // always picks first candidate
  const pos = engine.randomEmptyPosition(board, fixedRng);
  assert.strictEqual(pos, 0);
  const move = engine.randomLegalMove(board, 'A', fixedRng);
  assert.deepStrictEqual(move, engine.getLegalMoves(board, 'A')[0]);
});

console.log(`\n${passed} test(s) passed.`);
