'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const viewerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'viewer.js'), 'utf8');

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function createViewer(options = {}) {
  const localStorage = createLocalStorage();
  const requests = [];
  const window = { addEventListener() {} };
  const context = vm.createContext({
    AbortController,
    URL,
    TextDecoder,
    clearTimeout,
    document: { getElementById: () => null },
    fetch: async (endpoint, request) => {
      if (endpoint === '/api/auth/session') return { ok: true, status: 200, json: async () => ({ user: null, csrfToken: '' }) };
      requests.push({ endpoint, request });
      if (options.fetch) return options.fetch(endpoint, request);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: null,
        json: async () => ({ choices: [{ message: { content: '测试回答' } }] })
      };
    },
    localStorage,
    setTimeout,
    window
  });
  vm.runInContext(viewerSource, context, { filename: 'viewer.js' });
  return { api: window.assistantAPI, localStorage, requests, ...options };
}

function createPairingPage(pairStorage = createLocalStorage(), options = {}) {
  const elements = new Map();
  const state = {
    user: options.user || null,
    csrfToken: options.csrfToken || 'C'.repeat(43),
    devices: options.devices || []
  };
  const makeElement = () => {
    const element = {
      addEventListener(type, callback) { this.listeners = this.listeners || new Map(); this.listeners.set(type, callback); },
      classList: { toggle() {} },
      style: {},
      value: '',
      textContent: '',
      disabled: false,
      hidden: false,
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((entry) => entry !== child); return child; },
      get firstChild() { return this.children[0] || null; }
    };
    return element;
  };
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    createElement() { return makeElement(); }
  };
  const eventHandlers = new Map();
  const timers = new Map();
  const sockets = [];
  let timerId = 0;
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
    open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
    async message(value) { await this.onmessage?.({ data: JSON.stringify(value) }); }
    remoteClose(reason = '') { this.readyState = 3; this.onclose?.({ reason }); }
  }
  const window = { addEventListener(type, callback) { eventHandlers.set(type, callback); }, confirm: () => true };
  vm.runInContext(viewerSource, vm.createContext({
    AbortController,
    URL,
    TextDecoder,
    clearTimeout(id) { timers.delete(id); },
    document,
    fetch: async (endpoint, request = {}) => {
      const record = { endpoint, request };
      eventHandlers.requests = eventHandlers.requests || [];
      eventHandlers.requests.push(record);
      if (endpoint === '/api/devices' && options.beforeDeviceList) await options.beforeDeviceList(state);
      if (options.fetch) return options.fetch(endpoint, request, state);
      if (endpoint === '/api/auth/session') return { ok: true, status: 200, json: async () => ({ user: state.user, csrfToken: state.csrfToken }) };
      if (endpoint === '/api/devices') return { ok: true, status: 200, json: async () => ({ devices: state.devices }) };
      if (endpoint === '/api/auth/logout') { state.user = null; return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
      if (endpoint === '/api/auth/login' || endpoint === '/api/auth/register') {
        const submitted = JSON.parse(request.body || '{}');
        state.user ||= { id: '11111111-1111-4111-8111-111111111111', username: submitted.username || 'test_user' };
        return { ok: true, status: 200, json: async () => ({ user: state.user }) };
      }
      if (endpoint.startsWith('/api/devices/') && request.method === 'DELETE') {
        state.devices = state.devices.filter((device) => endpoint !== `/api/devices/${device.id}`);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
    location: { host: 'screenbridge.example', protocol: 'https:' },
    localStorage: pairStorage,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    WebSocket: FakeWebSocket,
    window
  }), { filename: 'viewer.js' });
  return {
    api: window.assistantAPI,
    elements,
    element: (id) => document.getElementById(id),
    eventHandlers,
    requests: eventHandlers.requests,
    sockets,
    timers,
    state,
    async ready() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
  };
}

function makeConfig(baseUrl, apiBackend = 'responses', apiKey = '') {
  return {
    version: 2,
    autoFallback: false,
    systemPrompt: '系统提示词',
    chatSystemPrompt: '追问系统提示词',
    vision: {
      activePresetId: 'vision-main',
      presets: [{
        id: 'vision-main',
        name: '视觉主模型',
        baseUrl,
        model: 'vision-test',
        apiBackend,
        apiKey,
        proxyUrl: '',
        enabled: true,
        priority: 1,
        rememberApiKey: false
      }]
    },
    chat: {
      activePresetId: 'chat-main',
      presets: [{
        id: 'chat-main',
        name: '对话主模型',
        baseUrl: 'https://chat.example/v1',
        model: 'chat-test',
        apiBackend: 'responses',
        apiKey: '',
        proxyUrl: '',
        enabled: true,
        priority: 1,
        rememberApiKey: false
      }]
    },
    promptPresets: { vision: [], chat: [] }
  };
}

test('source config lifecycle preserves the browser-only API key for local config restoration', async () => {
  const { api } = createViewer();
  await api.saveConfig(makeConfig('https://local.example/v1', 'responses', 'browser-session-key'));

  api.applySourceConfig(makeConfig('https://source.example/v1', 'responses', 'source-key'));
  assert.equal((await api.getConfig()).vision.presets[0].apiKey, 'source-key');

  api.clearSourceConfig();
  const restored = await api.getConfig();
  assert.equal(restored.vision.presets[0].baseUrl, 'https://local.example/v1');
  assert.equal(restored.vision.presets[0].apiKey, 'browser-session-key');
});

test('browser resolves the same chat-completions backend for special model endpoints as desktop', async () => {
  const hosts = ['right.codes', 'www.right.codes', 'right.ai', 'www.right.ai', 'rightapi.ai', 'www.rightapi.ai'];

  for (const host of hosts) {
    const { api, requests } = createViewer();
    api.applySourceConfig(makeConfig(`https://${host}/v1`, 'responses', 'source-key'));
    const result = await api.analyzeImage({
      imageDataUrls: ['data:image/png;base64,dGVzdA=='],
      prompt: '分析图片',
      presetId: 'vision-main'
    });

    assert.equal(result.ok, true, host);
    assert.equal(requests.length, 1, host);
    assert.equal(requests[0].endpoint, `https://${host}/v1/chat/completions`, host);
    const requestBody = JSON.parse(requests[0].request.body);
    assert.ok(Array.isArray(requestBody.messages), host);
    assert.equal(requestBody.input, undefined, host);
  }
});

test('Responses follow-ups encode assistant history as output_text and user history as input_text', async () => {
  const { api, requests } = createViewer({
    fetch: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      json: async () => ({ output_text: '继续回答' })
    })
  });
  const config = makeConfig('https://vision.example/v1');
  config.chat.presets[0].apiBackend = 'responses';
  config.chat.presets[0].model = 'reasoning-model';
  api.applySourceConfig(config);

  const result = await api.chatFollowUp({
    history: [
      { role: 'user', content: '第一题' },
      { role: 'assistant', content: '第一条回答' },
      { role: 'user', content: '继续解释' }
    ],
    imageDataUrls: ['data:image/png;base64,dGVzdA==']
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, 'https://chat.example/v1/responses');
  const body = JSON.parse(requests[0].request.body);
  assert.deepEqual(body.input.map((item) => item.role), ['user', 'assistant', 'user']);
  assert.deepEqual(body.input[0].content, [
    { type: 'input_image', image_url: 'data:image/png;base64,dGVzdA==', detail: 'high' },
    { type: 'input_text', text: '第一题' }
  ]);
  assert.deepEqual(body.input[1].content, [{ type: 'output_text', text: '第一条回答' }]);
  assert.deepEqual(body.input[2].content, [{ type: 'input_text', text: '继续解释' }]);
});

test('follow-ups use the model explicitly selected for this message without trying priority fallbacks', async () => {
  const { api, requests } = createViewer({
    fetch: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: null,
      json: async () => ({ output_text: '已由备用模型回答' })
    })
  });
  const config = makeConfig('https://vision.example/v1');
  config.autoFallback = true;
  config.chat.presets.push({
    id: 'chat-fast',
    name: '快速模型',
    baseUrl: 'https://fast-chat.example/v1',
    model: 'fast-chat',
    apiBackend: 'responses',
    apiKey: 'fast-key',
    proxyUrl: '',
    enabled: true,
    priority: 99
  });
  api.applySourceConfig(config);

  const result = await api.chatFollowUp({
    history: [{ role: 'user', content: '简要解释' }],
    presetId: 'chat-fast'
  });

  assert.equal(result.ok, true);
  assert.equal(result.presetId, 'chat-fast');
  assert.equal(result.presetName, '快速模型');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, 'https://fast-chat.example/v1/responses');
  assert.equal(JSON.parse(requests[0].request.body).model, 'fast-chat');
});

