# 任务：公网配对采集与浏览

## 范围锁

- 目标：不同网络的采集电脑和浏览器通过独立短期配对码安全传输即时截图。
- 非目标：账户系统、永久配对、截图持久化、录制或公网直连采集端。
- 允许范围：`main.js`、`preload.js`、`renderer/`、`package.json`/锁文件、`server/`、`README.md`、本变更目录；服务器只允许新增 `/opt/screenbridge`、独立 Nginx 站点片段和 systemd 单元。
- 已知基线：当前桌面端局域网共享与已有提示词/多截图修改未提交；当前 Node 语法检查曾通过。用户将新增 `screenbridge.zahml.top` 指向 `110.42.238.103`；公网部署需 DNS 生效和 TLS 验收。

## 任务

- [ ] **1.1** [BLOCKED] 建立隔离、限时、限流的内存配对中继及 HTTPS 浏览器页面。
  - 完成条件：配对凭据安全校验；只允许一对采集端/查看端；截图按请求转发且不落盘；多房间隔离；有可重复协议检查。
  - 允许文件：`server/**`、`package.json`、锁文件。
  - 主验证：`node --test server/test/*.test.js`、`npm run check`。
  - 必需验收：错误/过期码拒绝、两个房间隔离、未配对不能取图、源码无截图持久化路径。
  - 手动验收：required（浏览器与采集端公网往返）。
  - 当前状态：单元测试及公网 WSS 客户端往返已通过；真实浏览器与 Electron 采集端配对尚未实测。
  - 依赖：无。
- [ ] **1.2** [BLOCKED] 将 Electron 采集端接入中继并提供配对码操作。
  - 完成条件：采集端出站连接、按请求采图，配对状态可见；局域网共享仍正常。
  - 允许文件：`main.js`、`preload.js`、`renderer/**`、`package.json`、锁文件。
  - 主验证：`npm run check` 及有界界面/IPC 往返检查。
  - 必需验收：采集操作不会让助手窗口闪烁；停止共享后房间不可用。
  - 手动验收：required（桌面应用实际配对取图）。
  - 当前状态：代码和语法检查通过；Windows 自动化助手两次启动失败，实际界面验收未完成。
  - 依赖：`1.1`。
- [ ] **1.3** [BLOCKED] 以独立 TLS 入口部署中继且验证现有站点无回归。
  - 完成条件：部署后 HTTPS/WSS 健康检查和公网浏览器取图通过；专属回滚步骤已验证可执行。
  - 允许文件：`server/**`、`README.md`；服务器仅 `/opt/screenbridge/**`、专属 Nginx 站点、专属 systemd 单元。
  - 主验证：`node --test server/test/*.test.js`、HTTPS/WSS 部署验收及已有站点抽查。
  - 必需验收：三项部署验收全部通过，且不修改现有业务配置。
  - 手动验收：required（公网 TLS、配对/错误码/断连）。
  - 当前状态：服务已实际上线，HTTPS/WSS 协议级公网检查通过；仍缺真实浏览器手验及独立只读安全评审。
  - 依赖：`1.1`、`1.2`。

## 评审

- 只读独立评审：实现后分别核验认证/授权、画面隐私/转发、服务器网络与回滚边界；所有必要评审必须达到终态。主代理已自审并修正连接限额与重连限流，但因当前协作模式禁止委派，独立评审仍未完成。

## 后续迭代：完整浏览器工作台（iteration 2）

### 范围锁

- 目标：查看者可在浏览器完成桌面端的截图批次、模型设置、提示词预设、分析与连续追问核心流程。
- 非目标：浏览器采集本机操作系统屏幕；账户系统；服务器保存截图、模型密钥、预设或对话；新增中继侧模型 API 代理。
- 允许范围：`server/public/**`、`server/relay.js`、`server/test/**`、`package.json`、`README.md`、`openspec/changes/public-pairing/**`；服务器只允许回滚保护下更新 `/opt/screenbridge/server/relay.js` 与 `/opt/screenbridge/server/public/**` 并重启专属 systemd 服务。
- 已知基线：旧页面只有配对/单帧预览；公网配对任务的真实桌面手验与独立安全评审仍缺失。

### 任务

