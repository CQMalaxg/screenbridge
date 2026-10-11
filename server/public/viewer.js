'use strict';

window.SCREENBRIDGE_BROWSER_WORKBENCH = true;

const CONFIG_KEY = 'screenbridge.browser.config.v1';
const KEYS_KEY = 'screenbridge.browser.keys.v1';
const eventHandlers = new Map();
const sessionKeys = new Map();
let pairSocket = null;
let pairConnected = false;
let pendingFrame = null;
let activeAbortController = null;
let runtimeConfig = null;

const defaultSystemPrompt = '你是一个面试练习助手。请准确阅读用户提供的一张或多张截图，先给出结论，再给出简洁、可直接使用的回答。信息不足时请明确指出。';
const defaultChatSystemPrompt = '你是屏桥的追问助手。用户会基于本轮一张或多张屏幕截图和视觉模型已经给出的回答继续提问。请结合上下文直接作答：结论先行，解释简洁，需要代码时只给关键片段。上下文不足以确定答案时，请说明缺少什么信息。';

function makeDefaultConfig() {
  return {
    version: 2,
    autoFallback: true,
    systemPrompt: defaultSystemPrompt,
    chatSystemPrompt: defaultChatSystemPrompt,
    vision: {
      activePresetId: 'vision-1',
      presets: [{ id: 'vision-1', name: '视觉模型 1', baseUrl: '', model: '', apiBackend: 'responses', apiKey: '', proxyUrl: '', enabled: true, priority: 1 }]
    },
    chat: {
      activePresetId: 'chat-1',
      presets: [{ id: 'chat-1', name: '对话模型 1', baseUrl: '', model: '', apiBackend: 'responses', apiKey: '', proxyUrl: '', enabled: true, priority: 1 }]
    },
    promptPresets: { vision: [], chat: [] }
  };
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function normalizeViewerPreset(input, index, kind) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = kind === 'chat'
    ? { id: 'chat-1', name: '对话模型 1', label: '对话' }
    : { id: 'vision-1', name: '视觉模型 1', label: '视觉' };
  const fallbackId = index === 0 ? defaults.id : `${kind}-preset-${index + 1}`;
  const fallbackName = index === 0 ? defaults.name : `${defaults.label}模型 ${index + 1}`;
  const parsedPriority = Number.parseInt(source.priority, 10);
  return {
    id: String(source.id || fallbackId).trim() || fallbackId,
    name: String(source.name || fallbackName).trim() || fallbackName,
    baseUrl: String(source.baseUrl || '').trim(),
    model: String(source.model || '').trim(),
    apiBackend: source.apiBackend === 'chat_completions' ? 'chat_completions' : 'responses',
    apiKey: String(source.apiKey || '').trim(),
    proxyUrl: String(source.proxyUrl || '').trim(),
    enabled: source.enabled !== false,
    priority: Number.isFinite(parsedPriority) && parsedPriority > 0 ? parsedPriority : index + 1,
    rememberApiKey: source.rememberApiKey === true
  };
}

function normalizeViewerPromptPresets(input, kind) {
  const source = input && Array.isArray(input[kind]) ? input[kind] : [];
  const usedIds = new Set();
  return source.map((entry, index) => {
    const preset = entry && typeof entry === 'object' ? entry : {};
    const fallbackId = `${kind}-prompt-${index + 1}`;
    const baseId = String(preset.id || fallbackId).trim() || fallbackId;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      name: String(preset.name || '').trim() || `${kind === 'vision' ? '截图回答' : '追问'} ${index + 1}`,
      text: String(preset.text ?? '')
    };
  });
}

