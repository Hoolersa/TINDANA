'use strict';

const assert = require('assert');
const { MatchManager } = require('../server/matchManager');
const { createFakeScheduler } = require('../server/scheduler');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('match manager tests:');

test('waiting match with offline host is hidden from lobby', () => {
  const scheduler = createFakeScheduler();
  const manager = new MatchManager({ scheduler });
  const match = manager.createMatch('standard', 'alice', 'Alice', false);
  match.markDisconnected('alice');

  const lobby = manager.listLobby();
  assert.strictEqual(lobby.some((m) => m.matchId === match.id), false);
});

test('waiting match with online host is visible in lobby', () => {
  const scheduler = createFakeScheduler();
  const manager = new MatchManager({ scheduler });
  const match = manager.createMatch('standard', 'alice', 'Alice', false);

  const lobby = manager.listLobby();
  assert.strictEqual(lobby.some((m) => m.matchId === match.id), true);
});

console.log(`\n${passed} test(s) passed.`);
