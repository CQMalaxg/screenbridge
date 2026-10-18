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

## 后续迭代：网页答案选区放大、截图自动清理与追问兼容（iteration 6）

### 范围锁

- 目标：网页选中回答文字时显示放大预览；点击分析后清空可见截图栏并保留本轮截图供重试/追问附图；修复 Responses API 追问把助手回答编码为 `input_text` 导致的 HTTP 400。
- 非目标：桌面端行为、模型供应商配置、服务端代理/密钥处理、任意错误的自动重试、截图持久化。
- 允许范围：`server/public/index.html`、`server/public/viewer.css`、`server/public/workbench.js`、`server/public/viewer.js`、`server/test/viewer.test.js`、本迭代关联规格/任务/验证/checkpoint；服务器只允许备份并更新 `/opt/screenbridge/server/public/` 中对应静态文件。
- 已知基线：`npm.cmd run check` 通过；`npm.cmd test` 15/15 通过。用户提供的 HTTP 400 指向 `input[1].content[0]`：历史助手消息不接受 `input_text`，应使用 `output_text`。

### 任务

- [x] **6.1** [DONE] 在回答选区显示放大预览，并在分析开始时清空待分析栏、保留复用截图。
  - 完成条件：仅当选区位于助手回答内显示放大浮层；选区清除、离开回答或视窗变化后隐藏；分析启动立即清空可见队列；失败/停止时可重试，追问附图可使用最近分析批次。
  - 允许文件：`server/public/index.html`、`server/public/viewer.css`、`server/public/workbench.js`、本任务关联规格和验证文件。
  - 主验证：`npm.cmd run check`；浏览器工作台交互检查（若本机浏览器自动化不可用，记录限制并以局部代码/状态检查替代）。
  - 必需验收：选区条件、浮层定位/隐藏逻辑、分析队列清理与保留批次的状态路径经自审；不得把截图发送给非用户选择的模型调用之外的服务器。
  - 验证：`npm.cmd run check` 通过；自审确认仅助手答案选区显示放大层，选区清除/窗口改变/任意滚动/回答重绘时隐藏；分析开始清空可见队列，最近批次仍支持重试和勾选附图。
  - 手动验收：optional（桌面/平板浏览器选中文字和分析后查看截图栏）。
  - 依赖：无。
- [x] **6.2** [DONE] 修正 Responses API 追问的历史助手消息格式。
  - 完成条件：追问请求中的用户消息使用 `input_text`、助手回答使用 `output_text`，附图使用 `input_image`；HTTP 400 的原始服务端详情继续可见；请求体有回归测试。
  - 允许文件：`server/public/viewer.js`、`server/test/viewer.test.js`、本任务关联验证文件。
  - 主验证：`npm.cmd test`。
  - 必需验收：测试断言 Responses API 对话历史中各角色的内容类型正确，并确认模型返回 HTTP 400 时显示其响应正文。
  - 验证：`npm.cmd run check` 通过；`npm.cmd test` 17/17 通过，含角色文本类型、追问附图和 HTTP 400 正文回归测试；`git diff --check` 通过。
  - 手动验收：optional（使用用户实际模型执行一轮追问）。
  - 依赖：无。
- [x] **6.3** [DONE] 备份并更新线上网页静态资源。
  - 完成条件：先保存服务器当前 `index.html`、`viewer.css`、`viewer.js`、`workbench.js` 的可恢复备份；再只更新这些文件，不改中继代码、Nginx、systemd、Docker 或其它站点。
  - 允许范围：服务器 `/opt/screenbridge/server/public/` 中上述四个文件及其专属备份目录。
  - 主验证：部署后 HTTPS 页面和四项静态资源返回 200，`/healthz` 返回 200，远端资源校验值与本地一致。
  - 必需验收：备份存在且可读；页面资源校验一致；健康接口可用；失败时恢复备份。
  - 验证：使用 `/opt/screenbridge/server/backups/web-workbench-20261011-1535/predeploy.tar.gz`；归档包含四个目标文件，且更新前归档哈希与线上现有文件一致。只替换四项静态资源；部署后 `/`、`/view`、CSS、两个脚本及 `/healthz` 全部 HTTP 200，公网资源哈希与本机相同，专属服务保持 active。
  - 手动验收：optional（在实际模型下追问并在平板选中文字）。
  - 依赖：`6.1`、`6.2`。

## 后续迭代：网页配对会话恢复（iteration 7）

### 范围锁

