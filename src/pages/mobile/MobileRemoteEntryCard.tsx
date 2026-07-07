import { useEffect, useState } from "react";
import { Copy, RefreshCw, Star, Trash2, Wifi } from "lucide-react";
import type { DeviceConnectivityReport } from "../../services/lifeosApi";
import type { MobileIcloudHandoffEntry, MobileIcloudHandoffEntryRecommendation, MobileIcloudHandoffServerRepairStatus, MobileIcloudHandoffStatus } from "../../services/mobileIcloudHandoff";
import { buildMobileIcloudHandoffRecoveryPacket, buildMobileIcloudHandoffUrl, forgetStoredMobileIcloudHandoffEntry, getMobileIcloudHandoffActionKey, getMobileIcloudHandoffEntryFreshness, getMobileIcloudHandoffEntryKey, getMobileIcloudHandoffEntryRecommendation, getPreferredMobileIcloudHandoffEntryKey, getStoredMobileIcloudHandoffEntries, setPreferredMobileIcloudHandoffEntry } from "../../services/mobileIcloudHandoff";
import type { OfflineMessageQueueSummary } from "../../services/offlineMessageQueue";
import type { MobileConnectivityIssueKey, MobileConnectivityResult, MobileRecoveryHintKey, RemoteEntryStatus } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";
import MobileConnectivityCard from "./MobileConnectivityCard";
import MobileLastConnectivityCard from "./MobileLastConnectivityCard";
import { Row } from "./MobileDeviceStatusCards";

function readinessTone(ok: boolean) {
  return ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100";
}

const icloudEntryFreshnessKeys = {
  fresh: "mobileDevice.icloudHandoffEntryFresh",
  stale: "mobileDevice.icloudHandoffEntryRefresh",
  expired: "mobileDevice.icloudHandoffEntryExpired",
  legacy: "mobileDevice.icloudHandoffEntryLegacy",
} as const;

const icloudPreferredSwitchReasonKeys: Record<MobileIcloudHandoffEntryRecommendation["preferredSwitchReason"], string> = {
  none: "mobileDevice.icloudHandoffRecommendedBody",
  "default-stale": "mobileDevice.icloudHandoffDefaultSwitchStale",
  "default-expired": "mobileDevice.icloudHandoffDefaultSwitchExpired",
  "default-legacy": "mobileDevice.icloudHandoffDefaultSwitchLegacy",
  "default-failed": "mobileDevice.icloudHandoffDefaultSwitchFailed",
};

function icloudEntryFreshnessTone(freshness: keyof typeof icloudEntryFreshnessKeys) {
  if (freshness === "fresh") return "bg-emerald-500/15 text-emerald-100";
  if (freshness === "expired") return "bg-red-500/15 text-red-100";
  return "bg-amber-500/15 text-amber-100";
}

