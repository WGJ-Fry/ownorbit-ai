# OwnOrbit AI Version Roadmap

This roadmap is a truth source for public communication. It separates what is shipped in the current public release from what is planned next and what is still future work.

## Shipped in the Current Public Release: v0.1.5-alpha

`v0.1.5-alpha` / package `0.1.5-alpha.0` is the current public alpha line being prepared from `main`.

It includes:

- Docker Compose quickstart with `ghcr.io/wgj-fry/lifeos-ai:v0.1.5-alpha`, Ollama, local Markdown memory, and read-only local `.ics` ingestion.
- Unsigned desktop packages: macOS Apple Silicon ZIP, Windows x64 NSIS installer, and Linux x64 AppImage.
- Admin authentication, AI provider settings, SQLite migrations, backup/restore, diagnostics, redacted audit data, and public-release review evidence.
- Bilingual README product videos: English and Chinese 30-second MP4 demos with matching GIF previews and cover images.
- Mobile PWA pairing, WebCrypto device credentials, device status, offline queue, retry/clear controls, background sync hooks, conflict review groups, mutation IDs, idempotency keys, duplicate-safe chat write-back, and latest offline recovery attempt evidence.
- LAN, Tailscale, Cloudflare Tunnel, and trusted HTTPS reverse-proxy diagnostics with public-exposure warnings.
- Remote acceptance checklist and release evidence requirements covering cellular use, Wi-Fi/cellular switching, desktop restart recovery, stale QR repair, tunnel interruption recovery, diagnostic export, and redacted evidence review.
- Remote health monitoring samples in diagnostics: pass/fail counts, recovery attempts, consecutive successes, observed duration, and latest samples.
- Opt-in CloudKit native data-sync candidate: guarded helper contract, safe batch preview, explicit upload/sync confirmations, quarantine import, conservative apply, checkpoint promotion, device-trust metadata records, and auto-apply only for append-only chat messages, new normal memories, and new tasks.
- Studio generated programs with blueprint confirmation, expanded template variants, readiness scoring, quality scoring, acceptance criteria, permission boundaries, runtime logs, state storage, guarded repair boundaries, repair queue evidence, static smoke review, and version rollback.
- Calendar/task safety gates with read-only `.ics` ingestion plus opt-in Apple Calendar, Google Calendar/Tasks, and system Reminders connector paths for external read previews and explicitly confirmed external writes, with audit logs, SQLite write history, rollback availability, guarded automatic rollback for safe reversals, and saved run evidence.
- URL Scheme based local action permission center with dangerous-action confirmation, redacted logs, and narrow opt-in native automation bridge paths for clipboard, allowlisted Shortcuts, Finder reveal, and allowlisted macOS app bundle opening.
- Release hygiene checks for README, Docker image tags, public GitHub Release state, stale releases, GitHub Latest labels, release assets, update diagnostics, and remote acceptance evidence.

## Known Limits in v0.1.5-alpha

These are not bugs hidden from users; they are the honest alpha boundary.

| Area | Current limit | User-facing impact |
| --- | --- | --- |
| Unsigned desktop packages | macOS Developer ID signing/notarization and Windows Authenticode signing are not enabled. | macOS Gatekeeper and Windows SmartScreen may warn. Users should download only from GitHub Releases and verify `SHA256SUMS`. |
| Manual update | Automatic updates are not enabled for the public unsigned alpha. | Users update by downloading the next release manually and verifying SHA256. Signed distributions can use a safe HTTPS feed later. |
| Real-device remote acceptance | Automated checks, diagnostics, and evidence records exist, but each user must still run real phone/cellular/Wi-Fi/restart/tunnel tests on their own network. | Remote diagnostics can say the setup is plausible; only real-device evidence proves long-term stability. |
| Calendar and tasks | Local `.ics` ingestion is read-only. Apple Calendar, Google Calendar/Tasks, and system reminders use opt-in previews and narrow confirmed writes; broad unattended account sync is not shipped. | OwnOrbit can preview and perform narrowly gated writes with audit and rollback evidence, but it is not a full background account sync system yet. |
| iCloud data sync | Default iCloud Drive still syncs only mobile entry files. The opt-in CloudKit candidate can mirror selected chat, memory, task, generated-app-state, and device-trust metadata records through a native helper, quarantine, explicit confirmations, and conservative local apply rules. It does not sync raw device credentials, AI keys, full SQLite databases, backups, or account-wide background pushes. | Apple users can open the phone entry from Files today. CloudKit data sync is now a guarded alpha candidate, but it is not a complete hands-off macOS/iOS native sync product yet. |
| Studio generated programs | Blueprints, templates, readiness/quality scoring, repair queue, smoke evidence, and rollback exist, but product-grade unattended self-repair is not complete. | Users can generate and refine tools, but should review outputs and repair decisions manually. |
| Mobile offline queue | Retry, clear, failure state, storage health, idempotent replay, recovery evidence, and manual-review conflict groups exist. Deep multi-device merge and extreme weak-network recovery are still improving. | Offline messages are protected from simple loss and duplicate replay, but complex conflicts still need visible user review. |
| Native automation | Local actions are still mostly URL Scheme / browser / Shortcuts bridge flows, with only narrow opt-in native bridge paths. | It is safer and reviewable, but not a full native OS automation system yet. |
| Release hygiene | Checks exist, including guards for stale Latest and old releases, but GitHub Release labels and old releases still require final human review before public promotion. | The maintainer must run public checks before broad announcements. |

