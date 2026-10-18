const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  ipcMain,
  Menu,
  dialog,
  net,
  safeStorage,
  screen,
  session,
  Tray
} = require('electron');
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { normalizeCloudPairCredentials } = require('./cloud-pair');
const { getDefaultPromptPresets } = require('./prompt-presets');
const { createTrayLifecycle } = require('./tray-lifecycle');
const { CloudDeviceStore } = require('./cloud-device-store');
const { cloudRetryDelay } = require('./cloud-reconnect-policy');
const { cloudStopIsSafeToExit, settleCloudStopQuit, stopCloudDeviceSafely } = require('./cloud-stop-policy');
const { getCloudAutoStart, setCloudAutoStart } = require('./cloud-auto-start');

let mainWindow;
let trayLifecycle = null;
let isQuitting = false;
let activeAbortController = null;
let lanShareServer = null;
let lanDiscoverySocket = null;
let lanShareTimer = null;
let lanShareToken = '';
let lanShareFrame = null;
let lanShareCapturing = false;
let lanShareCapturePromise = null;
let cloudPairCredentials = null;
let cloudPairSocket = null;
let cloudPairRetryTimer = null;
let cloudPairStableTimer = null;
let cloudPairPaired = false;
let cloudPairRetryAttempt = 0;
let cloudDeviceStore = null;
let cloudStopPending = false;
let cloudStopSafeToExit = true;
let cloudStopOperationActive = false;
let cloudStopQuitRequested = false;
let cloudStopExitPromptOpen = false;
let allowUnsafeCloudStopExit = false;
let lastCloudShareStatus = { state: 'stopped', message: '尚未连接公网中继' };

const defaultRelayUrl = 'https://screenbridge.zahml.top';

const defaultSystemPrompt =
  '你是一个面试练习助手。请准确阅读用户提供的一张或多张截图，先给出结论，再给出简洁、可直接使用的回答。信息不足时请明确指出。';

const defaultChatSystemPrompt =
  '你是屏桥的追问助手。用户会基于本轮一张或多张屏幕截图和视觉模型已经给出的回答继续提问。请结合上下文直接作答：结论先行，解释简洁，需要代码时只给关键片段。上下文不足以确定答案时，请说明缺少什么信息。';

const presetDefaults = {
  vision: { id: 'vision-1', name: '视觉模型 1', label: '视觉' },
  chat: { id: 'chat-1', name: '对话模型 1', label: '对话' }
};

const defaultPreset = {
  id: presetDefaults.vision.id,
  name: presetDefaults.vision.name,
  baseUrl: '',
  model: '',
  apiBackend: 'responses',
  apiKey: '',
  proxyUrl: '',
  enabled: true,
  priority: 1
};

const lanDiscoveryPort = 8766;
const lanDiscoveryRequest = 'SCREENBRIDGE_DISCOVER_V1';
const lanDiscoveryResponse = 'SCREENBRIDGE_SHARE_V1';

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function decryptApiKey(input) {
  if (input.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(input.encryptedApiKey, 'base64'));
    } catch {
      return '';
    }
  }
  return String(input.apiKey || '');
}

function normalizePreset(input, index = 0, kind = 'vision') {
  const fallback = presetDefaults[kind] || presetDefaults.vision;
  const fallbackId = index === 0 ? fallback.id : `${kind}-preset-${index + 1}`;
  const fallbackName = index === 0 ? fallback.name : `${fallback.label}模型 ${index + 1}`;
  const parsedPriority = Number.parseInt(input.priority, 10);
  return {
    id: String(input.id || fallbackId).trim() || fallbackId,
    name: String(input.name || fallbackName).trim() || fallbackName,
    baseUrl: String(input.baseUrl || '').trim(),
    model: String(input.model || '').trim(),
    apiBackend: input.apiBackend === 'chat_completions' ? 'chat_completions' : 'responses',
    apiKey: String(input.apiKey || '').trim(),
    proxyUrl: String(input.proxyUrl || '').trim(),
    enabled: input.enabled !== false,
    priority: Number.isFinite(parsedPriority) && parsedPriority > 0 ? parsedPriority : index + 1
  };
}

function decryptPresetList(list, kind) {
  return list.map((preset, index) => normalizePreset({ ...preset, apiKey: decryptApiKey(preset) }, index, kind));
}

function resolveActivePresetId(presets, candidates) {
  for (const candidate of candidates) {
    if (candidate && presets.some((preset) => preset.id === candidate)) return candidate;
  }
  return presets[0].id;
}

function legacyPresetList(stored, kind) {
  if (Array.isArray(stored.presets) && stored.presets.length) {
    return decryptPresetList(stored.presets, kind);
  }
  // Migrate the original single-model configuration without losing its API key.
  return [normalizePreset({
    ...defaultPreset,
    id: presetDefaults[kind].id,
    name: presetDefaults[kind].name,
    baseUrl: stored.baseUrl || '',
    model: stored.model || '',
    apiBackend: stored.apiBackend || defaultPreset.apiBackend,
    apiKey: decryptApiKey(stored),
    proxyUrl: stored.proxyUrl || defaultPreset.proxyUrl
  }, 0, kind)];
}