function normalizeViewerConfig(input) {
  const source = input && typeof input === 'object' ? input : {};
  const defaults = makeDefaultConfig();
  const buildGroup = (kind) => {
    const sourceGroup = source[kind] && typeof source[kind] === 'object' ? source[kind] : {};
    const rawPresets = Array.isArray(sourceGroup.presets) && sourceGroup.presets.length
      ? sourceGroup.presets
      : defaults[kind].presets;
    const usedIds = new Set();
    const presets = rawPresets.map((preset, index) => {
      const normalized = normalizeViewerPreset(preset, index, kind);
      let id = normalized.id;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${normalized.id}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      return id === normalized.id ? normalized : { ...normalized, id };
    });
    const activePresetId = presets.some((preset) => preset.id === sourceGroup.activePresetId)
      ? sourceGroup.activePresetId
      : presets[0].id;
    return { activePresetId, presets };
  };
  return {
    version: 2,
    autoFallback: source.autoFallback !== false,
    systemPrompt: typeof source.systemPrompt === 'string' ? source.systemPrompt : defaultSystemPrompt,
    chatSystemPrompt: typeof source.chatSystemPrompt === 'string' ? source.chatSystemPrompt : defaultChatSystemPrompt,
    vision: buildGroup('vision'),
    chat: buildGroup('chat'),
    promptPresets: {
      vision: normalizeViewerPromptPresets(source.promptPresets, 'vision'),
      chat: normalizeViewerPromptPresets(source.promptPresets, 'chat')
    }
  };
}

function cloneViewerConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function getConfig() {
  const config = runtimeConfig
    ? cloneViewerConfig(runtimeConfig)
    : normalizeViewerConfig(readJson(CONFIG_KEY, null) || makeDefaultConfig());
  if (runtimeConfig) return Promise.resolve(config);
  const remembered = readJson(KEYS_KEY, {});
  for (const groupName of ['vision', 'chat']) {
    const group = config[groupName];
    if (!group || !Array.isArray(group.presets)) continue;
    for (const preset of group.presets) {
      const rememberedKey = typeof remembered[preset.id] === 'string' ? remembered[preset.id] : '';
      preset.rememberApiKey = Boolean(rememberedKey);
      preset.apiKey = rememberedKey || sessionKeys.get(preset.id) || '';
    }
  }
  return Promise.resolve(config);
}

function saveConfig(config) {
  if (runtimeConfig !== null) {
    return Promise.reject(new Error('连接采集电脑期间，配置由采集端同步，无法在网页端保存。'));
  }
  const normalized = normalizeViewerConfig(config);
  const remembered = readJson(KEYS_KEY, {});
  const stored = cloneViewerConfig(normalized);
  const presetIds = new Set();
  for (const groupName of ['vision', 'chat']) {
    const group = stored[groupName];
    if (!group || !Array.isArray(group.presets)) continue;
    for (const preset of group.presets) {
      presetIds.add(preset.id);
      const apiKey = String(preset.apiKey || '');
      if (apiKey) sessionKeys.set(preset.id, apiKey);
      else sessionKeys.delete(preset.id);
      if (preset.rememberApiKey && apiKey) remembered[preset.id] = apiKey;
      else delete remembered[preset.id];
      preset.apiKey = '';
    }
  }
  for (const id of Object.keys(remembered)) {
    if (!presetIds.has(id)) delete remembered[id];
  }
  for (const id of sessionKeys.keys()) {
    if (!presetIds.has(id)) sessionKeys.delete(id);
  }
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(stored));
    if (Object.keys(remembered).length) localStorage.setItem(KEYS_KEY, JSON.stringify(remembered));
    else localStorage.removeItem(KEYS_KEY);
  } catch {
    throw new Error('浏览器本地存储空间不足，设置未能保存。');
  }
  return Promise.resolve(normalized);
}

function applySourceConfig(config) {
  runtimeConfig = normalizeViewerConfig(config);
  for (const groupName of ['vision', 'chat']) {
    for (const preset of runtimeConfig[groupName].presets) preset.rememberApiKey = false;
  }
  emit('source-config', cloneViewerConfig(runtimeConfig));
  return cloneViewerConfig(runtimeConfig);
}

function clearSourceConfig() {
  const hadRuntimeConfig = runtimeConfig !== null;
  if (!hadRuntimeConfig) return;
  runtimeConfig = null;
  emit('source-config', null);
}

function isSourceConfigActive() {
  return runtimeConfig !== null;
}

function emit(name, value) {
  for (const handler of eventHandlers.get(name) || []) handler(value);
}

function on(name, callback) {
  if (!eventHandlers.has(name)) eventHandlers.set(name, new Set());
  eventHandlers.get(name).add(callback);
}

