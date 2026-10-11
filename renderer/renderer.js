const api = window.assistantAPI;

const elements = {
  addScreenshotButton: document.getElementById('addScreenshotButton'),
  analyzeScreenshotsButton: document.getElementById('analyzeScreenshotsButton'),
  retryAnalyzeButton: document.getElementById('retryAnalyzeButton'),
  clearButton: document.getElementById('clearButton'),
  stopButton: document.getElementById('stopButton'),
  copyButton: document.getElementById('copyButton'),
  clearChatButton: document.getElementById('clearChatButton'),
  screenMonitor: document.getElementById('screenMonitor'),
  screenPreview: document.getElementById('screenPreview'),
  previewWrap: document.getElementById('previewWrap'),
  screenshotGallery: document.getElementById('screenshotGallery'),
  promptInput: document.getElementById('promptInput'),
  visionPromptPresetSelect: document.getElementById('visionPromptPresetSelect'),
  visionPromptPresetAddButton: document.getElementById('visionPromptPresetAddButton'),
  visionPromptPresetUpdateButton: document.getElementById('visionPromptPresetUpdateButton'),
  visionPromptPresetDeleteButton: document.getElementById('visionPromptPresetDeleteButton'),
  visionPromptPresetStatus: document.getElementById('visionPromptPresetStatus'),
  captureStatus: document.getElementById('captureStatus'),
  shortcutStatus: document.getElementById('shortcutStatus'),
  thread: document.getElementById('thread'),
  threadEmpty: document.getElementById('threadEmpty'),
  chatInput: document.getElementById('chatInput'),
  chatPromptPresetSelect: document.getElementById('chatPromptPresetSelect'),
  chatPromptPresetAddButton: document.getElementById('chatPromptPresetAddButton'),
  chatPromptPresetUpdateButton: document.getElementById('chatPromptPresetUpdateButton'),
  chatPromptPresetDeleteButton: document.getElementById('chatPromptPresetDeleteButton'),
  chatPromptPresetStatus: document.getElementById('chatPromptPresetStatus'),
  chatHint: document.getElementById('chatHint'),
  sendChatButton: document.getElementById('sendChatButton'),
  attachImageInput: document.getElementById('attachImageInput'),
  settingsButton: document.getElementById('settingsButton'),
  visionChip: document.getElementById('visionChip'),
  chatChip: document.getElementById('chatChip'),
  settingsModal: document.getElementById('settingsModal'),
  settingsTabs: document.getElementById('settingsTabs'),
  closeSettingsButton: document.getElementById('closeSettingsButton'),
  cancelSettingsButton: document.getElementById('cancelSettingsButton'),
  tabHint: document.getElementById('tabHint'),
  saveButton: document.getElementById('saveButton'),
  saveStatus: document.getElementById('saveStatus'),
  stPresetSelect: document.getElementById('stPresetSelect'),
  stAddPresetButton: document.getElementById('stAddPresetButton'),
  stDeletePresetButton: document.getElementById('stDeletePresetButton'),
  stPresetNameInput: document.getElementById('stPresetNameInput'),
  stPrimaryPresetInput: document.getElementById('stPrimaryPresetInput'),
  stPrimaryPresetLabel: document.getElementById('stPrimaryPresetLabel'),
  stPriorityInput: document.getElementById('stPriorityInput'),
  stPresetEnabledInput: document.getElementById('stPresetEnabledInput'),
  stAutoFallbackInput: document.getElementById('stAutoFallbackInput'),
  stBaseUrlInput: document.getElementById('stBaseUrlInput'),
  stApiBackendInput: document.getElementById('stApiBackendInput'),
  stModelInput: document.getElementById('stModelInput'),
  stApiKeyInput: document.getElementById('stApiKeyInput'),
  stProxyUrlInput: document.getElementById('stProxyUrlInput'),
  stSystemPromptInput: document.getElementById('stSystemPromptInput'),
  stChatSystemPromptInput: document.getElementById('stChatSystemPromptInput'),
  stVisionPromptField: document.getElementById('stVisionPromptField'),
  stChatPromptField: document.getElementById('stChatPromptField'),
  startShareButton: document.getElementById('startShareButton'),
  startCloudShareButton: document.getElementById('startCloudShareButton'),
  copyCloudCodeButton: document.getElementById('copyCloudCodeButton'),
  stopCloudShareButton: document.getElementById('stopCloudShareButton'),
  cloudPairStatus: document.getElementById('cloudPairStatus'),
  cloudShareInfo: document.getElementById('cloudShareInfo'),
  minimizeShareButton: document.getElementById('minimizeShareButton'),
  lanStatus: document.getElementById('lanStatus'),
  shareInfo: document.getElementById('shareInfo'),
  remoteUrlInput: document.getElementById('remoteUrlInput'),
  remoteTokenInput: document.getElementById('remoteTokenInput'),
  discoveredDeviceSelect: document.getElementById('discoveredDeviceSelect'),
  discoverDevicesButton: document.getElementById('discoverDevicesButton'),
  discoverTargetInput: document.getElementById('discoverTargetInput'),
  discoveryStatus: document.getElementById('discoveryStatus'),
  connectRemoteButton: document.getElementById('connectRemoteButton'),
  disconnectRemoteButton: document.getElementById('disconnectRemoteButton')
};

const promptPresetDialog = document.getElementById('promptPresetDialog');
const promptPresetDialogForm = document.getElementById('promptPresetDialogForm');
const promptPresetNameInput = document.getElementById('promptPresetNameInput');
const promptPresetTextInput = document.getElementById('promptPresetTextInput');
const promptPresetDialogStatus = document.getElementById('promptPresetDialogStatus');
const promptPresetDialogTitle = document.getElementById('promptPresetDialogTitle');
const cancelPromptPresetButton = document.getElementById('cancelPromptPresetButton');

