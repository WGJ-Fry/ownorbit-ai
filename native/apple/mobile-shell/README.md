# LifeOS Native Apple Mobile Shell

This directory contains the source-only iOS native shell candidate. It is not an App Store release and is not included in the public desktop packages.

## What works

- SwiftUI first-run screen with English and Simplified Chinese resources.
- Import of `lifeos-mobile-entry-*.json` through the iOS Files picker, including iCloud Drive.
- Exact SHA-256 verification compatible with the desktop `JSON.stringify` packet contract. This detects accidental modification; it is not a server identity signature.
- Version, expiry, endpoint-origin, HTTPS/private-LAN, and LifeOS health validation.
- Persistent non-secret entry metadata and a restricted same-origin `WKWebView` for `/mobile/chat`.
- Custom `lifeos://connect?baseUrl=...` deep link for future Shortcut-assisted setup. The address is validated and must prove `/api/v1/health` is a LifeOS local core.

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

Generated Xcode projects, app bundles, test results, screenshots, and evidence stay under ignored `build/` and `tmp/` directories.

## Remaining Apple gates

- A physical iPhone build still needs a valid Apple development team and provisioning profile.
- CloudKit data sync still needs the LifeOS iCloud Container, entitlement, accepted Apple Developer agreement, and real-device background push tests.
- Simulator evidence does not prove iCloud Files delivery, cellular access, Wi-Fi switching, restart recovery, or long-running background synchronization.

## 中文说明

这里是 LifeOS iOS 原生壳的源码候选版本，目前不是 App Store 正式版本，也不会混入公开桌面安装包。

当前可以从 iPhone“文件”App 选择 `lifeos-mobile-entry-*.json`，校验入口版本、SHA-256、有效期、地址安全边界和 LifeOS 健康接口，然后在受限的同源 `WKWebView` 中打开手机聊天。原生壳只保存不含密钥的入口元数据；AI Key、管理员密码、设备 token、私钥、会话 Cookie、SQLite、备份和 CloudKit 凭证都不会写入 `UserDefaults` 或 iCloud。

真实 iPhone 安装仍需要 Apple 开发签名和 provisioning profile；真正 CloudKit 数据同步还需要 Container、entitlement、Apple 协议以及后台推送和真实设备长测。
