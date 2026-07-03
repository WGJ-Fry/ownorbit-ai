import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Download, KeyRound, LogOut, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { clearStoredDeviceCredential, getHealth, getLatestMobileConnectivityReport, getStoredDeviceCredential, getStoredDeviceCredentialAsync, getStoredDeviceCredentialExpiryStatus, getStoredDeviceCredentialStorageStatus, reportMobileConnectivity, revokeCurrentDeviceBinding, rotateDeviceToken } from "../../services/lifeosApi";
import type { DeviceConnectivityReport, DeviceCredentialStorageStatus } from "../../services/lifeosApi";
import { clearOfflineMessageQueue, getOfflineMessageConflictGroups, getOfflineMessageQueue, getOfflineMessageQueueRecoverySummary, getOfflineMessageQueueStorageStatus, getOfflineMessageQueueSummary, removeFailedOfflineMessages, removeOfflineMessages, requestOfflineMessageQueuePersistentStorage, resolveOfflineMessageConflictGroup, retryFailedOfflineMessages, retryOfflineMessage, subscribeOfflineMessageQueue } from "../../services/offlineMessageQueue";
import type { OfflineMessageConflictGroup, OfflineMessageConflictResolutionOption, OfflineMessageQueueStorageStatus, OfflineQueuedMessage } from "../../services/offlineMessageQueue";
import { getNetworkStatus } from "../../services/networkStatus";
import { extractPairingToken, pairingInstallPath } from "../../services/mobilePairingIntent";
import { getMobileConnectivityIssue, getMobileRecoveryHints, getPwaCapabilityStatus, getRemoteEntryGuidance, getRemoteEntryStatus, mobileConnectivityResultFromReport, testMobileRemoteConnectivity } from "../../services/pwaCapabilities";
import type { MobileConnectivityResult } from "../../services/pwaCapabilities";
import { getPwaServiceWorkerLifecycleStatus, subscribePwaServiceWorkerLifecycle } from "../../services/pwaServiceWorkerLifecycle";
import type { PwaServiceWorkerLifecycleStatus } from "../../services/pwaServiceWorkerLifecycle";
import MobileConnectionRecoveryCard from "./MobileConnectionRecoveryCard";
import MobileDeviceHealthSummary from "./MobileDeviceHealthSummary";
import MobileGeneratedToolsCard from "./MobileGeneratedToolsCard";
import MobileOfflineQueueRecoveryCard from "./MobileOfflineQueueRecoveryCard";
import MobileOfflineQueuePanel from "./MobileOfflineQueuePanel";
import MobileRemoteEntryCard from "./MobileRemoteEntryCard";
import { CapabilityRow, CredentialExpiryCard, CredentialStorageCard, PairingLinkPanel, Row } from "./MobileDeviceStatusCards";
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
  const [showAllQueueItems, setShowAllQueueItems] = useState(false);
  const [network, setNetwork] = useState(() => getNetworkStatus());
  const [pwaCapabilities, setPwaCapabilities] = useState(() => getPwaCapabilityStatus());
  const [credentialStorage, setCredentialStorage] = useState<DeviceCredentialStorageStatus | null>(null);
  const [queueStorage, setQueueStorage] = useState<OfflineMessageQueueStorageStatus | null>(null);
  const [swLifecycle, setSwLifecycle] = useState<PwaServiceWorkerLifecycleStatus | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getHealth>> | null>(null);
  const [connectivityTest, setConnectivityTest] = useState<MobileConnectivityResult | null>(null);
  const [lastConnectivityReport, setLastConnectivityReport] = useState<DeviceConnectivityReport | null>(null);
  const [connectivityBusy, setConnectivityBusy] = useState(false);
  const [serverRefreshBusy, setServerRefreshBusy] = useState(false);
  const pairingPanelRef = useRef<HTMLDivElement | null>(null);
  const pairingInputRef = useRef<HTMLInputElement | null>(null);
  const expiresAt = useMemo(() => credential?.accessTokenExpiresAt ? new Date(credential.accessTokenExpiresAt).toLocaleString() : t("mobileDevice.longLivedSignature"), [credential, t]);
  const credentialExpiry = useMemo(() => getStoredDeviceCredentialExpiryStatus(credential), [credential]);
  const currentEntry = useMemo(() => getRemoteEntryStatus({ configuredBaseUrl: health?.publicBaseUrl, configuredMode: health?.remoteEntryMode }), [health]);
  const currentEntryGuidance = useMemo(() => getRemoteEntryGuidance(currentEntry, queueSummary), [currentEntry, queueSummary]);
  const lastConnectivityResult = useMemo(() => lastConnectivityReport ? mobileConnectivityResultFromReport(lastConnectivityReport) : null, [lastConnectivityReport]);
  const lastConnectivityIssue = useMemo(() => lastConnectivityResult ? getMobileConnectivityIssue(lastConnectivityResult, currentEntry.kind, queueSummary) : null, [currentEntry.kind, lastConnectivityResult, queueSummary]);
  const lastConnectivityHints = useMemo(() => lastConnectivityResult ? getMobileRecoveryHints(lastConnectivityResult, currentEntry.kind, queueSummary) : [], [currentEntry.kind, lastConnectivityResult, queueSummary]);
  const conflictGroups = useMemo(() => getOfflineMessageConflictGroups(queueItems), [queueItems]);
  const queueRecovery = useMemo(() => getOfflineMessageQueueRecoverySummary(queueItems, { online: network.online, networkQuality: network.quality, remoteOk: currentEntry.okForRemote }), [currentEntry.okForRemote, network.online, network.quality, queueItems]);
  const connectivityReportStale = Boolean(lastConnectivityReport && Date.now() - lastConnectivityReport.createdAt > 6 * 60 * 60 * 1000);

  const refreshCredentialStorage = async () => {
    const storage = await getStoredDeviceCredentialStorageStatus().catch(() => null);
    setCredentialStorage(storage);
  };

  const refreshServerState = async (options: { announce?: boolean } = {}) => {
    if (options.announce) {
      setServerRefreshBusy(true);
      setStatus(null);
    }
    try {
      const [healthResult, reportResult] = await Promise.allSettled([
        getHealth(),
        getLatestMobileConnectivityReport(),
      ]);
      if (healthResult.status === "fulfilled") setHealth(healthResult.value);
      if (reportResult.status === "fulfilled") setLastConnectivityReport(reportResult.value.report);
      if (options.announce) setStatus(t("mobileDevice.serverStateRefreshed"));
    } catch (error: any) {
      if (options.announce) setStatus(error.message || t("mobileDevice.serverStateRefreshFailed"));
    } finally {
      if (options.announce) setServerRefreshBusy(false);
    }
  };

  const refreshServiceWorkerLifecycle = () => {
    void getPwaServiceWorkerLifecycleStatus().then(setSwLifecycle).catch(() => setSwLifecycle(null));
  };

  useEffect(() => {
    let cancelled = false;
    getStoredDeviceCredentialAsync().then((next) => {
      if (!cancelled) setCredential(next);
      return refreshCredentialStorage();
    });
    refreshServiceWorkerLifecycle();
    Promise.allSettled([getHealth(), getLatestMobileConnectivityReport()]).then(([healthResult, reportResult]) => {
      if (cancelled) return;
      setHealth(healthResult.status === "fulfilled" ? healthResult.value : null);
      if (reportResult.status === "fulfilled") setLastConnectivityReport(reportResult.value.report);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refreshNetwork = () => {
      setNetwork(getNetworkStatus());
      setPwaCapabilities(getPwaCapabilityStatus());
      refreshServiceWorkerLifecycle();
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

  useEffect(() => subscribePwaServiceWorkerLifecycle(refreshServiceWorkerLifecycle), []);

  const refreshQueue = () => {
    setQueueSummary(getOfflineMessageQueueSummary());
    setQueueItems(getOfflineMessageQueue());
    void getOfflineMessageQueueStorageStatus().then(setQueueStorage).catch(() => null);
  };

  const refreshRecoverableState = () => {
    setNetwork(getNetworkStatus());
    setPwaCapabilities(getPwaCapabilityStatus());
    refreshServiceWorkerLifecycle();
    refreshQueue();
    void refreshServerState();
  };

  useEffect(() => {
    refreshQueue();
    return subscribeOfflineMessageQueue(() => refreshQueue());
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshRecoverableState();
    };
    window.addEventListener("focus", refreshRecoverableState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshRecoverableState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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

  const focusPairingPanel = () => {
    pairingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      pairingInputRef.current?.focus();
      pairingInputRef.current?.select();
    }, 180);
  };

  const handleRetryQueue = () => {
    const result = retryFailedOfflineMessages();
    refreshQueue();
    setStatus(result.retriedIds.length === 1
      ? t("mobileDevice.failedReset")
      : t("mobileDevice.failedResetDetailed", { count: result.retriedIds.length }));
  };

  const handleRemoveFailedQueue = () => {
    if (!window.confirm(t("mobileDevice.confirmRemoveFailedQueueDetailed", { count: queueSummary.failed }))) return;
    const result = removeFailedOfflineMessages();
    refreshQueue();
    setStatus(t("mobileDevice.failedRemoved", { count: result.removedIds.length }));
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

  const handleResolveConflictGroup = (group: OfflineMessageConflictGroup, option: OfflineMessageConflictResolutionOption) => {
    const result = resolveOfflineMessageConflictGroup(group.fingerprint, option.keepId || group.keepId, option.id);
    refreshQueue();
    if (!result) {
      setStatus(t("mobileDevice.conflictAlreadyResolved"));
      return;
    }
    if (result.removedIds.length === 0) {
      setStatus(t("mobileDevice.conflictReviewed"));
      return;
    }
    setStatus(t("mobileDevice.conflictResolved", { count: result.removedIds.length }));
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
    if (!window.confirm(t("mobileDevice.confirmClearQueueDetailed", {
      count: queueSummary.count,
      pending: queueSummary.pending,
      syncing: queueSummary.syncing,
      failed: queueSummary.failed,
    }))) return;
    await clearOfflineMessageQueue();
    refreshQueue();
    setStatus(t("mobileDevice.queueCleared"));
  };

  const handleRequestPersistentStorage = async () => {
    const result = await requestOfflineMessageQueuePersistentStorage();
    await getOfflineMessageQueueStorageStatus().then(setQueueStorage).catch(() => null);
    setStatus(result.supported
      ? result.granted
        ? t("mobileDevice.persistentStorageGranted")
        : t("mobileDevice.persistentStorageDenied")
      : t("mobileDevice.persistentStorageUnsupported"));
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
        <MobileDeviceHealthSummary
          credential={credential}
          credentialStorage={credentialStorage}
          pwaCapabilities={pwaCapabilities}
          queueSummary={queueSummary}
          queueStorage={queueStorage}
          network={network}
          swLifecycle={swLifecycle}
          currentEntry={currentEntry}
          lastConnectivityResult={lastConnectivityResult}
        />
        {credential ? (
          <MobileConnectionRecoveryCard
            connectivityBusy={connectivityBusy}
            currentEntry={currentEntry}
            lastConnectivityIssue={lastConnectivityIssue}
            lastConnectivityReport={lastConnectivityReport}
            queueSummary={queueSummary}
            serverRefreshBusy={serverRefreshBusy}
            stale={connectivityReportStale}
            onConnectivityTest={handleConnectivityTest}
            onFocusPairing={focusPairingPanel}
            onRefreshServer={() => refreshServerState({ announce: true })}
          />
        ) : null}
        {credential ? <MobileGeneratedToolsCard /> : null}
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
              <CredentialExpiryCard
                status={credentialExpiry}
                onRefresh={handleRotate}
                onFocusPairing={focusPairingPanel}
              />
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
              <div ref={pairingPanelRef}>
                <PairingLinkPanel
                  inputRef={pairingInputRef}
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
              </div>
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
            {swLifecycle ? (
              <CapabilityRow label={t("mobileDevice.swLifecycle")} ok={swLifecycle.tone === "ok"} value={t(swLifecycle.titleKey as any)} />
            ) : null}
          </div>
          {swLifecycle ? (
            <div className={`mt-4 rounded-2xl border p-3 text-xs leading-relaxed ${swLifecycle.tone === "ok" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : swLifecycle.tone === "warn" ? "border-amber-400/20 bg-amber-500/10 text-amber-100" : "border-red-400/20 bg-red-500/10 text-red-100"}`}>
              <div className="font-bold">{t(swLifecycle.titleKey as any)}</div>
              <div className="mt-1 opacity-80">{t(swLifecycle.bodyKey as any)}</div>
            </div>
          ) : null}
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
        <MobileRemoteEntryCard
          connectivityBusy={connectivityBusy}
          connectivityReportStale={connectivityReportStale}
          connectivityTest={connectivityTest}
          currentEntry={currentEntry}
          currentEntryGuidance={currentEntryGuidance}
          healthNetworkMode={health?.networkMode}
          lastConnectivityHints={lastConnectivityHints}
          lastConnectivityIssue={lastConnectivityIssue}
          lastConnectivityReport={lastConnectivityReport}
          queueSummary={queueSummary}
          serverRefreshBusy={serverRefreshBusy}
          onConnectivityTest={handleConnectivityTest}
          onRefreshServer={() => refreshServerState({ announce: true })}
        />
        <MobileOfflineQueueRecoveryCard
          recovery={queueRecovery}
          onRetryFailed={handleRetryQueue}
          onRemoveFailed={handleRemoveFailedQueue}
        />
        <MobileOfflineQueuePanel
          network={network}
          queueSummary={queueSummary}
          queueItems={queueItems}
          conflictGroups={conflictGroups}
          queueStorage={queueStorage}
          currentEntry={currentEntry}
          currentEntryGuidance={currentEntryGuidance}
          showAllQueueItems={showAllQueueItems}
          onShowAllQueueItemsChange={setShowAllQueueItems}
          onRequestPersistentStorage={handleRequestPersistentStorage}
          onRetryQueue={handleRetryQueue}
          onClearQueue={handleClearQueue}
          onRetryItem={handleRetryItem}
          onCopyItem={handleCopyItem}
          onRemoveItem={handleRemoveItem}
          onResolveConflictGroup={handleResolveConflictGroup}
        />
      </main>
    </div>
  );
}
