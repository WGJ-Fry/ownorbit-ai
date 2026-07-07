import type { IcloudAutoRefreshResult, MobileIcloudHandoffEventReportInput } from "./lifeosApi";

const STORAGE_KEY = "lifeos_mobile_icloud_handoff";
const ENTRIES_STORAGE_KEY = "lifeos_mobile_icloud_handoff_entries";
const PREFERRED_ENTRY_STORAGE_KEY = "lifeos_mobile_icloud_handoff_preferred_entry";
const PENDING_EVENTS_STORAGE_KEY = "lifeos_mobile_icloud_handoff_pending_events";
const SERVER_REPAIR_STORAGE_KEY = "lifeos_mobile_icloud_handoff_server_repair";
const MAX_STORED_HANDOFF_ENTRIES = 8;
const MAX_PENDING_HANDOFF_EVENTS = 12;

const handoffParamKeys = [
  "lifeosEntry",
  "entryGeneratedAt",
  "entryRefreshAfter",
  "entryExpiresAt",
  "entryBaseUrl",
  "entryMode",
  "entryStability",
  "entryLabel",
  "entryDesktopId",
  "entryDesktopName",
  "entryDesktopSlug",
  "entryChecksumSha256",
];

export type MobileIcloudHandoffEntry = {
  source: "icloud";
  generatedAt: number;
  refreshAfter: number;
  expiresAt: number;
  baseUrl: string;
  mode: string;
  stability: string;
  label: string;
  desktopId?: string;
  desktopName?: string;
  desktopSlug?: string;
  checksumSha256?: string;
  savedAt: number;
  lastConnectivityTestedAt?: number;
  lastConnectivityOk?: boolean;
  lastConnectivityError?: string;
  lastIgnoredAt?: number;
  lastIgnoredGeneratedAt?: number;
  lastIgnoredBaseUrl?: string;
};

export type MobileIcloudHandoffStatus = {
  entry: MobileIcloudHandoffEntry;
  status: "fresh" | "stale" | "expired" | "address-mismatch" | "legacy";
  needsRefresh: boolean;
  currentBase: string;
  titleKey: string;
  bodyKey: string;
};

export type MobileIcloudHandoffEntryFreshness = "fresh" | "stale" | "expired" | "legacy";

export type MobileIcloudHandoffEntryRecommendation = {
  recommendedEntry: MobileIcloudHandoffEntry | null;
  recommendedKey: string;
  otherEntries: MobileIcloudHandoffEntry[];
  preferredEntry: MobileIcloudHandoffEntry | null;
  preferredNeedsSwitch: boolean;
  preferredSwitchReason: "none" | "default-stale" | "default-expired" | "default-legacy" | "default-failed" | "default-same-wifi";
};

export type MobileIcloudHandoffAutoSwitchResult = {
  switched: boolean;
  recommendation: MobileIcloudHandoffEntryRecommendation;
  previousEntry: MobileIcloudHandoffEntry | null;
  nextEntry: MobileIcloudHandoffEntry | null;
};

export type MobileIcloudHandoffActionKey =
  | "mobileDevice.icloudHandoffActionReady"
  | "mobileDevice.icloudHandoffActionRetest"
  | "mobileDevice.icloudHandoffActionRefresh"
  | "mobileDevice.icloudHandoffActionReopen"
  | "mobileDevice.icloudHandoffActionMismatch";

export type MobileIcloudHandoffServerRepairStatus = {
  eventType: MobileIcloudHandoffEventReportInput["eventType"];
  entryBaseUrl: string;
  reportedAt: number;
  reported: boolean;
  pending: boolean;
  pendingCount: number;
  refreshed: boolean;
  refreshReason: string;
  requestedReason?: string;
};

type MobileConnectivityLike = {
  ok: boolean;
  currentBase: string;
  latencyMs: number;
  error?: string;
  testedAt?: number;
  steps: Array<{ id: "health" | "mobile-shell" | "websocket"; ok: boolean; url: string; latencyMs: number; status?: number; error?: string }>;
};

type HandoffLaunchOptions = {
  href?: string;
  cleanupUrl?: boolean;
  timeoutMs?: number;
  now?: number;
  testConnectivity?: (options: { currentHref?: string; timeoutMs?: number }) => Promise<MobileConnectivityLike>;
  reportConnectivity?: (result: MobileConnectivityLike) => Promise<unknown>;
  reportIcloudHandoffEvent?: (event: MobileIcloudHandoffEventReportInput) => Promise<unknown>;
};

type PendingMobileIcloudHandoffEvent = MobileIcloudHandoffEventReportInput & {
  queuedAt: number;
  attempts: number;
  lastTriedAt?: number;
};

const icloudHandoffEventTypes = [
  "opened-current-entry",
  "ignored-superseded-entry",
  "opened-stale-entry",
  "opened-expired-entry",
  "opened-legacy-entry",
  "opened-address-mismatch-entry",
] as const;

function normalizeIcloudHandoffEventType(value: unknown): MobileIcloudHandoffEventReportInput["eventType"] | "" {
  const eventType = String(value || "").trim();
  return icloudHandoffEventTypes.includes(eventType as typeof icloudHandoffEventTypes[number])
    ? eventType as MobileIcloudHandoffEventReportInput["eventType"]
    : "";
}

function safeStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`.replace(/\/$/, "");
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
}

function currentBaseFromHref(currentHref?: string) {
  const href = currentHref || (typeof window === "undefined" ? "" : window.location.href);
  if (!href) return "";
  try {
    const url = new URL(href);
    const pathname = url.pathname.replace(/\/mobile\/.*$/, "").replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function safeNumber(value: string | null) {
  const next = Number(value || 0);
  return Number.isFinite(next) && next > 0 ? next : 0;
}

function isHttpBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isPrivateNetworkHost(hostname: string) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function isMobileIcloudHandoffSameWifiOnly(entry: Pick<MobileIcloudHandoffEntry, "baseUrl" | "mode" | "stability">) {
  const mode = String(entry.mode || "").toLowerCase();
  const stability = String(entry.stability || "").toLowerCase();
  if (mode === "lan" || mode === "local" || stability === "local") return true;
  try {
    const url = new URL(entry.baseUrl);
    return url.protocol === "http:" && isPrivateNetworkHost(url.hostname);
  } catch {
    return /^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(String(entry.baseUrl || ""));
  }
}

function normalizeChecksum(value?: string | null) {
  const checksum = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(checksum) ? checksum : "";
}

function normalizeEntryText(value?: string | null, limit = 80) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeEntryId(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "")
    .slice(0, 80);
}

function normalizePendingIcloudHandoffEvent(parsed: any): PendingMobileIcloudHandoffEvent | null {
  if (!parsed || typeof parsed !== "object") return null;
  const eventType = String(parsed.eventType || "") as MobileIcloudHandoffEventReportInput["eventType"];
  if (!icloudHandoffEventTypes.includes(eventType as typeof icloudHandoffEventTypes[number])) return null;
  const entryBaseUrl = normalizeBaseUrl(parsed.entryBaseUrl);
  const currentBaseUrl = normalizeBaseUrl(parsed.currentBaseUrl);
  const storedBaseUrl = normalizeBaseUrl(parsed.storedBaseUrl);
  if (!isHttpBaseUrl(entryBaseUrl) || !isHttpBaseUrl(currentBaseUrl) || !isHttpBaseUrl(storedBaseUrl)) return null;
  return {
    eventType,
    entryBaseUrl,
    currentBaseUrl,
    storedBaseUrl,
    entryGeneratedAt: Number(parsed.entryGeneratedAt || 0) || undefined,
    storedGeneratedAt: Number(parsed.storedGeneratedAt || 0) || undefined,
    checksumSha256: normalizeChecksum(parsed.checksumSha256) || undefined,
    ignoredAt: Number(parsed.ignoredAt || 0) || undefined,
    queuedAt: Number(parsed.queuedAt || Date.now()),
    attempts: Math.max(0, Number(parsed.attempts || 0)),
    lastTriedAt: Number(parsed.lastTriedAt || 0) || undefined,
  };
}

function readPendingIcloudHandoffEvents(storage = safeStorage()) {
  if (!storage) return [] as PendingMobileIcloudHandoffEvent[];
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_EVENTS_STORAGE_KEY) || "[]");
    return (Array.isArray(parsed) ? parsed : [])
      .map(normalizePendingIcloudHandoffEvent)
      .filter(Boolean) as PendingMobileIcloudHandoffEvent[];
  } catch {
    return [];
  }
}

function writePendingIcloudHandoffEvents(events: PendingMobileIcloudHandoffEvent[], storage = safeStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(PENDING_EVENTS_STORAGE_KEY, JSON.stringify(events.slice(0, MAX_PENDING_HANDOFF_EVENTS)));
    return true;
  } catch {
    return false;
  }
}

function mobileIcloudEventKey(event: MobileIcloudHandoffEventReportInput) {
  return [
    event.eventType,
    normalizeBaseUrl(event.entryBaseUrl),
    Number(event.entryGeneratedAt || 0),
    normalizeBaseUrl(event.storedBaseUrl),
    Number(event.storedGeneratedAt || 0),
    normalizeChecksum(event.checksumSha256),
  ].join("|");
}

function queuePendingIcloudHandoffEvent(event: MobileIcloudHandoffEventReportInput, now = Date.now()) {
  const storage = safeStorage();
  if (!storage) return 0;
  const pendingEvent = normalizePendingIcloudHandoffEvent({ ...event, queuedAt: now, attempts: 0 });
  if (!pendingEvent) return readPendingIcloudHandoffEvents(storage).length;
  const next = [
    pendingEvent,
    ...readPendingIcloudHandoffEvents(storage).filter((item) => mobileIcloudEventKey(item) !== mobileIcloudEventKey(pendingEvent)),
  ].slice(0, MAX_PENDING_HANDOFF_EVENTS);
  writePendingIcloudHandoffEvents(next, storage);
  return next.length;
}

function normalizeServerRepairStatus(parsed: any): MobileIcloudHandoffServerRepairStatus | null {
  if (!parsed || typeof parsed !== "object") return null;
  const eventType = normalizeIcloudHandoffEventType(parsed.eventType);
  const entryBaseUrl = normalizeBaseUrl(parsed.entryBaseUrl);
  const reportedAt = Number(parsed.reportedAt || 0);
  if (!eventType || !entryBaseUrl || !reportedAt) return null;
  return {
    eventType,
    entryBaseUrl,
    reportedAt,
    reported: Boolean(parsed.reported),
    pending: Boolean(parsed.pending),
    pendingCount: Math.max(0, Number(parsed.pendingCount || 0)),
    refreshed: Boolean(parsed.refreshed),
    refreshReason: normalizeEntryText(parsed.refreshReason || "unknown", 80) || "unknown",
    requestedReason: normalizeEntryText(parsed.requestedReason, 100) || undefined,
  };
}

function writeServerRepairStatus(
  event: MobileIcloudHandoffEventReportInput,
  input: { reported: boolean; pending: boolean; pendingCount: number; icloudRefresh?: IcloudAutoRefreshResult | null },
  now = Date.now(),
) {
  const record = normalizeServerRepairStatus({
    eventType: event.eventType,
    entryBaseUrl: event.entryBaseUrl,
    reportedAt: now,
    reported: input.reported,
    pending: input.pending,
    pendingCount: input.pendingCount,
    refreshed: Boolean(input.icloudRefresh?.refreshed),
    refreshReason: input.icloudRefresh?.reason || (input.pending ? "queued" : "reported"),
    requestedReason: input.icloudRefresh?.requestedReason,
  });
  const storage = safeStorage();
  if (!storage || !record) return record;
  try {
    storage.setItem(SERVER_REPAIR_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // This status is only a local hint; pending event durability is handled separately.
  }
  return record;
}

export function getMobileIcloudHandoffServerRepairStatus() {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    return normalizeServerRepairStatus(JSON.parse(storage.getItem(SERVER_REPAIR_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

export function getPendingMobileIcloudHandoffEventCount() {
  return readPendingIcloudHandoffEvents().length;
}

async function reportOrQueueIcloudHandoffEvent(
  event: MobileIcloudHandoffEventReportInput,
  reporter?: (event: MobileIcloudHandoffEventReportInput) => Promise<unknown>,
  now = Date.now(),
) {
  const reportIcloudHandoffEvent = reporter || (await import("./lifeosApi")).reportMobileIcloudHandoffEvent;
  try {
    const response = await reportIcloudHandoffEvent(event) as { icloudRefresh?: IcloudAutoRefreshResult } | undefined;
    const storage = safeStorage();
    if (storage) {
      const next = readPendingIcloudHandoffEvents(storage).filter((item) => mobileIcloudEventKey(item) !== mobileIcloudEventKey(event));
      writePendingIcloudHandoffEvents(next, storage);
      return {
        reported: true,
        pendingCount: next.length,
        serverRepair: writeServerRepairStatus(event, { reported: true, pending: false, pendingCount: next.length, icloudRefresh: response?.icloudRefresh }, now),
      };
    }
    return {
      reported: true,
      pendingCount: 0,
      serverRepair: writeServerRepairStatus(event, { reported: true, pending: false, pendingCount: 0, icloudRefresh: response?.icloudRefresh }, now),
    };
  } catch {
    const pendingCount = queuePendingIcloudHandoffEvent(event, now);
    return {
      reported: false,
      pendingCount,
      serverRepair: writeServerRepairStatus(event, { reported: false, pending: true, pendingCount }, now),
    };
  }
}

export async function flushPendingMobileIcloudHandoffEvents(reporter?: (event: MobileIcloudHandoffEventReportInput) => Promise<unknown>, now = Date.now()) {
  const storage = safeStorage();
  if (!storage) return { attempted: 0, reported: 0, remaining: 0, serverRepair: null };
  const pending = readPendingIcloudHandoffEvents(storage);
  if (!pending.length) return { attempted: 0, reported: 0, remaining: 0, serverRepair: getMobileIcloudHandoffServerRepairStatus() };
  const reportIcloudHandoffEvent = reporter || (await import("./lifeosApi")).reportMobileIcloudHandoffEvent;
  const remaining: PendingMobileIcloudHandoffEvent[] = [];
  let reported = 0;
  let serverRepair: MobileIcloudHandoffServerRepairStatus | null = null;
  for (const item of pending) {
    const { queuedAt, attempts, lastTriedAt, ...event } = item;
    try {
      const response = await reportIcloudHandoffEvent(event) as { icloudRefresh?: IcloudAutoRefreshResult } | undefined;
      reported += 1;
      serverRepair = writeServerRepairStatus(event, { reported: true, pending: false, pendingCount: 0, icloudRefresh: response?.icloudRefresh }, now);
    } catch {
      remaining.push({
        ...item,
        attempts: attempts + 1,
        lastTriedAt: now,
      });
    }
  }
  writePendingIcloudHandoffEvents(remaining, storage);
  return { attempted: pending.length, reported, remaining: remaining.length, serverRepair };
}

export function parseMobileIcloudHandoffFromUrl(href?: string, now = Date.now()): MobileIcloudHandoffEntry | null {
  const rawHref = href || (typeof window === "undefined" ? "" : window.location.href);
  if (!rawHref) return null;
  try {
    const url = new URL(rawHref);
    const params = url.searchParams;
    if (params.get("lifeosEntry") !== "icloud") return null;
    const baseUrl = normalizeBaseUrl(params.get("entryBaseUrl") || currentBaseFromHref(rawHref));
    const generatedAt = safeNumber(params.get("entryGeneratedAt"));
    const refreshAfter = safeNumber(params.get("entryRefreshAfter"));
    const expiresAt = safeNumber(params.get("entryExpiresAt"));
    if (!baseUrl || !isHttpBaseUrl(baseUrl) || !generatedAt || !refreshAfter || !expiresAt) return null;
    return {
      source: "icloud",
      generatedAt,
      refreshAfter,
      expiresAt,
      baseUrl,
      mode: String(params.get("entryMode") || ""),
      stability: String(params.get("entryStability") || ""),
      label: normalizeEntryText(params.get("entryLabel") || "LifeOS iCloud Mobile Entry", 120),
      desktopId: normalizeEntryId(params.get("entryDesktopId")) || undefined,
      desktopName: normalizeEntryText(params.get("entryDesktopName"), 80) || undefined,
      desktopSlug: normalizeEntryId(params.get("entryDesktopSlug")) || undefined,
      checksumSha256: normalizeChecksum(params.get("entryChecksumSha256")) || undefined,
      savedAt: now,
    };
  } catch {
    return null;
  }
}

export function saveMobileIcloudHandoff(entry: MobileIcloudHandoffEntry) {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entry));
    storage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(mergeMobileIcloudHandoffEntries(entry, readMobileIcloudHandoffEntries(storage))));
    return true;
  } catch {
    return false;
  }
}

function mobileIcloudHandoffEntryKey(entry: MobileIcloudHandoffEntry) {
  const desktopId = normalizeEntryId(entry.desktopId);
  if (desktopId) return `desktop:${desktopId}`;
  if (entry.checksumSha256) return `checksum:${entry.checksumSha256}`;
  return `base:${normalizeBaseUrl(entry.baseUrl)}`;
}

export function getMobileIcloudHandoffEntryKey(entry: MobileIcloudHandoffEntry) {
  return mobileIcloudHandoffEntryKey(entry);
}

function normalizeStoredMobileIcloudHandoffEntry(parsed: any): MobileIcloudHandoffEntry | null {
  if (!parsed || parsed.source !== "icloud" || !isHttpBaseUrl(parsed.baseUrl)) return null;
  const entry = {
    source: "icloud" as const,
    generatedAt: Number(parsed.generatedAt || 0),
    refreshAfter: Number(parsed.refreshAfter || 0),
    expiresAt: Number(parsed.expiresAt || 0),
    baseUrl: normalizeBaseUrl(parsed.baseUrl),
    mode: String(parsed.mode || ""),
    stability: String(parsed.stability || ""),
    label: normalizeEntryText(parsed.label || "LifeOS iCloud Mobile Entry", 120),
    desktopId: normalizeEntryId(parsed.desktopId) || undefined,
    desktopName: normalizeEntryText(parsed.desktopName, 80) || undefined,
    desktopSlug: normalizeEntryId(parsed.desktopSlug) || undefined,
    checksumSha256: normalizeChecksum(parsed.checksumSha256) || undefined,
    savedAt: Number(parsed.savedAt || 0),
    lastConnectivityTestedAt: Number(parsed.lastConnectivityTestedAt || 0) || undefined,
    lastConnectivityOk: typeof parsed.lastConnectivityOk === "boolean" ? parsed.lastConnectivityOk : undefined,
    lastConnectivityError: String(parsed.lastConnectivityError || ""),
    lastIgnoredAt: Number(parsed.lastIgnoredAt || 0) || undefined,
    lastIgnoredGeneratedAt: Number(parsed.lastIgnoredGeneratedAt || 0) || undefined,
    lastIgnoredBaseUrl: normalizeBaseUrl(parsed.lastIgnoredBaseUrl || "") || undefined,
  };
  return entry.generatedAt && entry.refreshAfter && entry.expiresAt ? entry : null;
}

function readMobileIcloudHandoffEntries(storage = safeStorage()) {
  if (!storage) return [] as MobileIcloudHandoffEntry[];
  try {
    const parsed = JSON.parse(storage.getItem(ENTRIES_STORAGE_KEY) || "[]");
    return (Array.isArray(parsed) ? parsed : [])
      .map(normalizeStoredMobileIcloudHandoffEntry)
      .filter(Boolean) as MobileIcloudHandoffEntry[];
  } catch {
    return [];
  }
}

function mergeMobileIcloudHandoffEntries(entry: MobileIcloudHandoffEntry, entries: MobileIcloudHandoffEntry[]) {
  const key = mobileIcloudHandoffEntryKey(entry);
  return [entry, ...entries.filter((item) => mobileIcloudHandoffEntryKey(item) !== key)]
    .slice(0, MAX_STORED_HANDOFF_ENTRIES);
}

export function getPreferredMobileIcloudHandoffEntryKey() {
  const storage = safeStorage();
  if (!storage) return "";
  return normalizeEntryText(storage.getItem(PREFERRED_ENTRY_STORAGE_KEY), 160);
}

export function setPreferredMobileIcloudHandoffEntry(entry: MobileIcloudHandoffEntry) {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    storage.setItem(PREFERRED_ENTRY_STORAGE_KEY, mobileIcloudHandoffEntryKey(entry));
    return true;
  } catch {
    return false;
  }
}

export function isPreferredMobileIcloudHandoffEntry(entry: MobileIcloudHandoffEntry) {
  const preferred = getPreferredMobileIcloudHandoffEntryKey();
  return Boolean(preferred && preferred === mobileIcloudHandoffEntryKey(entry));
}

function sortMobileIcloudHandoffEntriesByPreference(entries: MobileIcloudHandoffEntry[]) {
  const preferred = getPreferredMobileIcloudHandoffEntryKey();
  if (!preferred) return entries;
  return [...entries].sort((left, right) => {
    const leftPreferred = mobileIcloudHandoffEntryKey(left) === preferred;
    const rightPreferred = mobileIcloudHandoffEntryKey(right) === preferred;
    if (leftPreferred === rightPreferred) return 0;
    return leftPreferred ? -1 : 1;
  });
}

export function getStoredMobileIcloudHandoffEntries() {
  const storage = safeStorage();
  if (!storage) return [];
  const current = getStoredMobileIcloudHandoff();
  const entries = readMobileIcloudHandoffEntries(storage);
  return sortMobileIcloudHandoffEntriesByPreference(current ? mergeMobileIcloudHandoffEntries(current, entries) : entries);
}

export function forgetStoredMobileIcloudHandoffEntry(entryToForget: MobileIcloudHandoffEntry) {
  const storage = safeStorage();
  if (!storage) return false;
  const current = getStoredMobileIcloudHandoff();
  const keyToForget = mobileIcloudHandoffEntryKey(entryToForget);
  if (current && mobileIcloudHandoffEntryKey(current) === keyToForget) return false;
  const entries = readMobileIcloudHandoffEntries(storage);
  const nextEntries = entries.filter((entry) => mobileIcloudHandoffEntryKey(entry) !== keyToForget);
  if (nextEntries.length === entries.length) return false;
  try {
    storage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(nextEntries));
    if (getPreferredMobileIcloudHandoffEntryKey() === keyToForget) storage.removeItem(PREFERRED_ENTRY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function buildMobileIcloudHandoffUrl(entry: MobileIcloudHandoffEntry, route = "/mobile/device") {
  const base = normalizeBaseUrl(entry.baseUrl);
  const path = route.startsWith("/") ? route : `/${route}`;
  const url = new URL(`${base}${path}`);
  url.searchParams.set("lifeosEntry", "icloud");
  url.searchParams.set("entryGeneratedAt", String(entry.generatedAt || ""));
  url.searchParams.set("entryRefreshAfter", String(entry.refreshAfter || ""));
  url.searchParams.set("entryExpiresAt", String(entry.expiresAt || ""));
  url.searchParams.set("entryBaseUrl", entry.baseUrl);
  url.searchParams.set("entryMode", entry.mode || "");
  url.searchParams.set("entryStability", entry.stability || "");
  url.searchParams.set("entryLabel", entry.label || "");
  url.searchParams.set("entryDesktopId", entry.desktopId || "");
  url.searchParams.set("entryDesktopName", entry.desktopName || "");
  url.searchParams.set("entryDesktopSlug", entry.desktopSlug || "");
  url.searchParams.set("entryChecksumSha256", entry.checksumSha256 || "");
  return url.toString();
}

export function isMobileIcloudHandoffSuperseded(entry: MobileIcloudHandoffEntry, current = getStoredMobileIcloudHandoff()) {
  if (!current) return false;
  const entryDesktopId = normalizeEntryId(entry.desktopId);
  const currentDesktopId = normalizeEntryId(current.desktopId);
  if (entryDesktopId && currentDesktopId && entryDesktopId !== currentDesktopId) return false;
  if (current.generatedAt > entry.generatedAt) return true;
  return current.generatedAt === entry.generatedAt && Boolean(current.checksumSha256) && !entry.checksumSha256;
}

function mergeMobileIcloudHandoffPatch(patch: Partial<MobileIcloudHandoffEntry>) {
  const current = getStoredMobileIcloudHandoff();
  if (!current) return null;
  const next = { ...current, ...patch };
  saveMobileIcloudHandoff(next);
  return next;
}

function websocketUrlFromBase(base: string) {
  if (!base) return "/api/v1/ws";
  try {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v1/ws`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return `${base.replace(/\/+$/, "")}/api/v1/ws`;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Mobile connectivity test failed");
}

