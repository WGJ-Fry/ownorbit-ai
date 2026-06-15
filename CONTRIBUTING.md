# Contributing / 反馈与贡献

中文 | [English](#english)

## 先说清楚许可证

当前仓库没有开放源代码许可证，`package.json` 标记为 `UNLICENSED`。在添加 LICENSE 之前，本项目默认保留所有权利。你可以查看代码、提交 issue、讨论需求和反馈问题，但不要默认复制、再分发或商用。

## 适合提交什么？

- Bug：安装失败、绑定失败、PWA 离线队列异常、备份恢复异常、AI provider 配置异常。
- 体验建议：首次启动、手机绑定、连接向导、错误提示、发布说明。
- 安全建议：认证、CSRF、URL Scheme 白名单、诊断包脱敏、备份隐私。
- 平台反馈：macOS、Windows、Linux、iOS Safari、Android Chrome。

## 提交 Bug 前

1. 确认版本号和平台。
2. 尽量用最新 GitHub Release 复现。
3. 在管理端导出诊断包，确认内容已脱敏。
4. 写清楚复现步骤、预期结果和实际结果。

## 不要公开这些内容

- AI Key、GitHub Token、Apple App 专用密码。
- 证书密码、`.p12` 文件、私钥。
- SQLite 数据库、未加密备份、未脱敏诊断包。
- 管理员密码、设备绑定 token、Cookie、Authorization Header。
- 真实家庭公网 IP、内网拓扑、私人聊天内容。

## 本地开发

```bash
npm install
npm run dev
```

常用检查：

```bash
npm run lint
npm test
npm run test:e2e
npm run test:desktop
LIFEOS_RELEASE_SKIP_ARTIFACTS=1 npm run release:check:unsigned
```

桌面壳：

```bash
npm run desktop
```

## 代码提交建议

- 优先保持改动小而清晰。
- 安全、认证、备份、设备凭证、URL Scheme 相关改动要补测试。
- 前端体验改动要确认移动端宽度。
- 不要提交 `release/`、`dist/`、`node_modules/`、`.env*`、数据库、证书或本地备份。

## 工程原则

- 优先沿用现有架构、服务模块和测试方式。
- 可持久化数据统一进入 SQLite 或现有安全存储，不新增散落的本地明文存储。
- API 响应、日志、审计和诊断包必须脱敏。
- 手机端凭证优先使用 WebCrypto 设备签名。
- 危险本地动作必须有白名单、风险提示和用户确认。
- 继续拆分大文件，保持页面壳、hook 和核心服务可测试。

## 发布相关

- 不要提交 `release/` 产物到 git；通过 GitHub Release 上传二进制。
- macOS 发布前运行 `npm run signing:check:mac`。
- Windows 正式签名需要单独的 Authenticode 证书。
- 完整发布前运行 `npm run release:check`。

---

# English

## License First

This repository currently has no open-source license and `package.json` is marked `UNLICENSED`. Until a LICENSE is added, all rights are reserved. You may inspect the code and file issues, but you are not granted copying, redistribution, or commercial-use rights by default.

## Good Contributions

- Bugs: installation, pairing, PWA offline queue, backup/restore, AI provider configuration.
- UX feedback: onboarding, phone pairing, connection guide, errors, release notes.
- Security feedback: auth, CSRF, URL Scheme allowlist, diagnostic redaction, backup privacy.
- Platform feedback: macOS, Windows, Linux, iOS Safari, Android Chrome.

## Before Filing A Bug

1. Confirm the version and platform.
2. Reproduce on the latest GitHub Release if possible.
3. Export a diagnostic bundle from the admin UI and verify it is redacted.
4. Include reproduction steps, expected behavior, and actual behavior.

## Do Not Publish

- AI keys, GitHub tokens, Apple app-specific passwords.
- Certificate passwords, `.p12` files, private keys.
- SQLite databases, unencrypted backups, unredacted diagnostics.
- Admin passwords, device pairing tokens, cookies, Authorization headers.
- Real home public IPs, private network topology, private chat content.

## Local Development

```bash
npm install
npm run dev
```

Common checks:

```bash
npm run lint
npm test
npm run test:e2e
npm run test:desktop
LIFEOS_RELEASE_SKIP_ARTIFACTS=1 npm run release:check:unsigned
```

Desktop shell:

```bash
npm run desktop
```

## Pull Request Guidance

- Keep changes small and focused.
- Add tests for auth, security, backup, device credentials, and URL Scheme changes.
- Verify mobile widths for frontend changes.
- Do not commit `release/`, `dist/`, `node_modules/`, `.env*`, databases, certificates, or local backups.

## Engineering Rules

- Follow existing architecture, service modules, and test patterns.
- Store durable data in SQLite or existing secure storage; avoid scattered plaintext local storage.
- Redact API responses, logs, audit metadata, and diagnostic bundles.
- Prefer WebCrypto device signatures for mobile credentials.
- Dangerous local actions require allowlists, risk copy, and user confirmation.
- Keep large UI files split and core services testable.

## Release Notes

- Do not commit `release/` artifacts to git; upload binaries through GitHub Releases.
- Run `npm run signing:check:mac` before macOS releases.
- Windows polished distribution requires a separate Authenticode certificate.
- Run `npm run release:check` before a full release.
