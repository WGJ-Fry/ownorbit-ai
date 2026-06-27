import crypto from "crypto";
import { db } from "./db";
import type { CalendarSyncPlanItem, CalendarSyncPreview } from "./calendarSyncPreview";
import type { CalendarSyncHistoryRecord } from "./calendarSyncHistory";

export type CalendarSyncRunStatus = "ready" | "blocked" | "needs-review" | "completed";
export type CalendarSyncRunMode = "preview" | "external-read" | "external-write" | "acceptance";

export type CalendarSyncRunConflict = {
  id: string;
  kind: "duplicate" | "blocked-write" | "high-risk-write" | "rollback-review";
  providerId: string;
  itemKind: "event" | "task";
  title: string;
  risk: "low" | "medium" | "high";
  reason: string;
  operationId?: string;
  externalId?: string;
};

export type CalendarSyncRunSummary = {
  generatedAt: string;
  previewMode: CalendarSyncPreview["mode"];
  externalWritesEnabled: boolean;
  writeBackSupported: boolean;
  operationCount: number;
  readOnlyItems: number;
  externalReadItems: number;
  blockedWrites: number;
  syncConflicts: number;
  providersReadyForRead: number;
  providersReadyForWrite: number;
  plan: {
    pullExternal: number;
    pushLocal: number;
    reviewConflicts: number;
    blocked: number;
  };
  recentHistory: {
    total: number;
    rollbackReady: number;
    rollbackNeedsManualReview: number;
    rollbackFailed: number;
  };
};

export type CalendarSyncRunRecord = {
  id: string;
  provider: string;
  mode: CalendarSyncRunMode;
  status: CalendarSyncRunStatus;
  startedAt: number;
  finishedAt?: number;
  summary: CalendarSyncRunSummary;
  conflicts: CalendarSyncRunConflict[];
  nextSteps: string[];
  createdByType?: string;
  createdById?: string;
};

type CalendarSyncRunRow = {
  id: string;
  provider: string;
  mode: CalendarSyncRunMode;
  status: CalendarSyncRunStatus;
  startedAt: number;
  finishedAt: number | null;
  summaryJson: string;
  conflictsJson: string;
  nextStepsJson: string;
  createdByType: string | null;
  createdById: string | null;
};

function compact(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 180);
}

function redactCalendarRunText(value: unknown) {
  return compact(value)
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(bearer|token|key|secret|password)=\S+/gi, "$1=[redacted]");
}

function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRecord(row: CalendarSyncRunRow): CalendarSyncRunRecord {
  return {
    id: row.id,
    provider: row.provider,
    mode: row.mode,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt || undefined,
    summary: safeParse<CalendarSyncRunSummary>(row.summaryJson, {} as CalendarSyncRunSummary),
    conflicts: safeParse<CalendarSyncRunConflict[]>(row.conflictsJson, []),
    nextSteps: safeParse<string[]>(row.nextStepsJson, []),
    createdByType: row.createdByType || undefined,
    createdById: row.createdById || undefined,
  };
}

function providerForRun(preview: CalendarSyncPreview) {
  const providerIds = new Set(preview.operations.map((operation) => operation.providerId).filter(Boolean));
  if (providerIds.size === 0) return "none";
  if (providerIds.size === 1) return [...providerIds][0];
  return "mixed";
}

function conflictFromPlanItem(item: CalendarSyncPlanItem): CalendarSyncRunConflict | null {
  if (item.direction === "review-conflict") {
    return {
      id: item.id,
      kind: "duplicate",
      providerId: item.providerId,
      itemKind: item.kind,
      title: redactCalendarRunText(item.title),
      risk: "high",
      reason: redactCalendarRunText(item.reason),
      operationId: item.operationId,
      externalId: item.externalId ? redactCalendarRunText(item.externalId) : undefined,
    };
  }
  if (item.direction === "blocked") {
    return {
      id: item.id,
      kind: "blocked-write",
      providerId: item.providerId,
      itemKind: item.kind,
      title: redactCalendarRunText(item.title),
      risk: item.risk,
      reason: redactCalendarRunText(item.reason),
      operationId: item.operationId,
      externalId: item.externalId ? redactCalendarRunText(item.externalId) : undefined,
    };
  }
  if (item.direction === "push-local" && item.risk === "high") {
    return {
      id: item.id,
      kind: "high-risk-write",
      providerId: item.providerId,
      itemKind: item.kind,
      title: redactCalendarRunText(item.title),
      risk: item.risk,
      reason: "High-risk external write requires manual review before execution.",
      operationId: item.operationId,
      externalId: item.externalId ? redactCalendarRunText(item.externalId) : undefined,
    };
  }
  return null;
}

function buildCalendarSyncRunConflicts(preview: CalendarSyncPreview, recentHistory: CalendarSyncHistoryRecord[]) {
  const conflicts = preview.syncPlan.items
    .map(conflictFromPlanItem)
    .filter((item): item is CalendarSyncRunConflict => Boolean(item));

  for (const record of recentHistory) {
    if (record.status === "rollback_failed" || record.rollback.requiresManualReview) {
      conflicts.push({
        id: `history:${record.id}`,
        kind: "rollback-review",
        providerId: record.providerId,
        itemKind: record.kind,
        title: redactCalendarRunText(record.title),
        risk: record.status === "rollback_failed" ? "high" : "medium",
        reason: redactCalendarRunText(record.rollback.reason),
        externalId: record.externalId ? redactCalendarRunText(record.externalId) : undefined,
      });
    }
  }
  return conflicts.slice(0, 20);
}

