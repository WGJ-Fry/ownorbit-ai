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

function installLocalStorage() {
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
      removeItem(key) {
        values.delete(key);
      },
      clear() {
        values.clear();
      },
    },
    configurable: true,
  });
}

function cleanupLocalStorage() {
  delete globalThis.localStorage;
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

test("mobile iCloud handoff stores non-sensitive entry metadata and detects stale or mismatched entries", async (t) => {
  installLocalStorage();
  t.after(cleanupLocalStorage);
  const now = 1_800_000_000_000;
  const { buildMobileIcloudHandoffRecoveryPacket, consumeMobileIcloudHandoffFromUrl, getMobileIcloudHandoffActionKey, getMobileIcloudHandoffStatus, getStoredMobileIcloudHandoff, getStoredMobileIcloudHandoffEntries } = await import(`../src/services/mobileIcloudHandoff.ts?case=icloud-handoff-${Date.now()}`);
  const checksum = "a".repeat(64);
  const href = [
    "https://lifeos.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now}`,
    `entryRefreshAfter=${now + 60_000}`,
    `entryExpiresAt=${now + 120_000}`,
    "entryBaseUrl=https%3A%2F%2Flifeos.example.com",
    "entryMode=cloudflare",
    "entryStability=stable",
    "entryLabel=Cloudflare%20Named%20Tunnel",
    "entryDesktopId=mac-001",
    "entryDesktopName=Studio%20Mac",
    "entryDesktopSlug=studio-mac-001",
    `entryChecksumSha256=${checksum}`,
  ].join("&");

  const consumed = consumeMobileIcloudHandoffFromUrl(href, now);
  assert.equal(consumed.baseUrl, "https://lifeos.example.com");
  assert.equal(consumed.mode, "cloudflare");
  assert.equal(consumed.desktopId, "mac-001");
  assert.equal(consumed.desktopName, "Studio Mac");
  assert.equal(consumed.desktopSlug, "studio-mac-001");
  assert.equal(consumed.checksumSha256, checksum);
  assert.equal(getStoredMobileIcloudHandoff().baseUrl, "https://lifeos.example.com");
  assert.equal(getStoredMobileIcloudHandoff().desktopName, "Studio Mac");
  assert.equal(getStoredMobileIcloudHandoff().checksumSha256, checksum);
  assert.equal(getStoredMobileIcloudHandoffEntries()[0].desktopName, "Studio Mac");

  const fresh = getMobileIcloudHandoffStatus(consumed, "https://lifeos.example.com/mobile/device", now + 1_000);
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.needsRefresh, false);
  assert.equal(getMobileIcloudHandoffActionKey(fresh), "mobileDevice.icloudHandoffActionReady");

  const stale = getMobileIcloudHandoffStatus(consumed, "https://lifeos.example.com/mobile/device", now + 70_000);
  assert.equal(stale.status, "stale");
  assert.equal(stale.needsRefresh, true);
  assert.equal(getMobileIcloudHandoffActionKey(stale), "mobileDevice.icloudHandoffActionRefresh");

  const expired = getMobileIcloudHandoffStatus(consumed, "https://lifeos.example.com/mobile/device", now + 130_000);
  assert.equal(expired.status, "expired");
  assert.equal(getMobileIcloudHandoffActionKey(expired), "mobileDevice.icloudHandoffActionReopen");

  const mismatch = getMobileIcloudHandoffStatus(consumed, "https://new-lifeos.example.com/mobile/device", now + 1_000);
  assert.equal(mismatch.status, "address-mismatch");
  assert.equal(getMobileIcloudHandoffActionKey(mismatch), "mobileDevice.icloudHandoffActionMismatch");
  const legacy = getMobileIcloudHandoffStatus({ ...consumed, checksumSha256: "" }, "https://lifeos.example.com/mobile/device", now + 1_000);
  assert.equal(legacy.status, "legacy");
  assert.equal(legacy.needsRefresh, true);
  assert.equal(getMobileIcloudHandoffActionKey(legacy), "mobileDevice.icloudHandoffActionRefresh");
  assert.match(buildMobileIcloudHandoffRecoveryPacket(legacy), /status=legacy/);
  const packet = buildMobileIcloudHandoffRecoveryPacket(mismatch);
  assert.match(packet, /LifeOS iCloud Mobile Entry Recovery/);
  assert.match(packet, /entryBaseUrl=https:\/\/lifeos\.example\.com/);
  assert.match(packet, /currentBaseUrl=https:\/\/new-lifeos\.example\.com/);
  assert.match(packet, /desktopId=mac-001/);
  assert.match(packet, /desktopName=Studio Mac/);
  assert.match(packet, /desktopSlug=studio-mac-001/);
  assert.match(packet, new RegExp(`entryChecksumSha256=${checksum}`));
  assert.doesNotMatch(packet, /lifeosEntry=icloud/);
  assert.doesNotMatch(packet, /entryGeneratedAt=/);
});

