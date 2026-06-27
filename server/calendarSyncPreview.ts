import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import {
  executeGoogleCalendarOperation,
  googleCalendarRecommendation,
  isGoogleCalendarConnectorConfigured,
  readGoogleCalendarItems,
  validateGoogleCalendarOperation,
} from "./googleCalendarConnector";
import {
  executeGoogleTaskOperation,
  readGoogleTaskItems,
  validateGoogleTaskOperation,
} from "./googleTasksConnector";

const VAULT_DIR = path.resolve(process.env.LIFEOS_VAULT_DIR || "/app/vault");
const CALENDAR_ICS_DIR = path.resolve(process.env.LIFEOS_CALENDAR_ICS_DIR || path.join(VAULT_DIR, "calendar"));
const MAX_PREVIEW_ICS_FILES = Number(process.env.LIFEOS_CALENDAR_PREVIEW_MAX_FILES || 10);
const MAX_PREVIEW_ITEMS = Number(process.env.LIFEOS_CALENDAR_PREVIEW_MAX_ITEMS || 30);
const MAX_EXTERNAL_READ_ITEMS = Number(process.env.LIFEOS_CALENDAR_EXTERNAL_READ_MAX_ITEMS || 10);
const MAX_PROPOSED_ITEMS = 20;
const MACOS_CONNECTOR_ENABLED = process.env.LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR === "1";
const EXTERNAL_WRITES_ENABLED = process.env.LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES === "1";
const MACOS_CONNECTOR_MOCK = process.env.LIFEOS_MACOS_CALENDAR_CONNECTOR_MOCK === "1";
const MACOS_CONNECTOR_TIMEOUT_MS = 8000;

export type CalendarSyncProviderId = "ics-local" | "apple-calendar" | "google-calendar" | "system-reminders";
export type CalendarSyncItemKind = "event" | "task";
export type CalendarSyncOperationAction = "read-only-import" | "create" | "update" | "complete" | "delete";
export type CalendarSyncOperationStatus = "ready" | "blocked" | "needs-review" | "executed";
export type CalendarSyncProviderStatus = "ready-readonly" | "ready-write-gated" | "not-configured" | "future-connector" | "permission-needed";

export type CalendarSyncProposedItem = {
  providerId?: CalendarSyncProviderId;
  kind?: CalendarSyncItemKind;
  action?: Exclude<CalendarSyncOperationAction, "read-only-import">;
  title?: string;
  startsAt?: string;
  dueAt?: string;
  externalId?: string;
  source?: string;
};

export type CalendarSyncPreviewOperation = {
  id: string;
  providerId: CalendarSyncProviderId;
  providerLabel: string;
  kind: CalendarSyncItemKind;
  action: CalendarSyncOperationAction;
  status: CalendarSyncOperationStatus;
  title: string;
  scheduledAt?: string;
  externalId?: string;
  source: string;
  writesExternalSystem: boolean;
  risk: "low" | "medium" | "high";
  reason: string;
};

export type CalendarSyncPlanItem = {
  id: string;
  direction: "pull-external" | "push-local" | "review-conflict" | "blocked";
  providerId: CalendarSyncProviderId;
  kind: CalendarSyncItemKind;
  title: string;
  scheduledAt?: string;
  externalId?: string;
  operationId?: string;
  localSource?: string;
  externalSource?: string;
  reason: string;
  risk: "low" | "medium" | "high";
};

export type CalendarSyncPlan = {
  generatedFrom: "preview";
  canProceedAfterConsent: boolean;
  requiresManualReview: boolean;
  pullExternal: number;
  pushLocal: number;
  reviewConflicts: number;
  blocked: number;
  items: CalendarSyncPlanItem[];
};

export type CalendarSyncPreview = {
  generatedAt: string;
  mode: "preview-only" | "connector-ready";
  externalWritesEnabled: boolean;
  writeBackSupported: boolean;
  providers: Array<{
    id: CalendarSyncProviderId;
    label: string;
    configured: boolean;
    readSupported: boolean;
    writeSupported: boolean;
    requiresPermission: boolean;
    status: CalendarSyncProviderStatus;
    recommendations: string[];
  }>;
  operations: CalendarSyncPreviewOperation[];
  syncPlan: CalendarSyncPlan;
  safety: {
    dryRunOnly: boolean;
    requiresExplicitConsentBeforeWrite: true;
    requiresConnectorAuthBeforeWrite: true;
    requiresAuditLogBeforeWrite: true;
    requiresRollbackPlanBeforeWrite: true;
  };
  summary: {
    readOnlyItems: number;
    externalReadItems: number;
    externalReadErrors: number;
    blockedWrites: number;
    syncConflicts: number;
    providersReadyForRead: number;
    providersReadyForWrite: number;
    warnings: string[];
  };
  recommendations: string[];
};

export type CalendarSyncExecuteInput = {
  providerId?: CalendarSyncProviderId;
  kind?: CalendarSyncItemKind;
  action?: Exclude<CalendarSyncOperationAction, "read-only-import">;
  title?: string;
  startsAt?: string;
  dueAt?: string;
  notes?: string;
  completed?: boolean;
  calendarName?: string;
  reminderListName?: string;
  externalId?: string;
  explicitConsent?: boolean;
  confirmationText?: string;
  source?: string;
};

export type CalendarSyncExecutionResult = {
  ok: boolean;
  dryRun: boolean;
  providerId: CalendarSyncProviderId;
  action: CalendarSyncOperationAction;
  kind: CalendarSyncItemKind;
  title: string;
  externalId?: string;
  executedAt: string;
  message: string;
  rollbackPlan: CalendarSyncRollbackPlan;
  auditSummary: {
    connector: "macos-automation" | "google-calendar-api" | "google-tasks-api" | "not-run";
    consent: boolean;
    writesExternalSystem: boolean;
  };
};

