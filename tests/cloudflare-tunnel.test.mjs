// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("configured quick Cloudflare Tunnel is not treated as restart-stable", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-bin-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-data-"));
  const oldPath = process.env.PATH || "";
  const oldDataDir = process.env.LIFEOS_DATA_DIR;
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldDisableAutostart = process.env.LIFEOS_DISABLE_CLOUDFLARE_AUTOSTART;
  const oldAutostart = process.env.LIFEOS_CLOUDFLARE_AUTOSTART;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldDataDir === undefined) delete process.env.LIFEOS_DATA_DIR;
    else process.env.LIFEOS_DATA_DIR = oldDataDir;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldDisableAutostart === undefined) delete process.env.LIFEOS_DISABLE_CLOUDFLARE_AUTOSTART;
    else process.env.LIFEOS_DISABLE_CLOUDFLARE_AUTOSTART = oldDisableAutostart;
    if (oldAutostart === undefined) delete process.env.LIFEOS_CLOUDFLARE_AUTOSTART;
    else process.env.LIFEOS_CLOUDFLARE_AUTOSTART = oldAutostart;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    await rm(binDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  const cloudflaredPath = path.join(binDir, "cloudflared");
  await writeFile(cloudflaredPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "cloudflared version 2026.6.0"
  exit 0
fi
echo "INF Requesting new quick Tunnel on https://fresh-lifeos.trycloudflare.com" >&2
while true; do sleep 1; done
`);
  await chmod(cloudflaredPath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_DATA_DIR = dataDir;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;
  process.env.PUBLIC_BASE_URL = "https://stale-lifeos.trycloudflare.com";
  delete process.env.LIFEOS_DISABLE_CLOUDFLARE_AUTOSTART;
  delete process.env.LIFEOS_CLOUDFLARE_AUTOSTART;

  const cacheKey = Date.now();
  const desktopConfig = await import(`../server/desktopRuntimeConfig.ts?cloudflare-autostart-config=${cacheKey}`);
  const tunnelManager = await import(`../server/cloudflareTunnel.ts?cloudflare-autostart=${cacheKey}`);

  desktopConfig.saveDesktopRuntimeConfig({
    mode: "cloudflare",
    label: "Cloudflare Tunnel",
    baseUrl: "https://stale-lifeos.trycloudflare.com",
  });

  const result = await tunnelManager.maybeStartConfiguredCloudflareTunnel("4567", 1500);
  assert.equal(result.started, false);
  assert.equal(result.reason, "temporary_quick_tunnel_not_restored");
  assert.equal(result.tunnel.url, "");
  assert.equal(process.env.PUBLIC_BASE_URL, "https://stale-lifeos.trycloudflare.com");

  const rawConfig = await readFile(path.join(dataDir, "desktop-runtime-config.json"), "utf8");
  const savedConfig = JSON.parse(rawConfig);
  assert.equal(savedConfig.mode, "cloudflare");
  assert.equal(savedConfig.publicBaseUrl, "https://stale-lifeos.trycloudflare.com");
  assert.equal(savedConfig.baseUrl, "https://stale-lifeos.trycloudflare.com");

  tunnelManager.stopManagedCloudflareTunnel();
});

test("Cloudflare Named Tunnel config is generated and autostarted as a stable entry", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-named-bin-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-named-data-"));
  const credentialsFile = path.join(dataDir, "named-tunnel.json");
  const oldDataDir = process.env.LIFEOS_DATA_DIR;
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldName = process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME;
  const oldHostname = process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME;
  const oldCredentials = process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS;

  t.after(async () => {
    if (oldDataDir === undefined) delete process.env.LIFEOS_DATA_DIR;
    else process.env.LIFEOS_DATA_DIR = oldDataDir;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldName === undefined) delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME;
    else process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME = oldName;
    if (oldHostname === undefined) delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME;
    else process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME = oldHostname;
    if (oldCredentials === undefined) delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS;
    else process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS = oldCredentials;
    await rm(binDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  const cloudflaredPath = path.join(binDir, "cloudflared");
  await writeFile(cloudflaredPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "cloudflared version 2026.6.0"
  exit 0
fi
echo "INF Registered tunnel connection" >&2
while true; do sleep 1; done
`);
  await chmod(cloudflaredPath, 0o755);
  await writeFile(credentialsFile, "{}");

  process.env.LIFEOS_DATA_DIR = dataDir;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;
  process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME = "lifeos-ai";
  process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME = "lifeos.example.com";
  process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS = credentialsFile;
  delete process.env.PUBLIC_BASE_URL;

  const cacheKey = Date.now();
  const tunnelManager = await import(`../server/cloudflareTunnel.ts?cloudflare-named=${cacheKey}`);
  const generated = tunnelManager.generateCloudflareNamedTunnelConfig({});
  assert.equal(generated.ready, true);
  assert.equal(generated.settingsSaved, true);
  assert.equal(generated.credentialsFileExists, true);
  assert.equal(generated.baseUrl, "https://lifeos.example.com");
  assert.match(generated.config, /hostname: lifeos\.example\.com/);
  assert.match(generated.config, /service: http:\/\/127\.0\.0\.1:4567/);

  delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME;
  delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME;
  delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS;
  const persistedStatus = tunnelManager.getCloudflareNamedTunnelStatus();
  assert.equal(persistedStatus.configured, true);
  assert.equal(persistedStatus.ready, true);
  assert.equal(persistedStatus.settingsSaved, true);
  assert.equal(persistedStatus.credentialsFileExists, true);
  assert.equal(persistedStatus.name, "lifeos-ai");
  assert.equal(persistedStatus.hostname, "lifeos.example.com");
  assert.equal(persistedStatus.credentialsFile, "[configured]");

  const started = await tunnelManager.maybeStartConfiguredCloudflareTunnel("4567", 1000);
  assert.equal(started.reason, "cloudflare_named_configured");
  assert.equal(started.tunnel.url, "https://lifeos.example.com");
  assert.equal(process.env.PUBLIC_BASE_URL, "https://lifeos.example.com");

  tunnelManager.stopManagedCloudflareTunnel();

  await rm(credentialsFile, { force: true });
  const missingCredentialsStatus = tunnelManager.getCloudflareNamedTunnelStatus();
  assert.equal(missingCredentialsStatus.configured, true);
  assert.equal(missingCredentialsStatus.configExists, true);
  assert.equal(missingCredentialsStatus.credentialsFileExists, false);
  assert.equal(missingCredentialsStatus.ready, false);
  assert.match(missingCredentialsStatus.notes.join("\n"), /credentials JSON file is missing/);
});

