'use strict';

const assert = require('assert');
const http = require('http');
const cookie = require('cookie');
const { WebSocket } = require('ws');

process.env.SESSION_SECRET = '0123456789abcdef0123456789abcdef';
process.env.PORT = '0';

const { server } = require('../server/wsServer');
const SESSION_COOKIE_NAME = 'tindana_session';

function waitForServerListen(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve) => server.once('listening', resolve));
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ res, data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function connectWebSocket(port, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: {
        Cookie: cookie,
      },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function receiveWsMessage(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeAllListeners('message');
      ws.removeAllListeners('error');
      ws.removeAllListeners('close');
    };
    ws.once('message', (raw) => {
      cleanup();
      resolve(JSON.parse(raw.toString()));
    });
    ws.once('error', (err) => {
      cleanup();
      reject(err);
    });
    ws.once('close', () => {
      cleanup();
      reject(new Error('WebSocket closed before message'));
    });
  });
}

async function createSession(port) {
  const body = JSON.stringify({ nickname: 'Alice' });
  const { res, data } = await httpRequest({
    hostname: '127.0.0.1',
    port,
    path: '/api/session',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  assert.strictEqual(res.statusCode, 200);
  const cookies = res.headers['set-cookie'];
  assert.ok(Array.isArray(cookies) && cookies.length > 0, 'session cookie missing');
  const parsed = cookie.parse(cookies.join('; '));
  assert.ok(parsed[SESSION_COOKIE_NAME], 'session cookie missing');
  return `${SESSION_COOKIE_NAME}=${parsed[SESSION_COOKIE_NAME]}`;
}

async function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function runTest() {
  await waitForServerListen(server);
  const port = server.address().port;
  const cookie = await createSession(port);

  const ws1 = await connectWebSocket(port, cookie);
  const initialHistory = await receiveWsMessage(ws1);
  assert.strictEqual(initialHistory.type, 'chat_history');
  assert.deepStrictEqual(initialHistory.messages, []);

  ws1.send(JSON.stringify({ type: 'send_chat', text: 'Hello again' }));
  const chatMessage = await receiveWsMessage(ws1);
  assert.strictEqual(chatMessage.type, 'chat_message');
  assert.strictEqual(chatMessage.message.text, 'Hello again');

  ws1.close();

  const ws2 = await connectWebSocket(port, cookie);
  const historyAfterReconnect = await receiveWsMessage(ws2);
  assert.strictEqual(historyAfterReconnect.type, 'chat_history');
  assert.strictEqual(historyAfterReconnect.messages.length, 1);
  assert.strictEqual(historyAfterReconnect.messages[0].text, 'Hello again');
  assert.strictEqual(historyAfterReconnect.messages[0].nickname, 'Alice');

  ws2.close();
  await closeServer(server);
}

runTest()
  .then(() => console.log('wsServer chat history reconnect test passed'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
