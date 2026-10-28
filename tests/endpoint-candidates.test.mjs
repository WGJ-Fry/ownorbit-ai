// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};

const SNAPSHOT = {
  version: "abc123",
  generatedAt: 1_700_000_000_000,
  candidates: [
    { id: "ts", mode: "tailscale", baseUrl: "https://mac.tailnet.ts.net/", priority: 98, secure: true, stability: "stable" },
    { id: "lan", mode: "lan", baseUrl: "http://192.168.1.9:3000", priority: 50, secure: false, stability: "temporary" },
  ],
};

test("endpoint candidates round-trip through storage with normalization", async () => {
  const m = await import("../src/services/endpointCandidates.ts");
  storage.clear();
  assert.equal(m.saveEndpointCandidates(SNAPSHOT), true);
  const stored = m.getStoredEndpointCandidates();
  assert.equal(stored.version, "abc123");
  // Trailing slash is stripped and secure recomputed from the scheme.
  assert.equal(stored.candidates[0].baseUrl, "https://mac.tailnet.ts.net");
  assert.equal(stored.candidates[0].secure, true);
  assert.equal(stored.candidates[1].secure, false);

  m.clearEndpointCandidates();
  assert.equal(m.getStoredEndpointCandidates(), null);
});

test("malformed stored payloads are rejected, never thrown", async () => {
  const m = await import(`../src/services/endpointCandidates.ts?case=malformed-${Date.now()}`);
  storage.clear();
  storage.set("lifeos_endpoint_candidates_v1", "{not json");
  assert.equal(m.getStoredEndpointCandidates(), null);
  storage.set("lifeos_endpoint_candidates_v1", JSON.stringify({ version: "x", candidates: "not-an-array" }));
  assert.equal(m.getStoredEndpointCandidates(), null);
  storage.set("lifeos_endpoint_candidates_v1", JSON.stringify({
    version: "x",
    generatedAt: 1,
    candidates: [{ baseUrl: "ftp://nope" }, { baseUrl: "https://ok.example.com" }, null],
  }));
  const stored = m.getStoredEndpointCandidates();
  assert.deepEqual(stored.candidates.map((c) => c.baseUrl), ["https://ok.example.com"]);
});

test("origin comparison folds default ports, paths, and case", async () => {
  const m = await import("../src/services/endpointCandidates.ts");
  const n = m.normalizeOriginForComparison;
  assert.equal(n("https://Host.example.com:443/lifeos"), "https://host.example.com");
  assert.equal(n("https://host.example.com"), "https://host.example.com");
  assert.equal(n("http://host.example.com:80/"), "http://host.example.com");
  assert.equal(n("http://host.example.com:3000"), "http://host.example.com:3000");
  assert.equal(n("not a url"), "");
});

test("probe classifies mixed-content candidates as unprobeable instead of dead", async () => {
  const m = await import(`../src/services/endpointCandidates.ts?case=mixed-${Date.now()}`);
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: { location: { protocol: "https:", origin: "https://tunnel.example.com" } },
    configurable: true,
    writable: true,
  });
  try {
    assert.equal(await m.probeEndpointCandidate("http://192.168.1.9:3000"), "unprobeable");
    assert.equal(await m.probeEndpointCandidate("not a url"), "unreachable");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true });
  }
});

test("probe trusts only a readable OwnOrbit health payload as verified", async () => {
  const m = await import(`../src/services/endpointCandidates.ts?case=probe-${Date.now()}`);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, service: "lifeos-local-core" }) });
    assert.equal(await m.probeEndpointCandidate("https://good.example.com"), "verified");

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ service: "something-else" }) });
    assert.equal(await m.probeEndpointCandidate("https://impostor.example.com"), "unreachable");

    globalThis.fetch = async () => ({ ok: false, status: 530, json: async () => null });
    assert.equal(await m.probeEndpointCandidate("https://edge-error.example.com"), "reachable-unverified");

    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      if (init?.mode === "cors") throw new TypeError("cors blocked");
      return {};
    };
    assert.equal(await m.probeEndpointCandidate("https://opaque-only.example.com"), "reachable-unverified");
    assert.equal(calls, 2);

    globalThis.fetch = async () => {
      throw new TypeError("network down");
    };
    assert.equal(await m.probeEndpointCandidate("https://dead.example.com"), "unreachable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fallback search prefers verified candidates and skips the failing origin", async () => {
  const m = await import(`../src/services/endpointCandidates.ts?case=fallback-${Date.now()}`);
  storage.clear();
  m.saveEndpointCandidates({
    version: "v1",
    generatedAt: Date.now(),
    candidates: [
      { id: "current", mode: "cloudflare", baseUrl: "https://tunnel.example.com:443", priority: 90, secure: true, stability: "temporary" },
      { id: "edge", mode: "cloudflare", baseUrl: "https://edge.example.com", priority: 80, secure: true, stability: "temporary" },
      { id: "ts", mode: "tailscale", baseUrl: "https://mac.tailnet.ts.net", priority: 70, secure: true, stability: "stable" },
    ],
  });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.startsWith("https://tunnel.example.com")) throw new Error("must not probe the failing origin");
      if (target.startsWith("https://edge.example.com")) return { ok: false, status: 530, json: async () => null };
      return { ok: true, json: async () => ({ service: "lifeos-local-core" }) };
    };
    // The failing origin uses an explicit default port: origin folding must
    // still skip it. The edge answers first but only the tailscale candidate
    // verifies, so verified wins over reachable-unverified despite priority.
    const found = await m.findReachableFallbackCandidate({ currentOrigin: "https://tunnel.example.com" });
    assert.equal(found.candidate.id, "ts");
    assert.equal(found.outcome, "verified");
    assert.equal(found.pairUrl, "https://mac.tailnet.ts.net/mobile/pair");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