function setPairStatus(message, state) {
  const status = document.getElementById('pairStatus');
  if (status) {
    status.textContent = message;
    status.classList.toggle('is-connected', state === 'connected');
    status.classList.toggle('is-error', state === 'error');
  }
  const connectButton = document.getElementById('pairButton');
  const disconnectButton = document.getElementById('disconnectPairButton');
  const codeInput = document.getElementById('pairCodeInput');
  const captureButton = document.getElementById('addScreenshotButton');
  if (connectButton) connectButton.disabled = state === 'connecting' || state === 'connected';
  if (disconnectButton) disconnectButton.hidden = state !== 'connected';
  if (codeInput) codeInput.disabled = state === 'connecting' || state === 'connected';
  if (captureButton) captureButton.disabled = state !== 'connected';
  const shortcut = document.getElementById('shortcutStatus');
  const captureStatus = document.getElementById('captureStatus');
  if (shortcut) shortcut.textContent = state === 'connected' ? '采集电脑已连接' : (state === 'connecting' ? '正在连接' : '等待配对');
  if (captureStatus && !captureStatus.textContent.startsWith('分析') && !captureStatus.textContent.startsWith('正在')) {
    captureStatus.textContent = state === 'connected' ? '已连接，可连续添加截图' : (state === 'connecting' ? '正在连接采集电脑…' : '请先连接采集电脑');
    captureStatus.style.color = state === 'error' ? '#d95e5e' : '';
  }
}

function rejectPendingFrame(message) {
  if (!pendingFrame) return;
  clearTimeout(pendingFrame.timer);
  const pending = pendingFrame;
  pendingFrame = null;
  pending.reject(new Error(message));
}

function disconnectPair(message, isError) {
  pairConnected = false;
  clearSourceConfig();
  rejectPendingFrame(message || '配对连接已断开。');
  if (pairSocket) {
    const socket = pairSocket;
    pairSocket = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }
  setPairStatus(message || '尚未连接', isError ? 'error' : 'disconnected');
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[-\s]/g, '');
}

function connectPair(code) {
  disconnectPair('', false);
  const normalized = normalizeCode(code);
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(normalized)) {
    setPairStatus('配对码应为 8 位字母和数字。', 'error');
    return;
  }
  setPairStatus('正在连接…', 'connecting');
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(protocol + '//' + location.host + '/ws');
  pairSocket = socket;
  socket.binaryType = 'blob';
  socket.onopen = () => socket.send(JSON.stringify({ type: 'join', code: normalized }));
  socket.onmessage = async (event) => {
    if (typeof event.data !== 'string') {
      if (!pendingFrame) return;
      const pending = pendingFrame;
      pendingFrame = null;
      clearTimeout(pending.timer);
      try {
        const reader = new FileReader();
        reader.onload = () => pending.resolve({ ok: true, dataUrl: reader.result });
        reader.onerror = () => pending.reject(new Error('无法读取采集端截图。'));
        reader.readAsDataURL(new Blob([event.data], { type: 'image/jpeg' }));
      } catch (error) {
        pending.reject(error);
      }
      return;
    }
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'joined') {
      pairConnected = true;
      setPairStatus('已连接采集电脑；会话将持续到浏览器或采集端断开', 'connected');
    } else if (message.type === 'source-config') {
      applySourceConfig(message.config);
    } else if (message.type === 'frame') {
      // The relay sends the binary JPEG immediately after this metadata frame.
    } else if (message.type === 'busy') {
      rejectPendingFrame(message.message || '采集端正在处理上一张截图，请稍候。');
    } else if (message.type === 'frame-timeout' || message.type === 'frame-error' || message.type === 'error') {
      rejectPendingFrame(message.message || '采集截图失败。');
      if (message.type === 'error') {
        pairConnected = false;
        clearSourceConfig();
        setPairStatus(message.message || '配对失败。', 'error');
      }
    } else if (message.type === 'source-disconnected') {
      pairConnected = false;
      clearSourceConfig();
      rejectPendingFrame(message.message || '采集电脑已断开。');
      setPairStatus(message.message || '采集电脑已断开。', 'error');
    } else if (message.type === 'source-connected') {
      pairConnected = true;
      setPairStatus('采集电脑已重新连接', 'connected');
    }
  };
  socket.onclose = (event) => {
    if (pairSocket === socket) pairSocket = null;
    pairConnected = false;
    clearSourceConfig();
    rejectPendingFrame(event.reason || '连接已断开，配对码可能已过期。');
    setPairStatus(event.reason || '连接已断开，请使用新的配对码重新连接。', 'error');
  };
  socket.onerror = () => setPairStatus('无法连接中继服务，请检查网络后重试。', 'error');
}