function readPresetGroup(stored, key, kind) {
  const group = stored && stored[key];
  if (group && Array.isArray(group.presets) && group.presets.length) {
    return {
      presets: decryptPresetList(group.presets, kind),
      requestedActivePresetId: group.activePresetId
    };
  }
  return { presets: legacyPresetList(stored || {}, kind), requestedActivePresetId: null };
}

function normalizePromptPresets(input, kind, seedDefaults = false) {
  const hasList = Boolean(input && Object.prototype.hasOwnProperty.call(input, kind) && Array.isArray(input[kind]));
  const rawSource = hasList ? input[kind] : [];
  const source = hasList || !seedDefaults ? rawSource : getDefaultPromptPresets(kind);
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

function readConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    stored = {};
  }

  const vision = readPresetGroup(stored, 'vision', 'vision');
  const chat = readPresetGroup(stored, 'chat', 'chat');

  return {
    version: 2,
    autoFallback: stored.autoFallback !== false,
    systemPrompt: String(stored.systemPrompt || defaultSystemPrompt).trim(),
    chatSystemPrompt: String(stored.chatSystemPrompt || defaultChatSystemPrompt).trim(),
    vision: {
      activePresetId: resolveActivePresetId(vision.presets, [vision.requestedActivePresetId, stored.activePresetId]),
      presets: vision.presets
    },
    chat: {
      activePresetId: resolveActivePresetId(chat.presets, [chat.requestedActivePresetId, stored.activePresetId]),
      presets: chat.presets
    },
    promptPresets: {
      vision: normalizePromptPresets(stored.promptPresets, 'vision', true),
      chat: normalizePromptPresets(stored.promptPresets, 'chat', true)
    }
  };
}

function makePresetGroup(input, kind) {
  const source = input && Array.isArray(input.presets) && input.presets.length
    ? input.presets
    : [{ ...defaultPreset, id: presetDefaults[kind].id, name: presetDefaults[kind].name }];
  const presets = source.map((preset, index) => normalizePreset(preset, index, kind));
  return {
    activePresetId: resolveActivePresetId(presets, [input && input.activePresetId]),
    presets
  };
}

function encryptPresetList(presets) {
  return presets.map((preset) => {
    const storedPreset = { ...preset };
    delete storedPreset.apiKey;
    if (preset.apiKey && safeStorage.isEncryptionAvailable()) {
      storedPreset.encryptedApiKey = safeStorage.encryptString(preset.apiKey).toString('base64');
    } else {
      storedPreset.apiKey = preset.apiKey;
    }
    return storedPreset;
  });
}

function writeConfig(input) {
  const vision = makePresetGroup(input.vision, 'vision');
  const chat = makePresetGroup(input.chat, 'chat');
  const promptPresets = {
    vision: normalizePromptPresets(input.promptPresets, 'vision'),
    chat: normalizePromptPresets(input.promptPresets, 'chat')
  };
  const storedConfig = {
    version: 2,
    autoFallback: input.autoFallback !== false,
    systemPrompt: String(input.systemPrompt || defaultSystemPrompt).trim(),
    chatSystemPrompt: String(input.chatSystemPrompt || defaultChatSystemPrompt).trim(),
    vision: { activePresetId: vision.activePresetId, presets: encryptPresetList(vision.presets) },
    chat: { activePresetId: chat.activePresetId, presets: encryptPresetList(chat.presets) },
    promptPresets
  };

  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(storedConfig, null, 2), 'utf8');
  return {
    ...storedConfig,
    vision,
    chat
  };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function capturePrimaryScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('应用窗口尚未准备好');
  }

  let contentProtectionEnabled = false;
  try {
    // Exclude the assistant window from the captured frame without hiding it or
    // changing focus, so the content underneath remains visible without a flash.
    mainWindow.setContentProtection(true);
    contentProtectionEnabled = true;
    await wait(80);

    const primaryDisplay = screen.getPrimaryDisplay();
    const displaySize = primaryDisplay.size;
    const thumbnailSize = {
      width: Math.max(1920, Math.min(displaySize.width, 3840)),
      height: Math.max(1080, Math.min(displaySize.height, 2160))
    };
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
      fetchWindowIcons: false
    });

    const source =
      sources.find((item) => String(item.display_id) === String(primaryDisplay.id)) || sources[0];
    if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
      throw new Error('没有找到可用的屏幕画面');
    }

    const dataUrl = source.thumbnail.toDataURL();
    return { ok: true, dataUrl };
  } finally {
    if (contentProtectionEnabled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setContentProtection(false);
    }
  }
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      return part && typeof part.text === 'string' ? part.text : '';
    })
    .join('');
}

function extractDelta(payload) {
  const choice = payload && payload.choices && payload.choices[0];
  if (!choice) return '';
  return extractText(choice.delta && choice.delta.content) || extractText(choice.message && choice.message.content);
}

