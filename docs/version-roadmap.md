# LifeOS AI Version Roadmap

This roadmap is a truth source for public communication. It separates what is shipped in the current public release from what is planned next and what is still future work.

## Shipped in the Current Public Release: v0.1.3-alpha

`v0.1.3-alpha` / package `0.1.3-alpha.0` is the current public alpha.

It includes:

- Docker Compose quickstart with `ghcr.io/wgj-fry/lifeos-ai:v0.1.3-alpha`, Ollama, local Markdown memory, and read-only local `.ics` ingestion.
- Unsigned desktop packages: macOS Apple Silicon ZIP, Windows x64 NSIS installer, and Linux x64 AppImage.
- Admin authentication, AI provider settings, SQLite migrations, backup/restore, diagnostics, and redacted audit data.
- Mobile PWA pairing, WebCrypto device credentials, device status, offline queue, retry/clear controls, and background sync hooks.
- LAN, Tailscale, Cloudflare Tunnel, and trusted HTTPS reverse-proxy diagnostics with public-exposure warnings.
- Remote acceptance checklist covering cellular use, Wi-Fi/cellular switching, desktop restart recovery, stale QR repair, tunnel interruption recovery, and diagnostic export evidence.
- Studio generated programs with blueprint confirmation, template matching, permission boundaries, runtime logs, state storage, repair guidance, and version rollback.
- URL Scheme based local action permission center with dangerous-action confirmation and redacted logs.
- Release hygiene checks for README, Docker image tags, public GitHub Release state, stale releases, stale GitHub Latest labels, and release assets.

## Known Limits in v0.1.3-alpha

These are not bugs hidden from users; they are the honest alpha boundary.

| Area | Current limit | User-facing impact |
| --- | --- | --- |
| Unsigned desktop packages | macOS Developer ID signing/notarization and Windows Authenticode signing are not enabled. | macOS Gatekeeper and Windows SmartScreen may warn. Users should download only from GitHub Releases and verify `SHA256SUMS`. |
| Manual update | Automatic updates are not enabled. | Users update by downloading the next release manually and verifying SHA256. |
| Real-device remote acceptance | Automated checks and evidence records exist, but each user must still run real phone/cellular/Wi-Fi/restart/tunnel long tests on their own network. | Remote diagnostics can say the setup is plausible; only real-device evidence proves long-term stability. |
| Calendar and tasks | Local `.ics` ingestion is read-only. Apple Calendar, Google Calendar, and system reminders two-way sync are not shipped. | LifeOS can read exported/local calendar data, but it cannot manage accounts or write back tasks yet. |
| Studio generated programs | Blueprints, templates, permissions, repair guidance, logs, state, and rollback exist, but product-grade unattended auto-repair and multi-version comparison are not complete. | Users can generate and refine tools, but should review outputs and repair manually. |
| Mobile offline queue | Retry, clear, failure state, storage health, and conflict-risk hints exist. Deep multi-device merge and weak-network background recovery are still improving. | Offline messages are protected from simple loss, but complex conflicts still need visible user review. |
| Native automation | Local actions are mainly URL Scheme / browser / Shortcuts bridge based. | It is safer and reviewable, but not a full native OS automation system yet. |
| Release hygiene | Checks exist, including a guard that blocks any older stable Release from stealing GitHub Latest, but GitHub Release labels and old releases still require final human review before public promotion. | The maintainer must run public checks before broad announcements. |

## Next Planned Alpha: v0.1.4-alpha

`v0.1.4-alpha` should turn the latest `main` source work into a real public download and tighten long-term self-use.

Scope:

- Publish a new tag instead of moving `v0.1.3-alpha`.
- Rebuild unsigned macOS ZIP, Windows NSIS installer, Linux AppImage, `SHA256SUMS`, `USER-INSTALL.md`, and `release-manifest.json`.
- Add a new GitHub Discussions article for `v0.1.4-alpha`; do not edit older release posts except for factual deprecation warnings.
- Require version truth checks before release: README, Chinese README, release notes, Docker image, desktop asset names, and current alpha limits must agree.
- Keep remote acceptance evidence visible in diagnostics and release guidance.
- Add a long-test evidence matrix for cellular use, Wi-Fi/cellular switching, desktop restart recovery, stale QR repair, tunnel interruption recovery, and redacted diagnostic export.
- Improve mobile remote entry health guidance and add the expanded Studio candidate template variant library plus template readiness checks from current `main`.
- Strengthen the mobile offline queue with manual-review conflict groups for similar messages sent from different devices or entries during weak-network windows, including reviewed keep-all and keep-selected resolution paths.
- Add a mobile offline queue sync recovery plan that separates background-ready, manual-review, blocked, offline, and weak-network states.
- Add mobile offline queue sync identity: mutation IDs, idempotency keys, client sequence numbers, visible sync stages, backup metadata, and duplicate-safe SQLite chat write-back for replayed offline messages.
- Add Studio blueprint readiness scoring, generated-tool quality scoring, acceptance criteria, failure triggers, and guarded auto-repair/manual-review boundaries before generating problem-solving apps.
- Add the calendar/task sync safety gate and first macOS connector path: local `.ics` remains read-only; Apple Calendar and system Reminders writes require macOS connector opt-in, external-write opt-in, explicit admin confirmation, and audit logging; Google Calendar remains preview-only until OAuth ships.
- Add the native automation safety gate: file, calendar, reminder, clipboard, and shell actions remain blocked preview-only until a native bridge, explicit consent, and audit logging are implemented.
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

