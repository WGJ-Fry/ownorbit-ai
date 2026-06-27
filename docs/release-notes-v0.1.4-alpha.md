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
- Studio auto-repair queue entries now expose a readiness gate with passed checks, failed checks, rollback status, and the exact resume/manual-review/smoke-verification decision.
- Studio low-risk auto-repair tasks now include an execution session with worker steps, completion endpoint, rollback version, and required smoke checks; high-risk or retry-limited repairs get a blocked session instead of running unattended.
- Applied Studio auto-repairs remain visible until a smoke check is recorded as passed or failed. Failed smoke checks are audited, recommend rollback, and keep the repair in review instead of allowing another unattended pass.
- Calendar/task sync safety gates plus narrow connector paths: `.ics` support remains read-only; Apple Calendar and system Reminders can be read as external previews when the macOS connector is enabled. Apple Calendar create/update/delete and Reminders create/update/complete/delete can execute only when the external-write flag is also enabled, the admin confirms `WRITE TO EXTERNAL CALENDAR`, rollback guidance is returned, and an audit log is recorded. Google Calendar events and Google Tasks now have guarded OAuth connector paths for read preview plus explicitly confirmed write operations. External writes are saved into SQLite history with rollback availability, automatic rollback for safe create/update/delete reversals, and guarded task-completion rollback that restores captured title, time, notes, and unfinished status. `npm run calendar:acceptance` can generate Google or macOS read/write evidence before public sync claims.
- Calendar/task sync run evidence can now be saved from the admin UI: each run records read/write summary counts, conflict and blocked-write reasons, rollback-review signals, and next-step guidance while still clearly marking broad unattended two-way sync as not shipped.
- Native automation safety gates: URL Scheme/browser/Shortcuts actions remain the primary local action path; the guarded native bridge is disabled by default and only exposes narrow clipboard, allowlisted Shortcuts, Finder reveal, and allowlisted app bundle ID open actions when all opt-in gates pass. Shell, calendar, reminder, and broad file-write automation remain blocked.
- Release truth checks that keep README, release notes, Docker image tags, asset names, alpha limitations, complete desktop assets, and real-world remote acceptance evidence aligned before public promotion.
- Desktop update diagnostics now show manual mode, blocked feed URLs, or explicitly opted-in HTTPS feed readiness. `LIFEOS_UPDATE_URL` alone does not enable update checks; maintainers must also set `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1`.

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

- Automatic updates are not enabled by default. Use manual download plus SHA256 verification unless a maintainer publishes a stable HTTPS feed and explicitly sets `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1`.
- macOS Developer ID signing/notarization and Windows Authenticode signing are not part of this unsigned alpha.
- Apple Calendar, Google Calendar, Google Tasks, and system reminders full background account sync is not broadly shipped yet. Narrow connector writes require explicit environment opt-in, explicit admin confirmation, audit logging, SQLite write history, rollback status, and real-account `calendar:acceptance` evidence before public promotion.
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

`npm run version:truth:release` now requires remote acceptance evidence. Save the exported diagnostic bundle or remote evidence pack as `release/remote-acceptance-evidence.json`, or set `LIFEOS_REMOTE_ACCEPTANCE_EVIDENCE=/path/to/diagnostic-bundle.json`, before running the release gate.

If this release promotes the Google Calendar/Tasks connector, also run the real-account acceptance command with a disposable test calendar/task list or a safe personal test account:

```bash
LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR=1 \
LIFEOS_GOOGLE_CALENDAR_CLIENT_ID="..." \
LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET="..." \
LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN="..." \
LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 \
LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="WRITE TO EXTERNAL CALENDAR" \
npm run calendar:acceptance -- --write --out calendar-acceptance.json
```

If this release promotes Apple Calendar/System Reminders connector writes, also run the macOS provider on a real Mac account or disposable local calendar/reminder list:

```bash
LIFEOS_CALENDAR_ACCEPTANCE_PROVIDER=macos \
LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR=1 \
LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 \
LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="WRITE TO EXTERNAL CALENDAR" \
npm run calendar:acceptance -- --provider macos --write --out macos-calendar-acceptance.json
```

