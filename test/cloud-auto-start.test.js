'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getCloudAutoStart, setCloudAutoStart, shouldStartHidden } = require('../cloud-auto-start');

function fakeApp() {
  let startup = null;
  const calls = [];
  return {
    calls,
    setLoginItemSettings(settings) {
      calls.push({ type: 'set', settings });
      startup = settings.openAtLogin ? settings : null;
    },
    getLoginItemSettings(options) {
      calls.push({ type: 'get', options });
      return { openAtLogin: Boolean(startup && JSON.stringify(startup.args) === JSON.stringify(options.args)) };
    }
  };
}

test('startup setting is read back with the same hidden argument used to register it', () => {
  const app = fakeApp();

  assert.equal(setCloudAutoStart(app, true, 'win32'), true);
  assert.deepEqual(getCloudAutoStart(app, 'win32'), { supported: true, enabled: true });
  assert.deepEqual(app.calls[0], { type: 'set', settings: { openAtLogin: true, args: ['--hidden'] } });
  assert.deepEqual(app.calls[1], { type: 'get', options: { args: ['--hidden'] } });

  assert.equal(setCloudAutoStart(app, false, 'win32'), false);
  assert.deepEqual(getCloudAutoStart(app, 'win32'), { supported: true, enabled: false });
});

test('startup setting reports unsupported outside Windows', () => {
  const app = fakeApp();
  assert.deepEqual(getCloudAutoStart(app, 'linux'), { supported: false, enabled: false });
  assert.throws(() => setCloudAutoStart(app, true, 'linux'), /仅支持 Windows 和 macOS/);
  assert.deepEqual(app.calls, []);
});

test('macOS startup launches hidden and reports the login item state', () => {
  let startup = false;
  const app = {
    setLoginItemSettings(settings) {
      assert.deepEqual(settings, { openAtLogin: true, openAsHidden: true });
      startup = settings.openAtLogin;
    },
    getLoginItemSettings() {
      return { openAtLogin: startup };
    }
  };

  assert.equal(setCloudAutoStart(app, true, 'darwin'), true);
  assert.deepEqual(getCloudAutoStart(app, 'darwin'), { supported: true, enabled: true });
});

test('macOS login startup can be disabled without Windows-only arguments', () => {
  const calls = [];
  const app = {
    setLoginItemSettings(settings) { calls.push(settings); },
    getLoginItemSettings() { return { openAtLogin: false }; }
  };

  assert.equal(setCloudAutoStart(app, false, 'darwin'), false);
  assert.deepEqual(calls, [{ openAtLogin: false, openAsHidden: false }]);
});

test('login startup stays hidden on modern macOS while normal app launches remain visible', () => {
  assert.equal(typeof shouldStartHidden, 'function');
  assert.equal(shouldStartHidden({ getLoginItemSettings: () => ({ wasOpenedAtLogin: true }) }, [], 'darwin'), true);
  assert.equal(shouldStartHidden({ getLoginItemSettings: () => ({ wasOpenedAsHidden: true }) }, [], 'darwin'), true);
  assert.equal(shouldStartHidden({ getLoginItemSettings: () => ({ wasOpenedAtLogin: false }) }, [], 'darwin'), false);
  assert.equal(shouldStartHidden({}, ['--hidden'], 'win32'), true);
});
