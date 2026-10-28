import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeviceEndpointsSnapshot,
  getDeviceEndpointsSnapshot,
  maybeBroadcastDeviceEndpointsChange,
  resetDeviceEndpointsStateForTests,
} from "../server/deviceEndpoints.ts";

const CANDIDATES = [
  { id: "tailscale-https", mode: "tailscale", baseUrl: "https://mac.tailnet.ts.net/", priority: 98, stability: "stable" },
  { id: "cloudflare-quick", mode: "cloudflare", baseUrl: "https://calm-river.trycloudflare.com", priority: 84, stability: "temporary" },
  { id: "lan-1", mode: "lan", baseUrl: "http://192.168.150.109:3000", priority: 50, stability: "temporary" },
  { id: "local", mode: "local", baseUrl: "http://127.0.0.1:3000", priority: 10, stability: "local" },
];

test("snapshot keeps only phone-reachable candidates for the current binding", () => {
  const loopback = buildDeviceEndpointsSnapshot({ candidates: CANDIDATES, bindHost: "127.0.0.1" });
  assert.deepEqual(loopback.candidates.map((item) => item.baseUrl), [
    "https://mac.tailnet.ts.net",
    "https://calm-river.trycloudflare.com",
  ]);

  const lan = buildDeviceEndpointsSnapshot({ candidates: CANDIDATES, bindHost: "0.0.0.0" });
  assert.deepEqual(lan.candidates.map((item) => item.baseUrl), [
    "https://mac.tailnet.ts.net",
    "https://calm-river.trycloudflare.com",
    "http://192.168.150.109:3000",
  ]);
});

test("plain-HTTP direct addresses are dropped while the core is loopback-bound", () => {
  // Bound to loopback, nothing listens on the Tailscale interface — the HTTP
  // MagicDNS and Tailscale-IP variants would be stored as dead addresses.
  const candidates = [
    { id: "ts-https", mode: "tailscale", baseUrl: "https://mac.tailnet.ts.net", priority: 98, stability: "stable" },
    { id: "ts-magicdns-http", mode: "tailscale", baseUrl: "http://mac.tailnet.ts.net:3000", priority: 60, stability: "stable" },
    { id: "ts-ip-http", mode: "tailscale", baseUrl: "http://100.88.155.24:3000", priority: 58, stability: "stable" },
    { id: "ts-ip6-http", mode: "tailscale", baseUrl: "http://[fd7a:115c:a1e0::d101:9bb4]:3000", priority: 56, stability: "stable" },
  ];
  const loopback = buildDeviceEndpointsSnapshot({ candidates, bindHost: "127.0.0.1" });
  assert.deepEqual(loopback.candidates.map((item) => item.baseUrl), ["https://mac.tailnet.ts.net"]);

  // Bound to every interface, those direct paths are genuinely reachable.
  const open = buildDeviceEndpointsSnapshot({ candidates, bindHost: "0.0.0.0" });
  assert.equal(open.candidates.length, 4);
});

test("snapshot candidates carry addresses only — no env templates, notes, or pairing links", () => {
  const snapshot = buildDeviceEndpointsSnapshot({
    candidates: [{
      ...CANDIDATES[0],
      envTemplate: "LIFEOS_HOST=127.0.0.1 npm run start",
      notes: ["secret-ish note"],
      mobilePairUrl: "https://mac.tailnet.ts.net/mobile/pair",
      restartInstruction: "restart",
    }],
    bindHost: "127.0.0.1",
  });
  assert.deepEqual(Object.keys(snapshot.candidates[0]).sort(), [
    "baseUrl", "id", "mode", "priority", "secure", "stability",
  ]);
});

test("duplicate base URLs collapse to the highest priority", () => {
  const snapshot = buildDeviceEndpointsSnapshot({
    candidates: [
      { id: "saved", mode: "configured", baseUrl: "https://mac.tailnet.ts.net", priority: 97, stability: "stable" },
      { id: "tailscale", mode: "tailscale", baseUrl: "https://mac.tailnet.ts.net/", priority: 98, stability: "stable" },
    ],
    bindHost: "127.0.0.1",
  });
  assert.equal(snapshot.candidates.length, 1);
  assert.equal(snapshot.candidates[0].id, "tailscale");
  assert.equal(snapshot.candidates[0].priority, 98);
});

