# LifeOS AI Version Roadmap

This roadmap is a truth source for public communication. It separates what is shipped in the current public release from what is planned next and what is still future work.

## Shipped in the Current Public Release: v0.1.4-alpha

`v0.1.4-alpha` / package `0.1.4-alpha.0` is the current public alpha.

It includes:

- Docker Compose quickstart with `ghcr.io/wgj-fry/lifeos-ai:v0.1.4-alpha`, Ollama, local Markdown memory, and read-only local `.ics` ingestion.
- Unsigned desktop packages: macOS Apple Silicon ZIP, Windows x64 NSIS installer, and Linux x64 AppImage.
- Admin authentication, AI provider settings, SQLite migrations, backup/restore, diagnostics, and redacted audit data.
- Mobile PWA pairing, WebCrypto device credentials, device status, offline queue, retry/clear controls, background sync hooks, conflict review groups, mutation IDs, idempotency keys, and duplicate-safe chat write-back for replayed offline messages.
- LAN, Tailscale, Cloudflare Tunnel, and trusted HTTPS reverse-proxy diagnostics with public-exposure warnings.
- Remote acceptance checklist covering cellular use, Wi-Fi/cellular switching, desktop restart recovery, stale QR repair, tunnel interruption recovery, and diagnostic export evidence.
- Real-world remote acceptance notes now require scenario-specific proof before a manual item can be marked complete, so weak notes cannot stand in for cellular, restart, network-switch, stale-QR, interruption, or diagnostic-export evidence.
- Studio generated programs with blueprint confirmation, expanded template variants, readiness scoring, quality scoring, acceptance criteria, permission boundaries, runtime logs, state storage, guarded repair boundaries, and version rollback.
- Calendar/task sync safety gates with read-only `.ics` ingestion plus opt-in Apple Calendar, Google Calendar/Tasks, and system Reminders connector paths for external read previews and explicitly confirmed external writes, with audit logs, SQLite write history, rollback availability, guarded automatic rollback for safe create/update/delete reversals, and saved run evidence for conflicts, blocked writes, rollback review, and next steps.
- URL Scheme based local action permission center with dangerous-action confirmation, redacted logs, and preview-only native automation gates for file, calendar, reminder, clipboard, and shell actions.
- Release hygiene checks for README, Docker image tags, public GitHub Release state, stale releases, stale GitHub Latest labels, and release assets.

## Known Limits in v0.1.4-alpha

These are not bugs hidden from users; they are the honest alpha boundary.

| Area | Current limit | User-facing impact |
| --- | --- | --- |
| Unsigned desktop packages | macOS Developer ID signing/notarization and Windows Authenticode signing are not enabled. | macOS Gatekeeper and Windows SmartScreen may warn. Users should download only from GitHub Releases and verify `SHA256SUMS`. |
| Manual update | Automatic updates are not enabled. | Users update by downloading the next release manually and verifying SHA256. |
| Real-device remote acceptance | Automated checks and evidence records exist, but each user must still run real phone/cellular/Wi-Fi/restart/tunnel long tests on their own network. | Remote diagnostics can say the setup is plausible; only real-device evidence proves long-term stability. |
| Calendar and tasks | Local `.ics` ingestion is read-only. Apple Calendar, Google Calendar/Tasks, and system reminders can be read through opt-in connector previews. Narrow create/update/delete/complete operations require explicit admin confirmation, rollback guidance, SQLite write history, audit logging, and saved run evidence; broad unattended account sync is not shipped. | LifeOS can read exported/local calendar data and opt-in external previews, save conflict/blocked-write evidence, and perform narrowly gated writes when explicitly enabled, but it is not a full background account sync system yet. |
| Studio generated programs | Blueprints, templates, readiness/quality scoring, permissions, repair guidance, logs, state, and rollback exist, but product-grade unattended auto-repair and multi-version comparison are not complete. | Users can generate and refine tools, but should review outputs and repair decisions manually. |
| Mobile offline queue | Retry, clear, failure state, storage health, idempotent replay, and manual-review conflict groups exist. Deep multi-device merge and weak-network background recovery are still improving. | Offline messages are protected from simple loss and duplicate replay, but complex conflicts still need visible user review. |
| Native automation | Local actions are mainly URL Scheme / browser / Shortcuts bridge based. | It is safer and reviewable, but not a full native OS automation system yet. |
| Release hygiene | Checks exist, including a guard that blocks any older stable Release from stealing GitHub Latest, but GitHub Release labels and old releases still require final human review before public promotion. | The maintainer must run public checks before broad announcements. |

