import crypto from "crypto";
import { db } from "./db";
import { MAX_CLOUDKIT_RECORD_PAYLOAD_BYTES } from "./cloudKitSyncBatch";
import type { CloudKitNativeHelperResult } from "./cloudKitNativeHelper";

export const CLOUDKIT_SYNC_IMPORT_CONFIRMATION = "IMPORT_CLOUDKIT_CHANGES";

const forbiddenValuePattern = /\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]+)\b|\/Users\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+/i;
const forbiddenFieldPattern = /api[-_]?key|provider[-_]?key|token|password|passphrase|secret|authorization|cookie|private[-_]?key|credential|sqlite|local[-_]?path|file[-_]?path/i;
const allowedCloudKitRecordPlan = {
  LifeOSChatZone: { dataType: "chat-history", recordTypes: new Set(["LifeOSConversation", "LifeOSMessage", "LifeOSSyncCheckpoint"]) },
  LifeOSMemoryZone: { dataType: "memory", recordTypes: new Set(["LifeOSMemory", "LifeOSMemoryTombstone", "LifeOSSyncCheckpoint"]) },
  LifeOSTaskZone: { dataType: "tasks", recordTypes: new Set(["LifeOSTask", "LifeOSTaskTombstone", "LifeOSTaskListSnapshot", "LifeOSSyncCheckpoint"]) },
  LifeOSGeneratedAppZone: { dataType: "generated-app-state", recordTypes: new Set(["LifeOSGeneratedAppState", "LifeOSGeneratedAppMutation", "LifeOSSyncCheckpoint"]) },
  LifeOSDeviceTrustZone: { dataType: "device-trust", recordTypes: new Set(["LifeOSDeviceTrust", "LifeOSSyncCheckpoint"]) },
} as const;

export type CloudKitSyncCheckpoint = {
  zone: string;
  tokenState: "none" | "pending-preview" | "applied";
  appliedServerChangeTokenPresent: boolean;
  pendingServerChangeTokenPresent: boolean;
  lastEvidenceId?: string;
  lastPreviewAt?: number;
  lastAppliedAt?: number;
  changedCount: number;
  deletedCount: number;
  failedCount: number;
  moreComing: boolean;
  updatedAt: number;
};

export type CloudKitSyncStateSnapshot = {
  generatedAt: string;
  zones: Array<{
    zone: string;
    serverChangeToken?: string;
    tokenState: "none" | "applied";
    updatedAt: number;
  }>;
};

export type CloudKitSyncQuarantineSummary = {
  importedChanged: number;
  importedDeleted: number;
  skipped: number;
  autoReady: number;
  pendingReview: number;
  applied: number;
  conflicts: number;
  failed: number;
  payloadStored: boolean;
};

type CloudKitSyncCheckpointRow = {
  zone: string;
  appliedServerChangeToken: string | null;
  pendingServerChangeToken: string | null;
  tokenState: string;
  lastEvidenceId: string | null;
  lastPreviewAt: number | null;
  lastAppliedAt: number | null;
  changedCount: number;
  deletedCount: number;
  failedCount: number;
  moreComing: number;
  updatedAt: number;
};

function normalizeTokenState(value: unknown): CloudKitSyncCheckpoint["tokenState"] {
  return value === "pending-preview" || value === "applied" ? value : "none";
}

function rowToCheckpoint(row: CloudKitSyncCheckpointRow): CloudKitSyncCheckpoint {
  return {
    zone: row.zone,
    tokenState: normalizeTokenState(row.tokenState),
    appliedServerChangeTokenPresent: Boolean(row.appliedServerChangeToken),
    pendingServerChangeTokenPresent: Boolean(row.pendingServerChangeToken),
    lastEvidenceId: row.lastEvidenceId || undefined,
    lastPreviewAt: row.lastPreviewAt || undefined,
    lastAppliedAt: row.lastAppliedAt || undefined,
    changedCount: Number(row.changedCount || 0),
    deletedCount: Number(row.deletedCount || 0),
    failedCount: Number(row.failedCount || 0),
    moreComing: Boolean(row.moreComing),
    updatedAt: Number(row.updatedAt || 0),
  };
}

