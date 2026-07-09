# iCloud Data Sync Design Boundary

This document is the engineering boundary for iCloud handoff and the guarded CloudKit data-sync candidate. The default product flow only uses iCloud Drive to sync the mobile entry files:

- `lifeos-mobile-entry.html`
- `lifeos-mobile-entry-*.html`
- `lifeos-mobile-entry-*.json`
- `lifeos-mobile-entry-history.json`

The default iCloud Drive handoff does not sync chat history, memory, tasks, device credentials, SQLite databases, AI keys, audit logs, backups, or generated app state. The opt-in CloudKit native candidate can mirror selected chat, memory, task, generated-app-state, and device-trust metadata records only after the native helper, CloudKit container, entitlements, explicit confirmation, quarantine preview, and local safety gates are ready.

## Why iCloud Drive Is Not Enough

iCloud Drive is useful for handing a small entry file from Mac to iPhone. It is not a safe database or realtime transport for LifeOS data because:

- sync timing is controlled by the OS and can be delayed;
- web/PWA code cannot reliably observe CloudKit identity, record zones, conflict state, or background pushes;
- file-based sync can create partial, stale, duplicated, or placeholder files;
- device credentials and AI keys must not be copied into casual files;
- realtime chat still needs LAN, Tailscale, Cloudflare Tunnel, trusted HTTPS, or a future LifeOS Relay.

## Required Native Architecture

Real iCloud data sync is built as a separate native capability, not by expanding the current iCloud Drive handoff file. The current desktop code contains the guarded CloudKit helper contract and server-side quarantine/apply pipeline; it is still not a complete background macOS/iOS native sync product.

Minimum architecture:

1. macOS native companion or menu-bar helper.
2. iOS native shell or Shortcut-assisted native bridge.
3. Apple Developer iCloud entitlement.
4. CloudKit container owned by the app bundle.
5. Private database record zones for user data.
6. Local SQLite remains the desktop source of truth until sync is explicitly enabled.
7. PWA remains a client; it does not receive raw CloudKit credentials.

## Data Classes

| Data class | Current location | Future sync policy |
| --- | --- | --- |
| Mobile entry file | iCloud Drive | Already synced as handoff only |
| Chat messages | SQLite on desktop | Optional CloudKit mirror after explicit opt-in |
| Memories | SQLite / local vault on desktop | Optional CloudKit mirror with conflict review |
| Tasks | SQLite / connector history | Optional CloudKit records after permission review |
| Device trust metadata | SQLite on desktop | Optional CloudKit metadata mirror with public-key fingerprint only |
| Device credentials | Server-side SQLite plus phone WebCrypto key | Never blindly sync; rotate/rebind instead |
| AI provider keys | Secure store / encrypted server-side fallback | Never sync through iCloud |
| Audit logs | SQLite | Export-only or redacted sync, never silent full sync |
| Backups | Local encrypted files | User-controlled encrypted backup only |

## Safety Rules

- No secret, token, AI key, session cookie, or raw device credential may be written to iCloud Drive or CloudKit user records.
- CloudKit sync must be opt-in and reversible.
- Every write outside the local SQLite source of truth needs an audit event.
- First sync must create a local backup.
- Conflict resolution must be visible before destructive merges.
- A device that loses trust must be revoked locally and in CloudKit metadata.
- Offline writes need stable mutation IDs and idempotent replay.
- The app must keep working if iCloud is disabled, signed out, delayed, or quota-limited.

## Suggested Record Model

Use a private CloudKit database with scoped zones:

- `LifeOSProfile`: user-local sync metadata, schema version, enabled data classes.
- `LifeOSDevice`: device id, display name, trust state, public signing key fingerprint, last seen.
- `LifeOSConversation`: conversation metadata without provider secrets.
- `LifeOSMessage`: message payload, mutation id, logical clock, redaction flags.
- `LifeOSMemory`: memory text, source, tags, created/updated logical clocks.
- `LifeOSTask`: task title, state, due date, origin connector, external reference.
- `LifeOSSyncCheckpoint`: per-device cursor and last applied mutation.

