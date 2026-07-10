# LifeOS Native Apple Mobile Shell

This directory contains the source-only iOS native shell candidate. It is not an App Store release and is not included in the public desktop packages.

## What works

- SwiftUI first-run screen with English and Simplified Chinese resources.
- Import of `lifeos-mobile-entry-*.json` through the iOS Files picker, including iCloud Drive.
- Exact SHA-256 verification compatible with the desktop `JSON.stringify` packet contract. This detects accidental modification; it is not a server identity signature.
- Version, expiry, endpoint-origin, HTTPS/private-LAN, and LifeOS health validation.
- Persistent non-secret entry metadata and a restricted same-origin `WKWebView` for `/mobile/chat`.
- Custom `lifeos://connect?baseUrl=...` deep link for future Shortcut-assisted setup. The address is validated and must prove `/api/v1/health` is a LifeOS local core.
- Explicit opt-in private CloudKit pull for approved chat, memory, task, generated-app-state, and review-only device metadata records.
- Incremental private-database change tokens, database push subscription, foreground recovery, payload SHA-256/size/schema validation, and a Data Protection-backed offline snapshot.
- Anonymous per-account snapshot isolation, `CKAccountChanged` cleanup, expired-change-token zone rebuild, bounded multi-page catch-up, and CloudKit retry/backoff without exposing technical errors to the user.
- A bilingual native offline data browser. It is intentionally read-only while Mac-side conflict quarantine and review remain authoritative.

The shell does not copy an AI key, admin password, device token, private key, session cookie, SQLite database, backup, or raw CloudKit credential into `UserDefaults` or iCloud. Device credentials remain in the LifeOS web session storage. A user must still confirm the computer through the normal pairing QR before the phone receives access.

## Build and verify

Install XcodeGen once, then build the unsigned simulator app:

```bash
brew install xcodegen
npm run mobile:native:build
```

Run Swift unit tests on an available iPhone Simulator:

```bash
LIFEOS_IOS_NATIVE_RUN_TESTS=1 npm run mobile:native:build
```

With a local LifeOS core running, install, launch, and capture simulator evidence:

```bash
npm run mobile:native:smoke -- http://127.0.0.1:3000
```

After the Apple account holder has accepted the current developer agreement and created the shared container, build for a physical iPhone with automatic signing:

```bash
export LIFEOS_CLOUDKIT_TEAM_ID="YOUR_TEAM_ID"
export LIFEOS_CLOUDKIT_CONTAINER_ID="iCloud.ai.lifeos.desktop"
export LIFEOS_CLOUDKIT_MOBILE_BUNDLE_ID="ai.lifeos.mobile"
export LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES=1
npm run mobile:native:device:build
```

Generated Xcode projects, app bundles, test results, screenshots, and evidence stay under ignored `build/` and `tmp/` directories.

## Remaining Apple gates

- A physical iPhone build still needs a valid Apple development team and provisioning profile.
- The CloudKit engine and entitlement are implemented, but a real successful private-database exchange still needs the LifeOS iCloud Container, accepted Apple Developer agreement, matching provisioning profiles, and signed Mac/iPhone builds.
- Simulator evidence does not prove iCloud Files delivery, cellular access, Wi-Fi switching, restart recovery, or long-running background synchronization.

## 中文说明

这里是 LifeOS iOS 原生壳的源码候选版本，目前不是 App Store 正式版本，也不会混入公开桌面安装包。

当前可以从 iPhone“文件”App 选择 `lifeos-mobile-entry-*.json`，校验入口版本、SHA-256、有效期、地址安全边界和 LifeOS 健康接口，然后在受限的同源 `WKWebView` 中打开手机聊天。原生壳还加入了需要用户明确开启的 CloudKit 私有库增量拉取、变更游标、后台推送订阅、前台恢复、记录完整性校验、Data Protection 离线快照和中英文只读数据页。离线副本按匿名 Apple 账号指纹隔离；账号变化会先清除旧副本，游标过期会只重建对应 zone，多页与临时失败会自动续拉或退避重试。AI Key、管理员密码、设备 token、私钥、会话 Cookie、SQLite、备份和 CloudKit 凭证都不会写入同步数据。

代码和 entitlement 已经具备，但“真实 CloudKit 已跑通”仍需 Apple 账号持有人接受协议、创建共享 Container、生成匹配的 Mac/iPhone provisioning profile，并完成两台真实设备的数据往返、后台推送和长测证据。在这些证据完成前，项目仍只把它标为原生同步候选能力。
