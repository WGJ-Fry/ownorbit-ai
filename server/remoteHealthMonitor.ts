import { getDesktopRuntimeConfig } from "./desktopRuntimeConfig.ts";
import { maybeStartConfiguredCloudflareTunnel, setCloudflareTunnelReconnectHandler } from "./cloudflareTunnel.ts";
import { maybeStartConfiguredTailscaleServe, testConnectionUrl } from "./networkDiagnostics.ts";
import { getRemoteValidationReport, saveRemoteValidationReport } from "./remoteValidationReport.ts";
import { getClientState, setClientState } from "./clientState.ts";
import { getConfiguredPublicBaseUrl } from "./publicBaseUrl.ts";

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let monitorStartedAt: number | null = null;
let nextRunAt: number | null = null;
let lastRunAt: number | null = null;
const REMOTE_RECOVERY_STATE_KEY = "lifeos_remote_recovery_report";

export type RemoteRecoveryReport = {
  id: string;
  reason: string;
  mode: "cloudflare" | "tailscale" | "configured" | "unknown";
  baseUrl: string;
  restoredBaseUrl: string;
  attempted: boolean;
  restored: boolean;
  started: boolean;
  recoveryReason: string;
  recoveryAction: "none" | "run-remote-health" | "check-tailscale" | "check-cloudflare" | "check-tunnel-target";
  error?: string;
  healthOkBefore: boolean;
  healthOkAfter: boolean;
  createdAt: number;
};

function recoveryAction(input: {
  recovery: Awaited<ReturnType<typeof restoreSavedRemoteEntry>>;
  healthOkAfter: boolean;
}): RemoteRecoveryReport["recoveryAction"] {
  if (input.recovery.restored && input.healthOkAfter) return "run-remote-health";
  if (input.recovery.mode === "tailscale" && (input.recovery.reason === "restore_failed" || !input.recovery.restored)) return "check-tailscale";
  if (input.recovery.mode === "cloudflare" && (input.recovery.reason === "restore_failed" || !input.recovery.restored)) return "check-cloudflare";
  if (input.recovery.attempted && !input.healthOkAfter) return "check-tunnel-target";
  return "none";
}

function intervalMs() {
  const value = Number.parseInt(String(process.env.LIFEOS_REMOTE_HEALTH_INTERVAL_MS || ""), 10);
  if (Number.isFinite(value) && value >= 30_000) return value;
  return 5 * 60 * 1000;
}

function monitorEnabled() {
  return process.env.LIFEOS_REMOTE_HEALTH_MONITOR !== "0";
}

function remoteBaseUrl() {
  const config = getDesktopRuntimeConfig();
  if (!config || !config.publicBaseUrl || config.mode === "local" || config.mode === "lan") return "";
  return config.publicBaseUrl;
}

function configuredRemoteBaseUrl() {
  const runtimeBaseUrl = remoteBaseUrl();
  if (runtimeBaseUrl) return runtimeBaseUrl;
  return getConfiguredPublicBaseUrl();
}

export async function runRemoteHealthCheck(reason = "manual") {
  const baseUrl = configuredRemoteBaseUrl();
  if (!baseUrl) return { skipped: true, reason: "no_remote_entry", report: getRemoteValidationReport() };
  if (running) return { skipped: true, reason: "already_running", report: getRemoteValidationReport() };
  running = true;
  try {
    let recovery: Awaited<ReturnType<typeof restoreSavedRemoteEntry>> = { attempted: false, restored: false, started: false, mode: "unknown", reason: "not_needed" };
    let checkBaseUrl = baseUrl;
    let result = await testConnectionUrl(checkBaseUrl);
    const healthOkBefore = result.ok;
    if (!result.ok) {
      recovery = await restoreSavedRemoteEntry();
      if (recovery.restored) {
        checkBaseUrl = remoteBaseUrl() || baseUrl;
        result = await testConnectionUrl(checkBaseUrl);
      }
    }
    const report = saveRemoteValidationReport({
      label: labelForReason(reason, recovery.restored),
      baseUrl: checkBaseUrl,
      result,
    }, { type: "system", id: "remote-health-monitor" });
    const recoveryReport = saveRemoteRecoveryReport({
      reason,
      baseUrl,
      restoredBaseUrl: checkBaseUrl,
      recovery,
      healthOkBefore,
      healthOkAfter: result.ok,
    });
    return { skipped: false, reason, restored: recovery.restored, recovery: recoveryReport, report };
  } finally {
    lastRunAt = Date.now();
    nextRunAt = monitorTimer ? lastRunAt + intervalMs() : null;
    running = false;
  }
}

