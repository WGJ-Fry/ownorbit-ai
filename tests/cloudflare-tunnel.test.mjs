// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("configured Cloudflare Tunnel autostarts and refreshes the public base URL", async (t) => {
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
  assert.equal(result.started, true);
  assert.equal(result.tunnel.url, "https://fresh-lifeos.trycloudflare.com");
  assert.equal(process.env.PUBLIC_BASE_URL, "https://fresh-lifeos.trycloudflare.com");

  const rawConfig = await readFile(path.join(dataDir, "desktop-runtime-config.json"), "utf8");
  const savedConfig = JSON.parse(rawConfig);
  assert.equal(savedConfig.mode, "cloudflare");
  assert.equal(savedConfig.publicBaseUrl, "https://fresh-lifeos.trycloudflare.com");
  assert.equal(savedConfig.baseUrl, "https://fresh-lifeos.trycloudflare.com");

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
  assert.equal(generated.baseUrl, "https://lifeos.example.com");
  assert.match(generated.config, /hostname: lifeos\.example\.com/);
  assert.match(generated.config, /service: http:\/\/127\.0\.0\.1:4567/);

  const started = await tunnelManager.maybeStartConfiguredCloudflareTunnel("4567", 1000);
  assert.equal(started.reason, "cloudflare_named_configured");
  assert.equal(started.tunnel.url, "https://lifeos.example.com");
  assert.equal(process.env.PUBLIC_BASE_URL, "https://lifeos.example.com");

  tunnelManager.stopManagedCloudflareTunnel();
});
