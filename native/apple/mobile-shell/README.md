# OwnOrbit Native Apple Mobile Shell

This directory contains the source-only iOS native shell candidate. It is not an App Store release and is not included in the public desktop packages.

## What works

- SwiftUI first-run screen with English and Simplified Chinese resources.
- Import of `lifeos-mobile-entry-*.json` through the iOS Files picker, including iCloud Drive.
- Exact SHA-256 verification compatible with the desktop `JSON.stringify` packet contract. This detects accidental modification; it is not a server identity signature.
- Version, expiry, endpoint-origin, HTTPS/private-LAN, and OwnOrbit health validation.
- Persistent non-secret entry metadata and a restricted same-origin `WKWebView` for `/mobile/chat`.
- Privacy-safe local notifications after opt-in: one warning 24 hours before an iCloud phone entry expires, plus one recovery reminder after three consecutive connection failures. Reconnecting or removing the entry clears pending reminders; notifications never contain a URL, desktop name, checksum, or credential.
- Custom `lifeos://connect?baseUrl=...` deep link for future Shortcut-assisted setup. The address is validated and must prove `/api/v1/health` is an OwnOrbit local core.
- Explicit opt-in private CloudKit pull for approved chat, memory, task, generated-app-state, and review-only device metadata records.
- Incremental private-database change tokens, private-database push subscription, foreground recovery, payload SHA-256/size/schema validation, and a Data Protection-backed offline snapshot. Push payloads are parsed as CloudKit notifications and ignored unless they target the private database.
- Background CloudKit wakes report `newData`, `noData`, and `failed` separately, so transient iCloud failures are not mislabeled as successful empty fetches to iOS. After explicit CloudKit opt-in, the shell also submits a `BGAppRefreshTask` fallback with a 30-minute earliest start and reschedules it after launch; iOS still decides whether and when it runs.
- Anonymous per-account snapshot isolation, `CKAccountChanged` cleanup, expired-change-token zone rebuild, bounded multi-page catch-up, and CloudKit retry/backoff without exposing technical errors to the user.
- A bilingual native offline data browser with guarded memory creation and task completion. Memory creation rejects secret-like content and cannot overwrite an existing Mac memory. Task completion submits the base content hash and an unchanged CKRecord change tag; the Mac accepts it only when the local task list still matches. Existing synced chat history, generated apps, and device-trust metadata remain read-only.
- A signed native CloudKit chat outbox. The iPhone registers a scoped P-256 public key as `LifeOSDeviceKey`, keeps the private key in device-only Keychain storage, signs each `LifeOSChatRequest`, and renders the matching `LifeOSChatResponse` with waiting, Mac unavailable, processing, retrying, completed, failed, and timeout states. The Mac worker is text-only and rejects tool/native-action requests.

The shell does not copy an AI key, admin password, device token, private key, session cookie, SQLite database, backup, or raw CloudKit credential into `UserDefaults` or iCloud. The CloudKit public key proves only the native chat request sender and never grants web access. Device credentials remain in the OwnOrbit web session storage, and normal web access still requires the pairing QR.

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

With a local OwnOrbit core running, install, launch, and capture simulator evidence:

```bash
npm run mobile:native:smoke -- http://127.0.0.1:3000

# Compile the physical iPhone target without installing or signing it.
npm run mobile:native:device:compile
```

After the Apple account holder has accepted the current developer agreement and created the shared container, build for a physical iPhone with automatic signing:

```bash
export LIFEOS_CLOUDKIT_TEAM_ID="YOUR_TEAM_ID"
export LIFEOS_CLOUDKIT_CONTAINER_ID="iCloud.ai.lifeos.desktop"
export LIFEOS_CLOUDKIT_MOBILE_BUNDLE_ID="com.wgjfry.ownorbit.mobile"
export LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES=1
npm run mobile:native:device:build

# With an unlocked paired iPhone connected, build, verify, install, and launch.
npm run mobile:native:device:install
```

Set `LIFEOS_IOS_DEVICE_ID` only when more than one available Apple device is connected. Installation verifies the app signature, bundle identifier, CloudKit container, and APNs entitlement before touching the device, then writes a redacted evidence file under ignored `build/native/mobile-shell/` without the device identifier or local app path.

