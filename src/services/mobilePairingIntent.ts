import { apiUrl, getLifeOSBasePath } from "./lifeosApi";

const PAIRING_INTENT_KEY = "lifeos_pending_pairing_intent";
const PAIRING_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const INSTALL_PATH_PREFIX = "/mobile/install/";
const DB_NAME = "lifeos-pairing-intent";
const STORE_NAME = "intents";
const PAIRING_INTENT_RECORD_ID = "pending";
// Input with a scheme ("https:", "javascript:") or a protocol-relative host
// names its own origin; anything else is a bare token or a path on this origin.
// In http(s) URLs the parser reads "\" as "/", so any two of them ("//",
// "\\", "/\", "\/") start a host, not a path.
const SCHEME_INPUT = /^[a-z][a-z0-9+.-]*:/i;
const PROTOCOL_RELATIVE_INPUT = /^[\\/]{2}/;

function isOriginBearingInput(value: string) {
  return SCHEME_INPUT.test(value) || PROTOCOL_RELATIVE_INPUT.test(value);
}

type PairingIntent = {
  token: string;
  createdAt: number;
  expiresAt: number;
};

export type PairingInputDestination = {
  token: string;
  // An absolute URL when crossOrigin, otherwise a path on the current origin.
  href: string;
  crossOrigin: boolean;
};

let intentCache: PairingIntent | null | undefined;
let hydratePromise: Promise<string> | null = null;

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeToken(token: unknown) {
  if (typeof token !== "string") return "";
  const normalized = token.trim();
  if (!/^bind_[A-Za-z0-9_-]{8,180}$/.test(normalized)) return "";
  return normalized;
}

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

function normalizeIntent(value: unknown, now = Date.now()): PairingIntent | null {
  const intent = value as Partial<PairingIntent> | null;
  const token = normalizeToken(intent?.token);
  if (!token || typeof intent?.expiresAt !== "number" || intent.expiresAt <= now) return null;
  return {
    token,
    createdAt: typeof intent.createdAt === "number" ? intent.createdAt : Math.max(0, intent.expiresAt - PAIRING_INTENT_TTL_MS),
    expiresAt: intent.expiresAt,
  };
}

function readLegacyPairingIntent(now = Date.now()) {
  if (!localStorageAvailable()) return null;
  const raw = localStorage.getItem(PAIRING_INTENT_KEY);
  if (!raw) return null;
  try {
    const intent = normalizeIntent(JSON.parse(raw), now);
    if (!intent) localStorage.removeItem(PAIRING_INTENT_KEY);
    return intent;
  } catch {
    localStorage.removeItem(PAIRING_INTENT_KEY);
    return null;
  }
}

function openPairingIntentDb(): Promise<IDBDatabase> {
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

async function readIndexedPairingIntent(now = Date.now()) {
  if (!indexedDbAvailable()) return null;
  const db = await openPairingIntentDb();
  const intent = await new Promise<PairingIntent | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(PAIRING_INTENT_RECORD_ID);
    request.onsuccess = () => resolve(normalizeIntent(request.result, now));
    request.onerror = () => reject(request.error);
  });
  db.close();
  return intent;
}

async function writeIndexedPairingIntent(intent: PairingIntent | null) {
  if (!indexedDbAvailable()) return false;
  const db = await openPairingIntentDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (intent) store.put(intent, PAIRING_INTENT_RECORD_ID);
    else store.delete(PAIRING_INTENT_RECORD_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return true;
}

async function hydratePendingPairingIntent(now = Date.now()) {
  const indexed = await readIndexedPairingIntent(now).catch(() => null);
  if (indexed) {
    intentCache = indexed;
    if (localStorageAvailable()) localStorage.removeItem(PAIRING_INTENT_KEY);
    return indexed.token;
  }

  const legacy = readLegacyPairingIntent(now);
  intentCache = legacy;
  if (!legacy) return "";

  const written = await writeIndexedPairingIntent(legacy).catch(() => false);
  if (written && localStorageAvailable()) localStorage.removeItem(PAIRING_INTENT_KEY);
  return legacy.token;
}

// The URL parser silently drops tabs/newlines anywhere and control characters
// at the ends (so "java\tscript:" is "javascript:"). Do the same first, so the
// scheme test sees the text new URL() will.
function cleanPairingInput(raw: unknown) {
  return typeof raw === "string" ? raw.replace(/[\t\n\r]/g, "").replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, "") : "";
}