export type CalendarSyncPreviousState = {
  title?: string;
  scheduledAt?: string;
  notes?: string;
  completed?: boolean;
};

export type CalendarSyncRollbackPlan = {
  available: boolean;
  requiresManualReview: boolean;
  hint: string;
  previousState?: CalendarSyncPreviousState;
};

type MacosOperationExecution = {
  externalId: string;
  previousState?: CalendarSyncPreviousState;
};

type IcsItem = {
  kind: CalendarSyncItemKind;
  title: string;
  scheduledAt?: string;
  relativePath: string;
};

type ExternalConnectorReadItem = {
  providerId: Extract<CalendarSyncProviderId, "apple-calendar" | "google-calendar" | "system-reminders">;
  kind: CalendarSyncItemKind;
  title: string;
  scheduledAt?: string;
  externalId?: string;
  source: string;
};

function compact(value: unknown, fallback = "") {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function isInsidePath(root: string, target: string) {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function collectIcsFiles(dir = CALENDAR_ICS_DIR, acc: string[] = []): string[] {
  if (acc.length >= MAX_PREVIEW_ICS_FILES) return acc;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (acc.length >= MAX_PREVIEW_ICS_FILES) break;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.resolve(dir, entry.name);
    if (!isInsidePath(CALENDAR_ICS_DIR, fullPath)) continue;
    if (entry.isDirectory()) collectIcsFiles(fullPath, acc);
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".ics")) acc.push(fullPath);
  }
  return acc;
}

function unfoldIcs(raw: string) {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function readIcsProperty(lines: string[], name: string) {
  const upperName = name.toUpperCase();
  const line = lines.find((candidate) => {
    const upper = candidate.toUpperCase();
    return upper.startsWith(`${upperName}:`) || upper.startsWith(`${upperName};`);
  });
  if (!line) return "";
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return "";
  return line.slice(colonIndex + 1)
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDate(value: string) {
  const clean = value.trim();
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return "";
  const [, year, month, day, hour = "00", minute = "00", second = "00", zone] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const timestamp = zone === "Z"
    ? Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
    : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime();
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function parseIcsItems(filePath: string, raw: string): IcsItem[] {
  const unfolded = unfoldIcs(raw);
  const items: IcsItem[] = [];
  const relativePath = path.relative(CALENDAR_ICS_DIR, filePath);
  const parseBlock = (kind: CalendarSyncItemKind, pattern: RegExp) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(unfolded)) && items.length < MAX_PREVIEW_ITEMS) {
      const lines = match[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const status = readIcsProperty(lines, "STATUS").toUpperCase();
      if (kind === "task" && ["COMPLETED", "CANCELLED"].includes(status)) continue;
      const title = compact(readIcsProperty(lines, "SUMMARY"), kind === "task" ? "Untitled task" : "Untitled event");
      const scheduledAt = parseIcsDate(readIcsProperty(lines, kind === "task" ? "DUE" : "DTSTART") || readIcsProperty(lines, "DTSTART"));
      items.push({ kind, title, scheduledAt: scheduledAt || undefined, relativePath });
    }
  };
  parseBlock("event", /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g);
  parseBlock("task", /BEGIN:VTODO([\s\S]*?)END:VTODO/g);
  return items;
}

function loadIcsItems() {
  const items: IcsItem[] = [];
  for (const filePath of collectIcsFiles()) {
    if (items.length >= MAX_PREVIEW_ITEMS) break;
    try {
      items.push(...parseIcsItems(filePath, fs.readFileSync(filePath, "utf8")));
    } catch {
      continue;
    }
  }
  return items.slice(0, MAX_PREVIEW_ITEMS);
}

function providerLabel(providerId: CalendarSyncProviderId) {
  return {
    "ics-local": "Local ICS files",
    "apple-calendar": "Apple Calendar",
    "google-calendar": "Google Calendar",
    "system-reminders": "System Reminders",
  }[providerId];
}

function providerItemLabel(providerId: CalendarSyncProviderId, kind?: CalendarSyncItemKind) {
  if (providerId === "google-calendar" && kind === "task") return "Google Tasks";
  return providerLabel(providerId);
}

function isMacosCalendarConnectorConfigured(providerId: CalendarSyncProviderId) {
  if (!["apple-calendar", "system-reminders"].includes(providerId)) return false;
  return MACOS_CONNECTOR_MOCK || (process.platform === "darwin" && MACOS_CONNECTOR_ENABLED);
}

function macosConnectorRecommendation(providerId: CalendarSyncProviderId) {
  if (providerId === "apple-calendar") {
    if (!isMacosCalendarConnectorConfigured(providerId)) {
      return "Set LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR=1 on macOS to enable Apple Calendar read/write checks. Writes still require LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 and explicit consent.";
    }
    if (!EXTERNAL_WRITES_ENABLED) return "Apple Calendar connector is available for permission/read checks. Set LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 only when you are ready for explicit-confirmation writes.";
    return "Apple Calendar connector can execute consented writes. Keep dry-run previews, audit logs, and rollback notes for every operation.";
  }
  if (!isMacosCalendarConnectorConfigured(providerId)) {
    return "Set LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR=1 on macOS to enable system Reminders read/write checks. Writes still require LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 and explicit consent.";
  }
  if (!EXTERNAL_WRITES_ENABLED) return "System Reminders connector is available for permission/read checks. Set LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 only when you are ready for explicit-confirmation writes.";
  return "System Reminders connector can execute consented creates/completions. Keep dry-run previews, audit logs, and rollback notes for every operation.";
}

function providerStatuses(hasIcsDirectory: boolean): CalendarSyncPreview["providers"] {
  const appleConfigured = isMacosCalendarConnectorConfigured("apple-calendar");
  const googleConfigured = isGoogleCalendarConnectorConfigured();
  const remindersConfigured = isMacosCalendarConnectorConfigured("system-reminders");
  const appleWriteSupported = appleConfigured && EXTERNAL_WRITES_ENABLED;
  const googleWriteSupported = googleConfigured && EXTERNAL_WRITES_ENABLED;
  const remindersWriteSupported = remindersConfigured && EXTERNAL_WRITES_ENABLED;
  return [
    {
      id: "ics-local",
      label: providerLabel("ics-local"),
      configured: hasIcsDirectory,
      readSupported: hasIcsDirectory,
      writeSupported: false,
      requiresPermission: false,
      status: hasIcsDirectory ? "ready-readonly" : "not-configured",
      recommendations: hasIcsDirectory
        ? ["Local .ics files are used as read-only memory. Write-back is intentionally blocked."]
        : ["Set LIFEOS_CALENDAR_ICS_DIR or place .ics files under the vault calendar folder to enable read-only calendar memory."],
    },
    {
      id: "apple-calendar",
      label: providerLabel("apple-calendar"),
      configured: appleConfigured,
      readSupported: appleConfigured,
      writeSupported: appleWriteSupported,
      requiresPermission: true,
      status: appleConfigured ? "ready-write-gated" : process.platform === "darwin" ? "permission-needed" : "future-connector",
      recommendations: [macosConnectorRecommendation("apple-calendar")],
    },
    {
      id: "google-calendar",
      label: providerLabel("google-calendar"),
      configured: googleConfigured,
      readSupported: googleConfigured,
      writeSupported: googleWriteSupported,
      requiresPermission: true,
      status: googleConfigured ? "ready-write-gated" : "not-configured",
      recommendations: [googleCalendarRecommendation()],
    },
    {
      id: "system-reminders",
      label: providerLabel("system-reminders"),
      configured: remindersConfigured,
      readSupported: remindersConfigured,
      writeSupported: remindersWriteSupported,
      requiresPermission: true,
      status: remindersConfigured ? "ready-write-gated" : process.platform === "darwin" ? "permission-needed" : "future-connector",
      recommendations: [macosConnectorRecommendation("system-reminders")],
    },
  ];
}

function operationId(index: number, providerId: CalendarSyncProviderId, action: CalendarSyncOperationAction) {
  return `${providerId}:${action}:${index + 1}`;
}

function normalizeProposedItems(items: unknown): CalendarSyncProposedItem[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, MAX_PROPOSED_ITEMS).map((item) => item && typeof item === "object" ? item as CalendarSyncProposedItem : {});
}