## Implementation Record Plan

The server readiness check publishes a concrete, non-secret record plan for the future native helper. This is still a readiness contract, not completed iCloud data sync.

| Data type | Zone | Record types | Mutation model | Conflict policy |
| --- | --- | --- | --- | --- |
| `chat-history` | `LifeOSChatZone` | `LifeOSConversation`, `LifeOSMessage`, `LifeOSSyncCheckpoint` | Append-only messages with stable mutation IDs and per-device checkpoints. | Message replay is idempotent; conversation title and metadata conflicts require review. |
| `memory` | `LifeOSMemoryZone` | `LifeOSMemory`, `LifeOSMemoryTombstone`, `LifeOSSyncCheckpoint` | Upserts and tombstones with logical clocks. | Metadata can merge conservatively; memory text conflicts require review. |
| `tasks` | `LifeOSTaskZone` | `LifeOSTask`, `LifeOSTaskTombstone`, `LifeOSSyncCheckpoint` | Guarded task state transitions with reversible tombstones. | Completion can move forward automatically; title, due date, and external refs require review. |
| `generated-app-state` | `LifeOSGeneratedAppZone` | `LifeOSGeneratedAppState`, `LifeOSGeneratedAppMutation`, `LifeOSSyncCheckpoint` | Versioned snapshots plus ordered mutations. | Conflicting edits create a candidate version and must be compared before merge. |
| `device-trust` | `LifeOSDeviceTrustZone` | `LifeOSDeviceTrust`, `LifeOSSyncCheckpoint` | Metadata-only snapshots with device id hash, display name, type, trust state, public-key fingerprint, and timestamps. | Never grants local access automatically; imported devices require rebind or explicit trust review. |

Forbidden fields for every plan include provider API keys, raw tokens, session cookies, raw device credentials, whole SQLite databases, and local file paths. These fields must stay out of CloudKit records, diagnostics, logs, backups, and API responses.

## Native Acceptance Gates

The CloudKit readiness payload exposes release gates so the UI and diagnostic bundle can show why true data sync is or is not ready:

- explicit user opt-in;
- Apple native runtime;
- CloudKit container;
- Apple Team ID and bundle ID;
- executable native CloudKit helper;
- entitlements that mention CloudKit and the selected container;
- at least one safe selected data type;
- unsafe requested data types filtered and removed before release;
- local SQLite backup before first sync;
- native helper create/fetch/delete roundtrip;
- redaction proof for selected record types.

## Native Helper Contract

The native macOS/iOS CloudKit helper is invoked through a fixed JSON-over-stdio contract:

- command argument: `--lifeos-cloudkit-json`;
- request schema: `lifeos-cloudkit-helper-request.v1`;
- response schema: `lifeos-cloudkit-helper-response.v1`;
- operations: `probe` and `roundtrip`;
- default timeout: 15 seconds.

The first native helper scaffold lives at `native/apple/cloudkit-helper/LifeOSCloudKitHelper.swift`. It links `CloudKit.framework`, reads the LifeOS JSON request from stdin, and writes the JSON response to stdout. Build it on macOS with:

```bash
npm run icloud:helper:build
```

The build output is intentionally local (`build/native/LifeOSCloudKitHelper`) and should not be committed. Configure it with:

```bash
export LIFEOS_CLOUDKIT_HELPER_BIN="$PWD/build/native/LifeOSCloudKitHelper"
```

`probe` must check Apple account status, CloudKit container reachability, quota/status visibility, custom zone access, change-token fetch capability, and background subscription support without writing user data.

`roundtrip` must create, fetch, and delete a disposable test record in the private CloudKit database using the selected record plan. It must return an evidence id, verified capabilities, and redacted warnings/errors. A failed or skipped helper smoke never counts as real iCloud data sync.

