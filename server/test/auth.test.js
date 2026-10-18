'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const WebSocket = require('ws');
const { createRelayServer } = require('../relay');

const relays = new Set();
const directories = new Set();

async function startRelay(options = {}) {
  const stateDirectory = options.stateDirectory || fs.mkdtempSync(path.join(os.tmpdir(), 'screenbridge-auth-test-'));
  directories.add(stateDirectory);
  const relay = createRelayServer({ stateDirectory, ...options });
  const address = await relay.listen(0, '127.0.0.1');
  relays.add(relay);
  return {
    relay,
    stateDirectory,
    baseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/ws`
  };
}

async function register(baseUrl, username) {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'a sufficiently long password' })
  });
}

async function login(baseUrl, username, password = 'a sufficiently long password') {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

async function proxiedLogin(baseUrl, username, password, address) {
  const target = new URL(baseUrl);
  return fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: {
      Origin: `https://${target.host}`,
      'X-Forwarded-Proto': 'https',
      'X-Real-IP': address,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username, password })
  });
}

function proxyRegister(baseUrl, headers, body) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(body), ...headers }
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end(body);
  });
}

function cookieHeader(response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

async function session(baseUrl, cookies) {
  const response = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookies } });
  assert.equal(response.status, 200);
  return response.json();
}

function openSocket(url, message, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.once('error', reject);
    socket.once('open', () => socket.send(JSON.stringify(message)));
    socket.once('message', (data, binary) => {
      let value;
      try { value = JSON.parse(data.toString()); } catch { value = { type: 'binary', binary }; }
      if (value.type === 'error') {
        socket.close();
        reject(Object.assign(new Error(value.message), { response: value }));
      } else resolve({ socket, firstMessage: value });
    });
  });
}

async function createPair(baseUrl) {
  const response = await fetch(`${baseUrl}/api/pair`, { method: 'POST' });
  assert.equal(response.status, 201);
  return response.json();
}

afterEach(async () => {
  await Promise.all([...relays].map((relay) => relay.close()));
  relays.clear();
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

test('registration stores only password and token hashes and sets hardened session cookies', async () => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'screenbridge-auth-test-'));
  directories.add(stateDirectory);
  fs.chmodSync(stateDirectory, 0o755);
  const { baseUrl } = await startRelay({ stateDirectory });
  const response = await register(baseUrl, 'safe_user');
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  assert.match(cookies[0], /^__Host-screenbridge_session=.*; Path=\/; Secure; HttpOnly; SameSite=Strict;/);
  assert.match(cookies[1], /^__Host-screenbridge_csrf=.*; Path=\/; Secure; SameSite=Strict;/);
  assert.doesNotMatch(cookies[1], /HttpOnly/);

  const body = await response.json();
  assert.match(body.user.id, /^[0-9a-f-]{36}$/);
  assert.equal(body.user.username, 'safe_user');
  const stateText = fs.readFileSync(path.join(stateDirectory, 'security-state.json'), 'utf8');
  const state = JSON.parse(stateText);
  assert.equal(state.users[0].username, 'safe_user');
  assert.notEqual(state.users[0].passwordHash, 'a sufficiently long password');
  assert.ok(state.users[0].passwordSalt);
  assert.equal(state.sessions.length, 1);
  assert.doesNotMatch(stateText, /a sufficiently long password|__Host-screenbridge_session/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(stateDirectory, 'security-state.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(stateDirectory).mode & 0o777, 0o700);
  }

  const sessionData = await session(baseUrl, cookieHeader(response));
  assert.equal(sessionData.user.username, 'safe_user');
  assert.equal(sessionData.csrfToken.length, 43);
});

test('cross-origin authentication, invalid passwords and missing CSRF tokens are rejected', async () => {
  const { baseUrl } = await startRelay();
  const crossSite = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'blocked_user', password: 'a sufficiently long password' })
  });
  assert.equal(crossSite.status, 403);

  const created = await register(baseUrl, 'private_user');
  assert.equal(created.status, 200);
  const badPassword = await login(baseUrl, 'private_user', 'wrong password value');
  const unknownUser = await login(baseUrl, 'unknown_user', 'wrong password value');
  assert.equal(badPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(await badPassword.json(), await unknownUser.json());

  const cookies = cookieHeader(created);
  const missingCsrf = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: cookies }
  });
  assert.equal(missingCsrf.status, 403);

  const sessionData = await session(baseUrl, cookies);
  const wrongCsrf = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: cookies, 'X-CSRF-Token': 'wrong-token' }
  });
  assert.equal(wrongCsrf.status, 403);
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: cookies, 'X-CSRF-Token': sessionData.csrfToken }
  });
  assert.equal(logout.status, 200);
  assert.equal((await session(baseUrl, cookies)).user, null);
});