const groupLabels = {
  vision: { name: '视觉模型', hint: '用于读取截图并给出第一版回答。要求模型支持图片输入。' },
  chat: { name: '对话模型', hint: '用于针对已给出的回答继续多轮追问。默认只发送文本上下文，可勾选附带截图。' }
};

let currentScreenshots = [];
let selectedScreenshotIndex = -1;
let screenStream = null;
let monitorStarted = false;
let isGenerating = false;
let generatingKind = '';
let remoteConnected = false;
let remoteBaseUrl = '';
let remoteToken = '';
let remotePollTimer = null;
let remotePolling = false;
let appConfig = null;
let settingsConfig = null;
let settingsGroup = 'vision';
let editingPresetId = '';
const selectedPromptPresetIds = { vision: '', chat: '' };
let pendingPromptPresetGroup = '';
let promptPresetSaving = false;
let discoveredDevices = [];
let currentCloudPairInfo = null;
let thread = [];
let messageNodes = [];
let streamingIndex = -1;

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

function setLanStatus(text, isError = false) {
  elements.lanStatus.textContent = text;
  elements.lanStatus.style.color = isError ? '#d95e5e' : '';
}

function setDiscoveryStatus(text, isError = false) {
  elements.discoveryStatus.textContent = text;
  elements.discoveryStatus.classList.toggle('is-error', isError);
}

/* ---------- conversation thread ---------- */

function createMessageNode(message) {
  const wrap = document.createElement('div');
  wrap.className = `message message-${message.role}`;
  if (message.error) wrap.classList.add('is-error');
  if (message.streaming) wrap.classList.add('is-streaming');

  const head = document.createElement('div');
  head.className = 'message-head';
  const role = document.createElement('span');
  role.className = 'message-role';
  role.textContent = message.role === 'user' ? '我' : (message.model || '模型');
  const meta = document.createElement('span');
  meta.className = 'message-meta';
  meta.textContent = message.meta || '';
  head.append(role, meta);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = message.content ? renderMarkdown(message.content) : '';

  wrap.append(head, body);
  return wrap;
}

function updateMessageNode(index) {
  const node = messageNodes[index];
  const message = thread[index];
  if (!node || !message) return;

  node.classList.toggle('is-error', Boolean(message.error));
  node.classList.toggle('is-streaming', Boolean(message.streaming));
  const role = node.querySelector('.message-role');
  if (role) role.textContent = message.role === 'user' ? '我' : (message.model || '模型');
  const meta = node.querySelector('.message-meta');
  if (meta) meta.textContent = message.meta || '';
  const body = node.querySelector('.message-body');
  if (body) body.innerHTML = message.content ? renderMarkdown(message.content) : '';
}

function pushMessage(message) {
  thread.push(message);
  const node = createMessageNode(message);
  messageNodes[thread.length - 1] = node;
  elements.threadEmpty.style.display = 'none';
  elements.thread.appendChild(node);
  scrollThreadToBottom();
  return thread.length - 1;
}

function renderThread() {
  messageNodes = [];
  elements.thread.replaceChildren(elements.threadEmpty);
  elements.threadEmpty.style.display = thread.length ? 'none' : 'block';
  thread.forEach((message, index) => {
    const node = createMessageNode(message);
    messageNodes[index] = node;
    elements.thread.appendChild(node);
  });
  scrollThreadToBottom();
}

function scrollThreadToBottom() {
  elements.thread.scrollTop = elements.thread.scrollHeight;
}

function hasAnswer() {
  return thread.some((message) => message.role === 'assistant' && !message.error && message.content.trim());
}

function threadAsText() {
  return thread
    .filter((message) => message.content && message.content.trim())
    .map((message) => `${message.role === 'user' ? '我' : (message.model || '模型')}：${message.content}`)
    .join('\n\n');
}

function buildChatHistory() {
  return thread
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && !message.error && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content.trim() }));
}

function setGenerating(value, kind = '') {
  isGenerating = value;
  generatingKind = value ? kind : '';
  elements.addScreenshotButton.disabled = value;
  elements.analyzeScreenshotsButton.disabled = value || currentScreenshots.length === 0;
  elements.retryAnalyzeButton.disabled = value || currentScreenshots.length === 0;
  elements.clearButton.disabled = value || currentScreenshots.length === 0;
  elements.stopButton.disabled = !value;
  updateComposerState();
}

function updateComposerState() {
  const ready = hasAnswer() && !isGenerating;
  elements.chatInput.disabled = !ready;
  elements.sendChatButton.disabled = !ready;
  elements.attachImageInput.disabled = !ready || currentScreenshots.length === 0;
  if (!isGenerating) {
    elements.chatHint.textContent = hasAnswer()
      ? '追问由“对话模型”处理，会带上本轮对话上下文。'
      : '完成一次截图分析后即可开始追问，追问由“对话模型”处理。';
  }
}

function finishStreaming(index, details, prefix) {
  const message = thread[index];
  if (!message) return;
  message.streaming = false;
  message.model = (details && details.presetName) || message.model || prefix;
  const suffix = details && details.attempts > 1 ? ` · 已切换到 ${details.presetName}` : '';
  message.meta = `${prefix}${suffix}`;
  updateMessageNode(index);
  streamingIndex = -1;
  setGenerating(false);
  updateComposerState();
}

function failStreaming(index, message, prefix) {
  const target = thread[index];
  if (!target) return;
  target.streaming = false;
  target.error = true;
  target.model = prefix;
  target.meta = '请求失败';
  target.content = message;
  updateMessageNode(index);
  streamingIndex = -1;
  setGenerating(false);
  updateComposerState();
}

/* ---------- config & settings modal ---------- */

