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
  assert.equal(configuredHttp.kind, "tailscale");
  assert.equal(configuredHttp.okForRemote, false);
  assert.equal(configuredHttp.titleKey, "mobileDevice.tailscaleHttpEntryTitle");
});

test("remote entry status detects configured public base mismatches with subpath support", async () => {
  const { getRemoteEntryStatus } = await import(`../src/services/pwaCapabilities.ts?case=remote-config-${Date.now()}`);

  const match = getRemoteEntryStatus({
    currentHref: "https://lifeos.example.com/lifeos/mobile/device",
    configuredBaseUrl: "https://lifeos.example.com/lifeos/",
  });
  assert.equal(match.kind, "stable-https");
  assert.equal(match.okForRemote, true);
  assert.equal(match.configuredBase, "https://lifeos.example.com/lifeos");

  const tailscaleMatch = getRemoteEntryStatus({
    currentHref: "https://mac-mini.tailnet.ts.net/lifeos/mobile/chat",
    configuredBaseUrl: "https://mac-mini.tailnet.ts.net/lifeos",
  });
  assert.equal(tailscaleMatch.kind, "tailscale");
  assert.equal(tailscaleMatch.okForRemote, true);
  assert.equal(tailscaleMatch.configuredBase, "https://mac-mini.tailnet.ts.net/lifeos");

  const temporaryMatch = getRemoteEntryStatus({
    currentHref: "https://old.trycloudflare.com/mobile/device",
    configuredBaseUrl: "https://old.trycloudflare.com",
  });
  assert.equal(temporaryMatch.kind, "temporary-cloudflare");
  assert.equal(temporaryMatch.okForRemote, true);

  const cloudflareNamed = getRemoteEntryStatus({
    currentHref: "https://lifeos.example.com/mobile/chat",
    configuredBaseUrl: "https://lifeos.example.com",
    configuredMode: "cloudflare",
  });
  assert.equal(cloudflareNamed.kind, "cloudflare-named");
  assert.equal(cloudflareNamed.okForRemote, true);
  assert.equal(cloudflareNamed.titleKey, "mobileDevice.cloudflareNamedEntryTitle");

  const mismatch = getRemoteEntryStatus({
    currentHref: "https://wrong.example.com/mobile/device",
    configuredBaseUrl: "https://lifeos.example.com/lifeos",
    configuredMode: "cloudflare",
  });
  assert.equal(mismatch.kind, "configured-mismatch");
  assert.equal(mismatch.okForRemote, false);
});

test("mobile remote connectivity probes health, mobile chat shell, and websocket from the current phone entry", async (t) => {
  installBrowserGlobals({ href: "https://remote.example.test/lifeos/mobile/device" });
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    if (String(url).endsWith("/mobile/chat")) {
      return {
        ok: true,
        status: 200,
        text: async () => '<!doctype html><title>LifeOS AI</title><div id="root"></div>',
      };
    }
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
  assert.deepEqual(fetchedUrls, ["/lifeos/api/v1/health", "/lifeos/mobile/chat"]);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell", "websocket"]);
  assert.equal(result.steps[1].url, "/lifeos/mobile/chat");
  assert.equal(result.steps[2].url, "wss://remote.example.test/lifeos/api/v1/ws");
});

test("mobile remote connectivity reports websocket failures", async (t) => {
  installBrowserGlobals({ href: "https://remote.example.test/mobile/device" });
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ service: "lifeos-local-core" }),
    text: async () => '<!doctype html><title>LifeOS AI</title><div id="root"></div>',
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
  assert.equal(result.steps[1].ok, true);
  assert.equal(result.steps[2].ok, false);
  assert.equal(result.error, "WebSocket connection failed");
});

