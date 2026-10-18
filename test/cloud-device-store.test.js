'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');
const { CloudDeviceStore, FILE_NAME } = require('../cloud-device-store');
const { cloudRetryDelay } = require('../cloud-reconnect-policy');
const { cloudStopIsSafeToExit, settleCloudStopQuit, stopCloudDeviceSafely } = require('../cloud-stop-policy');

const directories = new Set();

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'screenbridge-device-store-'));
  directories.add(directory);
  return directory;
}

function fakeSafeStorage(enabled = true) {
  return {
    isEncryptionAvailable: () => enabled,
    encryptString: (value) => Buffer.concat([Buffer.from('test-cipher:'), Buffer.from(value)]),
    decryptString: (value) => {
      const bytes = Buffer.from(value);
      const marker = Buffer.from('test-cipher:');
      assert.equal(bytes.subarray(0, marker.length).toString(), marker.toString());
      return bytes.subarray(marker.length).toString();
    }
  };
}

afterEach(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

test('device credentials are encrypted at rest and survive a process restart', () => {
  const directory = temporaryDirectory();
  const store = new CloudDeviceStore(directory, fakeSafeStorage());
  const credentials = { code: 'ABCDEFGH', secret: 's'.repeat(43), expiresAt: 123456789 };
  store.save(credentials);

  const filePath = path.join(directory, FILE_NAME);
  const fileText = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(fileText, /ABCDEFGH|s{20}/);
  assert.deepEqual(new CloudDeviceStore(directory, fakeSafeStorage()).load(), credentials);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  }
});

test('storage fails closed when OS encryption is unavailable and clears credentials explicitly', () => {
  const directory = temporaryDirectory();
  const credentials = { code: 'ABCDEFGH', secret: 's'.repeat(43), expiresAt: 123456789 };
  const store = new CloudDeviceStore(directory, fakeSafeStorage(false));
  assert.throws(() => store.save(credentials), /安全存储不可用/);
  assert.equal(fs.existsSync(path.join(directory, FILE_NAME)), false);

  const encryptedStore = new CloudDeviceStore(directory, fakeSafeStorage());
  encryptedStore.save(credentials);
  encryptedStore.clear();
  assert.equal(encryptedStore.load(), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, FILE_NAME), 'utf8')), { version: 1, disabled: true });
  assert.equal(new CloudDeviceStore(directory, fakeSafeStorage()).load(), null);
});

test('stop reports local credential deactivation failure instead of claiming success', async () => {
  const credentials = { code: 'ABCDEFGH', secret: 's'.repeat(43), expiresAt: 123456789 };
  const calls = [];
  const result = await stopCloudDeviceSafely(credentials, async () => false, async () => {
    calls.push('clear');
    throw new Error('disk denied');
  });
  calls.push('complete');
  assert.deepEqual(result, {
    ok: false,
    revoked: false,
    credentialsCleared: false,
    error: 'disk denied'
  });
  assert.deepEqual(calls, ['clear', 'complete']);
});

test('stop persists local deactivation before waiting for relay revocation', async () => {
  const credentials = { code: 'ABCDEFGH', secret: 's'.repeat(43), expiresAt: 123456789 };
  const calls = [];
  let finishRevoke;
  const stopping = stopCloudDeviceSafely(credentials, async () => {
    calls.push('revoke-start');
    await new Promise((resolve) => { finishRevoke = resolve; });
    calls.push('revoke-finish');
    return true;
  }, () => calls.push('clear'));

  assert.deepEqual(calls, ['clear']);
  await Promise.resolve();
  assert.deepEqual(calls, ['clear', 'revoke-start']);
  finishRevoke();
  assert.deepEqual(await stopping, { ok: true, revoked: true, credentialsCleared: true });
  assert.deepEqual(calls, ['clear', 'revoke-start', 'revoke-finish']);
});

test('stop still attempts relay revocation when local deactivation fails', async () => {
  const credentials = { code: 'ABCDEFGH', secret: 's'.repeat(43), expiresAt: 123456789 };
  let revokeAttempted = false;
  const result = await stopCloudDeviceSafely(credentials, async () => {
    revokeAttempted = true;
    return true;
  }, async () => {
    throw new Error('disk denied');
  });
  assert.equal(revokeAttempted, true);
  assert.deepEqual(result, {
    ok: false,
    revoked: true,
    credentialsCleared: false,
    error: 'disk denied'
  });
  assert.equal(cloudStopIsSafeToExit({ ...result, hadCredentials: true }), true);
  assert.equal(cloudStopIsSafeToExit({ ...result, revoked: false, hadCredentials: true }), false);
  assert.equal(cloudStopIsSafeToExit({ hadCredentials: false, credentialsCleared: false, revoked: false }), true);
});

test('a quit requested during stop is consumed after safe completion or surfaced as a warning', () => {
  const calls = [];
  assert.equal(settleCloudStopQuit(false, true, () => calls.push('quit'), () => calls.push('warn')), false);
  assert.deepEqual(calls, []);
  assert.equal(settleCloudStopQuit(true, true, () => calls.push('quit'), () => calls.push('warn')), true);
  assert.equal(settleCloudStopQuit(true, false, () => calls.push('quit'), () => calls.push('warn')), true);
  assert.deepEqual(calls, ['quit', 'warn']);
});

test('corrupt or undecryptable credentials never fall back to plaintext', () => {
  const directory = temporaryDirectory();
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, FILE_NAME), JSON.stringify({ version: 1, encrypted: Buffer.from('not ciphertext').toString('base64') }));
  const store = new CloudDeviceStore(directory, fakeSafeStorage());
  assert.throws(() => store.load(), /无法解密或格式无效/);
});

test('cloud reconnect backoff grows exponentially with jitter and stays capped', () => {
  assert.equal(cloudRetryDelay(0, () => 0), 750);
  assert.equal(cloudRetryDelay(1, () => 1), 2500);
  assert.equal(cloudRetryDelay(5, () => 0), 22_500);
  assert.equal(cloudRetryDelay(20, () => 1), 30_000);
});