The scaffold protects `roundtrip` behind `LIFEOS_CLOUDKIT_TEST_WRITE_CONFIRM=DELETE_DISPOSABLE_RECORDS`, so a probe can remain read-only and a disposable write cannot happen by accident.

## Sync Batch Preview

The admin API now exposes a guarded preview endpoint:

```text
GET /api/v1/admin/icloud-data-sync/batch-preview
```

This endpoint reads local SQLite data for selected CloudKit classes and builds a safe batch summary before any export is allowed. It intentionally returns hashes, record types, field names, zones, counts, and blocked reasons only. It does not return raw chat text, memory content, task payloads, generated-app state, AI keys, device credentials, session cookies, local paths, or SQLite blobs.

The preview can produce:

- ready records for `LifeOSConversation`, `LifeOSMessage`, `LifeOSMemory`, `LifeOSTask`, `LifeOSGeneratedAppState`, and `LifeOSDeviceTrust`;
- blocked records for sensitive memories, malformed JSON, unsafe fields, and secret-like content;
- a `lifeos-cloudkit-sync-batch-preview.v1` helper payload plan that remains preview-only until helper probe and disposable roundtrip evidence pass.

This is still not real continuous sync. It is the safety gate that proves LifeOS can select syncable records from SQLite without leaking raw payloads into the admin response. A future export operation must use the same filtering, require backup evidence, call the native helper, and write only approved CloudKit record fields.

## Controlled Sync Export

The next guarded step is a local-only native helper export:

```text
POST /api/v1/admin/icloud-data-sync/export
```

The endpoint only runs when all of these are true:

- CloudKit native readiness is `ready-to-test`;
- the safe batch preview status is `ready`;
- no sensitive, malformed, or secret-like record is blocked;
- the request carries the explicit `SYNC_APPROVED_RECORDS` confirmation;
- LifeOS creates a local SQLite backup before invoking the helper.

The admin response still returns only a summary: preview status, record counts, zones, record plan hash, helper evidence, and backup metadata. It does not return raw chat text, memory text, task payloads, generated-app state, or helper stdin. The filtered payload is sent only from the local desktop server to the configured native helper through JSON stdin.

The native helper now has a `sync-export` operation. It saves approved records into the private CloudKit database using the selected record zones and returns only attempted/saved/failed counts plus an evidence id. This is a first write path for approved CloudKit records, not complete background sync. Full sync still needs change-token import, conflict review, remote delete/tombstone handling, retry queues, and real two-device Apple testing.

The product-facing upload path wraps the same safety model:

```text
POST /api/v1/admin/icloud-data-sync/upload-now
```

It requires explicit `UPLOAD_CLOUDKIT_NOW` confirmation, creates a SQLite backup, sends filtered records only to the native helper through local stdin, and returns only status/counts/evidence. Unlike the lower-level export endpoint, this one-step upload response never returns a local backup path. It is designed for first-launch Apple users who need a clear "put this Mac into iCloud" action before later syncing another device.

The safest product-facing loop is:

```text
POST /api/v1/admin/icloud-data-sync/cycle
```

It requires explicit `SYNC_CLOUDKIT_CYCLE` confirmation and always pulls first. The backend runs `sync-now` to read CloudKit changes, import them into quarantine, and apply only conflict-free records. If the pull fails or leaves conflicts, the cycle stops and does not upload local records. Only after the pull is clean does LifeOS run the guarded upload path. This gives users one default "sync this computer and iCloud" button while keeping conflict review and sensitive-record blocking intact.

Run the contract smoke with:

```bash
export LIFEOS_ICLOUD_DATA_SYNC=1
export LIFEOS_CLOUDKIT_CONTAINER_ID=iCloud.your.container
export LIFEOS_CLOUDKIT_TEAM_ID=YOURTEAMID
export LIFEOS_CLOUDKIT_BUNDLE_ID=your.bundle.id
export LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH=/path/to/Your.entitlements
npm run icloud:helper:smoke -- --probe
LIFEOS_CLOUDKIT_TEST_WRITE_CONFIRM=DELETE_DISPOSABLE_RECORDS \
npm run icloud:helper:smoke -- --roundtrip --strict
```

