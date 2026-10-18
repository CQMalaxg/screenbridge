# 验证：安全的账号设备绑定与断线恢复

**总体状态：** pass
**评审状态：** pass（修订后的发布脚本独立只读复审未发现 P0-P2）

## 基线

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 工作区说明 | `rg --files -g AGENTS.md -g '!node_modules' -g '!dist' -g '!build'` | not-found；未发现额外仓库指令 |
| 既有验证记录 | 2026-10-16 `npm.cmd run check`、`npm.cmd test` | pass；26/26，作为改动前证据 |
| 认证定向测试 | `node --test server/test/auth.test.js` | pass；10/10，含正确密码不受账号级错误限速锁定 |
| 设备存储定向测试 | `node --test test/cloud-device-store.test.js` | pass；新增停用先落盘及落盘失败仍尝试服务端撤销覆盖 |
| 全量测试 | `npm.cmd test` | pass；48/48，2026-10-17，含退出请求消费和托盘安全退出测试 |
| 语法检查 | `npm.cmd run check` | pass；2026-10-17 |
| 差异空白检查 | `git diff --check` | pass；2026-10-17 |

## 需求覆盖

| 任务 | 场景 | 证据 | 结果 |
| --- | --- | --- | --- |
| `9.1` | 账号会话和设备权限隔离 | `server/test/auth.test.js`；`npm.cmd test` | pass |
| `9.2` | 桌面端密钥保存和重连 | `test/cloud-device-store.test.js`；托盘/退出测试；`npm.cmd run check`；`npm.cmd test` | pass；Windows 登录启动、休眠唤醒手验未执行（optional） |
| `9.3` | 网页登录及免配对码恢复 | `server/test/viewer.test.js`；浏览器恢复/断开竞态测试；`npm.cmd test` | pass；跨真实浏览器手验未执行（optional） |
| `9.4` | 安全评审、全量回归；迭代 1 不部署 | 两个独立风险面评审、全量测试、语法与差异检查 | pass；当时未连接或修改线上 |
| `10.1` | 本机 Windows 桌面发行包 | `npm.cmd run check`、`npm.cmd test`、`npm.cmd run dist -- --config.directories.output=dist/release-0.4.4 --publish never`；归档版本/恢复模块核验 | pass；安装程序与 ZIP 位于 `dist/release-0.4.4/`，旧发行物保留；安装器未签名，Windows 可能提示 SmartScreen |
| `10.2` | 更新线上网页/中继并维持状态目录权限 | 线上归档 SHA 与本机匹配；归档清单含中继、认证存储、四个网页文件和 unit；暂存 JS `node --check`、`systemd-analyze verify` 通过；修订脚本远端 `bash -n` 通过，SHA-256 与本机一致；修订脚本独立复审通过 | pass；服务 `active`，`/healthz`、首页、CSS/JS 资源均为 `200`，未登录 `/api/devices` 为 `401`；状态目录 `0700 screenbridge:screenbridge`；线上 7 个发布文件 SHA-256 与本地一致 |

## 安全评审

- 认证/会话风险面：pass；复核登录限速、可信代理来源与服务端状态目录权限，无 P0-P2 发现
- 设备密钥/重连风险面：pass；停止共享竞态、待退出请求消费、网页手动断开竞态均已复核，无 P0-P2

## 已知缺口

- 可选的 Windows 登录启动、休眠唤醒及跨真实浏览器手动验收未执行。
- OpenSpec CLI 未安装，未运行 CLI 校验；产物保留为可审阅变更记录。
- Windows 安装/升级、登录启动、休眠唤醒及新账号首次注册/设备绑定的手动验收未执行。

## 独立评审

- 认证/会话：pass；复核账号限速、可信代理边界和状态目录权限，未发现 P0-P2。
- 设备密钥/重连：pass；复核本机先停用、服务端尽力撤销、待退出请求消费和网页手动断开竞态，未发现 P0-P2。
- 评审基线：`HEAD 074551d5a09ffbaa6a7cef0f6eda18c813000ea5` 加当前未提交工作区差异。
- 迭代 2 发布边界/回滚文档：第三轮复核 `pass`（2026-10-17 12:34 +08:00）；首轮 3 项与第二轮 2 项 P2 均已修复，无剩余 P0-P2。
- 首次部署脚本复核曾通过，但运行时发现健康检查前端口尚未就绪及 ERR trap 在子 shell 重复触发；修订后再次独立复审通过，无 P0-P2。

## 迭代 2 发布前证据

- 本机 `dist/release-0.4.4/screenbridge-relay-deploy.tar.gz` 与线上 incoming 归档 SHA-256 均为 `9ca9ead1ec8365b8a29b8b84fbe452a190d24029ad872d84aad09dd595486d50`；归档清单包含 `relay.js`、`security-store.js`、四个网页文件和 systemd unit。
- 线上暂存 `/opt/screenbridge/server/backups/secure-device-reconnect-20261017-1/staging/` 中 `relay.js` 与 `security-store.js` 的 `node --check` 均通过；unit 权限设为 `0644` 后 `systemd-analyze verify` 退出码为 0。输出中的其他弃用提示来自服务器已有的无关 unit。
- 首次发布曾触发回滚；旧版已恢复并确认健康。第二次发布使用修订后的回滚脚本成功，远端服务保持 active，公网验收通过。
- 修订后的发布脚本 SHA-256：`863677abcefd043f7876b9e7fc69855e20be8c8d27d7bba30e6361fb94d07487`；本机与远端暂存文件一致，远端 `bash -n` 通过。发布脚本独立复审通过，无 P0-P2。
- 线上 `/healthz`、`/`、`/viewer.css`、`/viewer.js`、`/workbench.js` 均为 HTTP `200`；未登录 `/api/devices` 为 `401`；服务 `active`，状态目录为 `0700 screenbridge:screenbridge`。线上 `relay.js`、`security-store.js`、四个网页资源和 systemd unit 的 SHA-256 均与本地文件匹配。
- 本机 Windows 版本为 `0.4.4`。安装程序 SHA-256：`A22F8857FCF838F0F468960FEBB0136AD47CF62D5373B2DCCB1AC14F607744CE`；ZIP SHA-256：`7A6D41B0CC07BEAAF7CABD853A8C0DBF74F44F67EC1D88244B064A94CD665848`。安装包只保存在本机，未上传。

## 发布尝试与恢复

- 首次切换脚本上传并通过 `bash -n`；替换线上文件并启动新服务后，首次 HTTPS 健康探测收到 `502`。`ERR` 陷阱在命令替换子 shell 和父 shell 重复触发，第一次恢复旧文件并启动旧服务，第二次重复执行因固定恢复目录存在而又停掉服务。
- 已逐项比较线上 `relay.js`、四个网页文件及 systemd unit 与 `predeploy.tar.gz` 中对应内容，SHA-256 全部匹配；确认线上不存在 `security-store.js`，并保留状态目录 `0700 screenbridge:screenbridge`。手动启动旧服务后 `systemctl is-active` 为 `active`，公网 `/healthz` 为 `200`。
- 修订后的脚本使健康检查和资源验收失败时显式回滚；健康探测有界重试，回滚使用唯一临时目录并确认服务 active。独立复审和第二次线上发布均通过。