## Next Planned Alpha: v0.1.6-alpha

`v0.1.6-alpha` should focus on proving long-term reliability instead of adding flashy claims.

Scope:

- Publish a new tag instead of moving `v0.1.5-alpha`.
- Keep README, Chinese README, release notes, Docker image, desktop asset names, and current alpha limits strictly aligned.
- Add stronger in-product prompts for missing real-device remote evidence, especially cellular, network switch, restart recovery, stale QR repair, tunnel interruption, and diagnostic export.
- Keep iCloud handoff and CloudKit data sync separate: document that default iCloud Drive only carries entry files, while the guarded CloudKit native candidate covers selected chat/memory/task/generated-app-state/device-trust metadata records and never syncs raw device credentials or AI keys.
- Improve mobile weak-network background recovery and multi-device conflict review after phone restart, browser storage pressure, and stale remote entries.
- Productize the calendar/reminders connector permission review: clearer setup steps, narrower scopes, conflict preview, rollback plan, and acceptance evidence export.
- Continue Studio generated-program reliability: richer visual diff, template-specific repair recipes, stricter smoke checks, and clearer recovery when a repair worker fails mid-run.
- Keep native automation disabled by default with exact allowlists, confirmation phrases, audit logging, and sensitive-payload blocking.
- Do not claim signed desktop packages, automatic updates, full two-way calendar/task sync, full native OS automation, or fully automatic unattended Studio repair until they are actually shipped and verified.

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

`npm run version:truth:release` is intentionally stricter than the daily version check. Run it only when the worktree is clean, `main` has been pushed, the new public tag already points at the exact commit whose assets will be uploaded, release assets exist, and `LIFEOS_REMOTE_ACCEPTANCE_EVIDENCE` points at the exported diagnostic bundle or `release/remote-acceptance-evidence.json` contains the remote evidence pack.

## Not Shipped Yet

These capabilities should not be described as current release features until they have code, tests, release assets, and user-facing documentation:

- Signed and notarized macOS builds.
- Authenticode-signed Windows builds.
- Automatic update enabled by default for unsigned alpha builds.
- Broad Google Calendar/Google Tasks two-way sync beyond the narrow connector paths.
- Fully productized Apple Calendar and system Reminders two-way sync beyond the current opt-in connector path.
- End-user-ready, fully automatic iCloud data sync across macOS/iOS native clients, background pushes, device trust, and generated app state.
- Fully automatic unattended Studio repair.
- Full native OS automation beyond URL Scheme / browser / Shortcuts bridge actions.
- Real-world remote acceptance completed for every user's network without user evidence.

