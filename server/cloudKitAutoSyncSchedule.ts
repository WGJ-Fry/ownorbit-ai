import { insertAuditLog } from "./audit";
import { getClientState, setClientState } from "./clientState";
import { getIcloudDataSyncReadiness } from "./icloudDataSyncReadiness";
import { getNetworkDiagnostics } from "./networkDiagnostics";
import { runCloudKitSyncCycle, type CloudKitSyncCycleResult } from "./cloudKitSyncCycle";

const CLOUDKIT_AUTO_SYNC_STATE_KEY = "lifeos_cloudkit_auto_sync_schedule";
const DEFAULT_INTERVAL_MINUTES = 120;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const LOCAL_CHANGE_SYNC_DELAY_MS = 60 * 1000;
const safeLocalChangeTypes = new Set(["chat-history", "memory", "tasks", "generated-app-state", "device-trust"]);

let schedulerTimer: NodeJS.Timeout | undefined;
let schedulerStarted = false;
let runInProgress = false;

export type CloudKitAutoSyncSchedule = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: number;
  nextRunAt?: number;
  updatedAt?: number;
  lastResult?: CloudKitAutoSyncLastResult;
  pendingLocalChanges?: CloudKitAutoSyncPendingLocalChanges;
};

export type CloudKitAutoSyncPendingLocalChanges = {
  total: number;
  byType: Record<string, number>;
  firstChangedAt: number;
  lastChangedAt: number;
  nextSuggestedRunAt: number;
  rawPayloadStored: false;
};

export type CloudKitAutoSyncLastResult = {
  ok: boolean;
  status: CloudKitSyncCycleResult["status"] | "skipped" | "already-running" | "failed";
  nextAction: CloudKitSyncCycleResult["nextAction"] | "wait" | "configure-cloudkit" | "retry";
  reason: "scheduled" | "manual" | "not-ready" | "already-running" | "error";
  startedAt: number;
  finishedAt: number;
  readinessStatus?: string;
  dataSyncScope?: string;
  pullStatus?: CloudKitSyncCycleResult["pull"]["status"];
  pullApplied?: number;
  pullConflicts?: number;
  uploadStatus?: NonNullable<CloudKitSyncCycleResult["upload"]>["status"];
  uploadSaved?: number;
  error?: string;
  rawPayloadReturnedToAdmin: false;
  cloudKitChangeTokenReturnedToAdmin: false;
  localBackupPathReturnedToAdmin: false;
};

type RunDependencies = {
  now?: number;
  getReadiness?: typeof getDefaultReadiness;
  runCycle?: typeof runCloudKitSyncCycle;
};

function normalizeIntervalMinutes(value: unknown) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MINUTES;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, parsed));
}

function computeNextRun(now: number, intervalMinutes: number, lastRunAt?: number) {
  return (lastRunAt || now) + intervalMinutes * 60 * 1000;
}

function preferPendingLocalChangeRunAt(nextRunAt: number | undefined, pending?: CloudKitAutoSyncPendingLocalChanges) {
  if (!pending?.nextSuggestedRunAt) return nextRunAt;
  return Math.min(nextRunAt || pending.nextSuggestedRunAt, pending.nextSuggestedRunAt);
}

function normalizeSchedule(value: any): CloudKitAutoSyncSchedule {
  const intervalMinutes = normalizeIntervalMinutes(value?.intervalMinutes);
  const lastRunAt = Number.isFinite(Number(value?.lastRunAt)) ? Number(value.lastRunAt) : undefined;
  const nextRunAt = Number.isFinite(Number(value?.nextRunAt)) ? Number(value.nextRunAt) : undefined;
  const updatedAt = Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : undefined;
  const lastResult = normalizeLastResult(value?.lastResult);
  const pendingLocalChanges = normalizePendingLocalChanges(value?.pendingLocalChanges);
  return {
    enabled: Boolean(value?.enabled),
    intervalMinutes,
    lastRunAt,
    nextRunAt,
    updatedAt,
    lastResult,
    pendingLocalChanges,
  };
}

function normalizePendingLocalChanges(value: any): CloudKitAutoSyncPendingLocalChanges | undefined {
  if (!value || typeof value !== "object") return undefined;
  const firstChangedAt = Number(value.firstChangedAt || 0);
  const lastChangedAt = Number(value.lastChangedAt || 0);
  const nextSuggestedRunAt = Number(value.nextSuggestedRunAt || 0);
  if (!Number.isFinite(firstChangedAt) || !Number.isFinite(lastChangedAt) || !Number.isFinite(nextSuggestedRunAt)) return undefined;
  if (firstChangedAt <= 0 || lastChangedAt <= 0 || nextSuggestedRunAt <= 0) return undefined;
  const byType: Record<string, number> = {};
  for (const [type, count] of Object.entries(value.byType || {})) {
    if (!safeLocalChangeTypes.has(type)) continue;
    const normalizedCount = Number(count || 0);
    if (Number.isFinite(normalizedCount) && normalizedCount > 0) byType[type] = Math.min(100_000, Math.floor(normalizedCount));
  }
  const total = Object.values(byType).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return undefined;
  return {
    total,
    byType,
    firstChangedAt,
    lastChangedAt,
    nextSuggestedRunAt,
    rawPayloadStored: false,
  };
}

