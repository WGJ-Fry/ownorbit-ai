import type { MobileConnectivityResult, RemoteEntryKind } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";

function guidanceKey(kind?: RemoteEntryKind) {
  if (kind === "temporary-cloudflare") return "mobileDevice.connectivityGuidanceTemporary";
  if (kind === "tailscale") return "mobileDevice.connectivityGuidanceTailscale";
  if (kind === "same-lan") return "mobileDevice.connectivityGuidanceLan";
  if (kind === "localhost") return "mobileDevice.connectivityGuidanceLocalhost";
  if (kind === "stable-https" || kind === "configured-match") return "mobileDevice.connectivityGuidanceHttps";
  return "mobileDevice.connectivityGuidanceDefault";
}

export default function MobileConnectivityCard({ result, entryKind }: { result: MobileConnectivityResult; entryKind?: RemoteEntryKind }) {
  const { t } = useI18n();
  const passed = result.steps.filter((step) => step.ok).length;
  const websocketFailed = result.steps.some((step) => step.id === "websocket" && !step.ok);
  return (
    <div className={`mt-4 rounded-2xl border p-3 text-sm ${result.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-red-400/20 bg-red-500/10 text-red-100"}`}>
      <div className="font-bold">
        {result.ok
          ? t("mobileDevice.connectivityOk", { passed, total: result.steps.length, latency: result.latencyMs })
          : t("mobileDevice.connectivityFail", { passed, total: result.steps.length, message: result.error || "-" })}
      </div>
      <div className="mt-3 space-y-2">
        {result.steps.map((step) => (
          <div key={step.id} className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">{t(step.id === "health" ? "mobileDevice.connectivityHealth" : "mobileDevice.connectivityRealtime")}</span>
              <span className={step.ok ? "text-emerald-200" : "text-red-200"}>{step.ok ? t("mobileDevice.pass") : t("mobileDevice.fail")}</span>
            </div>
            <div className="mt-1 break-all font-mono text-[11px] opacity-70">{step.url}</div>
            <div className="mt-1 text-xs opacity-80">{step.ok ? `${step.latencyMs}ms` : step.error}</div>
          </div>
        ))}
      </div>
      {!result.ok ? (
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs leading-relaxed">
          <div className="font-bold">{t("mobileDevice.connectivityFixTitle")}</div>
          <div className="mt-1 opacity-85">{t(guidanceKey(entryKind) as any)}</div>
          {websocketFailed ? <div className="mt-1 opacity-85">{t("mobileDevice.connectivityGuidanceWebSocket")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
