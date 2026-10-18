const pairingCodePattern = /^[A-HJ-NP-Z2-9]{8}$/;

function normalizeExpiry(value) {
  if (value === null || value === undefined || value === '') return NaN;

  let expiresAt = Number(value);
  if (!Number.isFinite(expiresAt) && typeof value === 'string') {
    expiresAt = Date.parse(value);
  }
  if (!Number.isFinite(expiresAt)) return NaN;

  // Accept both Unix seconds and JavaScript milliseconds from relay versions.
  return expiresAt > 0 && expiresAt < 100_000_000_000 ? expiresAt * 1000 : expiresAt;
}

function normalizeCloudPairCredentials(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('中继返回的配对信息为空或格式无效，请稍后重试');
  }

  const code = String(payload.code || '').replace(/-/g, '');
  const secret = String(payload.secret || '');
  const expiresAt = normalizeExpiry(payload.expiresAt);
  if (!pairingCodePattern.test(code) || !secret || !Number.isFinite(expiresAt)) {
    throw new Error('中继返回的配对信息格式无效，请稍后重试');
  }
  if (expiresAt <= now) {
    throw new Error('配对码已过期，请检查电脑的日期和时间是否正确后重试');
  }

  return { code, secret, expiresAt };
}

module.exports = { normalizeCloudPairCredentials };
