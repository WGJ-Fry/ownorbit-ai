# LifeOS v0.1.4-alpha Release Draft

Do not publish this note until `v0.1.4-alpha` is tagged, the GHCR image is anonymously pullable, and the macOS/Windows/Linux unsigned packages plus `SHA256SUMS` are uploaded.

Package version: `0.1.4-alpha.0`

## What This Alpha Adds

- Mobile offline queue sync identity: mutation IDs, idempotency keys, client sequence numbers, visible sync stages, and backup metadata for weak-network recovery.
- Duplicate-safe SQLite chat write-back: replayed offline messages with the same idempotency key return the existing message instead of creating duplicates.
- Stronger mobile offline conflict handling for similar messages sent from different devices or entries during weak-network windows.
- Mobile queue recovery guidance that separates background-ready, manual-review, blocked, offline, and weak-network states.
- Expanded Studio template variants for ledgers, planners, organizers, habits, calculators, forms, workflows, lookups, and general problem-solving tools.
- Studio blueprint readiness and generated-tool quality scoring, including acceptance criteria, failure triggers, automatic-repair limits, and manual-review boundaries.
- Calendar/task sync safety gates plus an opt-in macOS connector path: `.ics` support remains read-only; Apple Calendar and system Reminders can be executed only when the macOS connector and external-write flag are enabled, the admin confirms `WRITE TO EXTERNAL CALENDAR`, and an audit log is recorded. Google Calendar remains preview-only until OAuth is implemented.
- Native automation safety gates: file, calendar, reminder, clipboard, and shell actions remain blocked preview-only until a native bridge, explicit consent, and audit logging are implemented.
- Release truth checks that keep README, release notes, Docker image tags, asset names, and alpha limitations aligned before public promotion.

## Desktop Packages

This alpha continues the unsigned distribution policy:

- macOS Apple Silicon unsigned ZIP: `LifeOS.AI-0.1.4-alpha.0-arm64-unsigned.zip`.
- Windows x64 unsigned NSIS installer: `LifeOS.AI.Setup.0.1.4-alpha.0.exe`.
- Linux x64 AppImage: `LifeOS.AI-0.1.4-alpha.0.AppImage`.

Verify every downloaded file with `SHA256SUMS`. macOS Gatekeeper and Windows SmartScreen may warn because the public packages are not formally signed yet.

## Docker

After the tag is published and the Docker workflow finishes, verify:

```bash
docker logout ghcr.io || true
docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.4-alpha
```

## Current Limits

- Automatic updates are not enabled by default. Use manual download plus SHA256 verification.
- macOS Developer ID signing/notarization and Windows Authenticode signing are not part of this unsigned alpha.
- Google Calendar OAuth sync/write-back is not shipped yet. Apple Calendar and system Reminders writes require macOS, explicit environment opt-in, explicit admin confirmation, and audit logging.
- `.ics` support is read-only local ingestion, not two-way calendar/task management.
- Studio generated programs remain alpha: scoring, readiness checks, template expansion, and guarded repair prompts are present, but fully automatic unattended self-repair is not advertised.
- Local actions are still URL Scheme / browser / Shortcuts bridge based. Full native automation and deep OS permission control are future work.
- Remote diagnostics can verify configuration, but long-term remote stability still needs real-device evidence from the user's network.

## Release Gate Before Publishing

Run these checks before uploading or announcing the release:

```bash
npm run lint
npm test
npm run test:e2e
npm run test:desktop
npm run release:check:unsigned
npm run version:truth:release
npm run github:public:check
LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch
```

## 中文说明

发布前不要公开这份说明。必须等 `v0.1.4-alpha` tag 已创建、GHCR 镜像可以匿名拉取、macOS/Windows/Linux unsigned 安装包和 `SHA256SUMS` 都上传完成后再发布。

Package version：`0.1.4-alpha.0`

### 本 alpha 新增

- 手机离线队列同步身份：mutation ID、幂等 key、客户端序号、可见同步阶段，以及用于弱网恢复的备份元数据。
- SQLite 聊天写入去重：同一条离线消息重放时，会返回已有消息，不会重复写入。
- 强化手机离线冲突处理：弱网窗口内来自不同设备或入口的相似消息会进入人工复核。
- 手机队列恢复指引：明确区分可后台补写、需人工复核、远程入口阻塞、离线等待和弱网等待。
- 扩展 Studio 模板变体：记账、规划、整理、打卡、计算、表单、流程、查询和通用问题解决工具。
- Studio 蓝图就绪评分和生成工具质量评分：包含验收标准、失败触发、自动修复边界和人工复核边界。
- 日历/任务同步安全闸门和 macOS 连接器路径：`.ics` 仍然只是本地只读读取；Apple Calendar 和系统提醒事项只有在启用 macOS connector、启用外部写入开关、管理员确认 `WRITE TO EXTERNAL CALENDAR` 并写入审计日志后才会执行；Google Calendar 仍要等 OAuth 连接器。
- 原生自动化安全闸门：文件、日历、提醒事项、剪贴板、脚本动作在原生桥、明确同意和审计日志完成前都只允许阻断预览。
- Release 事实检查：发布前强制 README、Release notes、Docker tag、安装包名和 alpha 限制保持一致。

### 桌面包

本 alpha 继续采用 unsigned 分发策略：

- macOS Apple Silicon unsigned ZIP：`LifeOS.AI-0.1.4-alpha.0-arm64-unsigned.zip`。
- Windows x64 unsigned NSIS：`LifeOS.AI.Setup.0.1.4-alpha.0.exe`。
- Linux x64 AppImage：`LifeOS.AI-0.1.4-alpha.0.AppImage`。

请用 `SHA256SUMS` 校验下载文件。因为当前公开包没有正式签名，macOS Gatekeeper 和 Windows SmartScreen 可能提示风险。

### 当前限制

- 默认不启用自动更新，继续使用手动下载 + SHA256 校验。
- 本 alpha 不包含 macOS Developer ID 签名/公证，也不包含 Windows Authenticode 签名。
- Google Calendar OAuth 同步/写回尚未发布。Apple Calendar 和系统提醒事项写入需要 macOS、环境变量显式开启、管理员明确确认和审计日志。
- `.ics` 只是本地只读读取，不是双向日历/任务管理。
- Studio 生成程序仍是 alpha：已有评分、就绪检查、模板扩展和带护栏修复提示，但不宣传完全无人值守自修复。
- 本地动作仍基于 URL Scheme / 浏览器 / 快捷指令桥，不是完整原生自动化系统。
- 远程诊断能验证配置，但长期稳定性仍需要用户自己完成真实设备长测并留下证据。
