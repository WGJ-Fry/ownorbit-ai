import crypto from "crypto";
import { db } from "./db";
import { getCloudKitSyncQuarantineSummary, listCloudKitSyncCheckpoints } from "./cloudKitSyncState";

export const CLOUDKIT_SYNC_APPLY_CONFIRMATION = "APPLY_CLOUDKIT_QUARANTINE";

const forbiddenValuePattern = /\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]+)\b|\/Users\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+/i;
const forbiddenFieldPattern = /api[-_]?key|provider[-_]?key|token|password|passphrase|secret|authorization|cookie|private[-_]?key|credential|sqlite|local[-_]?path|file[-_]?path/i;

export type CloudKitSyncQuarantineItem = {
  id: string;
  zone: string;
  recordType: string;
  recordName: string;
  changeType: "changed" | "deleted";
  status: string;
  mutationId?: string;
  contentHash?: string;
  logicalClock: number;
  payloadByteSize: number;
  requiresUserReview: boolean;
  serverModifiedAt?: string;
  deletedAt?: string;
  sourceEvidenceId?: string;
  importedAt: number;
  appliedAt?: number;
  error?: string;
  payloadCaptured: boolean;
};

export type CloudKitSyncApplyResult = {
  attempted: number;
  applied: number;
  manualReviewRequired: number;
  conflicts: number;
  failed: number;
  skipped: number;
  promotedZones: string[];
  blockedZones: string[];
  records: Array<{ id: string; zone: string; recordType: string; status: "applied" | "conflict" | "failed" | "skipped"; error?: string }>;
  summary: ReturnType<typeof getCloudKitSyncQuarantineSummary>;
  checkpoints: ReturnType<typeof listCloudKitSyncCheckpoints>;
};

type QuarantineRow = {
  id: string;
  zone: string;
  recordType: string;
  recordName: string;
  changeType: "changed" | "deleted";
  status: string;
  mutationId: string | null;
  contentHash: string | null;
  logicalClock: number | null;
  payloadByteSize: number | null;
  requiresUserReview: number;
  payloadJson: string | null;
  serverModifiedAt: string | null;
  deletedAt: string | null;
  sourceEvidenceId: string | null;
  importedAt: number;
  appliedAt: number | null;
  error: string | null;
};

function stableHash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function collectFieldNames(value: unknown, prefix = "", output = new Set<string>()) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) collectFieldNames(item, prefix, output);
    return output;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    output.add(next);
    if (child && typeof child === "object") collectFieldNames(child, next, output);
  }
  return output;
}

function assertSafePayload(value: unknown) {
  if (Array.from(collectFieldNames(value)).some((field) => forbiddenFieldPattern.test(field))) {
    throw new Error("CloudKit payload contains a forbidden field name.");
  }
  if (forbiddenValuePattern.test(JSON.stringify(value ?? ""))) {
    throw new Error("CloudKit payload contains a token-shaped secret or local path.");
  }
}

function parsePayload(row: QuarantineRow) {
  if (!row.payloadJson) throw new Error("CloudKit payload is missing.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch {
    throw new Error("CloudKit payload is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CloudKit payload must be an object.");
  }
  assertSafePayload(parsed);
  return parsed as Record<string, unknown>;
}

function text(value: unknown, maxLength: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength) || fallback;
}