function normalizeConfig(config) {
  const build = (group, kind) => {
    const presets = Array.isArray(group && group.presets) ? group.presets.map((preset) => ({ ...preset })) : [];
    if (!presets.length) throw new Error(`${groupLabels[kind].name}预设尚未初始化`);
    const activePresetId = presets.some((preset) => preset.id === group.activePresetId)
      ? group.activePresetId
      : presets[0].id;
    return { activePresetId, presets };
  };
  return {
    version: 2,
    autoFallback: config.autoFallback !== false,
    systemPrompt: config.systemPrompt || '',
    chatSystemPrompt: config.chatSystemPrompt || '',
    vision: build(config.vision, 'vision'),
    chat: build(config.chat, 'chat'),
    promptPresets: {
      vision: Array.isArray(config.promptPresets && config.promptPresets.vision)
        ? config.promptPresets.vision.map((preset) => ({ ...preset }))
        : [],
      chat: Array.isArray(config.promptPresets && config.promptPresets.chat)
        ? config.promptPresets.chat.map((preset) => ({ ...preset }))
        : []
    }
  };
}

function cloneConfig(config) {
  return {
    version: 2,
    autoFallback: config.autoFallback !== false,
    systemPrompt: config.systemPrompt || '',
    chatSystemPrompt: config.chatSystemPrompt || '',
    vision: {
      activePresetId: config.vision.activePresetId,
      presets: config.vision.presets.map((preset) => ({ ...preset }))
    },
    chat: {
      activePresetId: config.chat.activePresetId,
      presets: config.chat.presets.map((preset) => ({ ...preset }))
    },
    promptPresets: {
      vision: config.promptPresets.vision.map((preset) => ({ ...preset })),
      chat: config.promptPresets.chat.map((preset) => ({ ...preset }))
    }
  };
}

function updateModelChips() {
  const describe = (group, label) => {
    const preset = group.presets.find((item) => item.id === group.activePresetId) || group.presets[0];
    if (!preset || !preset.model) return `${label}：未配置`;
    return `${label}：${preset.name} · ${preset.model}`;
  };
  elements.visionChip.textContent = describe(appConfig.vision, '视觉');
  elements.chatChip.textContent = describe(appConfig.chat, '对话');
  elements.visionChip.classList.toggle('is-missing', !appConfig.vision.presets.some((item) => item.id === appConfig.vision.activePresetId && item.model));
  elements.chatChip.classList.toggle('is-missing', !appConfig.chat.presets.some((item) => item.id === appConfig.chat.activePresetId && item.model));
}

function loadConfig(config) {
  appConfig = normalizeConfig(config);
  for (const group of ['vision', 'chat']) {
    if (!appConfig.promptPresets[group].some((preset) => preset.id === selectedPromptPresetIds[group])) {
      selectedPromptPresetIds[group] = '';
    }
    renderPromptPresetToolbar(group);
  }
  updateModelChips();
  updateComposerState();
}

function promptPresetElements(group) {
  return group === 'vision'
    ? {
        select: elements.visionPromptPresetSelect,
        add: elements.visionPromptPresetAddButton,
        update: elements.visionPromptPresetUpdateButton,
        remove: elements.visionPromptPresetDeleteButton,
        status: elements.visionPromptPresetStatus,
        input: elements.promptInput
      }
    : {
        select: elements.chatPromptPresetSelect,
        add: elements.chatPromptPresetAddButton,
        update: elements.chatPromptPresetUpdateButton,
        remove: elements.chatPromptPresetDeleteButton,
        status: elements.chatPromptPresetStatus,
        input: elements.chatInput
      };
}

