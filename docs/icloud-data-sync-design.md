# iCloud Data Sync Design Boundary

This document is the engineering boundary for future real iCloud data sync. The current product only uses iCloud Drive to sync the mobile entry files:

- `lifeos-mobile-entry.html`
- `lifeos-mobile-entry-*.html`
- `lifeos-mobile-entry-*.json`
- `lifeos-mobile-entry-history.json`

It does not sync chat history, memory, tasks, device credentials, SQLite databases, AI keys, audit logs, backups, or generated app state through iCloud.

## Why iCloud Drive Is Not Enough

iCloud Drive is useful for handing a small entry file from Mac to iPhone. It is not a safe database or realtime transport for LifeOS data because:

- sync timing is controlled by the OS and can be delayed;
- web/PWA code cannot reliably observe CloudKit identity, record zones, conflict state, or background pushes;
- file-based sync can create partial, stale, duplicated, or placeholder files;
- device credentials and AI keys must not be copied into casual files;
- realtime chat still needs LAN, Tailscale, Cloudflare Tunnel, trusted HTTPS, or a future LifeOS Relay.

## Required Native Architecture

Real iCloud data sync must be built as a separate native capability, not by expanding the current iCloud Drive handoff file.

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

- ready records for `LifeOSConversation`, `LifeOSMessage`, `LifeOSMemory`, `LifeOSTask`, and `LifeOSGeneratedAppState`;
- blocked records for sensitive memories, malformed JSON, unsafe fields, and secret-like content;
- a `lifeos-cloudkit-sync-batch-preview.v1` helper payload plan that remains preview-only until helper probe and disposable roundtrip evidence pass.

This is still not real continuous sync. It is the safety gate that proves LifeOS can select syncable records from SQLite without leaking raw payloads into the admin response. A future export operation must use the same filtering, require backup evidence, call the native helper, and write only approved CloudKit record fields.

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

## Conflict Model

Start with conservative conflict handling:

1. Append-only chat messages use mutation IDs and timestamps.
2. Memory edits use last-writer-wins only for non-destructive metadata; text conflicts require review.
3. Task completion can auto-merge when state moves forward; title/date conflicts require review.
4. Deleted records become tombstones first, then age out after backup.
5. Cross-device schema migrations must stop sync until all required migrations run.

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

Do not claim real iCloud data sync until all of this is true:

- macOS/iOS native client or helper exists.
- CloudKit container and entitlements are configured.
- At least one selected data class syncs through CloudKit records, not iCloud Drive files.
- Secrets are proven absent from CloudKit, iCloud Drive, logs, diagnostics, backups, and API responses.
- Sync survives iCloud sign-out/in, quota warning, delayed pushes, offline edits, app restart, and two-device conflicts.
- Migration and rollback are tested.
- Public README, release notes, diagnostics, and version roadmap distinguish entry-file handoff from data sync.

## 中文说明

这份文档定义未来真正 iCloud 数据同步的边界。当前 LifeOS 只用 iCloud Drive 同步手机入口文件，不同步聊天记录、记忆、任务、设备凭证、SQLite 数据库、AI Key、审计日志、备份或生成程序状态。

真正的数据同步不能靠继续往 `mobile-entry.html/json` 文件里塞数据来完成。它需要 Apple Developer iCloud entitlement、CloudKit Container、macOS/iOS 原生客户端或原生桥，以及明确的数据权限、冲突处理、备份、审计和回滚。

发布前必须满足：

- 有原生客户端或原生 helper；
- 有 CloudKit Container 和 entitlement；
- 至少一个真实数据类型通过 CloudKit record 同步；
- 证明密钥、token、设备凭证不会进入 iCloud、日志、诊断包、备份和 API 响应；
- 能处理 iCloud 退出登录、同步延迟、离线编辑、应用重启和多设备冲突；
- README、Release、诊断和路线图都明确区分“入口文件同步”和“真实数据同步”。

当前已经有第一版原生 helper 源码：`native/apple/cloudkit-helper/LifeOSCloudKitHelper.swift`。它可以在 macOS 上通过 `npm run icloud:helper:build` 编译，输出到 `build/native/LifeOSCloudKitHelper`。这个 helper 只表示 CloudKit 原生桥开始具备落脚点；在完成真实容器、entitlement、一次性 roundtrip、数据类型同步、冲突处理和真实设备长测前，仍不能宣称聊天、记忆、任务或设备信任已经通过 iCloud 同步。

当前还新增了受管理员认证保护的批次预览接口：`/api/v1/admin/icloud-data-sync/batch-preview`。它会从 SQLite 里挑选聊天、记忆、任务和生成程序状态的候选记录，但只返回 hash、字段名、record type、zone、数量和阻断原因，不返回原始正文或密钥。它可以帮助判断“哪些数据将来能通过 CloudKit 同步”，但它本身仍不是后台双向同步。