| Version | Theme | Planned work |
| --- | --- | --- |
| `v0.1.6-alpha` | Remote and mobile reliability | Real-device evidence prompts, better weak-network recovery, multi-device conflict review, remote health long-run evidence, and stale-entry recovery. |
| `v0.1.7-alpha` | Calendar and tasks | Productized Google Calendar/Tasks sync, Apple Calendar / system Reminders sync, explicit permission prompts, write-back audit log, conflict preview, and rollback path. |
| `v0.1.8-alpha` | Studio product loop | Template marketplace polish, multi-version visual comparison, automatic repair proposal flow, capability review center, and stronger generated-tool quality scoring. |
| `v0.1.9-alpha` | Native action safety | Safer local automation bridge beyond URL Scheme, OS-level permission explanations, action logs, and per-action revoke controls. |
| `v0.2.0-beta` | Installer confidence | Better first-run desktop experience, clearer unsigned/signed tracks, diagnostic export, manual update ergonomics, and optional update feed trial. |
| `v1.0.0` | Long-term self-use | Stable install, phone pairing, remote connection, backup/restore, local memory, generated tools, and clear recovery paths for non-developer users. |

## 中文版本规划

这份文档是对外沟通的事实源：哪里已经发布就写哪里，没发布的只写为计划。

### 当前公开版本：v0.1.5-alpha

`v0.1.5-alpha` / package `0.1.5-alpha.0` 是当前从 `main` 准备发布的公开 alpha 线。

已包含：

- Docker Compose 快速体验：`ghcr.io/wgj-fry/lifeos-ai:v0.1.5-alpha`、Ollama、本地 Markdown 记忆、本地 `.ics` 只读读取。
- unsigned 桌面包：macOS Apple Silicon ZIP、Windows x64 NSIS、Linux x64 AppImage。
- 管理员认证、AI provider 设置、SQLite migration、备份恢复、诊断、脱敏审计和公开发布复核证据。
- 中英文 README 产品视频：30 秒 MP4、GIF 预览和封面图。
- 手机 PWA 绑定、WebCrypto 设备凭证、设备状态、离线队列、重试/清空、后台同步钩子、冲突复核组、mutation ID、幂等 key、离线消息去重写入和最近离线恢复尝试证据。
- LAN、Tailscale、Cloudflare Tunnel、可信 HTTPS 反向代理诊断和公网暴露风险提示。
- 异地验收清单和发布证据要求：蜂窝网络、Wi-Fi/蜂窝切换、电脑重启、旧二维码修复、隧道断开恢复、诊断包导出和脱敏证据复核。
- 远程健康长测样本：通过/失败次数、恢复尝试、连续成功次数、观测时长和最近样本。
- opt-in CloudKit 原生数据同步候选能力：受控 helper 合约、安全批次预览、显式上传/同步确认、隔离区导入、保守 apply、checkpoint 推进、设备信任元数据记录；设备信任只落到 `cloudkit_device_trust_metadata` 并保持 `needs-rebind`，不会授予访问权。
- Studio 生成程序：蓝图确认、扩展模板、就绪评分、质量评分、验收标准、权限边界、运行日志、状态保存、带护栏的修复边界、修复队列证据、静态烟测复核和版本回滚。
- 日历/任务同步安全闸门：本地 `.ics` 只读读取，以及显式开启的 Apple Calendar、Google Calendar/Tasks、系统提醒事项外部读取预览和确认写入连接器路径，包含审计日志、SQLite 写入历史、回滚可用性、安全反向操作和运行证据。
- 基于 URL Scheme 的本地动作权限中心：危险动作确认、脱敏日志，以及剪贴板、白名单 Shortcuts、Finder reveal、白名单 macOS app 打开的窄范围 opt-in 原生桥。
- Release 卫生检查：README、Docker tag、公开 GitHub Release、旧版本、GitHub Latest、安装包资产、更新诊断和远程验收证据一致性。

### v0.1.5-alpha 的已知限制

