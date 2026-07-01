# Privacy / 隐私说明

中文 | [English](#english)

LifeOS AI 的默认设计是本地优先：电脑端运行本地核心，数据保存在用户自己的电脑上，手机端通过绑定后的浏览器/PWA 访问电脑端。

## 收集和保存的数据

LifeOS AI 会在本机保存：

- 管理员设置状态。
- 已绑定设备信息。
- 聊天会话和消息。
- 记忆数据。
- AI provider 配置状态。
- 备份、恢复任务和自动备份计划。
- 安全审计日志。
- 本地动作权限记录。

开发模式默认数据目录是 `data/`。桌面安装版使用系统应用数据目录。

## AI Key

AI Key 应在电脑管理端配置。密钥不会保存到手机端，也不会放入浏览器 `localStorage`。后端会优先使用系统安全存储；不可用时使用本地加密 fallback。

诊断包、审计日志、API 响应和备份导出会尽量避免暴露 AI Key、管理员密码、设备私钥、Token、密文和本地绝对路径。

## 手机端

手机端是 PWA，不是原生 App。绑定后会保存设备凭证。新设备优先使用 WebCrypto 设备密钥对；旧 token 设备有迁移路径。

离线消息队列会保存在手机浏览器本地，用于断网后恢复同步。

## 备份

普通 SQLite 备份默认不包含 AI Key 等敏感配置。加密备份使用用户提供的口令导出，口令不会保存。恢复备份需要用户手动确认，并在下次启动时应用。

## 网络连接

默认只监听本机 `127.0.0.1`。如需手机局域网或异地访问，需要显式开启 LAN/公网模式，并建议使用 Tailscale 或 Cloudflare Tunnel。不要直接把 LifeOS AI 暴露到公网。

## 第三方服务

当你配置 DeepSeek、通义千问、Kimi、智谱 GLM、豆包、MiniMax、OpenAI、Gemini、Claude、OpenRouter、本地模型或其他 provider 时，聊天内容会按对应 provider 的方式发送到该服务。请自行阅读所选 AI provider 的隐私政策和数据处理条款。

## 诊断包

诊断包用于排障，包含服务状态、发布元数据、备份摘要、设备数量、网络检测和脱敏日志尾部。导出前仍建议用户自行确认内容。

---

# English

LifeOS AI is local-first by default. The desktop app runs the local core, stores data on the user's computer, and serves the paired mobile PWA.

## Data Stored Locally

LifeOS AI stores:

- Admin setup state.
- Paired device records.
- Chat sessions and messages.
- Memory records.
- AI provider configuration status.
- Backup/restore jobs and schedules.
- Security audit logs.
- Local action permission records.

Development data is stored in `data/`. Packaged desktop builds use the system app data directory.

## AI Keys

AI keys should be configured in the desktop admin UI. They are not stored on the phone or in browser `localStorage`. The backend prefers system secure storage and falls back to local encryption when needed.

Diagnostic bundles, audit logs, API responses, and exports redact AI keys, admin passwords, device private keys, tokens, ciphertext, and local absolute paths where possible.

## Mobile PWA

The phone client is a PWA, not a native app. After pairing, it stores device credentials. New devices prefer WebCrypto key-pair authentication; older token devices have a migration path.

Offline messages are stored in the phone browser until they can be synced.

## Backups

Plain SQLite backups exclude sensitive AI key material by default. Encrypted backup exports use a user-provided passphrase that is not stored. Restores require explicit confirmation and apply on the next startup.

## Network Access

The default host is `127.0.0.1`. LAN or remote access requires explicit opt-in and should use Tailscale or Cloudflare Tunnel. Do not expose the local core directly to the public internet.

## Third-Party AI Providers

When DeepSeek, Qwen/DashScope, Kimi, GLM, Qianfan/ERNIE, Hunyuan, Doubao, MiniMax, OpenAI, Gemini, Claude, OpenRouter, a local model, or another provider is configured, chat content is sent to that provider according to its own terms. Review the provider's privacy policy before use.

## Diagnostics

Diagnostic bundles are intended for troubleshooting and include redacted service state, release metadata, backup summaries, device counts, network diagnostics, and log tails. Users should still review bundles before sharing them.
