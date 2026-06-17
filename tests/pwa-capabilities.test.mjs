// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

function installBrowserGlobals({
  standalone = false,
  serviceWorker = true,
  controlled = true,
  backgroundSync = true,
  indexedDb = true,
  online = true,
  href = "https://lifeos.example.com/mobile/device",
} = {}) {
  const windowValue = {
    location: new URL(href),
    matchMedia(query) {
      return { matches: query === "(display-mode: standalone)" ? standalone : false };
    },
  };
  if (backgroundSync) windowValue.SyncManager = function SyncManager() {};
  if (indexedDb) windowValue.indexedDB = {};
  Object.defineProperty(globalThis, "window", { value: windowValue, configurable: true });

  const navigatorValue = {
    onLine: online,
    standalone,
  };
  if (serviceWorker) {
    navigatorValue.serviceWorker = {
      controller: controlled ? {} : null,
    };
  }
  Object.defineProperty(globalThis, "navigator", { value: navigatorValue, configurable: true });
}

function cleanupBrowserGlobals() {
  delete globalThis.window;
  delete globalThis.navigator;
}

test("PWA capability status reports a complete installed mobile entry", async (t) => {
  installBrowserGlobals();
  t.after(cleanupBrowserGlobals);
  const { getPwaCapabilityStatus } = await import(`../src/services/pwaCapabilities.ts?case=complete-${Date.now()}`);

  const status = getPwaCapabilityStatus();
  assert.equal(status.standalone, false);
  assert.equal(status.serviceWorkerSupported, true);
  assert.equal(status.serviceWorkerControlled, true);
  assert.equal(status.backgroundSyncSupported, true);
  assert.equal(status.indexedDbSupported, true);
  assert.equal(status.online, true);
  assert.deepEqual(status.recommendations, ["After pairing, add LifeOS to the home screen so it opens like a regular app."]);
});

test("PWA capability status explains degraded offline sync support", async (t) => {
  installBrowserGlobals({
    standalone: true,
    serviceWorker: true,
    controlled: false,
    backgroundSync: false,
    indexedDb: false,
    online: false,
  });
  t.after(cleanupBrowserGlobals);
  const { getPwaCapabilityStatus } = await import(`../src/services/pwaCapabilities.ts?case=degraded-${Date.now()}`);

  const status = getPwaCapabilityStatus();
  assert.equal(status.standalone, true);
  assert.equal(status.serviceWorkerSupported, true);
  assert.equal(status.serviceWorkerControlled, false);
  assert.equal(status.backgroundSyncSupported, false);
  assert.equal(status.indexedDbSupported, false);
  assert.equal(status.online, false);
  assert.equal(status.recommendations.some((item) => item.includes("offline shell is taking control")), true);
  assert.equal(status.recommendations.some((item) => item.includes("background sync is unavailable")), true);
  assert.equal(status.recommendations.some((item) => item.includes("IndexedDB is unavailable")), true);
  assert.equal(status.recommendations.some((item) => item.includes("You are offline")), true);
});

test("PWA capability status handles browsers without service worker", async (t) => {
  installBrowserGlobals({ serviceWorker: false, backgroundSync: false });
  t.after(cleanupBrowserGlobals);
  const { getPwaCapabilityStatus } = await import(`../src/services/pwaCapabilities.ts?case=no-sw-${Date.now()}`);

  const status = getPwaCapabilityStatus();
  assert.equal(status.serviceWorkerSupported, false);
  assert.equal(status.serviceWorkerControlled, false);
  assert.equal(status.backgroundSyncSupported, false);
  assert.equal(status.recommendations.some((item) => item.includes("does not support the offline shell")), true);
});

test("remote entry status rejects localhost and same-LAN entries for remote use", async () => {
  const { getRemoteEntryStatus } = await import(`../src/services/pwaCapabilities.ts?case=remote-local-${Date.now()}`);

  const local = getRemoteEntryStatus({ currentHref: "http://127.0.0.1:3000/mobile/device" });
  assert.equal(local.kind, "localhost");
  assert.equal(local.okForRemote, false);
  assert.equal(local.currentBase, "http://127.0.0.1:3000");

  const lan = getRemoteEntryStatus({ currentHref: "http://192.168.1.8:3000/mobile/chat" });
  assert.equal(lan.kind, "same-lan");
  assert.equal(lan.okForRemote, false);
});

test("remote entry status accepts stable HTTPS, Tailscale, and temporary Cloudflare entries", async () => {
  const { getRemoteEntryStatus } = await import(`../src/services/pwaCapabilities.ts?case=remote-stable-${Date.now()}`);

  const https = getRemoteEntryStatus({ currentHref: "https://lifeos.example.com/lifeos/mobile/device" });
  assert.equal(https.kind, "stable-https");
  assert.equal(https.okForRemote, true);
  assert.equal(https.currentBase, "https://lifeos.example.com/lifeos");

  const tailscale = getRemoteEntryStatus({ currentHref: "https://mac-mini.tailnet.ts.net/lifeos/mobile/chat" });
  assert.equal(tailscale.kind, "tailscale");
  assert.equal(tailscale.okForRemote, true);

  const quickTunnel = getRemoteEntryStatus({ currentHref: "https://abc.trycloudflare.com/mobile/device" });
  assert.equal(quickTunnel.kind, "temporary-cloudflare");
  assert.equal(quickTunnel.okForRemote, true);
});

