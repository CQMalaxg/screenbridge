const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assistantAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getScreenSource: () => ipcRenderer.invoke('get-screen-source'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  startLanShare: () => ipcRenderer.invoke('start-lan-share'),
  stopLanShare: () => ipcRenderer.invoke('stop-lan-share'),
  discoverLanShares: () => ipcRenderer.invoke('discover-lan-shares'),
  minimizeLanShare: () => ipcRenderer.invoke('minimize-lan-share'),
  analyzeImage: (payload) => ipcRenderer.invoke('analyze-image', payload),
  stopAnalysis: () => ipcRenderer.invoke('stop-analysis'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  onScreenCaptured: (callback) => ipcRenderer.on('screen-captured', (_event, dataUrl) => callback(dataUrl)),
  onCaptureError: (callback) => ipcRenderer.on('capture-error', (_event, message) => callback(message)),
  onAnalysisAttempt: (callback) => ipcRenderer.on('analysis-attempt', (_event, details) => callback(details)),
  onAnalysisFallback: (callback) => ipcRenderer.on('analysis-fallback', (_event, details) => callback(details)),
  onAnalysisChunk: (callback) => ipcRenderer.on('analysis-chunk', (_event, chunk) => callback(chunk)),
  onAnalysisComplete: (callback) => ipcRenderer.on('analysis-complete', (_event, details) => callback(details)),
  onAnalysisStopped: (callback) => ipcRenderer.on('analysis-stopped', () => callback()),
  onAnalysisError: (callback) => ipcRenderer.on('analysis-error', (_event, message) => callback(message))
});
