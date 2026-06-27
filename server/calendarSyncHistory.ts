import crypto from "crypto";
import { db } from "./db";
import { executeCalendarSyncOperationAsync, type CalendarSyncExecuteInput, type CalendarSyncExecutionResult } from "./calendarSyncPreview";

export type CalendarSyncHistoryStatus = "executed" | "rolled_back" | "rollback_failed";

export type CalendarSyncHistoryRecord = {
  id: string;
  providerId: NonNullable<CalendarSyncExecuteInput["providerId"]>;
  kind: NonNullable<CalendarSyncExecuteInput["kind"]>;
  action: NonNullable<CalendarSyncExecuteInput["action"]>;
  title: string;
  externalId?: string;
  status: CalendarSyncHistoryStatus;
  connector: CalendarSyncExecutionResult["auditSummary"]["connector"];
  source?: string;
  createdAt: number;
  rolledBackAt?: number;
  rollback: {
    available: boolean;
    requiresManualReview: boolean;
    canAutoRollback: boolean;
    reason: string;
  };
};

type CalendarSyncHistoryRow = {
  id: string;
  providerId: NonNullable<CalendarSyncExecuteInput["providerId"]>;
  kind: NonNullable<CalendarSyncExecuteInput["kind"]>;
  action: NonNullable<CalendarSyncExecuteInput["action"]>;
  title: string;
  externalId: string | null;
  status: CalendarSyncHistoryStatus;
  connector: CalendarSyncExecutionResult["auditSummary"]["connector"];
  source: string | null;
  rollbackPlanJson: string;
  resultJson: string;
  createdAt: number;
  rolledBackAt: number | null;
  rollbackResultJson: string | null;
  rollbackError: string | null;
};

const CONFIRMATION_TEXT = "WRITE TO EXTERNAL CALENDAR";

function compact(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 160);
}

function redactCalendarText(value: unknown) {
  return compact(value)
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(bearer|token|key|secret|password)=\S+/gi, "$1=[redacted]");
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRecord(row: CalendarSyncHistoryRow): CalendarSyncHistoryRecord {
  const result = safeParse<CalendarSyncExecutionResult | null>(row.resultJson, null);
  const rollback = buildRollbackInput(row, { explicitConsent: true, confirmationText: CONFIRMATION_TEXT });
  return {
    id: row.id,
    providerId: row.providerId,
    kind: row.kind,
    action: row.action,
    title: redactCalendarText(row.title),
    externalId: row.externalId || undefined,
    status: row.status,
    connector: row.connector,
    source: row.source ? redactCalendarText(row.source) : undefined,
    createdAt: row.createdAt,
    rolledBackAt: row.rolledBackAt || undefined,
    rollback: {
      available: Boolean(result?.rollbackPlan.available),
      requiresManualReview: Boolean(result?.rollbackPlan.requiresManualReview),
      canAutoRollback: Boolean(rollback),
      reason: rollback
        ? "A guarded reverse operation is available after the same explicit confirmation phrase."
        : rollbackReason(row, result),
    },
  };
}

function rollbackReason(row: CalendarSyncHistoryRow, result: CalendarSyncExecutionResult | null) {
  if (row.status === "rolled_back") return "This operation has already been rolled back.";
  if (!result?.rollbackPlan.available) return "No rollback evidence was captured for this operation.";
  if ((row.action === "update" || row.action === "complete" || row.action === "delete") && !result.rollbackPlan.previousState?.title) {
    return "Previous state is incomplete, so automatic rollback is blocked.";
  }
  return "Automatic rollback is not available for this operation.";
}

function buildRollbackInput(row: CalendarSyncHistoryRow, confirmation: Pick<CalendarSyncExecuteInput, "explicitConsent" | "confirmationText">): CalendarSyncExecuteInput | null {
  if (row.status === "rolled_back") return null;
  const result = safeParse<CalendarSyncExecutionResult | null>(row.resultJson, null);
  if (!result?.rollbackPlan.available) return null;
  const previousState = result.rollbackPlan.previousState;
  const base = {
    providerId: row.providerId,
    kind: row.kind,
    explicitConsent: confirmation.explicitConsent,
    confirmationText: confirmation.confirmationText,
    source: `calendar-sync-rollback:${row.id}`,
  } satisfies Partial<CalendarSyncExecuteInput>;

  if (row.action === "create") {
    if (!row.externalId) return null;
    return {
      ...base,
      action: "delete",
      title: row.title,
      externalId: row.externalId,
    };
  }

  if (row.action === "update") {
    if (!row.externalId || !previousState?.title) return null;
    return {
      ...base,
      action: "update",
      title: previousState.title,
      startsAt: row.kind === "event" ? previousState.scheduledAt : undefined,
      dueAt: row.kind === "task" ? previousState.scheduledAt : undefined,
      notes: previousState.notes,
      externalId: row.externalId,
    };
  }

  if (row.action === "delete") {
    if (!previousState?.title) return null;
    return {
      ...base,
      action: "create",
      title: previousState.title,
      startsAt: row.kind === "event" ? previousState.scheduledAt : undefined,
      dueAt: row.kind === "task" ? previousState.scheduledAt : undefined,
      notes: previousState.notes,
    };
  }

  if (row.action === "complete") {
    if (!row.externalId || !previousState?.title) return null;
    return {
      ...base,
      action: "update",
      title: previousState.title,
      dueAt: previousState.scheduledAt,
      notes: previousState.notes,
      completed: previousState.completed ?? false,
      externalId: row.externalId,
    };
  }

  return null;
}