function createFailedConnectivityResult(entry: MobileIcloudHandoffEntry, href: string, error: unknown, testedAt: number): MobileConnectivityLike {
  const currentBase = currentBaseFromHref(href) || entry.baseUrl;
  const message = errorMessage(error);
  return {
    ok: false,
    currentBase,
    latencyMs: 0,
    testedAt,
    error: message,
    steps: [
      { id: "health", ok: false, url: `${currentBase}/api/v1/health`, latencyMs: 0, error: message },
      { id: "mobile-shell", ok: false, url: `${currentBase}/mobile/chat`, latencyMs: 0, error: message },
      { id: "websocket", ok: false, url: websocketUrlFromBase(currentBase), latencyMs: 0, error: message },
    ],
  };
}

function eventTypeForIcloudHandoffStatus(status: MobileIcloudHandoffStatus): MobileIcloudHandoffEventReportInput["eventType"] | null {
  if (status.status === "fresh") return "opened-current-entry";
  if (status.status === "stale") return "opened-stale-entry";
  if (status.status === "expired") return "opened-expired-entry";
  if (status.status === "legacy") return "opened-legacy-entry";
  if (status.status === "address-mismatch") return "opened-address-mismatch-entry";
  return null;
}

async function reportIcloudHandoffIssueEvent(
  eventType: MobileIcloudHandoffEventReportInput["eventType"],
  entry: MobileIcloudHandoffEntry,
  href: string,
  now: number,
  reporter?: (event: MobileIcloudHandoffEventReportInput) => Promise<unknown>,
) {
  return reportOrQueueIcloudHandoffEvent({
    eventType,
    entryBaseUrl: entry.baseUrl,
    currentBaseUrl: currentBaseFromHref(href) || entry.baseUrl,
    storedBaseUrl: entry.baseUrl,
    entryGeneratedAt: entry.generatedAt,
    storedGeneratedAt: entry.generatedAt,
    checksumSha256: entry.checksumSha256,
    ignoredAt: now,
  }, reporter, now);
}

