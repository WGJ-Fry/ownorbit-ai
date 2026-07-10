import crypto from "crypto";
import { db } from "./db";
import type { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness.ts";

type IcloudDataSyncReadiness = ReturnType<typeof getIcloudDataSyncReadiness>;
type CloudKitSyncStatus = "skipped" | "blocked" | "empty" | "needs-review" | "ready";
type CloudKitSyncDataType = "chat-history" | "memory" | "tasks" | "generated-app-state" | "device-trust";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
export const MAX_CLOUDKIT_RECORD_PAYLOAD_BYTES = 64 * 1024;
export const CLOUDKIT_SYNC_EXPORT_SCHEMA = "lifeos-cloudkit-sync-export.v1";
export const CLOUDKIT_SYNC_EXPORT_CONFIRMATION = "SYNC_APPROVED_RECORDS";
const forbiddenValuePattern = /\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]+)\b|\/Users\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+/i;
const forbiddenFieldPattern = /api[-_]?key|provider[-_]?key|token|password|passphrase|secret|authorization|cookie|private[-_]?key|credential|sqlite|local[-_]?path|file[-_]?path/i;

export type CloudKitSyncRecordPreview = {
  id: string;
  dataType: CloudKitSyncDataType;
  zone: string;
  recordType: string;
  recordName: string;
  mutationId: string;
  logicalClock: number;
  fieldNames: string[];
  byteSize: number;
  contentHash: string;
  requiresUserReview: boolean;
};

export type CloudKitSyncBlockedRecord = {
  id: string;
  dataType: CloudKitSyncDataType;
  recordType: string;
  reason: "sensitive-memory" | "secret-like-content" | "unsafe-field" | "malformed-json" | "unsupported-record" | "payload-too-large";
  contentHash: string;
};

export type CloudKitSyncBatchPreview = {
  ok: boolean;
  status: CloudKitSyncStatus;
  generatedAt: string;
  readinessStatus: string;
  dataSyncScope: IcloudDataSyncReadiness["dataSyncScope"];
  selectedDataTypes: string[];
  readyRecordCount: number;
  blockedRecordCount: number;
  totalCandidateCount: number;
  truncated: boolean;
  limit: number;
  zones: Array<{ zone: string; records: number }>;
  recordTypes: Array<{ recordType: string; records: number }>;
  records: CloudKitSyncRecordPreview[];
  blockedRecords: CloudKitSyncBlockedRecord[];
  safety: {
    forbiddenFieldNames: string[];
    forbiddenFieldCount: number;
    blockedDataTypes: string[];
    notSyncedDataTypes: string[];
    credentialBoundary: IcloudDataSyncReadiness["credentialBoundary"];
    secretLikeContentBlocked: number;
    sensitiveMemoryBlocked: number;
    oversizedContentBlocked: number;
    maxRecordPayloadBytes: number;
    rawPayloadIncluded: false;
  };
  helperPayloadPlan: {
    schema: "lifeos-cloudkit-sync-batch-preview.v1";
    operation: "preview";
    sendsRawUserContent: false;
    nextHelperOperation: "probe" | "roundtrip" | "sync-export-blocked";
    recordPlanHash: string;
  };
  nextAction: string;
};

export type CloudKitSyncExportRecord = {
  zone: string;
  recordType: string;
  recordName: string;
  mutationId: string;
  contentHash: string;
  fields: Record<string, string | number | boolean>;
};

export type CloudKitSyncExportPackage = {
  ok: boolean;
  status: "blocked" | "ready";
  generatedAt: string;
  requestId: string;
  preview: CloudKitSyncBatchPreview;
  helperSyncBatch: {
    schema: typeof CLOUDKIT_SYNC_EXPORT_SCHEMA;
    confirmation: typeof CLOUDKIT_SYNC_EXPORT_CONFIRMATION;
    recordPlanHash: string;
    generatedAt: string;
    records: CloudKitSyncExportRecord[];
    zones: Array<{ zone: string; records: number }>;
  };
  safety: {
    rawPayloadReturnedToAdmin: false;
    rawPayloadSentToNativeHelper: boolean;
    blockedBeforeExport: number;
    requiresExplicitConfirmation: true;
  };
};

type CloudKitSyncRecordCandidate = CloudKitSyncRecordPreview & {
  syncFields: Record<string, string | number | boolean>;
};