function syncTitleKey(title: unknown) {
  return compact(title).toLowerCase();
}

function syncTimeKey(value: unknown) {
  const text = compact(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 16);
  return date.toISOString().slice(0, 16);
}

function syncIdentity(providerId: CalendarSyncProviderId, kind: CalendarSyncItemKind, title: unknown, scheduledAt?: unknown) {
  return [providerId, kind, syncTitleKey(title), syncTimeKey(scheduledAt)].join("|");
}

function buildCalendarSyncPlan(
  operations: CalendarSyncPreviewOperation[],
  externalItems: ExternalConnectorReadItem[],
): CalendarSyncPlan {
  const usedExternalSources = new Set<string>();
  const externalById = new Map<string, ExternalConnectorReadItem>();
  const externalByIdentity = new Map<string, ExternalConnectorReadItem>();
  for (const item of externalItems) {
    if (item.externalId) externalById.set(`${item.providerId}|${item.kind}|${item.externalId}`, item);
    externalByIdentity.set(syncIdentity(item.providerId, item.kind, item.title, item.scheduledAt), item);
  }

  const planItems: CalendarSyncPlanItem[] = [];
  for (const operation of operations.filter((candidate) => candidate.action !== "read-only-import")) {
    const exactMatch = operation.externalId ? externalById.get(`${operation.providerId}|${operation.kind}|${operation.externalId}`) : undefined;
    const duplicateMatch = operation.action === "create"
      ? externalByIdentity.get(syncIdentity(operation.providerId, operation.kind, operation.title, operation.scheduledAt))
      : undefined;
    const matchedExternal = exactMatch || duplicateMatch;
    if (matchedExternal) usedExternalSources.add(matchedExternal.source);

    if (operation.status === "blocked") {
      planItems.push({
        id: `blocked:${operation.id}`,
        direction: "blocked",
        providerId: operation.providerId,
        kind: operation.kind,
        title: operation.title,
        scheduledAt: operation.scheduledAt,
        externalId: operation.externalId,
        operationId: operation.id,
        localSource: operation.source,
        externalSource: matchedExternal?.source,
        reason: operation.reason,
        risk: operation.risk,
      });
      continue;
    }

    if (duplicateMatch) {
      planItems.push({
        id: `conflict:${operation.id}`,
        direction: "review-conflict",
        providerId: operation.providerId,
        kind: operation.kind,
        title: operation.title,
        scheduledAt: operation.scheduledAt,
        externalId: duplicateMatch.externalId,
        operationId: operation.id,
        localSource: operation.source,
        externalSource: duplicateMatch.source,
        reason: "A matching external item already exists. Review before creating another calendar/task item.",
        risk: "high",
      });
      continue;
    }

    planItems.push({
      id: `push:${operation.id}`,
      direction: "push-local",
      providerId: operation.providerId,
      kind: operation.kind,
      title: operation.title,
      scheduledAt: operation.scheduledAt,
      externalId: operation.externalId || exactMatch?.externalId,
      operationId: operation.id,
      localSource: operation.source,
      externalSource: exactMatch?.source,
      reason: exactMatch
        ? "Existing external item can be updated after explicit consent and audit logging."
        : "Local proposal can be pushed to the external connector after explicit consent and audit logging.",
      risk: operation.risk,
    });
  }

  for (const item of externalItems) {
    if (usedExternalSources.has(item.source)) continue;
    planItems.push({
      id: `pull:${item.source}`,
      direction: "pull-external",
      providerId: item.providerId,
      kind: item.kind,
      title: item.title,
      scheduledAt: item.scheduledAt,
      externalId: item.externalId,
      externalSource: item.source,
      reason: "External item is available as read-only LifeOS memory and can be reviewed before any write-back.",
      risk: "low",
    });
  }

  const pullExternal = planItems.filter((item) => item.direction === "pull-external").length;
  const pushLocal = planItems.filter((item) => item.direction === "push-local").length;
  const reviewConflicts = planItems.filter((item) => item.direction === "review-conflict").length;
  const blocked = planItems.filter((item) => item.direction === "blocked").length;
  return {
    generatedFrom: "preview",
    canProceedAfterConsent: pushLocal > 0 && reviewConflicts === 0 && blocked === 0,
    requiresManualReview: pushLocal > 0 || reviewConflicts > 0 || blocked > 0,
    pullExternal,
    pushLocal,
    reviewConflicts,
    blocked,
    items: planItems,
  };
}