export function consumeMobileIcloudHandoffFromUrl(href?: string, now = Date.now()) {
  const entry = parseMobileIcloudHandoffFromUrl(href, now);
  if (!entry) return null;
  const current = getStoredMobileIcloudHandoff();
  if (isMobileIcloudHandoffSuperseded(entry, current)) {
    saveMobileIcloudHandoff({
      ...current!,
      lastIgnoredAt: now,
      lastIgnoredGeneratedAt: entry.generatedAt,
      lastIgnoredBaseUrl: entry.baseUrl,
    });
    return current;
  }
  saveMobileIcloudHandoff(entry);
  return entry;
}

export async function handleMobileIcloudHandoffLaunch(options: HandoffLaunchOptions = {}) {
  const href = options.href || (typeof window === "undefined" ? "" : window.location.href);
  const now = options.now || Date.now();
  const pendingBeforeLaunch = await flushPendingMobileIcloudHandoffEvents(options.reportIcloudHandoffEvent, now).catch(() => ({ attempted: 0, reported: 0, remaining: getPendingMobileIcloudHandoffEventCount() }));
  const parsedEntry = parseMobileIcloudHandoffFromUrl(href, now);
  if (!parsedEntry) return pendingBeforeLaunch.attempted ? { entry: getStoredMobileIcloudHandoff(), result: null, reportSaved: false, icloudEventReported: false, pendingIcloudEventsFlushed: pendingBeforeLaunch.reported, pendingIcloudEventCount: pendingBeforeLaunch.remaining } : null;
  const storedBefore = getStoredMobileIcloudHandoff();
  const ignoredOlderEntry = isMobileIcloudHandoffSuperseded(parsedEntry, storedBefore);
  let entry = parsedEntry;
  if (ignoredOlderEntry && storedBefore) {
    entry = {
      ...storedBefore,
      lastIgnoredAt: now,
      lastIgnoredGeneratedAt: parsedEntry.generatedAt,
      lastIgnoredBaseUrl: parsedEntry.baseUrl,
    };
    saveMobileIcloudHandoff(entry);
  } else {
    saveMobileIcloudHandoff(parsedEntry);
  }
  if (options.cleanupUrl !== false) stripMobileIcloudHandoffParamsFromUrl();
  if (ignoredOlderEntry) {
    let icloudEventReported = false;
    let pendingIcloudEventCount = getPendingMobileIcloudHandoffEventCount();
    try {
      const report = await reportOrQueueIcloudHandoffEvent({
        eventType: "ignored-superseded-entry",
        entryBaseUrl: parsedEntry.baseUrl,
        currentBaseUrl: currentBaseFromHref(href) || parsedEntry.baseUrl,
        storedBaseUrl: entry.baseUrl,
        entryGeneratedAt: parsedEntry.generatedAt,
        storedGeneratedAt: entry.generatedAt,
        checksumSha256: parsedEntry.checksumSha256,
        ignoredAt: now,
      }, options.reportIcloudHandoffEvent, now);
      icloudEventReported = report.reported;
      pendingIcloudEventCount = report.pendingCount;
    } catch {
      icloudEventReported = false;
      pendingIcloudEventCount = getPendingMobileIcloudHandoffEventCount();
    }
    return {
      entry,
      result: null,
      reportSaved: false,
      icloudEventReported,
      pendingIcloudEventsFlushed: pendingBeforeLaunch.reported,
      pendingIcloudEventCount,
      ignoredOlderEntry: true,
    };
  }

  const statusAfterLaunch = getMobileIcloudHandoffStatus(entry, href, now);
  const icloudOpenEventType = statusAfterLaunch ? eventTypeForIcloudHandoffStatus(statusAfterLaunch) : null;
  let icloudEventReported = false;
  if (icloudOpenEventType) {
    try {
      const report = await reportIcloudHandoffIssueEvent(icloudOpenEventType, entry, href, now, options.reportIcloudHandoffEvent);
      icloudEventReported = report.reported;
    } catch {
      icloudEventReported = false;
    }
  }

  let result: MobileConnectivityLike;
  try {
    const testConnectivity = options.testConnectivity || (await import("./pwaCapabilities")).testMobileRemoteConnectivity;
    result = await testConnectivity({ currentHref: href, timeoutMs: options.timeoutMs });
  } catch (error) {
    result = createFailedConnectivityResult(entry, href, error, options.now || Date.now());
  }
  const testedAt = result.testedAt || options.now || Date.now();
  mergeMobileIcloudHandoffPatch({
    lastConnectivityTestedAt: testedAt,
    lastConnectivityOk: result.ok,
    lastConnectivityError: result.error || "",
  });

  let reportSaved = false;
  try {
    const reportConnectivity = options.reportConnectivity || (await import("./lifeosApi")).reportMobileConnectivity;
    await reportConnectivity(result);
    reportSaved = true;
  } catch {
    reportSaved = false;
  }

  return {
    entry: getStoredMobileIcloudHandoff() || entry,
    result,
    reportSaved,
    icloudEventReported,
    icloudEventType: icloudOpenEventType,
    pendingIcloudEventsFlushed: pendingBeforeLaunch.reported,
    pendingIcloudEventCount: getPendingMobileIcloudHandoffEventCount(),
  };
}