function clampLimit(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function safeJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stableHash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function recordId(prefix: string, id: string) {
  return `${prefix}:${crypto.createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
}

function stableIdHash(value: unknown) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
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

function hasForbiddenField(value: unknown) {
  return Array.from(collectFieldNames(value)).some((field) => forbiddenFieldPattern.test(field));
}

function hasForbiddenValue(value: unknown) {
  return forbiddenValuePattern.test(JSON.stringify(value ?? ""));
}

function safeConversationTitleSnapshot(value: unknown) {
  const title = String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!title || hasForbiddenValue(title)) return undefined;
  return title;
}

function byteSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function toPreview(record: CloudKitSyncRecordCandidate): CloudKitSyncRecordPreview {
  const { syncFields: _syncFields, ...preview } = record;
  return preview;
}

function addCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function pushReady(
  records: CloudKitSyncRecordCandidate[],
  blockedRecords: CloudKitSyncBlockedRecord[],
  counts: { zones: Map<string, number>; recordTypes: Map<string, number> },
  record: CloudKitSyncRecordCandidate,
  limit: number,
) {
  if (record.byteSize > MAX_CLOUDKIT_RECORD_PAYLOAD_BYTES) {
    if (blockedRecords.length < limit) {
      blockedRecords.push({
        id: record.id,
        dataType: record.dataType,
        recordType: record.recordType,
        reason: "payload-too-large",
        contentHash: record.contentHash,
      });
    }
    return;
  }
  addCount(counts.zones, record.zone);
  addCount(counts.recordTypes, record.recordType);
  if (records.length < limit) records.push(record);
}

function buildSyncFields(input: {
  id: string;
  dataType: CloudKitSyncDataType;
  zone: string;
  recordType: string;
  recordName: string;
  payload: unknown;
  logicalClock: number;
  requiresUserReview?: boolean;
}) {
  const payloadJson = JSON.stringify(input.payload ?? null);
  const contentHash = stableHash(input.payload);
  return {
    lifeosSchema: "lifeos-cloudkit-record.v1",
    lifeosDataType: input.dataType,
    lifeosRecordType: input.recordType,
    lifeosRecordName: input.recordName,
    sourceIdHash: recordId(input.dataType, input.id),
    mutationId: stableHash({ id: input.id, dataType: input.dataType, recordType: input.recordType, logicalClock: input.logicalClock }).slice(0, 32),
    logicalClock: input.logicalClock,
    contentHash,
    payloadJson,
    payloadByteSize: byteSize(input.payload),
    requiresUserReview: input.requiresUserReview ?? true,
  };
}

function buildRecord(input: {
  id: string;
  dataType: CloudKitSyncDataType;
  zone: string;
  recordType: string;
  recordName: string;
  payload: unknown;
  logicalClock: number;
  requiresUserReview?: boolean;
}): CloudKitSyncRecordCandidate {
  const syncFields = buildSyncFields(input);
  return {
    id: recordId(`${input.dataType}:${input.recordType}`, input.id),
    dataType: input.dataType,
    zone: input.zone,
    recordType: input.recordType,
    recordName: input.recordName,
    mutationId: syncFields.mutationId,
    logicalClock: input.logicalClock,
    fieldNames: Array.from(collectFieldNames(input.payload)).sort().slice(0, 32),
    byteSize: byteSize(input.payload),
    contentHash: syncFields.contentHash,
    requiresUserReview: input.requiresUserReview ?? true,
    syncFields,
  };
}

function pushBlocked(
  blockedRecords: CloudKitSyncBlockedRecord[],
  input: { id: string; dataType: CloudKitSyncDataType; recordType: string; reason: CloudKitSyncBlockedRecord["reason"]; payload: unknown },
  limit: number,
) {
  if (blockedRecords.length >= limit) return;
  blockedRecords.push({
    id: recordId(`${input.dataType}:${input.recordType}:blocked`, input.id),
    dataType: input.dataType,
    recordType: input.recordType,
    reason: input.reason,
    contentHash: stableHash(input.payload),
  });
}

function collectChatRecords(limit: number) {
  const records: CloudKitSyncRecordCandidate[] = [];
  const blockedRecords: CloudKitSyncBlockedRecord[] = [];
  const counts = { zones: new Map<string, number>(), recordTypes: new Map<string, number>() };
  const sessions = db.prepare(`
    SELECT id, title, created_at as createdAt, updated_at as updatedAt
    FROM chat_sessions
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
  for (const session of sessions as any[]) {
    const payload = {
      conversationId: session.id,
      title: String(session.title || "").slice(0, 120),
      createdAt: Number(session.createdAt || 0),
      updatedAt: Number(session.updatedAt || 0),
    };
    pushReady(records, blockedRecords, counts, buildRecord({
      id: session.id,
      dataType: "chat-history",
      zone: "LifeOSChatZone",
      recordType: "LifeOSConversation",
      recordName: `conversation:${session.id}`,
      payload,
      logicalClock: payload.updatedAt,
    }), limit);
  }

  const messages = db.prepare(`
    SELECT m.id, m.session_id as sessionId, m.role, m.content_json as contentJson,
           m.offline_mutation_id as offlineMutationId, m.idempotency_key as idempotencyKey,
           m.client_sequence as clientSequence, m.source_version as sourceVersion,
           m.queued_at as queuedAt, m.created_at as createdAt,
           s.title as sessionTitle
    FROM messages m
    LEFT JOIN chat_sessions s ON s.id = m.session_id
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(limit);
  for (const message of messages as any[]) {
    const parsed = safeJson(message.contentJson, null);
    if (parsed === null) {
      pushBlocked(blockedRecords, { id: message.id, dataType: "chat-history", recordType: "LifeOSMessage", reason: "malformed-json", payload: message.contentJson }, limit);
      continue;
    }
    if (hasForbiddenField(parsed) || hasForbiddenValue(parsed)) {
      pushBlocked(blockedRecords, { id: message.id, dataType: "chat-history", recordType: "LifeOSMessage", reason: hasForbiddenField(parsed) ? "unsafe-field" : "secret-like-content", payload: parsed }, limit);
      continue;
    }
    const payload = {
      conversationId: message.sessionId,
      messageId: message.id,
      role: message.role,
      contentJson: parsed,
      createdAt: Number(message.createdAt || 0),
      mutationId: message.offlineMutationId || message.idempotencyKey || message.id,
      logicalClock: Number(message.sourceVersion || message.createdAt || 0),
      queuedAt: Number(message.queuedAt || 0) || undefined,
      conversationTitle: safeConversationTitleSnapshot(message.sessionTitle),
    };
    pushReady(records, blockedRecords, counts, buildRecord({
      id: message.id,
      dataType: "chat-history",
      zone: "LifeOSChatZone",
      recordType: "LifeOSMessage",
      recordName: `message:${message.id}`,
      payload,
      logicalClock: payload.logicalClock,
      requiresUserReview: false,
    }), limit);
  }

  return { records, blockedRecords, counts };
}

function collectMemoryRecords(limit: number) {
  const records: CloudKitSyncRecordCandidate[] = [];
  const blockedRecords: CloudKitSyncBlockedRecord[] = [];
  const counts = { zones: new Map<string, number>(), recordTypes: new Map<string, number>() };
  const memories = db.prepare(`
    SELECT id, title, content, sensitivity, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
    FROM memories
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
  for (const memory of memories as any[]) {
    const deletedAt = Number(memory.deletedAt || 0) || undefined;
    const payload = {
      memoryId: memory.id,
      text: deletedAt ? "" : String(memory.content || ""),
      title: String(memory.title || "").slice(0, 120),
      sensitivity: deletedAt ? "normal" : memory.sensitivity,
      createdAt: Number(memory.createdAt || 0),
      updatedAt: Number(memory.updatedAt || 0),
      deletedAt,
    };
    if (deletedAt) {
      pushReady(records, blockedRecords, counts, buildRecord({
        id: memory.id,
        dataType: "memory",
        zone: "LifeOSMemoryZone",
        recordType: "LifeOSMemory",
        recordName: `memory:${memory.id}`,
        payload,
        logicalClock: payload.updatedAt,
        requiresUserReview: true,
      }), limit);
      continue;
    }
    if (memory.sensitivity === "sensitive") {
      pushBlocked(blockedRecords, { id: memory.id, dataType: "memory", recordType: "LifeOSMemory", reason: "sensitive-memory", payload }, limit);
      continue;
    }
    if (hasForbiddenValue(payload)) {
      pushBlocked(blockedRecords, { id: memory.id, dataType: "memory", recordType: "LifeOSMemory", reason: "secret-like-content", payload }, limit);
      continue;
    }
    pushReady(records, blockedRecords, counts, buildRecord({
      id: memory.id,
      dataType: "memory",
      zone: "LifeOSMemoryZone",
      recordType: "LifeOSMemory",
      recordName: `memory:${memory.id}`,
      payload,
      logicalClock: payload.updatedAt,
      requiresUserReview: false,
    }), limit);
  }
  return { records, blockedRecords, counts };
}

function collectTaskRecords(limit: number) {
  const records: CloudKitSyncRecordCandidate[] = [];
  const blockedRecords: CloudKitSyncBlockedRecord[] = [];
  const counts = { zones: new Map<string, number>(), recordTypes: new Map<string, number>() };
  const tasks = db.prepare(`
    SELECT id, type, status, input_json as inputJson, result_json as resultJson, error,
           created_at as createdAt, started_at as startedAt, finished_at as finishedAt
    FROM tasks
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  for (const task of tasks as any[]) {
    const input = safeJson(task.inputJson, null);
    const result = safeJson(task.resultJson, null);
    const payload = {
      taskId: task.id,
      type: task.type,
      state: task.status,
      input,
      result,
      error: task.error ? String(task.error).slice(0, 240) : undefined,
      createdAt: Number(task.createdAt || 0),
      startedAt: Number(task.startedAt || 0) || undefined,
      finishedAt: Number(task.finishedAt || 0) || undefined,
    };
    if (input === null || (task.resultJson && result === null)) {
      pushBlocked(blockedRecords, { id: task.id, dataType: "tasks", recordType: "LifeOSTask", reason: "malformed-json", payload }, limit);
      continue;
    }
    if (hasForbiddenField(payload) || hasForbiddenValue(payload)) {
      pushBlocked(blockedRecords, { id: task.id, dataType: "tasks", recordType: "LifeOSTask", reason: hasForbiddenField(payload) ? "unsafe-field" : "secret-like-content", payload }, limit);
      continue;
    }
    pushReady(records, blockedRecords, counts, buildRecord({
      id: task.id,
      dataType: "tasks",
      zone: "LifeOSTaskZone",
      recordType: "LifeOSTask",
      recordName: `task:${task.id}`,
      payload,
      logicalClock: Number(task.finishedAt || task.startedAt || task.createdAt || 0),
      requiresUserReview: task.status === "deleted",
    }), limit);
  }
  const taskListState = db.prepare(`
    SELECT key, value_json as valueJson, updated_at as updatedAt
    FROM client_state
    WHERE key = 'lifeos_tasks_pro'
  `).get() as any;
  if (taskListState) {
    const value = safeJson(taskListState.valueJson, undefined);
    const payload = {
      taskListKey: "lifeos_tasks_pro",
      items: Array.isArray(value)
        ? value.map((item) => ({
          id: typeof item?.id === "number" || typeof item?.id === "string" ? String(item.id).slice(0, 80) : stableIdHash(JSON.stringify(item)).slice(0, 16),
          text: String(item?.text || "").replace(/\s+/g, " ").trim().slice(0, 500),
          completed: Boolean(item?.completed),
          priority: ["high", "medium", "low"].includes(String(item?.priority)) ? String(item.priority) : "medium",
          createdAt: Number.isFinite(Number(item?.createdAt)) ? Number(item.createdAt) : 0,
        }))
        : undefined,
      updatedAt: Number(taskListState.updatedAt || 0),
    };
    if (!Array.isArray(value)) {
      pushBlocked(blockedRecords, { id: taskListState.key, dataType: "tasks", recordType: "LifeOSTaskListSnapshot", reason: "malformed-json", payload }, limit);
    } else if (hasForbiddenField(value) || hasForbiddenValue(value) || hasForbiddenValue(payload)) {
      pushBlocked(blockedRecords, { id: taskListState.key, dataType: "tasks", recordType: "LifeOSTaskListSnapshot", reason: hasForbiddenField(value) ? "unsafe-field" : "secret-like-content", payload }, limit);
    } else {
      pushReady(records, blockedRecords, counts, buildRecord({
        id: taskListState.key,
        dataType: "tasks",
        zone: "LifeOSTaskZone",
        recordType: "LifeOSTaskListSnapshot",
        recordName: `task-list:${taskListState.key}`,
        payload,
        logicalClock: payload.updatedAt,
        requiresUserReview: false,
      }), limit);
    }
  }
  return { records, blockedRecords, counts };
}

function collectGeneratedAppStateRecords(limit: number) {
  const records: CloudKitSyncRecordCandidate[] = [];
  const blockedRecords: CloudKitSyncBlockedRecord[] = [];
  const counts = { zones: new Map<string, number>(), recordTypes: new Map<string, number>() };
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'custom_app_state'").get();
  if (!tableExists) return { records, blockedRecords, counts };
  const rows = db.prepare(`
    SELECT s.app_id as appId, s.state_json as stateJson, s.updated_at as updatedAt,
           a.name as appName, a.status as appStatus, a.deleted_at as deletedAt
    FROM custom_app_state s
    LEFT JOIN custom_apps a ON a.id = s.app_id
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(limit);
  for (const row of rows as any[]) {
    const state = safeJson(row.stateJson, null);
    const payload = {
      appId: row.appId,
      appName: String(row.appName || "").slice(0, 120),
      stateJson: state,
      schemaVersion: 1,
      updatedAt: Number(row.updatedAt || 0),
      deletedAt: Number(row.deletedAt || 0) || undefined,
    };
    if (state === null) {
      pushBlocked(blockedRecords, { id: row.appId, dataType: "generated-app-state", recordType: "LifeOSGeneratedAppState", reason: "malformed-json", payload: row.stateJson }, limit);
      continue;
    }
    if (hasForbiddenField(payload) || hasForbiddenValue(payload)) {
      pushBlocked(blockedRecords, { id: row.appId, dataType: "generated-app-state", recordType: "LifeOSGeneratedAppState", reason: hasForbiddenField(payload) ? "unsafe-field" : "secret-like-content", payload }, limit);
      continue;
    }
    pushReady(records, blockedRecords, counts, buildRecord({
      id: row.appId,
      dataType: "generated-app-state",
      zone: "LifeOSGeneratedAppZone",
      recordType: "LifeOSGeneratedAppState",
      recordName: `generated-app-state:${row.appId}`,
      payload,
      logicalClock: payload.updatedAt,
    }), limit);
  }
  return { records, blockedRecords, counts };
}

function collectDeviceTrustRecords(limit: number) {
  const records: CloudKitSyncRecordCandidate[] = [];
  const blockedRecords: CloudKitSyncBlockedRecord[] = [];
  const counts = { zones: new Map<string, number>(), recordTypes: new Map<string, number>() };
  const devices = db.prepare(`
    SELECT id, name, type, status, public_key as publicKey,
           access_token_expires_at as accessTokenExpiresAt,
           created_at as createdAt, last_seen_at as lastSeenAt, revoked_at as revokedAt
    FROM devices
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(limit);
  for (const device of devices as any[]) {
    const deviceIdHash = stableIdHash(device.id);
    const publicKeyFingerprint = device.publicKey ? stableIdHash(device.publicKey).slice(0, 32) : undefined;
    const logicalClock = Number(device.revokedAt || device.lastSeenAt || device.createdAt || 0);
    const payload = {
      deviceIdHash,
      displayName: String(device.name || "Device").replace(/\s+/g, " ").trim().slice(0, 120),
      deviceType: String(device.type || "unknown").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80) || "unknown",
      trustState: device.revokedAt ? "revoked" : String(device.status || "unknown").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80) || "unknown",
      publicKeyFingerprint,
      accessExpiresAt: Number(device.accessTokenExpiresAt || 0) || undefined,
      createdAt: Number(device.createdAt || 0),
      lastSeenAt: Number(device.lastSeenAt || 0),
      revokedAt: Number(device.revokedAt || 0) || undefined,
    };
    if (hasForbiddenValue(payload)) {
      pushBlocked(blockedRecords, { id: device.id, dataType: "device-trust", recordType: "LifeOSDeviceTrust", reason: "secret-like-content", payload }, limit);
      continue;
    }
    pushReady(records, blockedRecords, counts, buildRecord({
      id: device.id,
      dataType: "device-trust",
      zone: "LifeOSDeviceTrustZone",
      recordType: "LifeOSDeviceTrust",
      recordName: `device:${deviceIdHash.slice(0, 24)}`,
      payload,
      logicalClock,
      requiresUserReview: true,
    }), limit);
  }
  return { records, blockedRecords, counts };
}

function mergeCounts(target: Map<string, number>, source: Map<string, number>) {
  for (const [key, value] of source.entries()) target.set(key, (target.get(key) || 0) + value);
}

function sortedCounts(counts: Map<string, number>, key: "zone" | "recordType") {
  return Array.from(counts.entries())
    .map(([name, records]) => ({ [key]: name, records }))
    .sort((left, right) => Number(right.records) - Number(left.records)) as Array<{ zone: string; records: number }> & Array<{ recordType: string; records: number }>;
}

function nextActionFor(status: CloudKitSyncStatus, readiness: IcloudDataSyncReadiness, blockedCount: number) {
  if (status === "skipped") return "Enable CloudKit data sync only after the user explicitly opts in.";
  if (status === "blocked") return readiness.nextAction;
  if (status === "empty") return "Create chat, memory, task, or generated app data before testing CloudKit sync.";
  if (status === "needs-review") return `Review ${blockedCount} blocked record(s), remove secrets or sensitive items, then rerun the preview.`;
  return "Run the read-only helper probe, then the disposable roundtrip before any real sync export.";
}

export function buildCloudKitSyncBatchPreview(
  readiness: IcloudDataSyncReadiness,
  options: { limit?: number } = {},
): CloudKitSyncBatchPreview {
  const limit = clampLimit(options.limit);
  const records: CloudKitSyncRecordCandidate[] = [];
  const blockedRecords: CloudKitSyncBlockedRecord[] = [];
  const zones = new Map<string, number>();
  const recordTypes = new Map<string, number>();

  if (readiness.enabled) {
    for (const dataType of readiness.selectedDataTypes as CloudKitSyncDataType[]) {
      const collected = dataType === "chat-history"
        ? collectChatRecords(limit)
        : dataType === "memory"
        ? collectMemoryRecords(limit)
        : dataType === "tasks"
        ? collectTaskRecords(limit)
        : dataType === "generated-app-state"
        ? collectGeneratedAppStateRecords(limit)
        : dataType === "device-trust"
        ? collectDeviceTrustRecords(limit)
        : { records: [], blockedRecords: [], counts: { zones: new Map<string, number>(), recordTypes: new Map<string, number>() } };
      records.push(...collected.records.slice(0, Math.max(0, limit - records.length)));
      blockedRecords.push(...collected.blockedRecords.slice(0, Math.max(0, limit - blockedRecords.length)));
      mergeCounts(zones, collected.counts.zones);
      mergeCounts(recordTypes, collected.counts.recordTypes);
    }
  }

  const totalCandidateCount = records.length + blockedRecords.length;
  const truncated = totalCandidateCount >= limit || records.length >= limit || blockedRecords.length >= limit;
  const status: CloudKitSyncStatus = !readiness.enabled
    ? "skipped"
    : !readiness.ready
    ? "blocked"
    : totalCandidateCount === 0
    ? "empty"
    : blockedRecords.length > 0
    ? "needs-review"
    : "ready";
  const forbiddenFieldCount = Array.from(new Set(readiness.recordPlan.flatMap((item) => item.forbiddenFields))).length;
  const forbiddenFieldNames = forbiddenFieldCount ? ["redacted-sensitive-fields"] : [];
  const secretLikeContentBlocked = blockedRecords.filter((record) => record.reason === "secret-like-content" || record.reason === "unsafe-field").length;
  const sensitiveMemoryBlocked = blockedRecords.filter((record) => record.reason === "sensitive-memory").length;
  const oversizedContentBlocked = blockedRecords.filter((record) => record.reason === "payload-too-large").length;
  const helperPayloadPlan = {
    schema: "lifeos-cloudkit-sync-batch-preview.v1" as const,
    operation: "preview" as const,
    sendsRawUserContent: false as const,
    nextHelperOperation: status === "ready" ? "probe" as const : status === "needs-review" ? "sync-export-blocked" as const : "sync-export-blocked" as const,
    recordPlanHash: stableHash({
      selectedDataTypes: readiness.selectedDataTypes,
      records: records.map((record) => [record.dataType, record.recordType, record.contentHash]),
      blocked: blockedRecords.map((record) => [record.dataType, record.recordType, record.reason, record.contentHash]),
    }).slice(0, 32),
  };

  return {
    ok: status === "ready",
    status,
    generatedAt: new Date().toISOString(),
    readinessStatus: readiness.status,
    dataSyncScope: readiness.dataSyncScope,
    selectedDataTypes: readiness.selectedDataTypes,
    readyRecordCount: records.length,
    blockedRecordCount: blockedRecords.length,
    totalCandidateCount,
    truncated,
    limit,
    zones: sortedCounts(zones, "zone"),
    recordTypes: sortedCounts(recordTypes, "recordType"),
    records: records.map(toPreview),
    blockedRecords,
    safety: {
      forbiddenFieldNames,
      forbiddenFieldCount,
      blockedDataTypes: readiness.blockedDataTypes,
      notSyncedDataTypes: readiness.notSyncedDataTypes,
      credentialBoundary: readiness.credentialBoundary,
      secretLikeContentBlocked,
      sensitiveMemoryBlocked,
      oversizedContentBlocked,
      maxRecordPayloadBytes: MAX_CLOUDKIT_RECORD_PAYLOAD_BYTES,
      rawPayloadIncluded: false,
    },
    helperPayloadPlan,
    nextAction: nextActionFor(status, readiness, blockedRecords.length),
  };
}

export function buildCloudKitSyncExportPackage(
  readiness: IcloudDataSyncReadiness,
  options: { limit?: number; confirmation?: string; now?: Date } = {},
): CloudKitSyncExportPackage {
  const generatedAt = (options.now || new Date()).toISOString();
  const preview = buildCloudKitSyncBatchPreview(readiness, { limit: options.limit });
  const limit = clampLimit(options.limit);
  const records: CloudKitSyncRecordCandidate[] = [];

  if (preview.status === "ready" && options.confirmation === CLOUDKIT_SYNC_EXPORT_CONFIRMATION) {
    for (const dataType of readiness.selectedDataTypes as CloudKitSyncDataType[]) {
      const collected = dataType === "chat-history"
        ? collectChatRecords(limit)
        : dataType === "memory"
        ? collectMemoryRecords(limit)
        : dataType === "tasks"
        ? collectTaskRecords(limit)
        : dataType === "generated-app-state"
        ? collectGeneratedAppStateRecords(limit)
        : dataType === "device-trust"
        ? collectDeviceTrustRecords(limit)
        : { records: [] };
      records.push(...collected.records.slice(0, Math.max(0, limit - records.length)));
    }
  }

  const exportRecords: CloudKitSyncExportRecord[] = records.map((record) => ({
    zone: record.zone,
    recordType: record.recordType,
    recordName: record.recordName,
    mutationId: record.mutationId,
    contentHash: record.contentHash,
    fields: record.syncFields,
  }));
  const recordPlanHash = stableHash({
    selectedDataTypes: readiness.selectedDataTypes,
    records: exportRecords.map((record) => [record.zone, record.recordType, record.recordName, record.contentHash]),
  }).slice(0, 32);
  const requestId = `lifeos-cloudkit-sync-${recordPlanHash}`;
  const ready = preview.status === "ready" && options.confirmation === CLOUDKIT_SYNC_EXPORT_CONFIRMATION && exportRecords.length > 0;

  return {
    ok: ready,
    status: ready ? "ready" : "blocked",
    generatedAt,
    requestId,
    preview,
    helperSyncBatch: {
      schema: CLOUDKIT_SYNC_EXPORT_SCHEMA,
      confirmation: CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
      recordPlanHash,
      generatedAt,
      records: exportRecords,
      zones: preview.zones,
    },
    safety: {
      rawPayloadReturnedToAdmin: false,
      rawPayloadSentToNativeHelper: ready,
      blockedBeforeExport: preview.blockedRecordCount,
      requiresExplicitConfirmation: true,
    },
  };
}

export function summarizeCloudKitSyncExportPackage(exportPackage: CloudKitSyncExportPackage) {
  return {
    ok: exportPackage.ok,
    status: exportPackage.status,
    generatedAt: exportPackage.generatedAt,
    requestId: exportPackage.requestId,
    preview: exportPackage.preview,
    exportRecordCount: exportPackage.helperSyncBatch.records.length,
    recordPlanHash: exportPackage.helperSyncBatch.recordPlanHash,
    zones: exportPackage.helperSyncBatch.zones,
    safety: exportPackage.safety,
  };
}
