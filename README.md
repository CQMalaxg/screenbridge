# 屏桥 ScreenBridge

屏桥是一个 Windows 桌面端局域网屏幕助手：一台电脑共享屏幕，另一台电脑实时查看远程画面，并可一键截图发送给支持视觉输入的 LLM。

适合用于模拟面试、培训、演示和经过允许的无障碍辅助场景。

## 功能

- 单机屏幕截图与视觉模型分析
- 两台电脑局域网屏幕共享
- 配对码保护的远程画面访问
- 一键“截图并分析”
- 流式回答和 Markdown 渲染
- 支持 Responses API 和 Chat Completions
- 支持 OpenAI 兼容服务，例如 Right.ai

## 环境要求

- Windows 10 或更高版本
- Node.js `22.12.0` 或更高版本
- 两台电脑模式需要处于同一个局域网

## 安装与启动

```powershell
npm install
npm start
```

如果 PowerShell 禁止运行 npm 脚本，可以使用：

```powershell
npm.cmd install
npm.cmd start
```

## 模型配置

在 App 下方的“视觉模型”区域填写：

- API 地址：例如 `https://right.ai/grok/v1`
- API 协议：根据服务商选择 `Responses API` 或 `Chat Completions`
- 模型名称：需要支持图片输入，例如 `grok-4.5`
- API Key：云端模型通常需要；不要写入源码或提交到 Git
- HTTP 代理：如果当前网络无法访问模型服务，可填写例如 `http://127.0.0.1:7897`

程序会根据协议请求：

```text
{API 地址}/responses
{API 地址}/chat/completions
```

## 两台电脑使用

两台电脑都运行同一个 App：

1. 在题目所在电脑点击“启动共享端”。
2. 记录显示的共享地址和配对码。
3. 点击“最小化共享端”，避免把共享端窗口录进屏幕。
4. 在助手电脑的“远程屏幕”区域填写共享地址和配对码。
5. 点击“连接远程屏幕”。
6. 看到远程画面后，点击“截图并分析”。

共享端默认使用 `8765` 端口，Windows 防火墙首次运行时需要允许专用网络访问。

当前远程预览使用局域网 JPEG 帧，刷新间隔约为 400～500ms。它适合题目查看和截图分析，不是低延迟视频会议方案。

## 隐私与安全

- 截图只在点击“截图并分析”后发送给配置的模型服务。
- API Key 保存在本机 Electron 用户配置中，不应提交到仓库。
- 局域网共享使用 HTTP 和配对码，只建议在可信局域网使用。
- 不要上传包含真实姓名、账号、公司机密或其他敏感信息的截图。
- 正式面试使用 AI 辅助工具前，请遵守面试方的规定。

## 开发检查与打包

```powershell
npm run check
npm run dist
```

构建产物会生成在 `dist` 目录。发布安装包时建议使用 GitHub Releases，不要把大文件直接提交到源码仓库。

## License

本项目使用 MIT License，详见 [LICENSE](./LICENSE)。
