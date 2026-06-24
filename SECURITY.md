# Security / 安全说明

中文 | [English](#english)

## 支持状态

当前版本是早期自用/小范围分发版本。已经具备管理员认证、CSRF、防暴力尝试、设备绑定、SQLite 数据、审计日志和危险动作确认，但仍建议只在可信环境中使用。

## 支持版本

| 版本 | 安全支持 |
| --- | --- |
| `v0.1.2-alpha` / `0.1.2-alpha.0` | 当前 alpha，接收安全修复 |
| `v0.1.0` | 仅保留历史下载说明，建议升级 |

## 重要安全建议

- 首次启动后立即设置强管理员密码。
- 默认保持 `LIFEOS_HOST=127.0.0.1`。
- 需要手机局域网访问时才使用 `LIFEOS_HOST=0.0.0.0` 和 `LIFEOS_ALLOW_PUBLIC=1`。
- 异地访问优先使用 Tailscale 或 Cloudflare Tunnel。
- 不要把本地核心直接暴露到公网 IP。
- 不要把 `.env.local`、`.env.signing.local`、`.p12`、`.pfx`、AI Key 或 Apple App 专用密码上传到 GitHub。
- 发布前运行 `npm run release:check`。
- 分享诊断包前自行检查内容。

## 本地动作安全

手机端 URL Scheme 动作有白名单和危险动作二次确认。默认不允许任意 scheme 注入。用户应只允许自己确实需要的动作，例如地图、电话、短信、邮件、快捷指令或网页打开。

## 报告安全问题

如果发现安全问题，请不要公开发 issue、discussion 或社交媒体帖子。优先使用 GitHub 的私密漏洞报告功能；如果仓库没有开启该功能，请通过维护者的非公开渠道联系，并提供：

- 影响范围。
- 复现步骤。
- 相关版本。
- 你是否已经公开披露。

不要附加原始数据库、未加密备份、未脱敏诊断包、AI Key、Token、证书、私钥、管理员密码、设备绑定 token、Cookie 或 Authorization Header。请先使用管理端导出的脱敏诊断包，并在发送前再检查一次。

## 发布密钥处理

macOS 签名需要 Developer ID Application `.p12`、证书密码、Apple ID、App 专用密码和 Team ID。Windows 正式签名需要 Authenticode `.pfx` 和密码。这些值只能存在本机或 CI Secret 中。

如果密钥曾经出现在聊天记录、日志、截图或 GitHub 中，应立即撤销或轮换。

---

# English

## Supported Status

This is an early personal/small-distribution release. It includes admin auth, CSRF protection, brute-force mitigation, device pairing, SQLite persistence, audit logs, and dangerous-action confirmation, but should still be used only in trusted environments.

## Supported Versions

| Version | Security Support |
| --- | --- |
| `v0.1.2-alpha` / `0.1.2-alpha.0` | Current alpha, security fixes accepted |
| `v0.1.0` | Historical download notes only; upgrade recommended |

## Security Recommendations

- Set a strong admin password on first launch.
- Keep `LIFEOS_HOST=127.0.0.1` by default.
- Use `LIFEOS_HOST=0.0.0.0` and `LIFEOS_ALLOW_PUBLIC=1` only when LAN/mobile access is needed.
- Prefer Tailscale or Cloudflare Tunnel for remote access.
- Do not expose the local core directly to a public IP.
- Do not upload `.env.local`, `.env.signing.local`, `.p12`, `.pfx`, AI keys, or Apple app-specific passwords to GitHub.
- Run `npm run release:check` before publishing.
- Review diagnostic bundles before sharing them.

## Local Action Safety

Mobile URL Scheme actions use an allowlist and dangerous-action confirmation. Arbitrary scheme injection is blocked by default. Users should allow only actions they need, such as maps, phone, SMS, email, shortcuts, or web links.

## Reporting Security Issues

Please do not open public issues, discussions, or social posts for security problems. Prefer GitHub private vulnerability reporting when it is enabled. If it is not enabled for the repository, contact the maintainer through a non-public channel and include:

- Impact.
- Reproduction steps.
- Affected version.
- Whether the issue has been disclosed elsewhere.

Do not attach raw databases, unencrypted backups, unredacted diagnostic bundles, AI keys, tokens, certificates, private keys, admin passwords, device pairing tokens, cookies, or Authorization headers. Prefer a redacted diagnostic bundle exported from the admin UI, and review it again before sending.

## Release Secret Handling

macOS signing requires a Developer ID Application `.p12`, certificate password, Apple ID, app-specific password, and Team ID. Windows signing requires an Authenticode `.pfx` and password. Store these only locally or in CI secrets.

Rotate any secret that appeared in chat logs, screenshots, terminal logs, or GitHub.
