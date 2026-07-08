import crypto from "crypto";
import { db } from "./db";
import type { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness.ts";

type IcloudDataSyncReadiness = ReturnType<typeof getIcloudDataSyncReadiness>;
type CloudKitSyncStatus = "skipped" | "blocked" | "empty" | "needs-review" | "ready";
type CloudKitSyncDataType = "chat-history" | "memory" | "tasks" | "generated-app-state";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
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
  reason: "sensitive-memory" | "secret-like-content" | "unsafe-field" | "malformed-json" | "unsupported-record";
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
    blockedDataTypes: string[];
    notSyncedDataTypes: string[];
    secretLikeContentBlocked: number;
    sensitiveMemoryBlocked: number;
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

function byteSize(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function addCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

function pushReady(
  records: CloudKitSyncRecordPreview[],
  counts: { zones: Map<string, number>; recordTypes: Map<string, number> },
  record: CloudKitSyncRecordPreview,
  limit: number,
) {
  addCount(counts.zones, record.zone);
  addCount(counts.recordTypes, record.recordType);
  if (records.length < limit) records.push(record);
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
}): CloudKitSyncRecordPreview {
  return {
    id: recordId(`${input.dataType}:${input.recordType}`, input.id),
    dataType: input.dataType,
    zone: input.zone,
    recordType: input.recordType,
    recordName: input.recordName,
    mutationId: stableHash({ id: input.id, dataType: input.dataType, recordType: input.recordType, logicalClock: input.logicalClock }).slice(0, 32),
    logicalClock: input.logicalClock,
    fieldNames: Array.from(collectFieldNames(input.payload)).sort().slice(0, 32),
    byteSize: byteSize(input.payload),
    contentHash: stableHash(input.payload),
    requiresUserReview: input.requiresUserReview ?? true,
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
  const records: CloudKitSyncRecordPreview[] = [];
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
    pushReady(records, counts, buildRecord({
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
    SELECT id, session_id as sessionId, role, content_json as contentJson,
           offline_mutation_id as offlineMutationId, idempotency_key as idempotencyKey,
           client_sequence as clientSequence, source_version as sourceVersion,
           queued_at as queuedAt, created_at as createdAt
    FROM messages
    ORDER BY created_at DESC
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
    };
    pushReady(records, counts, buildRecord({
      id: message.id,
      dataType: "chat-history",
      zone: "LifeOSChatZone",
      recordType: "LifeOSMessage",
      recordName: `message:${message.id}`,
      payload,
      logicalClock: payload.logicalClock,
    }), limit);
  }

  return { records, blockedRecords, counts };
}

function collectMemoryRecords(limit: number) {
  const records: CloudKitSyncRecordPreview[] = [];
  const blockedRecords: CloudKitSyncBlockedRecord[] = [];
  const counts = { zones: new Map<string, number>(), recordTypes: new Map<string, number>() };
  const memories = db.prepare(`
    SELECT id, title, content, sensitivity, created_at as createdAt, updated_at as updatedAt, deleted_at as deletedAt
    FROM memories
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
  for (const memory of memories as any[]) {
    const payload = {
      memoryId: memory.id,
      text: String(memory.content || ""),
      title: String(memory.title || "").slice(0, 120),
      sensitivity: memory.sensitivity,
      createdAt: Number(memory.createdAt || 0),
      updatedAt: Number(memory.updatedAt || 0),
      deletedAt: Number(memory.deletedAt || 0) || undefined,
    };
    if (memory.sensitivity === "sensitive") {
      pushBlocked(blockedRecords, { id: memory.id, dataType: "memory", recordType: "LifeOSMemory", reason: "sensitive-memory", payload }, limit);
      continue;
    }
    if (hasForbiddenValue(payload)) {
      pushBlocked(blockedRecords, { id: memory.id, dataType: "memory", recordType: "LifeOSMemory", reason: "secret-like-content", payload }, limit);
      continue;
    }
    pushReady(records, counts, buildRecord({
      id: memory.id,
      dataType: "memory",
      zone: "LifeOSMemoryZone",
      recordType: memory.deletedAt ? "LifeOSMemoryTombstone" : "LifeOSMemory",
      recordName: `memory:${memory.id}`,
      payload,
      logicalClock: payload.updatedAt,
    }), limit);
  }
  return { records, blockedRecords, counts };
}

function collectTaskRecords(limit: number) {
  const records: CloudKitSyncRecordPreview[] = [];
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
    pushReady(records, counts, buildRecord({
      id: task.id,
      dataType: "tasks",
      zone: "LifeOSTaskZone",
      recordType: task.status === "deleted" ? "LifeOSTaskTombstone" : "LifeOSTask",
      recordName: `task:${task.id}`,
      payload,
      logicalClock: Number(task.finishedAt || task.startedAt || task.createdAt || 0),
    }), limit);
  }
  return { records, blockedRecords, counts };
}

function collectGeneratedAppStateRecords(limit: number) {
  const records: CloudKitSyncRecordPreview[] = [];
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
    pushReady(records, counts, buildRecord({
      id: row.appId,
      dataType: "generated-app-state",
      zone: "LifeOSGeneratedAppZone",
      recordType: row.deletedAt ? "LifeOSGeneratedAppMutation" : "LifeOSGeneratedAppState",
      recordName: `generated-app-state:${row.appId}`,
      payload,
      logicalClock: payload.updatedAt,
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
  const records: CloudKitSyncRecordPreview[] = [];
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
  const forbiddenFieldNames = Array.from(new Set(readiness.recordPlan.flatMap((item) => item.forbiddenFields))).sort();
  const secretLikeContentBlocked = blockedRecords.filter((record) => record.reason === "secret-like-content" || record.reason === "unsafe-field").length;
  const sensitiveMemoryBlocked = blockedRecords.filter((record) => record.reason === "sensitive-memory").length;
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
    records,
    blockedRecords,
    safety: {
      forbiddenFieldNames,
      blockedDataTypes: readiness.blockedDataTypes,
      notSyncedDataTypes: readiness.notSyncedDataTypes,
      secretLikeContentBlocked,
      sensitiveMemoryBlocked,
      rawPayloadIncluded: false,
    },
    helperPayloadPlan,
    nextAction: nextActionFor(status, readiness, blockedRecords.length),
  };
}