function idText(value: unknown, maxLength = 160) {
  return text(value, maxLength).replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, maxLength);
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function jsonValue(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseStoredJson(value: string | undefined | null) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function quarantineItem(row: QuarantineRow): CloudKitSyncQuarantineItem {
  return {
    id: row.id,
    zone: row.zone,
    recordType: row.recordType,
    recordName: row.recordName,
    changeType: row.changeType,
    status: row.status,
    mutationId: row.mutationId || undefined,
    contentHash: row.contentHash || undefined,
    logicalClock: Number(row.logicalClock || 0),
    payloadByteSize: Number(row.payloadByteSize || 0),
    requiresUserReview: Boolean(row.requiresUserReview),
    serverModifiedAt: row.serverModifiedAt || undefined,
    deletedAt: row.deletedAt || undefined,
    sourceEvidenceId: row.sourceEvidenceId || undefined,
    importedAt: Number(row.importedAt || 0),
    appliedAt: row.appliedAt || undefined,
    error: row.error || undefined,
    payloadCaptured: Boolean(row.payloadJson),
  };
}

function listRows(limit: number, status?: string | string[]) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || 100)));
  const statuses = Array.isArray(status) ? status.filter(Boolean) : status ? [status] : [];
  const where = statuses.length ? `WHERE status IN (${statuses.map(() => "?").join(", ")})` : "";
  const params = statuses.length ? [...statuses, safeLimit] : [safeLimit];
  return db.prepare(`
    SELECT
      id,
      zone,
      record_type as recordType,
      record_name as recordName,
      change_type as changeType,
      status,
      mutation_id as mutationId,
      content_hash as contentHash,
      logical_clock as logicalClock,
      payload_byte_size as payloadByteSize,
      requires_user_review as requiresUserReview,
      payload_json as payloadJson,
      server_modified_at as serverModifiedAt,
      deleted_at as deletedAt,
      source_evidence_id as sourceEvidenceId,
      imported_at as importedAt,
      applied_at as appliedAt,
      error
    FROM cloudkit_sync_quarantine
    ${where}
    ORDER BY imported_at ASC, record_type ASC, record_name ASC
    LIMIT ?
  `).all(...params) as QuarantineRow[];
}

export function listCloudKitSyncQuarantineItems(options: { limit?: number; status?: string } = {}) {
  const rows = listRows(options.limit || 100, options.status);
  return {
    items: rows.map(quarantineItem),
    summary: getCloudKitSyncQuarantineSummary(),
    checkpoints: listCloudKitSyncCheckpoints(),
  };
}

function setQuarantineStatus(row: QuarantineRow, status: "applied" | "conflict" | "failed", now: number, error?: string) {
  db.prepare(`
    UPDATE cloudkit_sync_quarantine
    SET status = ?, applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END, error = ?
    WHERE id = ?
  `).run(status, status, now, error || null, row.id);
}

function ensureConversation(payload: Record<string, unknown>, row: QuarantineRow) {
  const conversationId = idText(payload.conversationId);
  if (!conversationId || row.recordName !== `conversation:${conversationId}`) {
    throw new Error("Conversation id does not match the CloudKit record name.");
  }
  const title = text(payload.title, 120, "Synced conversation");
  const createdAt = numberValue(payload.createdAt, Date.now());
  const updatedAt = numberValue(payload.updatedAt, createdAt);
  const existing = db.prepare("SELECT updated_at as updatedAt FROM chat_sessions WHERE id = ?").get(conversationId) as { updatedAt?: number } | undefined;
  if (existing && Number(existing.updatedAt || 0) > updatedAt) throw new Error("Local conversation is newer; manual conflict review required.");
  db.prepare(`
    INSERT INTO chat_sessions (id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      updated_at = excluded.updated_at
    WHERE chat_sessions.updated_at <= excluded.updated_at
  `).run(conversationId, title, createdAt, updatedAt);
}