function extractResponsesText(payload) {
  if (payload && typeof payload.output_text === 'string') return payload.output_text;
  const output = payload && Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => (item && Array.isArray(item.content) ? item.content : []))
    .map((part) => (part && part.type === 'output_text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

function extractStreamText(payload, apiBackend) {
  if (apiBackend === 'responses') {
    if (payload && payload.type === 'response.output_text.delta') return payload.delta || '';
    if (payload && payload.type === 'response.refusal.delta') return payload.delta || '';
    return '';
  }
  return extractDelta(payload);
}

function extractScreenSource() {
  const primaryDisplay = screen.getPrimaryDisplay();
  return desktopCapturer
    .getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    })
    .then((sources) => {
      const source =
        sources.find((item) => String(item.display_id) === String(primaryDisplay.id)) || sources[0];
      if (!source) throw new Error('没有找到可监听的屏幕');
      return { id: source.id, name: source.name, displayId: source.display_id };
    });
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

function ipToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function intToIp(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function netmaskPrefix(netmask) {
  const bits = ipToInt(netmask);
  let prefix = 0;
  for (let i = 31; i >= 0; i -= 1) {
    if ((bits >>> i) & 1) prefix += 1;
    else break;
  }
  return prefix;
}

function getLanInterfaces() {
  const seen = new Set();
  const result = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (!item.netmask || seen.has(item.address)) continue;
      seen.add(item.address);
      const addressBits = ipToInt(item.address);
      const maskBits = ipToInt(item.netmask);
      const prefix = netmaskPrefix(item.netmask);
      result.push({
        address: item.address,
        netmask: item.netmask,
        broadcast: intToIp((addressBits | (~maskBits >>> 0)) >>> 0),
        cidr: `${intToIp((addressBits & maskBits) >>> 0)}/${prefix}`
      });
    }
  }
  return result;
}

function getLanAddresses() {
  return getLanInterfaces().map((item) => item.address);
}

const maxDiscoveryTargets = 512;

function normalizeDiscoveryTargets(input) {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  const result = new Set();
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const cidrMatch = text.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
    if (cidrMatch) {
      const prefix = Number(cidrMatch[2]);
      if (prefix < 16 || prefix > 32) continue;
      if (prefix >= 31) {
        result.add(cidrMatch[1]);
        continue;
      }
      const base = ipToInt(cidrMatch[1]) & (((-1 << (32 - prefix)) >>> 0));
      const size = 2 ** (32 - prefix);
      for (let offset = 1; offset < size - 1 && result.size < maxDiscoveryTargets; offset += 1) {
        result.add(intToIp((base + offset) >>> 0));
      }
      continue;
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) result.add(text);
  }
  return [...result];
}

async function captureLanFrame() {
  if (lanShareCapturePromise) return lanShareCapturePromise;
  const capturePromise = (async () => {
    lanShareCapturing = true;
    let contentProtectionEnabled = false;
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(true);
        contentProtectionEnabled = true;
        await wait(80);
      }
      const primaryDisplay = screen.getPrimaryDisplay();
      const displaySize = primaryDisplay.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.max(1280, Math.min(displaySize.width, 1920)),
          height: Math.max(720, Math.min(displaySize.height, 1080))
        },
        fetchWindowIcons: false
      });
      const source =
        sources.find((item) => String(item.display_id) === String(primaryDisplay.id)) || sources[0];
      if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
        throw new Error('没有找到共享端屏幕画面');
      }
      lanShareFrame = source.thumbnail.toJPEG(72);
      return lanShareFrame;
    } finally {
      if (contentProtectionEnabled && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(false);
      }
      lanShareCapturing = false;
    }
  })();
  lanShareCapturePromise = capturePromise;
  try {
    return await capturePromise;
  } finally {
    if (lanShareCapturePromise === capturePromise) lanShareCapturePromise = null;
  }
}

function getRelayBaseUrl() {
  const relayUrl = String(process.env.SCREENBRIDGE_RELAY_URL || defaultRelayUrl).replace(/\/+$/, '');
  const parsed = new URL(relayUrl);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('公网中继必须使用 HTTPS');
  }
  return relayUrl;
}

function sendCloudShareStatus(state, message = '') {
  let info = null;
  try { info = cloudPairInfo(); } catch {}
  lastCloudShareStatus = { state, message, info };
  sendToRenderer('cloud-share-status', lastCloudShareStatus);
}

function sendCloudConfig() {
  if (!cloudPairSocket
      || cloudPairSocket.readyState !== WebSocket.OPEN
      || !cloudPairPaired) return;
  cloudPairSocket.send(JSON.stringify({
    type: 'config',
    config: readConfig()
  }));
}