Generated Xcode projects, app bundles, test results, screenshots, and evidence stay under ignored `build/` and `tmp/` directories.

## Remaining Apple gates

- A physical iPhone build still needs a valid Apple development team and provisioning profile.
- The CloudKit engine and entitlement are implemented, but a real successful private-database exchange still needs the OwnOrbit iCloud Container, accepted Apple Developer agreement, matching provisioning profiles, and signed Mac/iPhone builds.
- Simulator evidence verifies the background-task identifier, capabilities, registration path, opt-in policy, completion guard, and app compilation. It does not prove that iOS will execute a scheduled refresh, deliver a CloudKit push, move an iCloud file, preserve cellular access, recover after Wi-Fi switching/restart, or sustain long-running synchronization on a physical phone.
- Public `v0.1.6-alpha` promotion additionally requires one signed real-iPhone `iphone-cloudkit-chat-roundtrip`: submit a harmless prompt on cellular data, let the Mac text-only worker process it, and verify exactly one response plus redacted evidence.
- `mobile:native:device:install` still requires the account holder to accept Apple's current developer agreement, a matching provisioning profile, and an unlocked paired iPhone or iPad.

## 中文说明

这里是 OwnOrbit iOS 原生壳的源码候选版本，目前不是 App Store 正式版本，也不会混入公开桌面安装包。

当前可以从 iPhone“文件”App 选择 `lifeos-mobile-entry-*.json`，校验入口版本、SHA-256、有效期、地址安全边界和 OwnOrbit 健康接口，然后在受限的同源 `WKWebView` 中打开手机聊天。首次成功连接后可授权本地通知：入口到期前 24 小时提醒一次，连续三次连接失败后提醒一次；恢复连接或移除入口会清理提醒，通知里不会出现地址、电脑名、校验值或凭证。原生壳还加入了需要用户明确开启的 CloudKit 私有库增量拉取、变更游标、私有数据库推送订阅、前台恢复、记录完整性校验和 Data Protection 离线快照；非 CloudKit 或非私有数据库通知会被直接忽略。用户开启 CloudKit 后，应用还会提交最早 30 分钟后可运行的 `BGAppRefreshTask` 兜底任务，并在每次唤醒后续约，但实际运行时间仍由 iOS 决定。后台 CloudKit 唤醒会分别向 iOS 报告“有新数据”“没有变化”和“同步失败”，不会把网络或 iCloud 故障伪装成一次成功的空同步。离线副本按匿名 Apple 账号指纹隔离；账号变化会先清除旧副本，游标过期会只重建对应 zone，多页与临时失败会自动续拉或退避重试。当前有三条受控写回：新建一条普通记忆、把现有任务标记完成，以及发送签名 `LifeOSChatRequest`。新建记忆会拦截凭证/私密路径，且不能覆盖 Mac 已有记忆；任务完成会提交基础内容哈希，Mac 只在本地版本仍一致时接受。CloudKit 对话使用独立 P-256 身份，私钥只保存在设备 Keychain，CloudKit 只保存有 scope 的公钥；Mac 只通过禁用工具调用的 text-only worker 生成 `LifeOSChatResponse`。已有同步聊天历史、生成程序和设备信任元数据继续只读。AI Key、管理员密码、设备 token、私钥、会话 Cookie、SQLite、备份和 CloudKit 凭证都不会写入同步数据。

代码、entitlement 和后台刷新声明已经具备，模拟器可验证注册路径、明确开启策略与任务只完成一次的保护逻辑；但“真实 CloudKit 已跑通”仍需 Apple 账号持有人接受协议、创建共享 Container、生成匹配的 Mac/iPhone provisioning profile，并完成两台真实设备的数据往返、后台推送、系统实际调度后台刷新和长测证据。在这些证据完成前，项目仍只把它标为原生同步候选能力。

账号持有人接受最新 Apple Developer 协议并连接、解锁 iPhone 后，可运行 `npm run mobile:native:device:install`。该命令会自动签名构建、校验 Bundle ID、CloudKit Container 和 APNs entitlement，再选择可用设备安装并启动；生成的本地证据只保留设备型号和不可逆标识哈希，不写设备名称、原始设备 ID、本机路径或凭证。连接多台设备时可用 `LIFEOS_IOS_DEVICE_ID` 明确选择。