export function stripMobileIcloudHandoffParamsFromUrl() {
  if (typeof window === "undefined" || !window.history?.replaceState) return false;
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of handoffParamKeys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (!changed) return false;
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", next);
    return true;
  } catch {
    return false;
  }
}

export function getStoredMobileIcloudHandoff(): MobileIcloudHandoffEntry | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.source !== "icloud" || !isHttpBaseUrl(parsed.baseUrl)) return null;
    return {
      source: "icloud",
      generatedAt: Number(parsed.generatedAt || 0),
      refreshAfter: Number(parsed.refreshAfter || 0),
      expiresAt: Number(parsed.expiresAt || 0),
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      mode: String(parsed.mode || ""),
      stability: String(parsed.stability || ""),
      label: normalizeEntryText(parsed.label || "LifeOS iCloud Mobile Entry", 120),
      desktopId: normalizeEntryId(parsed.desktopId) || undefined,
      desktopName: normalizeEntryText(parsed.desktopName, 80) || undefined,
      desktopSlug: normalizeEntryId(parsed.desktopSlug) || undefined,
      checksumSha256: normalizeChecksum(parsed.checksumSha256),
      savedAt: Number(parsed.savedAt || 0),
      lastConnectivityTestedAt: Number(parsed.lastConnectivityTestedAt || 0) || undefined,
      lastConnectivityOk: typeof parsed.lastConnectivityOk === "boolean" ? parsed.lastConnectivityOk : undefined,
      lastConnectivityError: String(parsed.lastConnectivityError || ""),
      lastIgnoredAt: Number(parsed.lastIgnoredAt || 0) || undefined,
      lastIgnoredGeneratedAt: Number(parsed.lastIgnoredGeneratedAt || 0) || undefined,
      lastIgnoredBaseUrl: normalizeBaseUrl(parsed.lastIgnoredBaseUrl || ""),
    };
  } catch {
    return null;
  }
}