function connectCloudPair() {
  if (cloudStopPending || !cloudPairCredentials || cloudPairSocket || cloudPairRetryTimer) return;
  const credentials = cloudPairCredentials;

  let relayBase;
  try {
    relayBase = getRelayBaseUrl();
  } catch (error) {
    sendCloudShareStatus('error', error.message);
    return;
  }
  const websocketUrl = relayBase.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:') + '/ws';
  const socket = new WebSocket(websocketUrl, { handshakeTimeout: 10_000, perMessageDeflate: false });
  let credentialsRejected = false;
  cloudPairSocket = socket;
  sendCloudShareStatus(cloudPairPaired ? 'reconnecting' : 'connecting', '正在连接公网中继…');

  socket.on('open', () => {
    if (cloudPairSocket !== socket || !cloudPairCredentials) return socket.close();
    socket.send(JSON.stringify({
      type: 'authenticate',
      code: credentials.code,
      secret: credentials.secret
    }));
  });
  socket.on('message', async (data, isBinary) => {
    if (isBinary || cloudPairSocket !== socket) return;
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (message.type === 'authenticated') {
      cloudPairPaired = cloudPairPaired || message.resumed === true;
      if (cloudPairStableTimer) clearTimeout(cloudPairStableTimer);
      cloudPairStableTimer = setTimeout(() => {
        cloudPairStableTimer = null;
        if (cloudPairSocket === socket && socket.readyState === WebSocket.OPEN) cloudPairRetryAttempt = 0;
      }, 30_000);
      cloudPairStableTimer.unref?.();
      if (cloudPairPaired) sendCloudConfig();
      sendCloudShareStatus(cloudPairPaired ? 'paired' : 'connected', cloudPairPaired ? '设备已恢复连接，配对码保持不变' : '公网共享已连接，等待网页首次绑定');
    } else if (message.type === 'frame-request') {
      try {
        const frame = await captureLanFrame();
        if (cloudPairSocket === socket && socket.readyState === WebSocket.OPEN) socket.send(frame);
      } catch (error) {
        if (cloudPairSocket === socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'frame-error', message: error.message || '采集屏幕失败' }));
        }
      }
    } else if (message.type === 'error') {
      if (message.code === 'PAIR_EXPIRED' || message.code === 'DEVICE_REVOKED') {
        credentialsRejected = true;
        cloudPairCredentials = null;
        cloudPairPaired = false;
        try { cloudDeviceStore?.clear(); } catch {}
        sendCloudShareStatus(message.code === 'DEVICE_REVOKED' ? 'revoked' : 'expired', message.code === 'DEVICE_REVOKED'
          ? '设备已撤销或本机凭据无效，请从网页端重新绑定'
          : '首次绑定配对码已过期，请创建新配对');
        socket.close();
      } else {
        sendCloudShareStatus('reconnecting', message.message || '公网配对连接暂不可用');
      }
    } else if (message.type === 'source-connected') {
      sendCloudShareStatus('connected', '公网共享已连接，查看设备可以取图');
    } else if (message.type === 'viewer-connected') {
      cloudPairPaired = true;
      sendCloudConfig();
      sendCloudShareStatus('paired', '设备已绑定；网络恢复后会自动重连，配对码保持不变');
    } else if (message.type === 'viewer-disconnected') {
      sendCloudShareStatus('paired', '查看设备已断开，设备绑定仍然有效');
    }
  });
  socket.on('error', (error) => {
    if (cloudPairSocket === socket) sendCloudShareStatus('connecting', `中继连接暂不可用：${error.message}`);
  });
  socket.on('close', () => {
    if (cloudPairSocket !== socket) return;
    cloudPairSocket = null;
    if (cloudPairStableTimer) clearTimeout(cloudPairStableTimer);
    cloudPairStableTimer = null;
    if (!cloudPairCredentials || credentialsRejected || cloudStopPending) return;
    sendCloudShareStatus('reconnecting', '公网连接中断，正在自动恢复…');
    const delay = cloudRetryDelay(cloudPairRetryAttempt++);
    cloudPairRetryTimer = setTimeout(() => {
      cloudPairRetryTimer = null;
      connectCloudPair();
    }, delay);
    cloudPairRetryTimer.unref?.();
  });
}