## Source-Only Changes After v0.1.4-alpha

These changes are implemented on `main` after the public `v0.1.4-alpha` release line and should not be advertised as public downloads until a new tag, packages, Docker image, checksums, and Release notes are published.

- Native automation bridge can now execute a narrowly guarded Finder "reveal file" action on macOS when all gates pass: bridge enabled, exact `file:reveal` allowlist, allowed file root, explicit consent, exact confirmation phrase, audit logging, and local path redaction.
- Native automation bridge can also open allowlisted macOS app bundle IDs when all gates pass: bridge enabled, exact `app:<bundle id>` allowlist, explicit consent, exact confirmation phrase, audit logging, and malformed bundle ID blocking.
- The bridge still blocks shell, calendar, reminder, and broad file write automation by default.
- Admin UI now shows whether the selected Finder file target is inside the configured allowed roots.
- Release checks and tests now guard the Finder reveal path, outside-root blocking, local path redaction, and the still-blocked high-risk native writes.
- Google Calendar events, Google Tasks, Apple Calendar, and system Reminders now have guarded connector code paths plus `calendar:acceptance` real-account/device evidence generation. Public sync claims still require a new Release, uploaded assets, and passing read/write acceptance reports for the provider being promoted.
- Calendar/task sync checks now save persistent run evidence with conflict summaries, blocked-write reasons, rollback-review signals, and next-step guidance. This improves release evidence and support debugging, but still does not make broad unattended account sync shipped.
- Studio auto-repair queue items now include a structured readiness gate with passed checks, failed checks, rollback status, and an explicit resume/manual-review/smoke-verification decision. This improves resumability, but does not make Studio fully unattended yet.
- Studio auto-repair tasks now also include a structured execution session for low-risk repairs: worker steps, completion endpoint, rollback version, smoke checks, and a blocked session for high-risk or retry-limited cases.
- Applied Studio auto-repairs now require a recorded smoke review before they disappear from the repair queue; passed reviews close the queue item, while failed reviews keep rollback guidance and manual review visible.
- Release promotion truth checks now require a remote acceptance evidence file when running `npm run version:truth:release`; the evidence must show a stable HTTPS entry plus completed cellular, network-switch, restart, stale-QR, network-interruption, and diagnostic-export scenarios.
- Desktop update diagnostics now distinguish manual mode, blocked feeds, and explicitly opted-in HTTPS feed readiness. A safe `LIFEOS_UPDATE_URL` is not enough by itself; maintainers must also set `LIFEOS_ENABLE_DESKTOP_AUTO_UPDATE=1`.

## Next Planned Alpha: v0.1.5-alpha

`v0.1.5-alpha` should continue turning the alpha into a calmer long-term self-use product without claiming signed packages, automatic updates, full calendar sync, or full native automation before they are verified.

Scope:

- Publish a new tag instead of moving `v0.1.4-alpha`.
- Rebuild unsigned macOS ZIP, Windows NSIS installer, Linux AppImage, `SHA256SUMS`, `USER-INSTALL.md`, and `release-manifest.json`.
- Add a new GitHub Discussions article for `v0.1.5-alpha`; do not edit older release posts except for factual deprecation warnings.
- Require version truth checks before release: README, Chinese README, release notes, Docker image, desktop asset names, and current alpha limits must agree.
- Keep remote acceptance evidence visible in diagnostics and release guidance, then add stronger in-product prompts for missing real-device proof.
- Improve mobile weak-network background recovery and multi-device conflict review, especially after phone restart, browser storage pressure, and stale remote entries.
- Expand the macOS calendar/reminders connector from narrow external writes toward a productized permission review, rollback plan, and conflict preview.
- Publish and validate the first Google Calendar/Tasks and macOS Apple Calendar/System Reminders connector paths behind explicit admin setup, external-write opt-in, consent, audit logging, rollback guidance, and passing `calendar:acceptance` reports; keep broad two-way account sync out of scope until real-account/device evidence exists.
- Continue productizing Studio auto-repair after the readiness gate, execution session, and smoke review records: richer visual diff, template-specific repair recipes, and clearer recovery if the worker fails mid-run.
- Promote Studio auto-repair only with matching tests and UI: every queued repair must explain why it can resume, why it is blocked, what worker steps will run, and what smoke checks remain.
- Publish and validate the narrow native automation bridge path only if Release assets include it: disabled by default, admin-only, exact allowlist, explicit confirmation phrase, audit logging, sensitive-payload blocking, mock execution tests, clipboard writes, allowlisted Shortcuts, and Finder reveal inside configured file roots; broad shell/file-write/calendar/reminder automation remains blocked.
- Do not claim signed desktop packages, auto-update, two-way calendar/task sync, native automation, or fully automatic unattended Studio repair until they are actually shipped and verified.

Release gate:

```bash
npm run lint
npm test
npm run test:e2e
npm run test:desktop
npm run release:check:unsigned
npm run version:truth:release
npm run github:public:check
```

`npm run version:truth:release` is intentionally stricter than the daily version check. Run it only when the worktree is clean, `main` has been pushed, the new public tag already points at the exact commit whose assets will be uploaded, `LIFEOS_RELEASE_DIR` points at the complete macOS/Windows/Linux release payload if it is not the default `release/` directory, and `LIFEOS_REMOTE_ACCEPTANCE_EVIDENCE` points at the exported diagnostic bundle or `release/remote-acceptance-evidence.json` contains the remote evidence pack. If it fails, fix the release state before editing GitHub Release assets.

When the public assets are uploaded, also run:

```bash
LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch
docker logout ghcr.io || true
docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.5-alpha
```

If `v0.1.5-alpha` promotes Google Calendar/Tasks connector writes, also run real-account connector acceptance with a safe test account or disposable calendar/task list:

```bash
LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR=1 \
LIFEOS_GOOGLE_CALENDAR_CLIENT_ID="..." \
LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET="..." \
LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN="..." \
LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 \
LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="WRITE TO EXTERNAL CALENDAR" \
npm run calendar:acceptance -- --write --out calendar-acceptance.json
```

If it promotes macOS Apple Calendar/System Reminders writes, run the macOS provider on a real Mac account or a disposable calendar/reminder list:

```bash
LIFEOS_CALENDAR_ACCEPTANCE_PROVIDER=macos \
LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR=1 \
LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 \
LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="WRITE TO EXTERNAL CALENDAR" \
npm run calendar:acceptance -- --provider macos --write --out macos-calendar-acceptance.json
```

## Future Milestones

## Not Shipped Yet

These capabilities should not be described as current release features until they have code, tests, release assets, and user-facing documentation:

- Signed and notarized macOS builds.
- Authenticode-signed Windows builds.
- Automatic update enabled by default.
- Broad Google Calendar/Google Tasks two-way sync beyond the narrow event/task connector paths.
- Fully productized Apple Calendar and system Reminders two-way sync beyond the current macOS opt-in connector path.
- Fully automatic unattended Studio repair.
- Full native OS automation beyond URL Scheme / browser / Shortcuts bridge actions.
- Real-world remote acceptance completed for every user's network without user evidence.