`npm run version:truth:release` is intentionally stricter than the daily version check. Run it only when the worktree is clean, `main` has been pushed, and the new public tag already points at the exact commit whose assets will be uploaded. If it fails, fix the release state before editing GitHub Release assets.

When the public assets are uploaded, also run:

```bash
LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch
docker logout ghcr.io || true
docker pull ghcr.io/wgj-fry/lifeos-ai:v0.1.4-alpha
```

## Future Milestones

## Not Shipped Yet

These capabilities should not be described as current release features until they have code, tests, release assets, and user-facing documentation:

- Signed and notarized macOS builds.
- Authenticode-signed Windows builds.
- Automatic update enabled by default.
- Google Calendar two-way sync.
- Fully productized Apple Calendar and system Reminders two-way sync beyond the current macOS opt-in connector path.
- Fully automatic unattended Studio repair.
- Full native OS automation beyond URL Scheme / browser / Shortcuts bridge actions.
- Real-world remote acceptance completed for every user's network without user evidence.

| Version | Theme | Planned work |
| --- | --- | --- |
| `v0.1.5-alpha` | Mobile reliability | Stronger offline conflict handling, multi-device edit warnings, failed-sync review, and weak-network background recovery. |
| `v0.2.0-alpha` | Calendar and tasks | Google Calendar OAuth connector, productized Apple Calendar / system Reminders sync, explicit permission prompts, write-back audit log, and rollback path. |
| `v0.3.0-alpha` | Studio product loop | Template marketplace polish, multi-version visual comparison, automatic repair proposal flow, capability review center, and stronger generated-tool quality scoring. |
| `v0.4.0-alpha` | Native action safety | Safer local automation bridge beyond URL Scheme, OS-level permission explanations, action logs, and per-action revoke controls. |
| `v0.5.0-beta` | Installer confidence | Better first-run desktop experience, clearer unsigned/signed tracks, diagnostic export, manual update ergonomics, and optional update feed trial. |
| `v1.0.0` | Long-term self-use | Stable install, phone pairing, remote connection, backup/restore, local memory, generated tools, and clear recovery paths for non-developer users. |

## 中文版本规划

这份文档是对外沟通的事实源：哪里已经发布就写哪里，没发布的只写为计划。

### 当前公开版本：v0.1.3-alpha

`v0.1.3-alpha` / package `0.1.3-alpha.0` 是当前公开 alpha。

已发布：

- Docker Compose 快速体验：`ghcr.io/wgj-fry/lifeos-ai:v0.1.3-alpha`、Ollama、本地 Markdown 记忆、本地 `.ics` 只读读取。
- unsigned 桌面包：macOS Apple Silicon ZIP、Windows x64 NSIS、Linux x64 AppImage。
- 管理员认证、AI provider 设置、SQLite migration、备份恢复、诊断、脱敏审计。
- 手机 PWA 绑定、WebCrypto 设备凭证、设备状态、离线队列、重试/清空和后台同步钩子。
- LAN、Tailscale、Cloudflare Tunnel、可信 HTTPS 反向代理诊断和公网暴露风险提示。
- 异地长测验收清单：蜂窝网络、Wi-Fi/蜂窝切换、电脑重启、旧二维码修复、隧道断开恢复、诊断包证据。
- Studio 生成程序：蓝图确认、模板匹配、权限边界、运行日志、状态保存、修复提示和版本回滚。
- 基于 URL Scheme 的本地动作权限中心：危险动作确认和脱敏日志。
- Release 卫生检查：README、Docker tag、公开 GitHub Release、旧版本、旧 GitHub Latest 指向和安装包资产一致性。

### v0.1.3-alpha 的已知限制