- [x] **2.1** [DONE] 提供完整响应式浏览器工作台。
  - 完成条件：配对后可连续获取并管理多张截图；配置视觉/对话模型与不限数量预设；管理回答/追问提示词预设；流式分析、追问、停止、失败回退、重试、复制与清空均可操作；工作台设置保存在浏览器本机，API Key 默认只在内存中。
  - 允许文件：`server/public/**`、`server/relay.js`、`server/test/**`、`package.json`、本任务关联规格和验证记录。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；本机浏览器的配对/多帧/工作台交互检查。
  - 必需验收：桌面和窄屏布局可用；多截图可选/删除；模型流式输出与追问历史可用；检查浏览器刷新后截图和会话消失、设置仍在本机。
  - 手动验收：required（本机浏览器工作台交互与配对截图）；模型服务凭据缺失时使用本地模拟流响应验证。
  - 依赖：`1.1`、`1.2`。
- [ ] **2.2** [DEPLOYED; MANUAL CHECK PENDING] 更新公网工作台并保留可执行回滚。
  - 完成条件：线上根路径与 `/view` 显示完整工作台；HTTPS/WSS 配对入口和 `/healthz` 保持正常；部署前静态文件与专属中继代码备份可恢复。
  - 允许文件：本机 `server/public/**`、`server/relay.js`、`server/test/**`、`package.json`、`README.md`；服务器仅 `/opt/screenbridge/server/public/**`、`/opt/screenbridge/server/relay.js` 和专属 systemd 服务。
  - 主验证：本机 `npm.cmd run check`、`npm.cmd test`；部署后 HTTPS 页面资源与健康检查；公网浏览器工作台手验。
  - 必需验收：TLS 页面加载、静态脚本/CSS成功返回、现有配对协议无回归、可恢复部署前静态资源。
  - 手动验收：required（公网页面打开与配对取图）。
  - 依赖：`2.1`。
  - 当前状态：已备份更新前的静态资源与中继代码，并部署完整工作台；`/`、`/view`、CSS、两个脚本及 `/healthz` 均返回 200。实际在公网浏览器内点选并配对取图的人工验收仍待完成。
  - 回滚备份：`/opt/screenbridge/server/backups/browser-workbench-20261010-1/predeploy.tar.gz`。

## 后续迭代：配对成功后保持长连接（iteration 3）

### 范围锁

- 目标：配对成功后不再受 15 分钟配对码时限影响；连接持续到任一端断开或采集端停止共享。
- 非目标：永久配对；任一端断开后的自动续接；账户系统；截图、API Key 或对话持久化。
- 允许区域：`main.js`、`renderer/index.html`、`renderer/renderer.js`、`server/relay.js`、`server/public/**`、`server/test/**`、`README.md`、`package.json`/锁文件、`openspec/changes/public-pairing/**`；服务器仅更新 `/opt/screenbridge/server/relay.js` 与 `/opt/screenbridge/server/public/**` 并重启专属中继服务。
- 已知基线：未配对的房间按创建时起 15 分钟过期；本机 `npm.cmd run check` 和 `npm.cmd test` 通过，6/6。

### 任务

- [x] **3.1** [DONE] 将 15 分钟限制改为首次配对期限，并在已配对任一端断开时撤销活动房间。
  - 完成条件：未配对的过期码仍失效；活动房间跨过配对码到期时间仍可取图；第二查看端被拒绝；停止共享、查看端离开或采集端断开会关闭另一端并撤销旧码。
  - 允许区域：`main.js`、`server/relay.js`、`server/test/**`。
  - 主验证：`npm.cmd run check`；`npm.cmd test`，覆盖过期前后取图和双方断连清理。
  - 验证：`npm.cmd run check` 通过；`npm.cmd test` 9/9 通过，含活动房间跨过期限继续取图、心跳维持空闲连接、双方断开清理。
  - 手动验收：optional（真实公网会话实际超过 15 分钟）。
  - 依赖：无。