function renderPromptPresetToolbar(group) {
  if (!appConfig) return;
  const controls = promptPresetElements(group);
  const presets = appConfig.promptPresets[group];
  const selectedId = presets.some((preset) => preset.id === selectedPromptPresetIds[group])
    ? selectedPromptPresetIds[group]
    : '';
  selectedPromptPresetIds[group] = selectedId;
  controls.select.innerHTML = '<option value="">选择预设</option>' + presets
    .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`)
    .join('');
  controls.select.value = selectedId;
  controls.select.disabled = promptPresetSaving;
  controls.add.disabled = promptPresetSaving;
  controls.update.disabled = promptPresetSaving || !selectedId;
  controls.remove.disabled = promptPresetSaving || !selectedId;
}

function selectPromptPreset(group, presetId) {
  const controls = promptPresetElements(group);
  const preset = appConfig.promptPresets[group].find((item) => item.id === presetId);
  selectedPromptPresetIds[group] = preset ? preset.id : '';
  if (preset) controls.input.value = preset.text;
  controls.status.textContent = preset ? `已载入「${preset.name}」` : '';
  renderPromptPresetToolbar(group);
}

function setPromptPresetSaving(saving, group) {
  promptPresetSaving = saving;
  for (const name of ['vision', 'chat']) renderPromptPresetToolbar(name);
  if (group) promptPresetElements(group).status.textContent = saving ? '正在保存…' : '';
}

async function persistPromptPresetList(group, presets, selectedId, successMessage) {
  if (!appConfig || promptPresetSaving) return false;
  const controls = promptPresetElements(group);
  const nextConfig = cloneConfig(appConfig);
  nextConfig.promptPresets[group] = presets;
  setPromptPresetSaving(true, group);
  try {
    const saved = await api.saveConfig(nextConfig);
    selectedPromptPresetIds[group] = selectedId;
    loadConfig(saved);
    controls.status.textContent = successMessage;
    return true;
  } catch (error) {
    controls.status.textContent = error.message || '保存失败';
    return false;
  } finally {
    setPromptPresetSaving(false);
  }
}

function openPromptPresetDialog(group) {
  pendingPromptPresetGroup = group;
  promptPresetDialogTitle.textContent = group === 'vision' ? '新增回答预设' : '新增追问预设';
  promptPresetNameInput.value = '';
  promptPresetTextInput.value = promptPresetElements(group).input.value;
  promptPresetDialogStatus.textContent = '';
  promptPresetDialog.showModal();
  promptPresetNameInput.focus();
}

async function createPromptPreset(event) {
  event.preventDefault();
  if (!pendingPromptPresetGroup || promptPresetSaving) return;
  const group = pendingPromptPresetGroup;
  const controls = promptPresetElements(group);
  const name = promptPresetNameInput.value.trim();
  const text = promptPresetTextInput.value;
  if (!name) {
    promptPresetDialogStatus.textContent = '请填写预设名称。';
    promptPresetNameInput.focus();
    return;
  }
  if (!text.trim()) {
    promptPresetDialogStatus.textContent = '请先填写提示词内容，再保存预设。';
    return;
  }

  const preset = { id: createPresetId(), name, text };
  const presets = [...appConfig.promptPresets[group], preset];
  const saved = await persistPromptPresetList(group, presets, preset.id, `已新增「${name}」`);
  if (saved) {
    controls.input.value = text;
    promptPresetDialog.close();
    pendingPromptPresetGroup = '';
  } else {
    promptPresetDialogStatus.textContent = promptPresetElements(group).status.textContent;
  }
}

async function updatePromptPreset(group) {
  const presetId = selectedPromptPresetIds[group];
  const existing = appConfig.promptPresets[group].find((preset) => preset.id === presetId);
  if (!existing) return;
  const controls = promptPresetElements(group);
  const presets = appConfig.promptPresets[group].map((preset) => (
    preset.id === presetId ? { ...preset, text: controls.input.value } : { ...preset }
  ));
  await persistPromptPresetList(group, presets, presetId, `已更新「${existing.name}」`);
}

async function deletePromptPreset(group) {
  const presetId = selectedPromptPresetIds[group];
  const existing = appConfig.promptPresets[group].find((preset) => preset.id === presetId);
  if (!existing || !window.confirm(`删除提示词预设「${existing.name}」？`)) return;
  const presets = appConfig.promptPresets[group]
    .filter((preset) => preset.id !== presetId)
    .map((preset) => ({ ...preset }));
  await persistPromptPresetList(group, presets, '', `已删除「${existing.name}」`);
}

function settingsGroupData() {
  return settingsConfig[settingsGroup];
}

function editingPreset() {
  return settingsGroupData().presets.find((preset) => preset.id === editingPresetId);
}

function commitPresetForm() {
  const preset = editingPreset();
  if (!preset) return;
  const priority = Number.parseInt(elements.stPriorityInput.value, 10);
  Object.assign(preset, {
    name: elements.stPresetNameInput.value.trim() || '未命名预设',
    priority: Number.isFinite(priority) && priority > 0 ? priority : 1,
    enabled: elements.stPresetEnabledInput.checked,
    baseUrl: elements.stBaseUrlInput.value.trim(),
    apiBackend: elements.stApiBackendInput.value,
    model: elements.stModelInput.value.trim(),
    apiKey: elements.stApiKeyInput.value.trim(),
    proxyUrl: elements.stProxyUrlInput.value.trim()
  });
}

function renderPresetOptions() {
  const group = settingsGroupData();
  elements.stPresetSelect.innerHTML = group.presets
    .map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} · P${preset.priority}</option>`)
    .join('');
  elements.stPresetSelect.value = editingPresetId || group.activePresetId;
  elements.stDeletePresetButton.disabled = group.presets.length <= 1;
}

function renderPresetForm(presetId) {
  const group = settingsGroupData();
  const preset = group.presets.find((item) => item.id === presetId) || group.presets[0];
  editingPresetId = preset.id;
  elements.stPresetSelect.value = preset.id;
  elements.stPresetNameInput.value = preset.name || '';
  elements.stPrimaryPresetInput.checked = group.activePresetId === preset.id;
  elements.stPriorityInput.value = preset.priority || 1;
  elements.stPresetEnabledInput.checked = preset.enabled !== false;
  elements.stBaseUrlInput.value = preset.baseUrl || '';
  elements.stApiBackendInput.value = preset.apiBackend || 'responses';
  elements.stModelInput.value = preset.model || '';
  elements.stApiKeyInput.value = preset.apiKey || '';
  elements.stProxyUrlInput.value = preset.proxyUrl || '';
}

function renderSettings() {
  const isVision = settingsGroup === 'vision';
  for (const button of elements.settingsTabs.querySelectorAll('.tab-button')) {
    button.classList.toggle('is-active', button.dataset.group === settingsGroup);
  }
  elements.tabHint.textContent = groupLabels[settingsGroup].hint;
  elements.stPrimaryPresetLabel.textContent = `设为${isVision ? '视觉' : '对话'}模型主用预设`;
  elements.stVisionPromptField.hidden = !isVision;
  elements.stChatPromptField.hidden = isVision;
  elements.stAutoFallbackInput.checked = settingsConfig.autoFallback !== false;
  elements.stSystemPromptInput.value = settingsConfig.systemPrompt || '';
  elements.stChatSystemPromptInput.value = settingsConfig.chatSystemPrompt || '';

  const group = settingsGroupData();
  const selectedId = group.presets.some((preset) => preset.id === editingPresetId)
    ? editingPresetId
    : group.activePresetId;
  renderPresetOptions();
  renderPresetForm(selectedId);
}

function openSettings() {
  if (!appConfig) return;
  settingsConfig = cloneConfig(appConfig);
  settingsGroup = 'vision';
  editingPresetId = '';
  elements.saveStatus.textContent = '本地保存';
  renderSettings();
  elements.settingsModal.hidden = false;
}

function closeSettings() {
  elements.settingsModal.hidden = true;
  settingsConfig = null;
}

