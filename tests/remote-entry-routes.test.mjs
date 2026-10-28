// @ts-nocheck
import assert from "node:assert/strict";
import crypto from "node:crypto";
import dns from "node:dns";
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
// The remote health monitor probes the fake tunnel hostnames; every lookup of
// a non-loopback name fails here, so those probes fail fast and never leave
// this machine.
const systemLookup = dns.lookup;
// A test can watch which names the probes look up, and when.
let lookupObserver = null;
dns.lookup = (hostname, options, callback) => {
  if (hostname === "127.0.0.1" || hostname === "localhost") return systemLookup(hostname, options, callback);
  lookupObserver?.(hostname);
  const done = typeof options === "function" ? options : callback;
  process.nextTick(() => done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", hostname })));
};
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
// Clash TUN case is simply the flag being absent. "tailscale-serve-leftover"
// is a Serve rule a previous run left behind, which `serve status` keeps
// reporting while this computer is offline in the Tailnet.
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
  if [ -f "${stateDir}/tailscale-online" ] || [ -f "${stateDir}/tailscale-serve-leftover" ]; then
    echo '{"Web":{"lifeos-mac.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  else
    echo '{}'
  fi
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "--bg" ]; then
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "--https=443" ] && [ "$3" = "off" ]; then
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
const { getManagedCloudflareTunnelStatus, maybeStartConfiguredCloudflareTunnel, stopManagedCloudflareTunnel } = await import("../server/cloudflareTunnel.ts");
const { maybeStartConfiguredTailscaleServe } = await import("../server/networkDiagnostics.ts");
const { runRemoteHealthCheck } = await import("../server/remoteHealthMonitor.ts");
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

