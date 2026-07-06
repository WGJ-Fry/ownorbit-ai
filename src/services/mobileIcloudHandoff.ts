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
  savedAt: number;
};

export type MobileIcloudHandoffStatus = {
  entry: MobileIcloudHandoffEntry;
  status: "fresh" | "stale" | "expired" | "address-mismatch";
  needsRefresh: boolean;
  currentBase: string;
  titleKey: string;
  bodyKey: string;
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

export function consumeMobileIcloudHandoffFromUrl(href?: string, now = Date.now()) {
  const entry = parseMobileIcloudHandoffFromUrl(href, now);
  if (entry) saveMobileIcloudHandoff(entry);
  return entry;
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
      savedAt: Number(parsed.savedAt || 0),
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
  };

  return {
    entry,
    status,
    needsRefresh: status !== "fresh",
    currentBase,
    ...keyByStatus[status],
  };
}
