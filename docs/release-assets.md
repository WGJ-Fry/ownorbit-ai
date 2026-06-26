# Release Assets / 发布资产清单

中文 | [English](#english)

## 当前版本

版本：`0.1.3-alpha.0`

推荐 GitHub Release tag：

```text
v0.1.3-alpha
```

## 发布草稿必须包含的公开文件

`v0.1.3-alpha` GitHub Release 草稿必须上传下面这些文件。发布前请先确认 GitHub Actions 产物或本地重新打包产物真实存在：

```text
LifeOS.AI-0.1.3-alpha.0-arm64-unsigned.zip
LifeOS.AI.Setup.0.1.3-alpha.0.exe
LifeOS.AI-0.1.3-alpha.0.AppImage
SHA256SUMS
INSTALL-unsigned-mac.md
USER-INSTALL.md
latest-mac.yml
latest.yml
latest-linux.yml
release-manifest.json
```

`SHA256SUMS` 或本地 electron-builder 输出可能使用空格文件名。它们对应同一批资产：

```text
LifeOS AI-0.1.3-alpha.0-arm64-unsigned.zip
LifeOS AI Setup 0.1.3-alpha.0.exe
LifeOS AI-0.1.3-alpha.0.AppImage
```

## 仍待正式签名后再上传

下面这些是正式分发目标，不是当前公开 alpha 资产。只有在签名、公证或签名策略确认后再作为正式下载入口：

```text
LifeOS AI-0.1.3-alpha.0-arm64.dmg
signed LifeOS.AI.Setup.0.1.3-alpha.0.exe
```

如果未来启用自动更新，安装包会读取这些 feed 文件。当前没有配置 `LIFEOS_UPDATE_URL`，所以 update feed 主要用于诊断和后续准备。

## 当前 SHA256

GitHub 下载资产名使用点号；上传的 `SHA256SUMS` 可能保留 electron-builder 生成的空格文件名。如果本地文件名不同，直接比对 SHA256 值即可。

```text
请以 `v0.1.3-alpha` Release 草稿里的 `SHA256SUMS` 为准。
不要复用 `v0.1.2-alpha` 或更早版本的 SHA256。
```

## 平台说明

- macOS：当前公开资产是 unsigned ZIP。正式路径仍支持 Developer ID Application 签名 + Apple notarization + DMG stapled，但需要重新生成并上传真实 DMG。
- Windows：当前公开资产是 unsigned NSIS EXE。尚未 Authenticode 签名，SmartScreen 可能提示未知发布者。
- Linux：当前公开资产是 AppImage。运行前需要 `chmod +x`，并建议先校验 SHA256。

## 不要上传

不要上传：

```text
.env.local
.env.signing.local
*.p12
*.pfx
data/
node_modules/
dist/
release/*-unpacked/
```

## 上传后检查

1. GitHub Release 页面能看到 macOS unsigned ZIP、Windows EXE、Linux AppImage、`SHA256SUMS`、安装说明和 `release-manifest.json`。
2. 下载 macOS ZIP 后可以解压出 `LifeOS AI.app`。
3. `SHA256SUMS` 与下载文件校验一致。
4. `release-manifest.json` 里的文件名、大小和 sha256 与 Release 资产一致。
5. Windows/Linux 下载说明指向真实存在的 `v0.1.3-alpha` 资产。

---

# English

## Current Version

Version: `0.1.3-alpha.0`

Recommended GitHub Release tag:

```text
v0.1.3-alpha
```

## Public Assets Required In The Release Draft

The `v0.1.3-alpha` GitHub Release draft must upload the following files. Before publishing, confirm the GitHub Actions artifacts or locally rebuilt artifacts actually exist:

```text
LifeOS.AI-0.1.3-alpha.0-arm64-unsigned.zip
LifeOS.AI.Setup.0.1.3-alpha.0.exe
LifeOS.AI-0.1.3-alpha.0.AppImage
SHA256SUMS
INSTALL-unsigned-mac.md
USER-INSTALL.md
latest-mac.yml
latest.yml
latest-linux.yml
release-manifest.json
```

`SHA256SUMS` or local electron-builder output may use filenames with spaces. They refer to the same assets:

```text
LifeOS AI-0.1.3-alpha.0-arm64-unsigned.zip
LifeOS AI Setup 0.1.3-alpha.0.exe
LifeOS AI-0.1.3-alpha.0.AppImage
```

## Upload Later After Formal Signing

These are formal distribution targets, not the current public alpha assets. Upload them only after signing, notarization, or signing-policy review:

```text
LifeOS AI-0.1.3-alpha.0-arm64.dmg
signed LifeOS.AI.Setup.0.1.3-alpha.0.exe
```

These feed files are required for future auto-update support. Because `LIFEOS_UPDATE_URL` is not configured yet, the current feed files are mostly for diagnostics and future preparation.

## Current SHA256

GitHub asset URLs use dot-separated filenames. The uploaded `SHA256SUMS` file may keep the original electron-builder filenames with spaces; compare the SHA256 value if your local filename differs.

```text
Use the `SHA256SUMS` file attached to the `v0.1.3-alpha` Release draft.
Do not reuse `v0.1.2-alpha` or older SHA256 values.
```

## Platform Notes

- macOS: the current public asset is an unsigned ZIP. The formal path still supports Developer ID signing, Apple notarization, and a stapled DMG, but a real DMG must be regenerated and uploaded first.
- Windows: the current public asset is an unsigned NSIS EXE. It is not Authenticode signed yet, so SmartScreen may warn about an unknown publisher.
- Linux: the current public asset is an AppImage. Mark it executable with `chmod +x` and verify SHA256 before running it.

## Do Not Upload

Do not upload:

```text
.env.local
.env.signing.local
*.p12
*.pfx
data/
node_modules/
dist/
release/*-unpacked/
```

## Post-Upload Check

1. The GitHub Release shows the macOS unsigned ZIP, Windows EXE, Linux AppImage, `SHA256SUMS`, install guides, and `release-manifest.json`.
2. The macOS ZIP downloads and extracts to `LifeOS AI.app`.
3. `SHA256SUMS` verifies the downloaded file.
4. `release-manifest.json` file names, sizes, and sha256 values match the uploaded assets.
5. Windows/Linux download instructions point to real `v0.1.3-alpha` assets.