export function getMobileIcloudHandoffEntryFreshness(entry: MobileIcloudHandoffEntry, now = Date.now()): MobileIcloudHandoffEntryFreshness {
  if (entry.expiresAt && now >= entry.expiresAt) return "expired";
  if (!entry.checksumSha256) return "legacy";
  if (entry.refreshAfter && now >= entry.refreshAfter) return "stale";
  return "fresh";
}

function isRecommendedMobileIcloudHandoffEntry(entry: MobileIcloudHandoffEntry, now = Date.now()) {
  return getMobileIcloudHandoffEntryFreshness(entry, now) === "fresh" && entry.lastConnectivityOk !== false;
}

function isLongTermRemoteMobileIcloudHandoffEntry(entry: MobileIcloudHandoffEntry) {
  return !isMobileIcloudHandoffSameWifiOnly(entry);
}

function mobileIcloudEntryScore(entry: MobileIcloudHandoffEntry, now = Date.now()) {
  const freshness = getMobileIcloudHandoffEntryFreshness(entry, now);
  const freshnessScore = freshness === "fresh" ? 40 : freshness === "stale" ? 20 : freshness === "legacy" ? 10 : 0;
  const connectivityScore = entry.lastConnectivityOk === true ? 20 : entry.lastConnectivityOk === false ? -30 : 0;
  const stabilityScore = entry.stability === "stable" ? 12 : entry.stability === "temporary" ? 4 : 0;
  const reachabilityScore = isLongTermRemoteMobileIcloudHandoffEntry(entry) ? 20 : -20;
  const modeScore = entry.mode === "tailscale" || entry.mode === "configured" ? 8 : entry.mode === "cloudflare" ? 6 : entry.mode === "lan" ? 2 : 0;
  return freshnessScore + connectivityScore + stabilityScore + reachabilityScore + modeScore + Math.min(10, Math.max(0, Math.floor((entry.generatedAt || 0) / 1_000_000_000_000)));
}