function applyMessage(payload: Record<string, unknown>, row: QuarantineRow) {
  const messageId = idText(payload.messageId);
  const conversationId = idText(payload.conversationId);
  if (!messageId || !conversationId || row.recordName !== `message:${messageId}`) {
    throw new Error("Message id does not match the CloudKit record name.");
  }
  const role = ["user", "assistant", "system"].includes(String(payload.role)) ? String(payload.role) : "user";
  const contentJson = payload.contentJson;
  const createdAt = numberValue(payload.createdAt, Date.now());
  const mutationId = text(payload.mutationId, 120, messageId);
  const logicalClock = numberValue(payload.logicalClock, createdAt);
  const queuedAt = numberValue(payload.queuedAt, 0) || null;
  const conversationTitle = text(payload.conversationTitle, 120, "Synced conversation");
  const existingSession = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(conversationId);
  if (!existingSession) {
    db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(conversationId, conversationTitle, createdAt, createdAt);
  }
  const existing = db.prepare("SELECT content_json as contentJson FROM messages WHERE id = ?").get(messageId) as { contentJson?: string } | undefined;
  if (existing) {
    if (stableHash(parseStoredJson(existing.contentJson)) !== stableHash(contentJson)) {
      throw new Error("Local message already exists with different content; manual conflict review required.");
    }
    return;
  }
  db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content_json, source_device_id,
      offline_mutation_id, idempotency_key, client_sequence, source_version, queued_at, created_at
    )
    VALUES (?, ?, ?, ?, 'cloudkit', ?, ?, NULL, ?, ?, ?)
  `).run(messageId, conversationId, role, jsonValue(contentJson), mutationId, `cloudkit:${mutationId}`, logicalClock, queuedAt, createdAt);
  db.prepare("UPDATE chat_sessions SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(createdAt, conversationId);
}

function applyMemory(payload: Record<string, unknown>, row: QuarantineRow) {
  const memoryId = idText(payload.memoryId);
  if (!memoryId || row.recordName !== `memory:${memoryId}`) throw new Error("Memory id does not match the CloudKit record name.");
  const title = text(payload.title, 120, "Synced memory");
  const content = typeof payload.text === "string" ? String(payload.text).trim() : "";
  if (!content && row.recordType === "LifeOSMemory") throw new Error("Memory text is empty.");
  const sensitivity = payload.sensitivity === "sensitive" ? "sensitive" : "normal";
  if (sensitivity === "sensitive") throw new Error("Sensitive memory import requires manual review.");
  const createdAt = numberValue(payload.createdAt, Date.now());
  const updatedAt = numberValue(payload.updatedAt, createdAt);
  const deletedAt = row.recordType === "LifeOSMemoryTombstone" ? numberValue(payload.deletedAt, updatedAt) || updatedAt : numberValue(payload.deletedAt, 0) || null;
  const existing = db.prepare("SELECT updated_at as updatedAt FROM memories WHERE id = ?").get(memoryId) as { updatedAt?: number } | undefined;
  if (existing && Number(existing.updatedAt || 0) > updatedAt) throw new Error("Local memory is newer; manual conflict review required.");
  db.prepare(`
    INSERT INTO memories (id, title, content, sensitivity, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      sensitivity = excluded.sensitivity,
      updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
    WHERE memories.updated_at <= excluded.updated_at
  `).run(memoryId, title, content, sensitivity, createdAt, updatedAt, deletedAt);
}

function applyTask(payload: Record<string, unknown>, row: QuarantineRow) {
  const taskId = idText(payload.taskId);
  if (!taskId || row.recordName !== `task:${taskId}`) throw new Error("Task id does not match the CloudKit record name.");
  const type = text(payload.type, 80, "synced");
  const status = row.recordType === "LifeOSTaskTombstone" ? "deleted" : text(payload.state, 80, "ready");
  const createdAt = numberValue(payload.createdAt, Date.now());
  const startedAt = numberValue(payload.startedAt, 0) || null;
  const finishedAt = numberValue(payload.finishedAt, 0) || null;
  const remoteClock = finishedAt || startedAt || createdAt;
  const existing = db.prepare("SELECT created_at as createdAt, started_at as startedAt, finished_at as finishedAt FROM tasks WHERE id = ?").get(taskId) as any;
  const localClock = existing ? Number(existing.finishedAt || existing.startedAt || existing.createdAt || 0) : 0;
  if (localClock > remoteClock) throw new Error("Local task is newer; manual conflict review required.");
  db.prepare(`
    INSERT INTO tasks (id, type, status, input_json, result_json, error, created_by_device_id, created_at, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, 'cloudkit', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      status = excluded.status,
      input_json = excluded.input_json,
      result_json = excluded.result_json,
      error = excluded.error,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at
  `).run(taskId, type, status, jsonValue(payload.input), payload.result === undefined ? null : jsonValue(payload.result), text(payload.error, 240) || null, createdAt, startedAt, finishedAt);
}

function applyGeneratedAppState(payload: Record<string, unknown>, row: QuarantineRow) {
  const appId = idText(payload.appId);
  if (!appId || row.recordName !== `generated-app-state:${appId}`) throw new Error("Generated app id does not match the CloudKit record name.");
  const updatedAt = numberValue(payload.updatedAt, Date.now());
  const app = db.prepare("SELECT id FROM custom_apps WHERE id = ? AND deleted_at IS NULL").get(appId);
  if (!app) throw new Error("Generated app must exist locally before state can be imported.");
  const existing = db.prepare("SELECT updated_at as updatedAt FROM custom_app_state WHERE app_id = ?").get(appId) as { updatedAt?: number } | undefined;
  if (existing && Number(existing.updatedAt || 0) > updatedAt) throw new Error("Local generated app state is newer; manual conflict review required.");
  db.prepare(`
    INSERT INTO custom_app_state (app_id, state_json, updated_by_type, updated_by_id, updated_at)
    VALUES (?, ?, 'cloudkit', NULL, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_by_type = excluded.updated_by_type,
      updated_by_id = excluded.updated_by_id,
      updated_at = excluded.updated_at
    WHERE custom_app_state.updated_at <= excluded.updated_at
  `).run(appId, jsonValue(payload.stateJson), updatedAt);
}

function applyChangedRow(row: QuarantineRow) {
  const payload = parsePayload(row);
  if (row.recordType === "LifeOSConversation") return ensureConversation(payload, row);
  if (row.recordType === "LifeOSMessage") return applyMessage(payload, row);
  if (row.recordType === "LifeOSMemory" || row.recordType === "LifeOSMemoryTombstone") return applyMemory(payload, row);
  if (row.recordType === "LifeOSTask" || row.recordType === "LifeOSTaskTombstone") return applyTask(payload, row);
  if (row.recordType === "LifeOSGeneratedAppState") return applyGeneratedAppState(payload, row);
  throw new Error(`Unsupported CloudKit record type: ${row.recordType}`);
}

function promoteReadyZones(touchedZones: Set<string>, now: number) {
  const promotedZones: string[] = [];
  const blockedZones: string[] = [];
  const unresolved = db.prepare(`
    SELECT COUNT(*) as count
    FROM cloudkit_sync_quarantine
    WHERE zone = ? AND status IN ('pending-review', 'conflict', 'failed')
  `);
  const promote = db.prepare(`
    UPDATE cloudkit_sync_checkpoints
    SET applied_server_change_token = pending_server_change_token,
        pending_server_change_token = NULL,
        token_state = 'applied',
        last_applied_at = ?,
        updated_at = ?
    WHERE zone = ? AND pending_server_change_token IS NOT NULL AND pending_server_change_token != ''
  `);
  for (const zone of Array.from(touchedZones).sort()) {
    const row = unresolved.get(zone) as { count?: number };
    if (Number(row?.count || 0) > 0) {
      blockedZones.push(zone);
      continue;
    }
    const changes = (promote.run(now, now, zone) as any)?.changes || 0;
    if (changes > 0) promotedZones.push(zone);
  }
  return { promotedZones, blockedZones };
}

export function applyCloudKitSyncQuarantine(options: { limit?: number; now?: number; includeManualReview?: boolean } = {}): CloudKitSyncApplyResult {
  const now = options.now || Date.now();
  const statuses = options.includeManualReview ? ["auto-ready", "pending-review"] : ["auto-ready"];
  const rows = listRows(options.limit || 100, statuses);
  const records: CloudKitSyncApplyResult["records"] = [];
  const touchedZones = new Set<string>();
  let applied = 0;
  let manualReviewRequired = 0;
  let conflicts = 0;
  let failed = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      touchedZones.add(row.zone);
      if (row.changeType !== "changed") {
        const error = "CloudKit hard delete requires manual review; no local data was removed.";
        setQuarantineStatus(row, "conflict", now, error);
        conflicts += 1;
        records.push({ id: row.id, zone: row.zone, recordType: row.recordType, status: "conflict", error });
        continue;
      }
      try {
        applyChangedRow(row);
        setQuarantineStatus(row, "applied", now);
        applied += 1;
        records.push({ id: row.id, zone: row.zone, recordType: row.recordType, status: "applied" });
      } catch (error: any) {
        const message = String(error?.message || "CloudKit quarantine item could not be applied.").slice(0, 240);
        setQuarantineStatus(row, "conflict", now, message);
        conflicts += 1;
        records.push({ id: row.id, zone: row.zone, recordType: row.recordType, status: "conflict", error: message });
      }
    }
    const { promotedZones, blockedZones } = promoteReadyZones(touchedZones, now);
    manualReviewRequired = getCloudKitSyncQuarantineSummary().pendingReview;
    db.exec("COMMIT");
    return {
      attempted: rows.length,
      applied,
      manualReviewRequired,
      conflicts,
      failed,
      skipped,
      promotedZones,
      blockedZones,
      records,
      summary: getCloudKitSyncQuarantineSummary(),
      checkpoints: listCloudKitSyncCheckpoints(),
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
