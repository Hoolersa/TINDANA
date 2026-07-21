'use strict';

const assert = require('assert');
const { ChatManager, ChatError } = require('../server/chatManager');

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

console.log('chatManager tests:');

test('addMessage accepts valid text and returns a message object', () => {
  const cm = new ChatManager({ now: () => 1000 });
  const msg = cm.addMessage('alice', 'Alice', 'hello');
  assert.strictEqual(msg.nickname, 'Alice');
  assert.strictEqual(msg.text, 'hello');
  assert.strictEqual(typeof msg.messageId, 'string');
  assert.strictEqual(msg.timestamp, 1000);
});

test('addMessage rejects empty messages', () => {
  const cm = new ChatManager();
  assert.throws(() => cm.addMessage('alice', 'Alice', '  '), ChatError);
});

test('addMessage rejects messages over max length', () => {
  const cm = new ChatManager({ maxLength: 5 });
  assert.throws(() => cm.addMessage('alice', 'Alice', 'abcdef'), ChatError);
});

test('rate limiting blocks too many messages in a window', () => {
  let now = 0;
  const cm = new ChatManager({ now: () => now, rateLimitWindowMs: 1000, maxMessagesPerWindow: 2 });
  cm.addMessage('alice', 'Alice', 'one');
  cm.addMessage('alice', 'Alice', 'two');
  assert.throws(() => cm.addMessage('alice', 'Alice', 'three'), ChatError);
  now = 1500;
  const msg = cm.addMessage('alice', 'Alice', 'four');
  assert.strictEqual(msg.text, 'four');
});

test('reportMessage increments report count for an existing message', () => {
  const cm = new ChatManager();
  const msg = cm.addMessage('alice', 'Alice', 'hello');
  const report = cm.reportMessage(msg.messageId);
  assert.strictEqual(report.messageId, msg.messageId);
  assert.strictEqual(report.reports, 1);
});

test('reportMessage rejects invalid message IDs', () => {
  const cm = new ChatManager();
  assert.throws(() => cm.reportMessage('missing'), ChatError);
});

test('getHistory returns stored messages in order', () => {
  const cm = new ChatManager();
  cm.addMessage('alice', 'Alice', 'hello');
  cm.addMessage('bob', 'Bob', 'hi');
  const history = cm.getHistory();
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].text, 'hello');
  assert.strictEqual(history[1].text, 'hi');
});

console.log(`\n${passed} test(s) passed.`);
