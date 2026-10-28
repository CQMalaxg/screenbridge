'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { getScreenCapturePermissionMessage } = require('../screen-capture-errors');

const root = path.resolve(__dirname, '..');

test('macOS screen capture checks screen recording permission and explains how to grant it', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const captureErrors = fs.readFileSync(path.join(root, 'screen-capture-errors.js'), 'utf8');

  assert.match(main, /getMediaAccessStatus\(['"]screen['"]\)/);
  assert.match(main, /getScreenCapturePermissionMessage\(process\.platform, accessStatus\)/);
  assert.match(captureErrors, /系统设置.{0,40}隐私与安全性.{0,30}屏幕录制/);
});

test('screen recording guidance appears only on macOS when access is not granted', () => {
  const denied = getScreenCapturePermissionMessage('darwin', 'denied');
  assert.match(denied, /系统设置 → 隐私与安全性 → 屏幕录制/);
  assert.match(denied, /重新打开应用/);
  assert.equal(getScreenCapturePermissionMessage('darwin', 'granted'), null);
  assert.equal(getScreenCapturePermissionMessage('win32', 'denied'), null);
});

test('screen monitor startup failures can retrieve macOS permission guidance', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');

  assert.match(preload, /getScreenCapturePermissionMessage:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-screen-capture-permission-message'\)/);
  assert.match(renderer, /await api\.getScreenCapturePermissionMessage\(\)/);
});

test('follow-up shortcut help names both macOS and Windows/Linux key combinations', () => {
  const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

  assert.match(html, /Command\s*\+\s*Enter/);
  assert.match(html, /Ctrl\s*\+\s*Enter/);
});
