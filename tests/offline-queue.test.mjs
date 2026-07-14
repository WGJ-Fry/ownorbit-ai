// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
let dispatchedEvents = [];

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};

globalThis.window = {
  dispatchEvent(event) {
    dispatchedEvents.push(event);
  },
  addEventListener() {},
  removeEventListener() {},
};

globalThis.CustomEvent = function CustomEvent(type, init = {}) {
  return {
    type,
    detail: init.detail,
  };
};

function createFakeIndexedDb() {
  const databases = new Map();
  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const isNew = !database;
        if (!database) {
          const stores = new Map();
          database = {
            objectStoreNames: {
              contains(storeName) {
                return stores.has(storeName);
              },
            },
            createObjectStore(storeName) {
              if (!stores.has(storeName)) stores.set(storeName, new Map());
            },
            transaction(storeName) {
              const store = stores.get(storeName);
              const transaction = {
                objectStore() {
                  return {
                    get(key) {
                      const getRequest = {};
                      queueMicrotask(() => {
                        getRequest.result = store?.get(key);
                        getRequest.onsuccess?.();
                      });
                      return getRequest;
                    },
                    put(value, key) {
                      store?.set(key, value);
                    },
                    delete(key) {
                      store?.delete(key);
                    },
                  };
                },
              };
              queueMicrotask(() => transaction.oncomplete?.());
              return transaction;
            },
            close() {},
          };
          databases.set(name, database);
        }
        request.result = database;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

let postedMessages = [];
let registeredSyncTags = [];

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    serviceWorker: {
      controller: {
        postMessage(message) {
          postedMessages.push(message);
        },
      },
      ready: Promise.resolve({
        sync: {
          register(tag) {
            registeredSyncTags.push(tag);
            return Promise.resolve();
          },
        },
      }),
    },
    storage: {
      persisted() {
        return Promise.resolve(false);
      },
      estimate() {
        return Promise.resolve({ usage: 900, quota: 1000 });
      },
    },
  },
});

test("offline message queue deduplicates and persists retry state", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import("../src/services/offlineMessageQueue.ts");

  const message = { role: "user", parts: [{ text: "hello offline" }] };
  const firstId = queueModule.enqueueOfflineMessage(message);
  const secondId = queueModule.enqueueOfflineMessage({ parts: [{ text: "hello offline" }], role: "user" });
  assert.equal(firstId, secondId);
  assert.equal(queueModule.getOfflineMessageQueueCount(), 1);

  queueModule.markOfflineMessageSyncing(firstId);
  let [item] = queueModule.getOfflineMessageQueue();
  assert.equal(item.status, "syncing");
  assert.equal(item.syncStage, "syncing");
  assert.equal(item.attempts, 1);
  assert.ok(item.lastAttemptAt);
  assert.match(item.mutationId, /^[0-9a-f-]{36}$|^legacy-/);
  assert.match(item.idempotencyKey, /^lifeos-offline:/);
  assert.equal(item.clientSequence >= 1, true);
  assert.equal(item.sourceVersion, 1);

  queueModule.markOfflineMessageFailed(firstId, new Error("network down"));
  let summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.count, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.readyToSync, 0);
  assert.equal(summary.identityReady, 1);
  assert.equal(summary.missingIdentity, 0);
  assert.equal(summary.conflicts, 0);
  assert.equal(summary.lastError, "network down");
  assert.equal(typeof summary.nextRetryAt, "number");

  queueModule.retryOfflineMessage(firstId);
  [item] = queueModule.getOfflineMessageQueue();
  assert.equal(item.status, "pending");
  assert.equal(item.syncStage, "retry-ready");
  assert.equal(item.lastError, undefined);
  assert.equal(item.manualRetryCount, 1);
  assert.equal(typeof item.lastManualRetryAt, "number");

  queueModule.markOfflineMessageFailed(firstId, new Error("network down again"));
  queueModule.resetFailedOfflineMessages();
  [item] = queueModule.getOfflineMessageQueue();
  assert.equal(item.status, "pending");
  assert.equal(item.lastError, undefined);

  queueModule.removeOfflineMessages([firstId]);
  assert.equal(queueModule.getOfflineMessageQueueCount(), 0);

  queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "clear me" }] });
  assert.equal(queueModule.getOfflineMessageQueueCount(), 1);
  await queueModule.clearOfflineMessageQueue();
  assert.equal(queueModule.getOfflineMessageQueueCount(), 0);
  assert.ok(dispatchedEvents.some((event) => event.type === "lifeos-offline-message-queue-changed" && event.detail.count === 0));
  await Promise.resolve();
  assert.ok(postedMessages.some((message) => message.type === "LIFEOS_QUEUE_UPDATED"));
  assert.ok(registeredSyncTags.includes("lifeos-offline-queue"));

  const storageStatus = await queueModule.getOfflineMessageQueueStorageStatus();
  assert.equal(storageStatus.storage, "localStorage");
  assert.equal(storageStatus.available, true);
  assert.equal(storageStatus.count, 0);
  assert.equal(storageStatus.maxItems, 100);
  assert.equal(storageStatus.persistentStorageGranted, false);
  assert.equal(storageStatus.usageRatio, 0.9);
  assert.equal(storageStatus.recommendations.some((item) => item.includes("Persistent storage")), true);
  assert.equal(storageStatus.recommendations.some((item) => item.includes("storage is near its limit")), true);
});

