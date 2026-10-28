'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('macOS universal distribution builds DMG and ZIP targets', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts['dist:mac'], 'electron-builder --mac --universal --publish never');
  assert.deepEqual(packageJson.build.mac.target, ['dmg', 'zip']);
  assert.equal(packageJson.build.mac.icon, 'assets/icon.png');
  assert.ok(packageJson.build.files.includes('screen-capture-errors.js'));
});

test('manual macOS workflow builds and uploads artifacts without publishing a release', () => {
  const workflowPath = path.join(root, '.github', 'workflows', 'macos-build.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /runs-on:\s*macos-/);
  assert.match(workflow, /npm run dist:mac/);
  assert.match(workflow, /actions\/upload-artifact@/);
  assert.match(workflow, /dist\/\*\.dmg/);
  assert.match(workflow, /dist\/\*\.zip/);
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|gh release create|deploy/i);
});