| 模块 | 当前限制 | 对用户的影响 |
| --- | --- | --- |
| unsigned 桌面包 | 还没有 macOS Developer ID 签名/公证，也没有 Windows Authenticode 签名。 | macOS Gatekeeper 和 Windows SmartScreen 可能提示；用户应只从 GitHub Release 下载并校验 `SHA256SUMS`。 |
| 手动更新 | 公开 unsigned alpha 默认不启用自动更新。 | 用户需要手动下载新版并校验 SHA256。signed 分发以后可以使用安全 HTTPS feed。 |
| 真实异地长测 | 自动诊断和证据记录已经有，但用户仍需在自己的网络里做手机蜂窝、换 Wi-Fi、电脑重启、隧道断开恢复等长测。 | 程序可以证明配置大体可用，但长期稳定仍要真实设备证据。 |
| 日历和任务 | 本地 `.ics` 仍是只读读取。Apple Calendar、Google Calendar/Tasks、系统提醒事项使用显式开启的预览和窄范围确认写入；宽泛无人值守账号同步还没发布。 | 可以预览并在非常窄的授权路径里执行写入、审计和回滚，但还不是完整后台账号同步系统。 |
| iCloud 数据同步 | 默认 iCloud Drive 仍只同步手机入口文件。opt-in CloudKit 候选能力可以通过原生 helper、隔离区、显式确认和保守本地 apply 规则同步部分聊天、记忆、任务、生成程序状态和设备信任元数据记录；不会同步原始设备凭证、AI Key、完整 SQLite、备份或账号级后台推送。 | Apple 用户今天可以从“文件”App 打开手机入口。CloudKit 数据同步已经是受控 alpha 候选能力，但还不是完整免维护的 macOS/iOS 原生同步产品。 |
| Studio 生成程序 | 已有蓝图、模板、就绪/质量评分、修复队列、烟测证据和回滚，但产品级无人值守自修复还没完成。 | 用户可以生成和继续调整工具，但仍应人工确认输出和修复决策。 |
| 手机离线队列 | 已有重试、清空、失败状态、存储健康、幂等重放、恢复证据和人工复核冲突组，复杂多设备合并和极弱网后台恢复还在增强。 | 普通离线消息不容易丢，也能避免简单重复写入，但复杂冲突仍需要用户可见地处理。 |
| 原生自动化 | 本地动作仍主要是 URL Scheme / 浏览器 / Shortcuts 桥，只开放很窄的 opt-in 原生桥路径。 | 更安全、更容易审计，但还不是完整系统级自动化。 |
| Release 卫生 | 已有检查和防旧 Latest 保护，但 GitHub Release 标签、旧版本标记仍需发布前人工复核。 | 维护者必须在公开宣传前跑公开检查。 |

### 下一计划版本：v0.1.6-alpha

`v0.1.6-alpha` 应优先证明长期可靠性，而不是继续增加夸张宣传。

范围：

- 新打 tag，不移动旧的 `v0.1.5-alpha`。
- README、中文 README、Release notes、Docker 镜像、桌面资产名和 alpha 限制必须严格一致。
- 增强真实异地证据缺失提示，尤其是蜂窝网络、换网、重启恢复、旧二维码修复、隧道中断和诊断导出。
- 继续区分 iCloud 入口同步和 CloudKit 数据同步：写清楚默认 iCloud Drive 只传入口文件，受控 CloudKit 原生候选能力只覆盖部分聊天/记忆/任务/生成程序状态/设备信任元数据记录；设备信任元数据只用于重新绑定前的安全盘点，永远不同步原始设备凭证或 AI Key。
- 增强手机弱网后台恢复和多端冲突复核，覆盖手机重启、浏览器存储压力和过期远程入口。
- 产品化日历/提醒事项连接器权限复核：更清楚的设置步骤、更窄授权范围、冲突预览、回滚计划和验收证据导出。
- 继续增强 Studio 生成程序可靠性：更清楚的视觉 diff、模板级修复策略、更严格烟测和修复失败恢复。
- 原生自动化继续默认关闭，必须有精确白名单、确认短语、审计日志和敏感 payload 阻断。
- 未真正发布和验证前，不宣传签名桌面包、自动更新、完整双向日历/任务同步、完整原生系统自动化或完全无人值守 Studio 自修复。

### 尚未发布

这些能力在具备代码、测试、Release 资产和用户文档之前，不应写成当前功能：

- macOS 签名和公证包。
- Windows Authenticode 签名包。
- unsigned alpha 默认自动更新。
- 超出窄 connector 路径的 Google Calendar / Google Tasks 双向同步。
- 超出当前 opt-in connector 的 Apple Calendar / 系统提醒事项完整双向同步。
- 跨 macOS/iOS 原生客户端、后台推送、设备信任和生成程序状态的完整免维护 iCloud 数据同步产品。
- 完全无人值守 Studio 自修复。
- 超出 URL Scheme / 浏览器 / Shortcuts 桥的完整原生 OS 自动化。
- 不需要用户证据就能替所有网络完成真实异地验收。
