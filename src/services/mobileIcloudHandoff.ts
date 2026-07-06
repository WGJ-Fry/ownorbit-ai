import type { MobileIcloudHandoffEventReportInput } from "./lifeosApi";

const STORAGE_KEY = "lifeos_mobile_icloud_handoff";

const handoffParamKeys = [
  "lifeosEntry",
  "entryGeneratedAt",
  "entryRefreshAfter",
  "entryExpiresAt",
  "entryBaseUrl",
  "entryMode",
  "entryStability",
  "entryLabel",
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

export type MobileIcloudHandoffActionKey =
  | "mobileDevice.icloudHandoffActionReady"
  | "mobileDevice.icloudHandoffActionRetest"
  | "mobileDevice.icloudHandoffActionRefresh"
  | "mobileDevice.icloudHandoffActionReopen"
  | "mobileDevice.icloudHandoffActionMismatch";

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

function normalizeChecksum(value?: string | null) {
  const checksum = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(checksum) ? checksum : "";
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
      label: String(params.get("entryLabel") || "LifeOS iCloud Mobile Entry"),
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
    return true;
  } catch {
    return false;
  }
}

export function isMobileIcloudHandoffSuperseded(entry: MobileIcloudHandoffEntry, current = getStoredMobileIcloudHandoff()) {
  if (!current) return false;
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
  const parsedEntry = parseMobileIcloudHandoffFromUrl(href, now);
  if (!parsedEntry) return null;
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
    try {
      const reportIcloudHandoffEvent = options.reportIcloudHandoffEvent || (await import("./lifeosApi")).reportMobileIcloudHandoffEvent;
      await reportIcloudHandoffEvent({
        eventType: "ignored-superseded-entry",
        entryBaseUrl: parsedEntry.baseUrl,
        currentBaseUrl: currentBaseFromHref(href) || parsedEntry.baseUrl,
        storedBaseUrl: entry.baseUrl,
        entryGeneratedAt: parsedEntry.generatedAt,
        storedGeneratedAt: entry.generatedAt,
        checksumSha256: parsedEntry.checksumSha256,
        ignoredAt: now,
      });
      icloudEventReported = true;
    } catch {
      icloudEventReported = false;
    }
    return {
      entry,
      result: null,
      reportSaved: false,
      icloudEventReported,
      ignoredOlderEntry: true,
    };
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
      label: String(parsed.label || "LifeOS iCloud Mobile Entry"),
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

export function getMobileIcloudHandoffStatus(entry = getStoredMobileIcloudHandoff(), currentHref?: string, now = Date.now()): MobileIcloudHandoffStatus | null {
  if (!entry) return null;
  const currentBase = currentBaseFromHref(currentHref);
  const normalizedCurrentBase = normalizeBaseUrl(currentBase);
  const normalizedEntryBase = normalizeBaseUrl(entry.baseUrl);
  let status: MobileIcloudHandoffStatus["status"] = "fresh";
  if (normalizedCurrentBase && normalizedEntryBase && normalizedCurrentBase !== normalizedEntryBase) {
    status = "address-mismatch";
  } else if (entry.expiresAt && now >= entry.expiresAt) {
    status = "expired";
  } else if (!entry.checksumSha256) {
    status = "legacy";
  } else if (entry.refreshAfter && now >= entry.refreshAfter) {
    status = "stale";
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
    `entryChecksumSha256=${status.entry.checksumSha256 || "-"}`,
    `generatedAt=${isoTime(status.entry.generatedAt)}`,
    `refreshAfter=${isoTime(status.entry.refreshAfter)}`,
    `expiresAt=${isoTime(status.entry.expiresAt)}`,
    `lastConnectivityTestedAt=${isoTime(status.entry.lastConnectivityTestedAt)}`,
    `lastConnectivityOk=${typeof status.entry.lastConnectivityOk === "boolean" ? String(status.entry.lastConnectivityOk) : "-"}`,
    `lastConnectivityError=${status.entry.lastConnectivityError || "-"}`,
  ].join("\n");
}
