# 验证：公网配对采集与浏览

**检查修订：** `工作区（iteration 5 配置同步修复）；公网 relay.js SHA256 8cd94914240b8ff71358096fa091d023cce1ba5d87eaad20d6828dcdde4e3d11`
**总体状态：** blocked（历史真实浏览器手验仍未完成；iteration 5 部署验收通过）
**评审状态：** iteration 5 pass；历史风险评审记录仍有 blocked 项

## 需求覆盖

| 任务 | 需求/场景 | 当前证据 | 结果 |
| --- | --- | --- | --- |
| `1.1` | 中继鉴权、时效、限流、隔离与无持久化 | 本机及服务器 6 项测试通过；公网 HTTPS/WSS 客户端冒烟覆盖配对、认证、帧转发、停止撤销；真实浏览器与 Electron 截图往返未做 | blocked：required 手验未完成 |
| `1.2` | Electron 出站连接与按需采图 | `npm.cmd run check` 通过；默认中继指向公网域名；真实桌面按钮与截图流程未做 | blocked：required 手验未完成 |
| `1.3` | TLS 部署及现有站点兼容 | 服务和续期定时器已启用；HTTPS/WSS 公网协议测试通过；Nginx reload 后配置正常；既有站点没有变更，单一现有站点根路径返回 403 且无部署前基线 | blocked：真实浏览器手验、回滚验证及独立评审未完成 |

## 运行账本

| # | 任务 | 阶段 | 目的 | 代码修订 | 命令/动作 | 结果 | 下一步 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `1.1` | baseline | 核验现有桌面端语法 | `6a63333 + 工作区` | `npm run check`（前一任务同修订实测） | pass：主进程、预加载、渲染脚本语法通过 | 实现中继协议和测试 |
| 2 | `1.3` | discovery | 只读核验服务器冲突面 | `6a63333 + 工作区` | SSH 只读检查 Docker、监听端口、系统服务、现有 Nginx 站点 | pass：已有 Nginx 占用 80；Docker 有三个既有容器；443 空闲；TLS 域名尚未确认 | 使用独立入口，任何现有站点变更前再次检查配置 |
| 3 | `1.1` | task | 验证配对服务与桌面端语法 | `6a63333 + 工作区` | `npm.cmd run check`；`npm.cmd test`；`git diff --check` | pass：语法、差异与 4 项服务协议测试均通过 | 完成桌面端 UI/IPC 集成和实机配对 |
| 4 | `1.3` | deployment | 上线 HTTPS/WSS 中继 | `server/relay.js` SHA256 `880f56d0...79f42b7a` | Let's Encrypt HTTP-01；Nginx `-t` 与平滑 reload；`screenbridge-relay.service`、`screenbridge-cert-renew.timer`；公网 `/healthz`、HTTP 跳转、WSS 往返 | pass：证书有效至 2027-01-08；HTTPS 200、HTTP 301；WSS 配对/认证/帧转发/停止撤销通过；中继服务仅监听 `127.0.0.1:3086` | 完成实际桌面端取图手验 |
| 5 | `1.1` | hardening | 限制未认证连接并保持采集重连可用 | `server/relay.js` SHA256 `880f56d0...79f42b7a` | 新增 idle WebSocket 并发/频率限制及测试；`npm.cmd run check`；`npm.cmd test`；服务器 Node 22 `--test` | pass：6/6 测试通过；默认总连接上限 512，单 IP 升级尝试限流；查看码限流不再阻止采集端重连 | 等待 required 手验 |
| 6 | `1.3` | renewal | 验证自动续期配置 | 同上 | `certbot renew` 服务成功返回；`certbot renew --dry-run` 首次失败一次，复核多个公共解析器及权威 NS 后再次执行 | pass：第二次 staging 演练全部成功；两次演练间出现一次暂时 DNS SERVFAIL，当前多个公共解析器均返回目标 A 记录 | 保留定时器并监控续期日志 |

## 评审

- 终态：blocked
- 修订/时间：`6a63333 + 工作区`；主代理只读自审已修复连接上限和错误限流，2026-10-10
- 阻塞项：当前协作模式禁止委派，无法完成高风险所需的独立上下文审查；Windows 自动化助手启动两次失败，未完成浏览器/桌面实机验收。

