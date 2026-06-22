import { getOfflineMessageNextRetryAt } from "../../services/offlineMessageQueue";
import type { OfflineQueuedMessage } from "../../services/offlineMessageQueue";
import type { NetworkStatus } from "../../services/networkStatus";
import { useI18n } from "../../i18n/I18nProvider";

type OfflineQueueSummary = {
  count: number;
  pending: number;
  syncing: number;
  failed: number;
  lastError?: string;
  nextRetryAt?: number;
};

type OfflineQueueBannerProps = {
  items: OfflineQueuedMessage[];
  status: "idle" | "syncing" | "error";
  summary: OfflineQueueSummary;
  onClear: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onSyncAll: () => void;
  network: NetworkStatus;
};

export default function OfflineQueueBanner({
  items,
  status,
  summary,
  onClear,
  onRemove,
  onRetry,
  onSyncAll,
  network,
}: OfflineQueueBannerProps) {
  const { t } = useI18n();
  const networkLabel = t(network.labelKey as any);
  if (summary.count === 0 && network.quality !== "offline" && network.quality !== "poor") return null;

  return (
    <div className={`rounded-2xl border p-3 text-xs font-semibold ${network.quality === "offline" ? "border-red-400/20 bg-red-500/10 text-red-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          {summary.count === 0
            ? networkLabel
            : status === "syncing"
              ? t("offlineQueue.syncing", { count: summary.syncing || summary.count })
              : status === "error"
                ? t("offlineQueue.syncFailed", { count: summary.failed || summary.count })
                : t("offlineQueue.waiting", { count: summary.pending || summary.count })}
          {network.quality === "poor" && summary.count > 0 ? (
            <span className="mt-1 block text-[10px] text-amber-200/70">{networkLabel}</span>
          ) : null}
          {summary.lastError ? (
            <span className="mt-1 block truncate text-[10px] text-amber-200/70">{summary.lastError}</span>
          ) : null}
          {summary.nextRetryAt && summary.failed > 0 ? (
            <span className="mt-1 block text-[10px] text-amber-200/70">{t("offlineQueue.nextRetry", { time: new Date(summary.nextRetryAt).toLocaleTimeString() })}</span>
          ) : null}
        </span>
        {summary.count > 0 ? (
          <>
            <button
              onClick={onSyncAll}
              disabled={status === "syncing" || network.quality === "offline"}
              className="shrink-0 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-[11px] font-bold text-amber-100 disabled:opacity-50"
            >
              {t("offlineQueue.retryAll")}
            </button>
            <button
              onClick={onClear}
              className="shrink-0 rounded-full border border-red-300/25 bg-red-300/10 px-3 py-1 text-[11px] font-bold text-red-100"
            >
              {t("offlineQueue.clear")}
            </button>
          </>
        ) : null}
      </div>
      {summary.count > 0 ? <div className="mt-3 space-y-2 border-t border-amber-200/15 pt-3">
        {items.slice(0, 3).map((item) => {
          const preview = item.message.parts.find((part) => part.text)?.text || t("offlineQueue.attachmentMessage");
          const nextRetryAt = getOfflineMessageNextRetryAt(item);
          const retryReady = typeof nextRetryAt === "number" && nextRetryAt <= Date.now();
          const retryLabel = !nextRetryAt ? "" : retryReady ? t("offlineQueue.readyToRetry") : t("offlineQueue.nextRetry", { time: new Date(nextRetryAt).toLocaleTimeString() });
          const statusLabel = item.status === "failed" ? t("offlineQueue.status.failed") : item.status === "syncing" ? t("offlineQueue.status.syncing") : t("offlineQueue.status.pending");
          return (
            <div key={item.id} className="rounded-xl border border-amber-200/15 bg-black/10 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-amber-50/80">{preview}</span>
                <span className="shrink-0 rounded-full bg-amber-200/10 px-2 py-0.5 text-[10px] text-amber-100/80">{statusLabel}</span>
              </div>
              {item.lastError ? <div className="mt-1 truncate text-[10px] text-red-100/80">{item.lastError}</div> : null}
              {retryLabel ? <div className="mt-1 text-[10px] text-amber-100/65">{retryLabel}</div> : null}
              <div className="mt-2 flex items-center gap-2">
                <button onClick={() => onRetry(item.id)} className="rounded-full border border-amber-200/20 px-2 py-0.5 text-[10px] font-bold text-amber-100">
                  {t("offlineQueue.retryOne")}
                </button>
                <button onClick={() => onRemove(item.id)} className="rounded-full border border-red-200/20 px-2 py-0.5 text-[10px] font-bold text-red-100">
                  {t("offlineQueue.remove")}
                </button>
              </div>
            </div>
          );
        })}
        {items.length > 3 ? <div className="text-[10px] text-amber-100/60">{t("offlineQueue.moreHidden", { count: items.length - 3 })}</div> : null}
      </div> : null}
    </div>
  );
}