function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function addPreset() {
  commitPresetForm();
  const group = settingsGroupData();
  const current = editingPreset();
  const nextPriority = Math.max(...group.presets.map((preset) => preset.priority || 0)) + 1;
  const preset = {
    id: createPresetId(),
    name: `${groupLabels[settingsGroup].name} ${group.presets.length + 1}`,
    baseUrl: current ? current.baseUrl : '',
    model: '',
    apiBackend: current ? current.apiBackend : 'responses',
    apiKey: current ? current.apiKey : '',
    proxyUrl: current ? current.proxyUrl : '',
    enabled: true,
    priority: nextPriority
  };
  group.presets.push(preset);
  renderPresetOptions();
  renderPresetForm(preset.id);
  elements.stPresetNameInput.focus();
  elements.stPresetNameInput.select();
}

function deletePreset() {
  const group = settingsGroupData();
  if (group.presets.length <= 1) return;
  const index = group.presets.findIndex((preset) => preset.id === editingPresetId);
  const wasPrimary = group.activePresetId === editingPresetId;
  group.presets.splice(index, 1);
  const nextPreset = group.presets[Math.min(index, group.presets.length - 1)];
  if (wasPrimary) group.activePresetId = nextPreset.id;
  renderPresetOptions();
  renderPresetForm(nextPreset.id);
}

async function saveSettings() {
  if (!settingsConfig) return;
  commitPresetForm();
  settingsConfig.autoFallback = elements.stAutoFallbackInput.checked;
  settingsConfig.systemPrompt = elements.stSystemPromptInput.value.trim();
  settingsConfig.chatSystemPrompt = elements.stChatSystemPromptInput.value.trim();

  elements.saveButton.disabled = true;
  try {
    const saved = await api.saveConfig(settingsConfig);
    loadConfig(saved);
    closeSettings();
    setCaptureStatus('模型设置已保存');
  } catch (error) {
    elements.saveStatus.textContent = error.message || '保存失败';
  } finally {
    elements.saveButton.disabled = false;
  }
}

/* ---------- capture ---------- */

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

function renderScreenshotBatch() {
  const hasScreenshots = currentScreenshots.length > 0;
  if (!hasScreenshots) {
    selectedScreenshotIndex = -1;
    elements.screenPreview.removeAttribute('src');
    elements.previewWrap.classList.remove('has-image');
  } else {
    selectedScreenshotIndex = Math.min(Math.max(selectedScreenshotIndex, 0), currentScreenshots.length - 1);
    elements.screenPreview.src = currentScreenshots[selectedScreenshotIndex];
    elements.screenPreview.alt = `第 ${selectedScreenshotIndex + 1} 张屏幕截图预览`;
    elements.previewWrap.classList.add('has-image');
  }

  elements.screenshotGallery.replaceChildren();
  elements.screenshotGallery.hidden = !hasScreenshots;
  currentScreenshots.forEach((dataUrl, index) => {
    const item = document.createElement('div');
    item.className = 'screenshot-item';

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = `screenshot-select${index === selectedScreenshotIndex ? ' is-active' : ''}`;
    selectButton.dataset.selectIndex = String(index);
    selectButton.setAttribute('aria-label', `预览第 ${index + 1} 张截图`);
    selectButton.setAttribute('aria-pressed', String(index === selectedScreenshotIndex));
    const thumbnail = document.createElement('img');
    thumbnail.src = dataUrl;
    thumbnail.alt = '';
    selectButton.append(thumbnail);

    const number = document.createElement('span');
    number.className = 'screenshot-number';
    number.textContent = String(index + 1);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'screenshot-remove';
    removeButton.dataset.removeIndex = String(index);
    removeButton.setAttribute('aria-label', `删除第 ${index + 1} 张截图`);
    removeButton.textContent = '×';

    item.append(selectButton, number, removeButton);
    elements.screenshotGallery.append(item);
  });

  elements.analyzeScreenshotsButton.textContent = hasScreenshots
    ? `分析 ${currentScreenshots.length} 张截图`
    : '分析截图';
  elements.analyzeScreenshotsButton.disabled = isGenerating || !hasScreenshots;
  elements.retryAnalyzeButton.disabled = isGenerating || !hasScreenshots;
  elements.clearButton.disabled = isGenerating || !hasScreenshots;
  updateComposerState();
}

function addScreenshot(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('截图数据无效');
  }
  currentScreenshots.push(dataUrl);
  selectedScreenshotIndex = currentScreenshots.length - 1;
  renderScreenshotBatch();
  setCaptureStatus(`已添加 ${currentScreenshots.length} 张截图，可统一分析`);
}

function removeScreenshot(index) {
  if (!Number.isInteger(index) || index < 0 || index >= currentScreenshots.length) return;
  currentScreenshots.splice(index, 1);
  if (index < selectedScreenshotIndex) selectedScreenshotIndex -= 1;
  else if (index === selectedScreenshotIndex) selectedScreenshotIndex = Math.min(index, currentScreenshots.length - 1);
  renderScreenshotBatch();
  setCaptureStatus(currentScreenshots.length
    ? `已移除截图，剩余 ${currentScreenshots.length} 张`
    : '截图已清空');
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
    setCaptureStatus('屏幕监听中，可连续添加截图后分析');
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
  let response;
  try {
    response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? '连接超时' : (error.message || '网络不可达');
    throw new Error(
      `无法连接共享端 ${remoteBaseUrl}（${reason}）。请确认共享端仍在运行、地址属于同一网段，并允许防火墙通过 TCP 8765；跨网段时还需要校园网未拦截该端口。`
    );
  }
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = String(parsed.error || body);
    } catch {}
    if (response.status === 401) throw new Error('配对码错误，请核对共享端显示的配对码。');
    throw new Error(`共享端返回 HTTP ${response.status}：${message.slice(0, 160) || '未提供错误详情'}`);
  }
  return blobToDataUrl(await response.blob());
}