test('trusted proxy deployments reject public HTTP origins unless TLS termination is attested', async () => {
  const { baseUrl } = await startRelay({ trustProxy: true });
  const origin = 'https://screenbridge.example';
  const body = JSON.stringify({ username: 'proxied_user', password: 'a sufficiently long password' });
  const insecure = await proxyRegister(baseUrl, {
    Host: 'screenbridge.example', Origin: origin, 'Content-Type': 'application/json'
  }, body);
  assert.equal(insecure, 403);

  const secure = await proxyRegister(baseUrl, {
    Host: 'screenbridge.example',
    Origin: origin,
    'X-Forwarded-Proto': 'https',
    'Content-Type': 'application/json'
  }, body);
  assert.equal(secure, 200);

  const untrusted = await startRelay({ trustProxy: true, trustedProxyAddresses: [] });
  const spoofed = await proxyRegister(untrusted.baseUrl, {
    Host: 'screenbridge.example',
    Origin: origin,
    'X-Forwarded-Proto': 'https',
    'Content-Type': 'application/json'
  }, JSON.stringify({ username: 'spoofed_proxy', password: 'a sufficiently long password' }));
  assert.equal(spoofed, 403);
});

test('login attempts are rate limited by both client address and account name', async () => {
  const { baseUrl } = await startRelay();
  const statuses = [];
  for (let index = 0; index < 9; index += 1) {
    const response = await login(baseUrl, 'relaytest', 'wrong password value');
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
  assert.equal(statuses[8], 429);
});

test('account-wide failed login throttling never locks out the correct password', async () => {
  const { baseUrl } = await startRelay({ trustProxy: true });
  const publicHost = 'screenbridge.example';
  const registration = await proxyRegister(baseUrl, {
    Host: publicHost,
    Origin: `https://${publicHost}`,
    'X-Forwarded-Proto': 'https',
    'Content-Type': 'application/json'
  }, JSON.stringify({ username: 'available_user', password: 'a sufficiently long password' }));
  assert.equal(registration, 200);

  for (let index = 1; index <= 8; index += 1) {
    const response = await proxiedLogin(baseUrl, 'available_user', 'incorrect password', `198.51.100.${index}`);
    assert.equal(response.status, 401);
  }
  const throttledFailure = await proxiedLogin(baseUrl, 'available_user', 'incorrect password', '198.51.100.9');
  assert.equal(throttledFailure.status, 429);

  const validLogin = await proxiedLogin(baseUrl, 'available_user', 'a sufficiently long password', '198.51.100.10');
  assert.equal(validLogin.status, 200);
  const nextFailure = await proxiedLogin(baseUrl, 'available_user', 'incorrect password', '198.51.100.11');
  assert.equal(nextFailure.status, 401);
});

test('only the owning account can connect or revoke a paired device; origin and logout invalidate sockets', async () => {
  const { baseUrl, wsUrl, relay } = await startRelay();
  const ownerLogin = await register(baseUrl, 'device_owner');
  const otherLogin = await register(baseUrl, 'other_owner');
  const ownerCookies = cookieHeader(ownerLogin);
  const otherCookies = cookieHeader(otherLogin);
  const ownerSession = await session(baseUrl, ownerCookies);
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const ownerViewer = await openSocket(wsUrl, { type: 'join', code: pair.code }, { Origin: baseUrl, Cookie: ownerCookies });
  assert.equal(ownerViewer.firstMessage.type, 'joined');

  await assert.rejects(
    openSocket(wsUrl, { type: 'connect-device', deviceId: ownerViewer.firstMessage.deviceId }, { Origin: baseUrl, Cookie: otherCookies }),
    /不存在或无权访问/
  );
  await assert.rejects(
    openSocket(wsUrl, { type: 'connect-device', deviceId: ownerViewer.firstMessage.deviceId }, { Origin: 'https://attacker.example', Cookie: ownerCookies }),
    /登录并从账号设备列表连接/
  );
  await assert.rejects(
    openSocket(wsUrl, { type: 'connect-device', deviceId: ownerViewer.firstMessage.deviceId }, { Cookie: ownerCookies }),
    /登录并从账号设备列表连接/
  );

  const crossOriginRevoke = await fetch(`${baseUrl}/api/devices/${ownerViewer.firstMessage.deviceId}`, {
    method: 'DELETE',
    headers: { Origin: 'https://attacker.example', Cookie: ownerCookies, 'X-CSRF-Token': ownerSession.csrfToken }
  });
  assert.equal(crossOriginRevoke.status, 403);
  const ownerClosed = new Promise((resolve) => ownerViewer.socket.once('close', resolve));
  const revoke = await fetch(`${baseUrl}/api/devices/${ownerViewer.firstMessage.deviceId}`, {
    method: 'DELETE',
    headers: { Origin: baseUrl, Cookie: ownerCookies, 'X-CSRF-Token': ownerSession.csrfToken }
  });
  assert.equal(revoke.status, 200);
  await ownerClosed;
  assert.equal(relay.rooms.size, 0);
  await assert.rejects(openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret }), /认证失败/);
  await assert.rejects(
    openSocket(wsUrl, { type: 'connect-device', deviceId: ownerViewer.firstMessage.deviceId }, { Origin: baseUrl, Cookie: ownerCookies }),
    /不存在或无权访问/
  );
  source.socket.close();
});