| Version | Theme | Planned work |
| --- | --- | --- |
| `v0.1.5-alpha` | Mobile reliability and connector hardening | Stronger offline conflict handling, multi-device edit warnings, failed-sync review, weak-network background recovery, safer macOS/calendar connector UX, audited Studio auto-repair task planning, and a narrowly guarded native bridge for clipboard, Shortcuts, and Finder reveal while high-risk writes remain blocked. |
| `v0.2.0-alpha` | Calendar and tasks | Productized Google Calendar/Tasks sync, Apple Calendar / system Reminders sync, explicit permission prompts, write-back audit log, conflict preview, and rollback path. |
| `v0.3.0-alpha` | Studio product loop | Template marketplace polish, multi-version visual comparison, automatic repair proposal flow, capability review center, and stronger generated-tool quality scoring. |
| `v0.4.0-alpha` | Native action safety | Safer local automation bridge beyond URL Scheme, OS-level permission explanations, action logs, and per-action revoke controls. |
| `v0.5.0-beta` | Installer confidence | Better first-run desktop experience, clearer unsigned/signed tracks, diagnostic export, manual update ergonomics, and optional update feed trial. |
| `v1.0.0` | Long-term self-use | Stable install, phone pairing, remote connection, backup/restore, local memory, generated tools, and clear recovery paths for non-developer users. |

## 中文版本规划

这份文档是对外沟通的事实源：哪里已经发布就写哪里，没发布的只写为计划。

### 当前公开版本：v0.1.4-alpha

`v0.1.4-alpha` / package `0.1.4-alpha.0` 是当前公开 alpha。

已发布：

- Docker Compose 快速体验：`ghcr.io/wgj-fry/lifeos-ai:v0.1.4-alpha`、Ollama、本地 Markdown 记忆、本地 `.ics` 只读读取。
- unsigned 桌面包：macOS Apple Silicon ZIP、Windows x64 NSIS、Linux x64 AppImage。
- 管理员认证、AI provider 设置、SQLite migration、备份恢复、诊断、脱敏审计。
- 手机 PWA 绑定、WebCrypto 设备凭证、设备状态、离线队列、重试/清空、后台同步钩子、冲突复核组、mutation ID、幂等 key，以及离线消息重放时的 SQLite 去重写入。
- LAN、Tailscale、Cloudflare Tunnel、可信 HTTPS 反向代理诊断和公网暴露风险提示。
- 异地长测验收清单：蜂窝网络、Wi-Fi/蜂窝切换、电脑重启、旧二维码修复、隧道断开恢复、诊断包证据。
- 真实异地验收备注必须包含场景证明关键词，不能只靠一段泛泛备注把蜂窝、重启、换网、旧二维码、隧道中断或诊断导出标为完成。
- Studio 生成程序：蓝图确认、扩展模板变体、就绪评分、质量评分、验收标准、权限边界、运行日志、状态保存、带护栏的修复边界和版本回滚。
- 日历/任务同步安全闸门：本地 `.ics` 只读读取，并提供显式开启的 Apple Calendar、Google Calendar/Tasks、系统提醒事项外部读取预览和确认写入连接器路径，包含审计日志、SQLite 写入历史、回滚可用性、安全 create/update/delete 反向操作的受控自动回滚，以及保存冲突、阻塞、回滚复核和下一步的运行证据。
- 基于 URL Scheme 的本地动作权限中心：危险动作确认、脱敏日志，以及文件、日历、提醒事项、剪贴板、脚本动作的阻断预览型原生自动化闸门。
- Release 卫生检查：README、Docker tag、公开 GitHub Release、旧版本、旧 GitHub Latest 指向和安装包资产一致性。

### v0.1.4-alpha 的已知限制

