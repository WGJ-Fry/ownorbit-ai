import { getClientState, setClientState } from "./clientState";
import { buildCalendarSyncPreview, type CalendarSyncPreview } from "./calendarSyncPreview";
import { listCalendarSyncOperations, type CalendarSyncHistoryRecord } from "./calendarSyncHistory";
import { listCalendarSyncRuns, type CalendarSyncRunRecord } from "./calendarSyncRuns";

export const CALENDAR_SYNC_READINESS_STATE_KEY = "lifeos_calendar_sync_readiness_profile";

export type CalendarSyncReadinessLevel =
  | "blocked"
  | "read-only-memory"
  | "external-read-ready"
  | "guarded-write-ready"
  | "two-way-accepted";

export type CalendarSyncProviderReadiness = {
  id: CalendarSyncPreview["providers"][number]["id"];
  label: string;
  configured: boolean;
  readSupported: boolean;
  writeSupported: boolean;
  status: CalendarSyncPreview["providers"][number]["status"];
  missing: string[];
};

export type CalendarSyncReadinessProfile = {
  generatedAt: string;
  previewGeneratedAt: string;
  level: CalendarSyncReadinessLevel;
  canUseReadOnlyMemory: boolean;
  canReadExternal: boolean;
  canWriteWithConsent: boolean;
  canAdvertiseTwoWaySync: boolean;
  providerReadiness: CalendarSyncProviderReadiness[];
  latestAcceptanceRun?: {
    id: string;
    status: CalendarSyncRunRecord["status"];
    startedAt: number;
    acceptanceReady: boolean;
    missing: string[];
  };
  evidence: {
    externalReadItems: number;
    externalReadErrors: number;
    guardedWriteRecords: number;
    rollbackReadyRecords: number;
    blockedWrites: number;
    syncConflicts: number;
    acceptanceRuns: number;
    completedAcceptanceRuns: number;
  };
  missing: string[];
  recommendations: string[];
};

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function providerMissing(provider: CalendarSyncPreview["providers"][number]) {
  const missing: string[] = [];
  if (!provider.configured) {
    missing.push(provider.id === "ics-local" ? "ics-directory-missing" : "connector-not-configured");
  }
  if (!provider.readSupported) missing.push(provider.requiresPermission ? "permission-or-auth-required" : "read-not-supported");
  if (!provider.writeSupported) {
    missing.push(provider.id === "ics-local" ? "read-only-provider" : "external-write-opt-in-disabled");
  }
  return unique(missing);
}

function latestAcceptanceRun(runs: CalendarSyncRunRecord[]) {
  return runs.find((run) => run.mode === "acceptance");
}

function hasRollbackEvidence(record: CalendarSyncHistoryRecord) {
  return record.status === "rolled_back" || record.rollback.canAutoRollback;
}

function readinessLevel(input: {
  preview: CalendarSyncPreview;
  guardedWriteRecords: number;
  rollbackReadyRecords: number;
  completedAcceptanceRuns: number;
}) {
  if (input.completedAcceptanceRuns > 0 && input.preview.summary.externalReadErrors === 0) return "two-way-accepted";
  if (
    input.preview.externalWritesEnabled &&
    input.preview.writeBackSupported &&
    input.preview.summary.providersReadyForWrite > 0 &&
    input.guardedWriteRecords > 0 &&
    input.rollbackReadyRecords > 0
  ) {
    return "guarded-write-ready";
  }
  if (input.preview.summary.externalReadItems > 0 || input.preview.summary.providersReadyForRead > 1) return "external-read-ready";
  if (input.preview.summary.readOnlyItems > 0 || input.preview.providers.some((provider) => provider.id === "ics-local" && provider.readSupported)) {
    return "read-only-memory";
  }
  return "blocked";
}

function recommendationsFor(level: CalendarSyncReadinessLevel, missing: string[]) {
  if (level === "two-way-accepted") {
    return [
      "Two-way acceptance evidence is complete. Keep using explicit consent, audit logs, rollback records, and periodic real-account checks.",
      "Do not enable unattended background sync until long-running account tests and conflict recovery are also proven.",
    ];
  }
  if (level === "guarded-write-ready") {
    return [
      "Guarded write-back is available only after explicit admin confirmation. Record an acceptance run before describing this as two-way ready.",
      "Verify the external calendar/task app after each write and keep rollback evidence fresh.",
    ];
  }
  if (level === "external-read-ready") {
    return [
      "External read preview is available. Keep write-back disabled until connector auth, external writes, audit logging, and rollback evidence are all ready.",
      "Save an acceptance run after a disposable write and rollback test.",
    ];
  }
  if (level === "read-only-memory") {
    return [
      "Local .ics memory is available as read-only context. Configure Apple Calendar, Google Calendar/Tasks, or system Reminders connectors before external read/write tests.",
      "Keep this feature documented as read-only until external account evidence exists.",
    ];
  }
  return [
    "Calendar/task sync is blocked. Add a local .ics directory or configure an external connector before using it as LifeOS memory.",
    `Missing evidence: ${missing.join(", ") || "unknown"}.`,
  ];
}