async function startCloudShare() {
  if (cloudStopPending) throw new Error('本机设备凭据停用尚未保存，请重试停止共享。');
  if (cloudPairCredentials) {
    connectCloudPair();
    return cloudPairInfo();
  }

  if (!cloudDeviceStore) throw new Error('本机安全存储尚未准备好。');
  cloudDeviceStore.assertEncryptionAvailable();
  const relayBase = getRelayBaseUrl();
  sendCloudShareStatus('creating', '正在创建配对码…');
  let response;
  try {
    // Use Electron's network stack so Windows/system proxy settings are honored.
    response = await net.fetch(`${relayBase}/api/pair`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    const cause = error?.cause?.message || error?.message || '网络连接失败';
    throw new Error(`无法连接公网中继（${relayBase}）：${cause}`);
  }
  const payload = await response.json().catch(() => null);
  const result = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  if (!response.ok) {
    const detail = result && typeof result.error === 'string' ? result.error : '';
    throw new Error(detail || `中继返回 HTTP ${response.status}`);
  }
  const credentials = normalizeCloudPairCredentials(result);
  cloudPairCredentials = credentials;
  try {
    cloudDeviceStore.save(cloudPairCredentials);
  } catch (error) {
    cloudPairCredentials = null;
    throw error;
  }
  cloudPairRetryAttempt = 0;
  if (cloudPairStableTimer) clearTimeout(cloudPairStableTimer);
  cloudPairStableTimer = null;
  connectCloudPair();
  return cloudPairInfo();
}

async function stopCloudShare() {
  if (cloudStopOperationActive) {
    return { ok: false, revoked: false, credentialsCleared: false, error: '停止共享操作正在进行。' };
  }
  const credentials = cloudPairCredentials;
  cloudStopPending = true;
  cloudStopSafeToExit = !credentials;
  cloudStopOperationActive = true;
  cloudPairCredentials = null;
  cloudPairPaired = false;
  cloudPairRetryAttempt = 0;
  if (cloudPairRetryTimer) clearTimeout(cloudPairRetryTimer);
  cloudPairRetryTimer = null;
  if (cloudPairStableTimer) clearTimeout(cloudPairStableTimer);
  cloudPairStableTimer = null;
  if (cloudPairSocket) {
    const socket = cloudPairSocket;
    cloudPairSocket = null;
    socket.close();
  }
  const result = await stopCloudDeviceSafely(credentials, async (value) => {
      const relayBase = getRelayBaseUrl();
      const response = await fetch(`${relayBase}/api/device/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value.code, secret: value.secret }),
        cache: 'no-store',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    }, () => {
      cloudDeviceStore?.clear();
      cloudStopSafeToExit = true;
    });
  cloudStopOperationActive = false;
  cloudStopSafeToExit = cloudStopIsSafeToExit({ hadCredentials: Boolean(credentials), ...result });
  if (!result.credentialsCleared) {
    cloudPairCredentials = result.revoked ? null : credentials;
    const message = result.revoked
      ? '服务器已撤销设备授权，但本机停用标记保存失败。此进程不会重连；请保持运行并重试停止共享。'
      : '本机停用标记保存失败，服务器也未确认撤销。请保持程序运行并重试；退出前会提示恢复风险。';
    sendCloudShareStatus('error', message);
    finishPendingQuitAfterCloudStop();
    return result;
  }
  cloudStopPending = false;
  sendCloudShareStatus('stopped', result.revoked
    ? '共享已停止，设备绑定和本机密钥已撤销'
    : '本机设备凭据已停用；若网页设备列表仍显示该设备，请从网页端撤销');
  finishPendingQuitAfterCloudStop();
  return result;
}

function finishPendingQuitAfterCloudStop() {
  const quitRequested = cloudStopQuitRequested;
  cloudStopQuitRequested = false;
  settleCloudStopQuit(quitRequested, cloudStopSafeToExit, () => app.quit(), showUnsafeCloudStopExitPrompt);
}

function showUnsafeCloudStopExitPrompt() {
  if (cloudStopExitPromptOpen) return;
  cloudStopExitPromptOpen = true;
  dialog.showMessageBox({
    type: 'warning',
    buttons: ['继续运行', '仍然退出'],
    defaultId: 0,
    cancelId: 0,
    title: '公网共享无法安全停用',
    message: '本机停用标记保存失败，服务器也未确认撤销。',
    detail: '退出后，屏桥下次启动时可能继续使用已保存的设备凭据。建议继续运行并重试停止共享。'
  }).then(({ response }) => {
    cloudStopExitPromptOpen = false;
    if (response === 1) {
      allowUnsafeCloudStopExit = true;
      app.quit();
    }
  }).catch(() => {
    cloudStopExitPromptOpen = false;
  });
}

function cloudPairInfo() {
  if (!cloudPairCredentials) return null;
  return {
    code: `${cloudPairCredentials.code.slice(0, 4)}-${cloudPairCredentials.code.slice(4)}`,
    expiresAt: cloudPairPaired ? null : cloudPairCredentials.expiresAt,
    viewerUrl: `${getRelayBaseUrl()}/view`,
    paired: cloudPairPaired
  };
}

function pauseCloudPairForShutdown() {
  if (cloudPairRetryTimer) clearTimeout(cloudPairRetryTimer);
  cloudPairRetryTimer = null;
  if (cloudPairStableTimer) clearTimeout(cloudPairStableTimer);
  cloudPairStableTimer = null;
  if (cloudPairSocket) {
    const socket = cloudPairSocket;
    cloudPairSocket = null;
    socket.close(1001, '采集程序正在退出');
  }
}

function lanShareInfo() {
  const addressList = getLanAddresses();
  const port = lanShareServer && lanShareServer.address() && lanShareServer.address().port;
  return {
    port,
    token: lanShareToken,
    discoveryAvailable: Boolean(lanDiscoverySocket),
    addresses: addressList,
    networks: getLanInterfaces().map((item) => item.cidr),
    urls: addressList.map((address) => `http://${address}:${port}`)
  };
}

function startLanDiscoveryResponder() {
  if (lanDiscoverySocket) return Promise.resolve(true);

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', () => {});
  socket.on('message', (message, remote) => {
    if (message.toString() !== lanDiscoveryRequest || !lanShareServer) return;
    const address = lanShareServer.address();
    if (!address || typeof address === 'string') return;

    const payload = JSON.stringify({
      type: lanDiscoveryResponse,
      name: os.hostname(),
      port: address.port
    });
    socket.send(payload, remote.port, remote.address, () => {});
  });

  return new Promise((resolve, reject) => {
    let ready = false;
    socket.once('error', (error) => {
      if (ready) return;
      ready = true;
      try {
        socket.close();
      } catch {}
      reject(error);
    });
    socket.bind(lanDiscoveryPort, '0.0.0.0', () => {
      ready = true;
      lanDiscoverySocket = socket;
      resolve(true);
    });
  });
}

const lanDiscoveryTimeout = 3000;
const lanDiscoveryProbeInterval = 800;

async function discoverLanShares(options = {}) {
  const targets = normalizeDiscoveryTargets(options.targets);
  const interfaces = getLanInterfaces();
  const devices = new Map();
  const sockets = [];

  const handleMessage = (message, remote) => {
    try {
      const result = JSON.parse(message.toString());
      if (result.type !== lanDiscoveryResponse) return;
      const port = Number(result.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return;
      const address = remote.address;
      const id = `${address}:${port}`;
      devices.set(id, {
        id,
        name: String(result.name || address),
        address,
        url: `http://${address}:${port}`
      });
    } catch {
      // Ignore unrelated UDP broadcasts.
    }
  };

  const createProbeSocket = (bindAddress) =>
    new Promise((resolve) => {
      let settled = false;
      const done = (socket) => {
        if (settled) return;
        settled = true;
        resolve(socket);
      };
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const guard = setTimeout(() => {
        try {
          socket.close();
        } catch {}
        done(null);
      }, 1000);
      socket.on('error', () => {
        clearTimeout(guard);
        done(null);
      });
      socket.on('message', handleMessage);
      socket.bind(0, bindAddress, () => {
        clearTimeout(guard);
        try {
          socket.setBroadcast(true);
        } catch {}
        sockets.push(socket);
        done(socket);
      });
    });

  const receiver = await createProbeSocket('0.0.0.0');
  const interfaceSockets = await Promise.all(
    interfaces.map((item) => createProbeSocket(item.address))
  );

  const sendProbe = (socket, address) => {
    if (!socket || !address) return;
    try {
      socket.send(lanDiscoveryRequest, lanDiscoveryPort, address, () => {});
    } catch {
      // Ignore interfaces that reject broadcast traffic.
    }
  };

  const probe = () => {
    sendProbe(receiver, '255.255.255.255');
    interfaceSockets.forEach((socket, index) => sendProbe(socket, interfaces[index].broadcast));
    for (const target of targets) sendProbe(receiver, target);
  };

  return new Promise((resolve, reject) => {
    let completed = false;
    let timer;
    let interval;
    const finish = (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      clearInterval(interval);
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {}
      }
      if (error) {
        reject(new Error(`局域网设备搜索失败：${error.message}`));
        return;
      }
      resolve([...devices.values()].sort((left, right) => left.name.localeCompare(right.name)));
    };
    timer = setTimeout(() => finish(), lanDiscoveryTimeout);
    interval = setInterval(probe, lanDiscoveryProbeInterval);
    probe();
  });
}

async function startLanShare() {
  if (lanShareServer) return lanShareInfo();

  lanShareToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  lanShareFrame = null;
  lanShareServer = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const token = requestUrl.searchParams.get('token') || '';
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    if (token !== lanShareToken) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: '配对码错误' }));
      return;
    }

    if (requestUrl.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (requestUrl.pathname === '/frame') {
      try {
        const frame = lanShareFrame || await captureLanFrame();
        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': frame.length });
        response.end(frame);
      } catch (error) {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    if (requestUrl.pathname === '/config') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      response.end(JSON.stringify(readConfig()));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });

  try {
    await new Promise((resolve, reject) => {
      lanShareServer.once('error', reject);
      lanShareServer.listen(8765, '0.0.0.0', resolve);
    });
  } catch (error) {
    lanShareServer.close();
    lanShareServer = null;
    throw new Error(`共享端端口启动失败：${error.message}`);
  }

  await captureLanFrame();
  lanShareTimer = setInterval(() => {
    captureLanFrame().catch(() => {});
  }, 400);
  await startLanDiscoveryResponder().catch(() => false);
  return lanShareInfo();
}