test("mobile iCloud handoff launch runs connectivity check and stores the result", async (t) => {
  installLocalStorage();
  t.after(cleanupLocalStorage);
  const now = 1_800_000_000_000;
  const { getStoredMobileIcloudHandoff, handleMobileIcloudHandoffLaunch } = await import(`../src/services/mobileIcloudHandoff.ts?case=icloud-auto-check-${Date.now()}`);
  let reported = null;
  let icloudEvent = null;
  const href = [
    "https://lifeos.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now}`,
    `entryRefreshAfter=${now + 60_000}`,
    `entryExpiresAt=${now + 120_000}`,
    "entryBaseUrl=https%3A%2F%2Flifeos.example.com",
    "entryMode=tailscale",
    "entryStability=stable",
    "entryLabel=Tailscale%20HTTPS%20Serve",
    `entryChecksumSha256=${"b".repeat(64)}`,
  ].join("&");

  const launch = await handleMobileIcloudHandoffLaunch({
    href,
    cleanupUrl: false,
    now,
    testConnectivity: async (options) => ({
      ok: true,
      currentBase: new URL(options.currentHref).origin,
      latencyMs: 42,
      testedAt: now + 10,
      steps: [
        { id: "health", ok: true, url: "https://lifeos.example.com/api/v1/health", latencyMs: 10 },
        { id: "mobile-shell", ok: true, url: "https://lifeos.example.com/mobile/chat", latencyMs: 12 },
        { id: "websocket", ok: true, url: "wss://lifeos.example.com/api/v1/ws", latencyMs: 20 },
      ],
    }),
    reportConnectivity: async (result) => {
      reported = result;
      return { ok: true };
    },
    reportIcloudHandoffEvent: async (event) => {
      icloudEvent = event;
      return { ok: true };
    },
  });

  assert.equal(launch.reportSaved, true);
  assert.equal(launch.icloudEventReported, true);
  assert.equal(launch.icloudEventType, "opened-current-entry");
  assert.equal(icloudEvent.eventType, "opened-current-entry");
  assert.equal(icloudEvent.entryBaseUrl, "https://lifeos.example.com");
  assert.equal(icloudEvent.currentBaseUrl, "https://lifeos.example.com");
  assert.equal(icloudEvent.storedBaseUrl, "https://lifeos.example.com");
  assert.equal(icloudEvent.entryGeneratedAt, now);
  assert.equal(icloudEvent.storedGeneratedAt, now);
  assert.equal(icloudEvent.checksumSha256, "b".repeat(64));
  assert.equal(icloudEvent.ignoredAt, now);
  assert.equal(launch.result.ok, true);
  assert.equal(reported.currentBase, "https://lifeos.example.com");
  const stored = getStoredMobileIcloudHandoff();
  assert.equal(stored.checksumSha256, "b".repeat(64));
  assert.equal(stored.lastConnectivityTestedAt, now + 10);
  assert.equal(stored.lastConnectivityOk, true);
  assert.equal(stored.lastConnectivityError, "");
});