test('failed model requests do not wait for or automatically invoke another configured model', async () => {
  const { api, requests } = createViewer({
    fetch: async () => ({
      ok: false,
      status: 503,
      statusText: 'Unavailable',
      text: async () => 'selected model unavailable'
    })
  });
  const config = makeConfig('https://vision.example/v1');
  config.autoFallback = true;
  config.chat.presets.push({
    id: 'chat-fast',
    name: '快速模型',
    baseUrl: 'https://fast-chat.example/v1',
    model: 'fast-chat',
    apiBackend: 'responses',
    apiKey: 'fast-key',
    proxyUrl: '',
    enabled: true,
    priority: 1
  });
  api.applySourceConfig(config);

  const result = await api.chatFollowUp({
    history: [{ role: 'user', content: '简要解释' }],
    presetId: 'chat-main'
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /selected model unavailable/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint, 'https://chat.example/v1/responses');
});

test('chat follow-up errors include the model service HTTP 400 response body', async () => {
  const { api } = createViewer({
    fetch: async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"error":{"message":"unknown model"}}'
    })
  });
  const config = makeConfig('https://vision.example/v1');
  config.chat.presets[0].apiBackend = 'chat_completions';
  api.applySourceConfig(config);

  const result = await api.chatFollowUp({ history: [{ role: 'user', content: '继续解释' }] });

  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 400 Bad Request/);
  assert.match(result.error, /unknown model/);
});

