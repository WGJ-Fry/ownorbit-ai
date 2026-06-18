import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

const statusKey = {
  healthy: "connection.health.status.healthy",
  unchecked: "connection.health.status.unchecked",
  failing: "connection.health.status.failing",
  stale: "connection.health.status.stale",
  temporary: "connection.health.status.temporary",
  insecure: "connection.health.status.insecure",
  missing: "connection.health.status.missing",
  "qr-warning": "connection.health.status.qrWarning",
} as const;

const checkKey = {
  https: "connection.health.check.https",
  health: "connection.health.check.health",
  "mobile-shell": "connection.health.check.mobileShell",
  websocket: "connection.health.check.websocket",
  "qr-entry": "connection.health.check.qrEntry",
} as const;

const recommendationKey = {
  "save-long-term-entry": "connection.health.recommendation.saveLongTermEntry",
  "run-remote-health": "connection.health.recommendation.runRemoteHealth",
  "replace-temporary-tunnel": "connection.health.recommendation.replaceTemporaryTunnel",
  "use-https": "connection.health.recommendation.useHttps",
  "refresh-stale-check": "connection.health.recommendation.refreshStaleCheck",
  "fix-health-check": "connection.health.recommendation.fixHealthCheck",
  "fix-mobile-shell": "connection.health.recommendation.fixMobileShell",
  "fix-websocket": "connection.health.recommendation.fixWebsocket",
  "refresh-pairing-qr": "connection.health.recommendation.refreshPairingQr",
  ready: "connection.health.recommendation.ready",
} as const;

const entryKindKey = {
  missing: "connection.health.entry.missing",
  "temporary-cloudflare": "connection.health.entry.temporaryCloudflare",
  tailscale: "connection.health.entry.tailscale",
  "stable-https": "connection.health.entry.stableHttps",
  "insecure-http": "connection.health.entry.insecureHttp",
  custom: "connection.health.entry.custom",
} as const;

const recoveryActionKey = {
  none: "connection.recovery.action.none",
  "run-remote-health": "connection.recovery.action.runRemoteHealth",
  "check-tailscale": "connection.recovery.action.checkTailscale",
  "check-cloudflare": "connection.recovery.action.checkCloudflare",
  "check-tunnel-target": "connection.recovery.action.checkTunnelTarget",
} as const;

function checkTone(status: NetworkDiagnostics["remoteHealthSummary"]["checks"][number]["status"]) {
  if (status === "ok") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  if (status === "warning") return "border-amber-400/20 bg-amber-500/10 text-amber-100";
  if (status === "fail") return "border-red-400/20 bg-red-500/10 text-red-100";
  return "border-white/[0.08] bg-white/[0.04] text-zinc-300";
}

function checkDetailText(check: NetworkDiagnostics["remoteHealthSummary"]["checks"][number], t: ReturnType<typeof useI18n>["t"]) {
  if (!check.detail) return "";
  if (check.id === "qr-entry" && check.detail === "expired") return t("connection.health.qrExpired");
  return check.detail;
}

export default function RemoteHealthSummaryCard({
  monitor,
  recovery,
  summary,
}: {
  monitor?: NetworkDiagnostics["remoteHealthMonitor"];
  recovery?: NetworkDiagnostics["remoteRecoveryReport"];
  summary: NetworkDiagnostics["remoteHealthSummary"];
}) {
  const { t } = useI18n();
  const Icon = summary.severity === "ok" ? CheckCircle2 : summary.severity === "warning" ? Clock3 : AlertTriangle;
  const recoveryAction = recovery?.recoveryAction ?? "none";
  const tone = summary.severity === "ok"
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : summary.severity === "warning"
      ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
      : "border-red-400/20 bg-red-500/10 text-red-100";

  return (
    <div className={`mt-4 rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold">{t(statusKey[summary.status] as any)}</div>
            <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {t(entryKindKey[summary.entryKind] as any)}
            </span>
          </div>
          <div className="mt-1 break-all font-mono text-[11px] opacity-80">{summary.baseUrl || t("connection.readiness.noAddress")}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {summary.checks.map((check) => (
              <div key={check.id} className={`rounded-xl border p-2 ${checkTone(check.status)}`}>
                <div className="text-[11px] font-bold">{t(checkKey[check.id] as any)}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider opacity-75">{t(`connection.health.checkStatus.${check.status}` as any)}</div>
                {checkDetailText(check, t) ? <div className="mt-1 break-all text-[10px] leading-relaxed opacity-80">{checkDetailText(check, t)}</div> : null}
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1.5 text-xs leading-relaxed opacity-90">
            {summary.recommendations.map((item) => (
              <li key={item}>{t(recommendationKey[item] as any)}</li>
            ))}
          </ul>
          {monitor ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3 text-xs">
              <div className="font-bold">{t("connection.monitor.title")}</div>
              <div className="mt-1 opacity-90">
                {t("connection.monitor.summary", {
                  status: !monitor.enabled
                    ? t("connection.monitor.disabled")
                    : monitor.running
                      ? monitor.inFlight
                        ? t("connection.monitor.checking")
                        : t("connection.monitor.running")
                      : t("connection.monitor.notRunning"),
                  interval: Math.round(monitor.intervalMs / 60000),
                })}
              </div>
              <div className="mt-1 opacity-75">
                {monitor.lastRunAt ? t("connection.monitor.lastRun", { time: new Date(monitor.lastRunAt).toLocaleString() }) : t("connection.monitor.noLastRun")}
              </div>
              {monitor.nextRunAt ? (
                <div className="mt-1 opacity-75">{t("connection.monitor.nextRun", { time: new Date(monitor.nextRunAt).toLocaleString() })}</div>
              ) : null}
            </div>
          ) : null}
          {recovery ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/15 p-3 text-xs">
              <div className="font-bold">{t("connection.recovery.title")}</div>
              <div className="mt-1 break-all opacity-80">{recovery.baseUrl}</div>
              {recovery.restoredBaseUrl && recovery.restoredBaseUrl !== recovery.baseUrl ? (
                <div className="mt-1 break-all opacity-80">{t("connection.recovery.restoredBaseUrl", { url: recovery.restoredBaseUrl })}</div>
              ) : null}
              <div className="mt-1 opacity-90">
                {t("connection.recovery.summary", {
                  mode: recovery.mode,
                  reason: recovery.recoveryReason,
                  status: recovery.restored ? t("connection.recovery.restored") : recovery.attempted ? t("connection.recovery.notRestored") : t("connection.recovery.notNeeded"),
                })}
              </div>
              <div className="mt-1 opacity-90">
                {t("connection.recovery.health", {
                  before: recovery.healthOkBefore ? t("connection.recovery.healthOk") : t("connection.recovery.healthFail"),
                  after: recovery.healthOkAfter ? t("connection.recovery.healthOk") : t("connection.recovery.healthFail"),
                })}
              </div>
              <div className="mt-1 opacity-90">{t(recoveryActionKey[recoveryAction] as any)}</div>
              <div className="mt-1 opacity-75">{new Date(recovery.createdAt).toLocaleString()}</div>
              {recovery.error ? <div className="mt-1 text-red-100">{recovery.error}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
