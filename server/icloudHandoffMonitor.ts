import { maybeRefreshIcloudHandoff } from "./networkDiagnostics.ts";

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let monitorStartedAt: number | null = null;
let nextRunAt: number | null = null;
let lastRunAt: number | null = null;
let lastResult: IcloudHandoffMonitorRun | null = null;
let startupRunAt: number | null = null;
let startupRunReason: string | null = null;
let startupResult: IcloudHandoffMonitorRun | null = null;

export type IcloudHandoffMonitorRun = {
  reason: string;
  checkedAt: number;
  refreshed: boolean;
  refreshReason: string;
  status: string;
  previousStatus?: string;
  phoneConfirmationStatus?: string;
  phoneConfirmationAction?: string;
  previousPhoneConfirmationStatus?: string;
  pairingSessionStatus?: string;
  pairingSessionAction?: string;
  previousPairingSessionStatus?: string;
  generatedAt?: number;
  recommendedBaseUrl?: string;
  error?: string;
};

function monitorEnabled() {
  return process.env.LIFEOS_ICLOUD_HANDOFF_MONITOR !== "0";
}

function intervalMs() {
  const value = Number.parseInt(String(process.env.LIFEOS_ICLOUD_HANDOFF_MONITOR_INTERVAL_MS || ""), 10);
  if (Number.isFinite(value) && value >= 60_000) return value;
  return 60_000;
}

export function runIcloudHandoffRefreshCheck(reason = "manual"): IcloudHandoffMonitorRun {
  try {
    const refresh = maybeRefreshIcloudHandoff(reason);
    const checkedAt = Date.now();
    lastRunAt = checkedAt;
    lastResult = {
      reason,
      checkedAt,
      refreshed: refresh.refreshed,
      refreshReason: refresh.reason,
      status: refresh.status || refresh.previousStatus || "unknown",
      previousStatus: refresh.previousStatus,
      phoneConfirmationStatus: refresh.phoneConfirmationStatus,
      phoneConfirmationAction: refresh.phoneConfirmationAction,
      previousPhoneConfirmationStatus: refresh.previousPhoneConfirmationStatus,
      pairingSessionStatus: refresh.pairingSessionStatus,
      pairingSessionAction: refresh.pairingSessionAction,
      previousPairingSessionStatus: refresh.previousPairingSessionStatus,
      generatedAt: refresh.generatedAt,
      recommendedBaseUrl: refresh.recommendedBaseUrl,
    };
    nextRunAt = monitorTimer ? checkedAt + intervalMs() : null;
    return lastResult;
  } catch (error: any) {
    const checkedAt = Date.now();
    lastRunAt = checkedAt;
    lastResult = {
      reason,
      checkedAt,
      refreshed: false,
      refreshReason: "error",
      status: "unknown",
      error: String(error?.message || error || "iCloud handoff monitor failed").slice(0, 240),
    };
    nextRunAt = monitorTimer ? checkedAt + intervalMs() : null;
    return lastResult;
  }
}

export function runIcloudHandoffStartupRefresh(reason = "local-core-startup"): IcloudHandoffMonitorRun {
  const result = runIcloudHandoffRefreshCheck(reason);
  startupRunAt = result.checkedAt;
  startupRunReason = reason;
  startupResult = result;
  return result;
}

export function startIcloudHandoffMonitor() {
  if (!monitorEnabled()) return;
  if (monitorTimer) return;
  monitorStartedAt = Date.now();
  nextRunAt = monitorStartedAt + intervalMs();
  monitorTimer = setInterval(() => {
    runIcloudHandoffRefreshCheck("icloud-monitor-schedule");
  }, intervalMs());
  monitorTimer.unref();
}

export function getIcloudHandoffMonitorStatus() {
  return {
    enabled: monitorEnabled(),
    running: Boolean(monitorTimer),
    intervalMs: intervalMs(),
    startedAt: monitorStartedAt,
    lastRunAt,
    nextRunAt: monitorTimer ? nextRunAt : null,
    startupRunAt,
    startupRunReason,
    startupResult,
    lastResult,
  };
}