| 模块 | 当前限制 | 对用户的影响 |
| --- | --- | --- |
| unsigned 桌面包 | 还没有 macOS Developer ID 签名/公证，也没有 Windows Authenticode 签名。 | macOS Gatekeeper 和 Windows SmartScreen 可能提示；用户应只从 GitHub Release 下载并校验 `SHA256SUMS`。 |
| 手动更新 | 自动更新未启用。 | 升级需要手动下载新版并校验 SHA256。 |
| 真实异地长测 | 自动诊断和证据记录已经有，但用户仍需在自己的网络里做手机蜂窝、换 Wi-Fi、电脑重启、隧道断开恢复等长测。 | 程序可以证明配置大体可用，但长期稳定仍要真实设备证据。 |
| 日历和任务 | 本地 `.ics` 仍是只读读取。Apple Calendar、Google Calendar/Tasks、系统提醒事项可以作为显式开启的 connector 外部读取预览；窄范围 create/update/delete/complete 需要管理员确认、回滚提示、SQLite 写入历史、审计日志和运行证据；宽泛无人值守账号同步还没发布。 | 可以读导出的/本地日历数据和外部预览，也可以保存冲突/阻塞证据并在非常窄的授权路径里执行写入，但还不是完整后台账号同步系统。 |
| Studio 生成程序 | 已有蓝图、模板、就绪/质量评分、权限、修复提示、日志、状态、回滚，但无人值守自动修复和多版本对比还没完成。 | 用户可以生成和继续调整工具，但仍应人工确认输出和修复决策。 |
| 手机离线队列 | 已有重试、清空、失败状态、存储健康、幂等重放和人工复核冲突组，复杂多设备合并和弱网后台恢复还在增强。 | 普通离线消息不容易丢，也能避免简单重复写入，但复杂冲突仍需要用户可见地处理。 |
| 原生自动化 | 本地动作主要还是 URL Scheme / 浏览器 / 快捷指令桥。 | 更安全、更容易审计，但还不是完整系统级自动化。 |
| Release 卫生 | 已有检查脚本，会阻止低于当前推荐版本的旧 stable Release 抢 GitHub Latest，但 GitHub Release 标签、旧版本和资产仍需发布前人工复核。 | 对外推广前维护者必须跑公开状态检查。 |

### v0.1.4-alpha 之后的源码变更

这些变更已经在 `main` 上实现，但在新 tag、安装包、Docker 镜像、校验文件和 Release notes 发布前，不能当作公开下载版能力宣传。

- 原生自动化桥现在可以执行一个非常窄的 macOS Finder“定位文件”动作；必须同时满足桥开启、精确 `file:reveal` 白名单、文件根目录 allowlist、显式同意、确认短语、审计日志和本地路径脱敏。
- 原生自动化桥现在也可以打开白名单 macOS App bundle id；必须同时满足桥开启、精确 `app:<bundle id>` 白名单、显式同意、确认短语、审计日志，并阻断畸形 bundle id。
- shell、日历、提醒事项和宽泛文件写入自动化仍默认阻断。
- 管理端 UI 会显示 Finder 文件目标是否位于允许的根目录内。
- 测试和 release check 已覆盖 Finder 定位、根目录外拦截、本地路径脱敏和高风险原生写入继续阻断。
- Google Calendar 事件、Google Tasks、Apple Calendar 和系统提醒事项已有受控 connector 代码路径，并新增 `calendar:acceptance` 真实账号/真实设备证据生成。公开宣传同步能力前，仍需要新 Release、安装资产和对应 provider 的读写验收报告。
- Studio 自动修复队列现在包含结构化门禁：通过项、失败项、回滚状态，以及继续修复/人工复核/烟测验证的明确决策。这提升了可恢复性，但还不是完全无人值守修复。
- Studio 自动修复任务现在还包含结构化执行会话：低风险修复会给出 worker 步骤、完成端点、回滚版本、烟测项；高风险或超过重试上限时会生成已拦截会话。
- 已应用的 Studio 自动修复现在必须记录烟测复核后才会从队列消失；通过会关闭队列项，失败会保留回滚建议和人工复核状态。

### 下一计划版本：v0.1.5-alpha

`v0.1.5-alpha` 的目标是在不提前宣传签名包、自动更新、完整日历同步和完整原生自动化的前提下，继续把 alpha 打磨成更稳的长期自用版本。

