import { useCallback, useEffect, useState } from "react";
import {
  clearOfflineMessageQueue,
  getOfflineMessageQueue,
  getOfflineMessageQueueCount,
  getOfflineMessageQueueSummary,
  removeOfflineMessages,
  resetFailedOfflineMessages,
  retryOfflineMessage,
  subscribeOfflineMessageQueue,
  type OfflineMessageQueueSummary,
} from "../services/offlineMessageQueue";
import { getNetworkStatus } from "../services/networkStatus";

type OfflineQueueSyncOptions = {
  clearConfirmMessage: string | ((summary: OfflineMessageQueueSummary) => string);
};

export function useOfflineQueueSync(flushOfflineMessages: () => Promise<number>, options: OfflineQueueSyncOptions) {
  const [offlineQueueSummary, setOfflineQueueSummary] = useState(() => getOfflineMessageQueueSummary());
  const [offlineQueueItems, setOfflineQueueItems] = useState(() => getOfflineMessageQueue());
  const [offlineSyncStatus, setOfflineSyncStatus] = useState<"idle" | "syncing" | "error">("idle");
  const [networkStatus, setNetworkStatus] = useState(() => getNetworkStatus());

  const refreshQueueState = useCallback(() => {
    setOfflineQueueSummary(getOfflineMessageQueueSummary());
    setOfflineQueueItems(getOfflineMessageQueue());
  }, []);

  const syncQueuedMessages = useCallback(async (forceRetryFailed = false) => {
    if (getOfflineMessageQueueCount() === 0) return;
    if (forceRetryFailed) resetFailedOfflineMessages();
    setOfflineSyncStatus("syncing");
    try {
      await flushOfflineMessages();
      refreshQueueState();
      setOfflineSyncStatus("idle");
    } catch (error) {
      console.warn("Failed to flush queued messages:", error);
      setOfflineSyncStatus("error");
    }
  }, [flushOfflineMessages, refreshQueueState]);

  const retryQueuedMessage = useCallback(async (id: string) => {
    retryOfflineMessage(id);
    await syncQueuedMessages();
  }, [syncQueuedMessages]);

  const removeQueuedMessage = useCallback((id: string) => {
    removeOfflineMessages([id]);
    refreshQueueState();
  }, [refreshQueueState]);

  const clearQueuedMessages = useCallback(() => {
    const message = typeof options.clearConfirmMessage === "function"
      ? options.clearConfirmMessage(getOfflineMessageQueueSummary())
      : options.clearConfirmMessage;
    if (!window.confirm(message)) return;
    void clearOfflineMessageQueue().finally(refreshQueueState);
  }, [options.clearConfirmMessage, refreshQueueState]);

  useEffect(() => {
    const handleRecoverableState = () => {
      setNetworkStatus(getNetworkStatus());
      void syncQueuedMessages();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setNetworkStatus(getNetworkStatus());
        void syncQueuedMessages();
      }
    };
    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "LIFEOS_SYNC_OFFLINE_QUEUE") void syncQueuedMessages();
    };

    window.addEventListener("online", handleRecoverableState);
    window.addEventListener("offline", handleRecoverableState);
    window.addEventListener("focus", handleRecoverableState);
    (navigator as any).connection?.addEventListener?.("change", handleRecoverableState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      window.removeEventListener("online", handleRecoverableState);
      window.removeEventListener("offline", handleRecoverableState);
      window.removeEventListener("focus", handleRecoverableState);
      (navigator as any).connection?.removeEventListener?.("change", handleRecoverableState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, [syncQueuedMessages]);

  useEffect(() => {
    return subscribeOfflineMessageQueue((summary) => {
      setOfflineQueueSummary(summary);
      setOfflineQueueItems(getOfflineMessageQueue());
    });
  }, []);

  useEffect(() => {
    if (!offlineQueueSummary.nextRetryAt || networkStatus.quality === "offline" || offlineSyncStatus === "syncing") return;
    const delay = Math.max(500, offlineQueueSummary.nextRetryAt - Date.now());
    const timer = window.setTimeout(() => {
      void syncQueuedMessages();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [offlineQueueSummary.nextRetryAt, networkStatus.quality, offlineSyncStatus, syncQueuedMessages]);

  return {
    clearQueuedMessages,
    networkStatus,
    offlineQueueItems,
    offlineQueueSummary,
    offlineSyncStatus,
    removeQueuedMessage,
    retryQueuedMessage,
    syncQueuedMessages,
  };
}
