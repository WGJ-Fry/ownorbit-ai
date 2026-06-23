import type { Message } from "../types";

const QUEUE_KEY = "lifeos_offline_message_queue";
const QUEUE_SYNC_META_KEY = "lifeos_offline_message_queue_sync_meta";
const DB_NAME = "lifeos-offline-queue";
const STORE_NAME = "queues";
const QUEUE_RECORD_ID = "primary";
const QUEUE_EVENT = "lifeos-offline-message-queue-changed";
const MAX_QUEUE_ITEMS = 100;
const MAX_QUEUE_BYTES = 512 * 1024;
const MAX_QUEUE_ITEM_BYTES = 64 * 1024;
const SYNCING_STALE_AFTER_MS = 2 * 60 * 1000;
const FAILED_RETRY_BACKOFF_MS = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000];

export type OfflineQueuedMessage = {
  id: string;
  message: Message;
  queuedAt: number;
  fingerprint: string;
  status: "pending" | "syncing" | "failed";
  attempts: number;
  lastAttemptAt?: number;
  manualRetryCount?: number;
  lastManualRetryAt?: number;
  lastError?: string;
};

export type OfflineMessageQueueStorageStatus = {
  storage: "indexeddb" | "localStorage" | "memory" | "unavailable";
  available: boolean;
  indexedDbAvailable: boolean;
  legacyLocalStoragePresent: boolean;
  bytes: number;
  maxBytes: number;
  nearByteLimit: boolean;
  count: number;
  maxItems: number;
  nearItemLimit: boolean;
  persistentStorageGranted: boolean | null;
  usageBytes?: number;
  quotaBytes?: number;
  usageRatio?: number;
  recommendations: string[];
};

export type OfflineMessageQueueSyncMeta = {
  lastSyncedAt?: number;
  lastSyncedCount?: number;
};

export type OfflineMessageFailureKind = "network" | "auth" | "server" | "storage" | "size" | "interrupted" | "unknown";

export type OfflineMessageQueueSummary = {
  count: number;
  pending: number;
  syncing: number;
  failed: number;
  lastError?: string;
  nextRetryAt?: number;
  oldestQueuedAt?: number;
  newestQueuedAt?: number;
} & OfflineMessageQueueSyncMeta;

type WriteQueueOptions = {
  requestSync?: boolean;
};

let queueCache: OfflineQueuedMessage[] | null = null;
let hydrationPromise: Promise<OfflineQueuedMessage[]> | null = null;
let indexedDbWriteOk = false;

function localStorageAvailable() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function indexedDbAvailable() {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function readRawQueue() {
  if (!localStorageAvailable()) return "";
  return localStorage.getItem(QUEUE_KEY) || "";
}

function readSyncMeta(): OfflineMessageQueueSyncMeta {
  if (!localStorageAvailable()) return {};
  try {
    const raw = localStorage.getItem(QUEUE_SYNC_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      lastSyncedAt: Number.isFinite(parsed?.lastSyncedAt) ? parsed.lastSyncedAt : undefined,
      lastSyncedCount: Number.isFinite(parsed?.lastSyncedCount) ? parsed.lastSyncedCount : undefined,
    };
  } catch {
    return {};
  }
}

function writeSyncMeta(meta: OfflineMessageQueueSyncMeta) {
  if (!localStorageAvailable()) return;
  localStorage.setItem(QUEUE_SYNC_META_KEY, JSON.stringify(meta));
}

function clearSyncMeta() {
  if (!localStorageAvailable()) return;
  localStorage.removeItem(QUEUE_SYNC_META_KEY);
}

function normalizeQueue(value: unknown): OfflineQueuedMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeQueueItem(item)).filter(Boolean) as OfflineQueuedMessage[];
}

function readLegacyQueue(): OfflineQueuedMessage[] {
  try {
    const raw = readRawQueue();
    if (!raw) return [];
    return normalizeQueue(JSON.parse(raw));
  } catch {
    return [];
  }
}

function readQueue(): OfflineQueuedMessage[] {
  if (queueCache) return queueCache;
  queueCache = readLegacyQueue();
  void hydrateOfflineMessageQueue().catch(() => undefined);
  return queueCache;
}

