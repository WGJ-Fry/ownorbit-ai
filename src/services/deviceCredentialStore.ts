export type StoredDeviceCredential = {
  device: {
    id: string;
    name: string;
    type: "mobile" | "desktop" | "browser";
    status: "online" | "offline" | "revoked";
    publicKey?: string;
    createdAt: number;
    lastSeenAt: number;
    revokedAt?: number;
  };
  authMethod?: "signature" | "token";
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

export type DeviceCredentialExpiryStatus = {
  state: "long_lived_signature" | "valid" | "expiring_soon" | "expired" | "unknown";
  tone: "ok" | "warn" | "risk";
  expiresAt: number | null;
  msUntilExpiry: number | null;
  rotationRecommended: boolean;
  rebindRecommended: boolean;
};

const DB_NAME = "lifeos-device-keys";
const STORE_NAME = "credentials";
const CREDENTIAL_ID = "primary";
const LEGACY_LOCAL_STORAGE_KEY = "lifeos_device_credential";
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

let credentialCache: StoredDeviceCredential | null | undefined;
let hydrationPromise: Promise<StoredDeviceCredential | null> | null = null;

function browserStorageAvailable() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function readLegacyCredential() {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
  if (!raw) return null;
  try {
    const credential = normalizeCredential(JSON.parse(raw));
    if (!credential) localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    return credential;
  } catch {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    return null;
  }
}

function legacyCredentialPresent() {
  if (typeof localStorage === "undefined") return false;
  return Boolean(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY));
}

function normalizeCredential(value: unknown): StoredDeviceCredential | null {
  const credential = value as StoredDeviceCredential | null;
  if (!credential?.device?.id) return null;
  if (credential.accessTokenExpiresAt && credential.accessTokenExpiresAt <= Date.now()) return null;
  return credential;
}

export function getDeviceCredentialExpiryStatus(
  credential: StoredDeviceCredential | null | undefined,
  now = Date.now(),
): DeviceCredentialExpiryStatus {
  if (!credential) {
    return {
      state: "unknown",
      tone: "warn",
      expiresAt: null,
      msUntilExpiry: null,
      rotationRecommended: false,
      rebindRecommended: true,
    };
  }

  if (credential.authMethod === "signature" && !credential.accessToken) {
    return {
      state: "long_lived_signature",
      tone: "ok",
      expiresAt: credential.accessTokenExpiresAt || null,
      msUntilExpiry: credential.accessTokenExpiresAt ? credential.accessTokenExpiresAt - now : null,
      rotationRecommended: false,
      rebindRecommended: false,
    };
  }

  const expiresAt = credential.accessTokenExpiresAt || null;
  if (!expiresAt) {
    return {
      state: "unknown",
      tone: "warn",
      expiresAt: null,
      msUntilExpiry: null,
      rotationRecommended: true,
      rebindRecommended: credential.authMethod !== "signature",
    };
  }

  const msUntilExpiry = expiresAt - now;
  if (msUntilExpiry <= 0) {
    return {
      state: "expired",
      tone: "risk",
      expiresAt,
      msUntilExpiry,
      rotationRecommended: false,
      rebindRecommended: true,
    };
  }

  if (msUntilExpiry <= EXPIRING_SOON_MS) {
    return {
      state: "expiring_soon",
      tone: "warn",
      expiresAt,
      msUntilExpiry,
      rotationRecommended: true,
      rebindRecommended: credential.authMethod !== "signature",
    };
  }

  return {
    state: "valid",
    tone: "ok",
    expiresAt,
    msUntilExpiry,
    rotationRecommended: false,
    rebindRecommended: false,
  };
}

function openCredentialDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains("keys")) {
        request.result.createObjectStore("keys");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedCredential() {
  if (!browserStorageAvailable()) return null;
  const db = await openCredentialDb();
  const credential = await new Promise<StoredDeviceCredential | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(CREDENTIAL_ID);
    request.onsuccess = () => resolve(normalizeCredential(request.result));
    request.onerror = () => reject(request.error);
  });
  db.close();
  return credential;
}

async function writeIndexedCredential(credential: StoredDeviceCredential | null) {
  if (!browserStorageAvailable()) return;
  const db = await openCredentialDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (credential) store.put(credential, CREDENTIAL_ID);
    else store.delete(CREDENTIAL_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export function getCachedDeviceCredential() {
  if (credentialCache !== undefined) return credentialCache;
  const legacy = readLegacyCredential();
  if (legacy) {
    credentialCache = legacy;
    void saveDeviceCredential(legacy).catch(() => null);
  } else {
    void hydrateDeviceCredential().catch(() => null);
  }
  return legacy;
}

export async function hydrateDeviceCredential() {
  if (credentialCache !== undefined) return credentialCache;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const indexed = await readIndexedCredential().catch(() => null);
    if (indexed) {
      credentialCache = indexed;
      if (typeof localStorage !== "undefined") localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
      return indexed;
    }

    const legacy = readLegacyCredential();
    credentialCache = legacy;
    if (legacy) await saveDeviceCredential(legacy).catch(() => null);
    return legacy;
  })();
  return hydrationPromise;
}

export async function getDeviceCredentialStorageStatus() {
  const cached = await hydrateDeviceCredential().catch(() => credentialCache ?? null);
  return {
    indexedDbAvailable: browserStorageAvailable(),
    legacyLocalStoragePresent: legacyCredentialPresent(),
    credentialPresent: Boolean(cached),
    storage: cached ? (browserStorageAvailable() ? "indexeddb" as const : "memory" as const) : "none" as const,
    authMethod: cached?.authMethod || null,
    expiresAt: cached?.accessTokenExpiresAt || null,
  };
}

export async function saveDeviceCredential(credential: StoredDeviceCredential) {
  credentialCache = credential;
  await writeIndexedCredential(credential);
  if (typeof localStorage !== "undefined") localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
}

export async function clearDeviceCredential() {
  credentialCache = null;
  await writeIndexedCredential(null).catch(() => null);
  if (typeof localStorage !== "undefined") localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
}
