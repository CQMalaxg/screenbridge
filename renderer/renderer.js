const api = window.assistantAPI;

const elements = {
  captureAnalyzeButton: document.getElementById('captureAnalyzeButton'),
  retryAnalyzeButton: document.getElementById('retryAnalyzeButton'),
  clearButton: document.getElementById('clearButton'),
  stopButton: document.getElementById('stopButton'),
  copyButton: document.getElementById('copyButton'),
  saveButton: document.getElementById('saveButton'),
  screenMonitor: document.getElementById('screenMonitor'),
  screenPreview: document.getElementById('screenPreview'),
  previewWrap: document.getElementById('previewWrap'),
  promptInput: document.getElementById('promptInput'),
  answerPlaceholder: document.getElementById('answerPlaceholder'),
  answerText: document.getElementById('answerText'),
  captureStatus: document.getElementById('captureStatus'),
  shortcutStatus: document.getElementById('shortcutStatus'),
  saveStatus: document.getElementById('saveStatus'),
  requestPresetSelect: document.getElementById('requestPresetSelect'),
  presetSelect: document.getElementById('presetSelect'),
  addPresetButton: document.getElementById('addPresetButton'),
  deletePresetButton: document.getElementById('deletePresetButton'),
  presetNameInput: document.getElementById('presetNameInput'),
  priorityInput: document.getElementById('priorityInput'),
  presetEnabledInput: document.getElementById('presetEnabledInput'),
  autoFallbackInput: document.getElementById('autoFallbackInput'),
  baseUrlInput: document.getElementById('baseUrlInput'),
  apiBackendInput: document.getElementById('apiBackendInput'),
  modelInput: document.getElementById('modelInput'),
  apiKeyInput: document.getElementById('apiKeyInput'),
  proxyUrlInput: document.getElementById('proxyUrlInput'),
  startShareButton: document.getElementById('startShareButton'),
  minimizeShareButton: document.getElementById('minimizeShareButton'),
  lanStatus: document.getElementById('lanStatus'),
  shareInfo: document.getElementById('shareInfo'),
  remoteUrlInput: document.getElementById('remoteUrlInput'),
  remoteTokenInput: document.getElementById('remoteTokenInput'),
  connectRemoteButton: document.getElementById('connectRemoteButton'),
  disconnectRemoteButton: document.getElementById('disconnectRemoteButton')
};

let currentImageDataUrl = '';
let answerMarkdown = '';
let screenStream = null;
let monitorStarted = false;
let isGenerating = false;
let remoteConnected = false;
let remoteBaseUrl = '';
let remoteToken = '';
let remotePollTimer = null;
let remotePolling = false;
let appConfig = null;
let editingPresetId = '';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  const codeTokens = [];

  text = text.replace(/`([^`\n]+)`/g, (_match, code) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  codeTokens.forEach((code, index) => {
    text = text.replace(`\u0000CODE${index}\u0000`, code);
  });
  return text;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let paragraph = [];
  let listType = null;
  let codeLines = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${renderInlineMarkdown(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`;
    paragraph = [];
  };

  const closeList = () => {
    if (listType) html += `</${listType}>`;
    listType = null;
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      closeList();
      if (codeLines) {
        html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
        codeLines = null;
      } else {
        codeLines = [];
      }
      continue;
    }

    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html += `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
      continue;
    }

    if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      flushParagraph();
      closeList();
      html += '<hr>';
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextListType = unordered ? 'ul' : 'ol';
      if (listType !== nextListType) {
        closeList();
        listType = nextListType;
        html += `<${listType}>`;
      }
      html += `<li>${renderInlineMarkdown((unordered || ordered)[1])}</li>`;
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      html += `<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`;
      continue;
    }

    paragraph.push(line);
  }

  if (codeLines) html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
  flushParagraph();
  closeList();
  return html;
}

function setCaptureStatus(text, isError = false) {
  elements.captureStatus.textContent = text;
  elements.captureStatus.style.color = isError ? '#d95e5e' : '';
}

function setAnswer(text) {
  answerMarkdown = text || '';
  elements.answerText.innerHTML = answerMarkdown ? renderMarkdown(answerMarkdown) : '';
  elements.answerPlaceholder.style.display = answerMarkdown ? 'none' : 'block';
}

function setGenerating(value) {
  isGenerating = value;
  elements.captureAnalyzeButton.disabled = value;
  elements.retryAnalyzeButton.disabled = value || !currentImageDataUrl;
  elements.stopButton.disabled = !value;
}

function setLanStatus(text, isError = false) {
  elements.lanStatus.textContent = text;
  elements.lanStatus.style.color = isError ? '#d95e5e' : '';
}

function activePreset() {
  return appConfig && appConfig.presets.find((preset) => preset.id === editingPresetId);
}

function commitPresetForm() {
  const preset = activePreset();
  if (!preset) return;
  const priority = Number.parseInt(elements.priorityInput.value, 10);
  Object.assign(preset, {
    name: elements.presetNameInput.value.trim() || '未命名预设',
    priority: Number.isFinite(priority) && priority > 0 ? priority : 1,
    enabled: elements.presetEnabledInput.checked,
    baseUrl: elements.baseUrlInput.value.trim(),
    apiBackend: elements.apiBackendInput.value,
    model: elements.modelInput.value.trim(),
    apiKey: elements.apiKeyInput.value.trim(),
    proxyUrl: elements.proxyUrlInput.value.trim()
  });
}

function renderPresetOptions() {
  const options = appConfig.presets
    .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} · P${preset.priority}</option>`)
    .join('');
  elements.presetSelect.innerHTML = options;
  elements.requestPresetSelect.innerHTML = options;
  elements.presetSelect.value = appConfig.activePresetId;
  elements.requestPresetSelect.value = appConfig.activePresetId;
  elements.deletePresetButton.disabled = appConfig.presets.length <= 1;
}

