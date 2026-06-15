# LifeOS AI Promotion Kit / 推广素材包

中文 | [English](#english)

## 一句话

LifeOS AI 是一个本地优先的个人 AI 管家：电脑端运行私有核心，手机端成为随身 AI 助手。

## 短介绍

LifeOS AI 把电脑端做成你的个人 AI 核心，用来连接 AI、网络、本地数据和安全设置；手机端通过 PWA 扫码绑定后，成为随时可用的私人 AI 管家。它支持 SQLite 本地存储、AI 多 provider 配置、VPN/隧道连接向导、自动生成离线微应用/程序、备份恢复、离线队列、设备绑定、URL Scheme 白名单和危险动作确认。

## 英文短介绍

LifeOS AI is a local-first personal AI assistant. The desktop app runs the private core for AI providers, local data, device management, VPN/tunnel connectivity, generated micro apps, backups, and security; the phone connects as a paired mobile PWA companion for everyday use.

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
LifeOS AI 0.0.0 - Desktop core + mobile personal AI assistant
```

## Release 描述

```markdown
LifeOS AI 0.0.0 is the first public desktop release.

LifeOS AI turns your desktop into a private AI core and your phone into an always-available personal AI assistant. The desktop app manages AI providers, local SQLite data, device pairing, VPN/tunnel access, generated micro apps, backups, diagnostics, and safer local actions. The phone connects as a paired PWA for chat, offline queue, device status, and action permissions.

Downloads:

- macOS Apple Silicon DMG
- Windows x64 Installer
- Linux x64 AppImage
- SHA256SUMS

Notes:

- macOS build is Developer ID signed and Apple notarized.
- Windows build is installable but not Authenticode signed yet, so SmartScreen may warn.
- Auto-update is not enabled yet; update manually from GitHub Releases.
- On first launch, set an admin password, configure an AI provider, create a backup, and pair your phone.
```

## 中文发布帖

```text
我做了一个本地优先的个人 AI 管家：LifeOS AI。

它的思路是：电脑端运行私有核心，负责连接 AI、网络、本地数据、备份和安全设置；手机端作为随身入口，用 PWA 的方式扫码绑定后使用。

现在已经有 macOS / Windows / Linux 安装包。

目前支持：
- 电脑端管理核心
- 手机端 PWA 聊天和扫码绑定
- SQLite 本地数据
- AI 多 provider 配置
- Tailscale / Cloudflare Tunnel / 局域网连接向导
- 描述想法后自动生成离线微应用/小程序
- 备份、恢复、恢复任务取消
- 离线消息队列
- 导航、网页、电话、短信、邮件、快捷指令等 URL Scheme 白名单和危险动作确认
- 诊断包和审计日志脱敏

项目地址：
https://github.com/WGJ-Fry/lifeos-ai

欢迎试用、提 issue、给 star。
```

## 英文发布帖

```text
I built LifeOS AI, a local-first personal AI assistant.

The desktop app runs the private core: AI providers, local SQLite data, device pairing, VPN/tunnel access, generated micro apps, backups, diagnostics, and safer local actions. The phone works as a paired mobile PWA companion for everyday use.

Current release includes:
- macOS / Windows / Linux desktop builds
- Mobile PWA pairing and chat
- SQLite local storage
- Multi-provider AI configuration
- Tailscale / Cloudflare Tunnel / LAN connection guide
- AI-generated offline micro apps from natural-language descriptions
- Backup and restore
- Offline message queue
- URL Scheme allowlist for navigation, web, phone, SMS, mail, shortcuts, and dangerous-action confirmation
- Redacted diagnostics and audit logs

Repo:
https://github.com/WGJ-Fry/lifeos-ai

Feedback, issues, and stars are welcome.
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

## 截图素材

- 真实首次启动与安全自检：`public/screenshots/real-admin-onboarding.jpg`
- 真实 VPN/隧道连接向导：`public/screenshots/real-connection-tunnel-vpn.jpg`
- 真实手机绑定入口：`public/screenshots/real-mobile-device.jpg`
- 真实手机端未绑定状态：`public/screenshots/real-mobile-chat.jpg`

这些截图来自本地真实运行页面，不是概念图。

## 推广顺序

1. GitHub 仓库首页：补 Topics、开启 Discussions、确认 Release 下载入口。
2. 中文社区：V2EX、即刻、掘金、少数派。
3. 英文社区：X、Reddit、Hacker News Show HN。
4. 产品社区：Product Hunt。
5. 收集问题：把高频反馈整理成 README FAQ 和 GitHub Issues。

## 注意事项

- 不要承诺“完全开源可商用”，当前仓库是 All Rights Reserved。
- 不要宣传“自动更新已可用”，当前版本是手动下载更新。
- Windows 版本未 Authenticode 签名，要主动说明 SmartScreen 可能提示。
- 异地连接建议 Tailscale、Cloudflare Tunnel 或可信 HTTPS 反向代理，不建议直接暴露公网 IP。

---

# English

## One-liner

LifeOS AI is a local-first personal AI assistant: your desktop runs the private core, and your phone becomes the daily AI companion.

## Short Description

LifeOS AI turns your desktop into a private AI core for providers, local SQLite data, VPN/tunnel access, generated micro apps, backups, device pairing, diagnostics, and security. Your phone connects as a paired PWA companion for chat, offline queue, device status, and safer local actions.

## Links

- Repository: `https://github.com/WGJ-Fry/lifeos-ai`
- Release: `https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.0.0`
- Install guide: `docs/user-install-guide.md`
