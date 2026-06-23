// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

function createMemoryStorage() {
  const storage = new Map();
  return {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };
}

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

async function waitFor(condition, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

function installBrowserStorage() {
  const localStorage = createMemoryStorage();
  globalThis.window = {};
  globalThis.localStorage = localStorage;
  globalThis.indexedDB = createFakeIndexedDb();
  globalThis.btoa ||= (value) => Buffer.from(value, "binary").toString("base64");
  return localStorage;
}

function legacyCredential(overrides = {}) {
  return {
    device: {
      id: "device-legacy-1",
      name: "Legacy Phone",
      type: "mobile",
      status: "offline",
      createdAt: 1,
      lastSeenAt: 2,
    },
    authMethod: "token",
    accessToken: "device_secret_should_move",
    accessTokenExpiresAt: Date.now() + 86_400_000,
    ...overrides,
  };
}

test("device credential store migrates legacy localStorage credential into IndexedDB", async () => {
  const localStorage = installBrowserStorage();
  const credential = legacyCredential();
  localStorage.setItem("lifeos_device_credential", JSON.stringify(credential));

  const store = await import(`../src/services/deviceCredentialStore.ts?case=migrate-${Date.now()}`);
  const cached = store.getCachedDeviceCredential();
  assert.equal(cached.device.id, credential.device.id);
  await waitFor(() => localStorage.getItem("lifeos_device_credential") === null, "legacy credential was not removed from localStorage");

  const hydrated = await store.hydrateDeviceCredential();
  assert.equal(hydrated.device.id, credential.device.id);
  assert.equal(hydrated.accessToken, credential.accessToken);
  const status = await store.getDeviceCredentialStorageStatus();
  assert.equal(status.indexedDbAvailable, true);
  assert.equal(status.legacyLocalStoragePresent, false);
  assert.equal(status.credentialPresent, true);
  assert.equal(status.storage, "indexeddb");
  assert.equal(status.authMethod, "token");
});

test("device credential store removes expired legacy localStorage credential", async () => {
  const localStorage = installBrowserStorage();
  const credential = legacyCredential({ accessTokenExpiresAt: Date.now() - 1000 });
  localStorage.setItem("lifeos_device_credential", JSON.stringify(credential));

  const store = await import(`../src/services/deviceCredentialStore.ts?case=expired-${Date.now()}`);
  assert.equal(store.getCachedDeviceCredential(), null);
  assert.equal(localStorage.getItem("lifeos_device_credential"), null);
  assert.equal(await store.hydrateDeviceCredential(), null);
  const status = await store.getDeviceCredentialStorageStatus();
  assert.equal(status.credentialPresent, false);
  assert.equal(status.storage, "none");
});

test("device credential store clears IndexedDB and legacy localStorage copies", async () => {
  const localStorage = installBrowserStorage();
  const credential = legacyCredential({ device: { ...legacyCredential().device, id: "device-clear-1" } });
  localStorage.setItem("lifeos_device_credential", JSON.stringify(credential));

  const store = await import(`../src/services/deviceCredentialStore.ts?case=clear-${Date.now()}`);
  await store.hydrateDeviceCredential();
  await store.clearDeviceCredential();

  assert.equal(localStorage.getItem("lifeos_device_credential"), null);
  assert.equal(await store.hydrateDeviceCredential(), null);
  assert.equal((await store.getDeviceCredentialStorageStatus()).storage, "none");
});

test("device credential store never writes new credentials back to localStorage when IndexedDB is unavailable", async () => {
  const localStorage = createMemoryStorage();
  globalThis.window = {};
  globalThis.localStorage = localStorage;
  delete globalThis.indexedDB;
  const store = await import(`../src/services/deviceCredentialStore.ts?case=no-indexeddb-${Date.now()}`);
  const credential = legacyCredential({ device: { ...legacyCredential().device, id: "device-memory-only" } });

  await store.saveDeviceCredential(credential);
  assert.equal(localStorage.getItem("lifeos_device_credential"), null);
  assert.equal(store.getCachedDeviceCredential().device.id, "device-memory-only");
  const status = await store.getDeviceCredentialStorageStatus();
  assert.equal(status.indexedDbAvailable, false);
  assert.equal(status.storage, "memory");
  assert.equal(status.legacyLocalStoragePresent, false);
});

test("device credential expiry status guides refresh and rebind decisions", async () => {
  const now = 1_800_000_000_000;
  globalThis.window = {};
  delete globalThis.indexedDB;
  const store = await import(`../src/services/deviceCredentialStore.ts?case=expiry-status-${Date.now()}`);
  const baseCredential = legacyCredential({
    device: { ...legacyCredential().device, id: "device-expiry-1" },
    accessTokenExpiresAt: now + 30 * 24 * 60 * 60 * 1000,
  });

  assert.deepEqual(store.getDeviceCredentialExpiryStatus({
    ...baseCredential,
    authMethod: "signature",
    accessToken: undefined,
    accessTokenExpiresAt: undefined,
  }, now), {
    state: "long_lived_signature",
    tone: "ok",
    expiresAt: null,
    msUntilExpiry: null,
    rotationRecommended: false,
    rebindRecommended: false,
  });

  assert.equal(store.getDeviceCredentialExpiryStatus(baseCredential, now).state, "valid");
  assert.equal(store.getDeviceCredentialExpiryStatus({
    ...baseCredential,
    accessTokenExpiresAt: now + 2 * 24 * 60 * 60 * 1000,
  }, now).state, "expiring_soon");
  assert.equal(store.getDeviceCredentialExpiryStatus({
    ...baseCredential,
    accessTokenExpiresAt: now - 1,
  }, now).rebindRecommended, true);
  assert.equal(store.getDeviceCredentialExpiryStatus({
    ...baseCredential,
    accessTokenExpiresAt: undefined,
  }, now).rotationRecommended, true);
});

test("clearing a mobile binding removes the WebCrypto private key from IndexedDB", async () => {
  const localStorage = installBrowserStorage();
  const suffix = Date.now();
  const keyStore = await import(`../src/services/deviceKeyStore.ts?case=key-clear-${suffix}`);
  const api = await import(`../src/services/lifeosApi.ts?case=key-clear-${suffix}`);

  const keyPair = await keyStore.createDeviceKeyPair();
  assert.match(keyPair.publicKey, /^[A-Za-z0-9_-]+$/);
  const privateKey = await keyStore.getDevicePrivateKey();
  assert.ok(privateKey);
  assert.equal(privateKey.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey("pkcs8", privateKey));

  await api.saveStoredDeviceCredential({
    device: {
      id: "device-signature-1",
      name: "Signature Phone",
      type: "mobile",
      status: "online",
      publicKey: keyPair.publicKey,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    },
    authMethod: "signature",
    accessTokenExpiresAt: Date.now() + 86_400_000,
  });
  assert.equal(localStorage.getItem("lifeos_device_credential"), null);
  assert.ok(await keyStore.signDevicePayload("GET\n/api/v1/state/lifeos_tasks_pro\n\n1\nnonce"));

  await api.clearStoredDeviceCredential();

  assert.equal(localStorage.getItem("lifeos_device_credential"), null);
  assert.equal(await api.getStoredDeviceCredentialAsync(), null);
  assert.equal(await keyStore.getDevicePrivateKey(), null);
  assert.equal(await keyStore.signDevicePayload("GET\n/api/v1/state/lifeos_tasks_pro\n\n1\nnonce"), null);
});

test("mobile binding falls back to token auth when WebCrypto signatures are unavailable", async () => {
  const localStorage = installBrowserStorage();
  globalThis.document = { cookie: "" };
  globalThis.window = { location: { origin: "http://192.168.150.75:3001" } };
  const originalCrypto = globalThis.crypto;
  const originalFetch = globalThis.fetch;
  let requestBody = null;

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () => "uuid-no-subtle",
    },
  });
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => legacyCredential({
        device: {
          id: "device-token-fallback",
          name: "LAN iPhone",
          type: "mobile",
          status: "online",
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
        },
        authMethod: "token",
        accessToken: "device_token_from_server",
      }),
    };
  };

  try {
    const api = await import(`../src/services/lifeosApi.ts?case=token-fallback-${Date.now()}`);
    const credential = await api.confirmBinding("bind_lan", "LAN iPhone");
    assert.equal(requestBody.token, "bind_lan");
    assert.equal(requestBody.deviceName, "LAN iPhone");
    assert.equal(requestBody.publicKey, undefined);
    assert.equal(credential.authMethod, "token");
    assert.equal(credential.accessToken, "device_token_from_server");
    await api.saveStoredDeviceCredential(credential);
    assert.equal(localStorage.getItem("lifeos_device_credential"), null);
  } finally {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
    globalThis.fetch = originalFetch;
  }
});