function captureScreen() {
  if (!pairConnected || !pairSocket || pairSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('请先连接采集电脑。'));
  }
  if (pendingFrame) return Promise.reject(new Error('上一张截图还在处理中，请稍候。'));
  return new Promise((resolve, reject) => {
    const pending = {
      resolve,
      reject,
      timer: setTimeout(() => {
        if (pendingFrame === pending) {
          pendingFrame = null;
          reject(new Error('采集电脑响应超时，请确认屏桥仍在共享。'));
        }
      }, 9000)
    };
    pendingFrame = pending;
    pairSocket.send(JSON.stringify({ type: 'request-frame' }));
  });
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'string' ? part : (part && typeof part.text === 'string' ? part.text : '')).join('');
}

function extractDelta(payload) {
  const choice = payload && payload.choices && payload.choices[0];
  if (!choice) return '';
  return extractText(choice.delta && choice.delta.content) || extractText(choice.message && choice.message.content);
}

function extractResponsesText(payload) {
  if (payload && typeof payload.output_text === 'string') return payload.output_text;
  const output = payload && Array.isArray(payload.output) ? payload.output : [];
  return output.flatMap((item) => item && Array.isArray(item.content) ? item.content : [])
    .map((part) => part && part.type === 'output_text' && typeof part.text === 'string' ? part.text : '').join('');
}

function extractStreamText(payload, apiBackend) {
  if (apiBackend === 'responses') {
    if (payload && payload.type === 'response.output_text.delta') return payload.delta || '';
    if (payload && payload.type === 'response.refusal.delta') return payload.delta || '';
    return '';
  }
  return extractDelta(payload);
}

function isRightCodeEndpoint(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return [
      'right.codes',
      'www.right.codes',
      'right.ai',
      'www.right.ai',
      'rightapi.ai',
      'www.rightapi.ai'
    ].includes(hostname);
  } catch {
    return false;
  }
}

function resolveApiBackend(config) {
  if (config.apiBackend === 'chat_completions') return 'chat_completions';
  if (config.apiBackend === 'responses' && isRightCodeEndpoint(config.baseUrl)) {
    return 'chat_completions';
  }
  return 'responses';
}

function endpointFor(config, apiBackend) {
  return String(config.baseUrl || '').replace(/\/+$/, '') + '/' + (apiBackend === 'responses' ? 'responses' : 'chat/completions');
}

async function streamCompletion(args) {
  const config = args.config;
  const apiBackend = args.apiBackend;
  const requestBody = args.requestBody;
  const eventName = args.eventName;
  const endpoint = endpointFor(config, apiBackend);
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;
  const controller = new AbortController();
  activeAbortController = controller;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const reason = error && error.message ? error.message : '网络连接失败';
    throw new Error('无法连接模型服务：' + endpoint + '\n原因：' + reason + '\n浏览器无法访问该模型服务时，请检查地址、网络及服务端跨域（CORS）设置。浏览器使用此设备的网络代理设置。');
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('模型请求失败（HTTP ' + response.status + ' ' + response.statusText + '）\n' + (errorText.slice(0, 500) || '服务端未提供错误详情') + '\n请检查 API 协议、API Key 和模型名称。');
  }
  if (!response.body) {
    const json = await response.json();
    const text = apiBackend === 'responses' ? extractResponsesText(json) : extractDelta(json);
    if (!text) throw new Error('模型没有返回可显示的内容');
    emit(eventName + '-chunk', text);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedText = false;
  const processEvents = (flush) => {
    if (flush) buffer += decoder.decode();
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    if (flush && buffer.trim()) {
      events.push(buffer);
      buffer = '';
    }
    for (const event of events) {
      const dataLines = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
      const data = dataLines.length ? dataLines.join('\n') : (flush ? event.trim() : '');
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const streamedText = extractStreamText(parsed, apiBackend);
        const text = streamedText || (!receivedText ? (apiBackend === 'responses' ? extractResponsesText(parsed) : extractDelta(parsed)) : '');
        if (text) {
          receivedText = true;
          emit(eventName + '-chunk', text);
        }
      } catch {}
    }
  };
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    processEvents(false);
  }
  processEvents(true);
  if (!receivedText) throw new Error('模型没有返回可显示的内容');
}

