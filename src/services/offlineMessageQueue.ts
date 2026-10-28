import type { Message } from "../types";

const QUEUE_KEY = "lifeos_offline_message_queue";
const QUEUE_SYNC_META_KEY = "lifeos_offline_message_queue_sync_meta";
const QUEUE_CONFLICT_REVIEW_KEY = "lifeos_offline_message_queue_conflict_reviews";
const QUEUE_CLIENT_SEQUENCE_KEY = "lifeos_offline_message_queue_client_sequence";
const DB_NAME = "lifeos-offline-queue";
const STORE_NAME = "queues";
const QUEUE_RECORD_ID = "primary";
const QUEUE_EVENT = "lifeos-offline-message-queue-changed";
const MAX_QUEUE_ITEMS = 100;
const MAX_QUEUE_BYTES = 512 * 1024;
const MAX_QUEUE_ITEM_BYTES = 64 * 1024;
const SYNCING_STALE_AFTER_MS = 2 * 60 * 1000;
const SIMILAR_CONFLICT_WINDOW_MS = 10 * 60 * 1000;
const FAILED_RETRY_BACKOFF_MS = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000];

// crypto.randomUUID is secure-context only, so it is undefined when the phone reaches the
// desktop over plain-HTTP LAN. crypto.getRandomValues has no such restriction, so fall back
// to it rather than letting the queue throw on every enqueue in LAN compatibility mode.
export function randomQueueId() {
  const globalCrypto = typeof crypto !== "undefined" ? crypto : undefined;
  if (typeof globalCrypto?.randomUUID === "function") return globalCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof globalCrypto?.getRandomValues === "function") {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type OfflineQueuedMessage = {
  id: string;
  mutationId: string;
  idempotencyKey: string;
  clientSequence: number;
  sourceVersion: number;
  message: Message;
  queuedAt: number;
  fingerprint: string;
  source?: OfflineMessageSourceSnapshot;
  status: "pending" | "syncing" | "failed";
  syncStage: "queued" | "retry-ready" | "syncing" | "failed" | "manual-review";
  attempts: number;
  lastAttemptAt?: number;
  manualRetryCount?: number;
  lastManualRetryAt?: number;
  lastError?: string;
};

export type OfflineMessageSourceSnapshot = {
  client: "mobile" | "desktop" | "browser" | "unknown";
  deviceName?: string;
  deviceIdHint?: string;
  authMethod?: "signature" | "token";
  path?: string;
  online?: boolean;
  networkQuality?: "offline" | "poor" | "ok" | "unknown";
  effectiveType?: string;
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
  lastAckedMutationIds?: string[];
  lastAckedIdempotencyKeys?: string[];
  lastRecoveryAttemptAt?: number;
  lastRecoveryAttemptResult?: OfflineMessageQueueRecoveryAttemptResult;
  lastRecoveryAttemptTrigger?: OfflineMessageQueueRecoveryTrigger;
  lastRecoveryAttemptMode?: OfflineMessageQueueSyncPlan["mode"] | "manual-force";
  lastRecoveryAttemptReasonKey?: string;
  lastRecoveryAttemptDetailKey?: string;
  lastRecoveryAttemptReadyCount?: number;
  lastRecoveryAttemptQueueCount?: number;
  lastRecoveryAttemptSyncedCount?: number;
  lastRecoveryAttemptError?: string;
};

export type OfflineMessageFailureKind = "network" | "auth" | "server" | "storage" | "size" | "interrupted" | "unknown";

export type OfflineMessageQueueSummary = {
  count: number;
  pending: number;
  syncing: number;
  failed: number;
  conflicts: number;
  readyToSync: number;
  manualReview: number;
  identityReady: number;
  missingIdentity: number;
  lastError?: string;
  nextRetryAt?: number;
  oldestQueuedAt?: number;
  newestQueuedAt?: number;
} & OfflineMessageQueueSyncMeta;

export type OfflineMessageConflictGroup = {
  fingerprint: string;
  kind: "duplicate" | "similar-window";
  canAutoResolve: boolean;
  reviewKey: string;
  reviewRequired: boolean;
  reasonKey: string;
  itemIds: string[];
  keepId: string;
  duplicateIds: string[];
  count: number;
  preview: string;
  statuses: Array<OfflineQueuedMessage["status"]>;
  firstQueuedAt: number;
  lastQueuedAt: number;
  sourceDeviceCount: number;
  sourceEntryCount: number;
  resolutionOptions: OfflineMessageConflictResolutionOption[];
};

export type OfflineMessageConflictResolutionDecision = "keep-latest" | "keep-oldest" | "keep-selected" | "keep-all";

export type OfflineMessageConflictResolutionOption = {
  id: OfflineMessageConflictResolutionDecision;
  labelKey: string;
  bodyKey: string;
  keepId?: string;
  removeIds: string[];
  destructive: boolean;
  requiresBackup: boolean;
  recommended: boolean;
};

export type OfflineMessageQueueRecoverySummary = {
  state: "healthy" | "waiting" | "needs-review" | "blocked";
  nextAction: OfflineMessageQueueRecoveryAction;
  canAutoSync: boolean;
  syncPlan: OfflineMessageQueueSyncPlan;
  titleKey: string;
  bodyKey: string;
  actionKey: string;
  steps: OfflineMessageQueueRecoveryStep[];
  failedIds: string[];
  retryableFailedIds: string[];
  removableFailedIds: string[];
  interruptedIds: string[];
  conflictGroupCount: number;
  waitingCount: number;
  weakNetworkSensitive: boolean;
  sourceDeviceCount: number;
  sourceEntryCount: number;
  sourceSnapshotMissing: number;
  multiSourceRisk: boolean;
  nextRetryAt?: number;
  oldestQueuedAt?: number;
};

export type OfflineMessageQueueSyncPlan = {
  mode: "idle" | "background-ready" | "manual-review" | "blocked" | "waiting-network" | "waiting-stable-network";
  canUseBackgroundSync: boolean;
  manualReviewRequired: boolean;
  reasonKey: string;
  detailKey: string;
  nextAttemptAt?: number;
};

export type OfflineMessageQueueSyncGuard = {
  allowed: boolean;
  forced: boolean;
  mode: OfflineMessageQueueSyncPlan["mode"] | "manual-force";
  reasonKey: string;
  detailKey: string;
  readyCount: number;
  queueCount: number;
  recovery: OfflineMessageQueueRecoverySummary;
};

export type OfflineMessageQueueRecoveryAttemptResult = "synced" | "blocked" | "failed";
export type OfflineMessageQueueRecoveryTrigger = "foreground" | "background-sync" | "network-change" | "visibility" | "manual" | "timer";

export type OfflineMessageQueueRecoveryAction =
  | "none"
  | "resolve-conflicts"
  | "fix-remote"
  | "review-sources"
  | "retry-failed"
  | "recover-interrupted"
  | "wait-online"
  | "wait-stable-network"
  | "open-chat";

export type OfflineMessageQueueRecoveryStep = {
  id: "copy-backup" | OfflineMessageQueueRecoveryAction;
  titleKey: string;
  bodyKey: string;
  status: "current" | "waiting" | "blocked" | "done";
  itemCount?: number;
};

export type OfflineMessageQueueRecoveryContext = {
  now?: number;
  online?: boolean;
  networkQuality?: "offline" | "poor" | "ok" | "unknown";
  remoteOk?: boolean;
};

export type EnqueueOfflineMessageOptions = {
  source?: OfflineMessageSourceSnapshot;
};

type WriteQueueOptions = {
  requestSync?: boolean;
};

type OfflineMessageConflictReview = {
  reviewKey: string;
  fingerprint: string;
  itemIds: string[];
  decision: OfflineMessageConflictResolutionDecision;
  keepId?: string;
  removedIds: string[];
  reviewedAt: number;
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
      lastAckedMutationIds: Array.isArray(parsed?.lastAckedMutationIds) ? parsed.lastAckedMutationIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 10) : undefined,
      lastAckedIdempotencyKeys: Array.isArray(parsed?.lastAckedIdempotencyKeys) ? parsed.lastAckedIdempotencyKeys.filter((id: unknown): id is string => typeof id === "string").slice(0, 10) : undefined,
      lastRecoveryAttemptAt: Number.isFinite(parsed?.lastRecoveryAttemptAt) ? parsed.lastRecoveryAttemptAt : undefined,
      lastRecoveryAttemptResult: parsed?.lastRecoveryAttemptResult === "synced" || parsed?.lastRecoveryAttemptResult === "blocked" || parsed?.lastRecoveryAttemptResult === "failed" ? parsed.lastRecoveryAttemptResult : undefined,
      lastRecoveryAttemptTrigger: parsed?.lastRecoveryAttemptTrigger === "foreground" || parsed?.lastRecoveryAttemptTrigger === "background-sync" || parsed?.lastRecoveryAttemptTrigger === "network-change" || parsed?.lastRecoveryAttemptTrigger === "visibility" || parsed?.lastRecoveryAttemptTrigger === "manual" || parsed?.lastRecoveryAttemptTrigger === "timer" ? parsed.lastRecoveryAttemptTrigger : undefined,
      lastRecoveryAttemptMode: parsed?.lastRecoveryAttemptMode === "idle" || parsed?.lastRecoveryAttemptMode === "background-ready" || parsed?.lastRecoveryAttemptMode === "manual-review" || parsed?.lastRecoveryAttemptMode === "blocked" || parsed?.lastRecoveryAttemptMode === "waiting-network" || parsed?.lastRecoveryAttemptMode === "waiting-stable-network" || parsed?.lastRecoveryAttemptMode === "manual-force" ? parsed.lastRecoveryAttemptMode : undefined,
      lastRecoveryAttemptReasonKey: typeof parsed?.lastRecoveryAttemptReasonKey === "string" ? parsed.lastRecoveryAttemptReasonKey : undefined,
      lastRecoveryAttemptDetailKey: typeof parsed?.lastRecoveryAttemptDetailKey === "string" ? parsed.lastRecoveryAttemptDetailKey : undefined,
      lastRecoveryAttemptReadyCount: Number.isFinite(parsed?.lastRecoveryAttemptReadyCount) ? parsed.lastRecoveryAttemptReadyCount : undefined,
      lastRecoveryAttemptQueueCount: Number.isFinite(parsed?.lastRecoveryAttemptQueueCount) ? parsed.lastRecoveryAttemptQueueCount : undefined,
      lastRecoveryAttemptSyncedCount: Number.isFinite(parsed?.lastRecoveryAttemptSyncedCount) ? parsed.lastRecoveryAttemptSyncedCount : undefined,
      lastRecoveryAttemptError: typeof parsed?.lastRecoveryAttemptError === "string" ? sanitizeOfflineMessageError(parsed.lastRecoveryAttemptError) : undefined,
    };
  } catch {
    return {};
  }
}