function validateExternalOperation(input: CalendarSyncExecuteInput) {
  const providerId: CalendarSyncProviderId | undefined = input.providerId === "system-reminders" ? "system-reminders" : input.providerId === "apple-calendar" ? "apple-calendar" : undefined;
  if (!providerId) throw new Error("Only Apple Calendar and system Reminders can be executed by the macOS connector");
  const kind: CalendarSyncItemKind = input.kind === "task" || providerId === "system-reminders" ? "task" : "event";
  const action: Exclude<CalendarSyncOperationAction, "read-only-import"> = input.action && ["create", "update", "complete", "delete"].includes(input.action) ? input.action : "create";
  const title = compact(input.title, kind === "task" ? "Untitled task" : "Untitled event");
  const externalId = compact(input.externalId || "");
  if (!title) throw new Error("A title is required");
  if (providerId === "apple-calendar" && action === "complete") throw new Error("Apple Calendar events cannot use the complete action");
  if (["update", "complete", "delete"].includes(action) && !externalId) throw new Error("externalId is required for update, complete, and delete operations");
  if (!isMacosCalendarConnectorConfigured(providerId)) throw new Error("macOS calendar/reminders connector is not configured");
  if (!EXTERNAL_WRITES_ENABLED) throw new Error("External calendar writes are disabled. Set LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 to enable consented writes.");
  if (input.explicitConsent !== true || input.confirmationText !== "WRITE TO EXTERNAL CALENDAR") {
    throw new Error("Explicit confirmation is required before writing to Apple Calendar or system Reminders");
  }
  return { providerId, kind, action, title };
}

function runOsascript(script: string) {
  const result = spawnSync("osascript", ["-l", "JavaScript", "-e", script], {
    encoding: "utf8",
    timeout: MACOS_CONNECTOR_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(compact(result.stderr || result.stdout || "macOS automation failed", "macOS automation failed"));
  return String(result.stdout || "").trim();
}

function jxaString(value: unknown) {
  return JSON.stringify(String(value || ""));
}

function parseJsonOutput<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseMacosOperationResult(raw: string, fallbackExternalId: string): MacosOperationExecution {
  const parsed = parseJsonOutput<Record<string, unknown> | undefined>(raw, undefined);
  if (parsed && typeof parsed === "object") {
    const externalId = compact(parsed.externalId || fallbackExternalId);
    const previousRecord = parsed.previousState && typeof parsed.previousState === "object" ? parsed.previousState as Record<string, unknown> : undefined;
    const previousState: CalendarSyncPreviousState | undefined = previousRecord ? {
      title: compact(previousRecord.title || "") || undefined,
      scheduledAt: compact(previousRecord.scheduledAt || "") || undefined,
      notes: compact(previousRecord.notes || "") || undefined,
      completed: typeof previousRecord.completed === "boolean" ? previousRecord.completed : undefined,
    } : undefined;
    return { externalId, previousState };
  }
  return { externalId: compact(raw || fallbackExternalId) };
}

function buildRollbackPlan(
  normalized: { providerId: CalendarSyncProviderId; kind?: CalendarSyncItemKind; action: Exclude<CalendarSyncOperationAction, "read-only-import"> },
  execution: MacosOperationExecution,
): CalendarSyncRollbackPlan {
  const label = providerItemLabel(normalized.providerId, normalized.kind);
  if (normalized.action === "create") {
    return {
      available: Boolean(execution.externalId),
      requiresManualReview: false,
      hint: `To roll back this create, delete ${label} item ${execution.externalId} after confirming it is the item LifeOS created.`,
    };
  }
  if (normalized.action === "update") {
    return {
      available: Boolean(execution.previousState),
      requiresManualReview: true,
      hint: execution.previousState
        ? "To roll back this update, review the captured previous state and restore the old title, time, and notes manually or through a future rollback action."
        : "To roll back this update, use the external app history or a calendar/reminders backup; LifeOS could not capture the previous state.",
      previousState: execution.previousState,
    };
  }
  if (normalized.action === "complete") {
    return {
      available: Boolean(execution.previousState),
      requiresManualReview: !execution.previousState,
      hint: execution.previousState
        ? "To roll back this completion, use a guarded update to restore the captured title, time, notes, and completion status."
        : "To roll back this completion, reopen the reminder manually in Reminders.",
      previousState: execution.previousState,
    };
  }
  return {
    available: Boolean(execution.previousState),
    requiresManualReview: true,
    hint: execution.previousState
      ? "This delete cannot be undone automatically yet. Recreate the item from the captured previous state after review."
      : "This delete cannot be undone automatically. Recreate the item manually from your external calendar/reminders backup if needed.",
    previousState: execution.previousState,
  };
}

function normalizeExternalReadItems(providerId: Extract<CalendarSyncProviderId, "apple-calendar" | "system-reminders">, rawItems: unknown): ExternalConnectorReadItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.slice(0, MAX_EXTERNAL_READ_ITEMS).map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const kind: CalendarSyncItemKind = providerId === "system-reminders" ? "task" : "event";
    const scheduledAt = compact(record.scheduledAt || "");
    const externalId = compact(record.externalId || "");
    return {
      providerId,
      kind,
      title: compact(record.title, kind === "task" ? "Untitled reminder" : "Untitled calendar event"),
      scheduledAt: scheduledAt || undefined,
      externalId: externalId || undefined,
      source: `macos:${providerId}:${externalId || index + 1}`,
    };
  });
}

