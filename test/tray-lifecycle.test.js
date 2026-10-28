'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { createTrayLifecycle, getTrayIconPath } = require('../tray-lifecycle');

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.visible = true;
    this.minimized = false;
    this.destroyed = false;
    this.calls = [];
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  restore() { this.minimized = false; this.calls.push('restore'); }
  show() { this.visible = true; this.calls.push('show'); }
  hide() { this.visible = false; this.calls.push('hide'); }
  focus() { this.calls.push('focus'); }
}

class FakeTray extends EventEmitter {
  setToolTip(value) { this.toolTip = value; }
  setContextMenu(menu) { this.menu = menu; }
  destroy() { this.destroyed = true; }
}

function makeLifecycle(canQuit) {
  const app = new EventEmitter();
  app.quit = () => app.emit('before-quit');
  const window = new FakeWindow();
  let tray;
  const Menu = {
    buildFromTemplate(items) { return items; }
  };
  const lifecycle = createTrayLifecycle({
    app,
    Tray: class extends FakeTray {
      constructor(iconPath) {
        super();
        this.iconPath = iconPath;
        tray = this;
      }
    },
    Menu,
    getWindow: () => window,
    canQuit,
    iconPath: 'assets/icon.ico'
  });
  lifecycle.attachWindow(window);
  return { app, lifecycle, tray, window };
}

test('closing the window hides it while tray clicks restore it', () => {
  const { tray, window } = makeLifecycle();
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(window.visible, false);
  assert.deepEqual(window.calls, ['hide']);

  window.minimized = true;
  tray.emit('click');
  assert.equal(window.visible, true);
  assert.equal(window.minimized, false);
  assert.deepEqual(window.calls.slice(1), ['restore', 'show', 'focus']);

  assert.equal(tray.toolTip, '屏桥 ScreenBridge');
  assert.equal(tray.menu[0].label, '显示屏桥');
  assert.equal(tray.menu[2].label, '退出屏桥');
});

test('the menu bar uses a macOS image while Windows keeps its ICO tray icon', () => {
  const path = require('node:path');
  const assetsDirectory = path.join('app', 'assets');

  assert.equal(typeof getTrayIconPath, 'function');
  assert.equal(getTrayIconPath(assetsDirectory, 'darwin'), path.join(assetsDirectory, 'icon.png'));
  assert.equal(getTrayIconPath(assetsDirectory, 'win32'), path.join(assetsDirectory, 'icon.ico'));
});

test('the explicit tray exit allows the window to close and destroys the tray icon', () => {
  const { tray, window } = makeLifecycle();
  tray.menu[2].click();

  assert.equal(tray.destroyed, true);
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(window.calls.includes('hide'), false);
});

test('the tray remains available while a cloud stop cannot safely exit', () => {
  const { app, tray, window } = makeLifecycle(() => false);
  tray.menu[2].click();

  assert.equal(tray.destroyed, undefined);
  let prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(window.calls.includes('hide'), true);
  assert.ok(app.listenerCount('before-quit') > 0);
});
