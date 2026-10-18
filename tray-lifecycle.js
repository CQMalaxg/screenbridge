'use strict';

function createTrayLifecycle({ app, Tray, Menu, getWindow, iconPath, canQuit = () => true }) {
  let appIsQuitting = false;
  const tray = new Tray(iconPath);

  function showWindow() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return true;
  }

  const menu = Menu.buildFromTemplate([
    { label: '显示屏桥', click: showWindow },
    { type: 'separator' },
    { label: '退出屏桥', click: () => app.quit() }
  ]);

  tray.setToolTip('屏桥 ScreenBridge');
  tray.setContextMenu(menu);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);

  app.on('before-quit', () => {
    if (!canQuit()) return;
    appIsQuitting = true;
    tray.destroy();
  });

  function attachWindow(window) {
    window.on('close', (event) => {
      if (appIsQuitting) return;
      event.preventDefault();
      window.hide();
    });
  }

  return { attachWindow, showWindow, tray };
}

module.exports = { createTrayLifecycle };
