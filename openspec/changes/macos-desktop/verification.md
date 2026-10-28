# 验证：macOS 桌面版适配

**检查修订：** `f59b62e + 当前工作区 macOS 适配`
**总体状态：** blocked
**评审状态：** pass

## 人工确认记录

| # | 门禁 | 对应契约修订 / 暂存差异指纹 | 状态 | 请求时间 | 用户决定与时间 |
| ---: | --- | --- | --- | --- | --- |
| 1 | 文档确认：允许开始写测试/实现 | `macos-desktop-contract-v1` | `approved` | `2026-10-28T13:27:17+08:00` | 用户回复“修改”，批准该契约，`2026-10-28T16:28:15+08:00` |
| 2 | Git 提交确认 | `codex/macos-desktop` 的 macOS 适配差异 | `approved` | `2026-10-28T18:31:28+08:00` | 用户明确要求“快点，直接push”，批准将本次 Mac 适配提交推送至该功能分支；不合并主分支、不发布 Release、不部署 |

## 需求覆盖

| 任务 | 需求/场景 | 当前证据 | 结果 |
| --- | --- | --- | --- |
| `1.1` | 通用 macOS DMG/ZIP 构建 | 14 项定向测试通过；macOS runner 原生构建未执行 | blocked |
| `1.2` | macOS 截图授权、驻留、登录启动与快捷键 | 15 项定向测试通过；macOS 实机验收未执行 | blocked |

## 运行账本

| # | 任务 | 阶段 | 目的 | 代码修订 | 命令/动作 | 结果 | 下一步 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `1.1`、`1.2` | baseline | 确认现有自动化基线 | `f59b62e + 当前工作区` | `npm.cmd test` | `pass`：57/57 项通过 | 先为通用 macOS 构建配置编写测试 |
| 2 | `1.1`、`1.2` | baseline | 确认语法检查基线 | `f59b62e + 当前工作区` | `npm.cmd run check` | `pass`：现有检查通过 | 先为通用 macOS 构建配置编写测试 |
| 3 | `1.1` | task | 实现前确认通用构建配置缺失 | `f59b62e + 当前工作区` | `node --test test/mac-build.test.js`（退出码 1；缺少 `dist:mac` 脚本和工作流文件） | `pass`：因目标构建行为尚不存在而失败 | 添加通用 DMG/ZIP 配置和手动 macOS 工作流 |
| 4 | `1.2` | task | 实现前确认 macOS 平台行为缺失 | `f59b62e + 当前工作区` | `node --test test/mac-build.test.js test/cloud-auto-start.test.js test/tray-lifecycle.test.js test/mac-desktop.test.js`（退出码 1；登录启动拒绝 macOS、图标路径未分平台、录屏指引和快捷键提示缺失） | `pass`：目标行为断言失败 | 实现平台分支、权限指引和双平台快捷键提示 |
| 5 | `1.2` | task | 实现前确认 macOS 登录启动应保持隐藏 | `macOS 适配实现前` | `node --test --test-name-pattern="modern macOS" test/cloud-auto-start.test.js`（退出码 1；缺少启动可见性策略） | `pass`：目标行为断言失败 | 增加登录启动识别并仅隐藏首次窗口 |
| 6 | `1.1`、`1.2` | task | 验证适配配置与平台行为 | `f59b62e + 当前工作区 macOS 适配` | `node --test test/mac-build.test.js test/cloud-auto-start.test.js test/tray-lifecycle.test.js test/mac-desktop.test.js` | `pass`：14/14 项通过 | 运行全量回归并检查 Windows 兼容性 |
| 7 | `1.1`、`1.2` | final | 验证语法和全量行为回归 | `f59b62e + 当前工作区 macOS 适配` | `npm.cmd run check`；`npm.cmd test` | `pass`：语法检查通过，66/66 项通过 | 在 macOS runner 与实机补齐验收 |
| 8 | `1.1` | final | 校验 workflow YAML 与差异格式 | `f59b62e + 当前工作区 macOS 适配` | `js-yaml` 解析 `.github/workflows/macos-build.yml`；`git diff --check` | `pass`：YAML 可解析，差异格式检查通过 | 在 macOS runner 构建并检查 DMG/ZIP 内容 |
| 9 | `1.2` | task | 修正文案并验证平台提示 | `macOS 适配实现前/后` | `node --test --test-name-pattern="unsupported outside Windows" test/cloud-auto-start.test.js` | `pass`：旧提示先因断言不匹配失败；更新为 Windows 和 macOS 后目标测试通过 | 重新运行全量测试和语法检查 |
| 10 | `1.1` | task | 确认构建命令不会发布 Release | `发布保护配置前/后` | `node --test test/mac-build.test.js`（更新前退出码 1；未显式指定发布策略） | `pass`：命令现在明确设置 `--publish never` | 运行最终全量回归 |
| 11 | `1.1`、`1.2` | final | 验证最终配置与行为 | `f59b62e + 当前工作区 macOS 适配` | `npm.cmd run check`；`npm.cmd test`；workflow YAML 解析；`git diff --check` | `pass`：语法检查通过，66/66 项通过，YAML 与差异检查通过 | 等待 macOS runner 和实机验收 |
| 12 | `1.2` | task | 实现前确认屏幕监听拒绝权限时缺少权限指引 | `macOS 适配实现前` | `node --test --test-name-pattern="monitor startup failures" test/mac-desktop.test.js`（退出码 1；预加载接口缺失） | `pass`：目标权限提示通路尚未接入时断言失败 | 接通主进程权限状态查询与渲染器启动错误提示 |
| 13 | `1.1`、`1.2` | final | 验证最终桌面适配差异 | `f59b62e + 当前工作区 macOS 适配` | `node --test test/mac-build.test.js test/cloud-auto-start.test.js test/tray-lifecycle.test.js test/mac-desktop.test.js`；`npm.cmd run check`；`npm.cmd test`；workflow YAML 解析；`git diff --check` | `pass`：定向测试 15/15 项、全量测试 67/67 项通过；语法、YAML 和差异检查通过 | 等待 macOS runner 与实机验收 |

## 评审

- 终态：`pass`
- 修订/时间：`f59b62e + 当前工作区 macOS 适配`；主代理差异自审，未发现额外 Windows 回归问题。
- 阻塞项：macOS 原生构建及实机验收尚未执行。

## 已知缺口和后续工作

- 当前执行环境为 Windows，无法本机运行 macOS 原生打包、屏幕录制授权和 Dock/菜单栏实测；推送功能分支后仍需手动运行 macOS 工作流，并由 Mac 实机完成交互验收。
- 不合并主分支、不发布 Release、不部署。
