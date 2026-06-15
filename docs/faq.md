# LifeOS AI FAQ / 常见问题

中文 | [English](#english)

## 这是什么？

LifeOS AI 是一个本地优先的个人 AI 管家/助手。电脑端运行私有核心，负责连接 AI provider、保存 SQLite 数据、管理手机绑定、备份恢复和安全设置；手机端通过 PWA 作为随身入口使用。

## 为什么不是原生手机 App？

当前手机端优先采用 PWA，是为了避开原生应用审核、跨平台安装和本地能力限制。用户可以通过浏览器打开并添加到主屏幕，体验接近 App，同时保留自托管和快速迭代能力。

## 手机和电脑不在同一个局域网怎么办？

推荐顺序：

1. Tailscale：适合长期自用，手机和电脑加入同一个 Tailnet。
2. Cloudflare Tunnel：适合需要 HTTPS 公网入口的场景。
3. 可信 HTTPS 反向代理：适合有服务器和域名的用户。

不要直接把本地服务暴露到公网 IP。异地连接前请确认管理员密码、备份、HTTPS/可信隧道和 `LIFEOS_ALLOW_PUBLIC=1` 配置。

## AI Key 存在哪里？

AI Key 不会保存在手机端，也不会通过普通 API 返回给前端。桌面版优先使用系统安全存储；不可用时使用本地 AES-GCM 加密文件作为 fallback。普通备份默认不包含 AI Key。

## 数据存在哪里？

聊天、记忆、设备、审计、备份索引等关键数据统一保存在电脑端 SQLite。桌面安装版使用系统应用数据目录；开发模式默认使用本地数据目录。

## 能打开导航、短信、电话、快捷指令吗？

可以，但不会直接执行任意链接。LifeOS AI 使用 URL Scheme 白名单和危险动作确认，导航、网页、电话、短信、邮件、快捷指令等动作会显示来源、目标和风险提示，并写入脱敏审计日志。

## Studio 自动生成程序是什么？

Studio 工坊可以根据自然语言描述生成离线微应用/小程序，并支持沙箱预览、源码复制、响应式预览和继续调整 HTML/CSS/JS。它适合生成个人工具、流程小面板和轻量交互页面。

## Windows 为什么会有 SmartScreen 提示？

当前 Windows 安装包还没有 Authenticode 正式签名，所以 Windows 可能提示未知发布者。请只从 GitHub Release 下载，并用 `SHA256SUMS` 校验文件。macOS 当前包已 Developer ID 签名并 Apple 公证。

## 自动更新可用吗？

当前公开版本默认走手动下载更新。仓库已经生成 electron-updater feed 文件，但需要配置稳定 HTTPS 更新地址 `LIFEOS_UPDATE_URL` 后才建议启用自动更新。

## 这是开源项目吗？

当前仓库是 source-available，但没有开放源代码许可证。除非另行添加 LICENSE，默认保留所有权利。你可以查看代码、提交 issue 和反馈，但没有被授予复制、修改、再分发或商用授权。

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

1. Tailscale for long-term personal use.
2. Cloudflare Tunnel for an HTTPS public entry.
3. A trusted HTTPS reverse proxy if you already operate a domain and server.

Do not expose the local core directly to a public IP. Before remote access, verify the admin password, backups, HTTPS/trusted tunnel, and `LIFEOS_ALLOW_PUBLIC=1`.

## Where are AI keys stored?

AI keys are not stored on the phone and are not returned through normal frontend APIs. The desktop app prefers system secure storage; when unavailable, it falls back to a local AES-GCM encrypted file. Ordinary backups exclude AI keys by default.

## Where is my data stored?

Chats, memories, devices, audit logs, and backup indexes live in desktop-side SQLite. Packaged desktop builds use the system app data directory; development mode uses a local data directory.

## Can it open maps, SMS, phone, or shortcuts?

Yes, but arbitrary schemes are not executed blindly. LifeOS AI uses a URL Scheme allowlist, dangerous-action confirmation, and redacted audit logs for maps, web, phone, SMS, mail, shortcuts, and similar actions.

## What is the Studio app generator?

Studio generates offline micro apps from natural-language descriptions. It supports sandbox preview, source copy, responsive preview, and further HTML/CSS/JS refinement.

## Why does Windows show a SmartScreen warning?

The current Windows installer is not Authenticode signed yet, so Windows may warn about an unknown publisher. Download only from GitHub Releases and verify `SHA256SUMS`. The macOS build is Developer ID signed and Apple notarized.

## Is auto-update enabled?

The current public release uses manual updates. The repo can generate electron-updater feed files, but automatic updates should only be enabled after configuring a stable HTTPS `LIFEOS_UPDATE_URL`.

## Is this open source?

The repository is source-available but currently has no open-source license. Unless a LICENSE is added later, all rights are reserved. You may inspect the code and file issues, but you are not granted copying, modification, redistribution, or commercial-use rights.

## What should I avoid posting in issues?

Do not publish API keys, GitHub tokens, Apple passwords, certificate passwords, `.p12` files, databases, backups, or unredacted logs. Prefer attaching a redacted diagnostic bundle exported from the admin UI.