function labelForReason(reason: string, restored: boolean) {
  if (restored) return "Remote health check after auto-restore";
  if (reason === "startup") return "Startup remote health check";
  if (reason === "manual") return "Manual remote health check";
  return "Scheduled remote health check";
}

async function restoreSavedRemoteEntry() {
  const config = getDesktopRuntimeConfig();
  if (!config || !config.publicBaseUrl) return { attempted: false, restored: false, started: false, mode: "unknown" as const, reason: "no_saved_remote_entry" };
  try {
    if (config.mode === "cloudflare") {
      const result = await maybeStartConfiguredCloudflareTunnel(String(config.port || process.env.LIFEOS_PORT || process.env.PORT || "3000"), 5000);
      return {
        attempted: true,
        restored: Boolean(result.started || result.reason === "cloudflare_named_configured"),
        started: Boolean(result.started),
        mode: "cloudflare" as const,
        reason: result.reason || "cloudflare_restore_attempted",
      };
    }
    if (config.mode === "tailscale") {
      const result = maybeStartConfiguredTailscaleServe(String(config.port || process.env.LIFEOS_PORT || process.env.PORT || "3000"));
      return {
        attempted: true,
        restored: Boolean(result.started || result.reason === "already_running"),
        started: Boolean(result.started),
        mode: "tailscale" as const,
        reason: result.reason || "tailscale_restore_attempted",
      };
    }
  } catch (error: any) {
    return {
      attempted: true,
      restored: false,
      started: false,
      mode: config.mode === "cloudflare" ? "cloudflare" as const : config.mode === "tailscale" ? "tailscale" as const : "configured" as const,
      reason: "restore_failed",
      error: String(error?.message || error || "Remote restore failed").slice(0, 240),
    };
  }
  return { attempted: false, restored: false, started: false, mode: "configured" as const, reason: "unsupported_remote_mode" };
}

function saveRemoteRecoveryReport(input: {
  reason: string;
  baseUrl: string;
  restoredBaseUrl: string;
  recovery: Awaited<ReturnType<typeof restoreSavedRemoteEntry>>;
  healthOkBefore: boolean;
  healthOkAfter: boolean;
}) {
  const report: RemoteRecoveryReport = {
    id: `remote-recovery-${Date.now()}`,
    reason: input.reason,
    mode: input.recovery.mode,
    baseUrl: input.baseUrl,
    restoredBaseUrl: input.restoredBaseUrl,
    attempted: input.recovery.attempted,
    restored: input.recovery.restored,
    started: input.recovery.started,
    recoveryReason: input.recovery.reason,
    recoveryAction: recoveryAction({ recovery: input.recovery, healthOkAfter: input.healthOkAfter }),
    error: input.recovery.error,
    healthOkBefore: input.healthOkBefore,
    healthOkAfter: input.healthOkAfter,
    createdAt: Date.now(),
  };
  setClientState(REMOTE_RECOVERY_STATE_KEY, report, { type: "system", id: "remote-health-monitor" });
  return report;
}

export function getRemoteRecoveryReport(): RemoteRecoveryReport | null {
  return (getClientState(REMOTE_RECOVERY_STATE_KEY)?.value || null) as RemoteRecoveryReport | null;
}

export function startRemoteHealthMonitor() {
  if (!monitorEnabled()) return;
  if (monitorTimer) return;
  setCloudflareTunnelReconnectHandler(() => {
    runRemoteHealthCheck("cloudflare-reconnect").catch(() => null);
  });
  monitorStartedAt = Date.now();
  nextRunAt = monitorStartedAt + 4000;
  setTimeout(() => {
    runRemoteHealthCheck("startup").catch(() => null);
  }, 4000).unref();
  monitorTimer = setInterval(() => {
    runRemoteHealthCheck("schedule").catch(() => null);
  }, intervalMs());
  monitorTimer.unref();
}

export function getRemoteHealthMonitorStatus() {
  return {
    enabled: monitorEnabled(),
    running: Boolean(monitorTimer),
    inFlight: running,
    intervalMs: intervalMs(),
    startedAt: monitorStartedAt,
    lastRunAt,
    nextRunAt: monitorTimer ? nextRunAt : null,
  };
}
