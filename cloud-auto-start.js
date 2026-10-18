'use strict';

const HIDDEN_START_ARGS = ['--hidden'];

function getCloudAutoStart(app, platform = process.platform) {
  if (platform !== 'win32') return { supported: false, enabled: false };
  return {
    supported: true,
    enabled: Boolean(app.getLoginItemSettings({ args: [...HIDDEN_START_ARGS] }).openAtLogin)
  };
}

function setCloudAutoStart(app, enabled, platform = process.platform) {
  if (platform !== 'win32') throw new Error('登录启动目前仅支持 Windows。');
  const openAtLogin = Boolean(enabled);
  const args = openAtLogin ? [...HIDDEN_START_ARGS] : [];
  app.setLoginItemSettings({ openAtLogin, args });
  return Boolean(app.getLoginItemSettings({ args }).openAtLogin);
}

module.exports = { getCloudAutoStart, setCloudAutoStart };