## 已知缺口和后续工作

- `certbot renew --dry-run` 第一次遇到 Let's Encrypt 二次验证 DNS SERVFAIL；复核权威 DNS 与 1.1.1.1、8.8.8.8、9.9.9.9、114.114.114.114 后第二次演练通过。续期定时器 active/enabled；未提供通知邮箱，因此续期失败不会发送邮件提醒。
- 本机已有 Electron 主进程在本次 main.js 更新前启动；为避免关闭用户窗口导致未保存内容丢失，没有强制重启。须重启后再做界面验收。
- 既有 `newapi.zahml.top` 本机 Host 抽查返回 403；没有部署前基线，不能仅凭此断定回归。其站点配置未改动；Nginx 配置测试和平滑重载通过，Docker 容器未操作。
- SSH 凭据曾出现在用户聊天中；提醒用户立即轮换 root 密码。

## 浏览器工作台（iteration 2）

| 任务 | 当前证据 | 结果 |
| --- | --- | --- |
| `2.1` | 本机 `npm.cmd run check`、`npm.cmd test`（6/6）和 `git diff --check` 通过；Chrome 本地模拟验证配对、多张截图、设置保存边界、模拟流式分析/追问、提示词预设及 390px 窄屏布局 | pass；真实模型凭据未测试 |
| `2.2` | 服务器先备份旧 `relay.js` 与 `public/`，再更新完整工作台；公网 `/`、`/view`、`/viewer.css`、`/viewer.js`、`/workbench.js`、`/healthz` 均返回 HTTP 200；资源大小与本机文件一致 | deployed；通过公网浏览器实际点选并配对取图的人工验收仍待完成 |

## iteration 2 部署与回滚

- 部署前备份：`/opt/screenbridge/server/backups/browser-workbench-20261010-1/predeploy.tar.gz`，包含更新前的 `relay.js` 与 `public/`。
- 部署后的中继 SHA256：`a578a60a2cff72e145d196bb181a955681aefb847c63f27f9c9800c9a87f0a94`；暂存版本语法检查通过，部署后健康接口正常。
- 回滚步骤：停止 `screenbridge-relay.service`，在 `/opt/screenbridge/server` 解压上述 `predeploy.tar.gz`，再启动该服务；不需要改动 Nginx、Docker 或其他站点。
- 本地完整界面检查使用模拟采集端和模拟模型服务；未用真实模型凭据验证。尝试打开公网页面的桌面浏览器自动化组件初始化失败（系统找不到指定路径），因此没有完成公网界面人工点选验收。
- 登录服务器时 SSH 登录横幅报告有 8 次失败尝试；root 密码曾出现在聊天中，需尽快轮换。

## 长时间配对会话（iteration 3）

| 检查项 | 证据 | 结果 |
| --- | --- | --- |
| 15 分钟仅限制首次连接 | `npm.cmd test`：活动配对超过测试 TTL 后仍能请求并接收截图；未配对房间仍按 TTL 清理 | pass |
| 长时间空闲连接 | 服务器每 25 秒发送 WebSocket ping；自动 pong 的源端和查看端在多次心跳后仍处于 OPEN | pass（本机协议测试） |
| 断开即撤销 | `npm.cmd test`：采集端或查看端关闭后，对端被关闭，房间及旧配对码删除 | pass（本机协议测试） |
| 语法与发行构建 | `npm.cmd run check`、`npm.cmd test` 9/9、`npm.cmd run dist` | pass；产物 0.4.1 x64 安装程序和 ZIP；安装程序没有数字签名 |
| 公网状态 | `https://screenbridge.zahml.top/healthz` 返回 200；检查线上首页仍显示旧版说明 | 线上旧版本健康，iteration 3 尚未部署 |
| SSH 部署 | 批处理公钥认证被拒绝；一次密码认证也被拒绝。为避免触发登录保护，停止继续尝试 | blocked；临时部署公钥在 `dist/screenbridge-deploy-20261011.pub`，需由用户通过服务器控制台加入 root 的 `authorized_keys` |