## Controlled Import Preview

The next read-side guard is a summary-only CloudKit query:

```text
POST /api/v1/admin/icloud-data-sync/import-preview
```

This endpoint invokes the native helper with `sync-import-preview`. It queries the private CloudKit database for LifeOS record summaries using the configured record plan and returns only safe metadata:

- zone and record type;
- record name;
- mutation id;
- content hash;
- logical clock;
- payload byte size;
- modified timestamp;
- review flag.

The helper intentionally excludes `payloadJson` from the requested CloudKit keys, and the admin API does not write anything into SQLite. This proves the desktop can read LifeOS CloudKit records without importing raw user content or merging remote state too early.

This is still not background two-way sync. The next steps are change-token persistence, raw helper-to-backend import under a redacted local-only channel, conflict review UI, tombstone/delete handling, retries, and two-device Apple testing.

## Incremental Changes Preview

LifeOS now has the first change-token shaped read path:

```text
POST /api/v1/admin/icloud-data-sync/changes-preview
```

The backend passes only locally applied per-zone CloudKit server change tokens to the native helper. The helper calls `recordZoneChanges(inZoneWith:since:desiredKeys:resultsLimit:)` for each planned zone, requests only the safe summary fields, and returns:

- changed record summaries;
- deleted record summaries;
- per-zone changed/deleted/failed counts;
- `moreComing` state;
- a new server change token for each zone.

The backend stores the new token as a **candidate checkpoint** in SQLite (`cloudkit_sync_checkpoints.pending_server_change_token`) but does not mark it as applied. This avoids the dangerous failure mode where a preview advances the token before the remote changes have actually been imported and merged into local SQLite.

The admin API response hides raw server change tokens and exposes only whether a checkpoint was captured. This means the current step can prove incremental CloudKit reads and local checkpoint storage without leaking opaque sync state to the browser.

This is still not full sync. To become real background two-way sync, the next guarded step must import changed payloads into a quarantine table, run conflict/tombstone review, apply selected changes to SQLite, then promote the pending token to the applied token only after the local write succeeds.

## Quarantine Import

The next guarded read step is payload import into a local quarantine:

```text
POST /api/v1/admin/icloud-data-sync/import-quarantine
```

The endpoint requires explicit confirmation:

```text
IMPORT_CLOUDKIT_CHANGES
```

With confirmation, the backend invokes the native helper operation `sync-import-quarantine`. The helper uses `recordZoneChanges(inZoneWith:since:desiredKeys:resultsLimit:)`, includes `payloadJson` in the native helper response, and sends that raw payload only through the local helper-to-backend stdio channel. The admin API writes changed and deleted records into SQLite table `cloudkit_sync_quarantine`, then removes `payloadJson` and raw CloudKit server change tokens from the browser response.

This step still does **not** directly modify chats, memories, tasks, generated apps, or device trust records. It also does not promote `pending_server_change_token` into `applied_server_change_token`. The token remains a candidate until the review/apply step resolves conflicts, applies selected safe changes to local SQLite, records rollback evidence, and only then marks the checkpoint as applied.

Safety rules:

- no import runs without `IMPORT_CLOUDKIT_CHANGES`;
- a SQLite backup is created before a real helper-backed quarantine import;
- API responses expose counts, evidence ids, and `payloadCaptured`, never raw `payloadJson`;
- failed or partial helper runs do not advance the applied checkpoint;
- quarantined records require user review by default, except explicitly safe append-only/new-record cases.

## Review And Apply

The first guarded local-merge step is intentionally separate from quarantine import:

```text
GET /api/v1/admin/icloud-data-sync/quarantine
POST /api/v1/admin/icloud-data-sync/apply-quarantine
```

The list endpoint returns only review metadata: zone, record type, record name, status, mutation id, content hash, byte size, timestamps, and whether a payload exists locally. It never returns `payloadJson`, raw CloudKit server change tokens, helper stdin, local file paths, device credentials, AI provider keys, or session material.

