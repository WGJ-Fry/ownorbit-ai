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

当前仓库包含 `Desktop Package Artifacts` GitHub Actions workflow。推送 `v*` tag 后，它会在 macOS、Windows、Linux 三个平台分别构建并验证安装包，然后由 `publish-draft` job 聚合安装包、`SHA256SUMS`、安装说明、`latest*.yml` 和 `release-manifest.json`，一次性上传到同一个 GitHub Release 草稿，避免多个平台同时上传同名元数据。

```bash
git tag v0.1.5-alpha
git push origin v0.1.5-alpha
```

然后打开 GitHub Actions，等待 `Desktop Package Artifacts` 三个平台都成功。成功后到 Releases 页面检查 draft：

1. 确认 macOS、Windows、Linux 资产都已上传。
2. 确认 `SHA256SUMS`、`USER-INSTALL.md`、`latest*.yml`、`release-manifest.json` 都在 Release 资产里。
3. 从 Release 页面下载一次安装包，在另一台机器或干净用户目录验证首次启动。
4. 没问题后再把 draft 发布为正式 Release。

发布 draft 后，跑一次公开入口检查。它会确认 GHCR 镜像不用登录也能拉取，并确认 `v0.1.5-alpha` Release 已经公开可见：

```bash
LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch
```

然后检查 GitHub 仓库公开展示状态：

```bash
npm run github:public:check
```

如果输出提示 Latest 指向旧版本、任何低于当前版本的 stable Release 仍可能抢 Latest、旧 Release 未标废弃、仓库描述为空或 Discussions 未开启，使用带仓库管理权限的 token 修复：

```bash
GITHUB_TOKEN="github_pat_..." npm run github:public:fix
```

`github:public:fix` 会尝试：

1. 把仓库描述改成：

   ```text
   Open-source, self-hosted, local-first personal AI assistant and private second brain with memory, mobile access, and generated problem-solving tools.
   ```

2. 开启 Discussions，让普通安装/使用问题不要全部进入 Issues。
3. 把任何低于当前推荐版本的旧 stable Release 标记为 prerelease，避免它继续抢 GitHub 的 Latest release。
4. 把 `v0.0.0` 标记为 deprecated / 已废弃，并引导用户使用 `v0.1.5-alpha`。
5. 更新 `v0.1.5-alpha` Release 正文，让 Release 页面本身也能独立说明下载、安装、校验和 unsigned alpha 限制。

如果 token 只有 Contents 权限，Release 正文可能能改，但仓库描述和 Discussions 可能会失败。这时需要给 fine-grained token 增加 `Administration: Read and write`，或在 GitHub 网页仓库 Settings 里手动修改。

手动触发这个 workflow 时，它只会生成 Actions artifact；只有 `v*` tag 触发时才会写入 GitHub Release 草稿。

## GitHub 仓库设置

公开推广前，仓库设置必须满足：

- Repository description 已填写，不为空。
- Discussions 已开启。
- Issues 保持开启，但 `.github/ISSUE_TEMPLATE/config.yml` 会把普通支持问题引导到 Discussions。
- `v0.1.5-alpha` 是当前推荐公开入口。
- 任何低于当前推荐版本的旧 stable Release 都不能继续作为 GitHub Latest 误导用户。
- `v0.0.0` 必须清楚标记为 deprecated / 已废弃，或直接删除旧 Release。
- Release 页面正文要写清楚：macOS 是 unsigned ZIP，Windows 未 Authenticode 签名，Linux AppImage 未签名，自动更新尚未启用。

## 创建 Release

1. 在 GitHub 创建仓库。
2. 上传代码，不要上传 `release/`、`node_modules/`、`.env*`、证书、数据库。
3. 优先使用上面的 CI 草稿流程；如果必须手工发布，再打开 GitHub 仓库的 Releases。
4. New release。
5. Tag 填：

   ```text
   v0.1.5-alpha
   ```

6. Title 填：

   ```text
   LifeOS AI 0.1.3 Alpha
   ```

7. 上传 [release-assets.md](release-assets.md) 里列出的文件。
8. Release 正文使用下面模板。

## Release 正文模板

