import assert from "node:assert/strict";
import test from "node:test";
import { eligiblePhonePairingCandidates } from "../src/services/pairingCandidatePolicy.ts";

function candidate(mode, baseUrl, secure) {
  return { id: `${mode}-${baseUrl}`, mode, baseUrl, secure };
}

test("phone pairing only keeps reachable LAN or secure remote entries", () => {
  const candidates = [
    candidate("local", "http://127.0.0.1:3000", true),
    candidate("local", "http://localhost:3000", true),
    candidate("tailscale", "http://100.88.155.24:3000", false),
    candidate("tailscale", "http://mac-mini.example.ts.net:3000", true),
    candidate("configured", "http://203.0.113.10:3000", false),
    candidate("lan", "http://192.168.0.117:3000", false),
    candidate("tailscale", "https://mac-mini.example.ts.net", true),
    candidate("cloudflare", "https://lifeos.example.com", true),
  ];

  assert.deepEqual(
    eligiblePhonePairingCandidates(candidates).map((item) => item.baseUrl),
    [
      "http://192.168.0.117:3000",
      "https://mac-mini.example.ts.net",
      "https://lifeos.example.com",
    ],
  );
});

test("phone pairing rejects malformed and loopback candidates", () => {
  assert.deepEqual(eligiblePhonePairingCandidates([
    candidate("lan", "not-a-url", false),
    candidate("lan", "http://127.0.0.8:3000", false),
    candidate("configured", "https://localhost", true),
  ]), []);
});