function writeSyncMeta(meta: OfflineMessageQueueSyncMeta) {
  if (!localStorageAvailable()) return;
  localStorage.setItem(QUEUE_SYNC_META_KEY, JSON.stringify({
    ...meta,
    lastAckedMutationIds: meta.lastAckedMutationIds?.slice(0, 10),
    lastAckedIdempotencyKeys: meta.lastAckedIdempotencyKeys?.slice(0, 10),
    lastRecoveryAttemptError: meta.lastRecoveryAttemptError ? sanitizeOfflineMessageError(meta.lastRecoveryAttemptError) : undefined,
  }));
}

function clearSyncMeta() {
  if (!localStorageAvailable()) return;
  localStorage.removeItem(QUEUE_SYNC_META_KEY);
}

function reviewKeyForConflict(kind: OfflineMessageConflictGroup["kind"], itemIds: string[]) {
  return `${kind}:${[...itemIds].sort().join("|")}`;
}

function readConflictReviews(queue: OfflineQueuedMessage[] = readQueue()): OfflineMessageConflictReview[] {
  if (!localStorageAvailable()) return [];
  try {
    const queueIds = new Set(queue.map((item) => item.id));
    const parsed = JSON.parse(localStorage.getItem(QUEUE_CONFLICT_REVIEW_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        reviewKey: typeof item?.reviewKey === "string" ? item.reviewKey : "",
        fingerprint: typeof item?.fingerprint === "string" ? item.fingerprint : "",
        itemIds: Array.isArray(item?.itemIds) ? item.itemIds.filter((id: unknown): id is string => typeof id === "string") : [],
        decision: item?.decision === "keep-latest" || item?.decision === "keep-oldest" || item?.decision === "keep-selected" || item?.decision === "keep-all" ? item.decision : "keep-all",
        keepId: typeof item?.keepId === "string" ? item.keepId : undefined,
        removedIds: Array.isArray(item?.removedIds) ? item.removedIds.filter((id: unknown): id is string => typeof id === "string") : [],
        reviewedAt: Number.isFinite(item?.reviewedAt) ? item.reviewedAt : 0,
      }))
      .filter((item) => item.reviewKey && item.itemIds.length > 0)
      .filter((item) => item.itemIds.some((id) => queueIds.has(id)));
  } catch {
    return [];
  }
}

