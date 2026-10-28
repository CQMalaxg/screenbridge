# 任务：macOS 桌面版适配

## 范围锁

- 目标：提供可构建、可安装并保留核心能力的 macOS 桌面版。
- 非目标：服务端/网页改动、线上部署、Release 发布、Apple 签名与公证。
- 允许范围：`package.json`、`main.js`、`cloud-auto-start.js`、`tray-lifecycle.js`、`renderer/`、`assets/`、`test/`、`.github/workflows/`、`README.md`、本变更目录。
- 已知基线：57 项测试和 `npm.cmd run check` 通过；有独立的未提交网页修复。

## 任务

- [ ] **1.1** [BLOCKED] 生成面向 Intel 与 Apple 芯片的 macOS DMG/ZIP，并提供手动构建流程。
  - 完成条件：macOS runner 上的手动流程配置为构建通用 DMG/ZIP，不发布或部署；README 解释无签名/公证时的首次打开提示。
  - 允许文件：`package.json`、`.github/workflows/`、`README.md`、`openspec/changes/macos-desktop/`。
  - 主验证：新增构建配置测试；macOS runner 实际构建。
  - 验证策略：先写测试再改配置；macOS 实际构建因当前 Windows 环境不可执行时如实记录。
  - 必需验收：配置测试通过；macOS 构建产物中包含应用资源。
  - 手动验收：required。
  - 依赖：契约已由用户于 `2026-10-28 16:28 +08:00` 确认。
  - 阻塞：当前执行环境为 Windows，无法实际生成或检查 macOS DMG/ZIP；需要在 macOS runner 执行已配置的手动工作流。
- [ ] **1.2** [BLOCKED] 适配 macOS 截图授权、菜单栏驻留、登录启动及快捷键提示。
  - 完成条件：用户可了解并授予屏幕录制权限；窗口可从菜单栏/Dock 恢复；登录启动设置在 macOS 可用；追问快捷键提示包含 Command+Enter。
  - 允许文件：`main.js`、`cloud-auto-start.js`、`tray-lifecycle.js`、`renderer/`、`assets/`、`test/`、`README.md`、`openspec/changes/macos-desktop/`。
  - 主验证：新增平台行为测试；`npm.cmd test`；`npm.cmd run check`。
  - 验证策略：先写测试再改实现；Windows 回归自动测试；真实 macOS 授权及窗口行为手验。
  - 必需验收：实现前目标测试失败、实现后相关测试通过；macOS 实机手验通过。
  - 手动验收：required。
  - 依赖：契约已由用户于 `2026-10-28 16:28 +08:00` 确认。
  - 阻塞：当前没有 macOS 实机，无法验收系统录屏授权、窗口驻留/恢复和登录启动。
