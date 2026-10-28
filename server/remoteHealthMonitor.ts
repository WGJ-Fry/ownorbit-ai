import { getDesktopRuntimeConfig } from "./desktopRuntimeConfig.ts";
import { maybeBroadcastDeviceEndpointsChange } from "./deviceEndpoints.ts";
import { getManagedCloudflareTunnelStatus, maybeStartConfiguredCloudflareTunnel, setCloudflareTunnelReconnectHandler } from "./cloudflareTunnel.ts";
import { getNetworkDiagnostics, maybeRefreshIcloudHandoff, maybeStartConfiguredTailscaleServe, testConnectionUrl } from "./networkDiagnostics.ts";
import { adoptReleasedRemoteEntry, savedTailscaleEntryAwaitingAdoption } from "./remoteEntryRelease.ts";
import { getRemoteValidationReport, saveRemoteValidationReport, type RemoteValidationReport } from "./remoteValidationReport.ts";
import { getClientState, setClientState } from "./clientState.ts";
import { getConfiguredPublicBaseUrl, normalizePublicBaseUrl } from "./publicBaseUrl.ts";

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let monitorStartedAt: number | null = null;
let nextRunAt: number | null = null;
let lastRunAt: number | null = null;
const REMOTE_RECOVERY_STATE_KEY = "lifeos_remote_recovery_report";
const REMOTE_HEALTH_SAMPLES_STATE_KEY = "lifeos_remote_health_samples";
const MAX_REMOTE_HEALTH_SAMPLES = 48;

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

export type RemoteHealthEvidenceSample = {
  id: string;
  reason: string;
  baseUrl: string;
  ok: boolean;
  passed: number;
  total: number;
  latencyMs: number;
  failedStepIds: string[];
  recoveryAttempted: boolean;
  recoveryRestored: boolean;
  recoveryAction: RemoteRecoveryReport["recoveryAction"];
  createdAt: number;
};