本地生成的部署私钥保存在 `%USERPROFILE%\.ssh\screenbridge-deploy-20261011`，仅用于用户授权后继续部署；部署完成后应删除私钥。当前仍缺公网真实浏览器长连接验收和不同上下文独立审查，不能把这些审查标为通过。

## 采集端完整配置同步（iteration 4）

| 检查项 | 证据 | 结果 |
| --- | --- | --- |
| 公网完整配置转发 | `server/test/relay.test.js` 的完整配置测试发送 API 地址、协议、API Key、代理、模型、预设、优先级、启用状态、系统提示词和回答/追问预设，并验证查看端收到原值 | pass；同房间更新可达，另一房间未收到消息 |
| 超大配置保护 | `server/test/relay.test.js` 的超大配置测试 | pass；中继拒绝超过配置大小上限的消息 |
| 局域网持续同步 | `server/public/workbench.js` 的带 session、地址和 token 校验的 `/config` 轮询；连接时立即读取，约 1.5 秒检查变化 | pass；旧请求不能覆盖新连接，变化才应用 |
| 连接生命周期 | `server/public/viewer.js` 清除运行时配置并在断开后恢复浏览器本地配置；工作台在运行时配置存在时锁定设置写入 | pass；API Key 不写入网页本地存储 |
| 本机验证 | `npm.cmd run check`；`npm.cmd test`；`node --check server/public/workbench.js`；`node --check server/public/viewer.js`；`node --check server/relay.js`；`git diff --check` | pass；11/11 测试通过 |

本次未执行公网部署或真实浏览器/桌面端人工验收；历史公网部署仍按 iteration 3 的 blocked 状态记录。

## iteration 5：上线完整配置同步

| 检查项 | 证据 | 结果 |
| --- | --- | --- |
| 修复网页本地密钥恢复 | `server/test/viewer.test.js` 模拟保存仅驻内存的网页 API Key、应用采集端配置并断开，再读取本机配置 | pass；本机临时 Key 保留且采集端配置断开后清除 |
| API 协议一致性 | `server/test/viewer.test.js` 覆盖 `right.codes`、`right.ai`、`rightapi.ai` 及其 `www` 子域 | pass；Responses 设置按桌面端规则请求 Chat Completions |
| 本机检查 | `npm.cmd run check`；`npm.cmd test`；`git diff --check` | pass；13/13 测试通过 |
| 独立只读审查 | 当前工作区配置同步代码与部署范围 | pass；修复前发现的两项问题已关闭；未改文件、未部署 |
| 公网预检 | `https://screenbridge.zahml.top/healthz` 和首页；SSH 公钥只读连接；远端文件 SHA-256 与本地比较 | SSH 可访问；服务 active，HTTP 200；线上 `relay.js` 与网页脚本哈希仍是旧版，未部署 |
| Windows 安装包 | `npm.cmd run dist`；检查生成的 ZIP、安装程序与 Authenticode 签名状态 | pass；x64 ZIP（117,621,924 字节）和安装程序（84,192,354 字节）已生成；安装程序未数字签名 |
| 部署前备份 | SSH 在 `/opt/screenbridge/server/backups/config-sync-20261011-1/predeploy.tar.gz` 打包线上 `relay.js` 与 `public/`，并执行 `tar -tzf` | pass；备份 SHA-256 `badd0d13fb29406a3e2ced7fa9cdda18c974b13ee1c3a0c75105c90871d6f423` |
| 暂存文件校验 | 五个目标文件经 SCP 上传到备份目录 `incoming/`；用服务器 Node 22 检查 `relay.js` 并比较 SHA-256 | pass；五个文件均与本地校验值一致 |
| 首次替换与回滚 | 远端自动回滚脚本恢复服务文件后检查 SHA-256、systemd 状态、本机 `/healthz` 与公网 `/healthz` | 自动回滚成功；立即探测早于 Node 监听就绪，已确认旧版文件恢复、服务 active、本机和公网均 HTTP 200；重试改用有界等待 |
| 局域网传输限制 | 只读审查 `/config` 实现 | 限制：局域网配置使用 HTTP，网络内监听者可能获取配对码与 API Key；公网 WSS 使用 TLS。仅在可信局域网使用 |
| 正式部署 | 远端有界就绪探测、systemd 状态及五个线上文件 SHA-256 | pass；`screenbridge-relay.service` active；部署文件与本地一致；独立备份保留在 `/opt/screenbridge/server/backups/config-sync-20261011-1/predeploy.tar.gz` |
| 公网 HTTPS 页面与资源 | `/`、`/view`、`/healthz` 和三个静态资源；下载字节 SHA-256 与本地比较 | pass；全部 HTTP 200；CSS、查看脚本和工作台脚本校验值匹配 |
| 公网 WSS 配置转发 | 创建一次性配对，认证采集端、加入查看端并发送测试配置 | pass；系统提示词、预设文字及测试用 API Key 字段抵达对应查看端 |