- 目标：网页刷新、重新打开或短暂网络断开后，使用原浏览器恢复凭据重连已在线采集电脑；不要求电脑端重新创建配对码。
- 非目标：桌面端改动、配对码重复加入、恢复凭据跨浏览器同步、中继重启后恢复房间、改动 Nginx/Docker/其它站点或 systemd unit。
- 允许范围：`server/relay.js`、`server/public/index.html`、`server/public/viewer.js`、`server/test/relay.test.js`、`server/test/viewer.test.js`、本 iteration 的 OpenSpec 文档；线上仅更新 `/opt/screenbridge/server/relay.js`、`/opt/screenbridge/server/public/index.html`、`/opt/screenbridge/server/public/viewer.js` 并重启专属 `screenbridge-relay.service`。
- 安全边界：只在浏览器本地保存 256 位随机恢复令牌；中继仅存哈希；短配对码只能首次加入；令牌仅恢复同一 active room；手动断开撤销房间；采集端停止/断开和中继重启使令牌失效；同一时刻只保留一个查看 WebSocket。
- 部署授权：用户于 2026-10-12 明确要求“部署到线上”。
- 回滚：从本次专属归档只恢复上述三个目标文件，重启 `screenbridge-relay.service`，再检查服务状态、HTTP 健康接口和目标文件哈希；不触碰 Nginx、Docker、其它站点或 systemd unit。服务重启会结束活动配对，用户需重新配对。

### 任务

- [x] **7.1** [DONE] 为首次查看端配对发放单独恢复凭据，并支持认证恢复。
  - 完成条件：首次成功加入返回 256 位随机令牌；中继仅存令牌哈希；恢复需匹配原房间、有效令牌和在线采集端；短配对码不能重复加入；失败尝试受限流保护。
  - 允许文件：`server/relay.js`、`server/test/relay.test.js`。
  - 主验证：`node --test server/test/relay.test.js`。
  - 必需验收：错误令牌不影响当前配对；有效令牌仅恢复其对应房间；源码不保存明文恢复令牌。
- [x] **7.2** [DONE] 让网页持久保存恢复凭据并自动恢复连接。
  - 完成条件：当前浏览器本地保存令牌；首次连接后刷新/重新打开可自动恢复；网络关闭时退避重试，网络恢复时尽快重连；手动断开清除令牌并结束会话。
  - 允许文件：`server/public/index.html`、`server/public/viewer.js`、`server/test/viewer.test.js`。
  - 主验证：`node --test server/test/viewer.test.js`。
  - 必需验收：测试验证首次保存、页面重建后的恢复握手和手动断开的清理行为。
- [x] **7.3** [DONE] 完成全量回归并处理独立只读审查发现。
  - 完成条件：所有测试/语法检查通过；确认旧连接迟到 close 不撤销新连接，错误凭据不影响现有会话，采集端停止会撤销令牌；独立审查认证/会话风险达到 `pass` 或明确记录阻塞。
  - 允许文件：本迭代范围内的代码、测试与 OpenSpec 文档。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；`git diff --check`。
  - 必需验收：完成独立只读审查；若修复后无法重新审查，明确记录复审状态；不部署公网。
  - 验证：语法检查通过；`npm.cmd test` 23/23 通过；`git diff --check` 通过。初审发现旧 source/viewer socket 的迟到命令、临时恢复错误误清凭据和网页旧 socket 回调污染新会话；均已修复并有回归测试。修复后独立只读复审 `pass`；另记录极少见的旧截图 FileReader 异步完成后仍可能加入新截图列表，不影响配对认证/恢复。

- [x] **7.4** [DONE] 备份并部署网页配对自动恢复。
  - 完成条件：单独备份三个精确目标文件；暂存文件哈希与本地一致；服务器 Node 运行时语法检查通过；替换后专属服务 active，HTTPS 页面资源及 `/healthz` 正常，公网 WSS 首次配对和恢复握手通过；失败时能仅恢复该备份。
  - 允许范围：服务器 `/opt/screenbridge/server/relay.js`、`/opt/screenbridge/server/public/index.html`、`/opt/screenbridge/server/public/viewer.js` 及专属备份目录；允许重启 `screenbridge-relay.service`。不得改动 Nginx、Docker、其它站点或 systemd unit。
  - 主验证：服务器 `/healthz`、`/`、`/viewer.js` 的 HTTP 状态和内容哈希；公网 WSS 临时配对、断开后 resume；服务状态与备份内容检查。
  - 必需验收：代码只读复审 `pass`；部署评审 `pass`；部署后文件哈希与工作区一致；若失败，精确回滚并验证健康状态。
  - 手动验收：optional（实际用户网页刷新和 Windows 采集端长连接）。
  - 依赖：`7.1`、`7.2`、`7.3`。
  - 验证：代码与部署范围只读独立评审均为 `pass`；三文件备份已验证且首次命令错误时精确回滚成功；修正临时文件后部署成功，正式文件 SHA-256 与本机一致，服务 active，公网六个路径均 200；公网 WSS 首次配对、断开后保留采集端、恢复握手、恢复后的配置/测试帧往返、主动断开撤销旧令牌均通过，临时配对已清理。实际用户浏览器手验为 optional，尚未执行。