test("Cloudflare Named Tunnel reconnects automatically after an unexpected disconnect", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-reconnect-bin-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-reconnect-data-"));
  const credentialsFile = path.join(dataDir, "named-tunnel.json");
  const countFile = path.join(dataDir, "cloudflared-count");
  const oldDataDir = process.env.LIFEOS_DATA_DIR;
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldReconnectDelay = process.env.LIFEOS_CLOUDFLARE_RECONNECT_DELAY_MS;

  t.after(async () => {
    if (oldDataDir === undefined) delete process.env.LIFEOS_DATA_DIR;
    else process.env.LIFEOS_DATA_DIR = oldDataDir;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldReconnectDelay === undefined) delete process.env.LIFEOS_CLOUDFLARE_RECONNECT_DELAY_MS;
    else process.env.LIFEOS_CLOUDFLARE_RECONNECT_DELAY_MS = oldReconnectDelay;
    await rm(binDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  const cloudflaredPath = path.join(binDir, "cloudflared");
  await writeFile(cloudflaredPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "cloudflared version 2026.6.0"
  exit 0
fi
count=0
if [ -f "${countFile}" ]; then
  count=$(cat "${countFile}")
fi
count=$((count + 1))
echo "$count" > "${countFile}"
echo "INF Registered tunnel connection attempt $count" >&2
if [ "$count" = "1" ]; then
  sleep 0.2
  exit 12
fi
while true; do sleep 1; done
`);
  await chmod(cloudflaredPath, 0o755);
  await writeFile(credentialsFile, "{}");

  process.env.LIFEOS_DATA_DIR = dataDir;
  process.env.LIFEOS_PORT = "4568";
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;
  process.env.LIFEOS_CLOUDFLARE_RECONNECT_DELAY_MS = "100";
  delete process.env.PUBLIC_BASE_URL;

  const cacheKey = Date.now();
  const tunnelManager = await import(`../server/cloudflareTunnel.ts?cloudflare-named-reconnect=${cacheKey}`);
  tunnelManager.generateCloudflareNamedTunnelConfig({
    name: "lifeos-ai",
    hostname: "lifeos.example.com",
    credentialsFile,
  });
  let reconnectNotification = null;
  tunnelManager.setCloudflareTunnelReconnectHandler((status) => {
    reconnectNotification = status;
  });

  const started = await tunnelManager.startConfiguredCloudflareNamedTunnel(1000);
  assert.equal(started.running, true);
  assert.equal(started.kind, "named");

  const deadline = Date.now() + 2500;
  let status = tunnelManager.getManagedCloudflareTunnelStatus();
  while (Date.now() < deadline) {
    status = tunnelManager.getManagedCloudflareTunnelStatus();
    if (status.running && status.reconnectAttempts >= 1 && status.lastOutput.includes("attempt 2") && reconnectNotification) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.equal(status.running, true);
  assert.equal(status.kind, "named");
  assert.equal(status.url, "https://lifeos.example.com");
  assert.equal(status.reconnectAttempts, 1);
  assert.match(status.lastOutput, /attempt 2/);
  assert.equal(reconnectNotification?.url, "https://lifeos.example.com");
  assert.equal(reconnectNotification?.kind, "named");
  assert.equal(await readFile(countFile, "utf8"), "2\n");

  tunnelManager.stopManagedCloudflareTunnel();
  const stopped = tunnelManager.getManagedCloudflareTunnelStatus();
  assert.equal(stopped.running, false);
  assert.equal(stopped.reconnectScheduledAt, null);
});
