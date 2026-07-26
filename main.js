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
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let mainWindow;
let activeAbortController = null;
let lanShareServer = null;
let lanShareTimer = null;
let lanShareToken = '';
let lanShareFrame = null;
let lanShareCapturing = false;

const defaultConfig = {
  baseUrl: 'https://right.ai/grok/v1',
  model: 'grok-4.5',
  apiBackend: 'responses',
  apiKey: '',
  proxyUrl: '',
  systemPrompt:
    '你是一个面试练习助手。请准确阅读截图内容，先给出结论，再给出简洁、可直接使用的回答。信息不足时请明确指出。'
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    stored = {};
  }

  let apiKey = stored.apiKey || '';
  if (stored.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64'));
    } catch {
      apiKey = '';
    }
  }

  return {
    ...defaultConfig,
    ...stored,
    apiKey
  };
}

function writeConfig(input) {
  const config = {
    baseUrl: String(input.baseUrl || defaultConfig.baseUrl).trim(),
    model: String(input.model || defaultConfig.model).trim(),
    apiBackend: input.apiBackend === 'chat_completions' ? 'chat_completions' : 'responses',
    proxyUrl: String(input.proxyUrl || '').trim(),
    systemPrompt: String(input.systemPrompt || defaultConfig.systemPrompt).trim()
  };

  const apiKey = String(input.apiKey || '').trim();
  if (apiKey && safeStorage.isEncryptionAvailable()) {
    config.encryptedApiKey = safeStorage.encryptString(apiKey).toString('base64');
  } else {
    config.apiKey = apiKey;
  }

  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
  return { ...config, apiKey };
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
    addresses: addressList,
    urls: addressList.map((address) => `http://${address}:${port}`)
  };
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
  return lanShareInfo();
}

async function stopLanShare() {
  if (lanShareTimer) clearInterval(lanShareTimer);
  lanShareTimer = null;
  lanShareFrame = null;
  lanShareToken = '';
  if (lanShareServer) {
    await new Promise((resolve) => lanShareServer.close(() => resolve()));
    lanShareServer = null;
  }
  return { ok: true };
}

async function streamChatCompletion({ imageDataUrl, prompt }) {
  const config = readConfig();
  if (!config.baseUrl) throw new Error('请先填写模型 API 地址');
  if (!config.model) throw new Error('请先填写模型名称');

  const apiBackend = config.apiBackend === 'chat_completions' ? 'chat_completions' : 'responses';
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
              { type: 'input_image', image_url: imageDataUrl }
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
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ]
      };

  await session.defaultSession.setProxy(
    config.proxyUrl ? { proxyRules: config.proxyUrl } : { mode: 'system' }
  );

  const controller = new AbortController();
  activeAbortController = controller;

  let response;
  try {
    // Electron's network stack can use the desktop app's proxy/session settings;
    // Node's standalone fetch often cannot reach services behind a system proxy.
    response = await net.fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    const cause = error && error.cause && error.cause.message ? `（${error.cause.message}）` : '';
    throw new Error(`无法连接模型服务：${endpoint}${cause}。请检查网络、代理或接口地址。`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`模型请求失败（${response.status}）：${errorText.slice(0, 500)}`);
  }

  if (!response.body) {
    const json = await response.json();
    const text = apiBackend === 'responses' ? extractResponsesText(json) : extractDelta(json);
    if (text) sendToRenderer('analysis-chunk', text);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processEvents = (flush = false) => {
    if (flush) buffer += decoder.decode();
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      if (!dataLines.length) continue;
      const data = dataLines.join('\n');
      if (data === '[DONE]') continue;
      try {
        const text = extractStreamText(JSON.parse(data), apiBackend);
        if (text) sendToRenderer('analysis-chunk', text);
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
      await streamChatCompletion(payload);
      sendToRenderer('analysis-complete');
      return { ok: true };
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
