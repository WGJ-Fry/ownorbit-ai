# OwnOrbit AI v0.1.6-alpha Source Candidate

Package version: `0.1.6-alpha.0`

> [!IMPORTANT]
> This is a **Source candidate**, not a public download. The current public packages, Docker image, and GitHub Release remain `v0.1.5-alpha` / `0.1.5-alpha.0` until the Production CloudKit schema, cross-platform packages, checksums, GHCR image, and release review are complete.

## Implemented In Source

### Three-step first launch

The normal setup path now asks for only one thing at a time:

1. Set the administrator password.
2. Configure one AI provider key.
3. Scan the phone QR and send the first message.

Backups, connection diagnostics, CloudKit details, and safety tools remain available as advanced controls without crowding the normal path.

### Qwen3.7-Max compatibility

- Alibaba Model Studio users can select `qwen3.7-max`, `qwen3.7-max-2026-06-08`, or `qwen3.7-max-2026-05-20` from the built-in model catalog.
- The runtime sends the official hybrid-thinking parameters through the OpenAI-compatible Chat Completions endpoint and keeps `reasoning_content` separate from the assistant's visible final answer.
- Normal chat, tool definitions, and JSON response mode share the same tested provider path. The API key remains server-side.

### Signed iPhone-to-Mac CloudKit chat

- The native iPhone shell can create a `LifeOSChatRequest` in the user's private CloudKit database.
- The Mac imports the request into a durable SQLite job, runs the configured AI through a **text-only** worker, and exports one idempotent `LifeOSChatResponse`.
- Remote CloudKit chat cannot execute tools, URL schemes, native actions, shell commands, calendar writes, reminder writes, or generated-program actions.
- Jobs use leases, expiry, bounded retries, safe error codes, and deterministic response IDs.
- The phone shows waiting for Mac, Mac unavailable, processing, retrying, completed, failed, and timed-out states instead of a generic spinner.

### Dedicated device identity

- Each native iPhone creates a P-256 signing identity.
- The private key stays in Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and is never uploaded.
- CloudKit receives only a `LifeOSDeviceKey` public-key registration with a fixed `cloudkit-chat` scope and bounded lifetime.
- Every request signature binds the request ID, conversation ID, message ID, device ID, public-key fingerprint, prompt, locale, sequence, creation time, and expiry.
- The Mac verifies canonical base64url, P-256 SPKI key format, possession proof, fingerprint, scope, expiry, and request signature before accepting a job.
- This key proves the CloudKit chat sender. It does not grant web-device access and does not replace the normal pairing/rebinding flow.

### Schema, migrations, and evidence

- Added CloudKit schema records for `LifeOSChatRequest`, `LifeOSChatResponse`, and `LifeOSDeviceKey`.
- Added SQLite migrations for durable CloudKit chat jobs and registered device public keys.
- Added server protocol, job, worker, retry, expiry, signature, quarantine, and end-to-end import/export tests.
- Added native Swift tests for key storage boundaries, signed outbox records, response state mapping, duplicate safety, and offline snapshot recovery.
- Added the required real-device acceptance item `iphone-cloudkit-chat-roundtrip`.
- Completed one signed real-iPhone 5G `LifeOSChatRequest` -> Mac text-only AI worker -> exactly one visible `LifeOSChatResponse` roundtrip. CloudKit push evidence was visible while the app was backgrounded/locked; the redacted acceptance summary remains local and raw screenshots are not committed.
- Added a reproducible Developer ID Production export, Apple notarization, and ticket-stapling path for the embedded macOS CloudKit Helper. Strict resource staging and artifact smoke reject development, device-limited, entitlement-drifted, or unnotarized helpers before public packaging. This does not sign the outer desktop app.

## Required Before Public Release

- Deploy the reviewed CloudKit schema from Development to Production.
- Re-run the full lint, server, native, Playwright, desktop, unsigned release, version-truth, and public GitHub checks.
- Build fresh macOS, Windows, and Linux packages from the same commit; generate `SHA256SUMS` and the release manifest; publish a new immutable `v0.1.6-alpha` tag and GHCR image.

## Honest Alpha Limits

- Automatic updates are not enabled for unsigned alpha packages. Update manually and verify SHA256.
- The outer macOS desktop app remains an unsigned ZIP and Windows remains without Authenticode signing. Only the capability-bearing embedded CloudKit Helper has a separately verified Developer ID/notarization path.
- Apple Calendar, Google Calendar, Google Tasks, and system reminders remain guarded connector paths, not broad unattended background synchronization. Run `calendar:acceptance` before making any real-account sync claim.
- `.ics` support remains read-only local ingestion.
- Studio generated programs still require user review; unattended self-repair is not claimed.
- Local actions remain a narrow URL Scheme / browser / Shortcuts and allowlisted native bridge, not unrestricted OS automation.
- Remote diagnostics can verify configuration, but long-term remote stability still needs real-device evidence.
- CloudKit chat depends on the user's iCloud account, Apple provisioning, CloudKit availability, and a reachable, awake Mac. It is not a general relay service and does not make a browser PWA work remotely by itself.

---

# OwnOrbit AI v0.1.6-alpha 源码候选版

Package version：`0.1.6-alpha.0`

