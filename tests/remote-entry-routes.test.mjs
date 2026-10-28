// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { WebSocket } from "ws";

// The admin, device and core routes run in this process against fake
// cloudflared/tailscale CLIs and a throwaway data directory; nothing here may
// reach the real CLIs, iCloud Drive or a running OwnOrbit core.
const rootDir = mkdtempSync(path.join(tmpdir(), "lifeos-remote-entry-routes-"));
const binDir = path.join(rootDir, "bin");
const dataDir = path.join(rootDir, "data");
const stateDir = path.join(rootDir, "state");
for (const dir of [binDir, dataDir, stateDir]) mkdirSync(dir, { recursive: true });
const credentialsFile = path.join(rootDir, "named-tunnel.json");
writeFileSync(credentialsFile, "{}");

const TAILSCALE_URL = "https://lifeos-mac.tailnet.example.ts.net";
const NAMED_URL = "https://lifeos.example.com";

writeFileSync(path.join(binDir, "cloudflared"), `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "cloudflared version 2026.6.0"
  exit 0
fi
echo "$$" >> "${stateDir}/cloudflared-pids"
trap 'exit 0' TERM INT
if [ "$2" = "--url" ]; then
  count=$(cat "${stateDir}/quick-count" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "${stateDir}/quick-count"
  echo "INF Requesting new quick Tunnel on https://quick-$count-lifeos.trycloudflare.com" >&2
else
  echo "INF Registered tunnel connection" >&2
fi
while true; do sleep 1 & wait $!; done
`);
// Tailscale is up only while the "tailscale-online" flag exists — the user's
// Clash TUN case is simply the flag being absent.
writeFileSync(path.join(binDir, "tailscale"), `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  if [ -f "${stateDir}/tailscale-online" ]; then
    echo '{"Self":{"Online":true,"HostName":"lifeos-mac","DNSName":"lifeos-mac.tailnet.example.ts.net.","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  else
    echo '{"Self":{"Online":false,"HostName":"lifeos-mac","DNSName":"lifeos-mac.tailnet.example.ts.net.","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  fi
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  if [ -f "${stateDir}/tailscale-online" ]; then
    echo '{"Web":{"lifeos-mac.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  else
    echo '{}'
  fi
  exit 0
fi
exit 1
`);
writeFileSync(path.join(binDir, "pgrep"), "#!/bin/sh\nexit 1\n");
for (const name of ["cloudflared", "tailscale", "pgrep"]) chmodSync(path.join(binDir, name), 0o755);

const RUNTIME_KEYS = ["PUBLIC_BASE_URL", "APP_URL", "LIFEOS_ALLOW_PUBLIC", "LIFEOS_TRUST_PROXY", "LIFEOS_QUICK_TUNNEL_HANDOFF_MS"];
for (const key of RUNTIME_KEYS) delete process.env[key];
Object.assign(process.env, {
  PATH: `${binDir}:${process.env.PATH || ""}`,
  LIFEOS_DATA_DIR: dataDir,
  LIFEOS_PORT: "4567",
  LIFEOS_HOST: "127.0.0.1",
  LIFEOS_CLOUDFLARED_BIN: path.join(binDir, "cloudflared"),
  LIFEOS_TAILSCALE_BIN: path.join(binDir, "tailscale"),
  LIFEOS_ICLOUD_DRIVE_DIR: path.join(rootDir, "no-icloud-drive"),
  LIFEOS_DEVICE_ENDPOINTS_CACHE_MS: "0",
});

const { runMigrations } = await import("../server/migrations.ts");
runMigrations();
const { createAdminCredential, createAdminSession } = await import("../server/auth.ts");
const { listAuditLogs } = await import("../server/audit.ts");
const { insertDevice } = await import("../server/devices.ts");
const { tokenHash } = await import("../server/security.ts");
const { getDesktopRuntimeConfig, saveDesktopRuntimeConfig } = await import("../server/desktopRuntimeConfig.ts");
const { maybeBroadcastDeviceEndpointsChange } = await import("../server/deviceEndpoints.ts");
const { stopManagedCloudflareTunnel } = await import("../server/cloudflareTunnel.ts");
const { registerAdminRoutes } = await import("../server/routes/adminRoutes.ts");
const { registerCoreRoutes } = await import("../server/routes/coreRoutes.ts");
const { registerDeviceRoutes } = await import("../server/routes/deviceRoutes.ts");
const { attachRealtimeServer } = await import("../server/realtime.ts");

createAdminCredential("Correct-Horse-Battery-9-Staple!", { auditAction: false });
const adminSession = createAdminSession();
const deviceId = crypto.randomUUID();
const deviceToken = "remote-entry-routes-device-token";
insertDevice({
  id: deviceId,
  name: "Test phone",
  type: "mobile",
  status: "offline",
  accessTokenHash: tokenHash(deviceToken),
  createdAt: Date.now(),
  lastSeenAt: Date.now(),
});

