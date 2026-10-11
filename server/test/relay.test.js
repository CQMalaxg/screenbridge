'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const WebSocket = require('ws');
const { createRelayServer } = require('../relay');

const relays = new Set();

async function startRelay(options = {}) {
  const relay = createRelayServer({ frameMinIntervalMs: 0, sweepIntervalMs: 1000, ...options });
  const address = await relay.listen(0, '127.0.0.1');
  relays.add(relay);
  return { relay, baseUrl: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}/ws` };
}

async function createPair(baseUrl) {
  const response = await fetch(`${baseUrl}/api/pair`, { method: 'POST' });
  assert.equal(response.status, 201);
  return response.json();
}

function openSocket(url, message) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('error', reject);
    socket.once('open', () => socket.send(JSON.stringify(message)));
    socket.once('message', (data, binary) => {
      let response;
      try { response = JSON.parse(data.toString()); } catch { response = { type: 'binary', binary }; }
      if (response.type === 'error') {
        socket.close();
        reject(new Error(response.message));
      } else resolve({ socket, firstMessage: response });
    });
  });
}

function openIdleSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('error', reject);
    socket.once('open', () => resolve(socket));
  });
}

function rejectedUpgradeStatus(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once('open', () => {
      socket.close();
      reject(new Error('Expected the WebSocket upgrade to be rejected'));
    });
    socket.once('error', reject);
  });
}

function nextJson(socket, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), 1500);
    const onMessage = (data, binary) => {
      if (binary) return;
      let value;
      try { value = JSON.parse(data.toString()); } catch { return; }
      if (value.type !== expectedType) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(value);
    };
    socket.on('message', onMessage);
  });
}

function nextBinary(socket) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for image bytes')), 1500);
    const onMessage = (data, binary) => {
      if (!binary) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(data);
    };
    socket.on('message', onMessage);
  });
}

afterEach(async () => {
  await Promise.all([...relays].map((relay) => relay.close()));
  relays.clear();
});

test('serves the complete browser workbench and creates a short-lived, secret-backed pair', async () => {
  const { baseUrl } = await startRelay({ roomTtlMs: 60_000 });
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy'), /img-src 'self' blob: data:/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self' http: https: wss:/);
  const html = await page.text();
  assert.match(html, /屏幕工作台/);
  assert.match(html, /pairCodeInput/);
  assert.match(html, /stRememberApiKeyInput/);
  assert.match(html, /viewer\.css/);
  assert.match(html, /workbench\.js/);
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  assert.equal((html.match(/<style\b/g) || []).length, 0);
  const css = await fetch(`${baseUrl}/viewer.css`);
  assert.equal(css.status, 200);
  const pageScript = await fetch(`${baseUrl}/viewer.js`);
  assert.equal(pageScript.status, 200);
  assert.match(await pageScript.text(), /pairCodeInput/);
  const workbenchScript = await fetch(`${baseUrl}/workbench.js`);
  assert.equal(workbenchScript.status, 200);
  assert.match(await workbenchScript.text(), /sendFollowUp/);

  const pair = await createPair(baseUrl);
  assert.match(pair.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(pair.secret.length >= 40);
  const room = [...relays][0].rooms.get(pair.code.replace('-', ''));
  assert.ok(room);
  assert.notEqual(room.secretHash.toString('base64'), pair.secret);
});

test('isolates screenshot requests to the matching room and rejects a wrong source secret', async () => {
  const { baseUrl, wsUrl } = await startRelay();
  const [pairA, pairB] = await Promise.all([createPair(baseUrl), createPair(baseUrl)]);

  await assert.rejects(
    openSocket(wsUrl, { type: 'authenticate', code: pairA.code, secret: 'wrong secret' }),
    /采集端认证失败/
  );

  const sourceA = await openSocket(wsUrl, { type: 'authenticate', code: pairA.code, secret: pairA.secret });
  const sourceB = await openSocket(wsUrl, { type: 'authenticate', code: pairB.code, secret: pairB.secret });
  assert.equal(sourceA.firstMessage.type, 'authenticated');
  assert.equal(sourceB.firstMessage.type, 'authenticated');
  const viewerA = await openSocket(wsUrl, { type: 'join', code: pairA.code.toLowerCase() });
  assert.equal(viewerA.firstMessage.type, 'joined');

  const frameRequest = nextJson(sourceA.socket, 'frame-request');
  const viewerResult = nextBinary(viewerA.socket);
  viewerA.socket.send(JSON.stringify({ type: 'request-frame' }));
  const request = await frameRequest;
  assert.ok(request.requestId);
  const screenshot = Buffer.from('private-frame-A');
  sourceA.socket.send(screenshot);
  assert.deepEqual(await viewerResult, screenshot);

  assert.equal(sourceB.socket.readyState, WebSocket.OPEN);
  assert.equal(sourceB.socket.listenerCount('message'), 0);
  for (const socket of [sourceA.socket, sourceB.socket, viewerA.socket]) socket.close();
});

test('forwards the complete source configuration and keeps updates isolated per room', async () => {
  const { baseUrl, wsUrl } = await startRelay();
  const [pairA, pairB] = await Promise.all([createPair(baseUrl), createPair(baseUrl)]);
  const sourceA = await openSocket(wsUrl, { type: 'authenticate', code: pairA.code, secret: pairA.secret });
  const sourceB = await openSocket(wsUrl, { type: 'authenticate', code: pairB.code, secret: pairB.secret });
  const viewerA = await openSocket(wsUrl, { type: 'join', code: pairA.code });
  const viewerB = await openSocket(wsUrl, { type: 'join', code: pairB.code });

  const configA = {
    version: 2,
    autoFallback: true,
    systemPrompt: '回答要简洁',
    chatSystemPrompt: '结合上下文追问',
    vision: {
      activePresetId: 'vision-main',
      presets: [{
        id: 'vision-main',
        name: '主视觉',
        baseUrl: 'https://model-a.example/v1',
        apiBackend: 'chat_completions',
        apiKey: 'secret-a',
        proxyUrl: 'http://proxy-a.example:8080',
        model: 'vision-a',
        priority: 3,
        enabled: true
      }]
    },
    chat: {
      activePresetId: 'chat-main',
      presets: [{
        id: 'chat-main',
        name: '主对话',
        baseUrl: 'https://model-a.example/v1',
        apiBackend: 'responses',
        apiKey: 'secret-a-chat',
        proxyUrl: '',
        model: 'chat-a',
        priority: 1,
        enabled: false
      }]
    },
    promptPresets: {
      vision: [{ id: 'answer', name: '回答格式', text: '先结论后解释' }],
      chat: [{ id: 'follow-up', name: '追问格式', text: '给出可执行步骤' }]
    }
  };
  const configB = { ...configA, systemPrompt: '房间 B 的配置', vision: { ...configA.vision, presets: [{ ...configA.vision.presets[0], apiKey: 'secret-b', model: 'vision-b' }] } };

  const receivedA = nextJson(viewerA.socket, 'source-config');
  sourceA.socket.send(JSON.stringify({ type: 'config', config: configA }));
  assert.deepEqual((await receivedA).config, configA);

  const receivedB = nextJson(viewerB.socket, 'source-config');
  sourceB.socket.send(JSON.stringify({ type: 'config', config: configB }));
  assert.deepEqual((await receivedB).config, configB);

  const updatedA = { ...configA, systemPrompt: '更新后的回答规则', vision: { ...configA.vision, presets: [{ ...configA.vision.presets[0], proxyUrl: 'http://proxy-a-2.example:8080' }] } };
  const receivedUpdate = nextJson(viewerA.socket, 'source-config');
  sourceA.socket.send(JSON.stringify({ type: 'config', config: updatedA }));
  assert.deepEqual((await receivedUpdate).config, updatedA);

  for (const socket of [sourceA.socket, sourceB.socket, viewerA.socket, viewerB.socket]) socket.close();
});

test('rejects an oversized source configuration message', async () => {
  const { baseUrl, wsUrl } = await startRelay({ maxConfigBytes: 256 });
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const errorMessage = nextJson(source.socket, 'error');
  source.socket.send(JSON.stringify({ type: 'config', config: { systemPrompt: 'x'.repeat(1000) } }));
  assert.match((await errorMessage).message, /配置消息超过允许大小/);
});

test('rejects expired codes and refuses a second viewer for an occupied room', async () => {
  const { relay, baseUrl, wsUrl } = await startRelay({ roomTtlMs: 10 });
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  await new Promise((resolve) => setTimeout(resolve, 20));
  relay.sweepExpiredRooms();
  assert.equal(relay.rooms.size, 0);
  source.socket.close();

  const currentPair = await createPair(baseUrl);
  const currentSource = await openSocket(wsUrl, { type: 'authenticate', code: currentPair.code, secret: currentPair.secret });
  const viewer = await openSocket(wsUrl, { type: 'join', code: currentPair.code });
  await assert.rejects(openSocket(wsUrl, { type: 'join', code: currentPair.code }), /已被其他查看设备使用/);
  currentSource.socket.close();
  viewer.socket.close();
});

test('established pairs remain usable after the first-join deadline', async () => {
  const { relay, baseUrl, wsUrl } = await startRelay({ roomTtlMs: 10 });
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const viewer = await openSocket(wsUrl, { type: 'join', code: pair.code });
  const roomCode = pair.code.replace('-', '');

  await new Promise((resolve) => setTimeout(resolve, 25));
  relay.sweepExpiredRooms();
  assert.equal(relay.rooms.has(roomCode), true);
  assert.equal(relay.rooms.get(roomCode).active, true);
  assert.equal(relay.rooms.get(roomCode).expiresAt, null);

  const frameRequest = nextJson(source.socket, 'frame-request');
  const receivedFrame = nextBinary(viewer.socket);
  viewer.socket.send(JSON.stringify({ type: 'request-frame' }));
  await frameRequest;
  source.socket.send(Buffer.from('long-lived-frame'));
  assert.equal((await receivedFrame).toString(), 'long-lived-frame');

  source.socket.send(JSON.stringify({ type: 'stop' }));
});

test('heartbeat pings keep an idle established pair open', async () => {
  const { baseUrl, wsUrl } = await startRelay({ heartbeatIntervalMs: 10 });
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const viewer = await openSocket(wsUrl, { type: 'join', code: pair.code });

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(source.socket.readyState, WebSocket.OPEN);
  assert.equal(viewer.socket.readyState, WebSocket.OPEN);
  source.socket.send(JSON.stringify({ type: 'stop' }));
});

test('disconnecting either peer revokes an established pair and closes the other peer', async () => {
  for (const departingRole of ['source', 'viewer']) {
    const { relay, baseUrl, wsUrl } = await startRelay();
    const pair = await createPair(baseUrl);
    const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
    const viewer = await openSocket(wsUrl, { type: 'join', code: pair.code });
    const departing = departingRole === 'source' ? source.socket : viewer.socket;
    const peer = departingRole === 'source' ? viewer.socket : source.socket;
    const peerClosed = new Promise((resolve) => peer.once('close', resolve));
    departing.close();
    const didPeerClose = await Promise.race([
      peerClosed.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 300))
    ]);

    assert.equal(didPeerClose, true, `${departingRole} disconnect should close its peer`);
    assert.equal(relay.rooms.has(pair.code.replace('-', '')), false);
    await assert.rejects(openSocket(wsUrl, { type: 'join', code: pair.code }), /无效或已过期/);
  }
});

test('stopping the source immediately revokes its pairing code', async () => {
  const { relay, baseUrl, wsUrl } = await startRelay();
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const viewer = await openSocket(wsUrl, { type: 'join', code: pair.code });
  const viewerClosed = new Promise((resolve) => viewer.socket.once('close', resolve));

  source.socket.send(JSON.stringify({ type: 'stop' }));
  await viewerClosed;
  assert.equal(relay.rooms.size, 0);
  await assert.rejects(openSocket(wsUrl, { type: 'join', code: pair.code }), /无效或已过期/);
});

test('bounds idle WebSocket connections and connection attempts', async () => {
  const { wsUrl } = await startRelay({ maxConnections: 1, maxConnectionAttempts: 1 });
  const idleSocket = await openIdleSocket(wsUrl);
  assert.equal(await rejectedUpgradeStatus(wsUrl), 503);

  const idleSocketClosed = new Promise((resolve) => idleSocket.once('close', resolve));
  idleSocket.close();
  await idleSocketClosed;
  let upgradeStatus = 503;
  for (let attempt = 0; attempt < 20 && upgradeStatus === 503; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 10));
    upgradeStatus = await rejectedUpgradeStatus(wsUrl);
  }
  assert.equal(upgradeStatus, 429);
});

test('source reconnects do not consume the viewer pairing-code attempt limit', async () => {
  const { baseUrl, wsUrl } = await startRelay();
  const pair = await createPair(baseUrl);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
    assert.equal(source.firstMessage.type, 'authenticated');
    const sourceClosed = new Promise((resolve) => source.socket.once('close', resolve));
    source.socket.close();
    await sourceClosed;
  }
});
