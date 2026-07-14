# OwnOrbit AI Brand Migration / 品牌迁移说明

LifeOS AI is now **OwnOrbit AI**. The new name expresses the product model more clearly: your AI, your data, and your devices stay inside an orbit you control.

LifeOS AI 现已更名为 **OwnOrbit AI**。新名称更准确地表达了产品理念：你的 AI、你的数据和你的设备，都运行在由你掌控的私人轨道里。

## What Changes / 会变化的内容

- Product display name: `OwnOrbit AI`
- Mobile display name: `OwnOrbit Mobile`
- GitHub repository: `WGJ-Fry/ownorbit-ai`
- npm package metadata: `ownorbit-ai`
- New desktop package names begin with `OwnOrbit AI`
- New iCloud handoff folders use `iCloud Drive/OwnOrbit AI`

## What Stays Compatible / 保持兼容的内容

The following technical identifiers intentionally keep the former `lifeos` name. Changing them would break upgrades, local data, device credentials, automation, or published downloads.

以下技术标识会有意保留旧的 `lifeos` 名称。贸然修改会破坏升级、本地数据、设备凭证、自动化或已经公开的下载文件。

- Environment variables such as `LIFEOS_DATA_DIR`, `LIFEOS_ADMIN_PASSWORD`, and `LIFEOS_*`
- Desktop application ID `ai.lifeos.desktop`
- Existing local storage, cookie, database, API header, and file identifiers
- CloudKit record and zone identifiers already used by Apple sync prototypes
- Existing `lifeos-mobile-entry.*` iCloud handoff files
- Existing GHCR image `ghcr.io/wgj-fry/lifeos-ai:v0.1.5-alpha`
- Historical `v0.1.5-alpha` assets named `LifeOS.AI.*`

## Existing Desktop Data / 已有桌面数据

On upgrade, OwnOrbit checks the former `LifeOS AI` desktop user-data directory. If it contains data and the new OwnOrbit directory does not, the desktop app keeps using the former directory automatically. SQLite data, settings, backups, secrets, device bindings, and audit records remain available.

升级时，OwnOrbit 会检查原来的 `LifeOS AI` 桌面数据目录。如果旧目录已有数据而新目录尚无数据，桌面端会自动继续使用旧目录。SQLite 数据、设置、备份、密钥、设备绑定和审计记录都不会因为改名丢失。

## Existing iCloud Handoff / 已有 iCloud 接力文件

Fresh installations create `iCloud Drive/OwnOrbit AI`. Existing installations continue using `iCloud Drive/LifeOS AI` when that folder already exists. OwnOrbit does not force-move the folder, so saved Files shortcuts and existing handoff entries keep working.

全新安装会创建 `iCloud Drive/OwnOrbit AI`。如果升级用户已经有 `iCloud Drive/LifeOS AI`，OwnOrbit 会继续使用旧目录，不强制移动文件，避免破坏“文件”App 快捷入口和已有手机接力文件。

## Release Transition / 发布过渡

The public `v0.1.5-alpha` release predates the rename, so its executable names and screenshots still show LifeOS AI. The next packaged release will use OwnOrbit AI branding. Verify every historical download against the `SHA256SUMS` file from its own Release page.

公开的 `v0.1.5-alpha` 发布早于本次改名，因此其可执行文件名和截图仍显示 LifeOS AI。下一个安装包版本会使用 OwnOrbit AI 品牌。校验旧下载时，请始终使用同一 Release 页面中的 `SHA256SUMS`。
