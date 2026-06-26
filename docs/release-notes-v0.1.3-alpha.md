# LifeOS v0.1.3-alpha

LifeOS v0.1.3-alpha is the current public alpha line. It aligns the public Release tag with the latest `main` branch and keeps the release promise honest: local-first memory, mobile companion, safer remote access guidance, and Studio-generated problem-solving tools.

## What Is Included

- Docker Compose quickstart with GHCR image `ghcr.io/wgj-fry/lifeos-ai:v0.1.3-alpha`.
- Local Markdown memory plus optional read-only local `.ics` calendar/task ingestion for `VEVENT` events and open dated `VTODO` tasks.
- Admin authentication, AI provider settings, SQLite migrations, backup/restore, diagnostics, and redacted audit data.
- Mobile PWA pairing, WebCrypto device credentials, device status, offline queue, retry/clear controls, and background sync hooks.
- Remote connection diagnostics for LAN, Tailscale, Cloudflare Tunnel, and trusted HTTPS reverse-proxy modes.
- Remote acceptance checklist covering disconnect, restart, network switch, stale QR code, and mobile cellular validation.
- Studio-generated problem programs with blueprint confirmation, template matching, permission boundaries, failure recovery guidance, version/rollback planning, runtime logs, state storage, and version rollback.
- Local action permission center with URL Scheme whitelist, dangerous-action confirmation, redacted logs, and capability matrix for browser, navigation, phone, SMS, email, and Shortcuts bridge actions.

## Desktop Packages

This alpha intentionally ships unsigned packages:

- macOS Apple Silicon unsigned ZIP.
- Windows x64 unsigned NSIS installer.
- Linux x64 AppImage.

Verify every downloaded file with `SHA256SUMS`. macOS Gatekeeper and Windows SmartScreen may warn because the public packages are not formally signed yet.

## Current Limits

- Automatic updates are not enabled by default. Use manual download plus SHA256 verification.
- macOS Developer ID signing/notarization and Windows Authenticode signing are not part of this unsigned alpha.
- Apple Calendar, Google Calendar, and system reminders account sync/write-back are not shipped yet.
- `.ics` support is read-only local ingestion, not two-way calendar/task management.
- Studio generated programs remain alpha: template matching, version planning, and repair prompts are present, but fully automatic unattended self-repair is not advertised.
- Local actions are still URL Scheme / browser / Shortcuts bridge based. Full native automation and deep OS permission control are future work.
- Remote diagnostics can verify configuration, but long-term remote stability still needs real-device evidence from the user’s network.

## Remote Long-Test Evidence Required Before Broad Promotion

Before posting this release widely, capture and keep a short validation note for:

1. Phone on the same LAN can pair and chat.
2. Phone on cellular can open the Tailscale or Cloudflare URL and chat.
3. Computer restarts, LifeOS relaunches, and the same remote entry recovers.
4. Network switches from Wi-Fi to cellular and the mobile queue writes back after recovery.
5. Old pairing QR/session expires and cannot bind a new device.
6. Diagnostics export contains no token, key, local private path, or email address.

## 中文说明

LifeOS v0.1.3-alpha 是当前公开 alpha 线。它把公开 Release tag 对齐到最新 `main`，并坚持只承诺已经能验证的能力：本地优先记忆、手机端入口、更安全的异地连接向导，以及 Studio 自动生成解决问题的程序。

### 已包含

- Docker Compose 快速体验，镜像为 `ghcr.io/wgj-fry/lifeos-ai:v0.1.3-alpha`。
- 本地 Markdown 记忆，以及可选的本地 `.ics` 只读日历/任务读取：支持 `VEVENT` 事件和未完成且带日期的 `VTODO`。
- 管理员认证、AI provider 设置、SQLite migration、备份恢复、诊断和脱敏审计。
- 手机 PWA 绑定、WebCrypto 设备凭证、设备状态、离线队列、重试/清空控制和后台同步钩子。
- LAN、Tailscale、Cloudflare Tunnel、可信 HTTPS 反向代理的连接诊断。
- 异地验收清单：断线、重启、换网络、旧二维码失效、手机蜂窝网络验证。
- Studio 生成解决问题的程序：生成前确认、模板匹配、权限边界、失败修复提示、版本/回滚计划、运行日志、状态保存和版本回滚。
- 本地动作权限中心：URL Scheme 白名单、危险动作确认、脱敏日志，以及网页、导航、电话、短信、邮件、快捷指令桥的能力矩阵。

### 当前限制

- 默认不启用自动更新，继续使用手动下载 + SHA256 校验。
- 本 alpha 不包含 macOS Developer ID 签名/公证，也不包含 Windows Authenticode 签名。
- Apple Calendar、Google Calendar、系统提醒事项的账号同步和写回尚未发布。
- `.ics` 只是本地只读读取，不是双向日历/任务管理。
- Studio 生成程序仍是 alpha：已有模板匹配、版本计划和修复提示，但不宣传完全无人值守自修复。
- 本地动作仍基于 URL Scheme / 浏览器 / 快捷指令桥，不是完整原生自动化系统。
- 远程诊断能验证配置，但长期稳定性仍需要用户自己完成真实设备长测并留下证据。