Keep the generated `calendar-acceptance.json` with release evidence. It should not contain OAuth secrets or raw Google item IDs.

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
- Studio 自动修复队列现在会返回结构化门禁：通过项、失败项、回滚状态，以及继续修复/人工复核/烟测验证的明确决策。
- Studio 低风险自动修复任务现在包含执行会话：worker 步骤、完成端点、回滚版本和必须烟测项；高风险或超过重试上限的修复会生成已拦截会话，不会无人值守运行。
- 已应用的 Studio 自动修复会继续留在队列里，直到烟测被记录为通过或失败。烟测失败会进入审计、建议回滚，并保持复核状态，不允许继续无人值守修复。
- 日历/任务同步安全闸门和窄连接器路径：`.ics` 仍然只是本地只读读取；启用 macOS connector 后，Apple Calendar 和系统提醒事项可以作为外部只读预览读取；Apple Calendar 的 create/update/delete 和 Reminders 的 create/update/complete/delete 只有再启用外部写入开关、管理员确认 `WRITE TO EXTERNAL CALENDAR`、返回回滚提示并写入审计日志后才会执行。Google Calendar 事件和 Google Tasks 现在有受控 OAuth 连接器路径，支持读取预览和明确确认后的写入操作；外部写入会保存到 SQLite 历史，显示回滚可用性，并对安全的 create/update/delete 反向操作提供受控自动回滚。公开宣传前应先用 `npm run calendar:acceptance` 生成 Google 或 macOS 真实账号/设备读写证据。
- 日历/任务同步运行证据现在可以在管理端保存：每次运行会记录读取/写入摘要、冲突和阻塞原因、回滚复核信号以及下一步建议，同时继续明确标注“宽泛无人值守双向同步尚未发布”。
- 原生自动化安全闸门：URL Scheme / 浏览器 / 快捷指令仍是主要本地动作路径；受控原生桥默认关闭，只在全部开关通过时暴露剪贴板、白名单快捷指令、Finder 定位文件和白名单 bundle id 打开 App。shell、日历、提醒事项和宽泛文件写入仍阻断。
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
- Apple Calendar、Google Calendar、Google Tasks、系统提醒事项的完整后台账号同步尚未广泛发布。窄连接器写入必须经过环境变量显式开启、管理员明确确认、审计日志、SQLite 写入历史、回滚状态和真实账号 `calendar:acceptance` 证据后，才能对外宣传。
- `.ics` 只是本地只读读取，不是双向日历/任务管理。
- Studio 生成程序仍是 alpha：已有评分、就绪检查、模板扩展和带护栏修复提示，但不宣传完全无人值守自修复。
- 本地动作仍基于 URL Scheme / 浏览器 / 快捷指令桥，不是完整原生自动化系统。
- 远程诊断能验证配置，但长期稳定性仍需要用户自己完成真实设备长测并留下证据。

如果本次发布要宣传 Google Calendar / Google Tasks 连接器，还必须用安全的测试账号或测试日历/任务列表跑真实账号验收：

```bash
LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR=1 \
LIFEOS_GOOGLE_CALENDAR_CLIENT_ID="..." \
LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET="..." \
LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN="..." \
LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 \
LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="WRITE TO EXTERNAL CALENDAR" \
npm run calendar:acceptance -- --write --out calendar-acceptance.json
```

如果发布 Apple Calendar/系统提醒事项连接器写入能力，还要在真实 Mac 账号或一次性本地日历/提醒事项列表上运行：

```bash
LIFEOS_CALENDAR_ACCEPTANCE_PROVIDER=macos \
LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR=1 \
LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 \
LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="WRITE TO EXTERNAL CALENDAR" \
npm run calendar:acceptance -- --provider macos --write --out macos-calendar-acceptance.json
```

生成的 `calendar-acceptance.json` 应作为发布证据保存，并且不应包含 OAuth 密钥或原始 Google 项目 ID。