export default function MobileRemoteEntryCard({
  connectivityBusy,
  connectivityReportStale,
  connectivityTest,
  currentEntry,
  currentEntryGuidance,
  healthNetworkMode,
  icloudHandoffStatus,
  icloudServerRepair,
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
  icloudServerRepair: MobileIcloudHandoffServerRepairStatus | null;
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
  const [showIcloudDesktopAdvanced, setShowIcloudDesktopAdvanced] = useState(false);
  const [icloudEntries, setIcloudEntries] = useState(() => getStoredMobileIcloudHandoffEntries());
  const [preferredIcloudEntryKey, setPreferredIcloudEntryKey] = useState(() => getPreferredMobileIcloudHandoffEntryKey());
  const queueWaiting = queueSummary.failed > 0 || queueSummary.pending > 0 || queueSummary.syncing > 0;
  const latestConnectivityOk = Boolean(lastConnectivityReport?.ok && !connectivityReportStale);
  const remoteReady = currentEntry.okForRemote && latestConnectivityOk && !queueWaiting;
  const icloudTone = icloudHandoffStatus?.needsRefresh ? "border-amber-400/20 bg-amber-500/10 text-amber-100" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  const icloudServerRepairTone = icloudServerRepair?.pending
    ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
    : icloudServerRepair?.refreshed
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : "border-sky-400/20 bg-sky-500/10 text-sky-100";
  const icloudActionKey = icloudHandoffStatus ? getMobileIcloudHandoffActionKey(icloudHandoffStatus) : null;
  const icloudEntryRecommendation = getMobileIcloudHandoffEntryRecommendation(icloudEntries, { preferredKey: preferredIcloudEntryKey });
  const recommendedIcloudEntry = icloudEntryRecommendation.recommendedEntry;
  const otherIcloudEntries = icloudEntryRecommendation.otherEntries;
  const icloudRecommendedBodyKey = (icloudEntryRecommendation.preferredNeedsSwitch
    ? icloudPreferredSwitchReasonKeys[icloudEntryRecommendation.preferredSwitchReason]
    : "mobileDevice.icloudHandoffRecommendedBody") as any;
  const copyIcloudRecoveryPacket = async () => {
    if (!icloudHandoffStatus) return;
    await navigator.clipboard.writeText(buildMobileIcloudHandoffRecoveryPacket(icloudHandoffStatus)).catch(() => null);
    setCopiedIcloudPacket(true);
    window.setTimeout(() => setCopiedIcloudPacket(false), 1400);
  };
  const openIcloudEntry = (entry: MobileIcloudHandoffEntry) => {
    window.location.href = buildMobileIcloudHandoffUrl(entry);
  };
  const forgetIcloudEntry = (entry: MobileIcloudHandoffEntry) => {
    if (!forgetStoredMobileIcloudHandoffEntry(entry)) return;
    setPreferredIcloudEntryKey(getPreferredMobileIcloudHandoffEntryKey());
    setIcloudEntries(getStoredMobileIcloudHandoffEntries());
  };
  const preferIcloudEntry = (entry: MobileIcloudHandoffEntry) => {
    if (!setPreferredMobileIcloudHandoffEntry(entry)) return;
    setPreferredIcloudEntryKey(getPreferredMobileIcloudHandoffEntryKey());
    setIcloudEntries(getStoredMobileIcloudHandoffEntries());
  };
  const renderIcloudEntryRow = (entry: MobileIcloudHandoffEntry, options: { recommended?: boolean } = {}) => {
    const key = getMobileIcloudHandoffEntryKey(entry);
    const active = icloudHandoffStatus ? key === getMobileIcloudHandoffEntryKey(icloudHandoffStatus.entry) : false;
    const preferred = preferredIcloudEntryKey === key;
    const freshness = getMobileIcloudHandoffEntryFreshness(entry);
    return (
      <div
        key={key}
        className={`flex items-center gap-2 rounded-xl border ${options.recommended ? "border-sky-300/25 bg-sky-500/10" : "border-white/[0.08] bg-white/[0.04]"}`}
      >
        <button
          type="button"
          onClick={() => openIcloudEntry(entry)}
          disabled={active}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left disabled:cursor-default disabled:opacity-70"
        >
          <span className="min-w-0">
            <span className="block truncate font-bold">{entry.desktopName || entry.label || t("mobileDevice.icloudHandoffUnknownDesktop")}</span>
            <span className="mt-0.5 block truncate opacity-70">{entry.baseUrl}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${icloudEntryFreshnessTone(freshness)}`}>
              {t(icloudEntryFreshnessKeys[freshness] as any)}
            </span>
            {preferred ? <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold text-sky-100">{t("mobileDevice.icloudHandoffDefaultDesktop")}</span> : null}
            {options.recommended ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-100">{t("mobileDevice.icloudHandoffRecommendedBadge")}</span> : null}
            <span className="font-bold">{active ? t("mobileDevice.icloudHandoffCurrentDesktop") : t("mobileDevice.icloudHandoffOpenDesktop")}</span>
          </span>
        </button>
        {!preferred ? (
          <button
            type="button"
            aria-label={t("mobileDevice.icloudHandoffMakeDefault")}
            title={t("mobileDevice.icloudHandoffMakeDefault")}
            onClick={() => preferIcloudEntry(entry)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-black/10 text-sky-100"
          >
            <Star className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {!active ? (
          <button
            type="button"
            aria-label={t("mobileDevice.icloudHandoffForgetDesktop")}
            title={t("mobileDevice.icloudHandoffForgetDesktop")}
            onClick={() => forgetIcloudEntry(entry)}
            className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-black/10 text-zinc-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    );
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
          {icloudServerRepair ? (
            <div className={`mt-3 rounded-xl border p-2 text-xs ${icloudServerRepairTone}`}>
              <div className="font-bold">
                {icloudServerRepair.pending
                  ? t("mobileDevice.icloudHandoffDesktopRepairQueued")
                  : icloudServerRepair.refreshed
                  ? t("mobileDevice.icloudHandoffDesktopRepairRefreshed")
                  : t("mobileDevice.icloudHandoffDesktopRepairReported")}
              </div>
              <div className="mt-1 opacity-80">
                {t("mobileDevice.icloudHandoffDesktopRepairDetail", {
                  reason: icloudServerRepair.refreshReason,
                  time: new Date(icloudServerRepair.reportedAt).toLocaleString(),
                })}
              </div>
            </div>
          ) : null}
          {icloudEntries.length > 1 ? (
            <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2 text-xs">
              <div className="font-bold">{t("mobileDevice.icloudHandoffKnownDesktops")}</div>
              <div className="mt-1 opacity-80">{t(icloudRecommendedBodyKey)}</div>
              {recommendedIcloudEntry ? (
                <div className="mt-2 grid gap-2">
                  <div className="font-bold text-sky-100">{t("mobileDevice.icloudHandoffRecommendedDesktop")}</div>
                  {renderIcloudEntryRow(recommendedIcloudEntry, { recommended: true })}
                </div>
              ) : null}
              {otherIcloudEntries.length ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowIcloudDesktopAdvanced((value) => !value)}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-white/[0.08] bg-black/10 px-3 py-2 text-xs font-bold"
                  >
                    {showIcloudDesktopAdvanced ? t("mobileDevice.icloudHandoffHideOtherDesktops") : t("mobileDevice.icloudHandoffShowOtherDesktops", { count: otherIcloudEntries.length })}
                  </button>
                  {showIcloudDesktopAdvanced ? (
                    <div className="mt-2 grid gap-2">
                      <div className="font-bold">{t("mobileDevice.icloudHandoffOtherDesktops")}</div>
                      {otherIcloudEntries.map((entry) => renderIcloudEntryRow(entry))}
                    </div>
                  ) : null}
                </div>
              ) : null}
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