The apply endpoint requires explicit confirmation:

```text
APPLY_CLOUDKIT_QUARANTINE
```

With confirmation, LifeOS creates a local SQLite backup when there are pending items, applies only recognized LifeOS record types, and leaves unsupported, dangerous, destructive, newer-local, malformed, sensitive, overwriting, or secret-like records in quarantine as conflicts. Supported apply targets are:

- `LifeOSConversation` into `chat_sessions`;
- `LifeOSMessage` into `messages` with stable remote message ids and mutation ids;
- new non-sensitive `LifeOSMemory` records into `memories`; existing-memory edits and memory tombstones require review;
- new `LifeOSTask` records into `tasks`; existing-task edits and task tombstones require review;
- `LifeOSGeneratedAppState` into `custom_app_state` only when the generated app already exists locally.
- `LifeOSDeviceTrust` records are metadata-only. Applying them writes to `cloudkit_device_trust_metadata` with `review_status = needs-rebind` and `access_granted = 0`; it must not create a locally authenticated device without rebind or explicit trust review.

CloudKit hard deletes and tombstones are not applied automatically. They become conflicts so the user can review the local impact before any destructive local write.

Checkpoint promotion is conservative. A zone's `pending_server_change_token` is promoted to `applied_server_change_token` only after all quarantine rows for that zone have no unresolved `pending-review`, `conflict`, or `failed` status. If any row remains unresolved, that zone stays blocked and the next import can safely continue from the previous applied token.

This still is not unattended background two-way sync. It is the first safe SQLite merge path that proves LifeOS can import private CloudKit changes, review them locally, apply non-conflicting records, preserve rollback evidence, and avoid losing remote changes by advancing tokens too early.

## Safe One-Step Sync

The product-facing path is now a single guarded endpoint:

```text
POST /api/v1/admin/icloud-data-sync/sync-now
```

The endpoint requires explicit confirmation:

```text
SYNC_CLOUDKIT_NOW
```

This endpoint does not create a new sync policy. It orchestrates the existing safe steps in order:

1. `sync-changes-preview` reads incremental CloudKit summaries and stores candidate checkpoints.
2. `sync-import-quarantine` runs only when a real native helper is ready and remote changes exist.
3. The backend writes changed payloads into local quarantine and strips raw payloads from the API response.
4. `applyCloudKitSyncQuarantine` applies only recognized, conflict-free records.
5. Checkpoints are promoted only after local SQLite writes succeed and the zone has no unresolved conflicts.

The response returns only status, counts, next action, safe helper summaries, quarantine counts, apply counts, and backup metadata. It never returns `payloadJson`, raw CloudKit server change tokens, helper stdin, local backup paths, device credentials, AI provider keys, session cookies, or secret-like values.

The one-step UI is the default path for normal users. The older preview/import/apply controls remain available as advanced diagnostics, but they are not the first thing a new user needs to understand.

## Conflict Model

Start with conservative conflict handling:

1. Append-only chat messages use mutation IDs and timestamps.
2. New normal memories may auto-apply only when the local memory id does not exist; edits, sensitive memories, and tombstones require review.
3. New tasks may auto-apply only when the local task id does not exist; edits, deletes, and tombstones require review.
4. Device-trust records may mirror display name, device type, trust state, public-key fingerprint, and timestamps into `cloudkit_device_trust_metadata`, but never raw tokens, token hashes, private keys, or automatic local access.
5. Deleted records become tombstones first, then age out after backup.
6. Cross-device schema migrations must stop sync until all required migrations run.

## Product Flow

The future user flow should be:

1. User finishes local setup.
2. User enables "Apple iCloud Sync" in advanced settings.
3. App explains exactly which data classes will sync.
4. App creates a local backup.
5. Native helper verifies iCloud account, container, quota, and CloudKit reachability.
6. First sync uploads only selected data classes.
7. Each new device appears as "pending trust".
8. User approves the device from the desktop.
9. Conflicts appear in a review center before being merged.