export function getMobileIcloudHandoffEntryRecommendation(
  entries = getStoredMobileIcloudHandoffEntries(),
  options: { now?: number; preferredKey?: string } = {},
): MobileIcloudHandoffEntryRecommendation {
  const now = options.now || Date.now();
  const preferredKey = options.preferredKey ?? getPreferredMobileIcloudHandoffEntryKey();
  const uniqueEntries = entries.filter((entry, index, all) => (
    all.findIndex((candidate) => mobileIcloudHandoffEntryKey(candidate) === mobileIcloudHandoffEntryKey(entry)) === index
  ));
  const preferredEntry = preferredKey ? uniqueEntries.find((entry) => mobileIcloudHandoffEntryKey(entry) === preferredKey) || null : null;
  const sortedEntries = [...uniqueEntries]
    .sort((left, right) => {
      const scoreDelta = mobileIcloudEntryScore(right, now) - mobileIcloudEntryScore(left, now);
      return scoreDelta || (right.generatedAt || 0) - (left.generatedAt || 0);
    });
  const bestLongTermEntry = sortedEntries.find((entry) => isRecommendedMobileIcloudHandoffEntry(entry, now) && isLongTermRemoteMobileIcloudHandoffEntry(entry)) || null;
  const usablePreferred = preferredEntry && isRecommendedMobileIcloudHandoffEntry(preferredEntry, now) && (
    isLongTermRemoteMobileIcloudHandoffEntry(preferredEntry) || !bestLongTermEntry
  ) ? preferredEntry : null;
  const recommendedEntry = usablePreferred || sortedEntries.find((entry) => isRecommendedMobileIcloudHandoffEntry(entry, now)) || uniqueEntries[0] || null;
  const recommendedKey = recommendedEntry ? mobileIcloudHandoffEntryKey(recommendedEntry) : "";
  let preferredSwitchReason: MobileIcloudHandoffEntryRecommendation["preferredSwitchReason"] = "none";
  if (preferredEntry && recommendedKey && mobileIcloudHandoffEntryKey(preferredEntry) !== recommendedKey) {
    const freshness = getMobileIcloudHandoffEntryFreshness(preferredEntry, now);
    if (preferredEntry.lastConnectivityOk === false) preferredSwitchReason = "default-failed";
    else if (isMobileIcloudHandoffSameWifiOnly(preferredEntry) && recommendedEntry && isLongTermRemoteMobileIcloudHandoffEntry(recommendedEntry)) preferredSwitchReason = "default-same-wifi";
    else if (freshness === "expired") preferredSwitchReason = "default-expired";
    else if (freshness === "stale") preferredSwitchReason = "default-stale";
    else if (freshness === "legacy") preferredSwitchReason = "default-legacy";
  }
  return {
    recommendedEntry,
    recommendedKey,
    otherEntries: recommendedKey ? uniqueEntries.filter((entry) => mobileIcloudHandoffEntryKey(entry) !== recommendedKey) : uniqueEntries,
    preferredEntry,
    preferredNeedsSwitch: preferredSwitchReason !== "none",
    preferredSwitchReason,
  };
}