function renderPresetForm(presetId) {
  const preset = appConfig.presets.find((item) => item.id === presetId) || appConfig.presets[0];
  editingPresetId = preset.id;
  appConfig.activePresetId = preset.id;
  elements.presetSelect.value = preset.id;
  elements.requestPresetSelect.value = preset.id;
  elements.presetNameInput.value = preset.name || '';
  elements.priorityInput.value = preset.priority || 1;
  elements.presetEnabledInput.checked = preset.enabled !== false;
  elements.baseUrlInput.value = preset.baseUrl || '';
  elements.apiBackendInput.value = preset.apiBackend || 'responses';
  elements.modelInput.value = preset.model || '';
  elements.apiKeyInput.value = preset.apiKey || '';
  elements.proxyUrlInput.value = preset.proxyUrl || '';
  elements.autoFallbackInput.checked = appConfig.autoFallback !== false;
}

function loadConfig(config) {
  appConfig = {
    activePresetId: config.activePresetId,
    autoFallback: config.autoFallback !== false,
    systemPrompt: config.systemPrompt,
    presets: Array.isArray(config.presets) ? config.presets.map((preset) => ({ ...preset })) : []
  };
  if (!appConfig.presets.length) throw new Error('没有可用的模型预设');
  if (!appConfig.presets.some((preset) => preset.id === appConfig.activePresetId)) {
    appConfig.activePresetId = appConfig.presets[0].id;
  }
  renderPresetOptions();
  renderPresetForm(appConfig.activePresetId);
}

function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addPreset() {
  commitPresetForm();
  const current = activePreset();
  const nextPriority = Math.max(...appConfig.presets.map((preset) => preset.priority || 0)) + 1;
  const preset = {
    id: createPresetId(),
    name: `新预设 ${appConfig.presets.length + 1}`,
    baseUrl: current ? current.baseUrl : '',
    model: '',
    apiBackend: current ? current.apiBackend : 'responses',
    apiKey: current ? current.apiKey : '',
    proxyUrl: current ? current.proxyUrl : '',
    enabled: true,
    priority: nextPriority
  };
  appConfig.presets.push(preset);
  appConfig.activePresetId = preset.id;
  renderPresetOptions();
  renderPresetForm(preset.id);
  elements.presetNameInput.focus();
  elements.presetNameInput.select();
}

function deletePreset() {
  if (appConfig.presets.length <= 1) return;
  const index = appConfig.presets.findIndex((preset) => preset.id === editingPresetId);
  appConfig.presets.splice(index, 1);
  const nextPreset = appConfig.presets[Math.min(index, appConfig.presets.length - 1)];
  appConfig.activePresetId = nextPreset.id;
  renderPresetOptions();
  renderPresetForm(nextPreset.id);
}

function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 2400;
      const scale = Math.min(1, maxWidth / image.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.84));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function receiveScreenshot(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('截图数据无效');
  }
  currentImageDataUrl = dataUrl;
  elements.screenPreview.src = dataUrl;
  elements.previewWrap.classList.add('has-image');
  elements.retryAnalyzeButton.disabled = isGenerating;
  setCaptureStatus('已截图，准备分析');
  setAnswer('');
}

async function startScreenMonitor() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前 Electron 环境不支持屏幕监听');
    }

    const source = await api.getScreenSource();
    screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 30
        }
      }
    });

    elements.screenMonitor.srcObject = screenStream;
    await elements.screenMonitor.play();
    monitorStarted = true;
    elements.shortcutStatus.textContent = '屏幕监听中 · 点击按钮分析';
    setCaptureStatus('屏幕监听中，点击“截图并分析”');
  } catch (error) {
    monitorStarted = false;
    elements.shortcutStatus.textContent = '监听启动失败，将使用单次截图';
    setCaptureStatus(`监听启动失败：${error.message || error}`, true);
  }
}