## Acceptance Gate

Do not claim end-user-ready, fully automatic iCloud data sync until all of this is true:

- macOS/iOS native client or helper exists.
- CloudKit container and entitlements are configured.
- At least one selected data class syncs through CloudKit records, not iCloud Drive files.
- Secrets are proven absent from CloudKit, iCloud Drive, logs, diagnostics, backups, and API responses.
- Sync survives iCloud sign-out/in, quota warning, delayed pushes, offline edits, app restart, and two-device conflicts.
- Migration and rollback are tested.
- Public README, release notes, diagnostics, and version roadmap distinguish entry-file handoff from data sync.

## 中文说明

这份文档定义 iCloud 入口同步和受控 CloudKit 数据同步候选能力的边界。默认 LifeOS 只用 iCloud Drive 同步手机入口文件，不同步聊天记录、记忆、任务、设备凭证、SQLite 数据库、AI Key、审计日志、备份或生成程序状态。显式开启的 CloudKit 原生候选路径可以在 helper、Container、entitlement、确认短语、隔离区预览和本地安全闸门都通过后，同步部分聊天、记忆、任务、生成程序状态和设备信任元数据记录。

真正可长期使用的数据同步不能靠继续往 `mobile-entry.html/json` 文件里塞数据来完成。它需要 Apple Developer iCloud entitlement、CloudKit Container、macOS/iOS 原生客户端或原生桥，以及明确的数据权限、冲突处理、备份、审计和回滚。

发布前必须满足：

- 有原生客户端或原生 helper；
- 有 CloudKit Container 和 entitlement；
- 至少一个真实数据类型通过 CloudKit record 同步；
- 证明密钥、token、设备凭证不会进入 iCloud、日志、诊断包、备份和 API 响应；
- 能处理 iCloud 退出登录、同步延迟、离线编辑、应用重启和多设备冲突；
- README、Release、诊断和路线图都明确区分“入口文件同步”和“真实数据同步”。

当前已经有第一版原生 helper 源码：`native/apple/cloudkit-helper/LifeOSCloudKitHelper.swift`。它可以在 macOS 上通过 `npm run icloud:helper:build` 编译，输出到 `build/native/LifeOSCloudKitHelper`。这个 helper 表示 CloudKit 原生桥已经有受控落脚点；当前只应宣称“受控 alpha 候选同步”，不能宣称完整后台 macOS/iOS 原生同步。

当前还新增了受管理员认证保护的批次预览接口：`/api/v1/admin/icloud-data-sync/batch-preview`。它会从 SQLite 里挑选聊天、记忆、任务、生成程序状态和设备信任元数据的候选记录，但只返回 hash、字段名、record type、zone、数量和阻断原因，不返回原始正文、access token、token hash、私钥或密钥。它可以帮助判断“哪些数据将来能通过 CloudKit 同步”，但它本身仍不是后台双向同步。

当前还新增了受控写入接口：`/api/v1/admin/icloud-data-sync/export`。它只在 CloudKit 准备度通过、批次预览为 ready、没有敏感阻断记录、请求显式确认 `SYNC_APPROVED_RECORDS` 时运行，并且会先创建本地 SQLite 备份。API 响应仍只返回摘要和证据，不返回正文；经过过滤的 payload 只会通过本机 stdin 发给原生 helper。这个能力代表“已具备第一条受控 CloudKit 写入路径”，但仍不是完整后台双向同步。

当前还新增了面向普通用户的一键安全上传接口：`POST /api/v1/admin/icloud-data-sync/upload-now`。它要求显式确认 `UPLOAD_CLOUDKIT_NOW`，复用批次预览和敏感内容阻断逻辑，先创建 SQLite 备份，再把允许同步的本机记录交给原生 helper 写入私有 CloudKit。API 只返回状态、数量、安全摘要和 helper 证据，不返回原始正文、helper stdin 或本地备份路径。这个接口适合首次启动时的“把这台电脑的数据放进 iCloud”动作，但仍不是无人值守后台双向同步。