function originOf(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

// A pairing link may carry a base path (PUBLIC_BASE_URL with a path) in front
// of /mobile/install. Only a full link can: a scheme-less
// "host/mobile/install/…" stays unreadable instead of being taken for a path
// on the current origin.
function parsePairingUrl(value: string, base: string | undefined, allowBasePath: boolean) {
  try {
    const parsed = new URL(value, base);
    const rawBasePath = allowBasePath && isOriginBearingInput(value) ? getLifeOSBasePath(parsed.pathname) : "";
    const routePath = parsed.pathname.slice(rawBasePath.length);
    const pathToken = routePath.startsWith(INSTALL_PATH_PREFIX)
      ? safeDecodeURIComponent(routePath.slice(INSTALL_PATH_PREFIX.length))
      : "";
    const token = normalizeToken(pathToken) || normalizeToken(parsed.searchParams.get("token")) || normalizeToken(parsed.searchParams.get("pairingToken"));
    // "//evil.example" as a base path would turn a same-origin path into a
    // protocol-relative URL pointing somewhere else.
    return { parsed, basePath: rawBasePath.replace(/\/{2,}/g, "/"), token };
  } catch {
    return null;
  }
}

export function extractPairingToken(raw: string) {
  const directToken = normalizeToken(raw);
  if (directToken) return directToken;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  const fallbackOrigin = typeof window === "undefined" ? "http://lifeos.local" : window.location.origin;
  const result = parsePairingUrl(value, fallbackOrigin, false);
  if (result) return result.token;
  if (value.startsWith(INSTALL_PATH_PREFIX)) {
    return normalizeToken(safeDecodeURIComponent(value.slice(INSTALL_PATH_PREFIX.length)));
  }
  return "";
}

export function pairingInstallPath(token: string) {
  const normalized = extractPairingToken(token);
  if (!normalized.startsWith("bind_")) return "/mobile/chat";
  return `${INSTALL_PATH_PREFIX}${encodeURIComponent(normalized)}`;
}

// Where a pasted pairing link should take the phone. A restarted quick tunnel
// hands out a new trycloudflare host, so the link can name a different origin
// than the (possibly dead) page it is pasted into. Credentials are
// origin-scoped, so pairing has to happen ON that origin: send the phone there
// rather than replay the token here. Only http(s) links are followed, and the
// destination is rebuilt from origin + base path + token, so nothing else in
// the pasted text (credentials, query, fragment) is carried over.
export function resolvePairingInputDestination(raw: unknown, currentOrigin: string): PairingInputDestination | null {
  const value = cleanPairingInput(raw);
  if (!value) return null;
  if (!isOriginBearingInput(value)) {
    const token = extractPairingToken(value);
    return token ? { token, href: pairingInstallPath(token), crossOrigin: false } : null;
  }
  const current = originOf(currentOrigin);
  // A link with a scheme is read on its own. Resolved against this page, a
  // mistyped "https:/host/…" or "https:host/…" would keep this page's host
  // and turn the intended one into a path (the parser only reads a host when
  // the scheme differs from the base's). Only "//host" needs this page's scheme.
  const base = SCHEME_INPUT.test(value) ? undefined : current || undefined;
  const result = parsePairingUrl(value, base, true);
  if (!result?.token) return null;
  if (result.parsed.protocol !== "http:" && result.parsed.protocol !== "https:") return null;
  const installPath = `${result.basePath}${pairingInstallPath(result.token)}`;
  if (current && result.parsed.origin === current) {
    // The pair page only reads a token from a root /mobile/install/ path, so
    // a same-origin link under a base path would clear the credential here
    // and then fail to pair. Keep rejecting it, as before links were followed.
    if (result.basePath) return null;
    return { token: result.token, href: installPath, crossOrigin: false };
  }
  return { token: result.token, href: `${result.parsed.origin}${installPath}`, crossOrigin: true };
}

// Resolves once the intent is stored (IndexedDB, or the localStorage
// fallback); callers that are about to navigate away can await it.
export function savePendingPairingToken(token: string, now = Date.now()): Promise<void> {
  const normalized = extractPairingToken(token);
  if (!normalized.startsWith("bind_")) return Promise.resolve();
  const intent: PairingIntent = {
    token: normalized,
    createdAt: now,
    expiresAt: now + PAIRING_INTENT_TTL_MS,
  };
  intentCache = intent;
  return writeIndexedPairingIntent(intent)
    .then((written) => {
      if (written && localStorageAvailable()) localStorage.removeItem(PAIRING_INTENT_KEY);
      else if (!written && localStorageAvailable()) localStorage.setItem(PAIRING_INTENT_KEY, JSON.stringify(intent));
    })
    .catch(() => {
      if (localStorageAvailable()) localStorage.setItem(PAIRING_INTENT_KEY, JSON.stringify(intent));
    })
    // The in-memory intent above still covers this page; never fail a caller.
    .catch(() => undefined);
}

export function peekPendingPairingToken(now = Date.now()) {
  const cached = normalizeIntent(intentCache, now);
  if (cached) return cached.token;

  const legacy = readLegacyPairingIntent(now);
  if (legacy) {
    intentCache = legacy;
    void writeIndexedPairingIntent(legacy)
      .then((written) => {
        if (written && localStorageAvailable()) localStorage.removeItem(PAIRING_INTENT_KEY);
      })
      .catch(() => null);
    return legacy.token;
  }

  intentCache = null;
  void peekPendingPairingTokenAsync(now).catch(() => "");
  return "";
}

export async function peekPendingPairingTokenAsync(now = Date.now()) {
  const cached = normalizeIntent(intentCache, now);
  if (cached) return cached.token;
  if (!hydratePromise) {
    hydratePromise = hydratePendingPairingIntent(now).finally(() => {
      hydratePromise = null;
    });
  }
  return hydratePromise;
}

export function consumePendingPairingToken(now = Date.now()) {
  const token = peekPendingPairingToken(now);
  if (token) {
    clearPendingPairingToken();
    return token;
  }
  return "";
}

export async function consumePendingPairingTokenAsync(now = Date.now()) {
  const token = await peekPendingPairingTokenAsync(now);
  if (token) {
    clearPendingPairingToken();
    return token;
  }
  return "";
}

export function clearPendingPairingToken() {
  intentCache = null;
  void writeIndexedPairingIntent(null).catch(() => null);
  if (localStorageAvailable()) localStorage.removeItem(PAIRING_INTENT_KEY);
}

export function getPendingPairingIntentStorageStatus() {
  return {
    indexedDbAvailable: indexedDbAvailable(),
    legacyLocalStoragePresent: localStorageAvailable() ? Boolean(localStorage.getItem(PAIRING_INTENT_KEY)) : false,
    cached: Boolean(normalizeIntent(intentCache)),
  };
}

export function clearPendingPairingIntentCacheForTests() {
  intentCache = undefined;
  hydratePromise = null;
}

export function setPairingManifestToken(token: string) {
  const normalized = extractPairingToken(token);
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) return () => {};
  const previousHref = manifest.getAttribute("href") || apiUrl("/manifest.webmanifest");
  if (normalized) {
    manifest.setAttribute("href", `${apiUrl("/manifest.webmanifest")}?pairingToken=${encodeURIComponent(normalized)}`);
  }
  return () => {
    manifest.setAttribute("href", previousHref);
  };
}
