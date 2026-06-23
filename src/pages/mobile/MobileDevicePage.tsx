import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Download, KeyRound, LogOut, RefreshCw, ShieldCheck, Smartphone, Trash2, Wifi } from "lucide-react";
import { clearStoredDeviceCredential, getHealth, getLatestMobileConnectivityReport, getStoredDeviceCredential, getStoredDeviceCredentialAsync, getStoredDeviceCredentialStorageStatus, reportMobileConnectivity, revokeCurrentDeviceBinding, rotateDeviceToken } from "../../services/lifeosApi";
import type { DeviceConnectivityReport, DeviceCredentialStorageStatus } from "../../services/lifeosApi";
import { clearOfflineMessageQueue, getOfflineMessageQueue, getOfflineMessageQueueStorageStatus, getOfflineMessageQueueSummary, removeOfflineMessages, resetFailedOfflineMessages, retryOfflineMessage, subscribeOfflineMessageQueue } from "../../services/offlineMessageQueue";
import type { OfflineMessageQueueStorageStatus, OfflineQueuedMessage } from "../../services/offlineMessageQueue";
import { getNetworkStatus } from "../../services/networkStatus";
import { extractPairingToken, pairingInstallPath } from "../../services/mobilePairingIntent";
import { getMobileConnectivityIssue, getMobileRecoveryHints, getPwaCapabilityStatus, getRemoteEntryGuidance, getRemoteEntryStatus, mobileConnectivityResultFromReport, testMobileRemoteConnectivity } from "../../services/pwaCapabilities";
import type { MobileConnectivityResult } from "../../services/pwaCapabilities";
import { QueueItem, QueueStorageCard } from "./MobileOfflineQueueCards";
import MobileConnectivityCard from "./MobileConnectivityCard";
import { CapabilityRow, CredentialStorageCard, Metric, PairingLinkPanel, Row } from "./MobileDeviceStatusCards";
import { useI18n } from "../../i18n/I18nProvider";

function pwaRecommendationKey(recommendation: string) {
  if (recommendation.includes("add LifeOS to the home screen")) return "mobileDevice.pwaRecommendation.addToHome";
  if (recommendation.includes("does not support the offline shell")) return "mobileDevice.pwaRecommendation.offlineShellUnsupported";
  if (recommendation.includes("offline shell is taking control")) return "mobileDevice.pwaRecommendation.refreshForShell";
  if (recommendation.includes("background sync is unavailable")) return "mobileDevice.pwaRecommendation.openChatToSync";
  if (recommendation.includes("IndexedDB is unavailable")) return "mobileDevice.pwaRecommendation.indexedDbUnavailable";
  if (recommendation.includes("You are offline")) return "mobileDevice.pwaRecommendation.offlineQueue";
  return "";
}