function writeConflictReviews(reviews: OfflineMessageConflictReview[]) {
  if (!localStorageAvailable()) return;
  const unique = new Map<string, OfflineMessageConflictReview>();
  reviews.forEach((review) => unique.set(review.reviewKey, review));
  localStorage.setItem(QUEUE_CONFLICT_REVIEW_KEY, JSON.stringify([...unique.values()].slice(-80)));
}

function clearConflictReviews() {
  if (!localStorageAvailable()) return;
  localStorage.removeItem(QUEUE_CONFLICT_REVIEW_KEY);
}

function addConflictReview(review: OfflineMessageConflictReview, queue = readQueue()) {
  writeConflictReviews([
    ...readConflictReviews(queue).filter((item) => item.reviewKey !== review.reviewKey),
    review,
  ]);
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
  const source = normalizeOfflineMessageSource(item.source);
  const id = typeof item.id === "string" ? item.id : fingerprint;
  const mutationId = typeof item.mutationId === "string" ? item.mutationId : `legacy-${id}`;
  const syncStage = item.syncStage === "syncing" || item.syncStage === "failed" || item.syncStage === "retry-ready" || item.syncStage === "manual-review"
    ? item.syncStage
    : item.status === "syncing"
      ? "syncing"
      : item.status === "failed"
        ? "failed"
        : "queued";
  return {
    id,
    mutationId,
    idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : buildOfflineMessageIdempotencyKey({ fingerprint, mutationId, source }),
    clientSequence: Number.isFinite(item.clientSequence) ? item.clientSequence : 0,
    sourceVersion: Number.isFinite(item.sourceVersion) ? item.sourceVersion : 1,
    message: item.message,
    queuedAt: item.queuedAt,
    fingerprint,
    source,
    status: item.status === "syncing" || item.status === "failed" ? item.status : "pending",
    syncStage,
    attempts: Number.isFinite(item.attempts) ? item.attempts : 0,
    lastAttemptAt: Number.isFinite(item.lastAttemptAt) ? item.lastAttemptAt : undefined,
    manualRetryCount: Number.isFinite(item.manualRetryCount) ? item.manualRetryCount : undefined,
    lastManualRetryAt: Number.isFinite(item.lastManualRetryAt) ? item.lastManualRetryAt : undefined,
    lastError: typeof item.lastError === "string" ? sanitizeOfflineMessageError(item.lastError) : undefined,
  };
}

function nextClientSequence() {
  if (!localStorageAvailable()) return Date.now();
  const current = Number.parseInt(localStorage.getItem(QUEUE_CLIENT_SEQUENCE_KEY) || "0", 10);
  const next = Number.isFinite(current) ? current + 1 : 1;
  localStorage.setItem(QUEUE_CLIENT_SEQUENCE_KEY, String(next));
  return next;
}

function buildOfflineMessageIdempotencyKey(input: {
  fingerprint: string;
  mutationId: string;
  source?: OfflineMessageSourceSnapshot;
}) {
  const device = input.source?.deviceIdHint || input.source?.deviceName || input.source?.client || "unknown";
  return `lifeos-offline:${device}:${input.fingerprint}:${input.mutationId}`;
}

function sanitizeSourceText(value: unknown, maxLength = 80) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
  return text || undefined;
}