## 后续迭代：手动选择模型（iteration 8）

- 范围锁：见 proposal 的 iteration 8；本轮允许网页、桌面和请求入口修改，沿用既有配置结构；前一轮聊天框解锁需求已被用户取消，不实施。

- [x] **8.1** [DONE] 分析与追问按用户所选模型发送。
  - 完成条件：两个界面均有视觉/对话模型选择；只调用选中模型；配置同步后仍可选；已有对话和配置不被选择操作改写；旧优先级不再自动触发顺延。
  - 允许文件：proposal 的 iteration 8 范围。
  - 主验证：`node --test server/test/viewer.test.js`；工作区没有独立的 `test/model-selection.test.js`。
  - 必需验收：API 测试覆盖显式选用追问模型、请求失败不顺延及被删除的 ID 不回退到默认模型；Chrome 模拟验证网页分析与追问携带所选 ID、保留对话历史且同步刷新后保留有效选择；代码自审确认删除所选项后回到新默认项，生成中锁定选择且停止后恢复。
  - 手动验收：optional（真实供应商凭据与用户设备）。
  - 依赖：无。
- [x] **8.2** [DONE] 完成语法、回归、响应式验证与有界差异自审。
  - 完成条件：`npm.cmd run check`、`npm.cmd test`、`git diff --check` 通过；桌面/平板/手机模型选择布局和交互经过验证，或如实记录工具限制；自审无阻断项。
  - 允许文件：同 8.1 及相应验证/checkpoint 文档。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；`git diff --check`；本机浏览器模拟模型与同步配置交互。
  - 必需验收：自动化验证及自审终态为 pass；响应式验证覆盖 390px 手机宽度；实际平板、Windows Electron、真实模型和未执行的部署不写为已完成。
  - 手动验收：optional（Windows 新安装包、实际模型和平板操作）。
  - 依赖：`8.1`。
- [x] **8.3** [DONE] 备份并部署网页手动选模功能。
  - 完成条件：备份服务器当前四个工作台静态文件并验证归档可读；暂存文件与本机哈希一致；只替换 `index.html`、`viewer.css`、`viewer.js`、`workbench.js`；公网页面、资源与 `/healthz` 正常；失败时可精确恢复备份。
  - 允许范围：远端 `/opt/screenbridge/server/public/` 中上述四个文件及专属备份目录；不重启服务，不触碰 `relay.js`、Nginx、Docker、systemd 或其它站点。
  - 主验证：部署前后文件哈希；HTTPS `/`、`/view`、四个静态资源和 `/healthz`；服务状态。
  - 必需验收：独立只读发布范围评审 `pass`；备份、静态文件哈希及线上 HTTP 检查 `pass`；异常时恢复原四个文件并复核。
  - 手动验收：optional（在真实浏览器中连接采集端后实际切换模型）。
  - 依赖：`8.1`、`8.2`。
  - 验证：部署前归档仅含四个目标文件且可读；暂存及正式文件 SHA-256 与本机一致；`/`、`/view`、CSS、两个脚本和 `/healthz` 均 HTTP 200；`screenbridge-relay.service` active，未重启中继。
- [x] **8.4** [DONE] 构建桌面端 0.4.3 Windows 安装包。
  - 完成条件：`package.json` 与锁文件版本一致为 0.4.3；`npm.cmd run dist` 成功生成 x64 安装程序和 ZIP，且旧版本产物保留；归档包含当前主进程和渲染界面。
  - 允许文件：`package.json`、`package-lock.json`、本机 `dist/` 发行产物和相应验证文档。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；`npm.cmd run dist`；检查 `app.asar` 中版本及模型选择界面资源。
  - 必需验收：构建退出码为 0；0.4.3 安装程序及 ZIP 存在且归档内容为本轮代码；0.4.2 现有产物未覆盖。
  - 手动验收：optional（Windows 实机安装、签名和模型请求）。
  - 依赖：`8.1`、`8.2`。