function normalizeLastResult(value: any): CloudKitAutoSyncLastResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const startedAt = Number(value.startedAt || 0);
  const finishedAt = Number(value.finishedAt || 0);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || startedAt <= 0 || finishedAt <= 0) return undefined;
  return {
    ok: Boolean(value.ok),
    status: String(value.status || "failed").slice(0, 80) as CloudKitAutoSyncLastResult["status"],
    nextAction: String(value.nextAction || "retry").slice(0, 80) as CloudKitAutoSyncLastResult["nextAction"],
    reason: ["scheduled", "manual", "not-ready", "already-running", "error"].includes(String(value.reason)) ? value.reason : "error",
    startedAt,
    finishedAt,
    readinessStatus: typeof value.readinessStatus === "string" ? value.readinessStatus.slice(0, 120) : undefined,
    dataSyncScope: typeof value.dataSyncScope === "string" ? value.dataSyncScope.slice(0, 120) : undefined,
    pullStatus: typeof value.pullStatus === "string" ? value.pullStatus.slice(0, 80) as CloudKitAutoSyncLastResult["pullStatus"] : undefined,
    pullApplied: Number.isFinite(Number(value.pullApplied)) ? Number(value.pullApplied) : undefined,
    pullConflicts: Number.isFinite(Number(value.pullConflicts)) ? Number(value.pullConflicts) : undefined,
    uploadStatus: typeof value.uploadStatus === "string" ? value.uploadStatus.slice(0, 80) as CloudKitAutoSyncLastResult["uploadStatus"] : undefined,
    uploadSaved: Number.isFinite(Number(value.uploadSaved)) ? Number(value.uploadSaved) : undefined,
    error: typeof value.error === "string" ? value.error.slice(0, 240) : undefined,
    rawPayloadReturnedToAdmin: false,
    cloudKitChangeTokenReturnedToAdmin: false,
    localBackupPathReturnedToAdmin: false,
  };
}

function persistSchedule(schedule: CloudKitAutoSyncSchedule, actor?: { type: string; id: string }) {
  setClientState(CLOUDKIT_AUTO_SYNC_STATE_KEY, schedule, actor);
  return schedule;
}

function publicResultFromCycle(cycle: CloudKitSyncCycleResult, reason: CloudKitAutoSyncLastResult["reason"]): CloudKitAutoSyncLastResult {
  return {
    ok: cycle.ok,
    status: cycle.status,
    nextAction: cycle.nextAction,
    reason,
    startedAt: cycle.startedAt,
    finishedAt: cycle.finishedAt,
    pullStatus: cycle.pull.status,
    pullApplied: cycle.pull.apply.applied,
    pullConflicts: cycle.pull.apply.conflicts,
    uploadStatus: cycle.upload?.status,
    uploadSaved: cycle.upload?.result?.syncExport?.saved || 0,
    rawPayloadReturnedToAdmin: false,
    cloudKitChangeTokenReturnedToAdmin: false,
    localBackupPathReturnedToAdmin: false,
  };
}

function skippedResult(input: {
  reason: CloudKitAutoSyncLastResult["reason"];
  status: CloudKitAutoSyncLastResult["status"];
  nextAction: CloudKitAutoSyncLastResult["nextAction"];
  startedAt: number;
  finishedAt?: number;
  readinessStatus?: string;
  dataSyncScope?: string;
  error?: string;
}): CloudKitAutoSyncLastResult {
  return {
    ok: false,
    status: input.status,
    nextAction: input.nextAction,
    reason: input.reason,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt || Date.now(),
    readinessStatus: input.readinessStatus,
    dataSyncScope: input.dataSyncScope,
    error: input.error,
    rawPayloadReturnedToAdmin: false,
    cloudKitChangeTokenReturnedToAdmin: false,
    localBackupPathReturnedToAdmin: false,
  };
}

function getDefaultReadiness() {
  const diagnostics = getNetworkDiagnostics();
  return getIcloudDataSyncReadiness({ platformSupported: diagnostics.icloud.platformSupported });
}