> [!IMPORTANT]
> 这是**源码候选**，不是公开下载包。在 CloudKit Production schema、三平台安装包、校验值、GHCR 镜像和发布复核全部完成前，当前公开下载仍是 `v0.1.5-alpha` / `0.1.5-alpha.0`。

## 源码中已经实现

### 三步首次启动

普通用户第一次进入只需要依次完成：

1. 设置管理员密码。
2. 配置一个 AI provider Key。
3. 扫描手机二维码并发送第一条消息。

备份、连接诊断、CloudKit 细节和安全工具仍保留在高级功能中，不再挤进主流程。

### Qwen3.7-Max 兼容

- 阿里云百炼用户可在内置模型目录选择 `qwen3.7-max`、`qwen3.7-max-2026-06-08` 或 `qwen3.7-max-2026-05-20`。
- 运行时通过 OpenAI-compatible Chat Completions 接口发送官方混合思考参数，并把 `reasoning_content` 与用户可见的最终回答分开处理。
- 普通聊天、工具定义和 JSON 响应模式共用同一条受测 provider 路径，API Key 仍只保存在后端。

### iPhone 到 Mac 的签名 CloudKit 对话

- iPhone 原生壳可以在用户私有 CloudKit 数据库写入 `LifeOSChatRequest`。
- Mac 将请求导入 SQLite 持久任务，通过已配置 AI 的 **text-only** worker 处理，再幂等导出一个 `LifeOSChatResponse`。
- 远程 CloudKit 对话不能执行工具、URL Scheme、原生动作、shell、日历/提醒事项写入或生成程序动作。
- 任务具备 lease、过期、有限重试、脱敏错误码和确定性 response ID。
- 手机会显示等待 Mac、Mac 不在线、处理中、重试中、已完成、失败和超时，而不是只有一个没有解释的加载动画。

### 独立设备身份

- 每台原生 iPhone 创建一个 P-256 签名身份。
- 私钥只保存在 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` Keychain 中，永远不上云。
- CloudKit 只接收固定 `cloudkit-chat` scope、有限有效期的 `LifeOSDeviceKey` 公钥登记。
- 每个请求签名都会绑定请求、会话、消息、设备、公钥指纹、提示词、语言、序号、创建时间和过期时间。
- Mac 在接收任务前会验证规范 base64url、P-256 SPKI、公钥持有证明、指纹、scope、有效期和请求签名。
- 这个密钥只证明 CloudKit 对话发送者，不授予网页设备访问权，也不代替原有扫码绑定/重新绑定。

### Schema、migration 与证据

- 新增 `LifeOSChatRequest`、`LifeOSChatResponse`、`LifeOSDeviceKey` CloudKit schema。
- 新增 CloudKit 对话任务和设备公钥 SQLite migration。
- 新增协议、任务、worker、重试、过期、签名、隔离区和完整导入/导出自动化测试。
- 新增 Keychain 边界、签名 outbox、状态映射、去重和离线快照恢复的 Swift 测试。
- 真实设备验收清单新增 `iphone-cloudkit-chat-roundtrip`。
- 已用真实签名 iPhone 在 5G 蜂窝网络完成一次 `LifeOSChatRequest` -> Mac text-only AI worker -> 恰好一条可见 `LifeOSChatResponse` 往返；App 在后台/锁屏时可见 CloudKit 推送证据。脱敏验收摘要只保存在本地，原始截图不进入仓库。
- 新增可重复执行的 macOS 内置 CloudKit Helper Developer ID Production 导出、Apple 公证和票据装订流程。严格资源暂存与产物 smoke 会在公开打包前拒绝开发证书、设备限定、权限漂移或未公证的 Helper；这不会把桌面外层应用改成已签名版本。

## 公开发布前必须完成

- 把复核后的 CloudKit schema 从 Development 部署到 Production。
- 重跑 lint、服务端、Swift、Playwright、桌面、unsigned release、版本事实和 GitHub 公开状态检查。
- 从同一提交重新构建 macOS、Windows、Linux 包，生成 `SHA256SUMS` 和 release manifest，再发布不可移动的新 `v0.1.6-alpha` tag 与 GHCR 镜像。

## 诚实的 Alpha 边界

- 默认不启用自动更新；unsigned alpha 继续手动下载并校验 SHA256。
- macOS 桌面外层仍是 unsigned ZIP，Windows 也仍未做 Authenticode 签名；只有承担系统能力的内置 CloudKit Helper 具备单独验证的 Developer ID/公证路径。
- Apple Calendar、Google Calendar、Google Tasks、系统提醒事项仍是受控连接器路径，不是宽泛无人值守后台同步；宣传真实账号同步前必须运行 `calendar:acceptance`。
- `.ics` 只是本地只读读取。
- Studio 生成程序仍需用户复核，不宣传完全无人值守修复。
- 本地动作仍是窄范围 URL Scheme / 浏览器 / Shortcuts 和白名单原生桥，不是无限制 OS 自动化。
- 远程诊断可以验证配置，但长期稳定性仍需要用户自己完成真实设备长测。
- CloudKit 对话依赖用户 iCloud、Apple provisioning、CloudKit 可用性和保持可达/唤醒的 Mac；它不是通用中继服务，也不会自动让浏览器 PWA 跨网连接。