// Whether a phone page on `origin` gets its realtime socket upgraded. It never
// authenticates, so the test's own device socket is not replaced.
async function websocketUpgradeAccepted(origin) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/ws`, { origin });
  try {
    return await new Promise((resolve) => {
      socket.once("open", () => resolve(true));
      socket.once("error", () => resolve(false));
      socket.once("close", () => resolve(false));
    });
  } finally {
    socket.terminate();
  }
}

function savedEntry() {
  const config = getDesktopRuntimeConfig();
  return config ? { mode: config.mode, publicBaseUrl: config.publicBaseUrl } : null;
}

function latestAudit(action) {
  return listAuditLogs(200).find((entry) => entry.action === action)?.metadataJson || null;
}

function setFlag(name, on) {
  const flag = path.join(stateDir, name);
  if (on) writeFileSync(flag, "1");
  else rmSync(flag, { force: true });
}

function setTailscaleOnline(online) {
  setFlag("tailscale-online", online);
}

async function resetRemoteState() {
  await stopManagedCloudflareTunnel();
  for (const key of RUNTIME_KEYS) delete process.env[key];
  setTailscaleOnline(false);
  setFlag("tailscale-serve-leftover", false);
}

async function configureNamedTunnel() {
  const config = await adminRequest("POST", "/api/v1/admin/cloudflare-named-tunnel/config", {
    name: "lifeos-ai",
    hostname: "lifeos.example.com",
    credentialsFile,
  });
  assert.equal(config.status, 200, JSON.stringify(config.body));
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
  // The last tunnel started owns the runtime address, but the live stable
  // Serve still ranks first: new QR codes use it, and a phone on the quick
  // origin is offered the move to it.
  assert.equal(process.env.PUBLIC_BASE_URL, quickUrl);
  assert.deepEqual(await deviceEndpointUrls(), [TAILSCALE_URL, quickUrl]);
  const pairingWhileQuickRuns = await adminRequest("POST", "/api/v1/devices/bind/start", {});
  assert.equal(pairingWhileQuickRuns.body.baseUrl, TAILSCALE_URL);
  const candidates = started.body.diagnostics.connectionCandidates;
  const quickCandidate = candidates.find((candidate) => candidate.baseUrl === quickUrl);
  const serveCandidate = candidates.find((candidate) => candidate.baseUrl === TAILSCALE_URL);
  assert.equal(quickCandidate.stability, "temporary");
  assert.ok(quickCandidate.priority < serveCandidate.priority);
  assert.equal(started.body.diagnostics.recommendedBaseUrl, TAILSCALE_URL);
  // Serve is live and already the pairing address; no restart is needed.
  assert.equal(serveCandidate.requiresRestart, false);
  assert.equal(started.body.diagnostics.remoteReadiness.status, "ready");
  assert.equal(started.body.diagnostics.remoteReadiness.baseUrl, TAILSCALE_URL);

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
    // A reverse proxy outside this core: live before and after the quick tunnel.
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
    // The kept configured entry gets back what launch gives it; nothing
    // brings the stopped Named Tunnel's hostname back.
    assert.equal(process.env.PUBLIC_BASE_URL, pairsBeforeQuickTunnel || undefined);
    assert.equal(process.env.LIFEOS_TRUST_PROXY, pairsBeforeQuickTunnel ? "1" : undefined);
    assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, pairsBeforeQuickTunnel ? "1" : undefined);
    assert.equal(latestAudit("cloudflare_tunnel_stopped")?.restoredSavedEntryMode, pairsBeforeQuickTunnel ? "configured" : null);
    const after = await adminRequest("POST", "/api/v1/devices/bind/start", {});
    assert.equal(after.body.baseUrl || null, pairsBeforeQuickTunnel);
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
  // ...and a phone whose socket was suspended can reopen it from that origin:
  // cloudflared talks plain HTTP to the core and PUBLIC_BASE_URL is the named
  // hostname now, so only the live candidate list lets it in.
  assert.equal(await websocketUpgradeAccepted(quickUrl), true);
  assert.equal(await websocketUpgradeAccepted(NAMED_URL), true);
  assert.equal(await websocketUpgradeAccepted("https://elsewhere-lifeos.trycloudflare.com"), false);
  assert.equal(await websocketUpgradeAccepted("https://evil.example"), false);

  assert.ok(await waitForMessage((message) => message.type === "endpoints.changed" && message.reason === "cloudflare-quick-handoff-expired", 10000));
  assert.deepEqual(await deviceEndpointUrls(), [NAMED_URL]);
  assert.equal(await healthCorsFor(quickUrl), null);
  assert.equal(await websocketUpgradeAccepted(quickUrl), false);
  assert.equal(latestAudit("cloudflare_quick_tunnel_handoff_retired")?.reason, "expired");
});

test("a phone on a quick tunnel keeps its realtime socket after Tailscale Serve takes the runtime address", async (t) => {
  t.after(resetRemoteState);
  setTailscaleOnline(true);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  delete process.env.PUBLIC_BASE_URL;

  const quick = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(quick.status, 200, JSON.stringify(quick.body));
  const quickUrl = quick.body.tunnel.url;
  const serve = await adminRequest("POST", "/api/v1/admin/tailscale-serve/start");
  assert.equal(serve.status, 200, JSON.stringify(serve.body));
  assert.equal(process.env.PUBLIC_BASE_URL, TAILSCALE_URL);
  assert.deepEqual(await deviceEndpointUrls(), [TAILSCALE_URL, quickUrl]);

  assert.equal(await websocketUpgradeAccepted(quickUrl), true);
  assert.equal(await websocketUpgradeAccepted(TAILSCALE_URL), true);
  assert.equal(await websocketUpgradeAccepted("https://evil.example"), false);
});

test("the remote health monitor leaves a running quick tunnel alone while the saved Tailscale entry is offline", async (t) => {
  t.after(resetRemoteState);
  // The user's setup: Tailscale blocked by a VPN, its old Serve rule still
  // reported, and a quick tunnel started as the way in.
  setTailscaleOnline(false);
  setFlag("tailscale-serve-leftover", true);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const quickUrl = started.body.tunnel.url;

  const result = await runRemoteHealthCheck("schedule");
  assert.equal(result.skipped, false);
  // The live quick URL is what gets checked, and a failed check restores nothing.
  assert.equal(result.report.baseUrl, quickUrl);
  assert.equal(result.recovery.attempted, false);
  assert.equal(result.recovery.recoveryReason, "quick_tunnel_running");
  assert.equal(result.recovery.mode, "cloudflare");
  assert.equal(process.env.PUBLIC_BASE_URL, quickUrl);
  assert.equal(getManagedCloudflareTunnelStatus().url, quickUrl);
  assert.deepEqual(savedEntry(), { mode: "tailscale", publicBaseUrl: TAILSCALE_URL });
  const pairing = await adminRequest("POST", "/api/v1/devices/bind/start", {});
  assert.equal(pairing.body.baseUrl, quickUrl);
  // The admin health summary reads the report for the address it checked,
  // not the dead saved ts.net one.
  const diagnostics = await adminRequest("GET", "/api/v1/admin/network-diagnostics");
  assert.equal(diagnostics.body.remoteHealthSummary.baseUrl, quickUrl);
});

test("while a quick tunnel runs over a live Tailscale Serve the health monitor checks the pairing address", async (t) => {
  t.after(resetRemoteState);
  setTailscaleOnline(true);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const quickUrl = started.body.tunnel.url;

  // New QR codes use ts.net, so that is the address worth checking, and the
  // summary is keyed to the same report instead of reading it as stale.
  const checked = await adminRequest("POST", "/api/v1/admin/network-diagnostics/remote-health");
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  assert.equal(checked.body.report.baseUrl, TAILSCALE_URL);
  assert.equal(checked.body.recovery.recoveryReason, "quick_tunnel_running");
  // The failed check was of Tailscale Serve, so that is what to look at.
  assert.equal(checked.body.recovery.mode, "tailscale");
  assert.equal(checked.body.recovery.recoveryAction, "check-tailscale");
  const summary = checked.body.diagnostics.remoteHealthSummary;
  assert.equal(summary.baseUrl, TAILSCALE_URL);
  assert.notEqual(summary.status, "stale");
  assert.equal(summary.recommendations.includes("refresh-stale-check"), false);
  assert.equal(process.env.PUBLIC_BASE_URL, quickUrl);
  assert.equal(getManagedCloudflareTunnelStatus().url, quickUrl);
});

test("a failed check while a quick tunnel runs names the entry that was checked", async (t) => {
  t.after(resetRemoteState);
  // The quick URL saved as the desktop entry (the connection guide offers it
  // as "Current PUBLIC_BASE_URL"): still a Cloudflare problem, not "nothing to do".
  setTailscaleOnline(false);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  const quick = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(quick.status, 200, JSON.stringify(quick.body));
  const saved = await adminRequest("PUT", "/api/v1/admin/desktop-connection-config", { mode: "configured", baseUrl: quick.body.tunnel.url });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const quickCheck = await adminRequest("POST", "/api/v1/admin/network-diagnostics/remote-health");
  assert.equal(quickCheck.body.report.baseUrl, quick.body.tunnel.url);
  assert.equal(quickCheck.body.recovery.mode, "cloudflare");
  assert.equal(quickCheck.body.recovery.recoveryAction, "check-cloudflare");
  await resetRemoteState();

  // A saved Named Tunnel is down and Tailscale Serve is live: Serve is what
  // gets checked, so a failure is a Tailscale one.
  await configureNamedTunnel();
  setTailscaleOnline(true);
  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const serveCheck = await adminRequest("POST", "/api/v1/admin/network-diagnostics/remote-health");
  assert.equal(serveCheck.body.report.baseUrl, TAILSCALE_URL);
  assert.equal(serveCheck.body.recovery.mode, "tailscale");
  assert.equal(serveCheck.body.recovery.recoveryAction, "check-tailscale");
});

test("a saved Tailscale entry takes the runtime address back once Serve is reachable after a quick tunnel stopped while it was offline", async (t) => {
  t.after(async () => {
    lookupObserver = null;
    await resetRemoteState();
  });
  setTailscaleOnline(false);
  setFlag("tailscale-serve-leftover", true);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const stopped = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/stop");
  assert.equal(stopped.status, 200);
  assert.equal(process.env.PUBLIC_BASE_URL, undefined);
  assert.equal(process.env.LIFEOS_TRUST_PROXY, undefined);

  const offline = await runRemoteHealthCheck("schedule");
  assert.equal(offline.recovery.recoveryReason, "restore_failed");
  assert.equal(process.env.PUBLIC_BASE_URL, undefined);

  // Back online, the check of ts.net passes in real life, and restore only
  // follows a failed one, so the address must already be back when the probe
  // runs. The probes here never resolve, so watch when they look ts.net up.
  setTailscaleOnline(true);
  const atProbe = [];
  lookupObserver = (hostname) => {
    if (hostname === new URL(TAILSCALE_URL).hostname) atProbe.push(process.env.PUBLIC_BASE_URL);
  };
  const online = await runRemoteHealthCheck("schedule");
  assert.equal(atProbe[0], TAILSCALE_URL);
  assert.equal(online.recovery.restored, true);
  assert.equal(process.env.PUBLIC_BASE_URL, TAILSCALE_URL);
  assert.equal(process.env.LIFEOS_TRUST_PROXY, "1");
  assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, "1");
  const diagnostics = await adminRequest("GET", "/api/v1/admin/network-diagnostics");
  assert.equal(diagnostics.body.remoteReadiness.status, "ready");
  const serveCandidate = diagnostics.body.connectionCandidates.find((candidate) => candidate.baseUrl === TAILSCALE_URL);
  assert.equal(serveCandidate.requiresRestart, false);
});

test("Tailscale Serve the admin stopped is not taken back by the health monitor", async (t) => {
  t.after(resetRemoteState);
  setTailscaleOnline(true);
  useSavedRemoteEntry({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  const stopped = await adminRequest("POST", "/api/v1/admin/tailscale-serve/stop");
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal(savedEntry().mode, "local");
  assert.equal(process.env.PUBLIC_BASE_URL, undefined);

  await runRemoteHealthCheck("schedule");
  assert.equal(process.env.PUBLIC_BASE_URL, undefined);
  assert.equal(process.env.LIFEOS_TRUST_PROXY, undefined);

  // Saving the entry again (as a later Start would) does not bring back the
  // proxy trust this stop dropped: it was the entry that stopped.
  saveDesktopRuntimeConfig({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  await runRemoteHealthCheck("schedule");
  assert.equal(process.env.PUBLIC_BASE_URL, TAILSCALE_URL);
  assert.equal(process.env.LIFEOS_TRUST_PROXY, undefined);
  assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, undefined);
});

test("the startup Cloudflare autostart does not start a saved Named Tunnel over a running quick tunnel", async (t) => {
  t.after(resetRemoteState);
  await configureNamedTunnel();
  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const quickUrl = started.body.tunnel.url;

  // What server.ts runs about 16 s after listen; a slow first restore by the
  // monitor can leave the admin time to start a quick tunnel before it.
  const autostart = await maybeStartConfiguredCloudflareTunnel("4567", 5000);
  assert.equal(autostart.started, false);
  assert.equal(autostart.reason, "quick_tunnel_running");
  const tunnel = getManagedCloudflareTunnelStatus();
  assert.equal(tunnel.kind, "quick");
  assert.equal(tunnel.running, true);
  assert.equal(tunnel.url, quickUrl);
  assert.equal(tunnel.handoff.running, false);
  assert.equal(process.env.PUBLIC_BASE_URL, quickUrl);
});

test("Tailscale Serve autostart only takes the runtime address while Serve is reachable", async (t) => {
  t.after(resetRemoteState);
  setTailscaleOnline(false);
  setFlag("tailscale-serve-leftover", true);
  saveDesktopRuntimeConfig({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  process.env.PUBLIC_BASE_URL = "https://quick-live-lifeos.trycloudflare.com";

  // The leftover rule is still reported, but this computer is offline.
  assert.throws(() => maybeStartConfiguredTailscaleServe("4567"), /not online/);
  assert.equal(process.env.PUBLIC_BASE_URL, "https://quick-live-lifeos.trycloudflare.com");

  setTailscaleOnline(true);
  const restored = maybeStartConfiguredTailscaleServe("4567");
  assert.equal(restored.reason, "already_running");
  assert.equal(process.env.PUBLIC_BASE_URL, TAILSCALE_URL);
});

test("the remote health monitor does not start a saved Named Tunnel over a running quick tunnel", async (t) => {
  t.after(resetRemoteState);
  await configureNamedTunnel();
  const started = await adminRequest("POST", "/api/v1/admin/cloudflare-tunnel/start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.keptSavedEntryMode, "cloudflare");
  const quickUrl = started.body.tunnel.url;

  const result = await runRemoteHealthCheck("schedule");
  assert.equal(result.recovery.attempted, false);
  assert.equal(result.recovery.started, false);
  const tunnel = getManagedCloudflareTunnelStatus();
  assert.equal(tunnel.kind, "quick");
  assert.equal(tunnel.running, true);
  assert.equal(tunnel.url, quickUrl);
  assert.equal(tunnel.handoff.running, false);
  assert.equal(process.env.PUBLIC_BASE_URL, quickUrl);
});

test("with no quick tunnel running the remote health monitor still restores the saved entry", async (t) => {
  t.after(resetRemoteState);
  // Saved Named Tunnel that is not running: the monitor starts it.
  await configureNamedTunnel();
  const named = await runRemoteHealthCheck("schedule");
  assert.equal(named.recovery.mode, "cloudflare");
  assert.equal(named.recovery.attempted, true);
  assert.equal(named.recovery.started, true);
  assert.equal(named.recovery.recoveryReason, "cloudflare_named_configured");
  assert.equal(getManagedCloudflareTunnelStatus().kind, "named");
  assert.equal(process.env.PUBLIC_BASE_URL, NAMED_URL);
  await resetRemoteState();

  // Saved Tailscale Serve that is reachable again: it takes the address back.
  setTailscaleOnline(true);
  saveDesktopRuntimeConfig({ mode: "tailscale", label: "Tailscale HTTPS Serve", baseUrl: TAILSCALE_URL });
  const tailscale = await runRemoteHealthCheck("schedule");
  assert.equal(tailscale.recovery.mode, "tailscale");
  assert.equal(tailscale.recovery.restored, true);
  assert.equal(tailscale.recovery.recoveryReason, "already_running");
  assert.equal(process.env.PUBLIC_BASE_URL, TAILSCALE_URL);
  // Restoring a saved entry is not a public opt-in: only a quick tunnel stop
  // that dropped the flags gives them back (see the offline-stop test).
  assert.equal(process.env.LIFEOS_ALLOW_PUBLIC, undefined);
  assert.equal(process.env.LIFEOS_TRUST_PROXY, undefined);
});
