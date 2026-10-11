# 任务：关闭窗口后驻留系统托盘

## 范围锁

- 目标：关闭窗口时隐藏到托盘，保持采集和配对持续运行；可从托盘恢复或明确退出。
- 非目标：开机自启、自动更新、托盘通知和其他平台的专项体验。
- 允许范围：`main.js`、`tray-lifecycle.js`、`package.json`、`package-lock.json`、`test/`、本变更 OpenSpec 记录及 Windows 构建产物。
- 已知基线：0.4.1 关闭窗口会退出应用；语法检查与 13 项现有测试通过。

## 任务

- [x] **1.1** [DONE] 实现托盘驻留、恢复和显式退出，并发布新版 Windows 安装包。
  - 完成条件：关闭窗口只隐藏；托盘单击和“显示屏桥”恢复窗口；“退出屏桥”使关闭不再被拦截并结束共享；托盘生命周期自动测试通过；生成 0.4.2 安装程序与 ZIP 包。
  - 允许文件：`main.js`、`tray-lifecycle.js`、`package.json`、`package-lock.json`、`test/`、`openspec/changes/system-tray-resident/`、`dist/`。
  - 主验证：`npm.cmd run check`、`npm.cmd test`、`npm.cmd run dist`。
  - 必需验收：自动测试覆盖隐藏、恢复、显式退出；发行包构建成功。
  - 手动验收：optional
  - 依赖：无