test("remote entry status treats Tailscale HTTP as a fallback that needs HTTPS Serve", async () => {
  const { getRemoteEntryStatus } = await import(`../src/services/pwaCapabilities.ts?case=remote-tailscale-http-${Date.now()}`);

  const tailnetIp = getRemoteEntryStatus({ currentHref: "http://100.64.0.10:3000/mobile/device" });
  assert.equal(tailnetIp.kind, "tailscale");
  assert.equal(tailnetIp.okForRemote, false);
  assert.equal(tailnetIp.titleKey, "mobileDevice.tailscaleHttpEntryTitle");
  assert.equal(tailnetIp.bodyKey, "mobileDevice.tailscaleHttpEntryBody");

  const configuredHttp = getRemoteEntryStatus({
    currentHref: "http://lifeos-mac.tailnet.example.ts.net:3000/mobile/chat",
    configuredBaseUrl: "http://lifeos-mac.tailnet.example.ts.net:3000",
  });
  assert.equal(configuredHttp.kind, "configured-match");
  assert.equal(configuredHttp.okForRemote, false);
  assert.equal(configuredHttp.titleKey, "mobileDevice.remoteInsecureTitle");
});

test("remote entry status detects configured public base mismatches with subpath support", async () => {
  const { getRemoteEntryStatus } = await import(`../src/services/pwaCapabilities.ts?case=remote-config-${Date.now()}`);

  const match = getRemoteEntryStatus({
    currentHref: "https://lifeos.example.com/lifeos/mobile/device",
    configuredBaseUrl: "https://lifeos.example.com/lifeos/",
  });
  assert.equal(match.kind, "configured-match");
  assert.equal(match.okForRemote, true);
  assert.equal(match.configuredBase, "https://lifeos.example.com/lifeos");

  const mismatch = getRemoteEntryStatus({
    currentHref: "https://wrong.example.com/mobile/device",
    configuredBaseUrl: "https://lifeos.example.com/lifeos",
  });
  assert.equal(mismatch.kind, "configured-mismatch");
  assert.equal(mismatch.okForRemote, false);
});

test("mobile remote connectivity probes health and websocket from the current phone entry", async (t) => {
  installBrowserGlobals({ href: "https://remote.example.test/lifeos/mobile/device" });
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ service: "lifeos-local-core" }),
    };
  };
  globalThis.WebSocket = class MockWebSocket {
    constructor(url) {
      this.url = url;
      setTimeout(() => this.listeners.open?.(), 0);
    }
    listeners = {};
    addEventListener(event, listener) {
      this.listeners[event] = listener;
    }
    close() {}
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    cleanupBrowserGlobals();
  });

  const { testMobileRemoteConnectivity } = await import(`../src/services/pwaCapabilities.ts?case=mobile-connect-ok-${Date.now()}`);
  const result = await testMobileRemoteConnectivity({ timeoutMs: 500 });

  assert.equal(result.ok, true);
  assert.deepEqual(fetchedUrls, ["/lifeos/api/v1/health"]);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "websocket"]);
  assert.equal(result.steps[1].url, "wss://remote.example.test/lifeos/api/v1/ws");
});

test("mobile remote connectivity reports websocket failures", async (t) => {
  installBrowserGlobals({ href: "https://remote.example.test/mobile/device" });
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ service: "lifeos-local-core" }),
  });
  globalThis.WebSocket = class MockWebSocket {
    constructor() {
      setTimeout(() => this.listeners.error?.(), 0);
    }
    listeners = {};
    addEventListener(event, listener) {
      this.listeners[event] = listener;
    }
    close() {}
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    cleanupBrowserGlobals();
  });

  const { testMobileRemoteConnectivity } = await import(`../src/services/pwaCapabilities.ts?case=mobile-connect-fail-${Date.now()}`);
  const result = await testMobileRemoteConnectivity({ timeoutMs: 500 });

  assert.equal(result.ok, false);
  assert.equal(result.steps[0].ok, true);
  assert.equal(result.steps[1].ok, false);
  assert.equal(result.error, "WebSocket connection failed");
});

test("mobile recovery hints combine entry type, failed probes, and offline queue state", async () => {
  const { getMobileRecoveryHints } = await import(`../src/services/pwaCapabilities.ts?case=mobile-recovery-hints-${Date.now()}`);
  const result = {
    ok: false,
    currentBase: "https://abc.trycloudflare.com",
    latencyMs: 100,
    steps: [
      { id: "health", ok: false, url: "/api/v1/health", latencyMs: 40, error: "HTTP 503" },
      { id: "websocket", ok: false, url: "wss://abc.trycloudflare.com/api/v1/ws", latencyMs: 60, error: "WebSocket failed" },
    ],
    error: "HTTP 503",
  };
  const hints = getMobileRecoveryHints(result, "temporary-cloudflare", { pending: 2, failed: 1 });
  assert.deepEqual(hints, [
    "mobileDevice.connectivityGuidanceTemporary",
    "mobileDevice.connectivityGuidanceHealth",
    "mobileDevice.connectivityGuidanceWebSocket",
    "mobileDevice.connectivityGuidanceOfflineQueue",
    "mobileDevice.connectivityGuidanceFailedQueue",
  ]);

  const tailscaleHints = getMobileRecoveryHints({
    ...result,
    steps: [{ id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 }, result.steps[1]],
  }, "tailscale", { pending: 0, failed: 0 });
  assert.deepEqual(tailscaleHints, [
    "mobileDevice.connectivityGuidanceTailscale",
    "mobileDevice.connectivityGuidanceWebSocket",
  ]);
});