function normalizeQueueItem(item: any): OfflineQueuedMessage | null {
  if (!item?.message || typeof item.queuedAt !== "number") return null;
  const fingerprint = typeof item.fingerprint === "string" ? item.fingerprint : getMessageFingerprint(item.message);
  return {
    id: typeof item.id === "string" ? item.id : fingerprint,
    message: item.message,
    queuedAt: item.queuedAt,
    fingerprint,
    status: item.status === "syncing" || item.status === "failed" ? item.status : "pending",
    attempts: Number.isFinite(item.attempts) ? item.attempts : 0,
    lastAttemptAt: Number.isFinite(item.lastAttemptAt) ? item.lastAttemptAt : undefined,
    manualRetryCount: Number.isFinite(item.manualRetryCount) ? item.manualRetryCount : undefined,
    lastManualRetryAt: Number.isFinite(item.lastManualRetryAt) ? item.lastManualRetryAt : undefined,
    lastError: typeof item.lastError === "string" ? sanitizeOfflineMessageError(item.lastError) : undefined,
  };
}

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedQueue() {
  if (!indexedDbAvailable()) return null;
  const db = await openQueueDb();
  const queue = await new Promise<OfflineQueuedMessage[] | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(QUEUE_RECORD_ID);
    request.onsuccess = () => resolve(request.result ? normalizeQueue(request.result.queue || request.result) : null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return queue;
}

async function writeIndexedQueue(queue: OfflineQueuedMessage[]) {
  if (!indexedDbAvailable()) return false;
  const db = await openQueueDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ queue, updatedAt: Date.now() }, QUEUE_RECORD_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  indexedDbWriteOk = true;
  return true;
}

