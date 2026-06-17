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
  ready: "connection.health.recommendation.ready",
} as const;

function checkTone(status: NetworkDiagnostics["remoteHealthSummary"]["checks"][number]["status"]) {
  if (status === "ok") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  if (status === "warning") return "border-amber-400/20 bg-amber-500/10 text-amber-100";
  if (status === "fail") return "border-red-400/20 bg-red-500/10 text-red-100";
  return "border-white/[0.08] bg-white/[0.04] text-zinc-300";
}

export default function RemoteHealthSummaryCard({ summary }: { summary: NetworkDiagnostics["remoteHealthSummary"] }) {
  const { t } = useI18n();
  const Icon = summary.severity === "ok" ? CheckCircle2 : summary.severity === "warning" ? Clock3 : AlertTriangle;
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
          <div className="text-sm font-bold">{t(statusKey[summary.status] as any)}</div>
          <div className="mt-1 break-all font-mono text-[11px] opacity-80">{summary.baseUrl || t("connection.readiness.noAddress")}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {summary.checks.map((check) => (
              <div key={check.id} className={`rounded-xl border p-2 ${checkTone(check.status)}`}>
                <div className="text-[11px] font-bold">{t(checkKey[check.id] as any)}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider opacity-75">{t(`connection.health.checkStatus.${check.status}` as any)}</div>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1.5 text-xs leading-relaxed opacity-90">
            {summary.recommendations.map((item) => (
              <li key={item}>{t(recommendationKey[item] as any)}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