- [x] **3.2** [DONE] 更新界面说明、桌面发行包和公网服务。
  - 完成条件：桌面端明确区分首次配对时限与活动连接；Web 页面与 README 说明新行为；构建可分享的 Windows 安装包；备份后部署兼容新行为的中继。
  - 允许区域：`renderer/index.html`、`renderer/renderer.js`、`server/public/**`、`README.md`、`package.json`/锁文件及本任务关联规格/验证文件；服务器只更新范围锁内的中继与网页文件。
  - 主验证：语法与 9 项中继测试、Windows x64 安装包/ZIP 构建、部署后 HTTPS/健康检查及配对协议检查。
  - 手动验收：optional（Windows 电脑实际安装和长时间公网截图）。
  - 依赖：`3.1`。
  - 验证：重建 x64 安装程序与 ZIP；备份后部署网页及中继；HTTPS 页面/资源、配对与健康检查通过。安装程序未数字签名。

## 后续迭代：采集端完整配置同步（iteration 4）

### 范围锁

- 目标：查看设备连接采集电脑后自动获得并使用采集端的完整模型与提示词配置，避免网页只显示或使用模型名称。
- 非目标：把配置持久化到公网中继；让浏览器绕过自身安全限制使用桌面 App 的独立 HTTP 代理；在断开后覆盖浏览器本地配置。
- 允许范围：`main.js`、`server/relay.js`、`server/public/**`、`server/test/**`、`README.md`、本任务关联规格和验证文件。
- 已知基线：桌面端配置文件中的 API Key 仍由 Electron `safeStorage` 加密保存；只有已建立的配对连接需要配置时才解密并传输。

### 任务

- [x] **4.1** **[DONE]** 同步采集端完整配置并隔离连接生命周期。
  - 完成条件：公网 `config` 消息经中继转为对应房间的 `source-config`；局域网通过带配对码的 `/config` 持续读取；同步 API 地址、协议、Key、代理、模型、模型预设、主用项、优先级、启用/自动切换、系统提示词和回答/追问提示词预设；连接期间网页设置只读，断开后恢复网页本地配置；中继不落盘配置。
  - 允许文件：`main.js`、`server/relay.js`、`server/public/**`、`server/test/**`、`README.md`、本任务关联规格和验证文件。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；`node --check server/public/workbench.js`；`node --check server/public/viewer.js`；`node --check server/relay.js`；`git diff --check`。
  - 必需验收：完整配置转发测试覆盖多字段更新和房间隔离；超大配置被拒绝；公网和局域网同步逻辑均带连接/会话校验。
  - 手动验收：optional（真实采集端保存配置后，在公网浏览器和局域网浏览器分别观察字段更新）。
  - 依赖：`2.1`、`3.1`。

## 后续迭代：上线完整配置同步（iteration 5）

### 范围锁

- 目标：将已验证的完整配置同步网页和中继部署到公网，并生成包含配置发送逻辑的 Windows 安装包。
- 非目标：改动现有站点、Docker、服务器数据或 TLS 配置；提交或推送代码；把 API Key 写入服务器文件。
- 允许范围：`main.js`、`server/relay.js`、`server/public/**`、`server/test/**`、`package.json`/锁文件、`openspec/changes/public-pairing/**`；服务器仅更新 `/opt/screenbridge/server/relay.js` 与 `/opt/screenbridge/server/public/**`。
- 回滚：恢复本次部署前保存的 `relay.js` 和 `public/` 备份，再重启 `screenbridge-relay.service`；安装包不替换已安装客户端。
- 授权：用户于 2026-10-11 明确要求“更新线上的”。

### 任务

- [x] **5.1** [DONE] 修复配置同步边界、构建客户端并部署公网网页与中继。
  - 完成条件：网页断开后恢复本机临时 API Key；Right Code 特殊域名使用与桌面端相同的 API 协议；测试通过；Windows 安装包生成；服务器备份可恢复；部署后服务、页面资源与中继健康检查通过。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；`npm.cmd run dist`；远端备份、文件校验值、HTTPS 页面与 `/healthz` 检查。
  - 必需验收：独立只读审查终态为 `pass`；公网配置同步代码已部署；原有其它站点和容器未改动。
  - 手动验收：optional（实际 Windows 安装后与公网采集端完成模型请求）。
  - 验证：`npm.cmd run check`、`npm.cmd test`（13/13）、`git diff --check`、Windows x64 安装包构建、远端备份和 SHA-256 校验、HTTPS 页面及静态资源一致性、公网 WSS 完整配置转发均通过；专属服务 active，`/healthz` 为 200。一次过早健康探测触发自动回滚，随后使用有界就绪探测部署成功。未改动现有站点或容器。