test('an explicitly removed preset fails without sending the message to the default model', async () => {
  const { api, requests } = createViewer();
  api.applySourceConfig(makeConfig('https://vision.example/v1'));

  const result = await api.chatFollowUp({
    history: [{ role: 'user', content: 'do not send this to another model' }],
    presetId: 'removed-preset'
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /重新选择/);
  assert.equal(requests.length, 0);
});

test('viewer refresh and network recovery reconnect by account device id without storing a bearer token', async () => {
  const pairStorage = createLocalStorage();
  const user = { id: '11111111-1111-4111-8111-111111111111', username: 'test_user' };
  const device = { id: '22222222-2222-4222-8222-222222222222', code: 'ABCD-EFGH', codeHint: 'EFGH', online: true };
  const firstPage = createPairingPage(pairStorage, { user });
  await firstPage.ready();
  firstPage.elements.get('pairCodeInput').value = 'ABCD-EFGH';
  firstPage.elements.get('pairForm').listeners.get('submit')({ preventDefault() {} });
  const initialSocket = firstPage.sockets[0];
  initialSocket.open();
  assert.deepEqual(initialSocket.sent[0], { type: 'join', code: 'ABCDEFGH' });
  firstPage.state.devices.push(device);
  await initialSocket.message({ type: 'joined', deviceId: device.id, sourceOnline: true });
  assert.equal(pairStorage.getItem(`screenbridge.browser.last-device.v1.${user.id}`), device.id);
  assert.equal(pairStorage.getItem('screenbridge.browser.pair-session.v1'), null);

  const refreshedPage = createPairingPage(pairStorage, { user, devices: [device] });
  await refreshedPage.ready();
  assert.equal(refreshedPage.sockets.length, 1);
  refreshedPage.sockets[0].open();
  assert.deepEqual(refreshedPage.sockets[0].sent[0], { type: 'connect-device', deviceId: device.id });
  await refreshedPage.sockets[0].message({ type: 'joined', deviceId: device.id, sourceOnline: true });
  assert.match(refreshedPage.elements.get('pairStatus').textContent, /已连接采集电脑/);

  refreshedPage.sockets[0].remoteClose();
  const [retryId, retry] = [...refreshedPage.timers.entries()][0];
  assert.ok(retry.delay >= 750 && retry.delay <= 1250);
  refreshedPage.timers.delete(retryId);
  retry.callback();
  assert.equal(refreshedPage.sockets.length, 2);
  refreshedPage.sockets[1].open();
  assert.deepEqual(refreshedPage.sockets[1].sent[0], { type: 'connect-device', deviceId: device.id });
  await refreshedPage.sockets[1].message({ type: 'joined', deviceId: device.id, sourceOnline: true });
  refreshedPage.elements.get('disconnectPairButton').listeners.get('click')();
  assert.equal(refreshedPage.sockets[1].sent.at(-1).type, 'disconnect');
  assert.equal(pairStorage.getItem(`screenbridge.browser.auto-reconnect.v1.${user.id}`), 'false');
});

test('a new browser auto-connects to the account device and waits for an offline source', async () => {
  const user = { id: '33333333-3333-4333-8333-333333333333', username: 'tablet_user' };
  const device = { id: '44444444-4444-4444-8444-444444444444', code: 'JKLM-NPQR', codeHint: 'NPQR', online: false };
  const pairStorage = createLocalStorage();
  const page = createPairingPage(pairStorage, { user, devices: [device] });
  await page.ready();
  assert.equal(page.sockets.length, 1);
  page.sockets[0].open();
  assert.deepEqual(page.sockets[0].sent[0], { type: 'connect-device', deviceId: device.id });
  await page.sockets[0].message({ type: 'joined', deviceId: device.id, sourceOnline: false });
  assert.match(page.elements.get('pairStatus').textContent, /等待自动重连/);
  await page.sockets[0].message({ type: 'source-connected' });
  assert.match(page.elements.get('pairStatus').textContent, /重新连接/);

  page.elements.get('disconnectPairButton').listeners.get('click')();
  const nextBrowser = createPairingPage(pairStorage, { user, devices: [device] });
  await nextBrowser.ready();
  assert.equal(nextBrowser.sockets.length, 0);
});

test('account registration transitions to device binding without putting credentials in browser storage', async () => {
  const page = createPairingPage(createLocalStorage());
  await page.ready();
  page.elements.get('registerModeButton').listeners.get('click')();
  page.element('accountUsernameInput').value = 'new_user';
  page.element('accountPasswordInput').value = 'a sufficiently long password';
  await page.elements.get('accountForm').listeners.get('submit')({ preventDefault() {} });

  const registration = page.requests.find((entry) => entry.endpoint === '/api/auth/register');
  assert.equal(registration.request.method, 'POST');
  assert.equal(JSON.parse(registration.request.body).username, 'new_user');
  assert.equal(page.elements.get('accountDevicesPanel').hidden, false);
  assert.equal(page.elements.get('pairForm').hidden, false);
  assert.equal(page.state.user.username, 'new_user');
});

test('account controls use CSRF for logout and device revocation', async () => {
  const user = { id: '55555555-5555-4555-8555-555555555555', username: 'owner_user' };
  const device = { id: '66666666-6666-4666-8666-666666666666', code: 'WXYZ-2345', codeHint: '2345', online: false };
  const page = createPairingPage(createLocalStorage(), { user, devices: [device] });
  await page.ready();
  const select = page.elements.get('accountDeviceSelect');
  select.value = device.id;
  page.elements.get('revokeDeviceButton').listeners.get('click')();
  await page.ready();
  const revoke = page.requests.find((entry) => entry.endpoint === `/api/devices/${device.id}`);
  assert.equal(revoke.request.method, 'DELETE');
  assert.equal(revoke.request.headers['X-CSRF-Token'], 'C'.repeat(43));
  assert.equal(page.state.devices.length, 0);

  await page.elements.get('logoutButton').listeners.get('click')();
  const logout = page.requests.find((entry) => entry.endpoint === '/api/auth/logout');
  assert.equal(logout.request.method, 'POST');
  assert.equal(logout.request.headers['X-CSRF-Token'], 'C'.repeat(43));
});

test('callbacks from a replaced pairing socket cannot alter the current account device', async () => {
  const user = { id: '77777777-7777-4777-8777-777777777777', username: 'stable_user' };
  const pairStorage = createLocalStorage();
  const page = createPairingPage(pairStorage, { user });
  await page.ready();
  page.elements.get('pairCodeInput').value = 'ABCD-EFGH';
  page.elements.get('pairForm').listeners.get('submit')({ preventDefault() {} });
  const staleSocket = page.sockets[0];
  const staleOpen = staleSocket.onopen;
  const staleMessage = staleSocket.onmessage;
  const staleError = staleSocket.onerror;
  staleSocket.open();
  await staleSocket.message({ type: 'joined', deviceId: '88888888-8888-4888-8888-888888888888', sourceOnline: true });

  page.elements.get('disconnectPairButton').listeners.get('click')();
  page.elements.get('pairCodeInput').value = 'JKLM-NPQR';
  page.elements.get('pairForm').listeners.get('submit')({ preventDefault() {} });
  const currentSocket = page.sockets[1];
  currentSocket.open();
  const currentDeviceId = '99999999-9999-4999-8999-999999999999';
  page.state.devices.push({ id: currentDeviceId, code: 'JKLM-NPQR', codeHint: 'NPQR', online: true });
  await currentSocket.message({ type: 'joined', deviceId: currentDeviceId, sourceOnline: true });
  const currentStatus = page.elements.get('pairStatus').textContent;
  const staleSentCount = staleSocket.sent.length;

  staleOpen();
  await staleMessage({ data: JSON.stringify({ type: 'source-disconnected', message: '旧会话已断开' }) });
  await staleMessage({ data: JSON.stringify({
    type: 'source-config',
    config: { version: 2, vision: { presets: [{ id: 'stale', name: 'stale', model: 'stale-model' }] } }
  }) });
  staleError();

  assert.equal(staleSocket.sent.length, staleSentCount);
  assert.equal(page.elements.get('pairStatus').textContent, currentStatus);
  assert.equal(currentSocket.readyState, 1);
  assert.equal(pairStorage.getItem(`screenbridge.browser.last-device.v1.${user.id}`), currentDeviceId);
  assert.notEqual((await page.api.getConfig()).vision.presets[0].model, 'stale-model');
});

test('manual disconnect during bound-device lookup prevents the resolver from reconnecting', async () => {
  const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'race_user' };
  const device = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'ABCD-EFGH', codeHint: 'EFGH', online: true };
  let holdDeviceList = false;
  let releaseDeviceList;
  let markDeviceListStarted;
  const deviceListStarted = new Promise((resolve) => { markDeviceListStarted = resolve; });
  const page = createPairingPage(createLocalStorage(), {
    user,
    devices: [],
    beforeDeviceList: async () => {
      if (!holdDeviceList) return;
      markDeviceListStarted();
      await new Promise((resolve) => { releaseDeviceList = resolve; });
    }
  });
  await page.ready();

  page.state.devices.push(device);
  holdDeviceList = true;
  page.element('pairCodeInput').value = device.code;
  page.elements.get('pairForm').listeners.get('submit')({ preventDefault() {} });
  const lookupSocket = page.sockets[0];
  lookupSocket.open();
  await lookupSocket.message({ type: 'error', message: '该设备已绑定，请从账号设备列表连接。' });
  await deviceListStarted;

  page.elements.get('disconnectPairButton').listeners.get('click')();
  releaseDeviceList();
  await page.ready();

  assert.equal(page.sockets.length, 1);
  assert.equal(page.sockets[0].sent[0].type, 'join');
  assert.equal(page.elements.get('pairStatus').textContent, '已断开连接');
});