test("offline message queue recovers interrupted sync and backs off failed retries", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import("../src/services/offlineMessageQueue.ts");

  const firstId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "stale syncing" }] });
  const secondId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "failed waits" }] });

  queueModule.markOfflineMessageSyncing(firstId);
  queueModule.markOfflineMessageFailed(secondId, new Error("server unavailable"));
  const afterStatusUpdatePosts = postedMessages.length;
  const failedBeforeBackoff = queueModule.getOfflineMessageQueue().find((item) => item.id === secondId);
  assert.ok(failedBeforeBackoff);
  assert.deepEqual(queueModule.getOfflineMessagesReadyToSync(failedBeforeBackoff.lastAttemptAt + 1_000).map((item) => item.id), []);

  const syncingBeforeRecovery = queueModule.getOfflineMessageQueue().find((item) => item.id === firstId);
  queueModule.recoverStaleOfflineMessages(syncingBeforeRecovery.lastAttemptAt + 3 * 60 * 1000);
  const recovered = queueModule.getOfflineMessageQueue().find((item) => item.id === firstId);
  assert.equal(recovered.status, "pending");
  assert.equal(recovered.syncStage, "retry-ready");
  assert.match(recovered.lastError, /sync was interrupted/);

  const failed = queueModule.getOfflineMessageQueue().find((item) => item.id === secondId);
  assert.ok(failed.lastAttemptAt);
  assert.equal(queueModule.getOfflineMessageNextRetryAt(failed), failed.lastAttemptAt + queueModule.getOfflineMessageRetryDelayMs(failed));
  assert.equal(queueModule.getOfflineMessageStatusLabel(failed), "Failed");
  assert.match(queueModule.getOfflineMessageRetryLabel(failed, failed.lastAttemptAt + 1_000), /Next automatic retry:/);
  assert.equal(queueModule.getOfflineMessageRetryLabel(failed, failed.lastAttemptAt + 15_000), "Ready to retry");
  assert.equal(queueModule.classifyOfflineMessageFailure("Failed to fetch"), "network");
  assert.equal(queueModule.classifyOfflineMessageFailure("401 unauthorized device token"), "auth");
  assert.equal(queueModule.classifyOfflineMessageFailure("503 service unavailable"), "server");
  assert.equal(queueModule.classifyOfflineMessageFailure("IndexedDB quota exceeded"), "size");
  assert.equal(queueModule.classifyOfflineMessageFailure("Previous sync was interrupted"), "interrupted");
  assert.equal(queueModule.classifyOfflineMessageFailure(""), "unknown");
  assert.equal(queueModule.sanitizeOfflineMessageError("Authorization: Bearer abc.def.ghi"), "Authorization: Bearer [redacted]");
  assert.equal(queueModule.sanitizeOfflineMessageError("fetch https://lifeos.example.com/api?token=secret&ok=1"), "fetch https://lifeos.example.com/api?token=%5Bredacted%5D&ok=1");
  assert.equal(queueModule.formatOfflineMessageQueueBytes(0), "0 B");
  assert.equal(queueModule.formatOfflineMessageQueueBytes(900), "900 B");
  assert.equal(queueModule.formatOfflineMessageQueueBytes(2_048), "2 KB");
  assert.equal(queueModule.formatOfflineMessageQueueBytes(1_572_864), "1.5 MB");
  assert.equal(queueModule.getOfflineMessageQueueStorageLabel("indexeddb"), "IndexedDB primary storage");
  assert.equal(queueModule.getOfflineMessageQueueStorageLabel("localStorage"), "localStorage compatibility storage");
  assert.equal(queueModule.getOfflineMessageQueueStorageLabel("memory"), "In-memory temporary queue");
  assert.equal(queueModule.getOfflineMessageQueueStorageLabel("unavailable"), "Unavailable");
  assert.equal(queueModule.getOfflineMessageQueueUsageLabel({ usageRatio: 0.42, quotaBytes: 2_048 }), "42%, quota 2 KB");
  assert.equal(queueModule.getOfflineMessageQueueUsageLabel({ usageRatio: undefined, quotaBytes: undefined }), "-");
  assert.deepEqual(queueModule.getOfflineMessagesReadyToSync(failed.lastAttemptAt + 14_999).map((item) => item.id), [firstId]);
  assert.deepEqual(queueModule.getOfflineMessagesReadyToSync(failed.lastAttemptAt + 15_000).map((item) => item.id).sort(), [firstId, secondId].sort());
  assert.ok(postedMessages.length > afterStatusUpdatePosts);
});