test("mobile iCloud handoff launch reports stale entries to the desktop", async (t) => {
  installLocalStorage();
  t.after(cleanupLocalStorage);
  const now = 1_800_000_300_000;
  const { handleMobileIcloudHandoffLaunch } = await import(`../src/services/mobileIcloudHandoff.ts?case=icloud-stale-report-${Date.now()}`);
  let icloudEvent = null;
  const href = [
    "https://lifeos.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now - 120_000}`,
    `entryRefreshAfter=${now - 60_000}`,
    `entryExpiresAt=${now + 600_000}`,
    "entryBaseUrl=https%3A%2F%2Flifeos.example.com",
    "entryMode=tailscale",
    "entryStability=stable",
    "entryLabel=Tailscale%20HTTPS%20Serve",
    `entryChecksumSha256=${"f".repeat(64)}`,
  ].join("&");

  const launch = await handleMobileIcloudHandoffLaunch({
    href,
    cleanupUrl: false,
    now,
    testConnectivity: async () => ({
      ok: true,
      currentBase: "https://lifeos.example.com",
      latencyMs: 24,
      testedAt: now + 5,
      steps: [
        { id: "health", ok: true, url: "https://lifeos.example.com/api/v1/health", latencyMs: 8 },
        { id: "mobile-shell", ok: true, url: "https://lifeos.example.com/mobile/chat", latencyMs: 8 },
        { id: "websocket", ok: true, url: "wss://lifeos.example.com/api/v1/ws", latencyMs: 8 },
      ],
    }),
    reportConnectivity: async () => ({ ok: true }),
    reportIcloudHandoffEvent: async (event) => {
      icloudEvent = event;
      return { ok: true };
    },
  });

  assert.equal(launch.icloudEventReported, true);
  assert.equal(launch.icloudEventType, "opened-stale-entry");
  assert.equal(icloudEvent.eventType, "opened-stale-entry");
  assert.equal(icloudEvent.entryBaseUrl, "https://lifeos.example.com");
  assert.equal(icloudEvent.currentBaseUrl, "https://lifeos.example.com");
  assert.equal(icloudEvent.storedBaseUrl, "https://lifeos.example.com");
  assert.equal(icloudEvent.entryGeneratedAt, now - 120_000);
  assert.equal(icloudEvent.storedGeneratedAt, now - 120_000);
  assert.equal(icloudEvent.checksumSha256, "f".repeat(64));
  assert.equal(icloudEvent.ignoredAt, now);
});

test("mobile iCloud handoff ignores older entries instead of overwriting the latest entry", async (t) => {
  installLocalStorage();
  t.after(cleanupLocalStorage);
  const now = 1_800_000_200_000;
  const { consumeMobileIcloudHandoffFromUrl, getStoredMobileIcloudHandoff, handleMobileIcloudHandoffLaunch, isMobileIcloudHandoffSuperseded } = await import(`../src/services/mobileIcloudHandoff.ts?case=icloud-ignore-older-${Date.now()}`);
  const freshHref = [
    "https://new-lifeos.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now}`,
    `entryRefreshAfter=${now + 60_000}`,
    `entryExpiresAt=${now + 120_000}`,
    "entryBaseUrl=https%3A%2F%2Fnew-lifeos.example.com",
    "entryMode=tailscale",
    "entryStability=stable",
    "entryLabel=Fresh%20Tailscale",
    `entryChecksumSha256=${"c".repeat(64)}`,
  ].join("&");
  const oldHref = [
    "https://old-lifeos.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now - 10_000}`,
    `entryRefreshAfter=${now + 30_000}`,
    `entryExpiresAt=${now + 90_000}`,
    "entryBaseUrl=https%3A%2F%2Fold-lifeos.example.com",
    "entryMode=cloudflare",
    "entryStability=temporary",
    "entryLabel=Old%20Tunnel",
    `entryChecksumSha256=${"d".repeat(64)}`,
  ].join("&");

  const fresh = consumeMobileIcloudHandoffFromUrl(freshHref, now);
  const old = consumeMobileIcloudHandoffFromUrl(oldHref, now + 1_000);
  const storedAfterConsume = getStoredMobileIcloudHandoff();
  assert.equal(fresh.baseUrl, "https://new-lifeos.example.com");
  assert.equal(old.baseUrl, "https://new-lifeos.example.com");
  assert.equal(isMobileIcloudHandoffSuperseded({ ...fresh, generatedAt: now - 1 }), true);
  assert.equal(storedAfterConsume.baseUrl, "https://new-lifeos.example.com");
  assert.equal(storedAfterConsume.checksumSha256, "c".repeat(64));
  assert.equal(storedAfterConsume.lastIgnoredBaseUrl, "https://old-lifeos.example.com");
  assert.equal(storedAfterConsume.lastIgnoredGeneratedAt, now - 10_000);

  let testCalled = false;
  let reportCalled = false;
  let icloudEvent = null;
  const launch = await handleMobileIcloudHandoffLaunch({
    href: oldHref,
    cleanupUrl: false,
    now: now + 2_000,
    testConnectivity: async () => {
      testCalled = true;
      throw new Error("should not test superseded entry");
    },
    reportConnectivity: async () => {
      reportCalled = true;
      return { ok: true };
    },
    reportIcloudHandoffEvent: async (event) => {
      icloudEvent = event;
      return { ok: true };
    },
  });

  assert.equal(launch.ignoredOlderEntry, true);
  assert.equal(launch.reportSaved, false);
  assert.equal(launch.icloudEventReported, true);
  assert.equal(launch.result, null);
  assert.equal(testCalled, false);
  assert.equal(reportCalled, false);
  assert.equal(icloudEvent.eventType, "ignored-superseded-entry");
  assert.equal(icloudEvent.entryBaseUrl, "https://old-lifeos.example.com");
  assert.equal(icloudEvent.currentBaseUrl, "https://old-lifeos.example.com");
  assert.equal(icloudEvent.storedBaseUrl, "https://new-lifeos.example.com");
  assert.equal(icloudEvent.entryGeneratedAt, now - 10_000);
  assert.equal(icloudEvent.storedGeneratedAt, now);
  assert.equal(icloudEvent.checksumSha256, "d".repeat(64));
  assert.equal(icloudEvent.ignoredAt, now + 2_000);
  const storedAfterLaunch = getStoredMobileIcloudHandoff();
  assert.equal(storedAfterLaunch.baseUrl, "https://new-lifeos.example.com");
  assert.equal(storedAfterLaunch.lastIgnoredAt, now + 2_000);
  assert.equal(storedAfterLaunch.lastIgnoredBaseUrl, "https://old-lifeos.example.com");
});