线上部署和 Windows 安装包构建已完成。真实 Windows 安装及真实模型请求仍未执行，属于可选手动验收。

## iteration 6：答案选区预览、截图栏清理与追问修复

| 检查项 | 证据 | 结果 |
| --- | --- | --- |
| Responses API 历史消息 | `node --test server/test/viewer.test.js`；请求包含用户文本、助手回答及用户追问，并附带一张截图 | pass；用户消息为 `input_text`，助手回答为 `output_text`，附图为 `input_image`；请求发送到 `/responses` |
| HTTP 400 诊断 | 同一测试文件模拟模型服务 HTTP 400 | pass；状态码、状态文字及响应正文继续显示 |
| 本机语法与全量测试 | `npm.cmd run check`；`npm.cmd test` | pass；语法检查通过，17/17 测试通过 |
| 差异格式 | `git diff --check` | pass；无空白错误（Git 仅提示工作区 LF 文件可能转换为 CRLF） |
| OpenSpec 校验器 | 检查 `node_modules/.bin/openspec.cmd` 与 PATH 中的 `openspec` | unavailable；仓库未安装 CLI，保留变更文档，未运行归档命令 |
| 公网更新 | `/opt/screenbridge/server/backups/web-workbench-20261011-1535/predeploy.tar.gz`（已验证可读并包含四个目标文件）；部署后检查 `/`、`/view`、`/viewer.css`、`/viewer.js`、`/workbench.js`、`/healthz` 及公网资源 SHA-256 | pass；全部 HTTP 200，四个文件哈希与本机一致，`screenbridge-relay.service` 为 active |
| 人工浏览器验收 | 平板/桌面选区放大与实际模型连续追问 | optional；本轮尚未执行 |

## iteration 7：网页配对会话恢复

