'use strict';

async function stopCloudDeviceSafely(credentials, revoke, clearCredentials) {
  let credentialsCleared = false;
  let clearError = null;
  try {
    await clearCredentials();
    credentialsCleared = true;
  } catch (error) {
    clearError = error;
  }

  let revoked = false;
  if (credentials) {
    try { revoked = await revoke(credentials) === true; } catch {}
  }

  return {
    ok: credentialsCleared,
    revoked,
    credentialsCleared,
    ...(clearError ? { error: clearError.message || '本机设备凭据停用失败。' } : {})
  };
}

function cloudStopIsSafeToExit({ hadCredentials, credentialsCleared, revoked }) {
  return !hadCredentials || credentialsCleared === true || revoked === true;
}

function settleCloudStopQuit(requested, safeToExit, quit, warn) {
  if (!requested) return false;
  if (safeToExit) quit();
  else warn();
  return true;
}

module.exports = { cloudStopIsSafeToExit, settleCloudStopQuit, stopCloudDeviceSafely };