const app = express();
app.use(express.json());
registerCoreRoutes(app, "127.0.0.1");
registerAdminRoutes(app);
registerDeviceRoutes(app, "127.0.0.1");
const server = http.createServer(app);
attachRealtimeServer(server);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await stopManagedCloudflareTunnel().catch(() => null);
  await new Promise((resolve) => server.close(resolve));
  const pidsFile = path.join(stateDir, "cloudflared-pids");
  const pids = existsSync(pidsFile) ? readFileSync(pidsFile, "utf8").split("\n").filter(Boolean) : [];
  for (const pid of pids) {
    try { process.kill(Number(pid), "SIGKILL"); } catch {}
  }
  rmSync(rootDir, { recursive: true, force: true });
});

async function adminRequest(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { authorization: `Bearer ${adminSession.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function deviceEndpointUrls() {
  const response = await fetch(`${baseUrl}/api/v1/devices/me/endpoints`, {
    headers: { "x-lifeos-device-id": deviceId, "x-lifeos-device-token": deviceToken },
  });
  const body = await response.json();
  return body.candidates.map((candidate) => candidate.baseUrl);
}

async function healthCorsFor(origin) {
  const response = await fetch(`${baseUrl}/api/v1/health`, { headers: { origin } });
  await response.arrayBuffer();
  return response.headers.get("access-control-allow-origin");
}

function savedEntry() {
  const config = getDesktopRuntimeConfig();
  return config ? { mode: config.mode, publicBaseUrl: config.publicBaseUrl } : null;
}

function latestAudit(action) {
  return listAuditLogs(200).find((entry) => entry.action === action)?.metadataJson || null;
}

function setTailscaleOnline(online) {
  const flag = path.join(stateDir, "tailscale-online");
  if (online) writeFileSync(flag, "1");
  else rmSync(flag, { force: true });
}

async function resetRemoteState() {
  await stopManagedCloudflareTunnel();
  for (const key of RUNTIME_KEYS) delete process.env[key];
  setTailscaleOnline(false);
}

function useSavedRemoteEntry(entry) {
  saveDesktopRuntimeConfig(entry);
  // What desktop/main.cjs restores at launch for a saved remote entry.
  process.env.PUBLIC_BASE_URL = entry.baseUrl;
  process.env.LIFEOS_ALLOW_PUBLIC = "1";
  process.env.LIFEOS_TRUST_PROXY = "1";
}

test("a quick tunnel started while the saved Tailscale entry is down keeps that entry and pairs over the quick URL", async (t) => {
  t.after(resetRemoteState);
  setTailscaleOnline(false);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });

  // The dead saved entry is never offered for pairing.
  const blocked = await adminRequest("POST", "/api/v1/devices/bind/start", {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "no_phone_reachable_entry");

  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const quickUrl = started.body.tunnel.url;
  assert.match(quickUrl, /^https:\/\/quick-\d+-lifeos\.trycloudflare\.com$/);
  assert.equal(started.body.keptSavedEntryMode, "tailscale");
  assert.equal(started.body.config.mode, "tailscale");
  assert.deepEqual(savedEntry(), { mode: "tailscale", publicBaseUrl: TAILSCALE_URL });
  assert.equal(process.env.PUBLIC_BASE_URL, quickUrl);
  assert.equal(latestAudit("cloudflare_tunnel_started")?.keptSavedEntryMode, "tailscale");
  assert.equal(started.body.diagnostics.connectionCandidates.some((candidate) => candidate.baseUrl === TAILSCALE_URL), false);

  const pairing = await adminRequest("POST", "/api/v1/devices/bind/start", {});
  assert.equal(pairing.status, 200, JSON.stringify(pairing.body));
  assert.equal(pairing.body.baseUrl, quickUrl);
  assert.equal(pairing.body.pairingUrl.startsWith(`${quickUrl}/`), true);

  const stopped = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/stop");
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.clearedActiveEntry, true);
  assert.equal(stopped.body.config, null);
  assert.equal(stopped.body.keptSavedEntryMode, "tailscale");
  assert.deepEqual(savedEntry(), { mode: "tailscale", publicBaseUrl: TAILSCALE_URL });
  // Serve is still down, so nothing takes the runtime entry over.
  assert.equal(process.env.PUBLIC_BASE_URL, undefined);
  assert.equal(process.env.LIFEOS_TRUST_PROXY, undefined);
  assert.equal(latestAudit("cloudflare_tunnel_stopped")?.survivingEntryMode, null);
});

test("stopping a quick tunnel hands the runtime entry back to a live saved Tailscale Serve", async (t) => {
  t.after(resetRemoteState);
  setTailscaleOnline(true);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });

  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const quickUrl = started.body.tunnel.url;
  assert.equal(started.body.keptSavedEntryMode, "tailscale");
  assert.deepEqual(savedEntry(), { mode: "tailscale", publicBaseUrl: TAILSCALE_URL });
  // The last tunnel started owns the runtime address; Serve stays a candidate.
  assert.equal(process.env.PUBLIC_BASE_URL, quickUrl);
  assert.deepEqual(await deviceEndpointUrls(), [quickUrl, TAILSCALE_URL]);

  const stopped = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/stop");
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.config, null);
  assert.equal(process.env.PUBLIC_BASE_URL, TAILSCALE_URL);
  assert.equal(process.env.LIFEOS_TRUST_PROXY, "1");
  assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, "1");
  assert.deepEqual(savedEntry(), { mode: "tailscale", publicBaseUrl: TAILSCALE_URL });
  assert.equal(latestAudit("cloudflare_tunnel_stopped")?.survivingEntryMode, "tailscale");

  const pairing = await adminRequest("POST", "/api/v1/devices/bind/start", {});
  assert.equal(pairing.body.baseUrl, TAILSCALE_URL);
});

test("a saved Named Tunnel or configured HTTPS entry survives a quick tunnel start and stop", async (t) => {
  t.after(resetRemoteState);
  for (const { entry, pairsBeforeQuickTunnel } of [
    // The Named Tunnel is not running here, so its saved hostname is dead.
    { entry: { mode: "cloudflare", label: "Cloudflare Named Tunnel", baseUrl: NAMED_URL }, pairsBeforeQuickTunnel: null },
    { entry: { mode: "configured", label: "Trusted HTTPS entry", baseUrl: "https://orbit.example.com" }, pairsBeforeQuickTunnel: "https://orbit.example.com" },
  ]) {
    useSavedRemoteEntry(entry);
    const before = await adminRequest("POST", "/api/v1/devices/bind/start", {});
    assert.equal(before.body.baseUrl || null, pairsBeforeQuickTunnel);
    const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.keptSavedEntryMode, entry.mode);
    assert.deepEqual(savedEntry(), { mode: entry.mode, publicBaseUrl: entry.baseUrl });
    assert.equal(process.env.PUBLIC_BASE_URL, started.body.tunnel.url);
    assert.equal(latestAudit("cloudflare_tunnel_started")?.keptSavedEntryMode, entry.mode);
    const pairing = await adminRequest("POST", "/api/v1/devices/bind/start", {});
    assert.equal(pairing.body.baseUrl, started.body.tunnel.url);

    const stopped = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/stop");
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.config, null);
    assert.equal(stopped.body.keptSavedEntryMode, entry.mode);
    assert.deepEqual(savedEntry(), { mode: entry.mode, publicBaseUrl: entry.baseUrl });
    await resetRemoteState();
  }

  // A saved local-only entry has nothing to protect: the quick URL is saved.
  saveDesktopRuntimeConfig({ mode: "local", label: "Local management", baseUrl: "http://127.0.0.1:4567" });
  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.body.keptSavedEntryMode, null);
  assert.deepEqual(savedEntry(), { mode: "cloudflare", publicBaseUrl: started.body.tunnel.url });
  const stopped = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/stop");
  assert.equal(stopped.body.config.mode, "local");
  assert.equal(savedEntry().mode, "local");
});

test("a Named Tunnel started over a quick tunnel announces the new hostname and keeps the quick origin usable until it retires", async (t) => {
  t.after(resetRemoteState);
  process.env.LIFEOS_QUICK_TUNNEL_HANDOFF_MS = "3000";

  const messages = [];
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/ws`);
  t.after(() => socket.close());
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ type: "auth", deviceId, accessToken: deviceToken }));
  const waitForMessage = async (predicate, timeoutMs = 5000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  };
  assert.ok(await waitForMessage((message) => message.type === "auth.ok"));

  const config = await adminRequest("POST", "/api/v1/admin/cloudflare-named-tunnel/config", {
    name: "lifeos-ai",
    hostname: "lifeos.example.com",
    credentialsFile,
  });
  assert.equal(config.status, 200, JSON.stringify(config.body));

  const quick = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(quick.status, 200, JSON.stringify(quick.body));
  const quickUrl = quick.body.tunnel.url;
  assert.equal(quick.body.keptSavedEntryMode, "cloudflare");
  assert.deepEqual(await deviceEndpointUrls(), [quickUrl]);
  maybeBroadcastDeviceEndpointsChange("test-baseline");
  messages.length = 0;

  const named = await adminRequest("POST", "/api/v1/admin/cloudflare-named-tunnel/start");
  assert.equal(named.status, 200, JSON.stringify(named.body));
  assert.equal(named.body.tunnel.kind, "named");
  assert.equal(named.body.tunnel.handoff.url, quickUrl);
  assert.equal(process.env.PUBLIC_BASE_URL, NAMED_URL);
  assert.ok(await waitForMessage((message) => message.type === "endpoints.changed" && message.reason === "cloudflare-named-tunnel-started"));

  // A phone still on the quick origin can learn the hostname and verify it.
  assert.deepEqual(await deviceEndpointUrls(), [NAMED_URL, quickUrl]);
  assert.equal(await healthCorsFor(quickUrl), quickUrl);
  assert.equal(await healthCorsFor(NAMED_URL), NAMED_URL);

  assert.ok(await waitForMessage((message) => message.type === "endpoints.changed" && message.reason === "cloudflare-quick-handoff-expired", 10000));
  assert.deepEqual(await deviceEndpointUrls(), [NAMED_URL]);
  assert.equal(await healthCorsFor(quickUrl), null);
  assert.equal(latestAudit("cloudflare_quick_tunnel_handoff_retired")?.reason, "expired");
});