function stopScreenMonitor() {
  if (screenStream) screenStream.getTracks().forEach((track) => track.stop());
  screenStream = null;
  monitorStarted = false;
}

function normalizeRemoteUrl(value) {
  let url = String(value || '').trim();
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function fetchRemoteFrameData() {
  if (!remoteBaseUrl || !remoteToken) throw new Error('请先连接远程屏幕');
  const endpoint = `${remoteBaseUrl}/frame?token=${encodeURIComponent(remoteToken)}&t=${Date.now()}`;
  const response = await fetch(endpoint, { cache: 'no-store' });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`远程屏幕请求失败（${response.status}）：${message.slice(0, 160)}`);
  }
  return blobToDataUrl(await response.blob());
}

async function pollRemotePreview() {
  if (!remoteConnected || remotePolling) return;
  remotePolling = true;
  try {
    const dataUrl = await fetchRemoteFrameData();
    elements.screenPreview.src = dataUrl;
    elements.previewWrap.classList.add('has-image');
    setLanStatus('已连接 · 远程画面监控中');
  } catch (error) {
    setLanStatus(error.message || '远程画面连接失败', true);
  } finally {
    remotePolling = false;
  }
}

function startRemotePolling() {
  if (remotePollTimer) clearInterval(remotePollTimer);
  pollRemotePreview();
  remotePollTimer = setInterval(pollRemotePreview, 450);
}

function stopRemotePolling() {
  if (remotePollTimer) clearInterval(remotePollTimer);
  remotePollTimer = null;
  remotePolling = false;
}

async function startShare() {
  try {
    const info = await api.startLanShare();
    const urls = info.urls.length ? info.urls.join('\n') : `端口：${info.port}`;
    elements.shareInfo.textContent = `共享地址：\n${urls}\n配对码：${info.token}`;
    elements.minimizeShareButton.disabled = false;
    setLanStatus('共享端运行中');
  } catch (error) {
    setLanStatus(error.message || '共享端启动失败', true);
  }
}

async function minimizeShare() {
  await api.minimizeLanShare();
  setLanStatus('共享端运行中 · 窗口已最小化');
}

async function connectRemote() {
  const url = normalizeRemoteUrl(elements.remoteUrlInput.value);
  const token = elements.remoteTokenInput.value.trim();
  if (!url || !token) {
    setLanStatus('请输入远程地址和配对码', true);
    return;
  }

  try {
    setLanStatus('正在连接远程屏幕…');
    remoteBaseUrl = url;
    remoteToken = token;
    await fetchRemoteFrameData();
    remoteConnected = true;
    stopScreenMonitor();
    elements.connectRemoteButton.disabled = true;
    elements.disconnectRemoteButton.disabled = false;
    elements.remoteUrlInput.value = url;
    startRemotePolling();
    elements.shortcutStatus.textContent = '远程屏幕监听中';
  } catch (error) {
    remoteConnected = false;
    setLanStatus(error.message || '远程连接失败', true);
  }
}

function disconnectRemote() {
  remoteConnected = false;
  remoteBaseUrl = '';
  remoteToken = '';
  stopRemotePolling();
  elements.connectRemoteButton.disabled = false;
  elements.disconnectRemoteButton.disabled = true;
  setLanStatus('未连接');
  elements.shortcutStatus.textContent = '屏幕监听中';
  startScreenMonitor();
}

async function captureCurrentScreen() {
  if (remoteConnected) return fetchRemoteFrameData();

  // The monitor stream contains the assistant window itself. For the actual
  // snapshot, hide the window briefly and capture a fresh frame underneath it.
  const result = await api.captureScreen();
  return result.dataUrl;
}

async function saveConfig(showStatus = true) {
  if (!appConfig) throw new Error('模型预设尚未加载完成');
  commitPresetForm();
  appConfig.autoFallback = elements.autoFallbackInput.checked;
  appConfig.activePresetId = editingPresetId;
  const config = await api.saveConfig(appConfig);
  loadConfig(config);
  if (showStatus) {
    elements.saveStatus.textContent = '已保存';
    setTimeout(() => { elements.saveStatus.textContent = '本地保存'; }, 1800);
  }
}

async function analyzeScreenshot(screenshot) {
  if (typeof screenshot !== 'string' || !screenshot.startsWith('data:image/')) {
    throw new Error('没有获取到有效截图，请重试');
  }
  receiveScreenshot(screenshot);
  await saveConfig(false);
  const imageDataUrl = await compressImage(screenshot);
  setAnswer('');
  setGenerating(true);
  setCaptureStatus('正在分析…');
  await api.analyzeImage({
    imageDataUrl,
    prompt: elements.promptInput.value.trim() || '请分析这张截图并给出回答。',
    presetId: appConfig.activePresetId
  });
}

