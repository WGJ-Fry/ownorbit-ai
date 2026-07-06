import { useEffect, useState } from "react";
import { Copy, RefreshCw, Wifi } from "lucide-react";
import type { DeviceConnectivityReport } from "../../services/lifeosApi";
import type { MobileIcloudHandoffEntry, MobileIcloudHandoffStatus } from "../../services/mobileIcloudHandoff";
import { buildMobileIcloudHandoffRecoveryPacket, buildMobileIcloudHandoffUrl, getMobileIcloudHandoffActionKey, getStoredMobileIcloudHandoffEntries } from "../../services/mobileIcloudHandoff";
import type { OfflineMessageQueueSummary } from "../../services/offlineMessageQueue";
import type { MobileConnectivityIssueKey, MobileConnectivityResult, MobileRecoveryHintKey, RemoteEntryStatus } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";
import MobileConnectivityCard from "./MobileConnectivityCard";
import MobileLastConnectivityCard from "./MobileLastConnectivityCard";
import { Row } from "./MobileDeviceStatusCards";

function readinessTone(ok: boolean) {
  return ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100";
}

function icloudEntryKey(entry: MobileIcloudHandoffEntry) {
  return entry.desktopId || entry.checksumSha256 || entry.baseUrl;
}

export default function MobileRemoteEntryCard({
  connectivityBusy,
  connectivityReportStale,
  connectivityTest,
  currentEntry,
  currentEntryGuidance,
  healthNetworkMode,
  icloudHandoffStatus,
  lastConnectivityHints,
  lastConnectivityIssue,
  lastConnectivityReport,
  queueSummary,
  serverRefreshBusy,
  onConnectivityTest,
  onRefreshServer,
}: {
  connectivityBusy: boolean;
  connectivityReportStale: boolean;
  connectivityTest: MobileConnectivityResult | null;
  currentEntry: RemoteEntryStatus;
  currentEntryGuidance: MobileRecoveryHintKey[];
  healthNetworkMode?: string;
  icloudHandoffStatus: MobileIcloudHandoffStatus | null;
  lastConnectivityHints: MobileRecoveryHintKey[];
  lastConnectivityIssue: MobileConnectivityIssueKey | null;
  lastConnectivityReport: DeviceConnectivityReport | null;
  queueSummary: OfflineMessageQueueSummary;
  serverRefreshBusy: boolean;
  onConnectivityTest: () => void;
  onRefreshServer: () => void;
}) {
  const { t } = useI18n();
  const [copiedIcloudPacket, setCopiedIcloudPacket] = useState(false);
  const [showIcloudAdvanced, setShowIcloudAdvanced] = useState(false);
  const [icloudEntries, setIcloudEntries] = useState(() => getStoredMobileIcloudHandoffEntries());
  const queueWaiting = queueSummary.failed > 0 || queueSummary.pending > 0 || queueSummary.syncing > 0;
  const latestConnectivityOk = Boolean(lastConnectivityReport?.ok && !connectivityReportStale);
  const remoteReady = currentEntry.okForRemote && latestConnectivityOk && !queueWaiting;
  const icloudTone = icloudHandoffStatus?.needsRefresh ? "border-amber-400/20 bg-amber-500/10 text-amber-100" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  const icloudActionKey = icloudHandoffStatus ? getMobileIcloudHandoffActionKey(icloudHandoffStatus) : null;
  const copyIcloudRecoveryPacket = async () => {
    if (!icloudHandoffStatus) return;
    await navigator.clipboard.writeText(buildMobileIcloudHandoffRecoveryPacket(icloudHandoffStatus)).catch(() => null);
    setCopiedIcloudPacket(true);
    window.setTimeout(() => setCopiedIcloudPacket(false), 1400);
  };
  const openIcloudEntry = (entry: MobileIcloudHandoffEntry) => {
    window.location.href = buildMobileIcloudHandoffUrl(entry);
  };

  useEffect(() => {
    setIcloudEntries(getStoredMobileIcloudHandoffEntries());
  }, [icloudHandoffStatus?.entry.baseUrl, icloudHandoffStatus?.entry.desktopId, icloudHandoffStatus?.entry.generatedAt]);

  return (
    <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${currentEntry.okForRemote ? "border-emerald-400/20 bg-emerald-500/10" : "border-amber-400/20 bg-amber-500/10"}`}>
          <Wifi className={`h-5 w-5 ${currentEntry.okForRemote ? "text-emerald-300" : "text-amber-300"}`} />
        </div>
        <div>
          <h2 className="text-base font-bold">{t("mobileDevice.remoteEntryTitle")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t("mobileDevice.remoteEntryBody")}</p>
        </div>
      </div>

      <div className={`mb-3 rounded-2xl border p-3 text-sm ${readinessTone(remoteReady)}`}>
        <div className="font-bold">{remoteReady ? t("mobileDevice.remoteReadinessReady") : t("mobileDevice.remoteReadinessNeedsAttention")}</div>
        <div className="mt-2 grid gap-2 text-xs">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/10 px-3 py-2">
            <span className="font-bold">{t("mobileDevice.remoteReadinessEntry")}</span>
            <span>{currentEntry.okForRemote ? t("mobileDevice.pass") : t("mobileDevice.fail")}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/10 px-3 py-2">
            <span className="font-bold">{t("mobileDevice.remoteReadinessConnectivity")}</span>
            <span>{latestConnectivityOk ? t("mobileDevice.pass") : t("mobileDevice.fail")}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-black/10 px-3 py-2">
            <span className="font-bold">{t("mobileDevice.remoteReadinessQueue")}</span>
            <span>{queueWaiting ? t("mobileDevice.remoteReadinessQueueWaiting") : t("mobileDevice.remoteReadinessQueueClear")}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-sm">
        <Row label={t("mobileDevice.currentEntry")} value={currentEntry.currentBase || "-"} />
        <Row label={t("mobileDevice.desktopEntry")} value={currentEntry.configuredBase || t("mobileDevice.desktopEntryUnset")} />
        <Row label={t("mobileDevice.networkMode")} value={healthNetworkMode || "-"} />
        <Row label={t("mobileDevice.remoteVerdict")} value={t(currentEntry.titleKey as any)} />
      </div>

      {icloudHandoffStatus ? (
        <div className={`mt-3 rounded-2xl border p-3 text-sm leading-relaxed ${icloudTone}`}>
          <div className="font-bold">{t(icloudHandoffStatus.titleKey as any)}</div>
          <div className="mt-1 opacity-80">{t(icloudHandoffStatus.bodyKey as any)}</div>
          {icloudActionKey ? <div className="mt-2 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs font-bold">{t(icloudActionKey as any)}</div> : null}
          {icloudEntries.length > 1 ? (
            <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs">
              <div className="font-bold">{t("mobileDevice.icloudHandoffKnownDesktops")}</div>
              <div className="mt-2 grid gap-2">
                {icloudEntries.map((entry) => {
                  const active = icloudEntryKey(entry) === icloudEntryKey(icloudHandoffStatus.entry);
                  return (
                    <button
                      key={icloudEntryKey(entry)}
                      type="button"
                      onClick={() => openIcloudEntry(entry)}
                      disabled={active}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-left disabled:opacity-70"
                    >
                      <span>
                        <span className="block font-bold">{entry.desktopName || entry.label || t("mobileDevice.icloudHandoffUnknownDesktop")}</span>
                        <span className="mt-0.5 block opacity-70">{entry.baseUrl}</span>
                      </span>
                      <span className="shrink-0 font-bold">{active ? t("mobileDevice.icloudHandoffCurrentDesktop") : t("mobileDevice.icloudHandoffOpenDesktop")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs">
            <div className="font-bold">{t("mobileDevice.icloudHandoffSummaryTitle")}</div>
            {icloudHandoffStatus.entry.desktopName || icloudHandoffStatus.entry.desktopId ? (
              <Row label={t("mobileDevice.icloudHandoffDesktop")} value={icloudHandoffStatus.entry.desktopName || icloudHandoffStatus.entry.desktopId || "-"} />
            ) : null}
            <Row label={t("mobileDevice.icloudHandoffEntry")} value={icloudHandoffStatus.entry.baseUrl} />
          </div>
          <button
            type="button"
            onClick={() => setShowIcloudAdvanced((value) => !value)}
            className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-white/[0.1] bg-black/10 px-3 py-2 text-xs font-bold"
          >
            {showIcloudAdvanced ? t("mobileDevice.icloudHandoffHideAdvanced") : t("mobileDevice.icloudHandoffShowAdvanced")}
          </button>
          {showIcloudAdvanced ? (
            <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs">
              <div className="font-bold">{t("mobileDevice.icloudHandoffAdvancedTitle")}</div>
              <div className="mt-2 grid gap-2">
                {icloudHandoffStatus.entry.checksumSha256 ? <Row label={t("mobileDevice.icloudHandoffChecksum")} value={`${icloudHandoffStatus.entry.checksumSha256.slice(0, 12)}...`} /> : null}
                <Row label={t("mobileDevice.icloudHandoffGenerated")} value={new Date(icloudHandoffStatus.entry.generatedAt).toLocaleString()} />
                <Row label={t("mobileDevice.icloudHandoffExpires")} value={new Date(icloudHandoffStatus.entry.expiresAt).toLocaleString()} />
                <Row label={t("mobileDevice.icloudHandoffLastCheck")} value={icloudHandoffStatus.entry.lastConnectivityTestedAt ? new Date(icloudHandoffStatus.entry.lastConnectivityTestedAt).toLocaleString() : t("mobileDevice.icloudHandoffNotTested")} />
                <Row label={t("mobileDevice.icloudHandoffLastResult")} value={icloudHandoffStatus.entry.lastConnectivityTestedAt ? (icloudHandoffStatus.entry.lastConnectivityOk ? t("mobileDevice.pass") : t("mobileDevice.fail")) : "-"} />
                {icloudHandoffStatus.entry.lastConnectivityError ? <Row label={t("mobileDevice.icloudHandoffLastError")} value={icloudHandoffStatus.entry.lastConnectivityError} /> : null}
                {icloudHandoffStatus.entry.lastIgnoredAt ? <Row label={t("mobileDevice.icloudHandoffLastIgnored")} value={`${icloudHandoffStatus.entry.lastIgnoredBaseUrl || "-"} · ${new Date(icloudHandoffStatus.entry.lastIgnoredAt).toLocaleString()}`} /> : null}
              </div>
              <button onClick={copyIcloudRecoveryPacket} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-black/10 px-3 py-2 text-xs font-bold">
                <Copy className="h-3.5 w-3.5" />
                {copiedIcloudPacket ? t("mobileDevice.icloudHandoffRepairCopied") : t("mobileDevice.copyIcloudHandoffRepair")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <button
        onClick={onRefreshServer}
        disabled={serverRefreshBusy}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${serverRefreshBusy ? "animate-spin" : ""}`} />
        {serverRefreshBusy ? t("mobileDevice.refreshingServerState") : t("mobile.refreshConnection")}
      </button>

      <div className={`mt-4 rounded-2xl border p-3 text-sm leading-relaxed ${currentEntry.okForRemote ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
        <div className="font-bold">{t(currentEntry.titleKey as any)}</div>
        <div className={`mt-1 ${currentEntry.okForRemote ? "text-emerald-100/75" : "text-amber-100/75"}`}>{t(currentEntry.bodyKey as any)}</div>
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs">
          <div className="font-bold">{t("mobileDevice.entryGuidanceTitle")}</div>
          <div className="mt-1 space-y-1 opacity-85">
            {currentEntryGuidance.map((hint) => <div key={hint}>{t(hint as any)}</div>)}
          </div>
        </div>
      </div>

      {lastConnectivityReport ? (
        <MobileLastConnectivityCard
          report={lastConnectivityReport}
          stale={connectivityReportStale}
          issue={lastConnectivityIssue}
          hints={lastConnectivityHints}
          entryKind={currentEntry.kind}
          refreshBusy={serverRefreshBusy}
          retryBusy={connectivityBusy}
          onRefresh={onRefreshServer}
          onRetry={onConnectivityTest}
        />
      ) : null}

      <button
        onClick={onConnectivityTest}
        disabled={connectivityBusy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:opacity-50"
      >
        <RefreshCw className="h-4 w-4" />
        {connectivityBusy ? t("mobileDevice.connectivityTesting") : t("mobileDevice.connectivityTest")}
      </button>
      {connectivityTest ? <MobileConnectivityCard result={connectivityTest} entryKind={currentEntry.kind} queueSummary={queueSummary} onRetry={onConnectivityTest} /> : null}
    </section>
  );
}