function selectHistoryRow(id: string): CalendarSyncHistoryRow | undefined {
  return db.prepare(`
    SELECT id, provider_id as providerId, kind, action, title, external_id as externalId,
           status, connector, source, rollback_plan_json as rollbackPlanJson,
           result_json as resultJson, created_at as createdAt, rolled_back_at as rolledBackAt,
           rollback_result_json as rollbackResultJson, rollback_error as rollbackError
    FROM calendar_sync_operations
    WHERE id = ?
  `).get(id) as CalendarSyncHistoryRow | undefined;
}

export function saveCalendarSyncOperation(input: CalendarSyncExecuteInput, result: CalendarSyncExecutionResult): CalendarSyncHistoryRecord {
  const id = `cal-sync-${crypto.randomUUID()}`;
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO calendar_sync_operations (
      id, provider_id, kind, action, title, external_id, status, connector, source,
      rollback_plan_json, result_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    result.providerId,
    result.kind,
    result.action,
    result.title,
    result.externalId || null,
    "executed",
    result.auditSummary.connector,
    input.source ? compact(input.source) : null,
    JSON.stringify(result.rollbackPlan),
    JSON.stringify(result),
    createdAt,
  );
  return rowToRecord(selectHistoryRow(id)!);
}

export function listCalendarSyncOperations(limit = 20): CalendarSyncHistoryRecord[] {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const rows = db.prepare(`
    SELECT id, provider_id as providerId, kind, action, title, external_id as externalId,
           status, connector, source, rollback_plan_json as rollbackPlanJson,
           result_json as resultJson, created_at as createdAt, rolled_back_at as rolledBackAt,
           rollback_result_json as rollbackResultJson, rollback_error as rollbackError
    FROM calendar_sync_operations
    ORDER BY created_at DESC
    LIMIT ?
  `).all(safeLimit) as CalendarSyncHistoryRow[];
  return rows.map(rowToRecord);
}

export async function rollbackCalendarSyncOperation(
  id: string,
  input: Pick<CalendarSyncExecuteInput, "explicitConsent" | "confirmationText">,
): Promise<{ record: CalendarSyncHistoryRecord; result: CalendarSyncExecutionResult }> {
  const row = selectHistoryRow(id);
  if (!row) throw Object.assign(new Error("Calendar sync operation was not found"), { statusCode: 404 });
  if (row.status === "rolled_back") throw Object.assign(new Error("Calendar sync operation was already rolled back"), { statusCode: 409 });
  if (input.explicitConsent !== true || input.confirmationText !== CONFIRMATION_TEXT) {
    throw Object.assign(new Error("Explicit confirmation is required before rolling back an external calendar operation"), { statusCode: 400 });
  }

  const rollbackInput = buildRollbackInput(row, input);
  if (!rollbackInput) {
    throw Object.assign(new Error(rollbackReason(row, safeParse<CalendarSyncExecutionResult | null>(row.resultJson, null))), { statusCode: 409 });
  }

  try {
    const result = await executeCalendarSyncOperationAsync(rollbackInput);
    db.prepare(`
      UPDATE calendar_sync_operations
      SET status = 'rolled_back', rolled_back_at = ?, rollback_result_json = ?, rollback_error = NULL
      WHERE id = ?
    `).run(Date.now(), JSON.stringify(result), id);
    return { record: rowToRecord(selectHistoryRow(id)!), result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar sync rollback failed";
    db.prepare(`
      UPDATE calendar_sync_operations
      SET status = 'rollback_failed', rollback_error = ?
      WHERE id = ?
    `).run(message, id);
    throw error;
  }
}
