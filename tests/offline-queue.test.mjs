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
  assert.equal(item.attempts, 1);
  assert.ok(item.lastAttemptAt);

  queueModule.markOfflineMessageFailed(firstId, new Error("network down"));
  let summary = queueModule.getOfflineMessageQueueSummary();
  assert.equal(summary.count, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.lastError, "network down");
  assert.equal(typeof summary.nextRetryAt, "number");

  queueModule.retryOfflineMessage(firstId);
  [item] = queueModule.getOfflineMessageQueue();
  assert.equal(item.status, "pending");
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
  queueModule.clearOfflineMessageQueue();
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
  assert.match(recovered.lastError, /sync was interrupted/);

  const failed = queueModule.getOfflineMessageQueue().find((item) => item.id === secondId);
  assert.ok(failed.lastAttemptAt);
  assert.equal(queueModule.getOfflineMessageNextRetryAt(failed), failed.lastAttemptAt + queueModule.getOfflineMessageRetryDelayMs(failed));
  assert.equal(queueModule.getOfflineMessageStatusLabel(failed), "Failed");
  assert.match(queueModule.getOfflineMessageRetryLabel(failed, failed.lastAttemptAt + 1_000), /Next automatic retry:/);
  assert.equal(queueModule.getOfflineMessageRetryLabel(failed, failed.lastAttemptAt + 15_000), "Ready to retry");
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

  queueModule.clearOfflineMessageQueue();
  assert.deepEqual(queueModule.getOfflineMessageQueue(), []);
  assert.equal(storage.has("lifeos_offline_message_queue"), false);
  assert.ok(dispatchedEvents.some((event) => event.type === "lifeos-offline-message-queue-changed" && event.detail.count === 0));
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

  queueModule.clearOfflineMessageQueue();
  assert.equal(storage.has("lifeos_offline_message_queue"), false);
  const afterClear = await queueModule.getOfflineMessageQueueStorageStatus();
  assert.equal(afterClear.storage, "indexeddb");
  assert.equal(afterClear.count, 0);
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