async function pollRemotePreview() {
  if (!remoteConnected || remotePolling) return;
  remotePolling = true;
  try {
    const dataUrl = await fetchRemoteFrameData();
    if (currentScreenshots.length === 0) {
      elements.screenPreview.src = dataUrl;
      elements.previewWrap.classList.add('has-image');
    }
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
    const discoveryMessage = info.discoveryAvailable
      ? ''
      : '\n局域网设备搜索暂不可用，请在另一台设备手动填写地址。';
    const networkMessage = info.networks && info.networks.length
      ? `\n本机网段：${info.networks.join('、')}`
      : '';
    elements.shareInfo.textContent = `共享地址：\n${urls}${networkMessage}\n配对码：${info.token}${discoveryMessage}`;
    elements.minimizeShareButton.disabled = false;
    setLanStatus(info.discoveryAvailable ? '共享端运行中' : '共享端运行中，设备搜索不可用', !info.discoveryAvailable);
  } catch (error) {
    setLanStatus(error.message || '共享端启动失败', true);
  }
}

async function searchLanDevices() {
  const target = (elements.discoverTargetInput.value || '').trim();
  elements.discoverDevicesButton.disabled = true;
  elements.discoveredDeviceSelect.disabled = true;
  setDiscoveryStatus(target ? `正在搜索 ${target}…` : '正在搜索局域网共享设备…');
  try {
    discoveredDevices = await api.discoverLanShares(target ? { targets: [target] } : {});
    elements.discoveredDeviceSelect.replaceChildren(new Option('发现的共享设备', ''));
    for (const device of discoveredDevices) {
      elements.discoveredDeviceSelect.add(new Option(`${device.name} · ${device.address}`, device.id));
    }
    if (discoveredDevices.length) {
      setDiscoveryStatus(`发现 ${discoveredDevices.length} 台共享设备`);
      return;
    }
    const networks = await api.getLanNetworks().catch(() => []);
    const networkText = networks.length ? `本机网段：${networks.map((item) => item.cidr).join('、')}。` : '';
    setDiscoveryStatus(
      `未发现设备。${networkText}校园网常把有线与无线分到不同网段或开启无线隔离，广播可能到不了对端；请让两台设备处于同一网段，或直接在“远程设备地址”填写 http://共享端IP:8765。`,
      true
    );
  } catch (error) {
    discoveredDevices = [];
    elements.discoveredDeviceSelect.replaceChildren(new Option('发现的共享设备', ''));
    setDiscoveryStatus(error.message || '局域网设备搜索失败', true);
  } finally {
    elements.discoverDevicesButton.disabled = false;
    elements.discoveredDeviceSelect.disabled = false;
  }
}

