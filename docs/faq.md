# LifeOS AI FAQ / 常见问题

中文 | [English](#english)

## 这是什么？

LifeOS AI 是一个本地优先的个人 AI 管家/助手。电脑端运行私有核心，负责连接 AI provider、保存 SQLite 数据、管理手机绑定、备份恢复和安全设置；手机端通过 PWA 作为随身入口使用。

## 为什么不是原生手机 App？

当前手机端优先采用 PWA，是为了避开原生应用审核、跨平台安装和本地能力限制。用户可以通过浏览器打开并添加到主屏幕，体验接近 App，同时保留自托管和快速迭代能力。

## 手机和电脑不在同一个局域网怎么办？

推荐顺序：

1. Tailscale HTTPS Serve：适合长期自用，手机和电脑加入同一个 Tailnet，并使用 `https://<device>.<tailnet>`。
2. Cloudflare Tunnel：适合需要 HTTPS 公网入口的场景。
3. 可信 HTTPS 反向代理：适合有服务器和域名的用户。

管理端“手机连接向导”会检测 Tailscale、Cloudflare Tunnel 和局域网地址。Tailscale 在线并启用 MagicDNS 时，会优先推荐 HTTPS Serve，并提供“一键启动 Tailscale HTTPS Serve”；命令行作为备用方案。已安装 `cloudflared` 时，可以直接点“一键启动 Cloudflare Tunnel”，系统会保存新的 HTTPS 地址并用于二维码。

注意：`trycloudflare.com` 快速隧道是临时地址，重启后可能变化。长期稳定使用优先选 Tailscale、Cloudflare Named Tunnel 或自己的可信 HTTPS 反向代理。

不要直接把本地服务暴露到公网 IP。异地连接前请确认管理员密码、备份、HTTPS/可信隧道和 `LIFEOS_ALLOW_PUBLIC=1` 配置。

## AI Key 存在哪里？

AI Key 不会保存在手机端，也不会通过普通 API 返回给前端。桌面版优先使用系统安全存储；不可用时使用本地 AES-GCM 加密文件作为 fallback。普通备份默认不包含 AI Key。

## 数据存在哪里？

聊天、记忆、设备、审计、备份索引等关键数据统一保存在电脑端 SQLite。桌面安装版使用系统应用数据目录；开发模式默认使用本地数据目录。

## 能打开导航、短信、电话、快捷指令吗？

可以，但不会直接执行任意链接。LifeOS AI 使用 URL Scheme 白名单和危险动作确认，导航、网页、电话、短信、邮件、快捷指令等动作会显示来源、目标和风险提示，并写入脱敏审计日志。

## Studio 自动生成程序是什么？

Studio 工坊不是简单地“按描述生成一个小程序”，而是根据用户当前要解决的问题，自动生成一个可运行的离线程序来辅助解决问题。比如记账、规划、整理信息、打卡、计算、表单收集、流程面板等场景，AI 会把问题转成可交互程序，并支持沙箱预览、源码复制、响应式预览和继续调整 HTML/CSS/JS。

## Windows 为什么会有 SmartScreen 提示？

当前 `v0.1.3-alpha` 已上传 Windows NSIS 安装包，但还没有 Authenticode 正式签名，可能会出现 SmartScreen 未知发布者提示。macOS 当前公开包是 Apple Silicon unsigned ZIP，不是正式签名公证版；Linux 当前公开包是 AppImage。请只从 GitHub Release 下载，并用 `SHA256SUMS` 校验文件。

## 自动更新可用吗？

当前公开版本默认走手动下载更新。仓库已经生成 electron-updater feed 文件，但需要配置稳定 HTTPS 更新地址 `LIFEOS_UPDATE_URL` 后才建议启用自动更新。

## 这是开源项目吗？

是。当前仓库使用 MIT License。你可以查看、复制、修改和再分发代码，但请遵守仓库根目录 `LICENSE` 中的许可条款和免责声明。

## 提交问题时要注意什么？

请不要公开粘贴 API Key、GitHub Token、Apple 密码、证书密码、`.p12` 文件、数据库、备份文件或未脱敏日志。优先上传管理端导出的脱敏诊断包。

---

# English

## What is LifeOS AI?

LifeOS AI is a local-first personal AI assistant. The desktop app runs the private core for AI providers, SQLite data, phone pairing, backups, restore, and security settings. The phone connects as a paired mobile PWA companion.

## Why not a native mobile app?

The mobile client is a PWA so it can avoid native app review constraints, work across platforms, and remain easy to self-host and iterate. Users can add it to the home screen after pairing.

## How do I connect when my phone and desktop are not on the same LAN?

Recommended options:

1. Tailscale HTTPS Serve for long-term personal use with an `https://<device>.<tailnet>` entry.
2. Cloudflare Tunnel for an HTTPS public entry.
3. A trusted HTTPS reverse proxy if you already operate a domain and server.

The admin connection guide detects Tailscale, Cloudflare Tunnel, and LAN addresses. When Tailscale is online and MagicDNS is enabled, it prefers HTTPS Serve and offers `Start Tailscale HTTPS Serve`; the command line remains available as a fallback. When `cloudflared` is installed, you can click `Start Cloudflare Tunnel`; LifeOS AI saves the new HTTPS address and uses it for pairing QR codes.

Note: quick `trycloudflare.com` tunnels are temporary and may change after restart. For stable long-term use, prefer Tailscale, Cloudflare Named Tunnel, or your own trusted HTTPS reverse proxy.

Do not expose the local core directly to a public IP. Before remote access, verify the admin password, backups, HTTPS/trusted tunnel, and `LIFEOS_ALLOW_PUBLIC=1`.

## Where are AI keys stored?

AI keys are not stored on the phone and are not returned through normal frontend APIs. The desktop app prefers system secure storage; when unavailable, it falls back to a local AES-GCM encrypted file. Ordinary backups exclude AI keys by default.

## Where is my data stored?

Chats, memories, devices, audit logs, and backup indexes live in desktop-side SQLite. Packaged desktop builds use the system app data directory; development mode uses a local data directory.

## Can it open maps, SMS, phone, or shortcuts?

Yes, but arbitrary schemes are not executed blindly. LifeOS AI uses a URL Scheme allowlist, dangerous-action confirmation, and redacted audit logs for maps, web, phone, SMS, mail, shortcuts, and similar actions.

## What is the Studio app generator?

Studio does more than generate an app from a description. It turns the user's current problem into a runnable offline program that helps solve it. For accounting, planning, organizing information, habit tracking, calculators, forms, or workflow panels, AI can produce an interactive solution app with sandbox preview, source copy, responsive preview, and further HTML/CSS/JS refinement.

## Why does Windows show a SmartScreen warning?

The current `v0.1.3-alpha` Release uploads a Windows NSIS installer, but it is not Authenticode signed yet, so SmartScreen may warn about an unknown publisher. The current public macOS package is an Apple Silicon unsigned ZIP, not the signed/notarized build; the Linux package is an AppImage. Download only from GitHub Releases and verify `SHA256SUMS`.

## Is auto-update enabled?

The current public release uses manual updates. The repo can generate electron-updater feed files, but automatic updates should only be enabled after configuring a stable HTTPS `LIFEOS_UPDATE_URL`.

## Is this open source?

Yes. This repository is licensed under the MIT License. You may inspect, copy, modify, and redistribute the code as long as you follow the terms and disclaimer in the root `LICENSE` file.

## What should I avoid posting in issues?

Do not publish API keys, GitHub tokens, Apple passwords, certificate passwords, `.p12` files, databases, backups, or unredacted logs. Prefer attaching a redacted diagnostic bundle exported from the admin UI.
