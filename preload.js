const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assistantAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getScreenSource: () => ipcRenderer.invoke('get-screen-source'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  startLanShare: () => ipcRenderer.invoke('start-lan-share'),
  stopLanShare: () => ipcRenderer.invoke('stop-lan-share'),
  minimizeLanShare: () => ipcRenderer.invoke('minimize-lan-share'),
  analyzeImage: (payload) => ipcRenderer.invoke('analyze-image', payload),
  stopAnalysis: () => ipcRenderer.invoke('stop-analysis'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  onScreenCaptured: (callback) => ipcRenderer.on('screen-captured', (_event, dataUrl) => callback(dataUrl)),
  onCaptureError: (callback) => ipcRenderer.on('capture-error', (_event, message) => callback(message)),
  onAnalysisChunk: (callback) => ipcRenderer.on('analysis-chunk', (_event, chunk) => callback(chunk)),
  onAnalysisComplete: (callback) => ipcRenderer.on('analysis-complete', () => callback()),
  onAnalysisStopped: (callback) => ipcRenderer.on('analysis-stopped', () => callback()),
  onAnalysisError: (callback) => ipcRenderer.on('analysis-error', (_event, message) => callback(message))
});