async function stopLanShare() {
  if (lanShareTimer) clearInterval(lanShareTimer);
  lanShareTimer = null;
  lanShareFrame = null;
  lanShareToken = '';
  if (lanDiscoverySocket) {
    await new Promise((resolve) => lanDiscoverySocket.close(() => resolve()));
    lanDiscoverySocket = null;
  }
  if (lanShareServer) {
    await new Promise((resolve) => lanShareServer.close(() => resolve()));
    lanShareServer = null;
  }
  return { ok: true };
}

function endpointFor(config, apiBackend) {
  return `${config.baseUrl.replace(/\/+$/, '')}/${apiBackend === 'responses' ? 'responses' : 'chat/completions'}`;
}

async function streamCompletion({ config, apiBackend, requestBody, eventName }) {
  const endpoint = endpointFor(config, apiBackend);
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  activeAbortController = controller;

  let response;
  try {
    await session.defaultSession.setProxy(
      config.proxyUrl ? { proxyRules: config.proxyUrl } : { mode: 'system' }
    );
    // Electron's network stack can use the desktop app's proxy/session settings;
    // Node's standalone fetch often cannot reach services behind a system proxy.
    response = await net.fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const cause = error && error.cause && error.cause.message
      ? error.cause.message
      : (error.message || '网络连接失败');
    throw new Error(`无法连接模型服务：${endpoint}\n原因：${cause}\n请检查 API 地址、网络连接和代理设置。`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `模型请求失败（HTTP ${response.status} ${response.statusText}）\n${errorText.slice(0, 500) || '服务端未提供错误详情'}\n请检查 API 协议、API Key 和模型名称。`
    );
  }

  if (!response.body) {
    const json = await response.json();
    const text = apiBackend === 'responses' ? extractResponsesText(json) : extractDelta(json);
    if (!text) throw new Error('模型没有返回可显示的内容');
    sendToRenderer(`${eventName}-chunk`, text);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedText = false;

  const processEvents = (flush = false) => {
    if (flush) buffer += decoder.decode();
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';
    if (flush && buffer.trim()) {
      events.push(buffer);
      buffer = '';
    }

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      const data = dataLines.length ? dataLines.join('\n') : (flush ? event.trim() : '');
      if (!data) continue;
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const streamedText = extractStreamText(parsed, apiBackend);
        const text = streamedText || (!receivedText
          ? (apiBackend === 'responses' ? extractResponsesText(parsed) : extractDelta(parsed))
          : '');
        if (text) {
          receivedText = true;
          sendToRenderer(`${eventName}-chunk`, text);
        }
      } catch {
        // Ignore keep-alive or provider-specific non-JSON SSE frames.
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    processEvents();
  }
  processEvents(true);
  if (!receivedText) throw new Error('模型没有返回可显示的内容');
}

async function streamVisionAnalysis(payload, config) {
  if (!config.baseUrl) throw new Error('请先在设置中填写视觉模型 API 地址');
  if (!config.model) throw new Error('请先在设置中填写视觉模型名称');

  const rawImageDataUrls = Array.isArray(payload && payload.imageDataUrls)
    ? payload.imageDataUrls
    : [payload && payload.imageDataUrl];
  const imageDataUrls = rawImageDataUrls.filter((imageDataUrl) =>
    typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image/'));
  if (imageDataUrls.length === 0 || imageDataUrls.length !== rawImageDataUrls.length) {
    throw new Error('截图数据无效，请重新添加截图');
  }

  const prompt = (payload && payload.prompt) || '请分析这些截图并给出回答。';
  const apiBackend = resolveApiBackend(config);
  const requestBody = apiBackend === 'responses'
    ? {
        model: config.model,
        stream: true,
        instructions: config.systemPrompt,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              ...imageDataUrls.map((imageDataUrl) => ({ type: 'input_image', image_url: imageDataUrl, detail: 'high' }))
            ]
          }
        ]
      }
    : {
        model: config.model,
        stream: true,
        temperature: 0.2,
        messages: [
          { role: 'system', content: config.systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageDataUrls.map((imageDataUrl) => ({ type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }))
            ]
          }
        ]
      };

  await streamCompletion({ config, apiBackend, requestBody, eventName: 'analysis' });
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((item) => item
      && (item.role === 'user' || item.role === 'assistant')
      && typeof item.content === 'string'
      && item.content.trim())
    .map((item) => ({ role: item.role, content: item.content }));
}