async function deleteIndexedQueue() {
  if (!indexedDbAvailable()) return false;
  const db = await openQueueDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(QUEUE_RECORD_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  indexedDbWriteOk = true;
  return true;
}

function writeLegacyMirror(queue: OfflineQueuedMessage[]) {
  if (!localStorageAvailable()) return;
  if (queue.length === 0) localStorage.removeItem(QUEUE_KEY);
  else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getOfflineQueueSerializedBytes(queue: OfflineQueuedMessage[]) {
  return new Blob([JSON.stringify(queue)]).size;
}

function trimQueueToBudget(queue: OfflineQueuedMessage[]) {
  let next = queue.slice(-MAX_QUEUE_ITEMS);
  while (next.length > 1 && getOfflineQueueSerializedBytes(next) > MAX_QUEUE_BYTES) {
    next = next.slice(1);
  }
  return next;
}

function truncateTextByBytes(text: string, maxBytes: number) {
  if (new Blob([text]).size <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (new Blob([text.slice(0, mid)]).size <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, Math.max(0, low - 120))}\n\n[Offline queue truncated an oversized message before local storage.]`;
}

function compactMessageForQueue(message: Message) {
  const initialBytes = new Blob([JSON.stringify(message)]).size;
  if (initialBytes <= MAX_QUEUE_ITEM_BYTES) return { message, compacted: false, initialBytes };

  const nonTextBytes = new Blob([JSON.stringify({ ...message, parts: message.parts.map((part) => ({ ...part, text: part.text ? "" : part.text })) })]).size;
  const textBudget = Math.max(512, MAX_QUEUE_ITEM_BYTES - nonTextBytes - 512);
  const textParts = message.parts.filter((part) => typeof part.text === "string" && part.text.length > 0);
  const perTextBudget = Math.max(256, Math.floor(textBudget / Math.max(1, textParts.length)));
  const compacted: Message = {
    ...message,
    parts: message.parts.map((part) => (
      typeof part.text === "string" && part.text.length > 0
        ? { ...part, text: truncateTextByBytes(part.text, perTextBudget) }
        : part
    )),
  };
  return { message: compacted, compacted: true, initialBytes };
}

function writeQueue(queue: OfflineQueuedMessage[], options: WriteQueueOptions = {}) {
  const next = trimQueueToBudget(queue);
  queueCache = next;
  writeLegacyMirror(next);
  void writeIndexedQueue(next).catch(() => undefined);
  emitQueueChanged();
  if (options.requestSync !== false) requestBackgroundSync();
}

export async function hydrateOfflineMessageQueue() {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const indexed = await readIndexedQueue().catch(() => null);
    const legacy = readLegacyQueue();
    const next = indexed?.length ? indexed : legacy;
    queueCache = next;
    if (legacy.length && !indexed?.length) {
      await writeIndexedQueue(legacy).catch(() => false);
    }
    writeLegacyMirror(next);
    emitQueueChanged();
    return next;
  })();
  return hydrationPromise;
}

function emitQueueChanged() {
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: getOfflineMessageQueueSummary() }));
}

function requestBackgroundSync() {
  const nav = typeof navigator === "undefined" ? null : navigator as any;
  if (!nav?.serviceWorker) return;

  nav.serviceWorker.controller?.postMessage?.({ type: "LIFEOS_QUEUE_UPDATED" });
  nav.serviceWorker.ready
    ?.then((registration: any) => registration.sync?.register?.("lifeos-offline-queue"))
    .catch(() => undefined);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function getMessageFingerprint(message: Message) {
  let hash = 2166136261;
  const input = stableStringify(message);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `msg_${(hash >>> 0).toString(36)}_${input.length.toString(36)}`;
}

export function enqueueOfflineMessage(message: Message) {
  const queue = readQueue();
  const compacted = compactMessageForQueue(message);
  const fingerprint = getMessageFingerprint(compacted.message);
  const existing = queue.find((item) => item.fingerprint === fingerprint);
  if (existing) {
    writeQueue(queue.map((item) => item.id === existing.id ? { ...item, status: "pending", lastError: undefined } : item));
    return existing.id;
  }

  const id = crypto.randomUUID();
  queue.push({
    id,
    message: compacted.message,
    queuedAt: Date.now(),
    fingerprint,
    status: compacted.compacted ? "failed" : "pending",
    attempts: 0,
    lastError: compacted.compacted ? `Message exceeded the offline queue item limit (${formatOfflineMessageQueueBytes(compacted.initialBytes)}). The local fallback copy was truncated; copy the original text again when the desktop is reachable.` : undefined,
  });
  writeQueue(queue);
  return id;
}

export function getOfflineMessageQueue() {
  return readQueue();
}

export function recoverStaleOfflineMessages(now = Date.now()) {
  let changed = false;
  const next = readQueue().map((item) => {
    if (item.status !== "syncing") return item;
    const lastAttemptAt = item.lastAttemptAt || item.queuedAt;
    if (now - lastAttemptAt < SYNCING_STALE_AFTER_MS) return item;
    changed = true;
    return {
      ...item,
      status: "pending" as const,
      lastError: "Previous sync was interrupted and has been restored to pending.",
    };
  });
  if (!changed) return;
  writeQueue(next, { requestSync: true });
}

export function getOfflineMessageRetryDelayMs(item: Pick<OfflineQueuedMessage, "attempts">) {
  const index = Math.max(0, Math.min(item.attempts - 1, FAILED_RETRY_BACKOFF_MS.length - 1));
  return FAILED_RETRY_BACKOFF_MS[index];
}

export function getOfflineMessageNextRetryAt(item: OfflineQueuedMessage) {
  if (item.status !== "failed" || !item.lastAttemptAt) return undefined;
  return item.lastAttemptAt + getOfflineMessageRetryDelayMs(item);
}

export function getOfflineMessageStatusLabel(item: Pick<OfflineQueuedMessage, "status">) {
  if (item.status === "failed") return "Failed";
  if (item.status === "syncing") return "Syncing";
  return "Pending";
}

export function getOfflineMessageRetryLabel(item: OfflineQueuedMessage, now = Date.now()) {
  const nextRetryAt = getOfflineMessageNextRetryAt(item);
  if (!nextRetryAt) return "";
  if (nextRetryAt <= now) return "Ready to retry";
  return `Next automatic retry: ${new Date(nextRetryAt).toLocaleTimeString()}`;
}

export function classifyOfflineMessageFailure(error: unknown): OfflineMessageFailureKind {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (!normalized.trim()) return "unknown";
  if (/exceeded|storage budget|item limit|too large|quota|truncated|near its limit/.test(normalized)) return "size";
  if (/interrupted|stale syncing|previous sync/.test(normalized)) return "interrupted";
  if (/unauthori[sz]ed|forbidden|401|403|credential|token|signature|revoked/.test(normalized)) return "auth";
  if (/indexeddb|localstorage|storage|persist|quotaexceeded/.test(normalized)) return "storage";
  if (/5\d\d|server|unavailable|bad gateway|gateway timeout|service unavailable|internal/.test(normalized)) return "server";
  if (/network|offline|failed to fetch|fetch failed|timeout|timed out|econn|enotfound|websocket|connection|dns/.test(normalized)) return "network";
  return "unknown";
}

export function sanitizeOfflineMessageError(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : String(error || "Sync failed");
  return raw
    .slice(0, 500)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/([?&](?:token|key|api_key|apikey|access_token|auth|password|signature|sig|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bhttps?:\/\/[^\s]+/gi, (value) => {
      try {
        const parsed = new URL(value);
        parsed.username = "";
        parsed.password = "";
        for (const key of Array.from(parsed.searchParams.keys())) {
          if (/token|key|api|auth|password|signature|sig|secret/i.test(key)) parsed.searchParams.set(key, "[redacted]");
        }
        return parsed.toString();
      } catch {
        return "[redacted-url]";
      }
    });
}

export function formatOfflineMessageQueueBytes(bytes: number | undefined) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function getOfflineMessageQueueStorageLabel(storage: OfflineMessageQueueStorageStatus["storage"]) {
  if (storage === "indexeddb") return "IndexedDB primary storage";
  if (storage === "localStorage") return "localStorage compatibility storage";
  if (storage === "memory") return "In-memory temporary queue";
  return "Unavailable";
}

export function getOfflineMessageQueueUsageLabel(storage: Pick<OfflineMessageQueueStorageStatus, "usageRatio" | "quotaBytes">) {
  const usage = storage.usageRatio !== undefined ? `${Math.round(storage.usageRatio * 100)}%` : "-";
  return `${usage}${storage.quotaBytes ? `, quota ${formatOfflineMessageQueueBytes(storage.quotaBytes)}` : ""}`;
}

export async function requestOfflineMessageQueuePersistentStorage() {
  const storageManager = typeof navigator === "undefined" ? null : navigator.storage;
  if (!storageManager?.persist) {
    return {
      supported: false,
      granted: false,
    };
  }
  const granted = await storageManager.persist().catch(() => false);
  return {
    supported: true,
    granted: Boolean(granted),
  };
}

export function getOfflineMessagesReadyToSync(now = Date.now()) {
  return readQueue().filter((item) => {
    if (item.status === "pending") return true;
    if (item.status === "syncing") {
      const lastAttemptAt = item.lastAttemptAt || item.queuedAt;
      return now - lastAttemptAt >= SYNCING_STALE_AFTER_MS;
    }
    const nextRetryAt = getOfflineMessageNextRetryAt(item);
    return typeof nextRetryAt === "number" && nextRetryAt <= now;
  });
}

export function getOfflineMessageQueueCount() {
  return readQueue().length;
}

export function getOfflineMessageQueueSummary() {
  const queue = readQueue();
  const syncMeta = readSyncMeta();
  const failed = queue.filter((item) => item.status === "failed").length;
  const syncing = queue.filter((item) => item.status === "syncing").length;
  const pending = queue.length - failed - syncing;
  const lastError = [...queue].reverse().find((item) => item.lastError)?.lastError;
  const queuedTimes = queue.map((item) => item.queuedAt).filter(Number.isFinite).sort((a, b) => a - b);
  const nextRetryAt = queue
    .map(getOfflineMessageNextRetryAt)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];
  return {
    count: queue.length,
    pending,
    syncing,
    failed,
    lastError,
    nextRetryAt,
    oldestQueuedAt: queuedTimes[0],
    newestQueuedAt: queuedTimes.at(-1),
    ...syncMeta,
  } satisfies OfflineMessageQueueSummary;
}

export function removeOfflineMessages(ids: string[]) {
  const idSet = new Set(ids);
  writeQueue(readQueue().filter((item) => !idSet.has(item.id)), { requestSync: false });
}

export function markOfflineMessagesSynced(ids: string[]) {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const queue = readQueue();
  const nextQueue = queue.filter((item) => !idSet.has(item.id));
  const syncedCount = queue.length - nextQueue.length;
  if (syncedCount === 0) return;
  writeSyncMeta({ lastSyncedAt: Date.now(), lastSyncedCount: syncedCount });
  writeQueue(nextQueue, { requestSync: false });
}

export function retryOfflineMessage(id: string) {
  writeQueue(readQueue().map((item) => (
    item.id === id
      ? {
        ...item,
        status: "pending",
        lastError: undefined,
        manualRetryCount: (item.manualRetryCount || 0) + 1,
        lastManualRetryAt: Date.now(),
      }
      : item
  )));
}

export function markOfflineMessageSyncing(id: string) {
  writeQueue(readQueue().map((item) => (
    item.id === id
      ? { ...item, status: "syncing", attempts: item.attempts + 1, lastAttemptAt: Date.now(), lastError: undefined }
      : item
  )), { requestSync: false });
}

export function markOfflineMessageFailed(id: string, error: unknown) {
  const message = sanitizeOfflineMessageError(error);
  writeQueue(readQueue().map((item) => (
    item.id === id
      ? { ...item, status: "failed", lastAttemptAt: Date.now(), lastError: message }
      : item
  )), { requestSync: false });
}

export function resetFailedOfflineMessages() {
  writeQueue(readQueue().map((item) => (
    item.status === "failed" ? { ...item, status: "pending", lastError: undefined } : item
  )));
}

export async function clearOfflineMessageQueue() {
  queueCache = [];
  if (localStorageAvailable()) localStorage.removeItem(QUEUE_KEY);
  clearSyncMeta();
  await deleteIndexedQueue().catch(() => false);
  emitQueueChanged();
}

export async function getOfflineMessageQueueStorageStatus(): Promise<OfflineMessageQueueStorageStatus> {
  await hydrateOfflineMessageQueue().catch(() => readQueue());
  const legacyLocalStoragePresent = Boolean(readRawQueue());
  const indexedAvailable = indexedDbAvailable();
  const available = indexedAvailable || localStorageAvailable();
  const queue = readQueue();
  const bytes = getOfflineQueueSerializedBytes(queue);
  const nearItemLimit = queue.length >= Math.floor(MAX_QUEUE_ITEMS * 0.8);
  const nearByteLimit = bytes >= Math.floor(MAX_QUEUE_BYTES * 0.8);
  let persistentStorageGranted: boolean | null = null;
  let usageBytes: number | undefined;
  let quotaBytes: number | undefined;
  let usageRatio: number | undefined;
  const storageManager = typeof navigator === "undefined" ? null : navigator.storage;
  if (storageManager?.persisted) {
    persistentStorageGranted = await storageManager.persisted().catch(() => null);
  }
  if (storageManager?.estimate) {
    const estimate = await storageManager.estimate().catch(() => null);
    if (estimate) {
      usageBytes = Number.isFinite(estimate.usage) ? estimate.usage : undefined;
      quotaBytes = Number.isFinite(estimate.quota) ? estimate.quota : undefined;
      if (usageBytes !== undefined && quotaBytes) usageRatio = usageBytes / quotaBytes;
    }
  }

  const recommendations: string[] = [];
  if (!available) {
    recommendations.push("This browser cannot write to the local queue. Offline messages may not be saved.");
  }
  if (!indexedAvailable) {
    recommendations.push("IndexedDB is unavailable. The offline queue can only use compatibility storage, which is less reliable long term.");
  }
  if (nearItemLimit) {
    recommendations.push("The offline queue is near its limit. Open chat to sync or remove messages that do not need to be written back.");
  }
  if (nearByteLimit) {
    recommendations.push("The offline queue is near its storage budget. Sync or remove large messages before adding more offline work.");
  }
  if (usageRatio !== undefined && usageRatio > 0.8) {
    recommendations.push("Browser storage is near its limit. Sync and clear old queue items to avoid automatic cleanup.");
  }
  if (persistentStorageGranted === false) {
    recommendations.push("Persistent storage has not been granted. The queue may be reclaimed during long offline periods or system cleanup.");
  }
  if (queue.length === 0 && recommendations.length === 0) {
    recommendations.push("The offline queue is empty. There are no local messages waiting to be written back.");
  }

  return {
    storage: indexedDbWriteOk || indexedAvailable ? "indexeddb" : localStorageAvailable() ? "localStorage" : queue.length ? "memory" : "unavailable",
    available,
    indexedDbAvailable: indexedAvailable,
    legacyLocalStoragePresent,
    bytes,
    maxBytes: MAX_QUEUE_BYTES,
    nearByteLimit,
    count: queue.length,
    maxItems: MAX_QUEUE_ITEMS,
    nearItemLimit,
    persistentStorageGranted,
    usageBytes,
    quotaBytes,
    usageRatio,
    recommendations,
  };
}

export function subscribeOfflineMessageQueue(listener: (summary: ReturnType<typeof getOfflineMessageQueueSummary>) => void) {
  const handleQueueChanged = () => listener(getOfflineMessageQueueSummary());
  window.addEventListener(QUEUE_EVENT, handleQueueChanged);
  window.addEventListener("storage", handleQueueChanged);
  return () => {
    window.removeEventListener(QUEUE_EVENT, handleQueueChanged);
    window.removeEventListener("storage", handleQueueChanged);
  };
}

if (typeof window !== "undefined") {
  void hydrateOfflineMessageQueue().catch(() => undefined);
}
