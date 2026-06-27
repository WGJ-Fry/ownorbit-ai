import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const VAULT_DIR = path.resolve(process.env.LIFEOS_VAULT_DIR || "/app/vault");
const CALENDAR_ICS_DIR = path.resolve(process.env.LIFEOS_CALENDAR_ICS_DIR || path.join(VAULT_DIR, "calendar"));
const MAX_PREVIEW_ICS_FILES = Number(process.env.LIFEOS_CALENDAR_PREVIEW_MAX_FILES || 10);
const MAX_PREVIEW_ITEMS = Number(process.env.LIFEOS_CALENDAR_PREVIEW_MAX_ITEMS || 30);
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
  source: string;
  writesExternalSystem: boolean;
  risk: "low" | "medium" | "high";
  reason: string;
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
  safety: {
    dryRunOnly: boolean;
    requiresExplicitConsentBeforeWrite: true;
    requiresConnectorAuthBeforeWrite: true;
    requiresAuditLogBeforeWrite: true;
    requiresRollbackPlanBeforeWrite: true;
  };
  summary: {
    readOnlyItems: number;
    blockedWrites: number;
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
  auditSummary: {
    connector: "macos-automation" | "not-run";
    consent: boolean;
    writesExternalSystem: boolean;
  };
};

type IcsItem = {
  kind: CalendarSyncItemKind;
  title: string;
  scheduledAt?: string;
  relativePath: string;
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
  const remindersConfigured = isMacosCalendarConnectorConfigured("system-reminders");
  const appleWriteSupported = appleConfigured && EXTERNAL_WRITES_ENABLED;
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
      configured: false,
      readSupported: false,
      writeSupported: false,
      requiresPermission: true,
      status: "future-connector",
      recommendations: ["Future connector must use OAuth scopes narrowly and show every create/update/delete operation before syncing."],
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

function validateExternalOperation(input: CalendarSyncExecuteInput) {
  const providerId: CalendarSyncProviderId | undefined = input.providerId === "system-reminders" ? "system-reminders" : input.providerId === "apple-calendar" ? "apple-calendar" : undefined;
  if (!providerId) throw new Error("Only Apple Calendar and system Reminders can be executed by the macOS connector");
  const kind: CalendarSyncItemKind = input.kind === "task" || providerId === "system-reminders" ? "task" : "event";
  const action: Exclude<CalendarSyncOperationAction, "read-only-import"> = input.action && ["create", "update", "complete", "delete"].includes(input.action) ? input.action : "create";
  const title = compact(input.title, kind === "task" ? "Untitled task" : "Untitled event");
  if (!title) throw new Error("A title is required");
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

function executeMacosOperation(input: CalendarSyncExecuteInput, normalized: ReturnType<typeof validateExternalOperation>) {
  if (MACOS_CONNECTOR_MOCK) return `mock-${normalized.providerId}-${normalized.action}-${Date.now()}`;
  const notes = compact(input.notes, "Created by LifeOS AI after explicit admin confirmation.");
  const dateValue = normalized.kind === "task" ? input.dueAt : input.startsAt;
  const listName = compact(input.reminderListName || input.calendarName || "");
  const externalId = compact(input.externalId || "");
  if (normalized.providerId === "apple-calendar") {
    if (normalized.action !== "create") throw new Error("Apple Calendar connector currently supports consented create operations only");
    const script = `
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
      event.uid();
    `;
    return runOsascript(script) || `apple-calendar-${Date.now()}`;
  }
  if (normalized.providerId === "system-reminders") {
    const script = normalized.action === "complete"
      ? `
        const Reminders = Application('Reminders');
        const targetId = ${jxaString(externalId)};
        if (!targetId) throw new Error('externalId is required to complete a reminder');
        const reminder = Reminders.reminders.byId(targetId);
        reminder.completed = true;
        targetId;
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
        reminder.id();
      `;
    return runOsascript(script) || `system-reminders-${Date.now()}`;
  }
  throw new Error("Unsupported macOS calendar operation");
}

export function buildCalendarSyncPreview(input: { proposedItems?: unknown } = {}): CalendarSyncPreview {
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

  normalizeProposedItems(input.proposedItems).forEach((item, index) => {
    const providerId = item.providerId && providerStatuses(true).some((provider) => provider.id === item.providerId)
      ? item.providerId
      : "apple-calendar";
    const action = item.action && ["create", "update", "complete", "delete"].includes(item.action) ? item.action : "create";
    const kind = item.kind === "task" ? "task" : "event";
    const scheduledAt = compact(item.startsAt || item.dueAt);
    const provider = providers.find((candidate) => candidate.id === providerId);
    const canWrite = Boolean(provider?.writeSupported && externalWritesEnabled);
    operations.push({
      id: operationId(icsItems.length + index, providerId, action),
      providerId,
      providerLabel: providerLabel(providerId),
      kind,
      action,
      status: canWrite ? "needs-review" : "blocked",
      title: compact(item.title, kind === "task" ? "Untitled proposed task" : "Untitled proposed event"),
      scheduledAt: scheduledAt || undefined,
      source: compact(item.source, "admin-sync-preview"),
      writesExternalSystem: canWrite,
      risk: action === "delete" || action === "complete" ? "high" : "medium",
      reason: canWrite
        ? "Connector is enabled, but the operation still requires explicit consent, audit logging, and a rollback note before execution."
        : "External write-back is not shipped yet for this provider or is disabled. This operation is preview-only and must wait for connector auth, explicit consent, audit logging, and rollback planning.",
    });
  });

  const readOnlyItems = operations.filter((operation) => operation.action === "read-only-import").length;
  const blockedWrites = operations.filter((operation) => operation.status === "blocked").length;
  const providersReadyForWrite = providers.filter((provider) => provider.writeSupported).length;
  const warnings = [
    externalWritesEnabled
      ? "macOS Apple Calendar/Reminders writes are enabled only for explicitly consented admin operations; Google Calendar remains disabled."
      : "No Apple Calendar, Google Calendar, or system reminders write-back will run unless a connector and external-write opt-in are enabled.",
    "Any future connector must use this dry-run preview before changing external calendars or tasks.",
  ];
  if (!hasIcsDirectory) warnings.unshift("No local .ics directory was found, so calendar memory is not active.");

  return {
    generatedAt: new Date().toISOString(),
    mode: externalWritesEnabled ? "connector-ready" : "preview-only",
    externalWritesEnabled,
    writeBackSupported: externalWritesEnabled,
    providers,
    operations,
    safety: {
      dryRunOnly: !externalWritesEnabled,
      requiresExplicitConsentBeforeWrite: true,
      requiresConnectorAuthBeforeWrite: true,
      requiresAuditLogBeforeWrite: true,
      requiresRollbackPlanBeforeWrite: true,
    },
    summary: {
      readOnlyItems,
      blockedWrites,
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

export function executeCalendarSyncOperation(input: CalendarSyncExecuteInput): CalendarSyncExecutionResult {
  const normalized = validateExternalOperation(input);
  const externalId = executeMacosOperation(input, normalized);
  return {
    ok: true,
    dryRun: false,
    providerId: normalized.providerId,
    action: normalized.action,
    kind: normalized.kind,
    title: normalized.title,
    externalId,
    executedAt: new Date().toISOString(),
    message: `${providerLabel(normalized.providerId)} ${normalized.action} completed after explicit confirmation.`,
    auditSummary: {
      connector: "macos-automation",
      consent: true,
      writesExternalSystem: true,
    },
  };
}
