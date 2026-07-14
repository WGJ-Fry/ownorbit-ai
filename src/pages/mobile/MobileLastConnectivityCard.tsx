import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type { DeviceConnectivityReport } from "../../services/lifeosApi";
import type { MobileConnectivityIssueKey, MobileRecoveryHintKey, RemoteEntryKind } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";

function buildLastConnectivityRepairPacket({
  report,
  stale,
  issue,
  hints,
  translate,
}: {
  report: DeviceConnectivityReport;
  stale: boolean;
  issue: MobileConnectivityIssueKey | null;
  hints: MobileRecoveryHintKey[];
  translate: (key: any, values?: any) => string;
}) {
  const checks = [
    ["mobileDevice.connectivityHealth", report.healthOk],
    ["mobileDevice.connectivityMobileShell", report.mobileShellOk],
    ["mobileDevice.connectivityRealtime", report.websocketOk],
  ] as const;
  return [
    "OwnOrbit AI last mobile connectivity repair packet",
    `${translate("mobileDevice.currentEntry")}: ${report.currentBaseUrl || "-"}`,
    `${translate("mobileDevice.connectivityTestedAt", { time: new Date(report.createdAt).toLocaleString() })}`,
    `${translate("mobileDevice.lastConnectivityStatus")}: ${report.ok ? translate("mobileDevice.pass") : translate("mobileDevice.fail")}`,
    `${translate("mobileDevice.latency")}: ${report.latencyMs}ms`,
    `${translate("mobileDevice.reportFreshness")}: ${stale ? translate("mobileDevice.staleConnectivityReport") : translate("mobileDevice.freshConnectivityReport")}`,
    report.error ? `${translate("mobileDevice.lastConnectivityError", { message: report.error })}` : "",
    "",
    translate("mobileDevice.connectivitySteps"),
    ...checks.map(([label, ok]) => `- ${translate(label)}: ${ok ? translate("mobileDevice.pass") : translate("mobileDevice.fail")}`),
    "",
    translate("mobileDevice.connectivityFixTitle"),
    issue && issue !== "mobileDevice.connectivityIssueOk" ? `- ${translate(issue)}` : `- ${translate("mobileDevice.connectivityIssueOk")}`,
    ...hints.map((hint) => `- ${translate(hint)}`),
  ].filter(Boolean).join("\n");
}

export default function MobileLastConnectivityCard({
  report,
  stale,
  issue,
  hints,
  entryKind,
  refreshBusy,
  retryBusy,
  onRefresh,
  onRetry,
}: {
  report: DeviceConnectivityReport;
  stale: boolean;
  issue: MobileConnectivityIssueKey | null;
  hints: MobileRecoveryHintKey[];
  entryKind: RemoteEntryKind;
  refreshBusy: boolean;
  retryBusy: boolean;
  onRefresh: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [copiedRepairPacket, setCopiedRepairPacket] = useState(false);
  const showTailscale = entryKind === "tailscale";
  const showRebind = entryKind === "temporary-cloudflare" || entryKind === "same-lan" || entryKind === "localhost" || entryKind === "configured-mismatch";
  const showRepairPacket = !report.ok || stale || (issue && issue !== "mobileDevice.connectivityIssueOk");
  const copyRepairPacket = async () => {
    const packet = buildLastConnectivityRepairPacket({ report, stale, issue, hints, translate: t });
    await navigator.clipboard.writeText(packet).catch(() => null);
    setCopiedRepairPacket(true);
    window.setTimeout(() => setCopiedRepairPacket(false), 1200);
  };

  return (
    <div className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${report.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-red-400/20 bg-red-500/10 text-red-100"}`}>
      <div className="font-bold">
        {report.ok ? t("mobileDevice.lastConnectivityOk") : t("mobileDevice.lastConnectivityFailed")}
      </div>
      <div className="mt-1 opacity-85">
        {t("mobileDevice.lastConnectivityBody", {
          time: new Date(report.createdAt).toLocaleString(),
          entry: report.currentBaseUrl,
          latency: report.latencyMs,
        })}
      </div>
      {stale ? (
        <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-500/10 p-2 text-amber-50">
          {t("mobileDevice.staleConnectivityReport")}
        </div>
      ) : (
        <div className="mt-2 rounded-xl border border-emerald-300/20 bg-emerald-500/10 p-2 text-emerald-50">
          {t("mobileDevice.freshConnectivityReport")}
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
          <div className="font-bold">{report.healthOk ? t("mobileDevice.pass") : t("mobileDevice.fail")}</div>
          <div className="mt-1 opacity-75">{t("mobileDevice.connectivityHealth")}</div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
          <div className="font-bold">{report.mobileShellOk ? t("mobileDevice.pass") : t("mobileDevice.fail")}</div>
          <div className="mt-1 opacity-75">{t("mobileDevice.connectivityMobileShell")}</div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
          <div className="font-bold">{report.websocketOk ? t("mobileDevice.pass") : t("mobileDevice.fail")}</div>
          <div className="mt-1 opacity-75">{t("mobileDevice.connectivityRealtime")}</div>
        </div>
      </div>
      {report.error ? <div className="mt-2 opacity-85">{t("mobileDevice.lastConnectivityError", { message: report.error })}</div> : null}
      {issue && issue !== "mobileDevice.connectivityIssueOk" ? (
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2">
          <div className="font-bold">{t("mobileDevice.lastConnectivityFixTitle")}</div>
          <div className="mt-1 font-bold opacity-90">{t(issue as any)}</div>
          <div className="mt-2 space-y-1 opacity-80">
            {hints.map((hint) => <div key={hint}>{t(hint as any)}</div>)}
          </div>
        </div>
      ) : null}
      <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2">
        <div className="font-bold">{t("mobileDevice.lastConnectivityActionTitle")}</div>
        <div className="mt-2 grid gap-2">
          <button onClick={onRetry} disabled={retryBusy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 font-bold text-cyan-100 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${retryBusy ? "animate-spin" : ""}`} />
            {retryBusy ? t("mobileDevice.connectivityTesting") : t("mobileDevice.retryConnectivity")}
          </button>
          <button onClick={onRefresh} disabled={refreshBusy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 font-bold text-zinc-100 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshBusy ? "animate-spin" : ""}`} />
            {refreshBusy ? t("mobileDevice.refreshingServerState") : t("mobile.refreshConnection")}
          </button>
          {showRepairPacket ? (
            <button onClick={copyRepairPacket} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-black/10 px-3 py-2 font-bold text-zinc-100">
              <Copy className="h-3.5 w-3.5" />
              {copiedRepairPacket ? t("mobileDevice.repairPacketCopied") : t("mobileDevice.copyRepairPacket")}
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
    </div>
  );
}