async function streamVisionAnalysis(payload, config) {
  if (!config.baseUrl) throw new Error('请先在设置中填写视觉模型 API 地址');
  if (!config.model) throw new Error('请先在设置中填写视觉模型名称');
  const rawImages = Array.isArray(payload && payload.imageDataUrls) ? payload.imageDataUrls : [payload && payload.imageDataUrl];
  const images = rawImages.filter((image) => typeof image === 'string' && image.startsWith('data:image/'));
  if (!images.length || images.length !== rawImages.length) throw new Error('截图数据无效，请重新添加截图');
  const prompt = payload.prompt || '请分析这些截图并给出回答。';
  const backend = resolveApiBackend(config);
  const requestBody = backend === 'responses'
    ? { model: config.model, stream: true, instructions: config.systemPrompt, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map((image) => ({ type: 'input_image', image_url: image, detail: 'high' }))] }] }
    : { model: config.model, stream: true, temperature: 0.2, messages: [{ role: 'system', content: config.systemPrompt }, { role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((image) => ({ type: 'image_url', image_url: { url: image, detail: 'high' } }))] }] };
  await streamCompletion({ config, apiBackend: backend, requestBody, eventName: 'analysis' });
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string' && item.content.trim())
    .map((item) => ({ role: item.role, content: item.content }));
}

async function streamChatFollowUp(payload, config) {
  if (!config.baseUrl) throw new Error('请先在设置中填写对话模型 API 地址');
  if (!config.model) throw new Error('请先在设置中填写对话模型名称');
  const source = payload || {};
  const history = sanitizeHistory(source.history).slice(-20);
  if (!history.length) throw new Error('没有可发送的对话内容');
  const rawImages = Array.isArray(source.imageDataUrls) ? source.imageDataUrls : [source.imageDataUrl];
  const images = rawImages.filter((image) => typeof image === 'string' && image.startsWith('data:image/'));
  const backend = resolveApiBackend(config);
  let requestBody;
  if (backend === 'responses') {
    requestBody = {
      model: config.model,
      stream: true,
      instructions: config.chatSystemPrompt,
      input: history.map((item, index) => {
        const content = [];
        if (index === 0 && images.length) content.push(...images.map((image) => ({ type: 'input_image', image_url: image, detail: 'high' })));
        content.push({ type: 'input_text', text: item.content });
        return { role: item.role, content };
      })
    };
  } else {
    const messages = [{ role: 'system', content: config.chatSystemPrompt }];
    history.forEach((item, index) => {
      if (index === 0 && images.length) messages.push({ role: item.role, content: [...images.map((image) => ({ type: 'image_url', image_url: { url: image, detail: 'high' } })), { type: 'text', text: item.content }] });
      else messages.push({ role: item.role, content: item.content });
    });
    requestBody = { model: config.model, stream: true, temperature: 0.2, messages };
  }
  await streamCompletion({ config, apiBackend: backend, requestBody, eventName: 'chat' });
}

function buildPresetQueue(group, requestedPresetId, autoFallback) {
  const presets = Array.isArray(group && group.presets) ? group.presets : [];
  if (!presets.length) throw new Error('当前模型组没有可用预设，请先在设置中新增模型。');
  const selected = presets.find((preset) => preset.id === requestedPresetId)
    || presets.find((preset) => preset.id === group.activePresetId)
    || presets[0];
  if (!autoFallback) return [selected];
  const fallback = presets.filter((preset) => preset.id !== selected.id && preset.enabled)
    .sort((left, right) => left.priority - right.priority);
  return [selected, ...fallback];
}

async function runWithFallback(args) {
  const queue = buildPresetQueue(args.group, args.requestedPresetId, args.autoFallback);
  const failures = [];
  for (let index = 0; index < queue.length; index += 1) {
    const preset = queue[index];
    emit(args.eventName + '-attempt', { presetId: preset.id, presetName: preset.name, attempt: index + 1, total: queue.length });
    try {
      await args.run(preset);
      return { presetId: preset.id, presetName: preset.name, attempts: index + 1 };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      failures.push(preset.name + '：' + error.message);
      const next = queue[index + 1];
      if (next) emit(args.eventName + '-fallback', { failedPresetName: preset.name, nextPresetName: next.name, error: error.message });
    }
  }
  throw new Error(failures.join('\n'));
}