| 检查项 | 证据 | 结果 |
| --- | --- | --- |
| 恢复凭据签发和保存 | `server/relay.js` 首次加入返回 32 字节随机令牌，中继房间保存 SHA-256 哈希；网页通过同浏览器 `localStorage` 持有凭据 | pass；凭据不放 URL，用户手动断开会清除本地值并结束房间 |
| 中继恢复与断连边界 | `node --test server/test/relay.test.js` | pass；13/13；断线后房间保留、短配对码被拒、错误令牌不影响当前端、同令牌可替换旧查看连接并继续取图、采集端停止后令牌失效 |
| 网页重载和网络重试 | `node --test server/test/viewer.test.js` | pass；5/5；刷新页自动发起恢复认证、网络断开按退避重试、旧标签页不会抢回连接、手动断开清除凭据 |
| 全量语法和回归 | `npm.cmd run check`；`npm.cmd test`；`git diff --check` | pass；语法通过，23/23 测试通过，差异检查通过 |
| 初次独立只读审查 | 审查认证、会话替换、恢复令牌失效路径 | failed；发现替换 socket 的迟到消息可影响新会话，以及限流错误可能清除有效令牌 |
| 审查问题修复 | relay 与网页 socket 回调校验当前连接；仅明确失效错误清理凭据；新增迟到消息回归测试 | pass；独立只读复审确认无阻止部署的认证/会话问题；记录旧截图 FileReader 异步边界为非阻断项 |
| 部署前连通性 | SSH 公钥只读连接；`systemctl is-active screenbridge-relay.service`；`https://screenbridge.zahml.top/healthz` | pass；SSH 可用、服务 active、HTTPS 返回 200；使用服务专属 Node `/opt/screenbridge/node/bin/node` |
| 部署前哈希 | 本地 `Get-FileHash` 与线上 `sha256sum` | pass；已记录三文件线上旧哈希，均与待部署本地文件不同 |
| 独立部署范围评审 | 三文件精确更新、专属服务重启、内存配对失效说明和回滚步骤 | pass；沿用已完成的只读独立评审，未扩展至 Nginx、Docker、其它站点或 systemd unit |
| 三文件专属备份 | `/opt/screenbridge/server/backups/web-pair-recovery-20261012-1/predeploy.tar.gz`；`tar -tzf` 和逐文件内容哈希 | pass；仅含 `relay.js`、`public/index.html`、`public/viewer.js`；归档 SHA-256 为 `37ad8e97d26e8378dcdfff7f6788b25ff008290fcd72911bd95ab7fa537f3d8b`，内部文件哈希与部署前线上一致 |
| 上传暂存校验 | SCP 上传到专属备份目录 `incoming/`；服务器 `sha256sum` 和 `/opt/screenbridge/node/bin/node --check` | pass；三个文件与本机一致，暂存 `relay.js` 语法检查通过 |
| 首次部署与精确回滚 | 二次语法检查使用 `.deploy` 后缀，Node 22 返回 `ERR_UNKNOWN_FILE_EXTENSION`；ERR trap 恢复三文件备份并启动专属服务 | 回滚通过；三个旧哈希恢复，服务 active，服务器 `/healthz` 返回 200；尚未替换正式文件就触发回滚，随后改用 `.js` 临时文件名 |
| 正式替换和就绪探测 | 使用 `.js` 临时文件校验后原位替换；重启 `screenbridge-relay.service` 并有界等待本机 `/healthz` | pass；服务 active，健康返回 200，三个正式文件哈希与工作区一致；临时文件已清理 |
| 公网 HTTP 验证 | HTTPS `/`、`/view`、`/viewer.js`、`/viewer.css`、`/workbench.js`、`/healthz`；页面和新脚本逐字节 SHA-256 | pass；全部 200；首页和 `/view` SHA-256 为 `f6f47037493babffdcf89feb11da7a8638e2d37d348c83968824951891627697`，`viewer.js` 为 `9db5591aa8803707f5ba2101ade6162cc336693daf5610727d9713d5975b3921`；中继 SHA-256 为 `f9f7c105e879cac73c4c95f78c5b30a3f5fce76bceb53e89b6b42b1ae2983e46` |
| 公网 WSS 配对与恢复 | 本机 Node 经 HTTPS 创建临时配对；经 WSS 认证采集端、首次加入、关闭查看连接后以恢复凭据续接 | pass；首次配对成功，查看端断开时采集连接保持 OPEN，恢复握手返回 `resumed: true`；恢复凭据与配对密钥未输出 |
| 恢复后的配置与取图 | 同一临时采集连接发送无密钥测试配置；恢复后的查看端请求并接收二进制测试帧 | pass；配置经 `source-config` 转发，画面元数据字节数与测试帧一致，二进制内容往返一致；为协议冒烟检查，未采集用户真实屏幕 |
| 主动断开与测试清理 | 恢复查看端发送 `disconnect`，观察双方关闭并再次尝试恢复旧令牌 | pass；双方连接关闭、旧令牌被拒，全部临时 WebSocket 已关闭 |
| 部署后最终状态 | `systemctl is-active`、服务器 `/healthz`、三个正式文件的 `sha256sum` | pass；服务 active、健康正常，三个部署哈希保持与本机一致；未提交或推送工作区 |
| 实际浏览器与 Windows 手验 | 实际网页刷新与采集端长连接 | optional；本轮未执行，既有自动化组件不可用；自动化网页生命周期测试和公网 WSS 协议验证已通过 |

- `recovery_violation`：恢复摘要未包含 WSS 冒烟脚本和协议消息细节，补充读取了当前任务涉及的中继协议、测试辅助函数和运行时配置；读取限定在本次部署范围，没有重跑已通过且代码未变的本机测试。

