# GitHub Release Guide / GitHub 发布指南

中文 | [English](#english)

## 发布前确认

运行：

```bash
npm run release:artifacts:check
npm run release:feed
npm run release:check:signed:file
```

`release:artifacts:check` 会阻止误上传旧版本安装包。当前仓库已经通过严格 unsigned 发布检查。做 signed macOS 公开发布时，使用 `.env.signing.local` 或当前 shell 注入签名/公证环境后，再运行 `npm run release:check:signed:file`。

## 推荐：用 CI 生成 Release 草稿

当前仓库包含 `Desktop Package Artifacts` GitHub Actions workflow。推送 `v*` tag 后，它会在 macOS、Windows、Linux 三个平台分别构建并验证安装包，然后把安装包、`SHA256SUMS`、安装说明、`latest*.yml` 和 `release-manifest.json` 上传到同一个 GitHub Release 草稿。

```bash
git tag v0.1.1-alpha.0
git push origin v0.1.1-alpha.0
```

然后打开 GitHub Actions，等待 `Desktop Package Artifacts` 三个平台都成功。成功后到 Releases 页面检查 draft：

1. 确认 macOS、Windows、Linux 资产都已上传。
2. 确认 `SHA256SUMS`、`USER-INSTALL.md`、`latest*.yml`、`release-manifest.json` 都在 Release 资产里。
3. 从 Release 页面下载一次安装包，在另一台机器或干净用户目录验证首次启动。
4. 没问题后再把 draft 发布为正式 Release。

手动触发这个 workflow 时，它只会生成 Actions artifact；只有 `v*` tag 触发时才会写入 GitHub Release 草稿。

## 创建 Release

1. 在 GitHub 创建仓库。
2. 上传代码，不要上传 `release/`、`node_modules/`、`.env*`、证书、数据库。
3. 优先使用上面的 CI 草稿流程；如果必须手工发布，再打开 GitHub 仓库的 Releases。
4. New release。
5. Tag 填：

   ```text
   v0.1.0
   ```

6. Title 填：

   ```text
   LifeOS AI 0.1.0
   ```

7. 上传 [release-assets.md](release-assets.md) 里列出的文件。
8. Release 正文使用下面模板。

## Release 正文模板

```markdown
## LifeOS AI 0.1.0

LifeOS AI is a desktop local core plus mobile PWA personal AI system.

### Downloads

- macOS Apple Silicon test build: `LifeOS.AI-0.1.0-arm64-unsigned.zip`
- Checksum: `SHA256SUMS`
- Install guide: `INSTALL-unsigned-mac.md`
- Windows x64: preparing; no EXE is uploaded in this release.
- Linux x64: preparing; no AppImage is uploaded in this release.

### Install

macOS: download the unsigned ZIP, unzip it, drag `LifeOS AI.app` to Applications, then follow `INSTALL-unsigned-mac.md` if Gatekeeper blocks the first launch.

Windows/Linux: packaging paths are wired into the project, but public binaries are not uploaded in `v0.1.0` yet.

### Verification

SHA256:

```text
50570710de1732273d62233a44aa4441e76ec6200657a7f5a1c778274eae8f0e  LifeOS AI-0.1.0-arm64-unsigned.zip
```

### Notes

- macOS build is unsigned and may require the macOS Open Anyway flow.
- Windows and Linux public binaries are intentionally withheld until real package verification is complete.
- Auto-update is not enabled until `LIFEOS_UPDATE_URL` is configured in a future release.
- On first launch, set an admin password, configure an AI provider, then bind the phone PWA.
```

## 上传代码建议

如果这是第一次推到 GitHub：

```bash
git init
git add .
git status
git commit -m "Initial LifeOS AI release"
git branch -M main
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

上传前必须确认 `git status` 没有包含：

```text
.env.local
.env.signing.local
*.p12
*.pfx
data/
release/
node_modules/
```

本项目 `.gitignore` 已忽略这些常见敏感/产物目录，但仍要手动看一眼。

## 如果要启用自动更新

当前包未设置 `LIFEOS_UPDATE_URL`，所以不会自动检查更新。以后启用时，需要：

1. 选择稳定 HTTPS 地址。
2. 上传安装包和对应 `latest*.yml` 到同一目录。
3. 构建桌面包时设置：

   ```bash
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.0"
   ```

4. 重新打包并发布。

不要把 `LIFEOS_UPDATE_URL` 指向单个文件；它必须是包含 feed 文件的目录。

## 我还没有考虑到但发布前很重要的事

- Windows 未签名会影响普通用户信任度，正式对外建议购买 Authenticode 证书。
- 版本号已升级为 `0.1.0`；后续更稳定后可再考虑 `1.0.0-beta.1` 或 `1.0.0`。
- GitHub Release 的资产名包含空格，用户可正常下载，但命令行说明要加引号。
- macOS 当前包是 Apple Silicon arm64；Intel Mac 需要额外构建 x64 或 universal。
- 不要公开你的 AI Key、Apple App 专用密码、证书密码、`.p12` 文件。
- 发布后从另一台机器实际下载安装一次，确认首次启动、管理员设置、AI Key 配置、手机绑定都通。

---

# English

## Pre-Release Check

Run:

```bash
npm run release:artifacts:check
npm run release:feed
LIFEOS_DISTRIBUTION=signed npm run release:check
```

`release:artifacts:check` blocks accidental uploads of stale installers from an older package version. If `LIFEOS_UPDATE_URL` is not set, manual download/install can still be ready while auto-update remains disabled.

## Recommended: Generate a Release Draft with CI

This repository includes the `Desktop Package Artifacts` GitHub Actions workflow. When you push a `v*` tag, it builds and verifies packages on macOS, Windows, and Linux, then uploads the installers, `SHA256SUMS`, install guides, `latest*.yml`, and `release-manifest.json` to one GitHub Release draft.

```bash
git tag v0.1.1-alpha.0
git push origin v0.1.1-alpha.0
```

Then open GitHub Actions and wait until all three `Desktop Package Artifacts` jobs pass. After that, open the draft Release:

1. Confirm macOS, Windows, and Linux assets are present.
2. Confirm `SHA256SUMS`, `USER-INSTALL.md`, `latest*.yml`, and `release-manifest.json` are attached.
3. Download from the Release page and test first launch on another machine or clean user profile.
4. Publish the draft only after the downloaded package is verified.

Manual workflow runs still produce Actions artifacts only; GitHub Release drafts are updated only for `v*` tag runs.

## Create a Release

1. Create the GitHub repository.
2. Push source code, but do not push `release/`, `node_modules/`, `.env*`, certificates, or databases.
3. Prefer the CI draft flow above; if you must publish manually, open GitHub Releases.
4. New release.
5. Tag:

   ```text
   v0.1.0
   ```

6. Title:

   ```text
   LifeOS AI 0.1.0
   ```

7. Upload the files listed in [release-assets.md](release-assets.md).
8. Use the release body template above.

## First Push

```bash
git init
git add .
git status
git commit -m "Initial LifeOS AI release"
git branch -M main
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

Before pushing, make sure `git status` does not include:

```text
.env.local
.env.signing.local
*.p12
*.pfx
data/
release/
node_modules/
```

## Future Auto-Update

`LIFEOS_UPDATE_URL` is not currently configured, so automatic updates are disabled. To enable them later:

1. Pick a stable HTTPS directory.
2. Upload the installer and matching `latest*.yml` files to the same directory.
3. Build with:

   ```bash
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.0"
   ```

4. Repackage and publish.

`LIFEOS_UPDATE_URL` must point to a directory containing feed files, not a single installer or yml file.

## Important Gaps Before Wider Public Distribution

- Windows is not Authenticode signed yet, so SmartScreen may warn users.
- Version is now `0.1.0`; consider `1.0.0-beta.1` or `1.0.0` once the project is ready for a broader stable launch.
- Asset names contain spaces; command-line examples must quote file names.
- macOS artifact is Apple Silicon arm64 only; Intel Macs need x64 or universal builds.
- Never publish AI keys, Apple app-specific passwords, certificate passwords, or `.p12` files.
- Test the downloaded release on another machine before announcing it.
