const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  ipcMain,
  net,
  safeStorage,
  screen,
  session
} = require('electron');
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let mainWindow;
let activeAbortController = null;
let lanShareServer = null;
let lanDiscoverySocket = null;
let lanShareTimer = null;
let lanShareToken = '';
let lanShareFrame = null;
let lanShareCapturing = false;

const defaultSystemPrompt =
  '你是一个面试练习助手。请准确阅读截图内容，先给出结论，再给出简洁、可直接使用的回答。信息不足时请明确指出。';

const defaultPreset = {
  id: 'model-1',
  name: '模型 1',
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

function normalizePreset(input, index = 0) {
  const fallbackId = index === 0 ? defaultPreset.id : `preset-${index + 1}`;
  const parsedPriority = Number.parseInt(input.priority, 10);
  return {
    id: String(input.id || fallbackId).trim() || fallbackId,
    name: String(input.name || `模型 ${index + 1}`).trim() || `模型 ${index + 1}`,
    baseUrl: String(input.baseUrl || '').trim(),
    model: String(input.model || '').trim(),
    apiBackend: input.apiBackend === 'chat_completions' ? 'chat_completions' : 'responses',
    apiKey: String(input.apiKey || '').trim(),
    proxyUrl: String(input.proxyUrl || '').trim(),
    enabled: input.enabled !== false,
    priority: Number.isFinite(parsedPriority) && parsedPriority > 0 ? parsedPriority : index + 1
  };
}

function readConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    stored = {};
  }

  let presets;
  if (Array.isArray(stored.presets) && stored.presets.length) {
    presets = stored.presets.map((preset, index) => normalizePreset({
      ...preset,
      apiKey: decryptApiKey(preset)
    }, index));
  } else {
    // Migrate the original single-model configuration without losing its API key.
    presets = [normalizePreset({
      ...defaultPreset,
      baseUrl: stored.baseUrl || '',
      model: stored.model || '',
      apiBackend: stored.apiBackend || defaultPreset.apiBackend,
      apiKey: decryptApiKey(stored),
      proxyUrl: stored.proxyUrl || defaultPreset.proxyUrl
    })];
  }

  const activePresetId = presets.some((preset) => preset.id === stored.activePresetId)
    ? stored.activePresetId
    : presets[0].id;
  return {
    activePresetId,
    autoFallback: stored.autoFallback !== false,
    presets,
    systemPrompt: String(stored.systemPrompt || defaultSystemPrompt).trim()
  };
}

function writeConfig(input) {
  const sourcePresets = Array.isArray(input.presets) && input.presets.length
    ? input.presets.slice(0, 30)
    : [defaultPreset];
  const presets = sourcePresets.map((preset, index) => normalizePreset(preset, index));
  const storedPresets = presets.map((preset) => {
    const storedPreset = { ...preset };
    delete storedPreset.apiKey;
    if (preset.apiKey && safeStorage.isEncryptionAvailable()) {
      storedPreset.encryptedApiKey = safeStorage.encryptString(preset.apiKey).toString('base64');
    } else {
      storedPreset.apiKey = preset.apiKey;
    }
    return storedPreset;
  });
  const activePresetId = presets.some((preset) => preset.id === input.activePresetId)
    ? input.activePresetId
    : presets[0].id;
  const storedConfig = {
    activePresetId,
    autoFallback: input.autoFallback !== false,
    presets: storedPresets,
    systemPrompt: String(input.systemPrompt || defaultSystemPrompt).trim()
  };

  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(storedConfig, null, 2), 'utf8');
  return { ...storedConfig, presets, activePresetId };
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

  mainWindow.hide();
  // Give Windows time to remove the assistant window from the compositor before
  // taking the thumbnail, so the question underneath is included instead.
  await wait(280);

  try {
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
    mainWindow.show();
    mainWindow.focus();
    sendToRenderer('screen-captured', dataUrl);
    return { ok: true, dataUrl };
  } catch (error) {
    mainWindow.show();
    mainWindow.focus();
    throw error;
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

function getLanAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return [...new Set(addresses)];
}

async function captureLanFrame() {
  if (lanShareCapturing) return lanShareFrame;
  lanShareCapturing = true;
  try {
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
    lanShareCapturing = false;
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

function discoverLanShares() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const devices = new Map();

  return new Promise((resolve, reject) => {
    let completed = false;
    let timeout;
    const finish = (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {}
      if (error) {
        reject(new Error(`局域网设备搜索失败：${error.message}`));
        return;
      }
      resolve([...devices.values()].sort((left, right) => left.name.localeCompare(right.name)));
    };

    socket.on('error', finish);
    socket.on('message', (message, remote) => {
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
    });

    timeout = setTimeout(() => finish(), 1600);
    socket.bind(0, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true);
        socket.send(lanDiscoveryRequest, lanDiscoveryPort, '255.255.255.255', (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error);
      }
    });
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

async function streamChatCompletion({ imageDataUrl, prompt }, config) {
  if (!config.baseUrl) throw new Error('请先填写模型 API 地址');
  if (!config.model) throw new Error('请先填写模型名称');

  if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
    throw new Error('截图数据无效，请重新点击“截图并分析”');
  }

  const apiBackend = resolveApiBackend(config);
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/${apiBackend === 'responses' ? 'responses' : 'chat/completions'}`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

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
              { type: 'input_image', image_url: imageDataUrl, detail: 'high' }
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
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
            ]
          }
        ]
      };

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
    sendToRenderer('analysis-chunk', text);
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
          sendToRenderer('analysis-chunk', text);
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

function buildPresetQueue(config, requestedPresetId) {
  const selected = config.presets.find((preset) => preset.id === requestedPresetId)
    || config.presets.find((preset) => preset.id === config.activePresetId)
    || config.presets[0];
  if (!config.autoFallback) return [selected];

  const fallbackPresets = config.presets
    .filter((preset) => preset.id !== selected.id && preset.enabled)
    .sort((left, right) => left.priority - right.priority);
  return [selected, ...fallbackPresets];
}

async function analyzeWithFallback(payload) {
  const config = readConfig();
  const queue = buildPresetQueue(config, payload.presetId);
  const failures = [];

  for (let index = 0; index < queue.length; index += 1) {
    const preset = queue[index];
    sendToRenderer('analysis-attempt', {
      presetId: preset.id,
      presetName: preset.name,
      attempt: index + 1,
      total: queue.length
    });

    try {
      await streamChatCompletion(payload, { ...preset, systemPrompt: config.systemPrompt });
      return { presetId: preset.id, presetName: preset.name, attempts: index + 1 };
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      failures.push(`${preset.name}：${error.message}`);
      const nextPreset = queue[index + 1];
      if (nextPreset) {
        sendToRenderer('analysis-fallback', {
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('get-config', () => readConfig());
  ipcMain.handle('save-config', (_event, config) => writeConfig(config));
  ipcMain.handle('get-screen-source', () => extractScreenSource());
  ipcMain.handle('capture-screen', () => capturePrimaryScreen());
  ipcMain.handle('start-lan-share', () => startLanShare());
  ipcMain.handle('stop-lan-share', () => stopLanShare());
  ipcMain.handle('discover-lan-shares', () => discoverLanShares());
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
      const result = await analyzeWithFallback(payload);
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

  createWindow();
});

app.on('window-all-closed', () => {
  stopLanShare().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