export function autoSelectRecommendedMobileIcloudHandoffEntry(
  entries = getStoredMobileIcloudHandoffEntries(),
  options: { now?: number; preferredKey?: string } = {},
): MobileIcloudHandoffAutoSwitchResult {
  const now = options.now || Date.now();
  const recommendation = getMobileIcloudHandoffEntryRecommendation(entries, { ...options, now });
  const previousEntry = recommendation.preferredEntry;
  const nextEntry = recommendation.recommendedEntry;
  if (
    !recommendation.preferredNeedsSwitch ||
    !previousEntry ||
    !nextEntry ||
    recommendation.recommendedKey === mobileIcloudHandoffEntryKey(previousEntry) ||
    !isRecommendedMobileIcloudHandoffEntry(nextEntry, now)
  ) {
    return {
      switched: false,
      recommendation,
      previousEntry,
      nextEntry,
    };
  }
  const switched = setPreferredMobileIcloudHandoffEntry(nextEntry);
  return {
    switched,
    recommendation,
    previousEntry,
    nextEntry: switched ? nextEntry : null,
  };
}

export function getMobileIcloudHandoffStatus(entry = getStoredMobileIcloudHandoff(), currentHref?: string, now = Date.now()): MobileIcloudHandoffStatus | null {
  if (!entry) return null;
  const currentBase = currentBaseFromHref(currentHref);
  const normalizedCurrentBase = normalizeBaseUrl(currentBase);
  const normalizedEntryBase = normalizeBaseUrl(entry.baseUrl);
  let status: MobileIcloudHandoffStatus["status"] = getMobileIcloudHandoffEntryFreshness(entry, now);
  if (normalizedCurrentBase && normalizedEntryBase && normalizedCurrentBase !== normalizedEntryBase) {
    status = "address-mismatch";
  }

  const keyByStatus: Record<MobileIcloudHandoffStatus["status"], { titleKey: string; bodyKey: string }> = {
    fresh: {
      titleKey: "mobileDevice.icloudHandoffFreshTitle",
      bodyKey: "mobileDevice.icloudHandoffFreshBody",
    },
    stale: {
      titleKey: "mobileDevice.icloudHandoffStaleTitle",
      bodyKey: "mobileDevice.icloudHandoffStaleBody",
    },
    expired: {
      titleKey: "mobileDevice.icloudHandoffExpiredTitle",
      bodyKey: "mobileDevice.icloudHandoffExpiredBody",
    },
    "address-mismatch": {
      titleKey: "mobileDevice.icloudHandoffMismatchTitle",
      bodyKey: "mobileDevice.icloudHandoffMismatchBody",
    },
    legacy: {
      titleKey: "mobileDevice.icloudHandoffLegacyTitle",
      bodyKey: "mobileDevice.icloudHandoffLegacyBody",
    },
  };

  return {
    entry,
    status,
    needsRefresh: status !== "fresh",
    currentBase,
    ...keyByStatus[status],
  };
}

export function getMobileIcloudHandoffActionKey(status: MobileIcloudHandoffStatus): MobileIcloudHandoffActionKey {
  if (status.status === "address-mismatch") return "mobileDevice.icloudHandoffActionMismatch";
  if (status.status === "expired") return "mobileDevice.icloudHandoffActionReopen";
  if (status.status === "legacy") return "mobileDevice.icloudHandoffActionRefresh";
  if (status.status === "stale") return "mobileDevice.icloudHandoffActionRefresh";
  if (status.entry.lastConnectivityTestedAt && status.entry.lastConnectivityOk === false) return "mobileDevice.icloudHandoffActionRetest";
  return "mobileDevice.icloudHandoffActionReady";
}

function isoTime(value?: number) {
  return value ? new Date(value).toISOString() : "-";
}

export function buildMobileIcloudHandoffRecoveryPacket(status: MobileIcloudHandoffStatus) {
  const actionKey = getMobileIcloudHandoffActionKey(status);
  return [
    "LifeOS iCloud Mobile Entry Recovery",
    `status=${status.status}`,
    `action=${actionKey}`,
    `entryBaseUrl=${normalizeBaseUrl(status.entry.baseUrl)}`,
    `currentBaseUrl=${normalizeBaseUrl(status.currentBase) || "-"}`,
    `mode=${status.entry.mode || "-"}`,
    `stability=${status.entry.stability || "-"}`,
    `label=${status.entry.label || "-"}`,
    `desktopId=${status.entry.desktopId || "-"}`,
    `desktopName=${status.entry.desktopName || "-"}`,
    `desktopSlug=${status.entry.desktopSlug || "-"}`,
    `entryChecksumSha256=${status.entry.checksumSha256 || "-"}`,
    `generatedAt=${isoTime(status.entry.generatedAt)}`,
    `refreshAfter=${isoTime(status.entry.refreshAfter)}`,
    `expiresAt=${isoTime(status.entry.expiresAt)}`,
    `lastConnectivityTestedAt=${isoTime(status.entry.lastConnectivityTestedAt)}`,
    `lastConnectivityOk=${typeof status.entry.lastConnectivityOk === "boolean" ? String(status.entry.lastConnectivityOk) : "-"}`,
    `lastConnectivityError=${status.entry.lastConnectivityError || "-"}`,
  ].join("\n");
}