export function getCloudKitAutoSyncSchedule(): CloudKitAutoSyncSchedule {
  const state = getClientState(CLOUDKIT_AUTO_SYNC_STATE_KEY);
  const schedule = normalizeSchedule(state?.value);
  if (schedule.enabled && !schedule.nextRunAt) {
    schedule.nextRunAt = computeNextRun(Date.now(), schedule.intervalMinutes, schedule.lastRunAt);
  }
  return schedule;
}

export function updateCloudKitAutoSyncSchedule(input: Partial<CloudKitAutoSyncSchedule>, actor?: { type: string; id: string }) {
  const previous = getCloudKitAutoSyncSchedule();
  const now = Date.now();
  const next: CloudKitAutoSyncSchedule = {
    enabled: Boolean(input.enabled ?? previous.enabled),
    intervalMinutes: normalizeIntervalMinutes(input.intervalMinutes ?? previous.intervalMinutes),
    lastRunAt: input.lastRunAt ?? previous.lastRunAt,
    lastResult: input.lastResult ?? previous.lastResult,
    pendingLocalChanges: input.pendingLocalChanges ?? previous.pendingLocalChanges,
    updatedAt: now,
  };
  next.nextRunAt = next.enabled ? preferPendingLocalChangeRunAt(computeNextRun(now, next.intervalMinutes, next.lastRunAt), next.pendingLocalChanges) : undefined;
  persistSchedule(next, actor);
  insertAuditLog("icloud_cloudkit_auto_sync_schedule_updated", "network", "cloudkit-auto-sync", {
    enabled: next.enabled,
    intervalMinutes: next.intervalMinutes,
    nextRunAt: next.nextRunAt || null,
    manualOnlyUntilEnabled: !next.enabled,
  }, actor?.type || "system", actor?.id);
  return next;
}

export function noteCloudKitLocalChange(
  dataType: "chat-history" | "memory" | "tasks" | "generated-app-state" | "device-trust",
  actor?: { type: string; id: string },
  now = Date.now(),
) {
  if (!safeLocalChangeTypes.has(dataType)) return getCloudKitAutoSyncSchedule();
  const previous = getCloudKitAutoSyncSchedule();
  const pending = previous.pendingLocalChanges || {
    total: 0,
    byType: {},
    firstChangedAt: now,
    lastChangedAt: now,
    nextSuggestedRunAt: now + LOCAL_CHANGE_SYNC_DELAY_MS,
    rawPayloadStored: false as const,
  };
  const nextSuggestedRunAt = now + LOCAL_CHANGE_SYNC_DELAY_MS;
  const next: CloudKitAutoSyncSchedule = {
    ...previous,
    pendingLocalChanges: {
      total: Math.min(100_000, pending.total + 1),
      byType: {
        ...pending.byType,
        [dataType]: Math.min(100_000, (pending.byType[dataType] || 0) + 1),
      },
      firstChangedAt: pending.firstChangedAt || now,
      lastChangedAt: now,
      nextSuggestedRunAt,
      rawPayloadStored: false,
    },
    nextRunAt: previous.enabled ? Math.min(previous.nextRunAt || nextSuggestedRunAt, nextSuggestedRunAt) : previous.nextRunAt,
    updatedAt: now,
  };
  persistSchedule(next, actor);
  insertAuditLog("icloud_cloudkit_auto_sync_local_change_noted", "network", "cloudkit-auto-sync", {
    dataType,
    pendingTotal: next.pendingLocalChanges?.total || 0,
    nextSuggestedRunAt,
    nextRunAt: next.nextRunAt || null,
    enabled: next.enabled,
    rawPayloadStored: false,
  }, actor?.type || "system", actor?.id || "cloudkit-auto-sync");
  return next;
}

