import { getDesktopRuntimeConfig } from "./desktopRuntimeConfig.ts";
import { testConnectionUrl } from "./networkDiagnostics.ts";
import { getRemoteValidationReport, saveRemoteValidationReport } from "./remoteValidationReport.ts";

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function intervalMs() {
  const value = Number.parseInt(String(process.env.LIFEOS_REMOTE_HEALTH_INTERVAL_MS || ""), 10);
  if (Number.isFinite(value) && value >= 30_000) return value;
  return 5 * 60 * 1000;
}

function remoteBaseUrl() {
  const config = getDesktopRuntimeConfig();
  if (!config || !config.publicBaseUrl || config.mode === "local" || config.mode === "lan") return "";
  return config.publicBaseUrl;
}

export async function runRemoteHealthCheck(reason = "manual") {
  const baseUrl = remoteBaseUrl();
  if (!baseUrl) return { skipped: true, reason: "no_remote_entry", report: getRemoteValidationReport() };
  if (running) return { skipped: true, reason: "already_running", report: getRemoteValidationReport() };
  running = true;
  try {
    const result = await testConnectionUrl(baseUrl);
    const report = saveRemoteValidationReport({
      label: reason === "startup" ? "Startup remote health check" : "Scheduled remote health check",
      baseUrl,
      result,
    }, { type: "system", id: "remote-health-monitor" });
    return { skipped: false, reason, report };
  } finally {
    running = false;
  }
}

export function startRemoteHealthMonitor() {
  if (process.env.LIFEOS_REMOTE_HEALTH_MONITOR === "0") return;
  if (monitorTimer) return;
  setTimeout(() => {
    runRemoteHealthCheck("startup").catch(() => null);
  }, 4000).unref();
  monitorTimer = setInterval(() => {
    runRemoteHealthCheck("schedule").catch(() => null);
  }, intervalMs());
  monitorTimer.unref();
}
