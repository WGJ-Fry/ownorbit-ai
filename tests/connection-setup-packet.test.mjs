import assert from "node:assert/strict";
import test from "node:test";

const { buildConnectionSetupPacket } = await import("../src/services/connectionSetupPacket.ts");

test("connection setup packet includes remote entry, env, restart, and next steps", () => {
  const packet = buildConnectionSetupPacket({
    id: "tailscale-serve-https",
    label: "Tailscale HTTPS Serve",
    mode: "tailscale",
    baseUrl: "https://lifeos.tailnet.example.ts.net",
    mobileChatUrl: "https://lifeos.tailnet.example.ts.net/mobile/chat",
    mobilePairUrl: "https://lifeos.tailnet.example.ts.net/mobile/install/bind_demo",
    secure: true,
    stability: "stable",
    requiresRestart: true,
    restartInstruction: "LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://lifeos.tailnet.example.ts.net",
    envTemplate: "LIFEOS_ALLOW_PUBLIC=1\nLIFEOS_TRUST_PROXY=1\nPUBLIC_BASE_URL=https://lifeos.tailnet.example.ts.net",
    notes: ["Use this after Tailscale HTTPS Serve is running."],
  }, Date.UTC(2026, 5, 23, 0, 0, 0));

  assert.match(packet, /OwnOrbit AI remote connection setup/);
  assert.match(packet, /Generated: 2026-06-23T00:00:00\.000Z/);
  assert.match(packet, /Mode: tailscale/);
  assert.match(packet, /Base URL: https:\/\/lifeos\.tailnet\.example\.ts\.net/);
  assert.match(packet, /Mobile chat URL: https:\/\/lifeos\.tailnet\.example\.ts\.net\/mobile\/chat/);
  assert.match(packet, /Requires restart: yes/);
  assert.match(packet, /LIFEOS_ALLOW_PUBLIC=1/);
  assert.match(packet, /PUBLIC_BASE_URL=https:\/\/lifeos\.tailnet\.example\.ts\.net/);
  assert.match(packet, /Generate a fresh phone pairing QR code/);
  assert.match(packet, /Use this after Tailscale HTTPS Serve is running/);
});
