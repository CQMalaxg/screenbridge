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
      requests.push({ endpoint, request });
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