export function buildCalendarSyncReadinessProfile(input: {
  preview: CalendarSyncPreview;
  history?: CalendarSyncHistoryRecord[];
  runs?: CalendarSyncRunRecord[];
  generatedAt?: string;
}): CalendarSyncReadinessProfile {
  const history = input.history || [];
  const runs = input.runs || [];
  const guardedWriteRecords = history.filter((record) => record.status === "executed" || record.status === "rolled_back").length;
  const rollbackReadyRecords = history.filter(hasRollbackEvidence).length;
  const acceptanceRuns = runs.filter((run) => run.mode === "acceptance").length;
  const completedAcceptanceRuns = runs.filter((run) => run.mode === "acceptance" && run.status === "completed" && run.summary.twoWayEvidence?.acceptanceReady).length;
  const latestAcceptance = latestAcceptanceRun(runs);
  const providerReadiness = input.preview.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: provider.configured,
    readSupported: provider.readSupported,
    writeSupported: provider.writeSupported,
    status: provider.status,
    missing: providerMissing(provider),
  }));
  const level = readinessLevel({
    preview: input.preview,
    guardedWriteRecords,
    rollbackReadyRecords,
    completedAcceptanceRuns,
  });

  const missing = unique([
    input.preview.summary.externalReadErrors > 0 ? "external-read-errors" : "",
    input.preview.summary.providersReadyForRead === 0 ? "read-connector-not-ready" : "",
    input.preview.externalWritesEnabled ? "" : "external-write-opt-in-disabled",
    input.preview.writeBackSupported ? "" : "write-back-not-supported",
    guardedWriteRecords > 0 ? "" : "external-write-history",
    rollbackReadyRecords > 0 ? "" : "rollback-evidence",
    input.preview.summary.syncConflicts > 0 ? "sync-conflicts" : "",
    input.preview.summary.blockedWrites > 0 ? "blocked-write-proposals" : "",
    completedAcceptanceRuns > 0 ? "" : "two-way-acceptance-run",
    ...(latestAcceptance?.summary.twoWayEvidence?.missing || []).map((item) => `acceptance:${item}`),
  ]);

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    previewGeneratedAt: input.preview.generatedAt,
    level,
    canUseReadOnlyMemory: level !== "blocked",
    canReadExternal: ["external-read-ready", "guarded-write-ready", "two-way-accepted"].includes(level),
    canWriteWithConsent: ["guarded-write-ready", "two-way-accepted"].includes(level),
    canAdvertiseTwoWaySync: level === "two-way-accepted",
    providerReadiness,
    latestAcceptanceRun: latestAcceptance
      ? {
        id: latestAcceptance.id,
        status: latestAcceptance.status,
        startedAt: latestAcceptance.startedAt,
        acceptanceReady: Boolean(latestAcceptance.summary.twoWayEvidence?.acceptanceReady),
        missing: latestAcceptance.summary.twoWayEvidence?.missing || [],
      }
      : undefined,
    evidence: {
      externalReadItems: input.preview.summary.externalReadItems,
      externalReadErrors: input.preview.summary.externalReadErrors,
      guardedWriteRecords,
      rollbackReadyRecords,
      blockedWrites: input.preview.summary.blockedWrites,
      syncConflicts: input.preview.summary.syncConflicts,
      acceptanceRuns,
      completedAcceptanceRuns,
    },
    missing,
    recommendations: recommendationsFor(level, missing),
  };
}

export function saveCalendarSyncReadinessProfile(
  profile: CalendarSyncReadinessProfile,
  actor: { type: string; id: string } = { type: "system", id: "calendar-sync-readiness" },
) {
  setClientState(CALENDAR_SYNC_READINESS_STATE_KEY, profile, actor);
  return profile;
}

function safeCalendarSyncOperations() {
  try {
    return listCalendarSyncOperations();
  } catch {
    return [];
  }
}

function safeCalendarSyncRuns() {
  try {
    return listCalendarSyncRuns();
  } catch {
    return [];
  }
}

export function refreshCalendarSyncReadinessProfile(
  actor: { type: string; id: string } = { type: "system", id: "calendar-sync-readiness" },
  input: Partial<Parameters<typeof buildCalendarSyncReadinessProfile>[0]> = {},
) {
  return saveCalendarSyncReadinessProfile(buildCalendarSyncReadinessProfile({
    preview: input.preview || buildCalendarSyncPreview(),
    history: input.history || safeCalendarSyncOperations(),
    runs: input.runs || safeCalendarSyncRuns(),
    generatedAt: input.generatedAt,
  }), actor);
}

export function getCalendarSyncReadinessProfile() {
  const stored = getClientState(CALENDAR_SYNC_READINESS_STATE_KEY)?.value as CalendarSyncReadinessProfile | undefined;
  return stored || refreshCalendarSyncReadinessProfile();
}