function sanitizeSourcePath(value: unknown) {
  const text = sanitizeSourceText(value, 120);
  if (!text) return undefined;
  return text.split(/[?#]/)[0].slice(0, 120) || undefined;
}

function normalizeOfflineMessageSource(value: unknown): OfflineMessageSourceSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<OfflineMessageSourceSnapshot>;
  const client = source.client === "mobile" || source.client === "desktop" || source.client === "browser" ? source.client : "unknown";
  const authMethod = source.authMethod === "signature" || source.authMethod === "token" ? source.authMethod : undefined;
  const networkQuality = source.networkQuality === "offline" || source.networkQuality === "poor" || source.networkQuality === "ok" || source.networkQuality === "unknown" ? source.networkQuality : undefined;
  return {
    client,
    deviceName: sanitizeSourceText(source.deviceName, 60),
    deviceIdHint: sanitizeSourceText(source.deviceIdHint, 24),
    authMethod,
    path: sanitizeSourcePath(source.path),
    online: typeof source.online === "boolean" ? source.online : undefined,
    networkQuality,
    effectiveType: sanitizeSourceText(source.effectiveType, 24),
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

export function enqueueOfflineMessage(message: Message, options: EnqueueOfflineMessageOptions = {}) {
  const queue = readQueue();
  const compacted = compactMessageForQueue(message);
  const fingerprint = getMessageFingerprint(compacted.message);
  const source = normalizeOfflineMessageSource(options.source);
  const existing = queue.find((item) => item.fingerprint === fingerprint);
  if (existing) {
    writeQueue(queue.map((item) => item.id === existing.id ? { ...item, source: source || item.source, status: "pending", lastError: undefined } : item));
    return existing.id;
  }

  const id = randomQueueId();
  const mutationId = randomQueueId();
  const clientSequence = nextClientSequence();
  queue.push({
    id,
    mutationId,
    idempotencyKey: buildOfflineMessageIdempotencyKey({ fingerprint, mutationId, source }),
    clientSequence,
    sourceVersion: 1,
    message: compacted.message,
    queuedAt: Date.now(),
    fingerprint,
    source,
    status: compacted.compacted ? "failed" : "pending",
    syncStage: compacted.compacted ? "failed" : "queued",
    attempts: 0,
    lastError: compacted.compacted ? `Message exceeded the offline queue item limit (${formatOfflineMessageQueueBytes(compacted.initialBytes)}). The local fallback copy was truncated; copy the original text again when the desktop is reachable.` : undefined,
  });
  writeQueue(queue);
  return id;
}

// Whether a queue entry can anchor messages queued behind it: it must flush
// on its own (not a failed record), and leave room for one more item, since
// trimQueueToBudget evicts from the front once the queue is over budget.
// Checking size matters because re-sending an identical oversized message
// dedupes onto the old record and resets it to pending.
export function isOfflineMessageDeliverable(id: string) {
  const entry = readQueue().find((item) => item.id === id);
  if (!entry || entry.status === "failed") return false;
  return getOfflineQueueSerializedBytes([entry]) <= MAX_QUEUE_BYTES - MAX_QUEUE_ITEM_BYTES;
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
      syncStage: "retry-ready" as const,
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

function getQueueItemsReadyToSync(queue: OfflineQueuedMessage[], now = Date.now()) {
  return queue.filter((item) => {
    if (item.syncStage === "manual-review") return false;
    if (item.status === "pending") return true;
    if (item.status === "syncing") {
      const lastAttemptAt = item.lastAttemptAt || item.queuedAt;
      return now - lastAttemptAt >= SYNCING_STALE_AFTER_MS;
    }
    const nextRetryAt = getOfflineMessageNextRetryAt(item);
    return typeof nextRetryAt === "number" && nextRetryAt <= now;
  });
}

export function getOfflineMessagesReadyToSync(now = Date.now()) {
  return getQueueItemsReadyToSync(readQueue(), now);
}

export function getOfflineMessageQueueCount() {
  return readQueue().length;
}

function previewOfflineMessage(message: Message) {
  return message.parts.find((part) => part.text)?.text?.trim().slice(0, 120) || "Attachment message";
}

function conflictText(message: Message) {
  return message.parts
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join(" ")
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function conflictTokens(text: string) {
  return new Set(text.split(/\s+/).filter((token) => token.length >= 2).slice(0, 40));
}

function conflictTextSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = conflictTokens(left);
  const rightTokens = conflictTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function sourceDeviceKey(item: OfflineQueuedMessage) {
  return item.source?.deviceIdHint || item.source?.deviceName || item.source?.client || "";
}

function sourceEntryKey(item: OfflineQueuedMessage) {
  return item.source?.path || item.source?.client || "";
}

function sourceConflictKey(item: OfflineQueuedMessage) {
  return `${sourceDeviceKey(item) || "legacy"}|${sourceEntryKey(item) || "unknown"}`;
}

function sourceCounts(items: OfflineQueuedMessage[]) {
  return {
    sourceDeviceCount: new Set(items.map(sourceDeviceKey).filter(Boolean)).size,
    sourceEntryCount: new Set(items.map(sourceEntryKey).filter(Boolean)).size,
  };
}

function buildResolutionOptions(
  kind: OfflineMessageConflictGroup["kind"],
  sorted: OfflineQueuedMessage[],
): OfflineMessageConflictResolutionOption[] {
  const latest = sorted[0];
  const oldest = sorted.at(-1) || latest;
  const latestRemoveIds = sorted.filter((item) => item.id !== latest.id).map((item) => item.id);
  const oldestRemoveIds = sorted.filter((item) => item.id !== oldest.id).map((item) => item.id);
  if (kind === "duplicate") {
    return [
      {
        id: "keep-latest",
        labelKey: "offlineQueue.conflictOption.keepLatest",
        bodyKey: "offlineQueue.conflictOption.keepLatestBody",
        keepId: latest.id,
        removeIds: latestRemoveIds,
        destructive: true,
        requiresBackup: false,
        recommended: true,
      },
      {
        id: "keep-oldest",
        labelKey: "offlineQueue.conflictOption.keepOldest",
        bodyKey: "offlineQueue.conflictOption.keepOldestBody",
        keepId: oldest.id,
        removeIds: oldestRemoveIds,
        destructive: true,
        requiresBackup: false,
        recommended: false,
      },
    ];
  }
  return [
    {
      id: "keep-all",
      labelKey: "offlineQueue.conflictOption.keepAll",
      bodyKey: "offlineQueue.conflictOption.keepAllBody",
      removeIds: [],
      destructive: false,
      requiresBackup: true,
      recommended: true,
    },
    {
      id: "keep-latest",
      labelKey: "offlineQueue.conflictOption.keepLatestReviewed",
      bodyKey: "offlineQueue.conflictOption.keepLatestReviewedBody",
      keepId: latest.id,
      removeIds: latestRemoveIds,
      destructive: true,
      requiresBackup: true,
      recommended: false,
    },
    {
      id: "keep-oldest",
      labelKey: "offlineQueue.conflictOption.keepOldestReviewed",
      bodyKey: "offlineQueue.conflictOption.keepOldestReviewedBody",
      keepId: oldest.id,
      removeIds: oldestRemoveIds,
      destructive: true,
      requiresBackup: true,
      recommended: false,
    },
  ];
}

function isConflictReviewed(kind: OfflineMessageConflictGroup["kind"], itemIds: string[], queue: OfflineQueuedMessage[]) {
  if (kind !== "similar-window") return false;
  const reviewKey = reviewKeyForConflict(kind, itemIds);
  return readConflictReviews(queue).some((review) => review.reviewKey === reviewKey);
}

function buildReviewedItemIdSet(queue: OfflineQueuedMessage[]) {
  const reviewedIds = new Set<string>();
  readConflictReviews(queue).forEach((review) => review.itemIds.forEach((id) => reviewedIds.add(id)));
  return reviewedIds;
}

function buildSimilarOfflineMessageConflictGroups(queue: OfflineQueuedMessage[], excludedIds: Set<string>): OfflineMessageConflictGroup[] {
  const groups: OfflineMessageConflictGroup[] = [];
  const usedIds = new Set<string>();
  const candidates = queue
    .filter((item) => !excludedIds.has(item.id))
    .map((item) => ({ item, text: conflictText(item.message) }))
    .filter((entry) => entry.text.length >= 8)
    .sort((left, right) => right.item.queuedAt - left.item.queuedAt);

  for (const base of candidates) {
    if (usedIds.has(base.item.id)) continue;
    const matches = [base.item];
    for (const candidate of candidates) {
      if (candidate.item.id === base.item.id || usedIds.has(candidate.item.id)) continue;
      if (candidate.item.fingerprint === base.item.fingerprint) continue;
      if (Math.abs(candidate.item.queuedAt - base.item.queuedAt) > SIMILAR_CONFLICT_WINDOW_MS) continue;
      if (sourceConflictKey(candidate.item) === sourceConflictKey(base.item)) continue;
      if (conflictTextSimilarity(base.text, candidate.text) < 0.78) continue;
      matches.push(candidate.item);
    }
    if (matches.length < 2) continue;
    matches.forEach((item) => usedIds.add(item.id));
    const sorted = [...matches].sort((left, right) => right.queuedAt - left.queuedAt);
    const itemIds = sorted.map((item) => item.id);
    if (isConflictReviewed("similar-window", itemIds, queue)) continue;
    const counts = sourceCounts(sorted);
    groups.push({
      fingerprint: `similar-${sorted.map((item) => item.id).join("-")}`,
      kind: "similar-window",
      canAutoResolve: false,
      reviewKey: reviewKeyForConflict("similar-window", itemIds),
      reviewRequired: true,
      reasonKey: "offlineQueue.conflictReason.similarWindow",
      itemIds,
      keepId: sorted[0].id,
      duplicateIds: [],
      count: sorted.length,
      preview: previewOfflineMessage(sorted[0].message),
      statuses: Array.from(new Set(sorted.map((item) => item.status))),
      firstQueuedAt: Math.min(...sorted.map((item) => item.queuedAt)),
      lastQueuedAt: Math.max(...sorted.map((item) => item.queuedAt)),
      ...counts,
      resolutionOptions: buildResolutionOptions("similar-window", sorted),
    });
  }
  return groups;
}

export function getOfflineMessageConflictGroups(queue = readQueue()): OfflineMessageConflictGroup[] {
  const groups = new Map<string, OfflineQueuedMessage[]>();
  for (const item of queue) {
    const current = groups.get(item.fingerprint) || [];
    current.push(item);
    groups.set(item.fingerprint, current);
  }

  const exactGroups = [...groups.entries()]
    .map(([fingerprint, items]) => {
      const sorted = [...items].sort((left, right) => right.queuedAt - left.queuedAt);
      const keep = sorted[0];
      const itemIds = sorted.map((item) => item.id);
      const counts = sourceCounts(sorted);
      return {
        fingerprint,
        kind: "duplicate" as const,
        canAutoResolve: true,
        reviewKey: reviewKeyForConflict("duplicate", itemIds),
        reviewRequired: false,
        reasonKey: "offlineQueue.conflictReason.duplicate",
        itemIds,
        keepId: keep.id,
        duplicateIds: sorted.slice(1).map((item) => item.id),
        count: sorted.length,
        preview: previewOfflineMessage(keep.message),
        statuses: Array.from(new Set(sorted.map((item) => item.status))),
        firstQueuedAt: Math.min(...sorted.map((item) => item.queuedAt)),
        lastQueuedAt: Math.max(...sorted.map((item) => item.queuedAt)),
        ...counts,
        resolutionOptions: buildResolutionOptions("duplicate", sorted),
      };
    })
    .filter((group) => group.count > 1)
    .sort((left, right) => right.lastQueuedAt - left.lastQueuedAt);
  const exactConflictIds = new Set(exactGroups.flatMap((group) => group.itemIds));
  return [...exactGroups, ...buildSimilarOfflineMessageConflictGroups(queue, exactConflictIds)]
    .sort((left, right) => right.lastQueuedAt - left.lastQueuedAt);
}

export function resolveOfflineMessageConflictGroup(
  fingerprint: string,
  keepId?: string,
  decision: OfflineMessageConflictResolutionDecision = "keep-selected",
) {
  const queue = readQueue();
  const group = queue.filter((item) => item.fingerprint === fingerprint);
  if (group.length >= 2) {
    const newest = [...group].sort((left, right) => right.queuedAt - left.queuedAt)[0];
    const oldest = [...group].sort((left, right) => left.queuedAt - right.queuedAt)[0];
    const selectedKeepId = decision === "keep-oldest"
      ? oldest.id
      : group.some((item) => item.id === keepId)
        ? keepId!
        : newest.id;
    const removedIds = group.filter((item) => item.id !== selectedKeepId).map((item) => item.id);
    writeQueue(queue.filter((item) => !removedIds.includes(item.id)));
    return {
      fingerprint,
      keepId: selectedKeepId,
      removedIds,
      decision: decision === "keep-selected" ? "keep-latest" : decision,
    };
  }

  const conflict = getOfflineMessageConflictGroups(queue).find((item) => item.fingerprint === fingerprint);
  if (!conflict || conflict.kind !== "similar-window") return null;
  if (decision === "keep-all") {
    addConflictReview({
      reviewKey: conflict.reviewKey,
      fingerprint: conflict.fingerprint,
      itemIds: conflict.itemIds,
      decision,
      removedIds: [],
      reviewedAt: Date.now(),
    }, queue);
    writeQueue(queue);
    return {
      fingerprint,
      keepId: conflict.keepId,
      removedIds: [],
      decision,
    };
  }
  const selectedKeepId = decision === "keep-oldest"
    ? conflict.resolutionOptions.find((option) => option.id === "keep-oldest")?.keepId
    : conflict.itemIds.includes(keepId || "")
      ? keepId
      : decision === "keep-latest"
        ? conflict.keepId
        : undefined;
  if (!selectedKeepId || !conflict.itemIds.includes(selectedKeepId)) return null;
  const removedIds = conflict.itemIds.filter((id) => id !== selectedKeepId);
  addConflictReview({
    reviewKey: conflict.reviewKey,
    fingerprint: conflict.fingerprint,
    itemIds: conflict.itemIds,
    decision,
    keepId: selectedKeepId,
    removedIds,
    reviewedAt: Date.now(),
  }, queue);
  writeQueue(queue.filter((item) => !removedIds.includes(item.id)));
  return {
    fingerprint,
    keepId: selectedKeepId,
    removedIds,
    decision,
  };
}

export function getOfflineMessageQueueSummary() {
  const queue = readQueue();
  const syncMeta = readSyncMeta();
  const failed = queue.filter((item) => item.status === "failed").length;
  const syncing = queue.filter((item) => item.status === "syncing").length;
  const pending = queue.length - failed - syncing;
  const conflicts = getOfflineMessageConflictGroups(queue).reduce((count, group) => count + (group.kind === "duplicate" ? group.duplicateIds.length : 1), 0);
  const readyToSync = getOfflineMessagesReadyToSync().length;
  const manualReview = queue.filter((item) => item.syncStage === "manual-review").length + getOfflineMessageConflictGroups(queue).length;
  const identityReady = queue.filter((item) => item.mutationId && item.idempotencyKey && Number.isFinite(item.clientSequence)).length;
  const missingIdentity = queue.length - identityReady;
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
    conflicts,
    readyToSync,
    manualReview,
    identityReady,
    missingIdentity,
    lastError,
    nextRetryAt,
    oldestQueuedAt: queuedTimes[0],
    newestQueuedAt: queuedTimes.at(-1),
    ...syncMeta,
  } satisfies OfflineMessageQueueSummary;
}

function buildRecoveryStep(
  id: OfflineMessageQueueRecoveryStep["id"],
  status: OfflineMessageQueueRecoveryStep["status"],
  itemCount?: number,
): OfflineMessageQueueRecoveryStep {
  const key = String(id).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return {
    id,
    status,
    itemCount,
    titleKey: `offlineQueue.recoveryStep.${key}.title`,
    bodyKey: `offlineQueue.recoveryStep.${key}.body`,
  };
}

function getOfflineQueueRecoveryAction(input: {
  queueLength: number;
  conflictGroupCount: number;
  failedCount: number;
  interruptedCount: number;
  multiSourceRisk: boolean;
  online?: boolean;
  networkQuality?: "offline" | "poor" | "ok" | "unknown";
  remoteOk?: boolean;
}): OfflineMessageQueueRecoveryAction {
  if (input.conflictGroupCount > 0) return "resolve-conflicts";
  if (input.failedCount > 0 && input.remoteOk === false) return "fix-remote";
  if (input.multiSourceRisk) return "review-sources";
  if (input.failedCount > 0) return "retry-failed";
  if (input.interruptedCount > 0) return "recover-interrupted";
  if (input.queueLength > 0 && input.online === false) return "wait-online";
  if (input.queueLength > 0 && input.networkQuality === "poor") return "wait-stable-network";
  if (input.queueLength > 0) return "open-chat";
  return "none";
}

function buildOfflineQueueRecoverySteps(input: {
  nextAction: OfflineMessageQueueRecoveryAction;
  queueLength: number;
  conflictGroupCount: number;
  failedCount: number;
  interruptedCount: number;
  multiSourceRisk: boolean;
  sourceSnapshotMissing: number;
  canAutoSync: boolean;
}) {
  const steps: OfflineMessageQueueRecoveryStep[] = [];
  const needsBackup = input.conflictGroupCount > 0 || input.failedCount > 0 || input.multiSourceRisk || input.sourceSnapshotMissing > 0;
  if (needsBackup) steps.push(buildRecoveryStep("copy-backup", "current", input.queueLength));
  if (input.conflictGroupCount > 0) steps.push(buildRecoveryStep("resolve-conflicts", input.nextAction === "resolve-conflicts" ? "current" : "waiting", input.conflictGroupCount));
  if (input.nextAction === "fix-remote") steps.push(buildRecoveryStep("fix-remote", "blocked", input.failedCount));
  if (input.multiSourceRisk) steps.push(buildRecoveryStep("review-sources", input.nextAction === "review-sources" ? "current" : "waiting", input.queueLength));
  if (input.failedCount > 0) steps.push(buildRecoveryStep("retry-failed", input.nextAction === "retry-failed" ? "current" : "waiting", input.failedCount));
  if (input.interruptedCount > 0) steps.push(buildRecoveryStep("recover-interrupted", input.nextAction === "recover-interrupted" ? "current" : "waiting", input.interruptedCount));
  if (input.nextAction === "wait-online") steps.push(buildRecoveryStep("wait-online", "current", input.queueLength));
  if (input.nextAction === "wait-stable-network") steps.push(buildRecoveryStep("wait-stable-network", "current", input.queueLength));
  if (input.queueLength > 0) steps.push(buildRecoveryStep("open-chat", input.canAutoSync || input.nextAction === "open-chat" ? "current" : "waiting", input.queueLength));
  if (input.queueLength === 0) steps.push(buildRecoveryStep("none", "done"));
  return steps;
}

function buildOfflineQueueSyncPlan(input: {
  queueLength: number;
  conflictGroupCount: number;
  failedCount: number;
  interruptedCount: number;
  multiSourceRisk: boolean;
  online?: boolean;
  networkQuality?: "offline" | "poor" | "ok" | "unknown";
  remoteOk?: boolean;
  canAutoSync: boolean;
  nextRetryAt?: number;
}): OfflineMessageQueueSyncPlan {
  if (input.queueLength === 0) {
    return {
      mode: "idle",
      canUseBackgroundSync: false,
      manualReviewRequired: false,
      reasonKey: "offlineQueue.syncPlan.reason.idle",
      detailKey: "offlineQueue.syncPlan.detail.idle",
    };
  }
  if (input.conflictGroupCount > 0 || input.multiSourceRisk) {
    return {
      mode: "manual-review",
      canUseBackgroundSync: false,
      manualReviewRequired: true,
      reasonKey: "offlineQueue.syncPlan.reason.manualReview",
      detailKey: "offlineQueue.syncPlan.detail.manualReview",
      nextAttemptAt: input.nextRetryAt,
    };
  }
  if ((input.failedCount > 0 && input.remoteOk === false) || input.remoteOk === false) {
    return {
      mode: "blocked",
      canUseBackgroundSync: false,
      manualReviewRequired: input.failedCount > 0,
      reasonKey: "offlineQueue.syncPlan.reason.remoteBlocked",
      detailKey: "offlineQueue.syncPlan.detail.remoteBlocked",
      nextAttemptAt: input.nextRetryAt,
    };
  }
  if (input.failedCount > 0 || input.interruptedCount > 0) {
    return {
      mode: "manual-review",
      canUseBackgroundSync: false,
      manualReviewRequired: true,
      reasonKey: input.interruptedCount > 0 ? "offlineQueue.syncPlan.reason.interrupted" : "offlineQueue.syncPlan.reason.failed",
      detailKey: input.interruptedCount > 0 ? "offlineQueue.syncPlan.detail.interrupted" : "offlineQueue.syncPlan.detail.failed",
      nextAttemptAt: input.nextRetryAt,
    };
  }
  if (input.online === false || input.networkQuality === "offline") {
    return {
      mode: "waiting-network",
      canUseBackgroundSync: false,
      manualReviewRequired: false,
      reasonKey: "offlineQueue.syncPlan.reason.waitOnline",
      detailKey: "offlineQueue.syncPlan.detail.waitOnline",
      nextAttemptAt: input.nextRetryAt,
    };
  }
  if (input.networkQuality === "poor") {
    return {
      mode: "waiting-stable-network",
      canUseBackgroundSync: false,
      manualReviewRequired: false,
      reasonKey: "offlineQueue.syncPlan.reason.waitStableNetwork",
      detailKey: "offlineQueue.syncPlan.detail.waitStableNetwork",
      nextAttemptAt: input.nextRetryAt,
    };
  }
  return {
    mode: input.canAutoSync ? "background-ready" : "manual-review",
    canUseBackgroundSync: input.canAutoSync,
    manualReviewRequired: !input.canAutoSync,
    reasonKey: input.canAutoSync ? "offlineQueue.syncPlan.reason.backgroundReady" : "offlineQueue.syncPlan.reason.manualReview",
    detailKey: input.canAutoSync ? "offlineQueue.syncPlan.detail.backgroundReady" : "offlineQueue.syncPlan.detail.manualReview",
    nextAttemptAt: input.nextRetryAt,
  };
}

export function getOfflineMessageQueueRecoverySummary(queue = readQueue(), context: OfflineMessageQueueRecoveryContext = {}) {
  const now = context.now ?? Date.now();
  const conflictGroupCount = getOfflineMessageConflictGroups(queue).length;
  const failedItems = queue.filter((item) => item.status === "failed");
  const sourceDeviceKeys = new Set(queue.map((item) => item.source?.deviceIdHint || item.source?.deviceName).filter(Boolean));
  const sourceEntryKeys = new Set(queue.map((item) => item.source?.path || item.source?.client).filter(Boolean));
  const sourceSnapshotMissing = queue.filter((item) => !item.source).length;
  const reviewedItemIds = buildReviewedItemIdSet(queue);
  const unreviewedSourceItems = queue.filter((item) => !reviewedItemIds.has(item.id));
  const unreviewedSourceDeviceKeys = new Set(unreviewedSourceItems.map((item) => item.source?.deviceIdHint || item.source?.deviceName).filter(Boolean));
  const unreviewedSourceEntryKeys = new Set(unreviewedSourceItems.map((item) => item.source?.path || item.source?.client).filter(Boolean));
  const multiSourceRisk = unreviewedSourceDeviceKeys.size > 1 || unreviewedSourceEntryKeys.size > 1;
  const interruptedIds = queue
    .filter((item) => item.status === "syncing" && now - (item.lastAttemptAt || item.queuedAt) >= SYNCING_STALE_AFTER_MS)
    .map((item) => item.id);
  const retryableFailedIds = failedItems
    .filter((item) => (getOfflineMessageNextRetryAt(item) || 0) <= now)
    .map((item) => item.id);
  const queuedTimes = queue.map((item) => item.queuedAt).filter(Number.isFinite).sort((a, b) => a - b);
  const nextRetryAt = failedItems
    .map(getOfflineMessageNextRetryAt)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];
  const nextAction = getOfflineQueueRecoveryAction({
    queueLength: queue.length,
    conflictGroupCount,
    failedCount: failedItems.length,
    interruptedCount: interruptedIds.length,
    multiSourceRisk,
    online: context.online,
    networkQuality: context.networkQuality,
    remoteOk: context.remoteOk,
  });
  const canAutoSync = queue.length > 0 && nextAction === "open-chat" && context.remoteOk !== false;
  const steps = buildOfflineQueueRecoverySteps({
    nextAction,
    queueLength: queue.length,
    conflictGroupCount,
    failedCount: failedItems.length,
    interruptedCount: interruptedIds.length,
    multiSourceRisk,
    sourceSnapshotMissing,
    canAutoSync,
  });
  const syncPlan = buildOfflineQueueSyncPlan({
    queueLength: queue.length,
    conflictGroupCount,
    failedCount: failedItems.length,
    interruptedCount: interruptedIds.length,
    multiSourceRisk,
    online: context.online,
    networkQuality: context.networkQuality,
    remoteOk: context.remoteOk,
    canAutoSync,
    nextRetryAt,
  });
  const base = {
    nextAction,
    canAutoSync,
    syncPlan,
    steps,
    failedIds: failedItems.map((item) => item.id),
    retryableFailedIds,
    removableFailedIds: failedItems.map((item) => item.id),
    interruptedIds,
    conflictGroupCount,
    waitingCount: queue.filter((item) => item.status !== "failed").length + failedItems.length,
    weakNetworkSensitive: context.networkQuality === "poor" && queue.length > 0,
    sourceDeviceCount: sourceDeviceKeys.size,
    sourceEntryCount: sourceEntryKeys.size,
    sourceSnapshotMissing,
    multiSourceRisk,
    nextRetryAt,
    oldestQueuedAt: queuedTimes[0],
  };
  if (conflictGroupCount > 0) {
    return { ...base, state: "needs-review", titleKey: "offlineQueue.recoveryConflictTitle", bodyKey: "offlineQueue.recoveryConflictBody", actionKey: "offlineQueue.recoveryConflictAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  if (failedItems.length > 0 && context.remoteOk === false) {
    return { ...base, state: "blocked", titleKey: "offlineQueue.recoveryRemoteBlockedTitle", bodyKey: "offlineQueue.recoveryRemoteBlockedBody", actionKey: "offlineQueue.recoveryRemoteBlockedAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  if (multiSourceRisk) {
    return { ...base, state: "needs-review", titleKey: "offlineQueue.recoveryMultiSourceTitle", bodyKey: "offlineQueue.recoveryMultiSourceBody", actionKey: "offlineQueue.recoveryMultiSourceAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  if (failedItems.length > 0) {
    return { ...base, state: "needs-review", titleKey: "offlineQueue.recoveryFailedTitle", bodyKey: "offlineQueue.recoveryFailedBody", actionKey: "offlineQueue.recoveryFailedAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  if (interruptedIds.length > 0) {
    return { ...base, state: "needs-review", titleKey: "offlineQueue.recoveryInterruptedTitle", bodyKey: "offlineQueue.recoveryInterruptedBody", actionKey: "offlineQueue.recoveryInterruptedAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  if (queue.length > 0 && context.online === false) {
    return { ...base, state: "waiting", titleKey: "offlineQueue.recoveryOfflineTitle", bodyKey: "offlineQueue.recoveryOfflineBody", actionKey: "offlineQueue.recoveryOfflineAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  if (context.networkQuality === "poor" && queue.length > 0) {
    return { ...base, state: "waiting", titleKey: "offlineQueue.recoveryWeakNetworkTitle", bodyKey: "offlineQueue.recoveryWeakNetworkBody", actionKey: "offlineQueue.recoveryWeakNetworkAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  if (queue.length > 0) {
    return { ...base, state: "waiting", titleKey: "offlineQueue.recoveryWaitingTitle", bodyKey: "offlineQueue.recoveryWaitingBody", actionKey: "offlineQueue.recoveryWaitingAction" } satisfies OfflineMessageQueueRecoverySummary;
  }
  return { ...base, state: "healthy", titleKey: "offlineQueue.recoveryHealthyTitle", bodyKey: "offlineQueue.recoveryHealthyBody", actionKey: "offlineQueue.recoveryHealthyAction" } satisfies OfflineMessageQueueRecoverySummary;
}

export function getOfflineMessageQueueSyncGuard(
  queue = readQueue(),
  context: OfflineMessageQueueRecoveryContext = {},
  options: { force?: boolean } = {},
): OfflineMessageQueueSyncGuard {
  const now = context.now ?? Date.now();
  const recovery = getOfflineMessageQueueRecoverySummary(queue, { ...context, now });
  const readyCount = getQueueItemsReadyToSync(queue, now).length;
  const hardManualReview = recovery.conflictGroupCount > 0 || recovery.multiSourceRisk;
  const forced = Boolean(options.force && queue.length > 0 && !hardManualReview);
  const allowed = forced || (readyCount > 0 && recovery.syncPlan.mode === "background-ready" && recovery.syncPlan.canUseBackgroundSync);
  return {
    allowed,
    forced,
    mode: forced ? "manual-force" : recovery.syncPlan.mode,
    reasonKey: recovery.syncPlan.reasonKey,
    detailKey: recovery.syncPlan.detailKey,
    readyCount,
    queueCount: queue.length,
    recovery,
  };
}

export function recordOfflineQueueRecoveryAttempt(input: {
  result: OfflineMessageQueueRecoveryAttemptResult;
  trigger?: OfflineMessageQueueRecoveryTrigger;
  guard?: OfflineMessageQueueSyncGuard;
  syncedCount?: number;
  error?: unknown;
  now?: number;
}) {
  const meta = readSyncMeta();
  writeSyncMeta({
    ...meta,
    lastRecoveryAttemptAt: input.now ?? Date.now(),
    lastRecoveryAttemptResult: input.result,
    lastRecoveryAttemptTrigger: input.trigger || "foreground",
    lastRecoveryAttemptMode: input.guard?.mode,
    lastRecoveryAttemptReasonKey: input.guard?.reasonKey,
    lastRecoveryAttemptDetailKey: input.guard?.detailKey,
    lastRecoveryAttemptReadyCount: input.guard?.readyCount,
    lastRecoveryAttemptQueueCount: input.guard?.queueCount,
    lastRecoveryAttemptSyncedCount: Number.isFinite(input.syncedCount) ? input.syncedCount : undefined,
    lastRecoveryAttemptError: input.error ? sanitizeOfflineMessageError(input.error) : undefined,
  });
  emitQueueChanged();
}

export function removeOfflineMessages(ids: string[]) {
  const idSet = new Set(ids);
  writeQueue(readQueue().filter((item) => !idSet.has(item.id)), { requestSync: false });
}

export function removeFailedOfflineMessages() {
  const queue = readQueue();
  const removedIds = queue.filter((item) => item.status === "failed").map((item) => item.id);
  if (removedIds.length > 0) removeOfflineMessages(removedIds);
  return { removedIds };
}

export function markOfflineMessagesSynced(ids: string[]) {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const queue = readQueue();
  const nextQueue = queue.filter((item) => !idSet.has(item.id));
  const syncedCount = queue.length - nextQueue.length;
  if (syncedCount === 0) return;
  const syncedItems = queue.filter((item) => idSet.has(item.id));
  const meta = readSyncMeta();
  writeSyncMeta({
    ...meta,
    lastSyncedAt: Date.now(),
    lastSyncedCount: syncedCount,
    lastAckedMutationIds: syncedItems.map((item) => item.mutationId),
    lastAckedIdempotencyKeys: syncedItems.map((item) => item.idempotencyKey),
  });
  writeQueue(nextQueue, { requestSync: false });
}

export function retryOfflineMessage(id: string) {
  writeQueue(readQueue().map((item) => (
    item.id === id
      ? {
        ...item,
        status: "pending",
        syncStage: "retry-ready",
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
      ? { ...item, status: "syncing", syncStage: "syncing", attempts: item.attempts + 1, lastAttemptAt: Date.now(), lastError: undefined }
      : item
  )), { requestSync: false });
}

export function markOfflineMessageFailed(id: string, error: unknown) {
  const message = sanitizeOfflineMessageError(error);
  writeQueue(readQueue().map((item) => (
    item.id === id
      ? { ...item, status: "failed", syncStage: "failed", lastAttemptAt: Date.now(), lastError: message }
      : item
  )), { requestSync: false });
}

export function resetFailedOfflineMessages() {
  writeQueue(readQueue().map((item) => (
    item.status === "failed" ? { ...item, status: "pending", syncStage: "retry-ready", lastError: undefined } : item
  )));
}

export function retryFailedOfflineMessages() {
  const retriedIds: string[] = [];
  const now = Date.now();
  writeQueue(readQueue().map((item) => {
    if (item.status !== "failed") return item;
    retriedIds.push(item.id);
    return {
      ...item,
      status: "pending" as const,
      syncStage: "retry-ready" as const,
      lastError: undefined,
      manualRetryCount: (item.manualRetryCount || 0) + 1,
      lastManualRetryAt: now,
    };
  }));
  return { retriedIds };
}

export async function clearOfflineMessageQueue() {
  queueCache = [];
  if (localStorageAvailable()) localStorage.removeItem(QUEUE_KEY);
  clearSyncMeta();
  clearConflictReviews();
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