function buildCalendarSyncRunSummary(preview: CalendarSyncPreview, recentHistory: CalendarSyncHistoryRecord[]): CalendarSyncRunSummary {
  return {
    generatedAt: preview.generatedAt,
    previewMode: preview.mode,
    externalWritesEnabled: preview.externalWritesEnabled,
    writeBackSupported: preview.writeBackSupported,
    operationCount: preview.operations.length,
    readOnlyItems: preview.summary.readOnlyItems,
    externalReadItems: preview.summary.externalReadItems,
    blockedWrites: preview.summary.blockedWrites,
    syncConflicts: preview.summary.syncConflicts,
    providersReadyForRead: preview.summary.providersReadyForRead,
    providersReadyForWrite: preview.summary.providersReadyForWrite,
    plan: {
      pullExternal: preview.syncPlan.pullExternal,
      pushLocal: preview.syncPlan.pushLocal,
      reviewConflicts: preview.syncPlan.reviewConflicts,
      blocked: preview.syncPlan.blocked,
    },
    recentHistory: {
      total: recentHistory.length,
      rollbackReady: recentHistory.filter((record) => record.rollback.canAutoRollback).length,
      rollbackNeedsManualReview: recentHistory.filter((record) => record.rollback.requiresManualReview).length,
      rollbackFailed: recentHistory.filter((record) => record.status === "rollback_failed").length,
    },
  };
}

function statusForRun(preview: CalendarSyncPreview, conflicts: CalendarSyncRunConflict[]): CalendarSyncRunStatus {
  if (preview.syncPlan.blocked > 0 || conflicts.some((conflict) => conflict.kind === "blocked-write")) return "blocked";
  if (conflicts.length > 0 || preview.syncPlan.pushLocal > 0 || preview.syncPlan.reviewConflicts > 0) return "needs-review";
  if (preview.operations.length === 0) return "completed";
  return "ready";
}

function nextStepsForRun(preview: CalendarSyncPreview, conflicts: CalendarSyncRunConflict[]) {
  const steps: string[] = [];
  if (preview.summary.externalReadErrors > 0) {
    steps.push("Fix connector permission/read errors before trusting this sync preview.");
  }
  if (preview.syncPlan.blocked > 0) {
    steps.push("Blocked writes must stay disabled until connector auth, explicit write opt-in, audit logging, and rollback evidence are ready.");
  }
  if (preview.syncPlan.reviewConflicts > 0) {
    steps.push("Review duplicate/conflicting external items before creating or updating anything.");
  }
  if (conflicts.some((conflict) => conflict.kind === "rollback-review")) {
    steps.push("Resolve rollback review items before running more external writes.");
  }
  if (preview.syncPlan.pushLocal > 0 && preview.syncPlan.blocked === 0 && preview.syncPlan.reviewConflicts === 0) {
    steps.push("Type the fixed confirmation phrase only for the selected item you intend to write, then verify the external app and rollback record.");
  }
  if (preview.syncPlan.pullExternal > 0) {
    steps.push("Review pulled external items as LifeOS memory before using them to generate new write proposals.");
  }
  if (steps.length === 0) {
    steps.push("No external write is ready. Keep this as read-only sync evidence until a connector is configured.");
  }
  steps.push("Do not describe this as full unattended two-way sync until long-running account tests pass.");
  return steps.slice(0, 8);
}

export function createCalendarSyncRun(input: {
  preview: CalendarSyncPreview;
  recentHistory?: CalendarSyncHistoryRecord[];
  mode?: CalendarSyncRunMode;
  createdByType?: string;
  createdById?: string;
}): CalendarSyncRunRecord {
  const startedAt = Date.now();
  const recentHistory = input.recentHistory || [];
  const conflicts = buildCalendarSyncRunConflicts(input.preview, recentHistory);
  const summary = buildCalendarSyncRunSummary(input.preview, recentHistory);
  const status = statusForRun(input.preview, conflicts);
  const nextSteps = nextStepsForRun(input.preview, conflicts);
  const record: CalendarSyncRunRecord = {
    id: `cal-run-${crypto.randomUUID()}`,
    provider: providerForRun(input.preview),
    mode: input.mode || "preview",
    status,
    startedAt,
    finishedAt: Date.now(),
    summary,
    conflicts,
    nextSteps,
    createdByType: input.createdByType,
    createdById: input.createdById,
  };

  db.prepare(`
    INSERT INTO calendar_sync_runs (
      id, provider, mode, status, started_at, finished_at,
      summary_json, conflicts_json, next_steps_json, created_by_type, created_by_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.provider,
    record.mode,
    record.status,
    record.startedAt,
    record.finishedAt || null,
    JSON.stringify(record.summary),
    JSON.stringify(record.conflicts),
    JSON.stringify(record.nextSteps),
    record.createdByType || null,
    record.createdById || null,
  );
  return record;
}

export function listCalendarSyncRuns(limit = 20): CalendarSyncRunRecord[] {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = db.prepare(`
    SELECT id, provider, mode, status, started_at as startedAt, finished_at as finishedAt,
           summary_json as summaryJson, conflicts_json as conflictsJson,
           next_steps_json as nextStepsJson, created_by_type as createdByType,
           created_by_id as createdById
    FROM calendar_sync_runs
    ORDER BY started_at DESC
    LIMIT ?
  `).all(safeLimit) as CalendarSyncRunRow[];
  return rows.map(rowToRecord);
}
