# LifeOS AI Promotion Kit / 推广素材包

中文 | [English](#english)

## 一句话

LifeOS AI 是一个本地优先的个人 AI 管家：电脑端运行私有核心，手机端成为随身 AI 助手。

## 短介绍

LifeOS AI 把电脑端做成你的个人 AI 核心，用来连接 AI、网络、本地数据和安全设置；手机端通过 PWA 扫码绑定后，成为随时可用的私人 AI 管家。它支持 SQLite 本地存储、AI 多 provider 配置、VPN/隧道连接向导、根据当前问题自动生成解决程序、备份恢复、离线队列、设备绑定、URL Scheme 白名单和危险动作确认。

## 更完整介绍

LifeOS AI 是一个本地优先的个人 AI 管家/助手。它把“电脑端”和“手机端”分成两个角色：电脑端是私有核心，负责保存数据、连接 AI provider、管理手机设备、生成备份、做安全自检，并通过 LAN、Tailscale、Cloudflare Tunnel 或可信 HTTPS 反向代理提供连接入口；手机端是日常入口，扫码绑定后像 App 一样添加到主屏幕，用来聊天、查看连接状态、处理离线消息和确认本地动作。

它还内置 Studio 工坊：当用户遇到具体问题时，AI 可以把问题转成可运行的离线程序，用来辅助处理记账、规划、整理、打卡、计算、表单、流程面板等需求，并继续调整 HTML/CSS/JS。对于需要打开导航、网页、电话、短信、邮件、快捷指令等本地能力的动作，LifeOS AI 使用 URL Scheme 白名单、危险动作二次确认和审计日志，避免任意 scheme 注入。

## 英文短介绍

LifeOS AI is a local-first personal AI assistant. The desktop app runs the private core for AI providers, local data, device management, VPN/tunnel connectivity, generated solution apps, backups, and security; the phone connects as a paired mobile PWA companion for everyday use.

## Longer English Description

LifeOS AI is a local-first personal AI assistant with a desktop private core and a mobile PWA companion. The desktop app stores SQLite data, manages AI providers and keys, pairs phones, creates backups, runs safety checks, and helps expose the service through LAN, Tailscale, Cloudflare Tunnel, or a trusted HTTPS reverse proxy. The phone becomes the everyday assistant: chat, offline queue, device state, connection status, and local-action confirmations.

The Studio workshop turns the user's current problem into a runnable offline program. It can help with accounting, planning, organizing, habit tracking, calculators, forms, and workflow panels, then let the user refine HTML/CSS/JS. For local actions such as maps, web pages, phone, SMS, mail, and shortcuts, LifeOS AI uses a URL Scheme allowlist, dangerous-action confirmation, and redacted audit logs.

## GitHub 仓库描述

```text
Local-first personal AI assistant with a desktop private core and mobile PWA companion.
```

## GitHub Topics

```text
personal-ai
ai-assistant
local-first
pwa
electron
sqlite
desktop-app
mobile-pwa
ai-companion
privacy
tailscale
cloudflare-tunnel
generated-apps
```

## Release 标题

```text
LifeOS AI 0.1.0 - Desktop core + mobile personal AI assistant
```

## Release 描述

```markdown
LifeOS AI 0.1.0 is the first public desktop release.

LifeOS AI turns your desktop into a private AI core and your phone into an always-available personal AI assistant. The desktop app manages AI providers, local SQLite data, device pairing, VPN/tunnel access, generated solution apps, backups, diagnostics, and safer local actions. The phone connects as a paired PWA for chat, offline queue, device status, and action permissions.

Downloads:

- macOS Apple Silicon unsigned ZIP
- SHA256SUMS

Notes:

- The current public macOS build is unsigned; follow the release Gatekeeper guide if macOS blocks first launch.
- Windows NSIS and Linux AppImage packaging are wired into the build/check pipeline but are not uploaded in the current public release yet.
- Auto-update is not enabled yet; update manually from GitHub Releases.
- On first launch, set an admin password, configure an AI provider, create a backup, and pair your phone.
```

## 中文发布帖

```text
我做了一个本地优先的个人 AI 管家：LifeOS AI。

它的思路是：电脑端运行私有核心，负责连接 AI、网络、本地数据、备份和安全设置；手机端作为随身入口，用 PWA 的方式扫码绑定后使用。

当前公开版本提供 macOS Apple Silicon unsigned ZIP；Windows NSIS 和 Linux AppImage 已接入构建/校验路线，等真实资产验证后再上传。

目前支持：
- 电脑端管理核心
- 手机端 PWA 聊天和扫码绑定
- SQLite 本地数据
- AI 多 provider 配置
- Tailscale / Cloudflare Tunnel / 局域网连接向导
- 根据当前问题自动生成可运行的解决程序
- 备份、恢复、恢复任务取消
- 离线消息队列
- 导航、网页、电话、短信、邮件、快捷指令等 URL Scheme 白名单和危险动作确认
- 诊断包和审计日志脱敏

项目地址：
https://github.com/WGJ-Fry/lifeos-ai

欢迎试用、提 issue、给 star。
```

## 中文长帖

```text
我做了一个本地优先的个人 AI 管家/助手：LifeOS AI。

它不是单纯的聊天网页，而是一个“电脑端私有核心 + 手机端随身入口”的个人 AI 系统。

电脑端负责：
- 连接 Gemini / OpenAI / OpenRouter / 本地模型
- 保存 SQLite 本地数据
- 管理手机设备绑定
- 做管理员认证、安全自检、备份恢复和诊断导出
- 提供 LAN、Tailscale、Cloudflare Tunnel、可信 HTTPS 反向代理的连接向导

手机端负责：
- 扫码绑定后作为 PWA 添加到主屏幕
- 随时聊天
- 离线消息排队，恢复网络后同步
- 查看设备与连接状态
- 确认导航、网页、电话、短信、邮件、快捷指令等本地动作

另外还有 Studio 工坊：当你遇到具体问题时，AI 可以自动生成一个可运行的离线程序来辅助解决，然后继续调试 HTML/CSS/JS。

当前公开版本提供 macOS Apple Silicon unsigned ZIP；Windows NSIS 和 Linux AppImage 已接入构建/校验路线，等真实资产验证后再上传。macOS 当前包不是正式签名公证版，首次打开可能需要按 Release 里的 Gatekeeper 说明操作。

项目地址：
https://github.com/WGJ-Fry/lifeos-ai
```

## 英文发布帖

```text
I built LifeOS AI, a local-first personal AI assistant.

The desktop app runs the private core: AI providers, local SQLite data, device pairing, VPN/tunnel access, generated solution apps, backups, diagnostics, and safer local actions. The phone works as a paired mobile PWA companion for everyday use.

Current release includes:
- macOS Apple Silicon unsigned ZIP
- Mobile PWA pairing and chat
- SQLite local storage
- Multi-provider AI configuration
- Tailscale / Cloudflare Tunnel / LAN connection guide
- AI-generated runnable solution apps from the user's current problem
- Backup and restore
- Offline message queue
- URL Scheme allowlist for navigation, web, phone, SMS, mail, shortcuts, and dangerous-action confirmation
- Redacted diagnostics and audit logs

Windows NSIS and Linux AppImage packaging are wired into the build/check pipeline, but those public assets are not uploaded in the current release yet.

Repo:
https://github.com/WGJ-Fry/lifeos-ai

Feedback, issues, and stars are welcome.
```

## English Long Post

```text
I built LifeOS AI, a local-first personal AI assistant.

It is not just another chat page. It is a desktop private core plus a mobile PWA companion.

The desktop app handles:
- Gemini / OpenAI / OpenRouter / local model configuration
- SQLite local data
- phone pairing
- admin auth, safety checks, backups, restore, and diagnostics
- LAN, Tailscale, Cloudflare Tunnel, and trusted HTTPS reverse-proxy connection guidance

The phone handles:
- paired mobile PWA access
- everyday chat
- offline message queue
- device and connection status
- confirmation for local actions such as maps, web pages, phone, SMS, mail, and shortcuts

There is also a Studio workshop for generated solution apps: explain the current problem, generate a runnable offline program that helps solve it, then refine its HTML/CSS/JS.

The current public release provides a macOS Apple Silicon unsigned ZIP. Windows NSIS and Linux AppImage packaging are wired into the build/check pipeline, but those public assets are not uploaded yet. The current macOS package is not the signed/notarized build, so users may need the release Gatekeeper guide on first launch.

Repo:
https://github.com/WGJ-Fry/lifeos-ai
```

## V2EX 标题

```text
我做了一个本地优先的个人 AI 管家：电脑端做核心，手机端当入口
```

## Hacker News 标题

```text
Show HN: LifeOS AI - A local-first personal AI assistant with desktop core and mobile PWA
```

## Product Hunt 标语

```text
Your private AI core on desktop. Your personal AI assistant on phone.
```

## 首页截图说明

```text
截图 1：首次启动与安全自检，展示管理员密码、AI Key、备份和公网风险提示。
截图 2：手机连接向导，展示本机管理、同一局域网、公网/隧道、推荐绑定地址和启动环境。
截图 3：手机端入口，展示绑定状态、设备凭证、离线队列和 PWA 能力。
```

## 截图素材

- 真实首次启动与安全自检：`public/screenshots/real-admin-onboarding.jpg`
- 真实 VPN/隧道连接向导：`public/screenshots/real-connection-tunnel-vpn.jpg`
- 真实手机绑定入口：`public/screenshots/real-mobile-device.jpg`
- 真实手机端未绑定状态：`public/screenshots/real-mobile-chat.jpg`
- 英文功能总览图：`public/promo/lifeos-ai-english-feature-map.svg`

这些截图来自本地真实运行页面，不是概念图。

## 推广顺序

1. GitHub 仓库首页：补 Topics、开启 Discussions、确认 Release 下载入口。
2. 中文社区：V2EX、即刻、掘金、少数派。
3. 英文社区：X、Reddit、Hacker News Show HN。
4. 产品社区：Product Hunt。
5. 收集问题：把高频反馈整理成 README FAQ 和 GitHub Issues。

## 发布前检查

- README 顶部有安装包下载入口。
- Release 页面只写真实已上传资产；当前公开版本是 macOS Apple Silicon unsigned ZIP、SHA256SUMS 和 update feed 文件。
- DMG、EXE、AppImage 只有在真实生成、校验并上传后才能写成可下载资产。
- 截图使用 `public/screenshots/real-*.jpg`，不要使用概念图。
- GitHub Topics 已包含 `personal-ai`、`local-first`、`pwa`、`electron`、`sqlite`、`tailscale`、`cloudflare-tunnel`。
- Issues 已开启，建议同时开启 Discussions 收集使用反馈。
- Windows/Linux 安装包暂未上传、自动更新未启用、许可证保留所有权利，这三点要主动说明。

## 注意事项

- 不要承诺“完全开源可商用”，当前仓库是 All Rights Reserved。
- 不要宣传“自动更新已可用”，当前版本是手动下载更新。
- Windows/Linux 安装包暂未上传；后续 Windows 版本若未 Authenticode 签名，要主动说明 SmartScreen 可能提示。
- 异地连接建议 Tailscale、Cloudflare Tunnel 或可信 HTTPS 反向代理，不建议直接暴露公网 IP。

---

# English

## One-liner

LifeOS AI is a local-first personal AI assistant: your desktop runs the private core, and your phone becomes the daily AI companion.

## Short Description

LifeOS AI turns your desktop into a private AI core for providers, local SQLite data, VPN/tunnel access, generated solution apps, backups, device pairing, diagnostics, and security. Your phone connects as a paired PWA companion for chat, offline queue, device status, and safer local actions.

## English Visual Asset

- English feature map image: `public/promo/lifeos-ai-english-feature-map.svg`
- Real English screenshots:
  - `public/screenshots/en-admin-onboarding.jpg`
  - `public/screenshots/en-connection-tunnel-vpn.jpg`
  - `public/screenshots/en-mobile-device.jpg`

## Links

- Repository: `https://github.com/WGJ-Fry/lifeos-ai`
- Release: `https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.0`
- Install guide: `docs/user-install-guide.md`