test("mobile iCloud handoff can switch to an older entry from a different desktop", async (t) => {
  installLocalStorage();
  t.after(cleanupLocalStorage);
  const now = 1_800_000_250_000;
  const { buildMobileIcloudHandoffUrl, consumeMobileIcloudHandoffFromUrl, forgetStoredMobileIcloudHandoffEntry, getStoredMobileIcloudHandoff, getStoredMobileIcloudHandoffEntries, handleMobileIcloudHandoffLaunch, isMobileIcloudHandoffSuperseded } = await import(`../src/services/mobileIcloudHandoff.ts?case=icloud-switch-desktop-${Date.now()}`);
  const macA = [
    "https://mac-a.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now}`,
    `entryRefreshAfter=${now + 60_000}`,
    `entryExpiresAt=${now + 120_000}`,
    "entryBaseUrl=https%3A%2F%2Fmac-a.example.com",
    "entryMode=tailscale",
    "entryStability=stable",
    "entryLabel=Mac%20A",
    "entryDesktopId=mac-a",
    "entryDesktopName=Kitchen%20Mac",
    "entryDesktopSlug=kitchen-mac",
    `entryChecksumSha256=${"1".repeat(64)}`,
  ].join("&");
  const macB = [
    "https://mac-b.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now - 10_000}`,
    `entryRefreshAfter=${now + 50_000}`,
    `entryExpiresAt=${now + 110_000}`,
    "entryBaseUrl=https%3A%2F%2Fmac-b.example.com",
    "entryMode=cloudflare",
    "entryStability=stable",
    "entryLabel=Mac%20B",
    "entryDesktopId=mac-b",
    "entryDesktopName=Studio%20Mac",
    "entryDesktopSlug=studio-mac",
    `entryChecksumSha256=${"2".repeat(64)}`,
  ].join("&");

  const first = consumeMobileIcloudHandoffFromUrl(macA, now);
  const parsedDifferentDesktop = consumeMobileIcloudHandoffFromUrl(macB, now + 1_000);
  assert.equal(first.desktopId, "mac-a");
  assert.equal(parsedDifferentDesktop.desktopId, "mac-b");
  assert.equal(parsedDifferentDesktop.baseUrl, "https://mac-b.example.com");
  assert.equal(isMobileIcloudHandoffSuperseded({ ...parsedDifferentDesktop, generatedAt: now - 20_000 }, first), false);
  assert.equal(getStoredMobileIcloudHandoff().desktopName, "Studio Mac");
  assert.equal(getStoredMobileIcloudHandoff().lastIgnoredAt, undefined);
  const storedEntries = getStoredMobileIcloudHandoffEntries();
  assert.equal(storedEntries.length, 2);
  assert.deepEqual(storedEntries.map((entry) => entry.desktopId), ["mac-b", "mac-a"]);
  const switchUrl = buildMobileIcloudHandoffUrl(storedEntries[1]);
  assert.match(switchUrl, /^https:\/\/mac-a\.example\.com\/mobile\/device\?/);
  assert.match(switchUrl, /lifeosEntry=icloud/);
  assert.match(switchUrl, /entryDesktopId=mac-a/);
  assert.equal(forgetStoredMobileIcloudHandoffEntry(storedEntries[1]), true);
  assert.deepEqual(getStoredMobileIcloudHandoffEntries().map((entry) => entry.desktopId), ["mac-b"]);
  assert.equal(forgetStoredMobileIcloudHandoffEntry(getStoredMobileIcloudHandoff()), false);
  assert.deepEqual(getStoredMobileIcloudHandoffEntries().map((entry) => entry.desktopId), ["mac-b"]);

  let testCalled = false;
  let icloudEvent = null;
  const launch = await handleMobileIcloudHandoffLaunch({
    href: macB,
    cleanupUrl: false,
    now: now + 2_000,
    testConnectivity: async () => {
      testCalled = true;
      return {
        ok: true,
        currentBase: "https://mac-b.example.com",
        latencyMs: 21,
        testedAt: now + 2_100,
        steps: [
          { id: "health", ok: true, url: "https://mac-b.example.com/api/v1/health", latencyMs: 7 },
          { id: "mobile-shell", ok: true, url: "https://mac-b.example.com/mobile/chat", latencyMs: 7 },
          { id: "websocket", ok: true, url: "wss://mac-b.example.com/api/v1/ws", latencyMs: 7 },
        ],
      };
    },
    reportConnectivity: async () => ({ ok: true }),
    reportIcloudHandoffEvent: async (event) => {
      icloudEvent = event;
      return { ok: true };
    },
  });

  assert.equal(launch.ignoredOlderEntry, undefined);
  assert.equal(launch.reportSaved, true);
  assert.equal(testCalled, true);
  assert.equal(launch.icloudEventReported, true);
  assert.equal(launch.icloudEventType, "opened-current-entry");
  assert.equal(icloudEvent.eventType, "opened-current-entry");
  assert.equal(icloudEvent.entryBaseUrl, "https://mac-b.example.com");
  assert.equal(launch.entry.desktopId, "mac-b");
  assert.equal(getStoredMobileIcloudHandoff().desktopId, "mac-b");
  assert.equal(getStoredMobileIcloudHandoff().lastConnectivityOk, true);
});