test("offline queue failure reasons are redacted before persistence and export", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=redacted-failure-${Date.now()}`);
  const { buildOfflineQueueBackupText } = await import(`../src/services/offlineQueueBackup.ts?case=redacted-backup-${Date.now()}`);

  const id = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "sync without leaking secrets" }] });
  queueModule.markOfflineMessageFailed(id, new Error("POST https://user:pass@lifeos.example.com/api/chat?token=secret-token&ok=1 Authorization: Bearer abc.def.ghi github_pat_leaksecret"));
  const [item] = queueModule.getOfflineMessageQueue();
  const summary = queueModule.getOfflineMessageQueueSummary();
  const backup = buildOfflineQueueBackupText(summary, [item]);

  assert.equal(item.lastError.includes("secret-token"), false);
  assert.equal(item.lastError.includes("abc.def.ghi"), false);
  assert.equal(item.lastError.includes("github_pat_leaksecret"), false);
  assert.match(item.lastError, /token=%5Bredacted%5D/);
  assert.match(item.lastError, /Authorization: Bearer \[redacted\]/);
  assert.equal(summary.lastError, item.lastError);
  assert.equal(backup.includes("secret-token"), false);
  assert.equal(backup.includes("abc.def.ghi"), false);
  assert.equal(backup.includes("github_pat_leaksecret"), false);
  assert.match(backup, /Conflict-risk duplicates: 0/);
});

test("offline message queue surfaces duplicate fingerprint conflict risk", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const fingerprintModule = await import(`../src/services/offlineMessageQueue.ts?case=conflict-fingerprint-${Date.now()}`);
  const message = { role: "user", parts: [{ text: "same message restored twice" }] };
  const fingerprint = fingerprintModule.getMessageFingerprint(message);
  storage.set("lifeos_offline_message_queue", JSON.stringify([
    { id: "legacy-a", message, queuedAt: 1_000, fingerprint, status: "pending", attempts: 0 },
    { id: "legacy-b", message, queuedAt: 2_000, fingerprint, status: "failed", attempts: 1, lastError: "network duplicate" },
  ]));

  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=conflict-summary-${Date.now()}`);
  const { buildOfflineQueueBackupText } = await import(`../src/services/offlineQueueBackup.ts?case=conflict-backup-${Date.now()}`);
  const summary = queueModule.getOfflineMessageQueueSummary();
  const queue = queueModule.getOfflineMessageQueue();
  const backup = buildOfflineQueueBackupText(summary, queue);
  const conflictGroups = queueModule.getOfflineMessageConflictGroups();

  assert.equal(summary.count, 2);
  assert.equal(summary.conflicts, 1);
  assert.equal(conflictGroups.length, 1);
  assert.equal(conflictGroups[0].kind, "duplicate");
  assert.equal(conflictGroups[0].canAutoResolve, true);
  assert.equal(conflictGroups[0].reviewRequired, false);
  assert.equal(conflictGroups[0].reasonKey, "offlineQueue.conflictReason.duplicate");
  assert.equal(conflictGroups[0].count, 2);
  assert.equal(conflictGroups[0].keepId, "legacy-b");
  assert.deepEqual(conflictGroups[0].duplicateIds, ["legacy-a"]);
  assert.equal(conflictGroups[0].resolutionOptions.some((option) => option.id === "keep-latest" && option.recommended), true);
  assert.equal(conflictGroups[0].resolutionOptions.some((option) => option.id === "keep-oldest"), true);
  assert.match(conflictGroups[0].preview, /same message restored twice/);
  assert.match(backup, /Conflict-risk duplicates: 1/);
  const recovery = queueModule.getOfflineMessageQueueRecoverySummary(queue, { online: true, networkQuality: "poor", remoteOk: true });
  assert.equal(recovery.titleKey, "offlineQueue.recoveryConflictTitle");
  assert.equal(recovery.nextAction, "resolve-conflicts");
  assert.equal(recovery.canAutoSync, false);
  assert.equal(recovery.syncPlan.mode, "manual-review");
  assert.equal(recovery.syncPlan.manualReviewRequired, true);
  assert.equal(recovery.syncPlan.canUseBackgroundSync, false);
  assert.equal(recovery.syncPlan.reasonKey, "offlineQueue.syncPlan.reason.manualReview");
  assert.equal(recovery.conflictGroupCount, 1);
  assert.equal(recovery.weakNetworkSensitive, true);
  assert.equal(recovery.steps.some((step) => step.id === "copy-backup" && step.status === "current"), true);
  assert.equal(recovery.steps.some((step) => step.id === "resolve-conflicts" && step.status === "current" && step.itemCount === 1), true);
  const conflictGuard = queueModule.getOfflineMessageQueueSyncGuard(queue, { online: true, networkQuality: "ok", remoteOk: true });
  assert.equal(conflictGuard.allowed, false);
  assert.equal(conflictGuard.mode, "manual-review");
  assert.equal(conflictGuard.recovery.conflictGroupCount, 1);
  const forcedConflictGuard = queueModule.getOfflineMessageQueueSyncGuard(queue, { online: true, networkQuality: "ok", remoteOk: true }, { force: true });
  assert.equal(forcedConflictGuard.allowed, false);
  assert.equal(forcedConflictGuard.forced, false);

  const resolved = queueModule.resolveOfflineMessageConflictGroup(fingerprint);
  assert.deepEqual(resolved.removedIds, ["legacy-a"]);
  assert.deepEqual(queueModule.getOfflineMessageQueue().map((item) => item.id), ["legacy-b"]);
  assert.equal(queueModule.getOfflineMessageQueueSummary().conflicts, 0);
  assert.deepEqual(queueModule.getOfflineMessageConflictGroups(), []);
});

