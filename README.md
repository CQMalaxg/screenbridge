# 屏桥 ScreenBridge

屏桥是一个 Windows 局域网屏幕助手：一台电脑共享屏幕，另一台电脑查看远程画面，并可以一键截取远程画面发送给视觉模型分析。

适合用于模拟面试、培训、演示和经过允许的无障碍辅助场景。

## 下载

从 GitHub Releases 下载最新版本：

<https://github.com/CQMalaxg/screenbridge/releases>

- `屏桥 ScreenBridge Setup 0.1.0.exe`：Windows 安装包，推荐普通用户使用
- `ScreenBridge-0.1.0-win-x64.zip`：免安装便携版

安装包安装完成后，直接从开始菜单或桌面启动“屏桥 ScreenBridge”。使用安装包不需要另外安装 Node.js 或 npm。

## 功能

- 单机屏幕截图与视觉模型分析
- 两台电脑局域网屏幕共享
- 配对码保护的远程画面访问
- 一键“截图并分析”
- 流式回答和 Markdown 渲染
- 支持 Responses API 和 Chat Completions
- 支持 Right.ai 等 OpenAI 兼容接口

## 最快开始：单机模式

适合先验证模型配置和截图分析功能。

1. 启动 App。
2. 在下方“视觉模型”区域填写模型服务信息。
3. 点击“保存模型设置”。
4. 点击“截图并分析”。
5. 等待右侧回答框显示结果。

截图时 App 会短暂隐藏窗口，以避免把助手界面本身截进去，然后自动恢复。

## 双电脑局域网模式

两台电脑都需要安装并运行同一个 App。两台电脑必须连接到同一个局域网。

### 电脑 A：题目所在电脑

1. 启动“屏桥 ScreenBridge”。
2. 在“远程屏幕”区域点击“启动共享端”。
3. 记录显示的共享地址，例如：

   ```text
   http://192.168.1.20:8765
   ```

4. 记录显示的配对码。
5. 点击“最小化共享端”。

最小化共享端很重要，否则共享画面可能包含共享端自己的 App 窗口。

### 电脑 B：助手电脑

1. 启动“屏桥 ScreenBridge”。
2. 在“远程屏幕”区域填写电脑 A 显示的共享地址。
3. 填写配对码。
4. 点击“连接远程屏幕”。
5. 看到电脑 A 的画面后，点击“截图并分析”。

电脑 B 会抓取远程画面的最新帧，并将图片发送给配置的视觉模型。

## 配置视觉模型

在 App 下方的“视觉模型”区域填写：

| 配置项 | 示例 |
| --- | --- |
| API 地址 | `https://right.ai/grok/v1` |
| API 协议 | `Responses API` |
| 模型名称 | `grok-4.5` |
| API Key | Right.ai 提供的真实密钥 |
| HTTP 代理 | `http://127.0.0.1:7897`，没有代理可留空 |

程序会根据协议请求：

```text
{API 地址}/responses
{API 地址}/chat/completions
```

模型必须支持图片输入。不要把真实 API Key 写入源码、README 或提交到 Git。

## 网络与防火墙

共享端默认使用 TCP `8765` 端口。第一次启动时，Windows 防火墙可能会弹出提示，请允许“专用网络”访问。

如果助手电脑无法连接，可以在助手电脑执行：

```powershell
Test-NetConnection 192.168.1.20 -Port 8765
```

将 `192.168.1.20` 替换成电脑 A 的实际 IPv4 地址。不要使用 `127.0.0.1`，它只代表当前电脑。

常见原因：

- 两台电脑不在同一个局域网
- 使用了禁止设备互访的访客 Wi-Fi
- Windows 防火墙未允许端口 `8765`
- 填写了错误的局域网 IP 或配对码

## 常见问题

### 显示 `fetch failed`

这是模型服务无法连接。检查：

- API 地址是否为 `https://right.ai/grok/v1`
- 是否填写了真实 API Key
- 本机是否需要配置 HTTP 代理
- 浏览器或 PowerShell 是否能访问模型服务

### 显示 `401` 或 `403`

API Key 无效、过期或没有模型权限。

### 显示 `404`

API 地址、API 协议或模型名称不匹配。Right.ai 配置通常使用 `Responses API`。

### 远程画面包含共享端 App

在题目电脑点击“最小化共享端”，再重新连接或等待远程画面刷新。

## 当前限制

- 远程预览使用局域网 JPEG 帧，刷新间隔约为 400～500ms。
- 当前版本适合查看题目和截图分析，不是低延迟视频会议方案。
- 局域网传输使用 HTTP 和配对码，没有 TLS 加密，只建议在可信局域网使用。
- 当前主要面向 Windows x64。

## 从源码运行

开发环境需要 Node.js `22.12.0` 或更高版本。

```powershell
npm install
npm start
```

如果 PowerShell 禁止运行 npm 脚本，可以使用：

```powershell
npm.cmd install
npm.cmd start
```

检查代码：

```powershell
npm run check
```

构建安装包：

```powershell
npm run dist
```

构建产物会生成在 `dist` 目录。发布安装包时建议使用 GitHub Releases，不要把大文件直接提交到源码仓库。

## 隐私与使用规范

- 截图只在点击“截图并分析”后发送给配置的模型服务。
- API Key 保存在本机 Electron 用户配置中。
- 不要上传包含真实姓名、账号、公司机密或其他敏感信息的截图。
- 正式面试使用 AI 辅助工具前，请遵守面试方的规定。

## License

本项目使用 MIT License，详见 [LICENSE](./LICENSE)。