test('logout invalidates an existing viewer connection and every later device lookup', async () => {
  const { baseUrl, wsUrl } = await startRelay();
  const registered = await register(baseUrl, 'logout_user');
  const cookies = cookieHeader(registered);
  const csrf = (await session(baseUrl, cookies)).csrfToken;
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const viewer = await openSocket(wsUrl, { type: 'join', code: pair.code }, { Origin: baseUrl, Cookie: cookies });
  const closed = new Promise((resolve) => viewer.socket.once('close', resolve));
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: baseUrl, Cookie: cookies, 'X-CSRF-Token': csrf }
  });
  assert.equal(response.status, 200);
  await closed;
  const devices = await fetch(`${baseUrl}/api/devices`, { headers: { Cookie: cookies } });
  assert.equal(devices.status, 401);
  source.socket.close();
});

test('the desktop device secret can revoke its own server registration after the socket is offline', async () => {
  const { baseUrl, wsUrl, relay } = await startRelay();
  const registered = await register(baseUrl, 'device_stop_user');
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const viewer = await openSocket(wsUrl, { type: 'join', code: pair.code }, {
    Origin: baseUrl,
    Cookie: cookieHeader(registered)
  });

  const wrongSecret = await fetch(`${baseUrl}/api/device/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pair.code, secret: 'x'.repeat(43) })
  });
  assert.equal(wrongSecret.status, 401);
  assert.equal(relay.rooms.size, 1);

  const sourceClosed = new Promise((resolve) => source.socket.once('close', resolve));
  source.socket.close();
  await sourceClosed;
  const viewerClosed = new Promise((resolve) => viewer.socket.once('close', resolve));
  const revoke = await fetch(`${baseUrl}/api/device/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pair.code, secret: pair.secret })
  });
  assert.equal(revoke.status, 200);
  await viewerClosed;
  assert.equal(relay.rooms.size, 0);
  await assert.rejects(openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret }), /认证失败/);
});

test('expired account sessions cannot keep using an already-open viewer socket', async () => {
  let currentTime = Date.now();
  const { baseUrl, wsUrl, relay } = await startRelay({ now: () => currentTime, heartbeatIntervalMs: 1000 });
  const registered = await register(baseUrl, 'expiry_user');
  const pair = await createPair(baseUrl);
  const source = await openSocket(wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const viewer = await openSocket(wsUrl, { type: 'join', code: pair.code }, {
    Origin: baseUrl,
    Cookie: cookieHeader(registered)
  });
  const closed = new Promise((resolve) => viewer.socket.once('close', resolve));
  currentTime += 31 * 24 * 60 * 60 * 1000;
  viewer.socket.send(JSON.stringify({ type: 'request-frame' }));
  await closed;
  assert.equal(relay.rooms.get(pair.code.replace('-', '')).viewer, null);
  source.socket.close();
});

test('bound device and account recover after relay restart without persisting frames or config', async () => {
  const first = await startRelay();
  const registered = await register(first.baseUrl, 'persistent_user');
  const cookies = cookieHeader(registered);
  const pair = await createPair(first.baseUrl);
  const source = await openSocket(first.wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  const viewer = await openSocket(first.wsUrl, { type: 'join', code: pair.code }, { Origin: first.baseUrl, Cookie: cookies });
  const statePath = path.join(first.stateDirectory, 'security-state.json');

  source.socket.send(JSON.stringify({ type: 'config', config: { apiKey: 'private-config-marker' } }));
  const frame = new Promise((resolve) => {
    const onMessage = (_data, binary) => {
      if (!binary) return;
      viewer.socket.off('message', onMessage);
      resolve();
    };
    viewer.socket.on('message', onMessage);
    viewer.socket.send(JSON.stringify({ type: 'request-frame' }));
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  source.socket.send(Buffer.from('private-frame-marker'));
  await frame;
  const boundStateText = fs.readFileSync(statePath, 'utf8');
  assert.doesNotMatch(boundStateText, /private-config-marker|private-frame-marker/);
  assert.doesNotMatch(boundStateText, new RegExp(pair.secret));
  const boundState = JSON.parse(boundStateText);
  assert.deepEqual(Object.keys(boundState.devices[0]).sort(), ['code', 'createdAt', 'id', 'lastSeenAt', 'secretHash', 'userId'].sort());
  assert.notEqual(boundState.devices[0].secretHash, pair.secret);

  source.socket.close();
  viewer.socket.close();
  await first.relay.close();
  relays.delete(first.relay);

  const second = await startRelay({ stateDirectory: first.stateDirectory });
  const resumedSource = await openSocket(second.wsUrl, { type: 'authenticate', code: pair.code, secret: pair.secret });
  assert.equal(resumedSource.firstMessage.type, 'authenticated');
  const deviceList = await fetch(`${second.baseUrl}/api/devices`, { headers: { Cookie: cookies } });
  const { devices } = await deviceList.json();
  assert.equal(deviceList.status, 200);
  assert.equal(devices.length, 1);
  const resumedViewer = await openSocket(second.wsUrl, { type: 'connect-device', deviceId: devices[0].id }, {
    Origin: second.baseUrl,
    Cookie: cookies
  });
  assert.equal(resumedViewer.firstMessage.type, 'joined');
  resumedSource.socket.close();
  resumedViewer.socket.close();
});
