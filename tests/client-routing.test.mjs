// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

test("client API and realtime URLs preserve reverse-proxy base paths", async (t) => {
  const originalWindow = globalThis.window;
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });

  globalThis.window = {
    location: {
      protocol: "https:",
      host: "remote.example.test",
      pathname: "/lifeos/mobile/chat",
    },
  };

  const { apiUrl, getLifeOSBasePath, realtimeWebSocketUrl } = await import(`../src/services/lifeosApi.ts?client-routing=${Date.now()}`);
  assert.equal(getLifeOSBasePath(), "/lifeos");
  assert.equal(apiUrl("/api/v1/health"), "/lifeos/api/v1/health");
  assert.equal(apiUrl("api/v1/devices"), "/lifeos/api/v1/devices");
  assert.equal(realtimeWebSocketUrl(), "wss://remote.example.test/lifeos/api/v1/ws");
});

test("client chat route also preserves reverse-proxy base paths", async () => {
  globalThis.window = {
    location: {
      protocol: "https:",
      host: "remote.example.test",
      pathname: "/lifeos/chat",
    },
  };

  const { apiUrl, getLifeOSBasePath, realtimeWebSocketUrl } = await import(`../src/services/lifeosApi.ts?client-routing-chat=${Date.now()}`);
  assert.equal(getLifeOSBasePath(), "/lifeos");
  assert.equal(apiUrl("/api/v1/health"), "/lifeos/api/v1/health");
  assert.equal(realtimeWebSocketUrl(), "wss://remote.example.test/lifeos/api/v1/ws");
});

test("client API and realtime URLs stay root-relative without a proxy base path", async () => {
  globalThis.window = {
    location: {
      protocol: "http:",
      host: "127.0.0.1:3000",
      pathname: "/mobile/chat",
    },
  };

  const { apiUrl, getLifeOSBasePath, realtimeWebSocketUrl } = await import(`../src/services/lifeosApi.ts?client-routing-root=${Date.now()}`);
  assert.equal(getLifeOSBasePath(), "");
  assert.equal(apiUrl("/api/v1/health"), "/api/v1/health");
  assert.equal(realtimeWebSocketUrl(), "ws://127.0.0.1:3000/api/v1/ws");
});

test("client chat route stays root-relative without a proxy base path", async () => {
  globalThis.window = {
    location: {
      protocol: "http:",
      host: "127.0.0.1:3000",
      pathname: "/chat",
    },
  };

  const { apiUrl, getLifeOSBasePath, realtimeWebSocketUrl } = await import(`../src/services/lifeosApi.ts?client-routing-chat-root=${Date.now()}`);
  assert.equal(getLifeOSBasePath(), "");
  assert.equal(apiUrl("/api/v1/health"), "/api/v1/health");
  assert.equal(realtimeWebSocketUrl(), "ws://127.0.0.1:3000/api/v1/ws");
});

test("mobile realtime reconnect delay uses capped exponential backoff", async () => {
  const { realtimeReconnectDelay } = await import(`../src/hooks/useLifeOSRealtime.ts?client-realtime-delay=${Date.now()}`);

  assert.equal(realtimeReconnectDelay(0), 1000);
  assert.equal(realtimeReconnectDelay(1), 2000);
  assert.equal(realtimeReconnectDelay(5), 30000);
  assert.equal(realtimeReconnectDelay(20), 30000);
  assert.equal(realtimeReconnectDelay(-1), 1000);
});
