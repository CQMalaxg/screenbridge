# 任务：安全的账号设备绑定与断线恢复

## 范围锁

- 目标：账号可以安全认领稳定采集设备，网页与采集端可在断线/重启后自动恢复而无需重复配对码。
- 迭代 1 非目标：生产部署和发行包；邮箱找回、团队权限、截图/配置持久化仍为非目标。
- 迭代 1 允许范围：proposal、spec 所列的服务端、桌面端、网页端代码与测试、README、verification/checkpoint。
- 迭代 2 授权范围：桌面版本号与本机 Windows 安装包/ZIP；`server/relay.js`、`server/security-store.js`、网页资源、systemd 状态目录配置及所需备份/验证。不得修改 Nginx、Docker 或其它站点，不推送安装包。
- 已知基线：0.4.3 网页与桌面模型选择已部署/打包；现有测试 26/26 通过。服务端房间仅在内存中，采集端在已配对 socket close 后清除凭据。迭代 2 用户已授权发布网页/中继和本机安装包。

## 任务

- [x] **9.1** [DONE] 实现账号会话、持久设备登记和授权边界。
  - 完成条件：密码使用 scrypt 哈希；登录 Cookie 为 Secure/HttpOnly/SameSite；写操作校验同源和 CSRF；WebSocket 校验 Origin；设备信息原子持久化且仅 owner 可连接/撤销；数据重启后可加载，截图与配置不写入。
  - 允许文件：`server/relay.js`、新增服务端模块、`server/test/relay.test.js` 和新增定向测试。
  - 主验证：`node --test server/test/relay.test.js server/test/auth.test.js`。
  - 必需验收：错误口令、跨站、速率限制、越权设备、撤销、服务重启、文件权限/只存哈希均有测试。
  - 手动验收：none。
  - 依赖：无。
- [x] **9.2** [DONE] 让桌面端安全持久化设备凭据并自动恢复。
  - 完成条件：强随机设备密钥只经 `safeStorage` 加密落盘；意外断线/应用重启/服务重启指数退避重连；同一设备码不变；明确停止/账号撤销后凭据失效；用户窗口关闭仍托盘运行，Windows 登录后自动启动可配置。
  - 允许文件：`main.js`、`preload.js`、`renderer/index.html`、`renderer/renderer.js`、相关 CSS/测试、`package.json`（若确有必要）。
  - 主验证：`npm.cmd run check`；新增主进程逻辑的可注入单元测试或有界 IPC 状态测试。
  - 必需验收：持久化凭据无明文；过期/撤销/网络错误分支可区分；重试有上限退避和随机抖动。
  - 手动验收：optional（Windows 登录启动、托盘退出、休眠唤醒）。
  - 依赖：`9.1`。
- [x] **9.3** [DONE] 网页账号登录、设备列表和自动连接。
  - 完成条件：登录/注册/退出；登录后列出所属设备、连接/断开/撤销；首次配对码绑定账号；登录后自动恢复上次设备，换同账号浏览器也无需重输配对码。
  - 允许文件：`server/public/index.html`、`viewer.css`、`viewer.js`、`server/test/viewer.test.js`。
  - 主验证：`node --test server/test/viewer.test.js server/test/auth.test.js`。
  - 必需验收：Cookie/CSRF 请求行为、跨账号拒绝、页面刷新自动恢复、源端离线等待/上线恢复、手动撤销需重新绑定均有测试或静态 UI 交互证据。
  - 手动验收：optional（浏览器两账号及两个不同浏览器登录连接）。
  - 依赖：`9.1`。
- [x] **9.4** [DONE] 完成安全自审、全量回归并记录未部署状态。
  - 完成条件：认证与设备密钥风险面各有一次独立只读评审终态；`npm.cmd run check`、`npm.cmd test`、`git diff --check` 通过；README/部署说明明确状态目录及维护步骤；没有生产文件/服务操作。
  - 允许文件：本变更代码、测试、README、OpenSpec。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；`git diff --check`；审查 `git diff` 与 shell 历史/输出无秘密。
  - 必需验收：评审 `pass`；`git status` 证明仅工作区改动；线上服务未被探测/修改。
  - 手动验收：none。
  - 依赖：`9.1`、`9.2`、`9.3`。

## 迭代 2：本机打包与线上发布

- [x] **10.1** [DONE] 升级桌面版本并生成本机安装包。
  - 完成条件：版本升至 `0.4.4`；生成隔离保存的 x64 NSIS 安装程序和 ZIP；检查归档含当前桌面恢复逻辑，旧版产物不覆盖。
  - 允许文件：`package.json`、`package-lock.json`、本机 `dist/release-0.4.4/` 产物。
  - 主验证：`npm.cmd run check`；`npm.cmd test`；`npm.cmd run dist -- --config.directories.output=dist/release-0.4.4 --publish never`。
  - 必需验收：版本/归档内容一致，构建成功，旧版发行物保留。
  - 手动验收：optional（Windows 安装/升级和启动）。
  - 依赖：`9.1`、`9.2`、`9.3`、`9.4`。
- [x] **10.2** [DONE] 备份并发布线上网页、中继和持久化目录配置。
  - 完成条件：先备份目标服务文件、systemd unit 和现有认证状态；账号状态目录 `/var/lib/screenbridge` 属于服务账号且为 `0700`；unit 指定状态目录且只允许该目录写入；新中继代码和网页资源原子替换并重启，部署文件权限显式设为 `0644`；失败时停止服务，恢复旧 `relay.js`、四个网页文件和 unit，移除旧版原先不存在的 `security-store.js`，保留新状态目录和其中认证数据。
  - 允许文件：线上 `/opt/screenbridge/server/relay.js`、`security-store.js`、`public/` 指定资源、`/etc/systemd/system/screenbridge-relay.service`、`/var/lib/screenbridge`；本地对应源文件及部署记录。
  - 主验证：上传归档 SHA-256 与本机一致；暂存中继脚本 `node --check`；`systemd-analyze verify`、服务状态、HTTPS `/healthz`、网页关键资源哈希、账号未登录端点、状态目录属主/权限。
  - 必需验收：备份可读且哈希匹配；服务 active；公网页面和健康接口返回成功；代理继续只信任回环；不触碰 Nginx、Docker、其它站点或 Git 远端。
  - 手动验收：optional（新账号首次注册、首次设备绑定及断线恢复）。
  - 依赖：`10.1`。