export default function MobileDevicePage() {
  const { t } = useI18n();
  const [credential, setCredential] = useState(() => getStoredDeviceCredential());
  const [status, setStatus] = useState<string | null>(null);
  const [pairingInput, setPairingInput] = useState("");
  const [pairingInputError, setPairingInputError] = useState<string | null>(null);
  const [queueSummary, setQueueSummary] = useState(() => getOfflineMessageQueueSummary());
  const [queueItems, setQueueItems] = useState<OfflineQueuedMessage[]>(() => getOfflineMessageQueue());
  const [network, setNetwork] = useState(() => getNetworkStatus());
  const [pwaCapabilities, setPwaCapabilities] = useState(() => getPwaCapabilityStatus());
  const [credentialStorage, setCredentialStorage] = useState<DeviceCredentialStorageStatus | null>(null);
  const [queueStorage, setQueueStorage] = useState<OfflineMessageQueueStorageStatus | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [connectivityTest, setConnectivityTest] = useState<MobileConnectivityResult | null>(null);
  const [lastConnectivityReport, setLastConnectivityReport] = useState<DeviceConnectivityReport | null>(null);
  const [connectivityBusy, setConnectivityBusy] = useState(false);
  const expiresAt = useMemo(() => credential?.accessTokenExpiresAt ? new Date(credential.accessTokenExpiresAt).toLocaleString() : t("mobileDevice.longLivedSignature"), [credential, t]);
  const currentEntry = useMemo(() => getRemoteEntryStatus({ configuredBaseUrl: health?.publicBaseUrl, configuredMode: health?.remoteEntryMode }), [health]);
  const currentEntryGuidance = useMemo(() => getRemoteEntryGuidance(currentEntry, queueSummary), [currentEntry, queueSummary]);
  const lastConnectivityResult = useMemo(() => lastConnectivityReport ? mobileConnectivityResultFromReport(lastConnectivityReport) : null, [lastConnectivityReport]);
  const lastConnectivityIssue = useMemo(() => lastConnectivityResult ? getMobileConnectivityIssue(lastConnectivityResult, currentEntry.kind, queueSummary) : null, [currentEntry.kind, lastConnectivityResult, queueSummary]);
  const lastConnectivityHints = useMemo(() => lastConnectivityResult ? getMobileRecoveryHints(lastConnectivityResult, currentEntry.kind, queueSummary) : [], [currentEntry.kind, lastConnectivityResult, queueSummary]);

  const refreshCredentialStorage = async () => {
    const storage = await getStoredDeviceCredentialStorageStatus().catch(() => null);
    setCredentialStorage(storage);
  };

  useEffect(() => {
    let cancelled = false;
    getStoredDeviceCredentialAsync().then((next) => {
      if (!cancelled) setCredential(next);
      return refreshCredentialStorage();
    });
    getHealth().then((next) => {
      if (!cancelled) setHealth(next);
    }).catch(() => {
      if (!cancelled) setHealth(null);
    });
    getLatestMobileConnectivityReport().then((next) => {
      if (!cancelled) setLastConnectivityReport(next.report);
    }).catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refreshNetwork = () => {
      setNetwork(getNetworkStatus());
      setPwaCapabilities(getPwaCapabilityStatus());
    };
    window.addEventListener("online", refreshNetwork);
    window.addEventListener("offline", refreshNetwork);
    navigator.serviceWorker?.addEventListener?.("controllerchange", refreshNetwork);
    const connection = (navigator as any).connection;
    connection?.addEventListener?.("change", refreshNetwork);
    return () => {
      window.removeEventListener("online", refreshNetwork);
      window.removeEventListener("offline", refreshNetwork);
      navigator.serviceWorker?.removeEventListener?.("controllerchange", refreshNetwork);
      connection?.removeEventListener?.("change", refreshNetwork);
    };
  }, []);

  const refreshQueue = () => {
    setQueueSummary(getOfflineMessageQueueSummary());
    setQueueItems(getOfflineMessageQueue());
    void getOfflineMessageQueueStorageStatus().then(setQueueStorage).catch(() => null);
  };

  useEffect(() => {
    refreshQueue();
    return subscribeOfflineMessageQueue(() => refreshQueue());
  }, []);

  const handleForget = async () => {
    if (!window.confirm(t("mobileDevice.confirmForget"))) return;
    setStatus(t("mobileDevice.unbinding"));
    try {
      await revokeCurrentDeviceBinding();
      await clearStoredDeviceCredential();
      setCredential(null);
      await refreshCredentialStorage();
      setStatus(t("mobileDevice.unboundDone"));
    } catch (error: any) {
      await clearStoredDeviceCredential();
      setCredential(null);
      await refreshCredentialStorage();
      setStatus(t("mobileDevice.localClearedRevokeFailed", { message: error.message || t("mobileDevice.revokeLater") }));
    }
  };

  const handleRotate = async () => {
    setStatus(t("mobileDevice.refreshingCredential"));
    try {
      const next = await rotateDeviceToken();
      setCredential(next);
      await refreshCredentialStorage();
      setStatus(t("mobileDevice.credentialRefreshed"));
    } catch (error: any) {
      setStatus(error.message || t("mobileDevice.refreshFailed"));
    }
  };

  const handleRetryQueue = () => {
    resetFailedOfflineMessages();
    refreshQueue();
    setStatus(t("mobileDevice.failedReset"));
  };

  const handleRetryItem = (item: OfflineQueuedMessage) => {
    retryOfflineMessage(item.id);
    refreshQueue();
    setStatus(t("mobileDevice.itemReset"));
  };

  const handleRemoveItem = (item: OfflineQueuedMessage) => {
    if (!window.confirm(t("mobileDevice.confirmRemoveItem"))) return;
    removeOfflineMessages([item.id]);
    refreshQueue();
    setStatus(t("mobileDevice.itemRemoved"));
  };

  const handleCopyItem = async (item: OfflineQueuedMessage) => {
    const text = item.message.parts.map((part) => part.text).filter(Boolean).join("\n\n") || JSON.stringify(item.message);
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t("mobileDevice.itemCopied"));
    } catch (error: any) {
      setStatus(error.message || t("mobileDevice.copyFailed"));
    }
  };

  const handleClearQueue = async () => {
    if (!window.confirm(t("mobileDevice.confirmClearQueue"))) return;
    await clearOfflineMessageQueue();
    refreshQueue();
    setStatus(t("mobileDevice.queueCleared"));
  };

  const openPairingInput = async (options: { clearCurrent?: boolean } = {}) => {
    const token = extractPairingToken(pairingInput);
    if (!token) {
      setPairingInputError(t("mobile.pairingInvalid"));
      return;
    }
    if (options.clearCurrent) {
      await clearStoredDeviceCredential();
    }
    window.location.href = pairingInstallPath(token);
  };

  const handleConnectivityTest = async () => {
    setConnectivityBusy(true);
    try {
      const result = await testMobileRemoteConnectivity();
      setConnectivityTest(result);
      const saved = await reportMobileConnectivity(result).catch(() => null);
      if (saved?.report) setLastConnectivityReport(saved.report);
    } finally {
      setConnectivityBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.08] bg-[#060a10]/90 px-4 py-3 backdrop-blur-xl">
        <a href="/mobile/chat" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-300">
          <ArrowLeft className="h-4 w-4" />
        </a>
        <div className="flex items-center gap-2 text-sm font-bold">
          <Smartphone className="h-4 w-4 text-cyan-300" />
          {t("mobile.deviceConnection")}
        </div>
        <div className="h-10 w-10" />
      </header>

      <main className="mx-auto max-w-md p-4">
        <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
          {credential ? (
            <>
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10">
                  <ShieldCheck className="h-5 w-5 text-emerald-300" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold">{t("mobileDevice.boundTitle")}</h1>
                  <p className="mt-1 truncate text-sm text-zinc-400">{credential.device.name}</p>
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-sm">
                <Row label={t("mobileDevice.deviceId")} value={credential.device.id} />
                <Row label={t("mobileDevice.authMethod")} value={credential.authMethod === "signature" ? t("mobileDevice.webCryptoSignature") : t("mobileDevice.deviceToken")} />
                <Row label={t("mobileDevice.credentialExpires")} value={expiresAt} />
                <Row label={t("mobileDevice.lastSeen")} value={new Date(credential.device.lastSeenAt).toLocaleString()} />
              </div>
              {credentialStorage ? <CredentialStorageCard storage={credentialStorage} /> : null}
              {credential.authMethod !== "signature" ? (
                <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                    <div>
                      <div className="font-bold">{t("mobileDevice.upgradeTitle")}</div>
                      <p className="mt-1 leading-relaxed text-amber-100/75">
                        {t("mobileDevice.upgradeBody")}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                  <div className="flex gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                    <div>
                      <div className="font-bold">{t("mobileDevice.signatureEnabled")}</div>
                      <p className="mt-1 leading-relaxed text-emerald-100/75">
                        {t("mobileDevice.signatureBody")}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {status ? <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-zinc-300">{status}</div> : null}
              <PairingLinkPanel
                value={pairingInput}
                error={pairingInputError}
                onChange={(value) => {
                  setPairingInput(value);
                  setPairingInputError(null);
                }}
                onSubmit={() => openPairingInput({ clearCurrent: true })}
                buttonLabel={t("mobileDevice.rebindButton")}
                title={t("mobileDevice.rebindTitle")}
                body={t("mobileDevice.rebindBody")}
              />
              <div className="mt-5 grid gap-3">
                <button onClick={handleRotate} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200">
                  <RefreshCw className="h-4 w-4" />
                  {t("mobileDevice.refreshCredential")}
                </button>
                <button onClick={handleForget} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                  <LogOut className="h-4 w-4" />
                  {t("mobileDevice.forgetBinding")}
                </button>
              </div>
            </>
          ) : (
            <div className="py-8 text-center">
              <KeyRound className="mx-auto mb-5 h-12 w-12 text-amber-300" />
              <h1 className="text-lg font-bold">{t("mobileDevice.notBoundTitle")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{t("mobileDevice.notBoundBody")}</p>
              {status ? <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-sm text-zinc-300">{status}</div> : null}
              <PairingLinkPanel
                value={pairingInput}
                error={pairingInputError}
                onChange={(value) => {
                  setPairingInput(value);
                  setPairingInputError(null);
                }}
                onSubmit={() => openPairingInput()}
                buttonLabel={t("mobile.usePairingLink")}
                body={t("mobileDevice.notBoundPairingBody")}
              />
            </div>
          )}
        </section>
        <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10">
              <Download className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-base font-bold">{t("mobileDevice.pwaTitle")}</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                {t("mobileDevice.pwaBody")}
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-sm">
            <CapabilityRow label={t("mobileDevice.standaloneMode")} ok={pwaCapabilities.standalone} value={pwaCapabilities.standalone ? t("mobileDevice.startedFromIcon") : t("mobileDevice.browserTab")} />
            <CapabilityRow label="Service Worker" ok={pwaCapabilities.serviceWorkerSupported && pwaCapabilities.serviceWorkerControlled} value={pwaCapabilities.serviceWorkerControlled ? t("mobileDevice.offlineShellControlled") : pwaCapabilities.serviceWorkerSupported ? t("mobileDevice.supportedWaiting") : t("mobileDevice.unsupported")} />
            <CapabilityRow label="Background Sync" ok={pwaCapabilities.backgroundSyncSupported} value={pwaCapabilities.backgroundSyncSupported ? t("mobileDevice.backgroundSyncOk") : t("mobileDevice.openChatToSync")} />
            <CapabilityRow label="IndexedDB" ok={pwaCapabilities.indexedDbSupported} value={pwaCapabilities.indexedDbSupported ? t("mobileDevice.indexedDbCredentialOk") : t("mobileDevice.unavailable")} />
          </div>
          {pwaCapabilities.recommendations.length ? (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
              {pwaCapabilities.recommendations.map((recommendation) => {
                const key = pwaRecommendationKey(recommendation);
                return <div key={recommendation}>{key ? t(key as any) : recommendation}</div>;
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
              {t("mobileDevice.capabilityComplete")}
            </div>
          )}
        </section>
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
          <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-sm">
            <Row label={t("mobileDevice.currentEntry")} value={currentEntry.currentBase || "-"} />
            <Row label={t("mobileDevice.desktopEntry")} value={currentEntry.configuredBase || t("mobileDevice.desktopEntryUnset")} />
            <Row label={t("mobileDevice.networkMode")} value={health?.networkMode || "-"} />
            <Row label={t("mobileDevice.remoteVerdict")} value={t(currentEntry.titleKey as any)} />
          </div>
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
            <div className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${lastConnectivityReport.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-red-400/20 bg-red-500/10 text-red-100"}`}>
              <div className="font-bold">
                {lastConnectivityReport.ok ? t("mobileDevice.lastConnectivityOk") : t("mobileDevice.lastConnectivityFailed")}
              </div>
              <div className="mt-1 opacity-85">
                {t("mobileDevice.lastConnectivityBody", {
                  time: new Date(lastConnectivityReport.createdAt).toLocaleString(),
                  entry: lastConnectivityReport.currentBaseUrl,
                  latency: lastConnectivityReport.latencyMs,
                })}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
                  <div className="font-bold">{lastConnectivityReport.healthOk ? t("mobileDevice.pass") : t("mobileDevice.fail")}</div>
                  <div className="mt-1 opacity-75">{t("mobileDevice.connectivityHealth")}</div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
                  <div className="font-bold">{lastConnectivityReport.mobileShellOk ? t("mobileDevice.pass") : t("mobileDevice.fail")}</div>
                  <div className="mt-1 opacity-75">{t("mobileDevice.connectivityMobileShell")}</div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-black/10 p-2">
                  <div className="font-bold">{lastConnectivityReport.websocketOk ? t("mobileDevice.pass") : t("mobileDevice.fail")}</div>
                  <div className="mt-1 opacity-75">{t("mobileDevice.connectivityRealtime")}</div>
                </div>
              </div>
              {lastConnectivityReport.error ? <div className="mt-2 opacity-85">{t("mobileDevice.lastConnectivityError", { message: lastConnectivityReport.error })}</div> : null}
              {lastConnectivityIssue && lastConnectivityIssue !== "mobileDevice.connectivityIssueOk" ? (
                <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/10 p-2">
                  <div className="font-bold">{t("mobileDevice.lastConnectivityFixTitle")}</div>
                  <div className="mt-1 font-bold opacity-90">{t(lastConnectivityIssue as any)}</div>
                  <div className="mt-2 space-y-1 opacity-80">
                    {lastConnectivityHints.map((hint) => <div key={hint}>{t(hint as any)}</div>)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            onClick={handleConnectivityTest}
            disabled={connectivityBusy}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
            {connectivityBusy ? t("mobileDevice.connectivityTesting") : t("mobileDevice.connectivityTest")}
          </button>
          {connectivityTest ? <MobileConnectivityCard result={connectivityTest} entryKind={currentEntry.kind} queueSummary={queueSummary} onRetry={handleConnectivityTest} /> : null}
        </section>
        <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${network.quality === "offline" ? "border-red-400/20 bg-red-500/10" : network.quality === "poor" ? "border-amber-400/20 bg-amber-500/10" : "border-cyan-400/20 bg-cyan-500/10"}`}>
              <Wifi className={`h-5 w-5 ${network.quality === "offline" ? "text-red-300" : network.quality === "poor" ? "text-amber-300" : "text-cyan-300"}`} />
            </div>
            <div>
              <h2 className="text-base font-bold">{t("mobileDevice.connectionQueue")}</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t(network.labelKey as any)}</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <Metric label={t("mobileDevice.total")} value={queueSummary.count} tone="text-zinc-100" />
            <Metric label={t("mobileDevice.pending")} value={queueSummary.pending} tone="text-cyan-200" />
            <Metric label={t("mobileDevice.syncing")} value={queueSummary.syncing} tone="text-amber-200" />
            <Metric label={t("mobileDevice.failed")} value={queueSummary.failed} tone="text-red-200" />
          </div>
          {queueSummary.lastSyncedAt && queueSummary.lastSyncedCount ? (
            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
              <div className="font-bold">{t("offlineQueue.lastSyncedTitle")}</div>
              <div className="mt-1 opacity-85">
                {t("offlineQueue.lastSyncedBody", {
                  count: queueSummary.lastSyncedCount,
                  time: new Date(queueSummary.lastSyncedAt).toLocaleString(),
                })}
              </div>
            </div>
          ) : null}
          {queueSummary.count > 0 ? (
            <div className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${currentEntry.okForRemote ? "border-cyan-400/20 bg-cyan-500/10 text-cyan-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
              <div className="font-bold">{t("offlineQueue.remoteEntryTitle", { entry: t(currentEntry.titleKey as any) })}</div>
              <div className="mt-1 opacity-85">{t("offlineQueue.remoteEntryBody")}</div>
              <div className="mt-2 space-y-1 border-t border-current/15 pt-2 opacity-90">
                {currentEntryGuidance.map((hint) => <div key={hint}>{t(hint as any)}</div>)}
              </div>
            </div>
          ) : null}
          {queueSummary.lastError ? (
            <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-relaxed text-red-100">
              {t("mobileDevice.lastError", { message: queueSummary.lastError })}
              {queueSummary.nextRetryAt ? (
                <span className="mt-1 block text-red-100/75">{t("mobileDevice.nextRetry", { time: new Date(queueSummary.nextRetryAt).toLocaleString() })}</span>
              ) : null}
            </div>
          ) : null}
          {queueStorage ? <QueueStorageCard storage={queueStorage} /> : null}
          {queueItems.length ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-200">{t("mobileDevice.queueDetails")}</span>
                <span className="text-zinc-500">{t("mobileDevice.recentItems", { shown: Math.min(queueItems.length, 5), total: queueItems.length })}</span>
              </div>
              {queueItems.slice(0, 5).map((item) => (
                <div key={item.id}>
                  <QueueItem
                    item={item}
                    onRetry={() => handleRetryItem(item)}
                    onCopy={() => handleCopyItem(item)}
                    onRemove={() => handleRemoveItem(item)}
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-5 grid gap-3">
            <a href="/mobile/chat" className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200">
              <RefreshCw className="h-4 w-4" />
              {t("mobileDevice.openChatSync")}
            </a>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleRetryQueue} disabled={queueSummary.failed === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-100 disabled:opacity-45">
                <RefreshCw className="h-4 w-4" />
                {t("mobileDevice.retryFailed")}
              </button>
              <button onClick={handleClearQueue} disabled={queueSummary.count === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200 disabled:opacity-45">
                <Trash2 className="h-4 w-4" />
                {t("mobileDevice.clearQueue")}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