function readMacosConnectorItems(providerId: Extract<CalendarSyncProviderId, "apple-calendar" | "system-reminders">): { items: ExternalConnectorReadItem[]; warning?: string } {
  if (!isMacosCalendarConnectorConfigured(providerId)) return { items: [] };
  if (MACOS_CONNECTOR_MOCK) {
    const mockItems = providerId === "apple-calendar"
      ? [{ title: "Mock Apple Calendar review", scheduledAt: "2026-07-07T09:00:00.000Z", externalId: "mock-apple-event-1" }]
      : [{ title: "Mock Reminders follow-up", scheduledAt: "2026-07-08T12:00:00.000Z", externalId: "mock-reminder-1" }];
    return { items: normalizeExternalReadItems(providerId, mockItems) };
  }
  try {
    const script = providerId === "apple-calendar"
      ? `
        const Calendar = Application('Calendar');
        const now = new Date();
        const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        const output = [];
        const calendars = Calendar.calendars();
        for (let calendarIndex = 0; calendarIndex < calendars.length && output.length < ${MAX_EXTERNAL_READ_ITEMS}; calendarIndex++) {
          const calendar = calendars[calendarIndex];
          const events = calendar.events();
          for (let eventIndex = 0; eventIndex < events.length && output.length < ${MAX_EXTERNAL_READ_ITEMS}; eventIndex++) {
            const event = events[eventIndex];
            const start = event.startDate();
            if (!start || start < now || start > horizon) continue;
            output.push({
              title: String(event.summary() || 'Untitled calendar event'),
              scheduledAt: start.toISOString(),
              externalId: String(event.id ? event.id() : event.uid()),
            });
          }
        }
        JSON.stringify(output);
      `
      : `
        const Reminders = Application('Reminders');
        const output = [];
        const lists = Reminders.lists();
        for (let listIndex = 0; listIndex < lists.length && output.length < ${MAX_EXTERNAL_READ_ITEMS}; listIndex++) {
          const list = lists[listIndex];
          const reminders = list.reminders();
          for (let reminderIndex = 0; reminderIndex < reminders.length && output.length < ${MAX_EXTERNAL_READ_ITEMS}; reminderIndex++) {
            const reminder = reminders[reminderIndex];
            if (reminder.completed()) continue;
            const due = reminder.dueDate ? reminder.dueDate() : null;
            output.push({
              title: String(reminder.name() || 'Untitled reminder'),
              scheduledAt: due ? due.toISOString() : '',
              externalId: String(reminder.id()),
            });
          }
        }
        JSON.stringify(output);
      `;
    const raw = runOsascript(script);
    return { items: normalizeExternalReadItems(providerId, parseJsonOutput(raw, [])) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "macOS connector read failed";
    return { items: [], warning: `${providerLabel(providerId)} read preview failed or needs macOS permission: ${compact(message)}` };
  }
}

function loadExternalConnectorReadItems() {
  const warnings: string[] = [];
  const items: ExternalConnectorReadItem[] = [];
  for (const providerId of ["apple-calendar", "system-reminders"] as const) {
    const result = readMacosConnectorItems(providerId);
    items.push(...result.items);
    if (result.warning) warnings.push(result.warning);
  }
  return {
    items: items.slice(0, MAX_EXTERNAL_READ_ITEMS),
    warnings,
  };
}

async function loadExternalConnectorReadItemsAsync(options: { fetchImpl?: typeof fetch } = {}) {
  const base = loadExternalConnectorReadItems();
  const google = await readGoogleCalendarItems(options);
  const googleTasks = await readGoogleTaskItems(options);
  return {
    items: [...base.items, ...google.items, ...googleTasks.items].slice(0, MAX_EXTERNAL_READ_ITEMS),
    warnings: [...base.warnings, ...(google.warning ? [google.warning] : []), ...(googleTasks.warning ? [googleTasks.warning] : [])],
  };
}

function executeMacosOperation(input: CalendarSyncExecuteInput, normalized: ReturnType<typeof validateExternalOperation>): MacosOperationExecution {
  if (MACOS_CONNECTOR_MOCK) {
    return {
      externalId: `mock-${normalized.providerId}-${normalized.action}-${Date.now()}`,
      previousState: ["update", "complete", "delete"].includes(normalized.action) ? {
        title: input.title ? `Previous ${input.title}` : "Previous external item",
        scheduledAt: input.startsAt || input.dueAt,
        notes: "Mock previous state captured before LifeOS wrote to the external system.",
        completed: normalized.action === "complete" ? false : undefined,
      } : undefined,
    };
  }
  const notes = compact(input.notes, "Created by LifeOS AI after explicit admin confirmation.");
  const dateValue = normalized.kind === "task" ? input.dueAt : input.startsAt;
  const listName = compact(input.reminderListName || input.calendarName || "");
  const externalId = compact(input.externalId || "");
  if (normalized.providerId === "apple-calendar") {
    const script = normalized.action === "delete"
      ? `
        const Calendar = Application('Calendar');
        const targetId = ${jxaString(externalId)};
        function findEventById(id) {
          const calendars = Calendar.calendars();
          for (let calendarIndex = 0; calendarIndex < calendars.length; calendarIndex++) {
            const events = calendars[calendarIndex].events();
            for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
              const event = events[eventIndex];
              const eventId = String(event.id ? event.id() : '');
              const eventUid = String(event.uid ? event.uid() : '');
              if (eventId === id || eventUid === id) return event;
            }
          }
          throw new Error('Apple Calendar event was not found');
        }
        const event = findEventById(targetId);
        const start = event.startDate ? event.startDate() : null;
        const previousState = {
          title: String(event.summary() || ''),
          scheduledAt: start ? start.toISOString() : '',
          notes: String(event.description ? event.description() : '')
        };
        event.delete();
        JSON.stringify({ externalId: targetId, previousState });
      `
      : normalized.action === "update"
        ? `
          const Calendar = Application('Calendar');
          const targetId = ${jxaString(externalId)};
          function findEventById(id) {
            const calendars = Calendar.calendars();
            for (let calendarIndex = 0; calendarIndex < calendars.length; calendarIndex++) {
              const events = calendars[calendarIndex].events();
              for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
                const event = events[eventIndex];
                const eventId = String(event.id ? event.id() : '');
                const eventUid = String(event.uid ? event.uid() : '');
                if (eventId === id || eventUid === id) return event;
              }
            }
            throw new Error('Apple Calendar event was not found');
          }
          const event = findEventById(targetId);
          const previousStart = event.startDate ? event.startDate() : null;
          const previousState = {
            title: String(event.summary() || ''),
            scheduledAt: previousStart ? previousStart.toISOString() : '',
            notes: String(event.description ? event.description() : '')
          };
          event.summary = ${jxaString(normalized.title)};
          const startText = ${jxaString(dateValue || "")};
          if (startText) {
            const start = new Date(startText);
            event.startDate = start;
            event.endDate = new Date(start.getTime() + 30 * 60 * 1000);
          }
          event.description = ${jxaString(notes)};
          JSON.stringify({ externalId: targetId, previousState });
        `
        : `
          const Calendar = Application('Calendar');
          Calendar.includeStandardAdditions = true;
          const calendars = Calendar.calendars();
          const calendarName = ${jxaString(listName)};
          const target = calendarName ? calendars.find(c => c.name() === calendarName) : calendars[0];
          if (!target) throw new Error('No Apple Calendar calendar is available');
          const start = new Date(${jxaString(dateValue || new Date().toISOString())});
          const end = new Date(start.getTime() + 30 * 60 * 1000);
          const event = Calendar.Event({ summary: ${jxaString(normalized.title)}, startDate: start, endDate: end, description: ${jxaString(notes)} });
          target.events.push(event);
          JSON.stringify({ externalId: String(event.id()) });
        `;
    return parseMacosOperationResult(runOsascript(script), `apple-calendar-${Date.now()}`);
  }
  if (normalized.providerId === "system-reminders") {
    const script = normalized.action === "delete"
      ? `
        const Reminders = Application('Reminders');
        const targetId = ${jxaString(externalId)};
        function findReminderById(id) {
          const lists = Reminders.lists();
          for (let listIndex = 0; listIndex < lists.length; listIndex++) {
            const reminders = lists[listIndex].reminders();
            for (let reminderIndex = 0; reminderIndex < reminders.length; reminderIndex++) {
              const reminder = reminders[reminderIndex];
              if (String(reminder.id()) === id) return reminder;
            }
          }
          throw new Error('Reminder was not found');
        }
        const reminder = findReminderById(targetId);
        const due = reminder.dueDate ? reminder.dueDate() : null;
        const previousState = {
          title: String(reminder.name() || ''),
          scheduledAt: due ? due.toISOString() : '',
          notes: String(reminder.body ? reminder.body() : ''),
          completed: Boolean(reminder.completed())
        };
        reminder.delete();
        JSON.stringify({ externalId: targetId, previousState });
      `
      : normalized.action === "update"
        ? `
          const Reminders = Application('Reminders');
          const targetId = ${jxaString(externalId)};
          function findReminderById(id) {
            const lists = Reminders.lists();
            for (let listIndex = 0; listIndex < lists.length; listIndex++) {
              const reminders = lists[listIndex].reminders();
              for (let reminderIndex = 0; reminderIndex < reminders.length; reminderIndex++) {
                const reminder = reminders[reminderIndex];
                if (String(reminder.id()) === id) return reminder;
              }
            }
            throw new Error('Reminder was not found');
          }
          const reminder = findReminderById(targetId);
          const dueBefore = reminder.dueDate ? reminder.dueDate() : null;
          const previousState = {
            title: String(reminder.name() || ''),
            scheduledAt: dueBefore ? dueBefore.toISOString() : '',
            notes: String(reminder.body ? reminder.body() : ''),
            completed: Boolean(reminder.completed())
          };
          reminder.name = ${jxaString(normalized.title)};
          reminder.body = ${jxaString(notes)};
          const due = ${jxaString(dateValue || "")};
          if (due) reminder.dueDate = new Date(due);
          const completedValue = ${typeof input.completed === "boolean" ? JSON.stringify(input.completed) : "null"};
          if (completedValue !== null) reminder.completed = completedValue;
          JSON.stringify({ externalId: targetId, previousState });
        `
        : normalized.action === "complete"
      ? `
        const Reminders = Application('Reminders');
        const targetId = ${jxaString(externalId)};
        if (!targetId) throw new Error('externalId is required to complete a reminder');
        function findReminderById(id) {
          const lists = Reminders.lists();
          for (let listIndex = 0; listIndex < lists.length; listIndex++) {
            const reminders = lists[listIndex].reminders();
            for (let reminderIndex = 0; reminderIndex < reminders.length; reminderIndex++) {
              const reminder = reminders[reminderIndex];
              if (String(reminder.id()) === id) return reminder;
            }
          }
          throw new Error('Reminder was not found');
        }
        const reminder = findReminderById(targetId);
        const dueBefore = reminder.dueDate ? reminder.dueDate() : null;
        const previousState = {
          title: String(reminder.name() || ''),
          scheduledAt: dueBefore ? dueBefore.toISOString() : '',
          notes: String(reminder.body ? reminder.body() : ''),
          completed: Boolean(reminder.completed())
        };
        reminder.completed = true;
        JSON.stringify({ externalId: targetId, previousState });
      `
      : `
        const Reminders = Application('Reminders');
        Reminders.includeStandardAdditions = true;
        const lists = Reminders.lists();
        const listName = ${jxaString(listName)};
        const target = listName ? lists.find(l => l.name() === listName) : lists[0];
        if (!target) throw new Error('No Reminders list is available');
        const reminder = Reminders.Reminder({ name: ${jxaString(normalized.title)}, body: ${jxaString(notes)} });
        const due = ${jxaString(dateValue || "")};
        if (due) reminder.dueDate = new Date(due);
        target.reminders.push(reminder);
        JSON.stringify({ externalId: String(reminder.id()) });
      `;
    return parseMacosOperationResult(runOsascript(script), `system-reminders-${Date.now()}`);
  }
  throw new Error("Unsupported macOS calendar operation");
}

function buildCalendarSyncPreviewWithExternalRead(
  input: { proposedItems?: unknown } = {},
  externalReadPreview: { items: ExternalConnectorReadItem[]; warnings: string[] },
): CalendarSyncPreview {
  const hasIcsDirectory = fs.existsSync(CALENDAR_ICS_DIR);
  const providers = providerStatuses(hasIcsDirectory);
  const externalWritesEnabled = EXTERNAL_WRITES_ENABLED && providers.some((provider) => provider.writeSupported);
  const operations: CalendarSyncPreviewOperation[] = [];
  const icsItems = hasIcsDirectory ? loadIcsItems() : [];

  icsItems.forEach((item, index) => {
    operations.push({
      id: operationId(index, "ics-local", "read-only-import"),
      providerId: "ics-local",
      providerLabel: providerLabel("ics-local"),
      kind: item.kind,
      action: "read-only-import",
      status: "ready",
      title: item.title,
      scheduledAt: item.scheduledAt,
      source: `ics:${item.relativePath}`,
      writesExternalSystem: false,
      risk: "low",
      reason: "Read-only local .ics memory item. LifeOS will not modify this file.",
    });
  });

  externalReadPreview.items.forEach((item, index) => {
    operations.push({
      id: operationId(icsItems.length + index, item.providerId, "read-only-import"),
      providerId: item.providerId,
      providerLabel: providerLabel(item.providerId),
      kind: item.kind,
      action: "read-only-import",
      status: "ready",
      title: item.title,
      scheduledAt: item.scheduledAt,
      externalId: item.externalId,
      source: item.source,
      writesExternalSystem: false,
      risk: "low",
      reason: "Read-only macOS connector preview. LifeOS will not modify this external item unless a separate write operation is explicitly confirmed and audited.",
    });
  });

  normalizeProposedItems(input.proposedItems).forEach((item, index) => {
    const providerId = item.providerId && providerStatuses(true).some((provider) => provider.id === item.providerId)
      ? item.providerId
      : "apple-calendar";
    const action = item.action && ["create", "update", "complete", "delete"].includes(item.action) ? item.action : "create";
    const kind = item.kind === "task" ? "task" : "event";
    const scheduledAt = compact(item.startsAt || item.dueAt);
    const externalId = compact(item.externalId || "");
    const provider = providers.find((candidate) => candidate.id === providerId);
    const unsupportedGoogleOperation = providerId === "google-calendar" && action === "complete" && kind !== "task";
    const canWrite = Boolean(provider?.writeSupported && externalWritesEnabled && !unsupportedGoogleOperation);
    operations.push({
      id: operationId(icsItems.length + externalReadPreview.items.length + index, providerId, action),
      providerId,
      providerLabel: providerLabel(providerId),
      kind,
      action,
      status: canWrite ? "needs-review" : "blocked",
      title: compact(item.title, kind === "task" ? "Untitled proposed task" : "Untitled proposed event"),
      scheduledAt: scheduledAt || undefined,
      externalId: externalId || undefined,
      source: compact(item.source, "admin-sync-preview"),
      writesExternalSystem: canWrite,
      risk: action === "delete" || action === "complete" ? "high" : "medium",
      reason: canWrite
        ? "Connector is enabled, but the operation still requires explicit consent, audit logging, and a rollback note before execution."
        : unsupportedGoogleOperation
          ? "Google Calendar events cannot use the complete action. Use kind=task to route this through the guarded Google Tasks connector."
        : "External write-back is not shipped yet for this provider or is disabled. This operation is preview-only and must wait for connector auth, explicit consent, audit logging, and rollback planning.",
    });
  });

  const readOnlyItems = operations.filter((operation) => operation.action === "read-only-import").length;
  const syncPlan = buildCalendarSyncPlan(operations, externalReadPreview.items);
  const externalReadItems = externalReadPreview.items.length;
  const blockedWrites = operations.filter((operation) => operation.status === "blocked").length;
  const providersReadyForWrite = providers.filter((provider) => provider.writeSupported).length;
  const warnings = [
    externalWritesEnabled
      ? "External calendar/task writes are enabled only for explicitly consented admin operations. Google Calendar events and Google Tasks use narrow connector paths."
      : "No Apple Calendar, Google Calendar, or system reminders write-back will run unless a connector and external-write opt-in are enabled.",
    "Any future connector must use this dry-run preview before changing external calendars or tasks.",
  ];
  if (!hasIcsDirectory) warnings.unshift("No local .ics directory was found, so calendar memory is not active.");
  warnings.push(...externalReadPreview.warnings);

  return {
    generatedAt: new Date().toISOString(),
    mode: externalWritesEnabled ? "connector-ready" : "preview-only",
    externalWritesEnabled,
    writeBackSupported: externalWritesEnabled,
    providers,
    operations,
    syncPlan,
    safety: {
      dryRunOnly: !externalWritesEnabled,
      requiresExplicitConsentBeforeWrite: true,
      requiresConnectorAuthBeforeWrite: true,
      requiresAuditLogBeforeWrite: true,
      requiresRollbackPlanBeforeWrite: true,
    },
    summary: {
      readOnlyItems,
      externalReadItems,
      externalReadErrors: externalReadPreview.warnings.length,
      blockedWrites,
      syncConflicts: syncPlan.reviewConflicts,
      providersReadyForRead: providers.filter((provider) => provider.readSupported).length,
      providersReadyForWrite,
      warnings,
    },
    recommendations: [
      "Keep .ics ingestion read-only; use macOS connector writes only after authorization, dry-run preview, explicit consent, audit logging, and rollback notes.",
      "Use proposedItems to preview future create/update/complete/delete operations without writing to external systems.",
      "Do not advertise full two-way calendar/task sync until Apple, Google, and reminders connectors pass real account tests.",
    ],
  };
}

export function buildCalendarSyncPreview(input: { proposedItems?: unknown } = {}): CalendarSyncPreview {
  return buildCalendarSyncPreviewWithExternalRead(input, loadExternalConnectorReadItems());
}

export async function buildCalendarSyncPreviewAsync(input: { proposedItems?: unknown } = {}, options: { fetchImpl?: typeof fetch } = {}): Promise<CalendarSyncPreview> {
  return buildCalendarSyncPreviewWithExternalRead(input, await loadExternalConnectorReadItemsAsync(options));
}

export function executeCalendarSyncOperation(input: CalendarSyncExecuteInput): CalendarSyncExecutionResult {
  const normalized = validateExternalOperation(input);
  const execution = executeMacosOperation(input, normalized);
  return {
    ok: true,
    dryRun: false,
    providerId: normalized.providerId,
    action: normalized.action,
    kind: normalized.kind,
    title: normalized.title,
    externalId: execution.externalId,
    executedAt: new Date().toISOString(),
    message: `${providerLabel(normalized.providerId)} ${normalized.action} completed after explicit confirmation.`,
    rollbackPlan: buildRollbackPlan(normalized, execution),
    auditSummary: {
      connector: "macos-automation",
      consent: true,
      writesExternalSystem: true,
    },
  };
}

export async function executeCalendarSyncOperationAsync(input: CalendarSyncExecuteInput, options: { fetchImpl?: typeof fetch } = {}): Promise<CalendarSyncExecutionResult> {
  if (input.providerId !== "google-calendar") return executeCalendarSyncOperation(input);
  if (input.action === "complete" && input.kind !== "task") {
    throw new Error("Google Calendar events cannot use the complete action. Set kind=task to route this through the guarded Google Tasks connector.");
  }
  if (input.kind === "task" || input.action === "complete") {
    const normalized = validateGoogleTaskOperation(input);
    const execution = await executeGoogleTaskOperation(input, options);
    return {
      ok: true,
      dryRun: false,
      providerId: normalized.providerId,
      action: normalized.action,
      kind: normalized.kind,
      title: normalized.title,
      externalId: execution.externalId,
      executedAt: new Date().toISOString(),
      message: `${providerItemLabel(normalized.providerId, normalized.kind)} ${normalized.action} completed after explicit confirmation.`,
      rollbackPlan: buildRollbackPlan(normalized, execution),
      auditSummary: {
        connector: "google-tasks-api",
        consent: true,
        writesExternalSystem: true,
      },
    };
  }
  const normalized = validateGoogleCalendarOperation(input);
  const execution = await executeGoogleCalendarOperation(input, options);
  return {
    ok: true,
    dryRun: false,
    providerId: normalized.providerId,
    action: normalized.action,
    kind: normalized.kind,
    title: normalized.title,
    externalId: execution.externalId,
    executedAt: new Date().toISOString(),
    message: `${providerItemLabel(normalized.providerId, normalized.kind)} ${normalized.action} completed after explicit confirmation.`,
    rollbackPlan: buildRollbackPlan(normalized, execution),
    auditSummary: {
      connector: "google-calendar-api",
      consent: true,
      writesExternalSystem: true,
    },
  };
}
