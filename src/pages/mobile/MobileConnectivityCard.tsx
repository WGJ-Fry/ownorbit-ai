import { useState } from "react";
import { Copy } from "lucide-react";
import { getMobileConnectivityIssue, getMobileRecoveryHints, isHttpRemoteBase, type MobileConnectivityResult, type RemoteEntryKind } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";

const stepLabelKey = {
  health: "mobileDevice.connectivityHealth",
  "mobile-shell": "mobileDevice.connectivityMobileShell",
  websocket: "mobileDevice.connectivityRealtime",
} as const;

export default function MobileConnectivityCard({
  queueSummary,
  result,
  entryKind,
  onRetry,
}: {
  queueSummary?: { pending?: number; failed?: number; syncing?: number };
  result: MobileConnectivityResult;
  entryKind?: RemoteEntryKind;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const passed = result.steps.filter((step) => step.ok).length;
  const websocketFailed = result.steps.some((step) => step.id === "websocket" && !step.ok);
  const recoveryHints = getMobileRecoveryHints(result, entryKind, queueSummary);
  const primaryIssue = getMobileConnectivityIssue(result, entryKind, queueSummary);
  const queueBlocked = primaryIssue === "mobileDevice.connectivityIssueQueueBlocked";
  const showRecovery = !result.ok || queueBlocked;
  const tailscaleHttpFallback = entryKind === "tailscale" && isHttpRemoteBase(result.currentBase);
  const showRebind = tailscaleHttpFallback || entryKind === "temporary-cloudflare" || entryKind === "same-lan" || entryKind === "localhost" || entryKind === "configured-mismatch";
  const showTailscale = entryKind === "tailscale";
  const copyRepairPacket = async () => {
    const lines = [
      "LifeOS AI mobile connectivity repair packet",
      `${t("mobileDevice.currentEntry")}: ${result.currentBase || "-"}`,
      `${t("mobileDevice.remoteVerdict")}: ${t(primaryIssue as any)}`,
      `${t("mobileDevice.connectivityTestedAt", { time: result.testedAt ? new Date(result.testedAt).toLocaleString() : "-" })}`,
      "",
      t("mobileDevice.connectivitySteps"),
      ...result.steps.map((step) => {
        const label = t(stepLabelKey[step.id] as any);
        const state = step.ok ? t("mobileDevice.pass") : t("mobileDevice.fail");
        return `- ${label}: ${state} ${step.status ? `HTTP ${step.status}` : ""} ${step.latencyMs}ms ${step.error || ""}\n  ${step.url}`;
      }),
      "",
      t("mobileDevice.connectivityFixTitle"),
      `- ${t(primaryIssue as any)}`,
      ...recoveryHints.map((hint) => `- ${t(hint as any)}`),
    ];
    await navigator.clipboard.writeText(lines.join("\n")).catch(() => null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className={`mt-4 rounded-2xl border p-3 text-sm ${queueBlocked ? "border-amber-400/20 bg-amber-500/10 text-amber-100" : result.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-red-400/20 bg-red-500/10 text-red-100"}`}>
      <div className="font-bold">
        {result.ok
          ? t("mobileDevice.connectivityOk", { passed, total: result.steps.length, latency: result.latencyMs })
          : t("mobileDevice.connectivityFail", { passed, total: result.steps.length, message: result.error || "-" })}
      </div>
      {result.testedAt ? <div className="mt-1 text-xs opacity-75">{t("mobileDevice.connectivityTestedAt", { time: new Date(result.testedAt).toLocaleString() })}</div> : null}
      <div className="mt-3 space-y-2">
        {result.steps.map((step) => (
          <div key={step.id} className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">{t(stepLabelKey[step.id] as any)}</span>
              <span className={step.ok ? "text-emerald-200" : "text-red-200"}>{step.ok ? t("mobileDevice.pass") : t("mobileDevice.fail")}</span>
            </div>
            <div className="mt-1 break-all font-mono text-[11px] opacity-70">{step.url}</div>
            <div className="mt-1 text-xs opacity-80">{step.ok ? `${step.latencyMs}ms` : step.error}</div>
          </div>
        ))}
      </div>
      {showRecovery ? (
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs leading-relaxed">
          <div className="font-bold">{t("mobileDevice.connectivityFixTitle")}</div>
          <div className={`mt-1 rounded-lg border border-white/[0.06] bg-black/10 p-2 font-bold ${queueBlocked ? "text-amber-50" : "text-red-50"}`}>
            {t(primaryIssue as any)}
          </div>
          <div className="mt-2 space-y-1 opacity-85">
            {recoveryHints.map((hint) => <div key={hint}>{t(hint as any)}</div>)}
          </div>
          <div className="mt-3 grid gap-2">
            <button onClick={copyRepairPacket} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-black/10 px-3 py-2 font-bold text-zinc-100">
              <Copy className="h-3.5 w-3.5" />
              {copied ? t("mobileDevice.repairPacketCopied") : t("mobileDevice.copyRepairPacket")}
            </button>
            {onRetry ? (
              <button onClick={onRetry} className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 font-bold text-cyan-100">
                {websocketFailed ? t("mobileDevice.retryRealtime") : t("mobileDevice.retryConnectivity")}
              </button>
            ) : null}
            {showTailscale ? (
              <a href="tailscale://" className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-center font-bold text-blue-100">
                {t("mobileDevice.openTailscale")}
              </a>
            ) : null}
            {showRebind ? (
              <a href="/mobile/device" className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-center font-bold text-amber-100">
                {t("mobileDevice.rebindRemoteEntry")}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