test("mobile recovery hints combine entry type, failed probes, and offline queue state", async () => {
  const { getMobileConnectivityIssue, getMobileRecoveryHints } = await import(`../src/services/pwaCapabilities.ts?case=mobile-recovery-hints-${Date.now()}`);
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
  assert.equal(getMobileConnectivityIssue(result, "temporary-cloudflare", { pending: 2, failed: 1 }), "mobileDevice.connectivityIssueTemporaryExpired");

  const tailscaleHttpsHints = getMobileRecoveryHints({
    ...result,
    currentBase: "https://desktop.tailnet.ts.net",
    steps: [{ id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 }, result.steps[1]],
  }, "tailscale", { pending: 0, failed: 0 });
  assert.deepEqual(tailscaleHttpsHints, [
    "mobileDevice.connectivityGuidanceTailscale",
    "mobileDevice.connectivityGuidanceWebSocket",
  ]);
  assert.equal(getMobileConnectivityIssue({
    ...result,
    currentBase: "https://desktop.tailnet.ts.net",
    steps: [{ id: "health", ok: false, url: "/api/v1/health", latencyMs: 10 }, result.steps[1]],
  }, "tailscale"), "mobileDevice.connectivityIssueTailscaleOffline");

  const tailscaleHttpHints = getMobileRecoveryHints({
    ...result,
    currentBase: "http://100.100.100.100:3000",
    steps: [{ id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 }, result.steps[1]],
  }, "tailscale", { pending: 0, failed: 0 });
  assert.deepEqual(tailscaleHttpHints, [
    "mobileDevice.connectivityGuidanceTailscaleHttp",
    "mobileDevice.connectivityGuidanceWebSocket",
  ]);
  assert.equal(getMobileConnectivityIssue({
    ...result,
    currentBase: "http://100.100.100.100:3000",
    steps: [{ id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 }, result.steps[1]],
  }, "tailscale"), "mobileDevice.connectivityIssueTailscaleHttp");
  assert.equal(getMobileConnectivityIssue({
    ...result,
    currentBase: "https://remote.example.test",
    steps: [{ id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 }, result.steps[1]],
  }, "stable-https"), "mobileDevice.connectivityIssueWebSocket");
  assert.deepEqual(getMobileRecoveryHints({
    ...result,
    currentBase: "https://lifeos.example.com",
    steps: [{ id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 }, result.steps[1]],
  }, "cloudflare-named"), [
    "mobileDevice.connectivityGuidanceCloudflareNamed",
    "mobileDevice.connectivityGuidanceWebSocket",
  ]);
  assert.equal(getMobileConnectivityIssue({
    ...result,
    currentBase: "https://lifeos.example.com",
    steps: [
      { id: "health", ok: false, url: "/api/v1/health", latencyMs: 10, error: "fetch failed" },
      { id: "mobile-shell", ok: false, url: "/mobile/chat", latencyMs: 10, error: "HTTP 502" },
      result.steps[1],
    ],
  }, "cloudflare-named"), "mobileDevice.connectivityIssueCloudflareNamedOffline");
  assert.equal(getMobileConnectivityIssue({
    ok: true,
    currentBase: "https://remote.example.test",
    latencyMs: 20,
    steps: [
      { id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 },
      { id: "mobile-shell", ok: true, url: "/mobile/chat", latencyMs: 10 },
      { id: "websocket", ok: true, url: "wss://remote.example.test/api/v1/ws", latencyMs: 10 },
    ],
  }, "stable-https"), "mobileDevice.connectivityIssueOk");
  const connectedButQueueFailed = {
    ok: true,
    currentBase: "https://remote.example.test",
    latencyMs: 20,
    steps: [
      { id: "health", ok: true, url: "/api/v1/health", latencyMs: 10 },
      { id: "mobile-shell", ok: true, url: "/mobile/chat", latencyMs: 10 },
      { id: "websocket", ok: true, url: "wss://remote.example.test/api/v1/ws", latencyMs: 10 },
    ],
  };
  assert.equal(getMobileConnectivityIssue(connectedButQueueFailed, "stable-https", { failed: 1 }), "mobileDevice.connectivityIssueQueueBlocked");
  assert.deepEqual(getMobileRecoveryHints(connectedButQueueFailed, "stable-https", { failed: 1 }), [
    "mobileDevice.connectivityGuidanceHttps",
    "mobileDevice.connectivityGuidanceFailedQueue",
  ]);
});

test("remote entry guidance is visible before manual connectivity tests", async () => {
  const { getRemoteEntryGuidance } = await import(`../src/services/pwaCapabilities.ts?case=remote-entry-guidance-${Date.now()}`);

  assert.deepEqual(getRemoteEntryGuidance({
    kind: "temporary-cloudflare",
    currentBase: "https://abc.trycloudflare.com",
    okForRemote: true,
  }, { pending: 1, failed: 1 }), [
    "mobileDevice.connectivityGuidanceTemporary",
    "mobileDevice.connectivityGuidanceOfflineQueue",
    "mobileDevice.connectivityGuidanceFailedQueue",
  ]);

  assert.deepEqual(getRemoteEntryGuidance({
    kind: "tailscale",
    currentBase: "http://100.64.0.10:3000",
    okForRemote: false,
  }), [
    "mobileDevice.connectivityGuidanceTailscaleHttp",
  ]);

  assert.deepEqual(getRemoteEntryGuidance({
    kind: "cloudflare-named",
    currentBase: "https://lifeos.example.com",
    okForRemote: true,
  }), [
    "mobileDevice.connectivityGuidanceCloudflareNamed",
  ]);

  assert.deepEqual(getRemoteEntryGuidance({
    kind: "configured-mismatch",
    currentBase: "https://old.trycloudflare.com",
    okForRemote: false,
  }), [
    "mobileDevice.connectivityGuidanceDefault",
  ]);
});

test("stored mobile connectivity reports restore actionable recovery diagnostics", async () => {
  const { getMobileConnectivityIssue, getMobileRecoveryHints, mobileConnectivityResultFromReport } = await import(`../src/services/pwaCapabilities.ts?case=stored-connectivity-report-${Date.now()}`);

  const result = mobileConnectivityResultFromReport({
    ok: false,
    currentBaseUrl: "https://lifeos.example.com/",
    healthOk: true,
    mobileShellOk: true,
    websocketOk: false,
    latencyMs: 240,
    error: "WebSocket connection failed",
    createdAt: 1710000000000,
  });

  assert.equal(result.currentBase, "https://lifeos.example.com");
  assert.equal(result.testedAt, 1710000000000);
  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell", "websocket"]);
  assert.equal(result.steps[0].url, "https://lifeos.example.com/api/v1/health");
  assert.equal(result.steps[1].url, "https://lifeos.example.com/mobile/chat");
  assert.equal(result.steps[2].url, "wss://lifeos.example.com/api/v1/ws");
  assert.equal(getMobileConnectivityIssue(result, "stable-https"), "mobileDevice.connectivityIssueWebSocket");
  assert.deepEqual(getMobileRecoveryHints(result, "stable-https", { failed: 1 }), [
    "mobileDevice.connectivityGuidanceHttps",
    "mobileDevice.connectivityGuidanceWebSocket",
    "mobileDevice.connectivityGuidanceFailedQueue",
  ]);
});