test("version is stable for identical inputs and moves when addresses move", () => {
  const a = buildDeviceEndpointsSnapshot({ candidates: CANDIDATES, bindHost: "0.0.0.0", now: 1000 });
  const b = buildDeviceEndpointsSnapshot({ candidates: CANDIDATES, bindHost: "0.0.0.0", now: 2000 });
  assert.equal(a.version, b.version);

  const c = buildDeviceEndpointsSnapshot({ candidates: CANDIDATES.slice(0, 2), bindHost: "0.0.0.0" });
  assert.notEqual(a.version, c.version);
});

test("malformed candidates never crash the builder", () => {
  const snapshot = buildDeviceEndpointsSnapshot({
    candidates: [null, {}, { mode: "tailscale" }, { mode: "tailscale", baseUrl: "not a url" }, { mode: "ftp", baseUrl: "ftp://x" }],
    bindHost: "0.0.0.0",
  });
  assert.deepEqual(snapshot.candidates, []);
  assert.equal(typeof snapshot.version, "string");
});

test("the cached snapshot avoids re-running diagnostics inside the TTL", () => {
  resetDeviceEndpointsStateForTests();
  let calls = 0;
  const fetcher = () => {
    calls += 1;
    return CANDIDATES;
  };
  getDeviceEndpointsSnapshot("0.0.0.0", { fetcher, maxAgeMs: 60_000 });
  getDeviceEndpointsSnapshot("0.0.0.0", { fetcher, maxAgeMs: 60_000 });
  assert.equal(calls, 1);

  // A different bind host must not reuse the cache.
  getDeviceEndpointsSnapshot("127.0.0.1", { fetcher, maxAgeMs: 60_000 });
  assert.equal(calls, 2);

  // maxAgeMs 0 always recomputes, even within the same millisecond.
  getDeviceEndpointsSnapshot("127.0.0.1", { fetcher, maxAgeMs: 0 });
  assert.equal(calls, 3);
});

test("the change broadcast fires only on real changes and never carries addresses", () => {
  resetDeviceEndpointsStateForTests();
  const sent = [];
  const broadcast = (payload) => sent.push(payload);

  const first = maybeBroadcastDeviceEndpointsChange("boot", { bindHost: "0.0.0.0", fetcher: () => CANDIDATES, broadcast });
  assert.equal(first.first, true);
  assert.equal(sent.length, 0);

  const same = maybeBroadcastDeviceEndpointsChange("same", { bindHost: "0.0.0.0", fetcher: () => CANDIDATES, broadcast });
  assert.equal(same.changed, false);
  assert.equal(sent.length, 0);

  const changed = maybeBroadcastDeviceEndpointsChange("moved", { bindHost: "0.0.0.0", fetcher: () => CANDIDATES.slice(0, 1), broadcast });
  assert.equal(changed.changed, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "endpoints.changed");
  assert.equal(sent[0].reason, "moved");
  const raw = JSON.stringify(sent[0]);
  assert.doesNotMatch(raw, /ts\.net|trycloudflare|192\.168/);

  const back = maybeBroadcastDeviceEndpointsChange("same-again", { bindHost: "0.0.0.0", fetcher: () => CANDIDATES.slice(0, 1), broadcast });
  assert.equal(back.changed, false);
  assert.equal(sent.length, 1);
});

test("health CORS reflection only recognizes current candidate origins", async () => {
  const { isKnownCandidateOrigin } = await import("../server/deviceEndpoints.ts");
  resetDeviceEndpointsStateForTests();
  const fetcher = () => CANDIDATES;
  // Warm the cache with a known fetcher so the check does not shell out.
  getDeviceEndpointsSnapshot("0.0.0.0", { fetcher, maxAgeMs: 60_000 });

  assert.equal(isKnownCandidateOrigin("https://mac.tailnet.ts.net", "0.0.0.0"), true);
  assert.equal(isKnownCandidateOrigin("https://mac.tailnet.ts.net:443", "0.0.0.0"), true);
  assert.equal(isKnownCandidateOrigin("http://192.168.150.109:3000", "0.0.0.0"), true);
  assert.equal(isKnownCandidateOrigin("https://evil.example.com", "0.0.0.0"), false);
  assert.equal(isKnownCandidateOrigin("not a url", "0.0.0.0"), false);
  assert.equal(isKnownCandidateOrigin("", "0.0.0.0"), false);
  assert.equal(isKnownCandidateOrigin(null, "0.0.0.0"), false);
  resetDeviceEndpointsStateForTests();
});