function selectDiscoveredDevice() {
  const device = discoveredDevices.find((item) => item.id === elements.discoveredDeviceSelect.value);
  if (!device) return;
  elements.remoteUrlInput.value = device.url;
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

/* ---------- analysis & follow-up ---------- */

async function analyzeScreenshots(screenshots = currentScreenshots) {
  if (!Array.isArray(screenshots) || screenshots.length === 0
      || screenshots.some((screenshot) => typeof screenshot !== 'string' || !screenshot.startsWith('data:image/'))) {
    throw new Error('没有有效截图，请重新添加后重试');
  }
  const prompt = elements.promptInput.value.trim() || '请分析这些截图并给出回答。';
  const imageDataUrls = await Promise.all(screenshots.map(compressImage));

  thread = [];
  renderThread();
  pushMessage({ role: 'user', content: prompt, meta: `截图提问 · ${screenshots.length} 张` });
  streamingIndex = pushMessage({
    role: 'assistant',
    content: '',
    model: '视觉模型',
    meta: '等待响应…',
    streaming: true
  });

  setGenerating(true, 'vision');
  setCaptureStatus('正在分析…');
  await api.analyzeImage({
    imageDataUrls,
    prompt,
    presetId: appConfig.vision.activePresetId
  });
}

async function startCloudShare() {
  elements.startCloudShareButton.disabled = true;
  try {
    currentCloudPairInfo = await api.startCloudShare();
    elements.cloudShareInfo.textContent =
      `查看页面：${currentCloudPairInfo.viewerUrl}\n配对码：${currentCloudPairInfo.code}\n首次连接截止：${new Date(currentCloudPairInfo.expiresAt).toLocaleString()}`;
    elements.copyCloudCodeButton.disabled = false;
    elements.stopCloudShareButton.disabled = false;
    elements.cloudPairStatus.textContent = '配对码已生成，正在连接…';
  } catch (error) {
    elements.cloudPairStatus.textContent = error.message || '创建配对码失败';
    elements.cloudPairStatus.classList.add('is-error');
    elements.startCloudShareButton.disabled = false;
  }
}

async function stopCloudShare() {
  await api.stopCloudShare();
  currentCloudPairInfo = null;
  elements.cloudShareInfo.textContent = '点击“创建配对码”，再在查看设备的浏览器中打开页面并输入配对码。';
  elements.startCloudShareButton.disabled = false;
  elements.copyCloudCodeButton.disabled = true;
  elements.stopCloudShareButton.disabled = true;
}

async function copyCloudPairInfo() {
  if (!currentCloudPairInfo) return;
  await api.copyText(`查看页面：${currentCloudPairInfo.viewerUrl}\n配对码：${currentCloudPairInfo.code}`);
  elements.cloudPairStatus.textContent = '配对信息已复制';
}

api.onCloudShareStatus((status) => {
  if (!status || !elements.cloudPairStatus) return;
  elements.cloudPairStatus.textContent = status.message || status.state;
  elements.cloudPairStatus.classList.toggle('is-error', status.state === 'error' || status.state === 'expired' || status.state === 'disconnected');
  if (status.state === 'expired') {
    currentCloudPairInfo = null;
    elements.cloudShareInfo.textContent = '配对码已失效。点击“创建配对码”开始新的共享。';
    elements.startCloudShareButton.disabled = false;
    elements.copyCloudCodeButton.disabled = true;
    elements.stopCloudShareButton.disabled = true;
  } else if (status.state === 'paired') {
    if (currentCloudPairInfo) {
      elements.cloudShareInfo.textContent = `查看页面：${currentCloudPairInfo.viewerUrl}\n首次配对已完成，心跳保活中；浏览器/采集端或网络断开后旧码失效。`;
    }
    elements.copyCloudCodeButton.disabled = true;
  } else if (status.state === 'disconnected') {
    currentCloudPairInfo = null;
    elements.cloudShareInfo.textContent = '连接已结束，旧配对码已失效。点击“创建配对码”开始新的共享。';
    elements.startCloudShareButton.disabled = false;
    elements.copyCloudCodeButton.disabled = true;
    elements.stopCloudShareButton.disabled = true;
  } else if (status.state === 'stopped') {
    currentCloudPairInfo = null;
    elements.startCloudShareButton.disabled = false;
    elements.copyCloudCodeButton.disabled = true;
    elements.stopCloudShareButton.disabled = true;
  }
});

async function captureScreenshot() {
  if (isGenerating) return;

  try {
    setCaptureStatus('正在截取当前屏幕…');
    const screenshot = await captureCurrentScreen();
    addScreenshot(screenshot);
  } catch (error) {
    setCaptureStatus(`添加截图失败：${error.message || error}`, true);
    if (remoteConnected) setLanStatus(error.message || '远程屏幕连接失败', true);
  }
}

async function analyzeScreenshotBatch() {
  if (isGenerating || currentScreenshots.length === 0) return;

  try {
    await analyzeScreenshots();
  } catch (error) {
    setGenerating(false);
    setCaptureStatus('分析失败', true);
    failStreaming(streamingIndex, `分析失败：\n${error.message || error}`, '视觉模型');
    streamingIndex = -1;
  }
}

async function retryScreenshotBatch() {
  if (isGenerating || currentScreenshots.length === 0) return;
  try {
    await analyzeScreenshots();
  } catch (error) {
    setGenerating(false);
    setCaptureStatus('分析失败', true);
    failStreaming(streamingIndex, `分析失败：\n${error.message || error}`, '视觉模型');
    streamingIndex = -1;
  }
}

async function sendFollowUp() {
  const text = elements.chatInput.value.trim();
  if (!text || isGenerating || !appConfig) return;
  if (!hasAnswer()) {
    setCaptureStatus('请先完成一次截图分析', true);
    return;
  }

  elements.chatInput.value = '';
  selectedPromptPresetIds.chat = '';
  renderPromptPresetToolbar('chat');
  pushMessage({ role: 'user', content: text, meta: '追问' });
  const history = buildChatHistory();

  streamingIndex = pushMessage({
    role: 'assistant',
    content: '',
    model: '对话模型',
    meta: '等待响应…',
    streaming: true
  });

  setGenerating(true, 'chat');
  setCaptureStatus('正在生成追问回答…');
  elements.chatHint.textContent = '正在生成回答…';
  scrollThreadToBottom();

  const attachImages = elements.attachImageInput.checked && currentScreenshots.length > 0;
  await api.chatFollowUp({
    history,
    imageDataUrls: attachImages ? await Promise.all(currentScreenshots.map(compressImage)) : [],
    presetId: appConfig.chat.activePresetId
  });
}

function clearAll() {
  if (isGenerating) return;
  currentScreenshots = [];
  selectedScreenshotIndex = -1;
  renderScreenshotBatch();
  setCaptureStatus(remoteConnected ? '远程屏幕连接中' : (monitorStarted ? '屏幕监听中，可添加截图' : '等待截图'));
}

function clearThread() {
  if (isGenerating) return;
  thread = [];
  renderThread();
  updateComposerState();
}

/* ---------- events ---------- */

elements.addScreenshotButton.addEventListener('click', captureScreenshot);
elements.analyzeScreenshotsButton.addEventListener('click', analyzeScreenshotBatch);
elements.retryAnalyzeButton.addEventListener('click', retryScreenshotBatch);
elements.clearButton.addEventListener('click', clearAll);
elements.screenshotGallery.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-index]');
  if (removeButton) {
    removeScreenshot(Number(removeButton.dataset.removeIndex));
    return;
  }

  const selectButton = event.target.closest('[data-select-index]');
  if (!selectButton) return;
  selectedScreenshotIndex = Number(selectButton.dataset.selectIndex);
  renderScreenshotBatch();
});
elements.clearChatButton.addEventListener('click', clearThread);
elements.startShareButton.addEventListener('click', startShare);
elements.startCloudShareButton.addEventListener('click', startCloudShare);
elements.copyCloudCodeButton.addEventListener('click', copyCloudPairInfo);
elements.stopCloudShareButton.addEventListener('click', stopCloudShare);
elements.minimizeShareButton.addEventListener('click', minimizeShare);
elements.connectRemoteButton.addEventListener('click', connectRemote);
elements.disconnectRemoteButton.addEventListener('click', disconnectRemote);
elements.discoverDevicesButton.addEventListener('click', searchLanDevices);
elements.discoveredDeviceSelect.addEventListener('change', selectDiscoveredDevice);
elements.stopButton.addEventListener('click', async () => {
  await api.stopAnalysis();
});
elements.sendChatButton.addEventListener('click', sendFollowUp);
elements.chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendFollowUp();
  }
});
elements.visionPromptPresetSelect.addEventListener('change', (event) => selectPromptPreset('vision', event.target.value));
elements.chatPromptPresetSelect.addEventListener('change', (event) => selectPromptPreset('chat', event.target.value));
elements.visionPromptPresetAddButton.addEventListener('click', () => openPromptPresetDialog('vision'));
elements.chatPromptPresetAddButton.addEventListener('click', () => openPromptPresetDialog('chat'));
elements.visionPromptPresetUpdateButton.addEventListener('click', () => updatePromptPreset('vision'));
elements.chatPromptPresetUpdateButton.addEventListener('click', () => updatePromptPreset('chat'));
elements.visionPromptPresetDeleteButton.addEventListener('click', () => deletePromptPreset('vision'));
elements.chatPromptPresetDeleteButton.addEventListener('click', () => deletePromptPreset('chat'));
promptPresetDialogForm.addEventListener('submit', createPromptPreset);
cancelPromptPresetButton.addEventListener('click', () => promptPresetDialog.close());
promptPresetDialog.addEventListener('close', () => { pendingPromptPresetGroup = ''; });

