# Release Assets / 发布资产清单

中文 | [English](#english)

## 当前版本

版本：`0.0.0`

推荐 GitHub Release tag：

```text
v0.0.0
```

## 必传文件

从 `release/` 上传：

```text
LifeOS AI-0.0.0-arm64.dmg
LifeOS AI Setup 0.0.0.exe
LifeOS AI-0.0.0.AppImage
SHA256SUMS
```

## 建议同时上传的更新文件

从 `release/update-feed/` 上传：

```text
latest-mac.yml
latest.yml
latest-linux.yml
release-manifest.json
```

如果未来启用自动更新，安装包会读取这些 feed 文件。即使当前没有配置 `LIFEOS_UPDATE_URL`，也建议先上传，方便后续排障和核验。

## 当前 SHA256

```text
a935ab398d8b88a1e47de9645bdf7f46372b3da14fd7b8ab09fbc00f83904b7a  LifeOS AI-0.0.0-arm64.dmg
ebacb858194ae884c0770820536450e72514b8fee7fdd329933610d70c769022  LifeOS AI Setup 0.0.0.exe
12b2c32148cff4a3bc3cd2247d4c4b17b1709624b77ea2853785b39a3cf0f279  LifeOS AI-0.0.0.AppImage
```

## 平台说明

- macOS：支持 Developer ID Application 签名 + Apple notarization + DMG stapled 的正式发布路径；如果本地没有签名环境，则应按 unsigned/Gatekeeper 流程说明发布。
- Windows：NSIS 安装包可用，但未配置 Windows Authenticode 正式签名，SmartScreen 可能提示未知发布者。
- Linux：AppImage 可用，通常通过 SHA256 校验完整性。

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

1. GitHub Release 页面能看到三平台二进制和 `SHA256SUMS`。
2. 下载 macOS DMG 后可以正常打开。
3. 下载 Windows EXE 后文件大小约 106 MB。
4. 下载 Linux AppImage 后可执行权限需要用户自行设置。
5. `release-manifest.json` 里的文件名、大小和 sha256 与 Release 资产一致。

---

# English

## Current Version

Version: `0.0.0`

Recommended GitHub Release tag:

```text
v0.0.0
```

## Required Assets

Upload from `release/`:

```text
LifeOS AI-0.0.0-arm64.dmg
LifeOS AI Setup 0.0.0.exe
LifeOS AI-0.0.0.AppImage
SHA256SUMS
```

## Recommended Feed Assets

Upload from `release/update-feed/`:

```text
latest-mac.yml
latest.yml
latest-linux.yml
release-manifest.json
```

These files are required for future auto-update support and are useful for support diagnostics even before `LIFEOS_UPDATE_URL` is configured.

## Current SHA256

```text
a935ab398d8b88a1e47de9645bdf7f46372b3da14fd7b8ab09fbc00f83904b7a  LifeOS AI-0.0.0-arm64.dmg
ebacb858194ae884c0770820536450e72514b8fee7fdd329933610d70c769022  LifeOS AI Setup 0.0.0.exe
12b2c32148cff4a3bc3cd2247d4c4b17b1709624b77ea2853785b39a3cf0f279  LifeOS AI-0.0.0.AppImage
```

## Platform Notes

- macOS: the repo supports a Developer ID signed, Apple notarized, stapled DMG release path. If signing variables are not present, treat the build as unsigned and publish it with Gatekeeper fallback instructions instead.
- Windows: NSIS installer is usable but not Authenticode signed yet, so SmartScreen may warn about an unknown publisher.
- Linux: AppImage is usable; integrity is normally verified with SHA256.

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

1. The GitHub Release shows all three platform binaries and `SHA256SUMS`.
2. macOS DMG downloads and opens normally.
3. Windows EXE download size is about 106 MB.
4. Linux AppImage requires users to set executable permission.
5. `release-manifest.json` file names, sizes, and sha256 values match the uploaded assets.
