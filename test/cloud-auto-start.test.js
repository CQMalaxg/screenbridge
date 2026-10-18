'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getCloudAutoStart, setCloudAutoStart } = require('../cloud-auto-start');

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
  assert.throws(() => setCloudAutoStart(app, true, 'linux'), /仅支持 Windows/);
  assert.deepEqual(app.calls, []);
});
