const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeCloudPairCredentials } = require('../cloud-pair');

const now = 1_800_000_000_000;
const validPayload = {
  code: 'ABCD-EFGH',
  secret: 'pair-secret',
  expiresAt: now + 60_000
};

test('normalizes a valid millisecond expiration without mutating credentials', () => {
  assert.deepEqual(normalizeCloudPairCredentials(validPayload, now), {
    code: 'ABCDEFGH',
    secret: 'pair-secret',
    expiresAt: now + 60_000
  });
});

test('normalizes a Unix-seconds expiration returned by older relays', () => {
  assert.deepEqual(
    normalizeCloudPairCredentials({ ...validPayload, expiresAt: (now + 60_000) / 1000 }, now),
    { code: 'ABCDEFGH', secret: 'pair-secret', expiresAt: now + 60_000 }
  );
});

test('reports expired or invalid expiration instead of returning incomplete credentials', () => {
  assert.throws(
    () => normalizeCloudPairCredentials({ ...validPayload, expiresAt: now - 1 }, now),
    /配对码已过期/
  );
  assert.throws(
    () => normalizeCloudPairCredentials({ ...validPayload, expiresAt: null }, now),
    /格式无效/
  );
  assert.throws(() => normalizeCloudPairCredentials(null, now), /为空或格式无效/);
});