```markdown
## LifeOS AI 0.1.3 Alpha

LifeOS AI is a desktop local core plus mobile PWA personal AI system.

### Downloads

- macOS Apple Silicon unsigned ZIP: `LifeOS.AI-0.1.5-alpha.0-arm64-unsigned.zip`
- Windows x64 NSIS installer: `LifeOS.AI.Setup.0.1.5-alpha.0.exe`
- Linux x64 AppImage: `LifeOS.AI-0.1.5-alpha.0.AppImage`
- Checksum: `SHA256SUMS`
- Install guide: `USER-INSTALL.md`
- macOS unsigned fallback guide: `INSTALL-unsigned-mac.md`

### Install

macOS: download the unsigned ZIP, unzip it, drag `LifeOS AI.app` to Applications, then follow `INSTALL-unsigned-mac.md` if Gatekeeper blocks the first launch.

Windows: download the NSIS `.exe` and follow the SmartScreen warning guidance in `USER-INSTALL.md`.

Linux: download the AppImage, run `chmod +x "LifeOS.AI-0.1.5-alpha.0.AppImage"`, then launch it.

### Verification

GitHub asset URLs use dot-separated filenames. The uploaded `SHA256SUMS` file may list the original electron-builder filenames with spaces; compare the hash value if your downloaded filename differs.

SHA256:

```text
Use the SHA256SUMS generated for the current v0.1.5-alpha Release draft.
Do not reuse hashes from v0.1.2-alpha or earlier releases.
```

### Notes

- macOS build is unsigned and may require the macOS Open Anyway flow.
- Windows is not Authenticode signed yet, so SmartScreen may warn about an unknown publisher.
- Linux AppImage is unsigned; verify `SHA256SUMS` before first launch.
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

当前公开 unsigned alpha 包默认走手动更新。以后启用 feed 检查时，需要：

1. 选择稳定 HTTPS 地址。
2. 上传安装包和对应 `latest*.yml` 到同一目录。
3. 构建 signed 分发版时设置：

   ```bash
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.5-alpha"
   LIFEOS_DISTRIBUTION=signed
   ```

4. 如果仍是 unsigned alpha，只能作为显式 opt-in 测试：

   ```bash
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.5-alpha"
   LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1
   ```

5. 重新打包并发布。

不要把 `LIFEOS_UPDATE_URL` 指向单个文件；它必须是包含 feed 文件的目录。unsigned alpha 只设置 URL 不会自动启用更新检查，signed 分发版可以在安全 HTTPS feed 下默认启用。

## 我还没有考虑到但发布前很重要的事

- Windows 未签名会影响普通用户信任度，正式对外建议购买 Authenticode 证书。
- 版本号已升级为 `0.1.5-alpha.0`；后续更稳定后可再考虑 `0.2.0-beta.1`、`1.0.0-beta.1` 或 `1.0.0`。
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

This repository includes the `Desktop Package Artifacts` GitHub Actions workflow. When you push a `v*` tag, it builds and verifies packages on macOS, Windows, and Linux. A separate `publish-draft` job then aggregates the installers, `SHA256SUMS`, install guides, `latest*.yml`, and `release-manifest.json`, and uploads them to one GitHub Release draft so platform jobs do not race while uploading same-name metadata.

```bash
git tag v0.1.5-alpha
git push origin v0.1.5-alpha
```

Then open GitHub Actions and wait until all three `Desktop Package Artifacts` jobs pass. After that, open the draft Release:

1. Confirm macOS, Windows, and Linux assets are present.
2. Confirm `SHA256SUMS`, `USER-INSTALL.md`, `latest*.yml`, and `release-manifest.json` are attached.
3. Download from the Release page and test first launch on another machine or clean user profile.
4. Publish the draft only after the downloaded package is verified.

After publishing the draft, run the public launch check. It confirms the GHCR image is anonymously pullable and that the `v0.1.5-alpha` Release is publicly visible:

```bash
LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch
```

Then check the public GitHub repository state:

```bash
npm run github:public:check
```

If it reports a stale Latest release, any older stable release that can still steal Latest, an undeclared deprecated release, an empty repository description, or disabled Discussions, run the fixer with a token that has repository administration permission:

```bash
GITHUB_TOKEN="github_pat_..." npm run github:public:fix
```

`github:public:fix` attempts to:

1. Set the repository description to:

   ```text
   Open-source, self-hosted, local-first personal AI assistant and private second brain with memory, mobile access, and generated problem-solving tools.
   ```

2. Enable Discussions so user support does not all land in Issues.
3. Mark any older stable Release below the current recommended version as a prerelease so it no longer steals GitHub's Latest release label.
4. Mark `v0.0.0` as deprecated and point users to `v0.1.5-alpha`.
5. Refresh the `v0.1.5-alpha` Release body so the Release page itself explains downloads, install, verification, and unsigned alpha limits.

If the token only has Contents permission, Release edits may work while repository description and Discussions fail. In that case, add `Administration: Read and write` to the fine-grained token, or update those settings in the GitHub web UI.

Manual workflow runs still produce Actions artifacts only; GitHub Release drafts are updated only for `v*` tag runs.

## GitHub Repository Settings

Before public promotion, the repository should satisfy:

- Repository description is present.
- Discussions are enabled.
- Issues stay enabled, while `.github/ISSUE_TEMPLATE/config.yml` routes ordinary support questions to Discussions.
- `v0.1.5-alpha` is the recommended public entry.
- No older stable Release below the current recommended version appears as GitHub Latest.
- `v0.0.0` is clearly marked deprecated, or the old Release is deleted.
- The Release body clearly states the unsigned macOS ZIP, unsigned Windows installer, unsigned Linux AppImage, and disabled auto-update status.

## Create a Release

1. Create the GitHub repository.
2. Push source code, but do not push `release/`, `node_modules/`, `.env*`, certificates, or databases.
3. Prefer the CI draft flow above; if you must publish manually, open GitHub Releases.
4. New release.
5. Tag:

   ```text
   v0.1.5-alpha
   ```

6. Title:

   ```text
   LifeOS AI 0.1.3 Alpha
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

The current public unsigned alpha uses manual updates. To enable feed checks later:

1. Pick a stable HTTPS directory.
2. Upload the installer and matching `latest*.yml` files to the same directory.
3. Build signed distributions with:

   ```bash
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.5-alpha"
   LIFEOS_DISTRIBUTION=signed
   ```

4. If the build is still unsigned alpha, use explicit opt-in only for testing:

   ```bash
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.5-alpha"
   LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1
   ```

5. Repackage and publish.

`LIFEOS_UPDATE_URL` must point to a directory containing feed files, not a single installer or yml file. For unsigned alpha builds, setting only the URL does not enable update checks; signed distributions can use a safe HTTPS feed as the default update path.

## Important Gaps Before Wider Public Distribution

- Windows is not Authenticode signed yet, so SmartScreen may warn users.
- Version is now `0.1.5-alpha.0`; consider `0.2.0-beta.1`, `1.0.0-beta.1`, or `1.0.0` once the project is ready for a broader stable launch.
- Asset names contain spaces; command-line examples must quote file names.
- macOS artifact is Apple Silicon arm64 only; Intel Macs need x64 or universal builds.
- Never publish AI keys, Apple app-specific passwords, certificate passwords, or `.p12` files.
- Test the downloaded release on another machine before announcing it.