async function captureAndAnalyze() {
  if (isGenerating) return;

  try {
    setCaptureStatus('正在获取当前屏幕…');
    const screenshot = await captureCurrentScreen();
    await analyzeScreenshot(screenshot);
  } catch (error) {
    setGenerating(false);
    setCaptureStatus('分析失败', true);
    setAnswer(`分析失败：\n${error.message || error}`);
  }
}

async function retryCurrentScreenshot() {
  if (isGenerating || !currentImageDataUrl) return;
  try {
    await analyzeScreenshot(currentImageDataUrl);
  } catch (error) {
    setGenerating(false);
    setCaptureStatus('分析失败', true);
    setAnswer(`分析失败：\n${error.message || error}`);
  }
}

function clearAll() {
  currentImageDataUrl = '';
  elements.screenPreview.removeAttribute('src');
  elements.previewWrap.classList.remove('has-image');
  elements.retryAnalyzeButton.disabled = true;
  setCaptureStatus(remoteConnected ? '远程屏幕连接中' : (monitorStarted ? '屏幕监听中，点击“截图并分析”' : '等待截图'));
  setAnswer('');
}

elements.captureAnalyzeButton.addEventListener('click', captureAndAnalyze);
elements.retryAnalyzeButton.addEventListener('click', retryCurrentScreenshot);
elements.clearButton.addEventListener('click', clearAll);
elements.startShareButton.addEventListener('click', startShare);
elements.minimizeShareButton.addEventListener('click', minimizeShare);
elements.connectRemoteButton.addEventListener('click', connectRemote);
elements.disconnectRemoteButton.addEventListener('click', disconnectRemote);
elements.stopButton.addEventListener('click', async () => {
  await api.stopAnalysis();
});
elements.addPresetButton.addEventListener('click', addPreset);
elements.deletePresetButton.addEventListener('click', deletePreset);
elements.presetSelect.addEventListener('change', (event) => {
  commitPresetForm();
  appConfig.autoFallback = elements.autoFallbackInput.checked;
  appConfig.activePresetId = event.target.value;
  renderPresetOptions();
  renderPresetForm(appConfig.activePresetId);
});
elements.requestPresetSelect.addEventListener('change', (event) => {
  commitPresetForm();
  appConfig.autoFallback = elements.autoFallbackInput.checked;
  appConfig.activePresetId = event.target.value;
  renderPresetOptions();
  renderPresetForm(appConfig.activePresetId);
});
elements.saveButton.addEventListener('click', () => {
  saveConfig(true).catch((error) => {
    elements.saveStatus.textContent = error.message || '保存失败';
  });
});
elements.copyButton.addEventListener('click', async () => {
  const answer = answerMarkdown.trim();
  if (!answer) return;
  await api.copyText(answer);
  elements.copyButton.textContent = '已复制';
  setTimeout(() => { elements.copyButton.textContent = '复制'; }, 1200);
});

api.onScreenCaptured(receiveScreenshot);
api.onCaptureError((message) => setCaptureStatus(message, true));
api.onAnalysisAttempt((details) => {
  setAnswer('');
  setCaptureStatus(`正在使用 ${details.presetName}（${details.attempt}/${details.total}）…`);
});
api.onAnalysisFallback((details) => {
  setCaptureStatus(`${details.failedPresetName} 请求失败，正在切换到 ${details.nextPresetName}…`, true);
});
api.onAnalysisChunk((chunk) => {
  answerMarkdown += chunk;
  elements.answerText.innerHTML = renderMarkdown(answerMarkdown);
  elements.answerPlaceholder.style.display = 'none';
  elements.answerText.parentElement.scrollTop = elements.answerText.parentElement.scrollHeight;
});
api.onAnalysisComplete((details) => {
  setGenerating(false);
  const suffix = details && details.attempts > 1 ? `，已切换到 ${details.presetName}` : '';
  setCaptureStatus(`分析完成${suffix}，可再次点击按钮`);
});
api.onAnalysisStopped(() => {
  setGenerating(false);
  setCaptureStatus('已停止生成');
});
api.onAnalysisError((message) => {
  setGenerating(false);
  setCaptureStatus('分析失败', true);
  setAnswer(`分析失败：\n${message}`);
});

api.getConfig()
  .then(loadConfig)
  .catch(() => setCaptureStatus('配置读取失败', true));
startScreenMonitor();

window.addEventListener('beforeunload', () => {
  stopRemotePolling();
  stopScreenMonitor();
});
