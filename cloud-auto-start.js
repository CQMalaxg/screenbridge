'use strict';

const HIDDEN_START_ARGS = ['--hidden'];

function getCloudAutoStart(app, platform = process.platform) {
  if (platform === 'darwin') {
    return {
      supported: true,
      enabled: Boolean(app.getLoginItemSettings().openAtLogin)
    };
  }
  if (platform !== 'win32') return { supported: false, enabled: false };
  return {
    supported: true,
    enabled: Boolean(app.getLoginItemSettings({ args: [...HIDDEN_START_ARGS] }).openAtLogin)
  };
}

function setCloudAutoStart(app, enabled, platform = process.platform) {
  if (platform === 'darwin') {
    const openAtLogin = Boolean(enabled);
    app.setLoginItemSettings({ openAtLogin, openAsHidden: openAtLogin });
    return Boolean(app.getLoginItemSettings().openAtLogin);
  }
  if (platform !== 'win32') throw new Error('登录启动目前仅支持 Windows 和 macOS。');
  const openAtLogin = Boolean(enabled);
  const args = openAtLogin ? [...HIDDEN_START_ARGS] : [];
  app.setLoginItemSettings({ openAtLogin, args });
  return Boolean(app.getLoginItemSettings({ args }).openAtLogin);
}

function shouldStartHidden(app, argv = process.argv, platform = process.platform) {
  if (argv.includes('--hidden')) return true;
  if (platform !== 'darwin') return false;
  const loginSettings = app.getLoginItemSettings();
  return Boolean(loginSettings.wasOpenedAtLogin || loginSettings.wasOpenedAsHidden);
}

module.exports = { getCloudAutoStart, setCloudAutoStart, shouldStartHidden };