test("mobile iCloud handoff launch stores a failed result when connectivity probing throws", async (t) => {
  installLocalStorage();
  t.after(cleanupLocalStorage);
  const now = 1_800_000_100_000;
  const { getMobileIcloudHandoffActionKey, getMobileIcloudHandoffStatus, getStoredMobileIcloudHandoff, handleMobileIcloudHandoffLaunch } = await import(`../src/services/mobileIcloudHandoff.ts?case=icloud-auto-check-fail-${Date.now()}`);
  let reported = null;
  const href = [
    "https://lifeos.example.com/mobile/chat?lifeosEntry=icloud",
    `entryGeneratedAt=${now}`,
    `entryRefreshAfter=${now + 60_000}`,
    `entryExpiresAt=${now + 120_000}`,
    "entryBaseUrl=https%3A%2F%2Flifeos.example.com",
    "entryMode=icloud",
    "entryStability=stable",
    "entryLabel=iCloud%20Handoff",
  ].join("&");

  const launch = await handleMobileIcloudHandoffLaunch({
    href,
    cleanupUrl: false,
    now,
    testConnectivity: async () => {
      throw new Error("probe unavailable");
    },
    reportConnectivity: async (result) => {
      reported = result;
      return { ok: true };
    },
  });

  assert.equal(launch.reportSaved, true);
  assert.equal(launch.result.ok, false);
  assert.equal(launch.result.error, "probe unavailable");
  assert.equal(launch.result.steps.length, 3);
  assert.equal(reported.ok, false);
  const stored = getStoredMobileIcloudHandoff();
  assert.equal(stored.lastConnectivityTestedAt, now);
  assert.equal(stored.lastConnectivityOk, false);
  assert.equal(stored.lastConnectivityError, "probe unavailable");
  assert.equal(getMobileIcloudHandoffActionKey(getMobileIcloudHandoffStatus(launch.entry, href, now)), "mobileDevice.icloudHandoffActionRefresh");
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
