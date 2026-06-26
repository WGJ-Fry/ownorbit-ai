# LifeOS AI 0.1.0 Release Notes / 发布说明

中文 | [English](#english)

> [!WARNING]
> `v0.1.0` is superseded by [`v0.1.2-alpha`](https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.2-alpha). It is kept only as an earlier alpha record and should be marked as prerelease on GitHub so it does not appear as the recommended Latest release.
>
> `v0.1.0` 已被 [`v0.1.2-alpha`](https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.2-alpha) 取代。它只应作为早期 alpha 记录保留，并应在 GitHub 上标记为 prerelease，避免误导用户下载旧版本。

## 下载

- macOS Apple Silicon 测试包：`LifeOS.AI-0.1.0-arm64-unsigned.zip`
- 校验文件：`SHA256SUMS`
- 安装说明：`INSTALL-unsigned-mac.md`
- Windows x64：准备中，当前 Release 未上传 EXE。
- Linux x64：准备中，当前 Release 未上传 AppImage。

## 这个版本有什么

- 电脑端 LifeOS AI 桌面应用。
- 手机端 PWA 绑定和聊天。
- 管理员登录、首次启动向导、设备绑定。
- AI provider 配置：Gemini、OpenAI、OpenRouter、本地模型接口预留。
- SQLite 数据存储、迁移、备份、恢复、恢复任务取消。
- 手机离线队列、连接状态、动作权限中心。
- URL Scheme 白名单和危险动作确认。
- 桌面诊断包、日志目录、启动失败提示。
- macOS unsigned ZIP 公开测试包。
- Windows NSIS 和 Linux AppImage 构建路线已接入，公开二进制待真实打包验证后上传。

## 安装

macOS：下载 unsigned ZIP，解压后把 `LifeOS AI.app` 拖到 Applications。如果 macOS 提示无法验证开发者，请按 `INSTALL-unsigned-mac.md` 操作。

Windows/Linux：当前 `v0.1.0` 未提供公开安装包。请等待真实 EXE/AppImage 资产上传。

## 校验

```text
50570710de1732273d62233a44aa4441e76ec6200657a7f5a1c778274eae8f0e  LifeOS AI-0.1.0-arm64-unsigned.zip
```

## 注意

- 当前未配置 `LIFEOS_UPDATE_URL`，所以不会自动更新。
- macOS 包是 Apple Silicon arm64 unsigned ZIP，不是 Intel/Universal，也不是已签名公证 DMG。
- Windows/Linux 包当前未上传到 `v0.1.0` Release。
- 首次启动后请先设置管理员密码，再配置 AI Key 和绑定手机。

---

# English

## Downloads

- macOS Apple Silicon test build: `LifeOS.AI-0.1.0-arm64-unsigned.zip`
- Checksum file: `SHA256SUMS`
- Install guide: `INSTALL-unsigned-mac.md`
- Windows x64: preparing; no EXE is uploaded in this Release.
- Linux x64: preparing; no AppImage is uploaded in this Release.

## What's Included

- LifeOS AI desktop app.
- Mobile PWA pairing and chat.
- Admin login, first-launch onboarding, device pairing.
- AI provider configuration for Gemini, OpenAI, OpenRouter, and local model endpoints.
- SQLite persistence, migrations, backups, restore, and restore cancellation.
- Mobile offline queue, connection status, action permission center.
- URL Scheme allowlist and dangerous-action confirmation.
- Desktop diagnostics, logs folder, startup failure page.
- Public macOS unsigned ZIP test build.
- Windows NSIS and Linux AppImage packaging paths are wired in, with public binaries pending real package verification.

## Install

macOS: download the unsigned ZIP, unzip it, and drag `LifeOS AI.app` into Applications. If macOS blocks the first launch, follow `INSTALL-unsigned-mac.md`.

Windows/Linux: no public installer is provided in `v0.1.0` yet. Wait for verified EXE/AppImage assets.

## Verification

```text
50570710de1732273d62233a44aa4441e76ec6200657a7f5a1c778274eae8f0e  LifeOS AI-0.1.0-arm64-unsigned.zip
```

## Notes

- `LIFEOS_UPDATE_URL` is not configured, so auto-update is disabled.
- The macOS artifact is an Apple Silicon arm64 unsigned ZIP, not an Intel/Universal build and not a signed/notarized DMG.
- Windows/Linux packages are not uploaded to the `v0.1.0` Release yet.
- On first launch, set an admin password, configure an AI key, and pair the phone.