async function analyzeImage(payload) {
  try {
    const config = await getConfig();
    const result = await runWithFallback({
      group: config.vision,
      autoFallback: config.autoFallback,
      requestedPresetId: payload && payload.presetId,
      eventName: 'analysis',
      run: (preset) => streamVisionAnalysis(payload, { ...preset, systemPrompt: config.systemPrompt })
    });
    emit('analysis-complete', result);
    return { ok: true, ...result };
  } catch (error) {
    if (error.name === 'AbortError') {
      emit('analysis-stopped');
      return { ok: false, stopped: true };
    }
    emit('analysis-error', error.message);
    return { ok: false, error: error.message };
  } finally {
    activeAbortController = null;
  }
}

async function chatFollowUp(payload) {
  try {
    const config = await getConfig();
    const result = await runWithFallback({
      group: config.chat,
      autoFallback: config.autoFallback,
      requestedPresetId: payload && payload.presetId,
      eventName: 'chat',
      run: (preset) => streamChatFollowUp(payload, { ...preset, chatSystemPrompt: config.chatSystemPrompt })
    });
    emit('chat-complete', result);
    return { ok: true, ...result };
  } catch (error) {
    if (error.name === 'AbortError') {
      emit('chat-stopped');
      return { ok: false, stopped: true };
    }
    emit('chat-error', error.message);
    return { ok: false, error: error.message };
  } finally {
    activeAbortController = null;
  }
}

function stopAnalysis() {
  if (activeAbortController) activeAbortController.abort();
  return Promise.resolve({ ok: true });
}

async function copyText(value) {
  const text = String(value || '');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  return { ok: true };
}

function noOp() {
  return Promise.resolve({ ok: true });
}

window.assistantAPI = {
  getConfig,
  saveConfig,
  applySourceConfig,
  clearSourceConfig,
  isSourceConfigActive,
  captureScreen,
  analyzeImage,
  chatFollowUp,
  stopAnalysis,
  copyText,
  getScreenSource: noOp,
  startLanShare: noOp,
  stopLanShare: noOp,
  startCloudShare: noOp,
  stopCloudShare: noOp,
  discoverLanShares: async () => [],
  minimizeLanShare: noOp,
  onCaptureError: (callback) => on('capture-error', callback),
  onCloudShareStatus: (callback) => on('cloud-share-status', callback),
  onAnalysisAttempt: (callback) => on('analysis-attempt', callback),
  onAnalysisFallback: (callback) => on('analysis-fallback', callback),
  onAnalysisChunk: (callback) => on('analysis-chunk', callback),
  onAnalysisComplete: (callback) => on('analysis-complete', callback),
  onAnalysisStopped: (callback) => on('analysis-stopped', callback),
  onAnalysisError: (callback) => on('analysis-error', callback),
  onChatAttempt: (callback) => on('chat-attempt', callback),
  onChatFallback: (callback) => on('chat-fallback', callback),
  onChatChunk: (callback) => on('chat-chunk', callback),
  onChatComplete: (callback) => on('chat-complete', callback),
  onChatStopped: (callback) => on('chat-stopped', callback),
  onChatError: (callback) => on('chat-error', callback),
  onSourceConfig: (callback) => on('source-config', callback)
};

const pairForm = document.getElementById('pairForm');
const pairCodeInput = document.getElementById('pairCodeInput');
const disconnectPairButton = document.getElementById('disconnectPairButton');
if (pairForm) {
  pairForm.addEventListener('submit', (event) => {
    event.preventDefault();
    connectPair(pairCodeInput.value);
  });
}
if (pairCodeInput) pairCodeInput.addEventListener('input', () => {
  pairCodeInput.value = pairCodeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9-]/g, '').slice(0, 9);
});
if (disconnectPairButton) disconnectPairButton.addEventListener('click', () => disconnectPair('已断开连接', false));
setPairStatus('尚未连接', 'disconnected');
window.addEventListener('beforeunload', () => disconnectPair('', false));
