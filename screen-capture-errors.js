'use strict';

function getScreenCapturePermissionMessage(platform, accessStatus) {
  if (platform !== 'darwin' || accessStatus === 'granted') return null;
  return 'macOS 尚未授予屏幕录制权限。请打开“系统设置 → 隐私与安全性 → 屏幕录制”，允许“屏桥 ScreenBridge”访问屏幕，然后完全退出并重新打开应用。';
}

module.exports = { getScreenCapturePermissionMessage };