export type RemoteHealthEvidence = {
  total: number;
  passed: number;
  failed: number;
  recoveryAttempts: number;
  recoveryRestored: number;
  latestOk: boolean | null;
  firstCheckedAt: number | null;
  lastCheckedAt: number | null;
  observedMinutes: number;
  consecutiveOk: number;
  consecutiveFailures: number;
  longRunReady: boolean;
  latest: RemoteHealthEvidenceSample[];
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

// A quick tunnel is only ever started by the admin, and it keeps the saved
// stable entry it was started over — usually because that entry is down (say
// Tailscale blocked by a VPN). While it runs it is the live entry: restoring
// the saved one would take the runtime address back to the dead hostname, or
// start a Named Tunnel that hands the quick tunnel off and stops it.
function liveManagedQuickTunnel() {
  const tunnel = getManagedCloudflareTunnelStatus();
  return tunnel.running && tunnel.kind === "quick" ? tunnel : null;
}

// While it runs, the entry worth checking is the one new phones are paired to:
// a live saved Tailscale Serve or Named Tunnel outranks the quick URL, and the
// quick URL is it otherwise. The admin health summary is keyed to the same
// address, so the report it reads is never for a different one.
function liveEntryBaseUrl(readinessBaseUrl: string, quickTunnelUrl: string): string {
  if (/^https:\/\//i.test(readinessBaseUrl)) return readinessBaseUrl;
  return getConfiguredPublicBaseUrl() || quickTunnelUrl;
}

function healthCheckBaseUrl(): string {
  const quickTunnel = liveManagedQuickTunnel();
  if (quickTunnel) return liveEntryBaseUrl(getNetworkDiagnostics().remoteReadiness.baseUrl, quickTunnel.url || "") || configuredRemoteBaseUrl();
  return configuredRemoteBaseUrl();
}

export function remoteHealthSummaryBaseUrl(diagnostics: {
  desktopRuntimeConfig?: { publicBaseUrl?: string } | null;
  remoteReadiness: { baseUrl?: string };
}): string {
  const readinessBaseUrl = diagnostics.remoteReadiness.baseUrl || "";
  const quickTunnel = liveManagedQuickTunnel();
  if (quickTunnel) return liveEntryBaseUrl(readinessBaseUrl, quickTunnel.url || "");
  return diagnostics.desktopRuntimeConfig?.publicBaseUrl || readinessBaseUrl;
}

export async function runRemoteHealthCheck(reason = "manual") {
  const icloudRefresh = safeRefreshIcloudHandoff(`remote-health-${reason}`);
  // Endpoint-set change detection must run even without a configured remote
  // entry — a LAN-only desktop still has addresses that move, and this is its
  // only scheduled observer.
  try {
    maybeBroadcastDeviceEndpointsChange(`remote-health-${reason}`);
  } catch {}
  const baseUrl = healthCheckBaseUrl();
  if (!baseUrl) return { skipped: true, reason: "no_remote_entry", report: getRemoteValidationReport(), icloudRefresh };
  if (running) return { skipped: true, reason: "already_running", report: getRemoteValidationReport() };
  running = true;
  try {
    let recovery: Awaited<ReturnType<typeof restoreSavedRemoteEntry>> = { attempted: false, restored: false, started: false, mode: "unknown", reason: "not_needed" };
    // A quick tunnel stopped while Tailscale was offline left the saved entry
    // without the runtime address. Restore below only follows a failed check,
    // and once Serve is reachable again the check passes, so take the
    // address back first; while Serve is still down this restores nothing.
    if (savedTailscaleEntryAwaitingAdoption(getDesktopRuntimeConfig())) {
      const adoption = await restoreSavedRemoteEntry();
      if (adoption.restored) recovery = adoption;
    }
    let checkBaseUrl = baseUrl;
    let result = await testConnectionUrl(checkBaseUrl);
    const healthOkBefore = result.ok;
    if (!result.ok) {
      recovery = await restoreSavedRemoteEntry(checkBaseUrl);
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
    saveRemoteHealthSample({ reason, report, recovery: recoveryReport });
    // Recovery may have just restarted a tunnel — observe again so the change
    // reaches phones now instead of on the next scheduled cycle.
    try {
      maybeBroadcastDeviceEndpointsChange(`remote-health-${reason}-after-recovery`);
    } catch {}
    const postCheckIcloudRefresh = safeRefreshIcloudHandoff(`remote-health-${reason}-after-check`);
    return { skipped: false, reason, restored: recovery.restored, recovery: recoveryReport, report, icloudRefresh: postCheckIcloudRefresh.refreshed ? postCheckIcloudRefresh : icloudRefresh };
  } finally {
    lastRunAt = Date.now();
    nextRunAt = monitorTimer ? lastRunAt + intervalMs() : null;
    running = false;
  }
}

function safeRefreshIcloudHandoff(reason: string) {
  try {
    return maybeRefreshIcloudHandoff(reason);
  } catch (error: any) {
    return {
      refreshed: false,
      reason: "error",
      requestedReason: reason,
      status: "unknown",
      error: String(error?.message || error || "iCloud handoff refresh failed").slice(0, 240),
    };
  }
}

function labelForReason(reason: string, restored: boolean) {
  if (restored) return "Remote health check after auto-restore";
  if (reason === "startup") return "Startup remote health check";
  if (reason === "manual") return "Manual remote health check";
  return "Scheduled remote health check";
}

function savedEntryMode(config: { mode: string }) {
  return config.mode === "cloudflare" ? "cloudflare" as const : config.mode === "tailscale" ? "tailscale" as const : "configured" as const;
}

// While a quick tunnel runs, the failed check may have been of the quick URL
// itself, of a saved entry that outranks it, or of a live Tailscale Serve
// (MagicDNS names are *.ts.net). The report names that one, so the card does
// not send the admin to fix a Cloudflare tunnel for a Tailscale failure.
function probedEntryMode(probedBaseUrl: string, quickTunnelUrl: string, config: { mode: string; publicBaseUrl: string }) {
  const probed = normalizePublicBaseUrl(probedBaseUrl);
  if (!probed || probed === normalizePublicBaseUrl(quickTunnelUrl)) return "cloudflare" as const;
  if (probed === normalizePublicBaseUrl(config.publicBaseUrl)) return savedEntryMode(config);
  if (new URL(probed).hostname.endsWith(".ts.net")) return "tailscale" as const;
  return "cloudflare" as const;
}

async function restoreSavedRemoteEntry(probedBaseUrl = "") {
  const config = getDesktopRuntimeConfig();
  if (!config || !config.publicBaseUrl) return { attempted: false, restored: false, started: false, mode: "unknown" as const, reason: "no_saved_remote_entry" };
  // Checked again here: a quick tunnel may have started while the probe ran.
  const quickTunnel = liveManagedQuickTunnel();
  if (quickTunnel) {
    return { attempted: false, restored: false, started: false, mode: probedEntryMode(probedBaseUrl, quickTunnel.url || "", config), reason: "quick_tunnel_running" };
  }
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
      const awaitingAdoption = savedTailscaleEntryAwaitingAdoption(config);
      const result = maybeStartConfiguredTailscaleServe(String(config.port || process.env.LIFEOS_PORT || process.env.PORT || "3000"));
      const restored = Boolean(result.started || result.reason === "already_running");
      if (restored && awaitingAdoption) adoptReleasedRemoteEntry(String(process.env.PUBLIC_BASE_URL || ""));
      return {
        attempted: true,
        restored,
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
      mode: savedEntryMode(config),
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

function readRemoteHealthSamples(): RemoteHealthEvidenceSample[] {
  const value = getClientState(REMOTE_HEALTH_SAMPLES_STATE_KEY)?.value;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<RemoteHealthEvidenceSample>;
      const baseUrl = typeof candidate.baseUrl === "string" ? candidate.baseUrl : "";
      const createdAt = typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) ? candidate.createdAt : 0;
      if (!baseUrl || !createdAt) return null;
      return {
        id: typeof candidate.id === "string" ? candidate.id : `remote-health-sample-${createdAt}`,
        reason: typeof candidate.reason === "string" ? candidate.reason.slice(0, 80) : "unknown",
        baseUrl,
        ok: candidate.ok === true,
        passed: Number.isFinite(Number(candidate.passed)) ? Number(candidate.passed) : 0,
        total: Number.isFinite(Number(candidate.total)) ? Number(candidate.total) : 0,
        latencyMs: Number.isFinite(Number(candidate.latencyMs)) ? Number(candidate.latencyMs) : 0,
        failedStepIds: Array.isArray(candidate.failedStepIds) ? candidate.failedStepIds.map(String).slice(0, 8) : [],
        recoveryAttempted: candidate.recoveryAttempted === true,
        recoveryRestored: candidate.recoveryRestored === true,
        recoveryAction: typeof candidate.recoveryAction === "string" ? candidate.recoveryAction as RemoteRecoveryReport["recoveryAction"] : "none",
        createdAt,
      };
    })
    .filter((item): item is RemoteHealthEvidenceSample => Boolean(item))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_REMOTE_HEALTH_SAMPLES);
}

function saveRemoteHealthSample(input: {
  reason: string;
  report: RemoteValidationReport;
  recovery: RemoteRecoveryReport;
}) {
  const sample: RemoteHealthEvidenceSample = {
    id: `remote-health-sample-${Date.now()}`,
    reason: String(input.reason || "manual").slice(0, 80),
    baseUrl: input.report.baseUrl,
    ok: Boolean(input.report.ok),
    passed: input.report.passed,
    total: input.report.total,
    latencyMs: input.report.latencyMs,
    failedStepIds: (input.report.steps || [])
      .filter((step) => !step.ok)
      .map((step) => step.id)
      .slice(0, 8),
    recoveryAttempted: input.recovery.attempted,
    recoveryRestored: input.recovery.restored,
    recoveryAction: input.recovery.recoveryAction,
    createdAt: Date.now(),
  };
  const samples = [...readRemoteHealthSamples(), sample].slice(-MAX_REMOTE_HEALTH_SAMPLES);
  setClientState(REMOTE_HEALTH_SAMPLES_STATE_KEY, samples, { type: "system", id: "remote-health-monitor" });
  return sample;
}

function countTrailing(samples: RemoteHealthEvidenceSample[], ok: boolean) {
  let count = 0;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index].ok !== ok) break;
    count += 1;
  }
  return count;
}

export function getRemoteHealthEvidence(): RemoteHealthEvidence {
  const samples = readRemoteHealthSamples();
  const first = samples[0] || null;
  const latest = samples[samples.length - 1] || null;
  const failed = samples.filter((sample) => !sample.ok).length;
  const observedMinutes = first && latest ? Math.max(0, Math.round((latest.createdAt - first.createdAt) / 60_000)) : 0;
  return {
    total: samples.length,
    passed: samples.length - failed,
    failed,
    recoveryAttempts: samples.filter((sample) => sample.recoveryAttempted).length,
    recoveryRestored: samples.filter((sample) => sample.recoveryRestored).length,
    latestOk: latest ? latest.ok : null,
    firstCheckedAt: first?.createdAt ?? null,
    lastCheckedAt: latest?.createdAt ?? null,
    observedMinutes,
    consecutiveOk: countTrailing(samples, true),
    consecutiveFailures: countTrailing(samples, false),
    longRunReady: samples.length >= 3 && observedMinutes >= 30 && failed === 0,
    latest: samples.slice(-8).reverse(),
  };
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