async function streamChatFollowUp(payload, config) {
  if (!config.baseUrl) throw new Error('请先在设置中填写对话模型 API 地址');
  if (!config.model) throw new Error('请先在设置中填写对话模型名称');

  const source = payload || {};
  const history = sanitizeHistory(source.history).slice(-20);
  if (!history.length) throw new Error('没有可发送的对话内容');

  const rawImageDataUrls = Array.isArray(source.imageDataUrls)
    ? source.imageDataUrls
    : [source.imageDataUrl];
  const imageDataUrls = rawImageDataUrls.filter((imageDataUrl) =>
    typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image/'));
  const systemPrompt = config.chatSystemPrompt;
  const apiBackend = resolveApiBackend(config);

  let requestBody;
  if (apiBackend === 'responses') {
    requestBody = {
      model: config.model,
      stream: true,
      instructions: systemPrompt,
      input: history.map((item, index) => {
        const content = [];
        // Only the first turn carries screenshots, keeping follow-ups cheap.
        if (index === 0 && imageDataUrls.length) {
          content.push(...imageDataUrls.map((imageDataUrl) => ({
            type: 'input_image', image_url: imageDataUrl, detail: 'high'
          })));
        }
        content.push({ type: 'input_text', text: item.content });
        return { role: item.role, content };
      })
    };
  } else {
    const messages = [{ role: 'system', content: systemPrompt }];
    history.forEach((item, index) => {
      if (index === 0 && imageDataUrls.length) {
        messages.push({
          role: item.role,
          content: [
            ...imageDataUrls.map((imageDataUrl) => ({
              type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' }
            })),
            { type: 'text', text: item.content }
          ]
        });
      } else {
        messages.push({ role: item.role, content: item.content });
      }
    });
    requestBody = { model: config.model, stream: true, temperature: 0.2, messages };
  }

  await streamCompletion({ config, apiBackend, requestBody, eventName: 'chat' });
}

function buildPresetQueue(group, requestedPresetId) {
  if (requestedPresetId) {
    const selected = group.presets.find((preset) => preset.id === requestedPresetId);
    if (!selected) throw new Error('所选模型已从配置中移除，请重新选择后发送。');
    return [selected];
  }
  const selected = group.presets.find((preset) => preset.id === group.activePresetId) || group.presets[0];
  return [selected];
}

async function runWithFallback({ group, autoFallback, requestedPresetId, eventName, run }) {
  const queue = buildPresetQueue(group, requestedPresetId);
  const failures = [];

  for (let index = 0; index < queue.length; index += 1) {
    const preset = queue[index];
    sendToRenderer(`${eventName}-attempt`, {
      presetId: preset.id,
      presetName: preset.name,
      attempt: index + 1,
      total: queue.length
    });

    try {
      await run(preset);
      return { presetId: preset.id, presetName: preset.name, attempts: index + 1 };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      failures.push(`${preset.name}：${error.message}`);
      const nextPreset = queue[index + 1];
      if (nextPreset) {
        sendToRenderer(`${eventName}-fallback`, {
          failedPresetName: preset.name,
          nextPresetName: nextPreset.name,
          error: error.message
        });
      }
    }
  }

  throw new Error(failures.join('\n'));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#f5f7fb',
    title: '屏桥 ScreenBridge',
    show: !process.argv.includes('--hidden'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  trayLifecycle?.attachWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  cloudDeviceStore = new CloudDeviceStore(app.getPath('userData'), safeStorage);
  try {
    cloudPairCredentials = cloudDeviceStore.load();
    if (cloudPairCredentials) sendCloudShareStatus('reconnecting', '正在恢复已绑定的采集电脑…');
  } catch (error) {
    sendCloudShareStatus('error', error.message);
  }

  ipcMain.handle('get-config', () => readConfig());
  ipcMain.handle('save-config', (_event, config) => {
    const saved = writeConfig(config);
    sendCloudConfig();
    return saved;
  });
  ipcMain.handle('get-screen-source', () => extractScreenSource());
  ipcMain.handle('capture-screen', () => capturePrimaryScreen());
  ipcMain.handle('start-lan-share', () => startLanShare());
  ipcMain.handle('stop-lan-share', () => stopLanShare());
  ipcMain.handle('start-cloud-share', () => startCloudShare());
  ipcMain.handle('stop-cloud-share', () => stopCloudShare());
  ipcMain.handle('get-cloud-share-state', () => ({ status: lastCloudShareStatus, info: cloudPairInfo() }));
  ipcMain.handle('get-cloud-auto-start', () => getCloudAutoStart(app));
  ipcMain.handle('set-cloud-auto-start', (_event, enabled) => setCloudAutoStart(app, enabled));
  ipcMain.handle('discover-lan-shares', (_event, options) => discoverLanShares(options || {}));
  ipcMain.handle('get-lan-networks', () => getLanInterfaces());
  ipcMain.handle('minimize-lan-share', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return { ok: true };
  });
  ipcMain.handle('copy-text', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('stop-analysis', () => {
    if (activeAbortController) activeAbortController.abort();
    return { ok: true };
  });
  ipcMain.handle('analyze-image', async (_event, payload) => {
    try {
      const config = readConfig();
      const result = await runWithFallback({
        group: config.vision,
        autoFallback: config.autoFallback,
        requestedPresetId: payload && payload.presetId,
        eventName: 'analysis',
        run: (preset) => streamVisionAnalysis(payload, { ...preset, systemPrompt: config.systemPrompt })
      });
      sendToRenderer('analysis-complete', result);
      return { ok: true, ...result };
    } catch (error) {
      if (error.name === 'AbortError') {
        sendToRenderer('analysis-stopped');
        return { ok: false, stopped: true };
      }
      sendToRenderer('analysis-error', error.message);
      return { ok: false, error: error.message };
    } finally {
      activeAbortController = null;
    }
  });

  ipcMain.handle('chat-followup', async (_event, payload) => {
    try {
      const config = readConfig();
      const result = await runWithFallback({
        group: config.chat,
        autoFallback: config.autoFallback,
        requestedPresetId: payload && payload.presetId,
        eventName: 'chat',
        run: (preset) => streamChatFollowUp(payload, { ...preset, chatSystemPrompt: config.chatSystemPrompt })
      });
      sendToRenderer('chat-complete', result);
      return { ok: true, ...result };
    } catch (error) {
      if (error.name === 'AbortError') {
        sendToRenderer('chat-stopped');
        return { ok: false, stopped: true };
      }
      sendToRenderer('chat-error', error.message);
      return { ok: false, error: error.message };
    } finally {
      activeAbortController = null;
    }
  });

  trayLifecycle = createTrayLifecycle({
    app,
    Tray,
    Menu,
    getWindow: () => mainWindow,
    canQuit: () => !cloudStopPending || cloudStopSafeToExit || allowUnsafeCloudStopExit,
    iconPath: path.join(__dirname, 'assets', 'icon.ico')
  });
  createWindow();
  if (cloudPairCredentials) connectCloudPair();
});

app.on('window-all-closed', () => {
  stopLanShare().catch(() => {});
  if (process.platform !== 'darwin' && !isQuitting) app.quit();
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else trayLifecycle?.showWindow();
});

app.on('before-quit', (event) => {
  if (cloudStopPending && !cloudStopSafeToExit && !allowUnsafeCloudStopExit) {
    event.preventDefault();
    if (cloudStopOperationActive) {
      cloudStopQuitRequested = true;
    } else {
      showUnsafeCloudStopExitPrompt();
    }
    return;
  }
  isQuitting = true;
  stopLanShare().catch(() => {});
  pauseCloudPairForShutdown();
});