test("offline queue flags similar multi-device messages for manual review only", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=similar-conflict-${Date.now()}`);

  const firstId = queueModule.enqueueOfflineMessage(
    { role: "user", parts: [{ text: "Submit travel reimbursement before Friday" }] },
    { source: { client: "mobile", deviceName: "iPhone", deviceIdHint: "phone-a", path: "/mobile/chat", online: false, networkQuality: "poor" } },
  );
  const secondId = queueModule.enqueueOfflineMessage(
    { role: "user", parts: [{ text: "submit travel reimbursement before friday!" }] },
    { source: { client: "mobile", deviceName: "Travel Phone", deviceIdHint: "phone-b", path: "/mobile/chat", online: true, networkQuality: "poor" } },
  );

  assert.notEqual(firstId, secondId);
  const queue = queueModule.getOfflineMessageQueue();
  const groups = queueModule.getOfflineMessageConflictGroups(queue);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "similar-window");
  assert.equal(groups[0].canAutoResolve, false);
  assert.equal(groups[0].reviewRequired, true);
  assert.equal(groups[0].reasonKey, "offlineQueue.conflictReason.similarWindow");
  assert.deepEqual(groups[0].duplicateIds, []);
  assert.deepEqual(groups[0].itemIds.sort(), [firstId, secondId].sort());
  assert.equal(groups[0].sourceDeviceCount, 2);
  assert.equal(groups[0].sourceEntryCount, 1);
  assert.equal(groups[0].resolutionOptions.some((option) => option.id === "keep-all" && option.recommended && option.requiresBackup), true);
  assert.equal(groups[0].resolutionOptions.some((option) => option.id === "keep-latest" && option.destructive), true);
  assert.equal(queueModule.getOfflineMessageQueueSummary().conflicts, 1);

  const recovery = queueModule.getOfflineMessageQueueRecoverySummary(queue, { online: true, networkQuality: "poor", remoteOk: true });
  assert.equal(recovery.nextAction, "resolve-conflicts");
  assert.equal(recovery.conflictGroupCount, 1);
  assert.equal(recovery.canAutoSync, false);
  assert.equal(recovery.syncPlan.mode, "manual-review");
  assert.equal(recovery.syncPlan.manualReviewRequired, true);
  assert.equal(recovery.steps.some((step) => step.id === "resolve-conflicts" && step.status === "current"), true);

  const resolved = queueModule.resolveOfflineMessageConflictGroup(groups[0].fingerprint);
  assert.equal(resolved, null);
  assert.deepEqual(queueModule.getOfflineMessageQueue().map((item) => item.id).sort(), [firstId, secondId].sort());

  const reviewed = queueModule.resolveOfflineMessageConflictGroup(groups[0].fingerprint, undefined, "keep-all");
  assert.equal(reviewed.decision, "keep-all");
  assert.deepEqual(reviewed.removedIds, []);
  assert.deepEqual(queueModule.getOfflineMessageQueue().map((item) => item.id).sort(), [firstId, secondId].sort());
  assert.equal(queueModule.getOfflineMessageQueueSummary().conflicts, 0);
  assert.deepEqual(queueModule.getOfflineMessageConflictGroups(), []);
  const reviewedRecovery = queueModule.getOfflineMessageQueueRecoverySummary(queueModule.getOfflineMessageQueue(), { online: true, networkQuality: "ok", remoteOk: true });
  assert.equal(reviewedRecovery.nextAction, "open-chat");
  assert.equal(reviewedRecovery.canAutoSync, true);
  assert.equal(reviewedRecovery.syncPlan.mode, "background-ready");
});

test("offline queue can resolve reviewed similar conflicts by keeping a selected item", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=similar-conflict-selected-${Date.now()}`);

  const firstId = queueModule.enqueueOfflineMessage(
    { role: "user", parts: [{ text: "Plan the quarterly roadmap review today" }] },
    { source: { client: "mobile", deviceName: "iPhone", deviceIdHint: "phone-a", path: "/mobile/chat", online: false, networkQuality: "poor" } },
  );
  const secondId = queueModule.enqueueOfflineMessage(
    { role: "user", parts: [{ text: "plan the quarterly roadmap review today!" }] },
    { source: { client: "mobile", deviceName: "Travel Phone", deviceIdHint: "phone-b", path: "/mobile/chat", online: true, networkQuality: "poor" } },
  );
  const [group] = queueModule.getOfflineMessageConflictGroups();
  const resolved = queueModule.resolveOfflineMessageConflictGroup(group.fingerprint, firstId, "keep-selected");

  assert.equal(resolved.decision, "keep-selected");
  assert.equal(resolved.keepId, firstId);
  assert.deepEqual(resolved.removedIds, [secondId]);
  assert.deepEqual(queueModule.getOfflineMessageQueue().map((item) => item.id), [firstId]);
  assert.equal(queueModule.getOfflineMessageQueueSummary().conflicts, 0);
});

test("offline queue stores source snapshots and flags multi-source recovery risk", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=source-snapshot-${Date.now()}`);
  const { buildOfflineQueueBackupText } = await import(`../src/services/offlineQueueBackup.ts?case=source-backup-${Date.now()}`);

  const firstId = queueModule.enqueueOfflineMessage(
    { role: "user", parts: [{ text: "from phone one" }] },
    { source: { client: "mobile", deviceName: "iPhone", deviceIdHint: "device-one", authMethod: "signature", path: "/mobile/chat?token=secret#hash", online: false, networkQuality: "offline", effectiveType: "4g" } },
  );
  const secondId = queueModule.enqueueOfflineMessage(
    { role: "user", parts: [{ text: "from phone two" }] },
    { source: { client: "mobile", deviceName: "Travel Phone", deviceIdHint: "device-two", path: "/mobile/chat", online: true, networkQuality: "poor" } },
  );
  const queue = queueModule.getOfflineMessageQueue();
  assert.deepEqual(queue.map((item) => item.id).sort(), [firstId, secondId].sort());
  assert.equal(queue[0].source.path, "/mobile/chat");
  assert.equal(queue[0].source.deviceIdHint, "device-one");
  assert.equal(queue[0].source.networkQuality, "offline");

  const recovery = queueModule.getOfflineMessageQueueRecoverySummary(queue, { online: true, networkQuality: "ok", remoteOk: true });
  assert.equal(recovery.state, "needs-review");
  assert.equal(recovery.titleKey, "offlineQueue.recoveryMultiSourceTitle");
  assert.equal(recovery.nextAction, "review-sources");
  assert.equal(recovery.sourceDeviceCount, 2);
  assert.equal(recovery.sourceEntryCount, 1);
  assert.equal(recovery.sourceSnapshotMissing, 0);
  assert.equal(recovery.multiSourceRisk, true);
  assert.equal(recovery.syncPlan.mode, "manual-review");
  assert.equal(recovery.syncPlan.reasonKey, "offlineQueue.syncPlan.reason.manualReview");
  assert.equal(recovery.steps.some((step) => step.id === "review-sources" && step.status === "current"), true);

  const backup = buildOfflineQueueBackupText(queueModule.getOfflineMessageQueueSummary(), queue);
  assert.match(backup, /Source: mobile \/ iPhone \/ offline \/ \/mobile\/chat/);
  assert.match(backup, /Source: mobile \/ Travel Phone \/ poor \/ \/mobile\/chat/);
  assert.equal(backup.includes("secret"), false);
  assert.equal(backup.includes("#hash"), false);
});

test("single offline message retry and remove only change the selected queue item", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=single-retry-${Date.now()}`);

  const firstId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "retry only me" }] });
  const secondId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "leave failed" }] });
  const thirdId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "remove only me" }] });

  queueModule.markOfflineMessageFailed(firstId, new Error("first failed"));
  queueModule.markOfflineMessageFailed(secondId, new Error("second failed"));
  queueModule.markOfflineMessageFailed(thirdId, new Error("third failed"));
  let summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.count, 3);
  assert.equal(summary.failed, 3);
  const queuedTimes = queueModule.getOfflineMessageQueue().map((item) => item.queuedAt).sort((a, b) => a - b);
  assert.equal(summary.oldestQueuedAt, queuedTimes[0]);
  assert.equal(summary.newestQueuedAt, queuedTimes.at(-1));

  queueModule.retryOfflineMessage(firstId);
  const afterRetry = queueModule.getOfflineMessageQueue();
  assert.equal(afterRetry.find((item) => item.id === firstId)?.status, "pending");
  assert.equal(afterRetry.find((item) => item.id === firstId)?.lastError, undefined);
  assert.equal(afterRetry.find((item) => item.id === firstId)?.manualRetryCount, 1);
  assert.equal(typeof afterRetry.find((item) => item.id === firstId)?.lastManualRetryAt, "number");
  assert.equal(afterRetry.find((item) => item.id === secondId)?.status, "failed");
  assert.equal(afterRetry.find((item) => item.id === secondId)?.lastError, "second failed");
  assert.equal(afterRetry.find((item) => item.id === thirdId)?.status, "failed");
  summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.pending, 1);
  assert.equal(summary.failed, 2);
  assert.equal(typeof summary.nextRetryAt, "number");

  queueModule.removeOfflineMessages([thirdId]);
  const afterRemove = queueModule.getOfflineMessageQueue();
  assert.deepEqual(afterRemove.map((item) => item.id).sort(), [firstId, secondId].sort());
  assert.equal(afterRemove.find((item) => item.id === secondId)?.status, "failed");

  await queueModule.clearOfflineMessageQueue();
  assert.deepEqual(queueModule.getOfflineMessageQueue(), []);
  assert.equal(storage.has("lifeos_offline_message_queue"), false);
  assert.ok(dispatchedEvents.some((event) => event.type === "lifeos-offline-message-queue-changed" && event.detail.count === 0));
});