范围：

- 新打 tag，不移动旧的 `v0.1.4-alpha`。
- 重新构建 macOS unsigned ZIP、Windows NSIS、Linux AppImage、`SHA256SUMS`、`USER-INSTALL.md` 和 `release-manifest.json`。
- 为 `v0.1.5-alpha` 新增 GitHub Discussions 文章；旧帖不再反复改，除非是事实性废弃提示。
- 发布前强制版本真相检查：README、中文 README、release notes、Docker 镜像、桌面包名和当前限制必须一致。
- 发布前运行 `npm run version:truth:release`：工作区必须干净，`main` 必须已推送，新 tag 必须指向准备上传资产的同一个提交；如果完整 macOS/Windows/Linux 上传包不在默认 `release/` 目录，必须用 `LIFEOS_RELEASE_DIR` 指向完整发布资产目录。
- 发布前 `npm run version:truth:release` 还会要求真实异地验收证据：默认读取 `release/remote-acceptance-evidence.json`，也可以用 `LIFEOS_REMOTE_ACCEPTANCE_EVIDENCE` 指向导出的诊断包。证据必须包含稳定 HTTPS 入口、蜂窝、换网、重启、旧二维码、隧道中断和诊断导出场景。
- 继续在诊断和发布说明里保留远程长测证据，并增强缺失真实设备证据时的产品内提示。
- 改进手机弱网后台恢复和多设备冲突复核，重点覆盖手机重启、浏览器存储压力和旧远程入口。
- 将 macOS 日历/提醒事项连接器从窄写入路径推进到产品化权限复核、回滚计划和冲突预览。
- 发布并验证第一版 Google Calendar/Tasks 和 macOS Apple Calendar/系统提醒事项连接器路径：必须经过管理员配置、外部写入开关、用户确认、审计日志、回滚提示和通过的 `calendar:acceptance` 报告；宽泛账号双向同步仍不在这一小步范围内。
- 在已有门禁、执行会话和烟测复核记录之后继续产品化 Studio 自动修复：更清晰的可视化 diff、按模板分类的修复配方，以及 worker 中途失败时的恢复路径。
- 只有在测试和 UI 一起覆盖后，才公开宣传 Studio 自动修复：每个排队修复都必须说明为什么能继续、为什么被拦截、会跑哪些 worker 步骤，以及还剩哪些烟测项。
- 只有在 Release 资产真实包含时，发布并验证窄口径原生自动化桥：默认关闭、仅管理员可用、精确白名单、确认短语、审计日志、敏感 payload 阻断、mock 执行测试、剪贴板写入、白名单快捷指令和允许根目录内 Finder 定位；宽泛 shell/文件写入/日历/提醒事项自动化仍阻断。
- 未真正发布前，不宣传签名包、自动更新、日历/任务双向同步、原生自动化或完全无人值守 Studio 修复。

如果 `v0.1.5-alpha` 要宣传 Google Calendar / Google Tasks 连接器写入，还必须用安全的测试账号或一次性测试日历/任务列表跑真实账号验收：

```bash
LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR=1 \
LIFEOS_GOOGLE_CALENDAR_CLIENT_ID="..." \
LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET="..." \
LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN="..." \
LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 \
LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="WRITE TO EXTERNAL CALENDAR" \
npm run calendar:acceptance -- --write --out calendar-acceptance.json
```

### 尚未发布

下面这些能力还不能写成当前版本已完成：

- macOS 签名和公证包。
- Windows Authenticode 签名包。
- 默认启用自动更新。
- 超出窄范围事件/任务连接器路径的 Google Calendar / Google Tasks 宽泛双向同步。
- 超出当前 macOS 显式开启连接器路径的 Apple Calendar / 系统提醒事项产品级双向同步。
- Studio 完全无人值守自动修复。
- 超出 URL Scheme / 浏览器 / 快捷指令桥的完整原生系统自动化。
- 不需要用户真实证据即可证明任意网络里的异地长期稳定连接。