export async function runCloudKitAutoSyncNow(
  reason: "scheduled" | "manual" = "manual",
  actor?: { type: string; id: string },
  dependencies: RunDependencies = {},
) {
  const schedule = getCloudKitAutoSyncSchedule();
  const startedAt = dependencies.now || Date.now();
  const getReadiness = dependencies.getReadiness || getDefaultReadiness;
  const runCycle = dependencies.runCycle || runCloudKitSyncCycle;

  if (runInProgress) {
    const lastResult = skippedResult({
      reason: "already-running",
      status: "already-running",
      nextAction: "wait",
      startedAt,
    });
    return { skipped: true, reason: "already-running" as const, schedule, lastResult };
  }

  runInProgress = true;
  try {
    const readiness = getReadiness();
    if (!readiness.enabled || !readiness.ready) {
      const lastResult = skippedResult({
        reason: "not-ready",
        status: "skipped",
        nextAction: "configure-cloudkit",
        startedAt,
        readinessStatus: readiness.status,
        dataSyncScope: readiness.dataSyncScope,
      });
      const nextSchedule: CloudKitAutoSyncSchedule = {
        ...schedule,
        lastRunAt: startedAt,
        nextRunAt: schedule.enabled ? computeNextRun(startedAt, schedule.intervalMinutes, startedAt) : undefined,
        updatedAt: startedAt,
        lastResult,
      };
      persistSchedule(nextSchedule, actor || { type: "system", id: "cloudkit-auto-sync" });
      insertAuditLog("icloud_cloudkit_auto_sync_skipped", "network", "cloudkit-auto-sync", {
        reason: "not-ready",
        readinessStatus: readiness.status,
        dataSyncScope: readiness.dataSyncScope,
        nextRunAt: nextSchedule.nextRunAt || null,
        rawPayloadReturnedToAdmin: false,
      }, actor?.type || "system", actor?.id || "cloudkit-auto-sync");
      return { skipped: true, reason: "not-ready" as const, schedule: nextSchedule, lastResult };
    }

    const cycle = await runCycle(readiness, { limit: 100, now: startedAt });
    const lastResult = {
      ...publicResultFromCycle(cycle, reason),
      readinessStatus: readiness.status,
      dataSyncScope: readiness.dataSyncScope,
    };
    const nextSchedule: CloudKitAutoSyncSchedule = {
      ...schedule,
      lastRunAt: startedAt,
      nextRunAt: schedule.enabled ? computeNextRun(startedAt, schedule.intervalMinutes, startedAt) : undefined,
      updatedAt: startedAt,
      lastResult,
      pendingLocalChanges: cycle.ok ? undefined : schedule.pendingLocalChanges,
    };
    persistSchedule(nextSchedule, actor || { type: "system", id: "cloudkit-auto-sync" });
    insertAuditLog("icloud_cloudkit_auto_sync_run", "network", "cloudkit-auto-sync", {
      ok: cycle.ok,
      status: cycle.status,
      nextAction: cycle.nextAction,
      pullStatus: cycle.pull.status,
      pullApplied: cycle.pull.apply.applied,
      pullConflicts: cycle.pull.apply.conflicts,
      uploadStatus: cycle.upload?.status || null,
      uploadSaved: cycle.upload?.result?.syncExport?.saved || 0,
      nextRunAt: nextSchedule.nextRunAt || null,
      rawPayloadReturnedToAdmin: false,
      cloudKitChangeTokenReturnedToAdmin: false,
      localBackupPathReturnedToAdmin: false,
    }, actor?.type || "system", actor?.id || "cloudkit-auto-sync");
    return { skipped: false, reason, schedule: nextSchedule, lastResult, cycle };
  } catch (error: any) {
    const message = String(error?.message || "CloudKit auto sync failed").slice(0, 240);
    const lastResult = skippedResult({
      reason: "error",
      status: "failed",
      nextAction: "retry",
      startedAt,
      error: message,
    });
    const nextSchedule: CloudKitAutoSyncSchedule = {
      ...schedule,
      lastRunAt: startedAt,
      nextRunAt: schedule.enabled ? computeNextRun(startedAt, schedule.intervalMinutes, startedAt) : undefined,
      updatedAt: startedAt,
      lastResult,
    };
    persistSchedule(nextSchedule, actor || { type: "system", id: "cloudkit-auto-sync" });
    insertAuditLog("icloud_cloudkit_auto_sync_failed", "network", "cloudkit-auto-sync", {
      error: message,
      nextRunAt: nextSchedule.nextRunAt || null,
      rawPayloadReturnedToAdmin: false,
      cloudKitChangeTokenReturnedToAdmin: false,
      localBackupPathReturnedToAdmin: false,
    }, actor?.type || "system", actor?.id || "cloudkit-auto-sync");
    return { skipped: false, reason: "error" as const, schedule: nextSchedule, lastResult };
  } finally {
    runInProgress = false;
  }
}

export async function runDueCloudKitAutoSync(now = Date.now(), dependencies: RunDependencies = {}) {
  const schedule = getCloudKitAutoSyncSchedule();
  if (!schedule.enabled || !schedule.nextRunAt || schedule.nextRunAt > now) return null;
  return runCloudKitAutoSyncNow("scheduled", { type: "system", id: "cloudkit-auto-sync" }, { ...dependencies, now });
}

export function startCloudKitAutoSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerTimer = setInterval(() => {
    runDueCloudKitAutoSync().catch((error) => {
      insertAuditLog("icloud_cloudkit_auto_sync_failed", "network", "cloudkit-auto-sync", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 60 * 1000);
  schedulerTimer.unref?.();
}

export function stopCloudKitAutoSyncSchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = undefined;
  schedulerStarted = false;
  runInProgress = false;
}