test("offline queue recovery summary supports bulk failed retry and removal", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=recovery-summary-${Date.now()}`);

  const firstId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "retry failed batch one" }] });
  const secondId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "retry failed batch two" }] });
  const thirdId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "still waiting" }] });
  queueModule.markOfflineMessageFailed(firstId, new Error("Failed to fetch"));
  queueModule.markOfflineMessageFailed(secondId, new Error("503 service unavailable"));

  const queue = queueModule.getOfflineMessageQueue();
  const failed = queue.filter((item) => item.status === "failed");
  const afterBackoff = Math.max(...failed.map((item) => item.lastAttemptAt)) + 15_000;
  const recovery = queueModule.getOfflineMessageQueueRecoverySummary(queue, { online: true, networkQuality: "ok", remoteOk: true, now: afterBackoff });
  assert.equal(recovery.state, "needs-review");
  assert.equal(recovery.titleKey, "offlineQueue.recoveryFailedTitle");
  assert.deepEqual(recovery.failedIds.sort(), [firstId, secondId].sort());
  assert.deepEqual(recovery.retryableFailedIds.sort(), [firstId, secondId].sort());
  assert.equal(recovery.waitingCount, 3);

  const blockedRecovery = queueModule.getOfflineMessageQueueRecoverySummary(queue, { online: true, networkQuality: "ok", remoteOk: false, now: afterBackoff });
  assert.equal(blockedRecovery.state, "blocked");
  assert.equal(blockedRecovery.titleKey, "offlineQueue.recoveryRemoteBlockedTitle");
  assert.equal(blockedRecovery.nextAction, "fix-remote");
  assert.equal(blockedRecovery.syncPlan.mode, "blocked");
  assert.equal(blockedRecovery.syncPlan.canUseBackgroundSync, false);
  assert.equal(blockedRecovery.syncPlan.reasonKey, "offlineQueue.syncPlan.reason.remoteBlocked");
  assert.equal(blockedRecovery.steps.some((step) => step.id === "fix-remote" && step.status === "blocked"), true);

  const retried = queueModule.retryFailedOfflineMessages();
  assert.deepEqual(retried.retriedIds.sort(), [firstId, secondId].sort());
  const afterRetry = queueModule.getOfflineMessageQueue();
  assert.equal(afterRetry.every((item) => item.status === "pending"), true);
  assert.equal(afterRetry.find((item) => item.id === firstId)?.manualRetryCount, 1);
  assert.equal(afterRetry.find((item) => item.id === secondId)?.manualRetryCount, 1);
  assert.equal(afterRetry.find((item) => item.id === thirdId)?.manualRetryCount, undefined);
  const weakRecovery = queueModule.getOfflineMessageQueueRecoverySummary(afterRetry, { online: true, networkQuality: "poor", remoteOk: true });
  assert.equal(weakRecovery.titleKey, "offlineQueue.recoveryWeakNetworkTitle");
  assert.equal(weakRecovery.nextAction, "wait-stable-network");
  assert.equal(weakRecovery.canAutoSync, false);
  assert.equal(weakRecovery.syncPlan.mode, "waiting-stable-network");
  assert.equal(weakRecovery.syncPlan.reasonKey, "offlineQueue.syncPlan.reason.waitStableNetwork");
  assert.equal(weakRecovery.steps.some((step) => step.id === "wait-stable-network" && step.status === "current"), true);
  const weakGuard = queueModule.getOfflineMessageQueueSyncGuard(afterRetry, { online: true, networkQuality: "poor", remoteOk: true });
  assert.equal(weakGuard.allowed, false);
  assert.equal(weakGuard.mode, "waiting-stable-network");
  assert.equal(weakGuard.readyCount, 3);

  const readyRecovery = queueModule.getOfflineMessageQueueRecoverySummary(afterRetry, { online: true, networkQuality: "ok", remoteOk: true });
  assert.equal(readyRecovery.nextAction, "open-chat");
  assert.equal(readyRecovery.canAutoSync, true);
  assert.equal(readyRecovery.syncPlan.mode, "background-ready");
  assert.equal(readyRecovery.syncPlan.canUseBackgroundSync, true);
  assert.equal(readyRecovery.syncPlan.manualReviewRequired, false);
  assert.equal(readyRecovery.syncPlan.reasonKey, "offlineQueue.syncPlan.reason.backgroundReady");
  assert.equal(readyRecovery.steps.some((step) => step.id === "open-chat" && step.status === "current"), true);
  const readyGuard = queueModule.getOfflineMessageQueueSyncGuard(afterRetry, { online: true, networkQuality: "ok", remoteOk: true });
  assert.equal(readyGuard.allowed, true);
  assert.equal(readyGuard.mode, "background-ready");
  assert.equal(readyGuard.readyCount, 3);
  const forcedGuard = queueModule.getOfflineMessageQueueSyncGuard(afterRetry, { online: true, networkQuality: "poor", remoteOk: true }, { force: true });
  assert.equal(forcedGuard.allowed, true);
  assert.equal(forcedGuard.forced, true);
  assert.equal(forcedGuard.mode, "manual-force");

  queueModule.markOfflineMessageFailed(firstId, new Error("manually handled"));
  const removed = queueModule.removeFailedOfflineMessages();
  assert.deepEqual(removed.removedIds, [firstId]);
  assert.deepEqual(queueModule.getOfflineMessageQueue().map((item) => item.id).sort(), [secondId, thirdId].sort());
});

test("offline queue sync plan blocks background recovery while offline and returns idle when clear", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=sync-plan-${Date.now()}`);

  queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "wait until phone is online" }] });
  const offlineRecovery = queueModule.getOfflineMessageQueueRecoverySummary(
    queueModule.getOfflineMessageQueue(),
    { online: false, networkQuality: "offline", remoteOk: true },
  );
  assert.equal(offlineRecovery.state, "waiting");
  assert.equal(offlineRecovery.nextAction, "wait-online");
  assert.equal(offlineRecovery.syncPlan.mode, "waiting-network");
  assert.equal(offlineRecovery.syncPlan.canUseBackgroundSync, false);
  assert.equal(offlineRecovery.syncPlan.manualReviewRequired, false);
  assert.equal(offlineRecovery.syncPlan.detailKey, "offlineQueue.syncPlan.detail.waitOnline");

  await queueModule.clearOfflineMessageQueue();
  const healthyRecovery = queueModule.getOfflineMessageQueueRecoverySummary(queueModule.getOfflineMessageQueue(), { online: true, networkQuality: "ok", remoteOk: true });
  assert.equal(healthyRecovery.state, "healthy");
  assert.equal(healthyRecovery.syncPlan.mode, "idle");
  assert.equal(healthyRecovery.syncPlan.reasonKey, "offlineQueue.syncPlan.reason.idle");
  const idleGuard = queueModule.getOfflineMessageQueueSyncGuard(queueModule.getOfflineMessageQueue(), { online: true, networkQuality: "ok", remoteOk: true });
  assert.equal(idleGuard.allowed, false);
  assert.equal(idleGuard.queueCount, 0);
});

