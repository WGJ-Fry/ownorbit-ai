# GitHub Release Guide / GitHub 发布指南

中文 | [English](#english)

## 发布前确认

运行：

```bash
npm run release:feed
npm run release:check:signed:file
```

当前已通过：

```text
172 passed, 0 warnings, 0 failures
```

当前仓库已经通过严格 unsigned 发布检查。做 signed macOS 公开发布时，使用 `.env.signing.local` 或当前 shell 注入签名/公证环境后，再运行 `npm run release:check:signed:file`。

## 创建 Release

1. 在 GitHub 创建仓库。
2. 上传代码，不要上传 `release/`、`node_modules/`、`.env*`、证书、数据库。
3. 打开 GitHub 仓库的 Releases。
4. New release。
5. Tag 填：

   ```text
   v0.0.0
   ```

6. Title 填：

   ```text
   LifeOS AI 0.0.0
   ```

7. 上传 [release-assets.md](release-assets.md) 里列出的文件。
8. Release 正文使用下面模板。

## Release 正文模板

```markdown
## LifeOS AI 0.0.0

LifeOS AI is a desktop local core plus mobile PWA personal AI system.

### Downloads

- macOS Apple Silicon: `LifeOS AI-0.0.0-arm64.dmg`
- Windows x64: `LifeOS AI Setup 0.0.0.exe`
- Linux x64: `LifeOS AI-0.0.0.AppImage`

### Install

macOS: open the DMG and drag LifeOS AI to Applications.

Windows: run the installer. This build is not Windows Authenticode signed yet, so SmartScreen may show an unknown-publisher warning.

Linux:

```bash
chmod +x "LifeOS AI-0.0.0.AppImage"
./"LifeOS AI-0.0.0.AppImage"
```

### Verification

SHA256:

```text
a935ab398d8b88a1e47de9645bdf7f46372b3da14fd7b8ab09fbc00f83904b7a  LifeOS AI-0.0.0-arm64.dmg
ebacb858194ae884c0770820536450e72514b8fee7fdd329933610d70c769022  LifeOS AI Setup 0.0.0.exe
12b2c32148cff4a3bc3cd2247d4c4b17b1709624b77ea2853785b39a3cf0f279  LifeOS AI-0.0.0.AppImage
```

### Notes

- macOS build is Developer ID signed, notarized, and stapled.
- Windows build is usable but not Authenticode signed yet.
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
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.0.0"
   ```

4. 重新打包并发布。

不要把 `LIFEOS_UPDATE_URL` 指向单个文件；它必须是包含 feed 文件的目录。

## 我还没有考虑到但发布前很重要的事

- Windows 未签名会影响普通用户信任度，正式对外建议购买 Authenticode 证书。
- 版本号现在是 `0.0.0`，正式公开前最好改成 `0.1.0` 或 `1.0.0-beta.1`。
- GitHub Release 的资产名包含空格，用户可正常下载，但命令行说明要加引号。
- macOS 当前包是 Apple Silicon arm64；Intel Mac 需要额外构建 x64 或 universal。
- 不要公开你的 AI Key、Apple App 专用密码、证书密码、`.p12` 文件。
- 发布后从另一台机器实际下载安装一次，确认首次启动、管理员设置、AI Key 配置、手机绑定都通。

---

# English

## Pre-Release Check

Run:

```bash
npm run release:feed
LIFEOS_DISTRIBUTION=signed npm run release:check
```

Current result:

```text
165 passed, 1 warning, 0 failures
```

The only warning is that `LIFEOS_UPDATE_URL` is not set. Manual download/install is ready; auto-update can be wired later.

## Create a Release

1. Create the GitHub repository.
2. Push source code, but do not push `release/`, `node_modules/`, `.env*`, certificates, or databases.
3. Open GitHub Releases.
4. New release.
5. Tag:

   ```text
   v0.0.0
   ```

6. Title:

   ```text
   LifeOS AI 0.0.0
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
   LIFEOS_UPDATE_URL="https://github.com/<owner>/<repo>/releases/download/v0.0.0"
   ```

4. Repackage and publish.

`LIFEOS_UPDATE_URL` must point to a directory containing feed files, not a single installer or yml file.

## Important Gaps Before Wider Public Distribution

- Windows is not Authenticode signed yet, so SmartScreen may warn users.
- Version is currently `0.0.0`; consider `0.1.0` or `1.0.0-beta.1` before public launch.
- Asset names contain spaces; command-line examples must quote file names.
- macOS artifact is Apple Silicon arm64 only; Intel Macs need x64 or universal builds.
- Never publish AI keys, Apple app-specific passwords, certificate passwords, or `.p12` files.
- Test the downloaded release on another machine before announcing it.