| 模块 | 当前限制 | 对用户的影响 |
| --- | --- | --- |
| unsigned 桌面包 | 还没有 macOS Developer ID 签名/公证，也没有 Windows Authenticode 签名。 | macOS Gatekeeper 和 Windows SmartScreen 可能提示；用户应只从 GitHub Release 下载并校验 `SHA256SUMS`。 |
| 手动更新 | 自动更新未启用。 | 升级需要手动下载新版并校验 SHA256。 |
| 真实异地长测 | 自动诊断和证据记录已经有，但用户仍需在自己的网络里做手机蜂窝、换 Wi-Fi、电脑重启、隧道断开恢复等长测。 | 程序可以证明配置大体可用，但长期稳定仍要真实设备证据。 |
| 日历和任务 | 只支持本地 `.ics` 只读读取。Apple Calendar、Google Calendar、系统提醒事项双向同步还没发布。 | 可以读导出的/本地的日历数据，但不能管理账号或写回任务。 |
| Studio 生成程序 | 已有蓝图、模板、权限、修复提示、日志、状态、回滚，但无人值守自动修复和多版本对比还没完成。 | 用户可以生成和继续调整工具，但仍应人工确认输出。 |
| 手机离线队列 | 已有重试、清空、失败状态、存储健康和冲突风险提示，复杂多设备合并和弱网后台恢复还在增强。 | 普通离线消息不容易丢，但复杂冲突仍需要用户可见地处理。 |
| 原生自动化 | 本地动作主要还是 URL Scheme / 浏览器 / 快捷指令桥。 | 更安全、更容易审计，但还不是完整系统级自动化。 |
| Release 卫生 | 已有检查脚本，会阻止低于当前推荐版本的旧 stable Release 抢 GitHub Latest，但 GitHub Release 标签、旧版本和资产仍需发布前人工复核。 | 对外推广前维护者必须跑公开状态检查。 |

### 下一计划版本：v0.1.4-alpha

`v0.1.4-alpha` 的目标是把当前 `main` 的最新源码能力做成真实可下载版本，并进一步收紧“长期自用”的异地连接证据。

范围：

- 新打 tag，不移动旧的 `v0.1.3-alpha`。
- 重新构建 macOS unsigned ZIP、Windows NSIS、Linux AppImage、`SHA256SUMS`、`USER-INSTALL.md` 和 `release-manifest.json`。
- 为 `v0.1.4-alpha` 新增 GitHub Discussions 文章；旧帖不再反复改，除非是事实性废弃提示。
- 发布前强制版本真相检查：README、中文 README、release notes、Docker 镜像、桌面包名和当前限制必须一致。
- 发布前运行 `npm run version:truth:release`：工作区必须干净，`main` 必须已推送，新 tag 必须指向准备上传资产的同一个提交。
- 继续在诊断和发布说明里保留远程长测证据。
- 增加异地长测证据矩阵：覆盖手机蜂窝、Wi-Fi/蜂窝切换、电脑重启恢复、旧二维码修复、隧道中断恢复和诊断包脱敏导出。
- 纳入当前 `main` 已有的手机远程入口健康提示、Studio 候选模板变体库和模板就绪检查。
- 强化手机离线队列：弱网窗口内来自不同设备或入口的相似消息会进入人工复核冲突组，并支持复核后保留全部或保留指定消息。
- 增加手机离线队列同步恢复策略：明确区分可后台补写、需人工复核、远程入口阻塞、离线等待和弱网等待。
- 增加手机离线队列同步身份：mutation ID、幂等 key、客户端序号、可见同步阶段、备份元数据，以及离线消息重放时 SQLite 聊天写入去重。
- 增加 Studio 蓝图生成就绪评分、生成程序质量评分、验收标准、失败触发，以及带护栏自动修复/人工复核边界。
- 增加日历/任务同步安全闸门和第一版 macOS 连接器路径：本地 `.ics` 仍然只读；Apple Calendar 和系统提醒事项写入必须启用 macOS connector、启用外部写入开关、管理员明确确认并写审计日志；Google Calendar 仍等 OAuth。
- 增加原生自动化安全闸门：文件、日历、提醒事项、剪贴板、脚本动作在原生桥、用户确认和审计日志完成前都只允许阻断预览。
- 未真正发布前，不宣传签名包、自动更新、日历/任务双向同步、原生自动化或完全无人值守 Studio 修复。

### 尚未发布

下面这些能力还不能写成当前版本已完成：

- macOS 签名和公证包。
- Windows Authenticode 签名包。
- 默认启用自动更新。
- Google Calendar 双向同步。
- 超出当前 macOS 显式开启连接器路径的 Apple Calendar / 系统提醒事项产品级双向同步。
- Studio 完全无人值守自动修复。
- 超出 URL Scheme / 浏览器 / 快捷指令桥的完整原生系统自动化。
- 不需要用户真实证据即可证明任意网络里的异地长期稳定连接。