test("offline message queue records successful write-back metadata and clears it with the queue", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=sync-meta-${Date.now()}`);

  const firstId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "write me back" }] });
  const secondId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "still waiting" }] });
  queueModule.markOfflineMessagesSynced([firstId]);

  const queue = queueModule.getOfflineMessageQueue();
  assert.deepEqual(queue.map((item) => item.id), [secondId]);
  const summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.count, 1);
  assert.equal(summary.lastSyncedCount, 1);
  assert.equal(typeof summary.lastSyncedAt, "number");
  assert.equal(summary.lastAckedMutationIds.length, 1);
  assert.equal(summary.lastAckedIdempotencyKeys.length, 1);
  assert.match(summary.lastAckedIdempotencyKeys[0], /^lifeos-offline:/);
  const syncMetaRaw = storage.get("lifeos_offline_message_queue_sync_meta");
  assert.ok(syncMetaRaw);
  assert.equal(syncMetaRaw.includes("write me back"), false);
  assert.equal(syncMetaRaw.includes("lifeos-offline:"), true);

  await queueModule.clearOfflineMessageQueue();
  const afterClear = queueModule.getOfflineMessageQueueSummary();
  assert.equal(afterClear.count, 0);
  assert.equal(afterClear.lastSyncedCount, undefined);
  assert.equal(afterClear.lastSyncedAt, undefined);
  assert.equal(storage.has("lifeos_offline_message_queue_sync_meta"), false);
});

test("offline queue records background recovery attempts and clears them with the queue", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=recovery-attempt-${Date.now()}`);

  const id = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "recover this after weak network" }] });
  const weakGuard = queueModule.getOfflineMessageQueueSyncGuard(
    queueModule.getOfflineMessageQueue(),
    { online: true, networkQuality: "poor", remoteOk: true, now: 1_000 },
  );
  assert.equal(weakGuard.allowed, false);
  assert.equal(weakGuard.mode, "waiting-stable-network");

  queueModule.recordOfflineQueueRecoveryAttempt({
    result: "blocked",
    trigger: "background-sync",
    guard: weakGuard,
    now: 1_000,
  });
  let summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.lastRecoveryAttemptAt, 1_000);
  assert.equal(summary.lastRecoveryAttemptResult, "blocked");
  assert.equal(summary.lastRecoveryAttemptTrigger, "background-sync");
  assert.equal(summary.lastRecoveryAttemptMode, "waiting-stable-network");
  assert.equal(summary.lastRecoveryAttemptReasonKey, "offlineQueue.syncPlan.reason.waitStableNetwork");
  assert.equal(summary.lastRecoveryAttemptReadyCount, 1);
  assert.equal(summary.lastRecoveryAttemptQueueCount, 1);

  const readyGuard = queueModule.getOfflineMessageQueueSyncGuard(
    queueModule.getOfflineMessageQueue(),
    { online: true, networkQuality: "ok", remoteOk: true, now: 2_000 },
  );
  assert.equal(readyGuard.allowed, true);
  queueModule.recordOfflineQueueRecoveryAttempt({
    result: "synced",
    trigger: "network-change",
    guard: readyGuard,
    syncedCount: 1,
    now: 2_000,
  });
  summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.lastRecoveryAttemptAt, 2_000);
  assert.equal(summary.lastRecoveryAttemptResult, "synced");
  assert.equal(summary.lastRecoveryAttemptTrigger, "network-change");
  assert.equal(summary.lastRecoveryAttemptMode, "background-ready");
  assert.equal(summary.lastRecoveryAttemptSyncedCount, 1);

  queueModule.recordOfflineQueueRecoveryAttempt({
    result: "failed",
    trigger: "manual",
    guard: readyGuard,
    error: new Error("Failed to fetch https://lifeos.example.com/api?token=demo-value"),
    now: 3_000,
  });
  summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.lastRecoveryAttemptResult, "failed");
  assert.match(summary.lastRecoveryAttemptError, /token=%5Bredacted%5D/);
  assert.equal(summary.lastRecoveryAttemptError.includes("secret"), false);

  queueModule.markOfflineMessagesSynced([id]);
  summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.lastRecoveryAttemptResult, "failed");
  assert.equal(summary.lastSyncedCount, 1);

  await queueModule.clearOfflineMessageQueue();
  summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.lastRecoveryAttemptAt, undefined);
  assert.equal(summary.lastRecoveryAttemptResult, undefined);
  assert.equal(storage.has("lifeos_offline_message_queue_sync_meta"), false);
});