当前还新增了面向默认 UI 的安全同步循环接口：`POST /api/v1/admin/icloud-data-sync/cycle`。它要求显式确认 `SYNC_CLOUDKIT_CYCLE`，并且永远先执行“读取远端变化 → 导入隔离区 → 应用无冲突记录”。如果远端读取失败或出现冲突，循环会停止，不会继续上传本机记录；只有远端拉取干净后，才会调用一键安全上传。这个接口让普通用户只需要点“同步这台电脑和 iCloud”，但仍保留冲突审核、敏感内容阻断和本地备份边界。

当前还新增了安全读取预览接口：`/api/v1/admin/icloud-data-sync/import-preview`。它只从私有 CloudKit 读取 LifeOS 记录的摘要字段，例如 zone、record type、hash、logical clock、payload 大小和更新时间；不会请求 `payloadJson`，也不会导入 SQLite。这个能力代表“已具备第一条受控 CloudKit 读取摘要路径”，但仍不是完整双向同步。

当前还新增了增量变更预览接口：`/api/v1/admin/icloud-data-sync/changes-preview`。它会把本地已应用的 CloudKit server change token 传给原生 helper，helper 使用 `recordZoneChanges` 读取每个 zone 的变更摘要和删除摘要，并把新的 token 作为候选 checkpoint 存在 `cloudkit_sync_checkpoints`。注意：候选 token 不会直接变成已应用 token，因为还没有把远端变更真正导入并合并到 SQLite；这样可以避免“预览一次就丢掉未导入变更”的风险。

当前还新增了隔离导入接口：`/api/v1/admin/icloud-data-sync/import-quarantine`。它要求显式确认 `IMPORT_CLOUDKIT_CHANGES`，由原生 helper 读取 CloudKit 变更正文，然后只写入本机 `cloudkit_sync_quarantine` 表等待冲突审核。API 响应不会返回 `payloadJson` 或原始 server change token，也不会直接改聊天、记忆、任务或生成程序状态。候选 token 仍不会升级为 applied token，直到后续“审核并应用”步骤真正写入 SQLite 并完成回滚证据。

当前 apply 阶段可以自动落库追加型聊天消息、新普通记忆和新任务；已有本地记录、敏感记忆、删除/tombstone、未知记录和 secret-like payload 都会留在隔离区等待人工复核。设备信任记录只允许同步设备名、类型、信任状态、公钥指纹和时间戳，并且只会写入 `cloudkit_device_trust_metadata`，状态固定为 `needs-rebind`、`access_granted = 0`；它不会同步 access token、token hash、私钥，也不会自动授予本机访问权限。

当前还新增了审核应用接口：`GET /api/v1/admin/icloud-data-sync/quarantine` 只返回隔离区摘要，`POST /api/v1/admin/icloud-data-sync/apply-quarantine` 需要显式确认 `APPLY_CLOUDKIT_QUARANTINE`。应用前会创建 SQLite 备份，只自动写入已识别且无冲突的聊天、消息、普通记忆、任务和已存在生成程序状态；硬删除、敏感记忆、未知记录、疑似密钥或本地更新较新的记录会继续留在隔离区。只有某个 zone 没有未解决隔离项时，才会把 pending CloudKit checkpoint 推进为 applied checkpoint。

当前还新增了面向普通用户的一键安全同步接口：`POST /api/v1/admin/icloud-data-sync/sync-now`。它要求显式确认 `SYNC_CLOUDKIT_NOW`，内部按顺序执行“增量变更预览 → 导入隔离区 → 应用无冲突记录”。这个接口不会返回 `payloadJson`、原始 server change token、helper stdin、本地备份路径、设备凭证、AI Key 或 session 信息；遇到冲突时只返回下一步“查看隔离区并处理冲突”。它让默认 UI 只露出一个按钮，但安全边界和人工冲突审核仍然保留。
