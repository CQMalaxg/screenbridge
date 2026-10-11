'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDefaultPromptPresets } = require('../prompt-presets');

test('built-in prompt presets cover common coding failure scenarios', () => {
  const vision = getDefaultPromptPresets('vision');
  const chat = getDefaultPromptPresets('chat');

  assert.equal(vision.length, 10);
  assert.equal(chat.length, 8);
  assert.ok(vision.some((preset) => preset.name.includes('代码报错')));
  assert.ok(vision.some((preset) => preset.name.includes('复杂度')));
  assert.ok(vision.some((preset) => preset.name.includes('用例未通过')));
  assert.ok(chat.some((preset) => preset.name.includes('失败用例')));
  assert.ok(chat.some((preset) => preset.name.includes('降低时间复杂度')));

  for (const preset of [...vision, ...chat]) {
    assert.match(preset.id, /^(vision|chat)-prompt-/);
    assert.ok(preset.name.length > 0);
    assert.ok(preset.text.length >= 30);
  }
});

test('getDefaultPromptPresets returns independent editable copies', () => {
  const first = getDefaultPromptPresets('vision');
  const second = getDefaultPromptPresets('vision');
  first[0].name = 'changed';
  first.push({ id: 'local-only', name: 'local', text: 'local' });

  assert.notEqual(second[0].name, first[0].name);
  assert.equal(second.length, 10);
});