test("offline message queue records only actually synced items", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=actual-sync-count-${Date.now()}`);

  queueModule.markOfflineMessagesSynced(["missing-before-queue"]);
  assert.equal(storage.has("lifeos_offline_message_queue_sync_meta"), false);

  const firstId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "real write back" }] });
  const secondId = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: "keep waiting" }] });
  queueModule.markOfflineMessagesSynced([firstId, "already-removed", "never-existed"]);

  const queue = queueModule.getOfflineMessageQueue();
  assert.deepEqual(queue.map((item) => item.id), [secondId]);
  const summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.count, 1);
  assert.equal(summary.lastSyncedCount, 1);
  assert.equal(typeof summary.lastSyncedAt, "number");
  assert.equal(summary.lastAckedMutationIds.length, 1);
  assert.equal(summary.lastAckedIdempotencyKeys.length, 1);
});

test("offline message queue can request persistent browser storage", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  const originalStorageManager = globalThis.navigator.storage;
  globalThis.navigator.storage = {
    ...originalStorageManager,
    persist() {
      return Promise.resolve(true);
    },
  };

  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=persist-request-${Date.now()}`);
  const granted = await queueModule.requestOfflineMessageQueuePersistentStorage();
  assert.deepEqual(granted, { supported: true, granted: true });

  globalThis.navigator.storage = {
    persisted: originalStorageManager.persisted,
    estimate: originalStorageManager.estimate,
  };
  const unsupported = await queueModule.requestOfflineMessageQueuePersistentStorage();
  assert.deepEqual(unsupported, { supported: false, granted: false });
  globalThis.navigator.storage = originalStorageManager;
});

test("offline message queue migrates legacy localStorage into IndexedDB primary storage", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  globalThis.indexedDB = createFakeIndexedDb();
  const legacyMessage = { role: "user", parts: [{ text: "legacy queue survives" }] };
  storage.set("lifeos_offline_message_queue", JSON.stringify([
    {
      id: "legacy-offline-1",
      message: legacyMessage,
      queuedAt: Date.now(),
      fingerprint: JSON.stringify(legacyMessage),
      status: "failed",
      attempts: 2,
      lastError: "old network error",
    },
  ]));

  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=indexeddb-migrate-${Date.now()}`);
  await queueModule.hydrateOfflineMessageQueue();
  const queue = queueModule.getOfflineMessageQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, "legacy-offline-1");

  const status = await queueModule.getOfflineMessageQueueStorageStatus();
  assert.equal(status.storage, "indexeddb");
  assert.equal(status.indexedDbAvailable, true);
  assert.equal(status.legacyLocalStoragePresent, true);
  assert.equal(status.count, 1);

  await queueModule.clearOfflineMessageQueue();
  assert.equal(storage.has("lifeos_offline_message_queue"), false);
  const afterClear = await queueModule.getOfflineMessageQueueStorageStatus();
  assert.equal(afterClear.storage, "indexeddb");
  assert.equal(afterClear.count, 0);
  const reloadedQueueModule = await import(`../src/services/offlineMessageQueue.ts?case=indexeddb-after-clear-${Date.now()}`);
  await reloadedQueueModule.hydrateOfflineMessageQueue();
  assert.deepEqual(reloadedQueueModule.getOfflineMessageQueue(), []);
  delete globalThis.indexedDB;
});

test("offline message queue compacts oversized messages and reports byte budget", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  delete globalThis.indexedDB;
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=byte-budget-${Date.now()}`);

  const hugeText = "offline-long-message ".repeat(20_000);
  const id = queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: hugeText }] });
  const [item] = queueModule.getOfflineMessageQueue();
  assert.equal(item.id, id);
  assert.equal(item.status, "failed");
  assert.match(item.lastError, /offline queue item limit/);
  assert.ok(item.message.parts[0].text.length < hugeText.length);
  assert.match(item.message.parts[0].text, /truncated an oversized message/);
  assert.ok(queueModule.getOfflineQueueSerializedBytes(queueModule.getOfflineMessageQueue()) < 70 * 1024);

  const status = await queueModule.getOfflineMessageQueueStorageStatus();
  assert.equal(status.maxBytes, 512 * 1024);
  assert.equal(typeof status.nearByteLimit, "boolean");
  assert.equal(status.bytes, queueModule.getOfflineQueueSerializedBytes(queueModule.getOfflineMessageQueue()));
});