## iteration 8：对话时手动选择模型

| 检查项 | 证据 | 结果 |
| --- | --- | --- |
| 请求使用指定模型 | `server/test/viewer.test.js` 覆盖追问指定 `chat-fast`、保留历史消息、请求失败不顺延及已删除 ID 不落到默认模型；网页 Chrome 模拟覆盖截图分析和追问发送所选预设 ID | pass；单次请求仅调用一个模型，选中项失效时提示重新选择 |
| 配置同步与选择状态 | 本机 Chrome 模拟模型 API，更新采集端配置后检查仍存在的选择 | pass；网页保留有效选择；被删选择由代码路径回到当前默认项 |
| 交互与响应式 | 检查生成期间的禁用状态、停止后的状态恢复；Chrome 390px 视口 | pass；生成时不能切换，停止后恢复；无横向溢出且选择框留在视口内。真实平板及 Windows Electron 未手验 |
| 截图/对话上下文自审 | 对比网页 `workbench.js` 的截图来源、附图条件及追问历史构造差异 | pass；选模改动只传所选 `presetId`，未改写本轮截图保留、可选附图和既有对话历史行为 |
| 全量本机验证 | `npm.cmd run check`；`npm.cmd test`；`git diff --check` | pass；语法检查通过，26/26 测试通过，差异检查通过 |
| 发布状态 | 网页部署、Windows 安装包构建及真实供应商请求 | pass；网页部署及安装包构建见下方发布记录；真实供应商模型请求未执行 |

自审结论：iteration 8 本机实现与验证通过。实际平板、Windows Electron 和真实供应商模型验收未执行。

## iteration 8 发布与打包（2026-10-16）

| 检查项 | 证据 | 结果 |
| --- | --- | --- |
| 版本号 | `package.json`、`package-lock.json` 与 `app.asar/package.json` | pass；均为 0.4.3 |
| Windows 安装包构建 | `npm.cmd run dist -- --config.directories.output=dist/release-0.4.3 --publish never` | pass；退出码 0，生成 x64 安装程序（84,192,957 字节）和 ZIP（117,622,589 字节） |
| 安装包内容及旧产物保护 | 从 `dist/release-0.4.3/win-unpacked/resources/app.asar` 读取版本和渲染脚本；检查 ZIP 条目及 `dist/` 根目录 0.4.2 文件 | pass；归档含模型选择器与所选预设请求字段；新产物隔离保存，0.4.2 安装程序与 ZIP 保持原时间戳和大小 |
| 数字签名 | `Get-AuthenticodeSignature` 检查 0.4.3 安装程序 | not signed；Windows 可能显示 SmartScreen 提示 |
| 发布前只读审查 | 独立上下文检查选模、配对恢复协议兼容、静态部署范围和 0.4.3 输出目录 | pass；无剩余 P0/P1/P2；线上 `relay.js` 与本地 SHA-256 相同（`f9f7c105e879cac73c4c95f78c5b30a3f5fce76bceb53e89b6b42b1ae2983e46`），无需部署中继 |
| 发布前公网状态 | SSH 只读检查专属服务状态及公网 HTTPS 首页、`/healthz` | pass；服务 active，页面及健康检查均 HTTP 200 |
| 网页静态资源更新 | `/opt/screenbridge/server/backups/model-choice-20261016-1/predeploy.tar.gz`（SHA-256 `4ee5d186541b8298fb9188aa139a2e0ff4362fe42af900475d4a0758de7455e3`）；线上及公网 SHA-256 对照；HTTPS 路径检查；专属服务状态 | pass；备份仅含四个目标文件且可读；`index.html`、`viewer.css`、`viewer.js`、`workbench.js` 的线上与公网字节均和本机一致；`/`、`/view`、四个静态资源、`/healthz` 全部 HTTP 200；`screenbridge-relay.service` active，未重启中继 |
| 实际浏览器配对验收 | 公网浏览器连接采集端并切换模型 | optional；本轮未执行；真实平板、Windows Electron 和真实模型请求也未执行 |
