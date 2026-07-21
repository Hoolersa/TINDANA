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

console.log('private match tests:');

test('private match is visible in the lobby', () => {
  const manager = new MatchManager({ scheduler: createFakeScheduler() });
  const match = manager.createMatch('standard', 'alice', 'Alice', true);
  const lobby = manager.listLobby();
  assert.strictEqual(lobby.some((m) => m.matchId === match.id), true);
});

test('private match has a generated pass key', () => {
  const manager = new MatchManager({ scheduler: createFakeScheduler() });
  const match = manager.createMatch('standard', 'alice', 'Alice', true);
  assert.ok(typeof match.passKey === 'string' && match.passKey.length > 0);
});

test('private match can still be retrieved directly by id', () => {
  const manager = new MatchManager({ scheduler: createFakeScheduler() });
  const match = manager.createMatch('standard', 'alice', 'Alice', true);
  const fetched = manager.getMatch(match.id);
  assert.strictEqual(fetched, match);
});

test('each created match receives a unique id', () => {
  const manager = new MatchManager({ scheduler: createFakeScheduler() });
  const ids = new Set();
  for (let i = 0; i < 200; i += 1) {
    const match = manager.createMatch('standard', `alice-${i}`, `Alice ${i}`);
    assert.strictEqual(ids.has(match.id), false);
    ids.add(match.id);
  }
});

console.log(`\n${passed} test(s) passed.`);