test("offline queue backup text preserves queued messages before clearing", async () => {
  const { buildOfflineQueueBackupText } = await import(`../src/services/offlineQueueBackup.ts?case=backup-text-${Date.now()}`);
  const queuedAt = Date.UTC(2026, 0, 2, 3, 4, 5);
  const text = buildOfflineQueueBackupText({
    count: 2,
    pending: 1,
    syncing: 0,
    failed: 1,
    lastError: "WebSocket offline",
    nextRetryAt: queuedAt + 30_000,
  }, [
    {
      id: "offline-1",
      queuedAt,
      fingerprint: "fp-1",
      status: "pending",
      attempts: 0,
      message: { role: "user", parts: [{ text: "Remember this offline task" }] },
    },
    {
      id: "offline-2",
      queuedAt: queuedAt + 1,
      fingerprint: "fp-2",
      status: "failed",
      attempts: 3,
      lastError: "Tunnel failed",
      message: { role: "user", parts: [{ text: "Retry this failed message" }] },
    },
  ], queuedAt);

  assert.match(text, /OwnOrbit AI offline queue backup/);
  assert.match(text, /Total: 2/);
  assert.match(text, /Failed: 1/);
  assert.match(text, /Last error: WebSocket offline/);
  assert.match(text, /#1 PENDING/);
  assert.match(text, /#2 FAILED/);
  assert.match(text, /Sync identity: mutation=- idempotency=- sequence=0 sourceVersion=1 stage=pending/);
  assert.match(text, /Failure reason: Tunnel failed/);
  assert.match(text, /Remember this offline task/);
  assert.match(text, /Retry this failed message/);
});

test("offline message queue trims oldest items when storage budget is exceeded", async () => {
  storage.clear();
  dispatchedEvents = [];
  postedMessages = [];
  registeredSyncTags = [];
  delete globalThis.indexedDB;
  const queueModule = await import(`../src/services/offlineMessageQueue.ts?case=trim-budget-${Date.now()}`);

  for (let index = 0; index < 20; index += 1) {
    queueModule.enqueueOfflineMessage({ role: "user", parts: [{ text: `${index}: ${"queued payload ".repeat(2_300)}` }] });
  }

  const queue = queueModule.getOfflineMessageQueue();
  assert.ok(queue.length < 20);
  assert.ok(queueModule.getOfflineQueueSerializedBytes(queue) <= 512 * 1024);
  assert.equal(queue.some((item) => item.message.parts[0].text.startsWith("0:")), false);
  assert.equal(queue.at(-1)?.message.parts[0].text.startsWith("19:"), true);

  const status = await queueModule.getOfflineMessageQueueStorageStatus();
  assert.equal(status.count, queue.length);
  assert.equal(status.bytes <= status.maxBytes, true);
});

test("offline queue health prioritizes storage, failed sync, remote entry, and network guidance", async () => {
  const { buildOfflineQueueHealth } = await import(`../src/services/offlineQueueHealth.ts?case=health-${Date.now()}`);
  const baseSummary = { count: 0, pending: 0, syncing: 0, failed: 0, conflicts: 0 };
  const baseStorage = {
    storage: "indexeddb",
    available: true,
    indexedDbAvailable: true,
    legacyLocalStoragePresent: false,
    bytes: 0,
    maxBytes: 512 * 1024,
    nearByteLimit: false,
    count: 0,
    maxItems: 100,
    nearItemLimit: false,
    persistentStorageGranted: true,
    recommendations: [],
  };
  const online = { online: true, quality: "ok", labelKey: "network.available", label: "Network is available." };
  const weak = { online: true, quality: "poor", labelKey: "network.weak", label: "The network is weak." };
  const offline = { online: false, quality: "offline", labelKey: "network.offline", label: "Offline." };
  const remoteOk = { okForRemote: true };
  const remoteBlocked = { okForRemote: false };

  assert.equal(buildOfflineQueueHealth(baseSummary, { ...baseStorage, available: false }, online, remoteOk).titleKey, "offlineQueue.healthStorageBlockedTitle");
  assert.equal(buildOfflineQueueHealth(baseSummary, { ...baseStorage, nearByteLimit: true }, online, remoteOk).titleKey, "offlineQueue.healthStorageRiskTitle");
  assert.equal(buildOfflineQueueHealth({ ...baseSummary, count: 2, pending: 1, conflicts: 1 }, baseStorage, online, remoteOk).titleKey, "offlineQueue.healthConflictTitle");
  assert.equal(buildOfflineQueueHealth({ ...baseSummary, count: 2, failed: 1 }, baseStorage, online, remoteBlocked).titleKey, "offlineQueue.healthFailedTitle");
  assert.equal(buildOfflineQueueHealth({ ...baseSummary, count: 1, pending: 1 }, baseStorage, online, remoteBlocked).titleKey, "offlineQueue.healthEntryBlockedTitle");
  assert.equal(buildOfflineQueueHealth(baseSummary, baseStorage, offline, remoteOk).titleKey, "offlineQueue.healthOfflineTitle");
  assert.equal(buildOfflineQueueHealth(baseSummary, baseStorage, weak, remoteOk).titleKey, "offlineQueue.healthWeakNetworkTitle");
  assert.equal(buildOfflineQueueHealth({ ...baseSummary, count: 1, pending: 1 }, baseStorage, online, remoteOk).titleKey, "offlineQueue.healthPendingTitle");
  assert.equal(buildOfflineQueueHealth(baseSummary, baseStorage, online, remoteOk).titleKey, "offlineQueue.healthReadyTitle");
});
