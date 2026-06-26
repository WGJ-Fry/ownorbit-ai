import type { NetworkStatus } from "./networkStatus";
import type { OfflineMessageQueueStorageStatus, OfflineMessageQueueSummary } from "./offlineMessageQueue";
import type { RemoteEntryStatus } from "./pwaCapabilities";

export type OfflineQueueHealthTone = "ok" | "info" | "warning" | "danger";

export type OfflineQueueHealth = {
  tone: OfflineQueueHealthTone;
  titleKey: string;
  bodyKey: string;
  actionKey: string;
};

export function buildOfflineQueueHealth(
  summary: OfflineMessageQueueSummary,
  storage: OfflineMessageQueueStorageStatus | null,
  network: NetworkStatus,
  currentEntry: Pick<RemoteEntryStatus, "okForRemote">,
): OfflineQueueHealth {
  if (!storage?.available) {
    return {
      tone: "danger",
      titleKey: "offlineQueue.healthStorageBlockedTitle",
      bodyKey: "offlineQueue.healthStorageBlockedBody",
      actionKey: "offlineQueue.healthStorageBlockedAction",
    };
  }

  if (storage.nearByteLimit || storage.nearItemLimit || (storage.usageRatio ?? 0) > 0.8) {
    return {
      tone: "warning",
      titleKey: "offlineQueue.healthStorageRiskTitle",
      bodyKey: "offlineQueue.healthStorageRiskBody",
      actionKey: "offlineQueue.healthStorageRiskAction",
    };
  }

  if ((summary.conflicts || 0) > 0) {
    return {
      tone: "warning",
      titleKey: "offlineQueue.healthConflictTitle",
      bodyKey: "offlineQueue.healthConflictBody",
      actionKey: "offlineQueue.healthConflictAction",
    };
  }

  if (summary.failed > 0) {
    return {
      tone: "danger",
      titleKey: "offlineQueue.healthFailedTitle",
      bodyKey: "offlineQueue.healthFailedBody",
      actionKey: "offlineQueue.healthFailedAction",
    };
  }

  if (summary.count > 0 && !currentEntry.okForRemote) {
    return {
      tone: "warning",
      titleKey: "offlineQueue.healthEntryBlockedTitle",
      bodyKey: "offlineQueue.healthEntryBlockedBody",
      actionKey: "offlineQueue.healthEntryBlockedAction",
    };
  }

  if (network.quality === "offline") {
    return {
      tone: "info",
      titleKey: "offlineQueue.healthOfflineTitle",
      bodyKey: "offlineQueue.healthOfflineBody",
      actionKey: "offlineQueue.healthOfflineAction",
    };
  }

  if (network.quality === "poor") {
    return {
      tone: "warning",
      titleKey: "offlineQueue.healthWeakNetworkTitle",
      bodyKey: "offlineQueue.healthWeakNetworkBody",
      actionKey: "offlineQueue.healthWeakNetworkAction",
    };
  }

  if (summary.count > 0) {
    return {
      tone: "info",
      titleKey: "offlineQueue.healthPendingTitle",
      bodyKey: "offlineQueue.healthPendingBody",
      actionKey: "offlineQueue.healthPendingAction",
    };
  }

  return {
    tone: "ok",
    titleKey: "offlineQueue.healthReadyTitle",
    bodyKey: "offlineQueue.healthReadyBody",
    actionKey: "offlineQueue.healthReadyAction",
  };
}
