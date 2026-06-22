import {
  formatOfflineMessageQueueBytes,
  getOfflineMessageNextRetryAt,
  getOfflineMessageQueueStorageLabel,
  getOfflineMessageQueueUsageLabel,
  type OfflineMessageQueueStorageStatus,
  type OfflineQueuedMessage,
} from "../../services/offlineMessageQueue";
import { useI18n } from "../../i18n/I18nProvider";

function recommendationKey(recommendation: string) {
  if (recommendation.includes("cannot write to the local queue")) return "offlineQueue.recommendation.unavailable";
  if (recommendation.includes("IndexedDB is unavailable")) return "offlineQueue.recommendation.indexedDb";
  if (recommendation.includes("near its limit")) return "offlineQueue.recommendation.itemLimit";
  if (recommendation.includes("near its storage budget")) return "offlineQueue.recommendation.byteLimit";
  if (recommendation.includes("Browser storage is near its limit")) return "offlineQueue.recommendation.browserStorage";
  if (recommendation.includes("Persistent storage has not been granted")) return "offlineQueue.recommendation.persistentStorage";
  if (recommendation.includes("offline queue is empty")) return "offlineQueue.recommendation.empty";
  return "";
}

export function QueueStorageCard({ storage }: { storage: OfflineMessageQueueStorageStatus }) {
  const { t } = useI18n();
  const tone = storage.available && !storage.nearItemLimit && !storage.nearByteLimit && (storage.usageRatio === undefined || storage.usageRatio <= 0.8)
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
    : "border-amber-400/20 bg-amber-500/10 text-amber-100";
  const storageLabel = getOfflineMessageQueueStorageLabel(storage.storage);
  return (
    <div className={`mt-4 rounded-2xl border p-4 text-xs ${tone}`}>
      <div className="mb-2 font-bold">{t("offlineQueue.storageTitle", { storage: storageLabel })}</div>
      <div className="grid gap-1 opacity-85">
        <div>{t("offlineQueue.count", { count: storage.count, max: storage.maxItems })}</div>
        <div>{t("offlineQueue.size", { size: `${formatOfflineMessageQueueBytes(storage.bytes)} / ${formatOfflineMessageQueueBytes(storage.maxBytes)}` })}</div>
        <div>{t("offlineQueue.indexedDb")}：{storage.indexedDbAvailable ? t("offlineQueue.available") : t("offlineQueue.unavailable")}</div>
        <div>{t("offlineQueue.legacyMirror")}：{storage.legacyLocalStoragePresent ? t("offlineQueue.exists") : t("offlineQueue.none")}</div>
        <div>{t("offlineQueue.browserUsage", { value: getOfflineMessageQueueUsageLabel(storage) })}</div>
        <div>{t("offlineQueue.persistentStorage", { value: storage.persistentStorageGranted === true ? t("offlineQueue.granted") : storage.persistentStorageGranted === false ? t("offlineQueue.denied") : t("offlineQueue.notReported") })}</div>
      </div>
      {storage.recommendations.length ? (
        <div className="mt-3 space-y-1 border-t border-current/15 pt-3 leading-relaxed opacity-90">
          {storage.recommendations.map((recommendation) => {
            const key = recommendationKey(recommendation);
            return <div key={recommendation}>{key ? t(key as any) : recommendation}</div>;
          })}
        </div>
      ) : null}
    </div>
  );
}

export function QueueItem({ item, onRetry, onRemove, onCopy }: { item: OfflineQueuedMessage; onRetry: () => void; onRemove: () => void; onCopy?: () => void }) {
  const { t } = useI18n();
  const preview = item.message.parts.find((part) => part.text)?.text || t("offlineQueue.attachmentMessage");
  const nextRetryAt = getOfflineMessageNextRetryAt(item);
  const retryReady = typeof nextRetryAt === "number" && nextRetryAt <= Date.now();
  const statusLabel = item.status === "failed" ? t("offlineQueue.status.failed") : item.status === "syncing" ? t("offlineQueue.status.syncing") : t("offlineQueue.status.pending");
  const retryLabel = !nextRetryAt ? "" : retryReady ? t("offlineQueue.readyToRetry") : t("offlineQueue.nextRetry", { time: new Date(nextRetryAt).toLocaleTimeString() });
  const statusClass = item.status === "failed" ? "border-red-400/20 bg-red-500/10 text-red-100" : item.status === "syncing" ? "border-amber-400/20 bg-amber-500/10 text-amber-100" : "border-cyan-400/20 bg-cyan-500/10 text-cyan-100";
  const manualRetryLabel = item.lastManualRetryAt
    ? t("offlineQueue.manualRetryMeta", { count: item.manualRetryCount || 1, time: new Date(item.lastManualRetryAt).toLocaleTimeString() })
    : "";
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-bold text-zinc-100">{preview}</div>
          <div className="mt-1 text-zinc-500">
            {new Date(item.queuedAt).toLocaleString()} · {t("offlineQueue.attempted", { count: item.attempts })}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass}`}>{statusLabel}</span>
      </div>
      {item.lastError ? <div className="mt-2 rounded-xl border border-red-400/20 bg-red-500/10 p-2 leading-relaxed text-red-100">{t("offlineQueue.failureReason", { message: item.lastError })}</div> : null}
      {retryLabel ? (
        <div
          aria-label={t("offlineQueue.nextRetryAria", { preview })}
          className="mt-2 rounded-xl border border-amber-400/20 bg-amber-500/10 p-2 leading-relaxed text-amber-100"
        >
          {retryLabel}
        </div>
      ) : null}
      {manualRetryLabel ? <div className="mt-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 p-2 leading-relaxed text-cyan-100">{manualRetryLabel}</div> : null}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button aria-label={t("offlineQueue.retryAria", { preview })} onClick={onRetry} className="inline-flex items-center justify-center rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 font-bold text-amber-100">
          {t("offlineQueue.retryOne")}
        </button>
        <button aria-label={t("offlineQueue.copyAria", { preview })} onClick={onCopy} className="inline-flex items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 font-bold text-cyan-100">
          {t("offlineQueue.copy")}
        </button>
        <button aria-label={t("offlineQueue.removeAria", { preview })} onClick={onRemove} className="inline-flex items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 font-bold text-red-200">
          {t("offlineQueue.remove")}
        </button>
      </div>
    </div>
  );
}