elements.settingsButton.addEventListener('click', openSettings);
elements.closeSettingsButton.addEventListener('click', closeSettings);
elements.cancelSettingsButton.addEventListener('click', closeSettings);
elements.settingsModal.addEventListener('mousedown', (event) => {
  if (event.target === elements.settingsModal) closeSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.settingsModal.hidden) closeSettings();
});
elements.settingsTabs.addEventListener('click', (event) => {
  const button = event.target.closest('.tab-button');
  if (!button || button.dataset.group === settingsGroup) return;
  commitPresetForm();
  settingsGroup = button.dataset.group;
  editingPresetId = '';
  renderSettings();
});
elements.stAddPresetButton.addEventListener('click', addPreset);
elements.stDeletePresetButton.addEventListener('click', deletePreset);
elements.stPresetSelect.addEventListener('change', (event) => {
  commitPresetForm();
  renderPresetForm(event.target.value);
});
elements.stPrimaryPresetInput.addEventListener('change', () => {
  if (!elements.stPrimaryPresetInput.checked) return;
  settingsGroupData().activePresetId = editingPresetId;
  elements.saveStatus.textContent = '未保存';
});
elements.saveButton.addEventListener('click', saveSettings);
elements.copyButton.addEventListener('click', async () => {
  const text = threadAsText().trim();
  if (!text) return;
  await api.copyText(text);
  elements.copyButton.textContent = '已复制';
  setTimeout(() => { elements.copyButton.textContent = '复制'; }, 1200);
});

api.onCaptureError((message) => setCaptureStatus(message, true));

api.onAnalysisAttempt((details) => {
  const message = thread[streamingIndex];
  if (!message) return;
  message.model = details.presetName;
  message.meta = `视觉模型 · ${details.attempt}/${details.total}`;
  updateMessageNode(streamingIndex);
  setCaptureStatus(`正在使用 ${details.presetName}（${details.attempt}/${details.total}）…`);
});
api.onAnalysisFallback((details) => {
  setCaptureStatus(`${details.failedPresetName} 请求失败，正在切换到 ${details.nextPresetName}…`, true);
});
api.onAnalysisChunk((chunk) => {
  const message = thread[streamingIndex];
  if (!message) return;
  message.content += chunk;
  updateMessageNode(streamingIndex);
  scrollThreadToBottom();
});
api.onAnalysisComplete((details) => {
  finishStreaming(streamingIndex, details, '视觉模型');
  const suffix = details && details.attempts > 1 ? `，已切换到 ${details.presetName}` : '';
  setCaptureStatus(`分析完成${suffix}，可继续追问或再次截图`);
});
api.onAnalysisStopped(() => {
  const message = thread[streamingIndex];
  if (message) {
    message.streaming = false;
    message.meta = message.content ? '已停止生成' : '已取消';
    updateMessageNode(streamingIndex);
  }
  streamingIndex = -1;
  setGenerating(false);
  setCaptureStatus('已停止生成');
});
api.onAnalysisError((message) => {
  const detail = String(message || '未知错误');
  setCaptureStatus(detail.startsWith('无法连接模型服务') ? '无法连接视觉模型服务' : '模型请求失败', true);
  failStreaming(streamingIndex, `分析失败：\n${detail}`, '视觉模型');
  streamingIndex = -1;
});

api.onChatAttempt((details) => {
  const message = thread[streamingIndex];
  if (!message) return;
  message.model = details.presetName;
  message.meta = `对话模型 · ${details.attempt}/${details.total}`;
  updateMessageNode(streamingIndex);
  setCaptureStatus(`正在使用 ${details.presetName}（${details.attempt}/${details.total}）…`);
});
api.onChatFallback((details) => {
  setCaptureStatus(`${details.failedPresetName} 请求失败，正在切换到 ${details.nextPresetName}…`, true);
});
api.onChatChunk((chunk) => {
  const message = thread[streamingIndex];
  if (!message) return;
  message.content += chunk;
  updateMessageNode(streamingIndex);
  scrollThreadToBottom();
});
api.onChatComplete((details) => {
  finishStreaming(streamingIndex, details, '对话模型');
  const suffix = details && details.attempts > 1 ? `，已切换到 ${details.presetName}` : '';
  setCaptureStatus(`追问完成${suffix}，可继续追问`);
});
api.onChatStopped(() => {
  const message = thread[streamingIndex];
  if (message) {
    message.streaming = false;
    message.meta = message.content ? '已停止生成' : '已取消';
    updateMessageNode(streamingIndex);
  }
  streamingIndex = -1;
  setGenerating(false);
  setCaptureStatus('已停止生成');
});
api.onChatError((message) => {
  const detail = String(message || '未知错误');
  setCaptureStatus(detail.startsWith('无法连接模型服务') ? '无法连接对话模型服务' : '模型请求失败', true);
  failStreaming(streamingIndex, `追问失败：\n${detail}`, '对话模型');
  streamingIndex = -1;
});

api.getConfig()
  .then(loadConfig)
  .catch(() => setCaptureStatus('配置读取失败', true));
startScreenMonitor();

window.addEventListener('beforeunload', () => {
  stopRemotePolling();
  stopScreenMonitor();
});
