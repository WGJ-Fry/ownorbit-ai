import { useState } from "react";
import { Copy, RefreshCw, Trash2, Wifi } from "lucide-react";
import type { NetworkStatus } from "../../services/networkStatus";
import type { OfflineMessageQueueStorageStatus, OfflineMessageQueueSummary, OfflineQueuedMessage } from "../../services/offlineMessageQueue";
import { buildOfflineQueueBackupText } from "../../services/offlineQueueBackup";
import { buildOfflineQueueHealth } from "../../services/offlineQueueHealth";
import type { RemoteEntryStatus } from "../../services/pwaCapabilities";
import { useI18n } from "../../i18n/I18nProvider";
import { Metric } from "./MobileDeviceStatusCards";
import { MobileOfflineQueueHealthCard } from "./MobileOfflineQueueHealthCard";
import { QueueItem, QueueStorageCard } from "./MobileOfflineQueueCards";

type MobileOfflineQueuePanelProps = {
  network: NetworkStatus;
  queueSummary: OfflineMessageQueueSummary;
  queueItems: OfflineQueuedMessage[];
  queueStorage: OfflineMessageQueueStorageStatus | null;
  currentEntry: RemoteEntryStatus;
  currentEntryGuidance: string[];
  showAllQueueItems: boolean;
  onShowAllQueueItemsChange: (value: boolean) => void;
  onRequestPersistentStorage: () => void;
  onRetryQueue: () => void;
  onClearQueue: () => void;
  onRetryItem: (item: OfflineQueuedMessage) => void;
  onCopyItem: (item: OfflineQueuedMessage) => void;
  onRemoveItem: (item: OfflineQueuedMessage) => void;
};

export default function MobileOfflineQueuePanel({
  network,
  queueSummary,
  queueItems,
  queueStorage,
  currentEntry,
  currentEntryGuidance,
  showAllQueueItems,
  onShowAllQueueItemsChange,
  onRequestPersistentStorage,
  onRetryQueue,
  onClearQueue,
  onRetryItem,
  onCopyItem,
  onRemoveItem,
}: MobileOfflineQueuePanelProps) {
  const { t } = useI18n();
  const [copiedQueueBackup, setCopiedQueueBackup] = useState(false);
  const visibleQueueItems = showAllQueueItems ? queueItems : queueItems.slice(0, 5);
  const queueHealth = buildOfflineQueueHealth(queueSummary, queueStorage, network, currentEntry);
  const networkTone = network.quality === "offline"
    ? "border-red-400/20 bg-red-500/10 text-red-300"
    : network.quality === "poor"
      ? "border-amber-400/20 bg-amber-500/10 text-amber-300"
      : "border-cyan-400/20 bg-cyan-500/10 text-cyan-300";
  const copyQueueBackup = async () => {
    await navigator.clipboard.writeText(buildOfflineQueueBackupText(queueSummary, queueItems)).catch(() => null);
    setCopiedQueueBackup(true);
    window.setTimeout(() => setCopiedQueueBackup(false), 1400);
  };

  return (
    <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${networkTone}`}>
          <Wifi className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-bold">{t("mobileDevice.connectionQueue")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t(network.labelKey as any)}</p>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2 text-center text-xs">
        <Metric label={t("mobileDevice.total")} value={queueSummary.count} tone="text-zinc-100" />
        <Metric label={t("mobileDevice.pending")} value={queueSummary.pending} tone="text-cyan-200" />
        <Metric label={t("mobileDevice.syncing")} value={queueSummary.syncing} tone="text-amber-200" />
        <Metric label={t("mobileDevice.failed")} value={queueSummary.failed} tone="text-red-200" />
        <Metric label={t("mobileDevice.conflicts")} value={queueSummary.conflicts} tone="text-orange-200" />
      </div>
      <MobileOfflineQueueHealthCard health={queueHealth} />
      {queueSummary.oldestQueuedAt ? (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-relaxed text-zinc-300">
          <div className="font-bold text-zinc-100">{t("offlineQueue.waitingSinceTitle")}</div>
          <div className="mt-1">
            {t("offlineQueue.waitingSinceBody", {
              oldest: new Date(queueSummary.oldestQueuedAt).toLocaleString(),
              newest: queueSummary.newestQueuedAt ? new Date(queueSummary.newestQueuedAt).toLocaleString() : "-",
            })}
          </div>
        </div>
      ) : null}
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
      {queueSummary.count === 0 ? (
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
          <div className="font-bold">{t("offlineQueue.emptyTitle")}</div>
          <div className="mt-1 opacity-85">{t("offlineQueue.emptyBody")}</div>
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
      {queueStorage ? <QueueStorageCard storage={queueStorage} onRequestPersistence={onRequestPersistentStorage} /> : null}
      {queueItems.length ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-zinc-200">{t("mobileDevice.queueDetails")}</span>
            <span className="text-zinc-500">{t("mobileDevice.recentItems", { shown: visibleQueueItems.length, total: queueItems.length })}</span>
          </div>
          {visibleQueueItems.map((item) => (
            <div key={item.id}>
              <QueueItem
                item={item}
                onRetry={() => onRetryItem(item)}
                onCopy={() => onCopyItem(item)}
                onRemove={() => onRemoveItem(item)}
              />
            </div>
          ))}
          {queueItems.length > 5 ? (
            <button
              onClick={() => onShowAllQueueItemsChange(!showAllQueueItems)}
              className="inline-flex w-full items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-200"
            >
              {showAllQueueItems ? t("offlineQueue.showRecentOnly") : t("offlineQueue.showAll", { count: queueItems.length - visibleQueueItems.length })}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 grid gap-3">
        <a href="/mobile/chat" className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200">
          <RefreshCw className="h-4 w-4" />
          {t("mobileDevice.openChatSync")}
        </a>
        <div className="grid gap-3">
          <button onClick={copyQueueBackup} disabled={queueSummary.count === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-100 disabled:opacity-45">
            <Copy className="h-4 w-4" />
            {copiedQueueBackup ? t("offlineQueue.backupCopied") : t("offlineQueue.copyBackup")}
          </button>
          <button onClick={onRetryQueue} disabled={queueSummary.failed === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-100 disabled:opacity-45">
            <RefreshCw className="h-4 w-4" />
            {t("mobileDevice.retryFailed")}
          </button>
          <button onClick={onClearQueue} disabled={queueSummary.count === 0} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200 disabled:opacity-45">
            <Trash2 className="h-4 w-4" />
            {t("mobileDevice.clearQueue")}
          </button>
        </div>
      </div>
    </section>
  );
}