function stableId(parts: unknown[]) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

function stableHash(value: unknown) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function collectFieldNames(value: unknown, prefix = "", output = new Set<string>()) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 16)) collectFieldNames(item, prefix, output);
    return output;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    output.add(next);
    if (child && typeof child === "object") collectFieldNames(child, next, output);
  }
  return output;
}

function validateImportedRecordIntegrity(record: NonNullable<CloudKitNativeHelperResult["syncImportQuarantine"]>["changedRecords"][number]) {
  const plan = allowedCloudKitRecordPlan[record.zone as keyof typeof allowedCloudKitRecordPlan];
  if (!plan || !plan.recordTypes.has(record.recordType as never)) return { ok: false as const, reason: "unsupported-record-plan" };
  if (record.lifeosSchema !== "lifeos-cloudkit-record.v1" || record.lifeosDataType !== plan.dataType) {
    return { ok: false as const, reason: "schema-mismatch" };
  }
  if (!record.sourceIdHash || !record.sourceIdHash.startsWith(`${plan.dataType}:`)) {
    return { ok: false as const, reason: "source-id-mismatch" };
  }
  const payloadJson = record.payloadJson || "";
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  if (!payloadJson || payloadBytes > MAX_CLOUDKIT_RECORD_PAYLOAD_BYTES) return { ok: false as const, reason: "payload-size" };
  if (record.payloadByteSize !== payloadBytes) return { ok: false as const, reason: "payload-length-mismatch" };
  const contentHash = String(record.contentHash || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentHash) || stableHash(payloadJson) !== contentHash) {
    return { ok: false as const, reason: "content-hash-mismatch" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { ok: false as const, reason: "invalid-json" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false as const, reason: "invalid-payload-shape" };
  if (Array.from(collectFieldNames(payload)).some((field) => forbiddenFieldPattern.test(field))) {
    return { ok: false as const, reason: "forbidden-field" };
  }
  if (forbiddenValuePattern.test(payloadJson)) return { ok: false as const, reason: "secret-like-content" };
  return { ok: true as const, payloadBytes, contentHash };
}

export function listCloudKitSyncCheckpoints(): CloudKitSyncCheckpoint[] {
  const rows = db.prepare(`
    SELECT
      zone,
      applied_server_change_token as appliedServerChangeToken,
      pending_server_change_token as pendingServerChangeToken,
      token_state as tokenState,
      last_evidence_id as lastEvidenceId,
      last_preview_at as lastPreviewAt,
      last_applied_at as lastAppliedAt,
      changed_count as changedCount,
      deleted_count as deletedCount,
      failed_count as failedCount,
      more_coming as moreComing,
      updated_at as updatedAt
    FROM cloudkit_sync_checkpoints
    ORDER BY zone ASC
  `).all() as CloudKitSyncCheckpointRow[];
  return rows.map(rowToCheckpoint);
}

export function getCloudKitSyncStateSnapshot(now = new Date()): CloudKitSyncStateSnapshot {
  const rows = db.prepare(`
    SELECT
      zone,
      applied_server_change_token as appliedServerChangeToken,
      token_state as tokenState,
      updated_at as updatedAt
    FROM cloudkit_sync_checkpoints
    WHERE applied_server_change_token IS NOT NULL AND applied_server_change_token != ''
    ORDER BY zone ASC
  `).all() as Pick<CloudKitSyncCheckpointRow, "zone" | "appliedServerChangeToken" | "tokenState" | "updatedAt">[];
  return {
    generatedAt: now.toISOString(),
    zones: rows.map((row) => ({
      zone: row.zone,
      serverChangeToken: row.appliedServerChangeToken || undefined,
      tokenState: "applied",
      updatedAt: Number(row.updatedAt || 0),
    })),
  };
}

export function saveCloudKitSyncChangesPreview(result: CloudKitNativeHelperResult, now = Date.now()) {
  const zones = result.syncChangesPreview?.zones || [];
  if (!zones.length) return { saved: 0, checkpoints: listCloudKitSyncCheckpoints() };
  const statement = db.prepare(`
    INSERT INTO cloudkit_sync_checkpoints (
      zone,
      applied_server_change_token,
      pending_server_change_token,
      token_state,
      last_evidence_id,
      last_preview_at,
      last_applied_at,
      changed_count,
      deleted_count,
      failed_count,
      more_coming,
      updated_at
    )
    VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(zone) DO UPDATE SET
      pending_server_change_token = excluded.pending_server_change_token,
      token_state = 'pending-preview',
      last_evidence_id = excluded.last_evidence_id,
      last_preview_at = excluded.last_preview_at,
      changed_count = excluded.changed_count,
      deleted_count = excluded.deleted_count,
      failed_count = excluded.failed_count,
      more_coming = excluded.more_coming,
      updated_at = excluded.updated_at
  `);
  db.exec("BEGIN");
  try {
    let saved = 0;
    for (const zone of zones) {
      if (!zone.zone || !zone.serverChangeToken) continue;
      statement.run(
        zone.zone,
        zone.serverChangeToken,
        "evidenceId" in result ? result.evidenceId || null : null,
        now,
        zone.changed,
        zone.deleted,
        zone.failed,
        zone.moreComing ? 1 : 0,
        now,
      );
      saved += 1;
    }
    db.exec("COMMIT");
    return { saved, checkpoints: listCloudKitSyncCheckpoints() };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function savePendingTokensFromZones(zones: Array<{ zone: string; serverChangeToken?: string; changed?: number; deleted?: number; failed?: number; moreComing?: boolean }>, evidenceId: string | null, now: number) {
  const statement = db.prepare(`
    INSERT INTO cloudkit_sync_checkpoints (
      zone,
      applied_server_change_token,
      pending_server_change_token,
      token_state,
      last_evidence_id,
      last_preview_at,
      last_applied_at,
      changed_count,
      deleted_count,
      failed_count,
      more_coming,
      updated_at
    )
    VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(zone) DO UPDATE SET
      pending_server_change_token = excluded.pending_server_change_token,
      token_state = 'pending-preview',
      last_evidence_id = excluded.last_evidence_id,
      last_preview_at = excluded.last_preview_at,
      changed_count = excluded.changed_count,
      deleted_count = excluded.deleted_count,
      failed_count = excluded.failed_count,
      more_coming = excluded.more_coming,
      updated_at = excluded.updated_at
  `);
  let saved = 0;
  for (const zone of zones) {
    if (!zone.zone || !zone.serverChangeToken) continue;
    statement.run(
      zone.zone,
      zone.serverChangeToken,
      evidenceId,
      now,
      Number(zone.changed || 0),
      Number(zone.deleted || 0),
      Number(zone.failed || 0),
      zone.moreComing ? 1 : 0,
      now,
    );
    saved += 1;
  }
  return saved;
}

export function getCloudKitSyncQuarantineSummary(): CloudKitSyncQuarantineSummary {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN change_type = 'changed' THEN 1 ELSE 0 END) as importedChanged,
      SUM(CASE WHEN change_type = 'deleted' THEN 1 ELSE 0 END) as importedDeleted,
      SUM(CASE WHEN status = 'auto-ready' THEN 1 ELSE 0 END) as autoReady,
      SUM(CASE WHEN status = 'pending-review' THEN 1 ELSE 0 END) as pendingReview,
      SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied,
      SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) as conflicts,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN payload_json IS NOT NULL AND payload_json != '' THEN 1 ELSE 0 END) as payloadStored
    FROM cloudkit_sync_quarantine
  `).get() as { importedChanged?: number; importedDeleted?: number; autoReady?: number; pendingReview?: number; applied?: number; conflicts?: number; failed?: number; payloadStored?: number } | undefined;
  return {
    importedChanged: Number(row?.importedChanged || 0),
    importedDeleted: Number(row?.importedDeleted || 0),
    skipped: 0,
    autoReady: Number(row?.autoReady || 0),
    pendingReview: Number(row?.pendingReview || 0),
    applied: Number(row?.applied || 0),
    conflicts: Number(row?.conflicts || 0),
    failed: Number(row?.failed || 0),
    payloadStored: Number(row?.payloadStored || 0) > 0,
  };
}

export function saveCloudKitSyncImportQuarantine(result: CloudKitNativeHelperResult, now = Date.now()) {
  const importResult = result.syncImportQuarantine;
  if (!importResult) {
    return { tokenSaved: 0, integrityRejected: 0, rejectionReasons: [], summary: getCloudKitSyncQuarantineSummary(), checkpoints: listCloudKitSyncCheckpoints() };
  }
  const evidenceId = "evidenceId" in result ? result.evidenceId || null : null;
  const fullResyncZones = new Set(importResult.changeTokenResetZones || []);
  const changedStatement = db.prepare(`
    INSERT OR IGNORE INTO cloudkit_sync_quarantine (
      id,
      zone,
      record_type,
      record_name,
      change_type,
      status,
      mutation_id,
      content_hash,
      payload_hash,
      logical_clock,
      payload_byte_size,
      requires_user_review,
      payload_json,
      server_modified_at,
      deleted_at,
      source_evidence_id,
      imported_at
    )
    VALUES (?, ?, ?, ?, 'changed', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  const rejectedStatement = db.prepare(`
    INSERT OR IGNORE INTO cloudkit_sync_quarantine (
      id,
      zone,
      record_type,
      record_name,
      change_type,
      status,
      mutation_id,
      content_hash,
      payload_hash,
      logical_clock,
      payload_byte_size,
      requires_user_review,
      payload_json,
      server_modified_at,
      deleted_at,
      source_evidence_id,
      imported_at,
      error
    )
    VALUES (?, ?, ?, ?, 'changed', 'failed', ?, ?, ?, ?, ?, 1, NULL, ?, NULL, ?, ?, ?)
  `);
  const resetReviewStatement = db.prepare(`
    INSERT OR IGNORE INTO cloudkit_sync_quarantine (
      id,
      zone,
      record_type,
      record_name,
      change_type,
      status,
      mutation_id,
      content_hash,
      payload_hash,
      logical_clock,
      payload_byte_size,
      requires_user_review,
      payload_json,
      server_modified_at,
      deleted_at,
      source_evidence_id,
      imported_at,
      error
    )
    VALUES (?, ?, 'LifeOSFullResyncReview', ?, 'checkpoint-reset', 'pending-review', NULL, ?, NULL, 0, 0, 1, NULL, NULL, NULL, ?, ?, ?)
  `);
  const deletedStatement = db.prepare(`
    INSERT OR IGNORE INTO cloudkit_sync_quarantine (
      id,
      zone,
      record_type,
      record_name,
      change_type,
      status,
      mutation_id,
      content_hash,
      payload_hash,
      logical_clock,
      payload_byte_size,
      requires_user_review,
      payload_json,
      server_modified_at,
      deleted_at,
      source_evidence_id,
      imported_at
    )
    VALUES (?, ?, ?, ?, 'deleted', 'pending-review', NULL, ?, NULL, NULL, 0, 1, NULL, NULL, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    let importedChanged = 0;
    let importedDeleted = 0;
    let skipped = 0;
    let integrityRejected = 0;
    const rejectionReasons = new Map<string, number>();
    for (const record of importResult.changedRecords || []) {
      if (!record.zone || !record.recordType || !record.recordName || !record.payloadJson) {
        skipped += 1;
        integrityRejected += 1;
        rejectionReasons.set("missing-record-fields", (rejectionReasons.get("missing-record-fields") || 0) + 1);
        continue;
      }
      const integrity = validateImportedRecordIntegrity(record);
      if (!integrity.ok) {
        const reason = integrity.reason;
        rejectionReasons.set(reason, (rejectionReasons.get(reason) || 0) + 1);
        rejectedStatement.run(
          stableId(["rejected", record.zone, record.recordType, record.recordName, record.contentHash || stableHash(record.payloadJson)]),
          record.zone,
          record.recordType,
          record.recordName,
          record.mutationId || null,
          record.contentHash || null,
          stableHash(record.payloadJson),
          Number(record.logicalClock || 0),
          Buffer.byteLength(record.payloadJson, "utf8"),
          record.modifiedAt || null,
          evidenceId,
          now,
          `CloudKit record rejected before import: ${reason}`,
        );
        skipped += 1;
        integrityRejected += 1;
        continue;
      }
      const requiresUserReview = Boolean(record.requiresUserReview || record.fullResync || fullResyncZones.has(record.zone));
      const before = (changedStatement.run(
        stableId(["changed", record.zone, record.recordType, record.recordName, record.contentHash || stableHash(record.payloadJson)]),
        record.zone,
        record.recordType,
        record.recordName,
        requiresUserReview ? "pending-review" : "auto-ready",
        record.mutationId || null,
        integrity.contentHash,
        stableHash(record.payloadJson),
        Number(record.logicalClock || 0),
        integrity.payloadBytes,
        requiresUserReview ? 1 : 0,
        record.payloadJson,
        record.modifiedAt || null,
        evidenceId,
        now,
      ) as any)?.changes || 0;
      importedChanged += before;
      if (!before) skipped += 1;
    }
    for (const record of importResult.deletedRecords || []) {
      if (!record.zone || !record.recordType || !record.recordName) {
        skipped += 1;
        continue;
      }
      const deletedHash = stableHash(["deleted", record.zone, record.recordType, record.recordName].join(":"));
      const before = (deletedStatement.run(
        stableId(["deleted", record.zone, record.recordType, record.recordName]),
        record.zone,
        record.recordType,
        record.recordName,
        deletedHash,
        record.deletedAt || new Date(now).toISOString(),
        evidenceId,
        now,
      ) as any)?.changes || 0;
      importedDeleted += before;
      if (!before) skipped += 1;
    }
    for (const zone of Array.from(fullResyncZones).sort()) {
      const zoneResult = (importResult.zones || []).find((item) => item.zone === zone);
      const markerHash = stableHash(["checkpoint-reset", zone, zoneResult?.serverChangeToken || evidenceId || now].join(":"));
      resetReviewStatement.run(
        stableId(["checkpoint-reset", zone, markerHash]),
        zone,
        `checkpoint-reset:${zone}`,
        markerHash,
        evidenceId,
        now,
        "CloudKit cursor expired. Review this rebuilt baseline before LifeOS advances the checkpoint.",
      );
    }
    const tokenSaved = savePendingTokensFromZones(importResult.zones || [], evidenceId, now);
    db.exec("COMMIT");
    const summary = getCloudKitSyncQuarantineSummary();
    return {
      tokenSaved,
      integrityRejected,
      rejectionReasons: Array.from(rejectionReasons.entries()).map(([reason, count]) => ({ reason, count })),
      summary: { ...summary, importedChanged, importedDeleted, skipped, payloadStored: importedChanged > 0 || summary.payloadStored },
      checkpoints: listCloudKitSyncCheckpoints(),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function publicCloudKitHelperResult<T extends CloudKitNativeHelperResult>(result: T): T {
  const clone = JSON.parse(JSON.stringify(result)) as T;
  for (const zone of clone.syncChangesPreview?.zones || []) {
    const tokenCaptured = Boolean(zone.serverChangeToken);
    delete zone.serverChangeToken;
    zone.serverChangeTokenCaptured = tokenCaptured;
  }
  for (const zone of clone.syncImportQuarantine?.zones || []) {
    const tokenCaptured = Boolean(zone.serverChangeToken);
    delete zone.serverChangeToken;
    zone.serverChangeTokenCaptured = tokenCaptured;
  }
  for (const record of clone.syncImportQuarantine?.changedRecords || []) {
    if ("payloadJson" in record) {
      record.payloadCaptured = Boolean(record.payloadJson);
      delete record.payloadJson;
    }
  }
  return clone;
}
