// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("quick Cloudflare Tunnel timeout terminates the unready process", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-timeout-bin-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-timeout-data-"));
  const cloudflaredPath = path.join(binDir, "cloudflared");

  t.after(async () => {
    await rm(binDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  await writeFile(cloudflaredPath, `#!/bin/sh
trap 'exit 0' TERM INT
while true; do sleep 1; done
`);
  await chmod(cloudflaredPath, 0o755);

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const tunnelManager = await import("./server/cloudflareTunnel.ts");
    let error = "";
    try {
      await tunnelManager.startManagedCloudflareTunnel("4567", 100);
    } catch (caught) {
      error = String(caught?.message || caught);
    }
    process.stdout.write(JSON.stringify({ error, status: tunnelManager.getManagedCloudflareTunnelStatus() }));
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_CLOUDFLARED_BIN: cloudflaredPath,
    },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.match(result.error, /Timed out waiting for cloudflared to create a tunnel URL/);
  assert.equal(result.status.running, false);
  assert.equal(result.status.ready, false);
  assert.equal(result.status.phase, "stopped");
});

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
  const oldName = process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME;
  const oldHostname = process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME;
  const oldCredentials = process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS;

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

  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME = "lifeos-ai";
  process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME = "lifeos.example.com";
  process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS = path.join(dataDir, "missing-credentials.json");

  desktopConfig.saveDesktopRuntimeConfig({
    mode: "cloudflare",
    label: "Cloudflare Named Tunnel",
    baseUrl: "https://lifeos.example.com",
  });

  const stableResult = await tunnelManager.maybeStartConfiguredCloudflareTunnel("4567", 500);
  assert.equal(stableResult.started, false);
  assert.equal(stableResult.reason, "cloudflare_named_tunnel_not_ready");
  assert.equal(stableResult.tunnel.url, "");
  assert.equal(process.env.PUBLIC_BASE_URL, "https://lifeos.example.com");

  const stableRawConfig = await readFile(path.join(dataDir, "desktop-runtime-config.json"), "utf8");
  const stableSavedConfig = JSON.parse(stableRawConfig);
  assert.equal(stableSavedConfig.mode, "cloudflare");
  assert.equal(stableSavedConfig.publicBaseUrl, "https://lifeos.example.com");
  assert.equal(stableSavedConfig.baseUrl, "https://lifeos.example.com");

  await tunnelManager.stopManagedCloudflareTunnel();
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

  await tunnelManager.stopManagedCloudflareTunnel();

  await rm(credentialsFile, { force: true });
  const missingCredentialsStatus = tunnelManager.getCloudflareNamedTunnelStatus();
  assert.equal(missingCredentialsStatus.configured, true);
  assert.equal(missingCredentialsStatus.configExists, true);
  assert.equal(missingCredentialsStatus.credentialsFileExists, false);
  assert.equal(missingCredentialsStatus.ready, false);
  assert.match(missingCredentialsStatus.notes.join("\n"), /credentials JSON file is missing/);
});

test("Cloudflare Named Tunnel config refreshes when desktop restart chooses a new local port", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-port-refresh-bin-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-port-refresh-data-"));
  const credentialsFile = path.join(dataDir, "named-tunnel.json");
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
  t.after(async () => {
    await rm(binDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { readFileSync } = await import("node:fs");
    const { generateCloudflareNamedTunnelConfig, refreshCloudflareNamedTunnelConfigForPort, startConfiguredCloudflareNamedTunnel, stopManagedCloudflareTunnel } = await import("./server/cloudflareTunnel.ts");
    const { saveDesktopRuntimeConfig } = await import("./server/desktopRuntimeConfig.ts");
    generateCloudflareNamedTunnelConfig({
      name: "lifeos-ai",
      hostname: "lifeos.example.com",
      credentialsFile: ${JSON.stringify(credentialsFile)},
      port: "4567",
    });
    delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME;
    delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME;
    delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS;
    const refreshed = refreshCloudflareNamedTunnelConfigForPort("5678");
    const refreshedConfig = readFileSync(${JSON.stringify(path.join(dataDir, "cloudflared-named-tunnel.yml"))}, "utf8");
    saveDesktopRuntimeConfig({ mode: "cloudflare", label: "Cloudflare Named Tunnel", baseUrl: "https://lifeos.example.com" });
    const started = await startConfiguredCloudflareNamedTunnel(1000, "6789");
    const restoredConfig = readFileSync(${JSON.stringify(path.join(dataDir, "cloudflared-named-tunnel.yml"))}, "utf8");
    await stopManagedCloudflareTunnel();
    process.stdout.write(JSON.stringify({ refreshed, refreshedConfig, started, restoredConfig }));
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_PORT: "4567",
      LIFEOS_CLOUDFLARED_BIN: cloudflaredPath,
      LIFEOS_CLOUDFLARE_TUNNEL_NAME: "lifeos-ai",
      LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME: "lifeos.example.com",
      LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS: credentialsFile,
      PUBLIC_BASE_URL: "",
    },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.refreshed.refreshed, true);
  assert.equal(result.refreshed.reason, "cloudflare_named_config_refreshed");
  assert.match(result.refreshedConfig, /service: http:\/\/127\.0\.0\.1:5678/);
  assert.equal(result.started.running, true);
  assert.equal(result.started.kind, "named");
  assert.match(result.restoredConfig, /service: http:\/\/127\.0\.0\.1:6789/);
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
  const { dataDir: activeDataDir } = await import("../server/db.ts");
  t.after(async () => {
    try {
      await tunnelManager.stopManagedCloudflareTunnel();
    } catch {}
  });
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
  process.env.LIFEOS_PORT = "7890";

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
  const refreshedConfig = await readFile(path.join(activeDataDir, "cloudflared-named-tunnel.yml"), "utf8");
  assert.match(refreshedConfig, /service: http:\/\/127\.0\.0\.1:7890/);

  await tunnelManager.stopManagedCloudflareTunnel();
  const stopped = tunnelManager.getManagedCloudflareTunnelStatus();
  assert.equal(stopped.running, false);
  assert.equal(stopped.reconnectScheduledAt, null);
});

async function createQuickTunnelHandoffFixture(t) {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-handoff-bin-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-cloudflared-handoff-data-"));
  const stateDir = path.join(dataDir, "fake-cli-state");
  const credentialsFile = path.join(dataDir, "named-tunnel.json");
  t.after(async () => {
    const pids = await readFile(path.join(stateDir, "cloudflared-pids"), "utf8")
      .then((value) => value.split("\n").filter(Boolean))
      .catch(() => []);
    for (const pid of pids) {
      try { process.kill(Number(pid), "SIGKILL"); } catch {}
    }
    await rm(binDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });
  await mkdir(stateDir, { recursive: true });
  await writeFile(credentialsFile, "{}");
  const cloudflaredPath = path.join(binDir, "cloudflared");
  await writeFile(cloudflaredPath, `#!/bin/sh
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
  if [ -f "${stateDir}/named-fails" ]; then
    echo "ERR Named Tunnel credentials were rejected" >&2
    exit 3
  fi
  echo "INF Registered tunnel connection" >&2
fi
while true; do sleep 1 & wait $!; done
`);
  const pgrepPath = path.join(binDir, "pgrep");
  await writeFile(pgrepPath, "#!/bin/sh\nexit 1\n");
  await chmod(cloudflaredPath, 0o755);
  await chmod(pgrepPath, 0o755);

  const run = (body, extraEnv = {}) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const tunnels = await import("./server/cloudflareTunnel.ts");
    const { getNetworkDiagnostics } = await import("./server/networkDiagnostics.ts");
    const { getDeviceEndpointsSnapshot, isKnownCandidateOrigin } = await import("./server/deviceEndpoints.ts");
    const retired = [];
    tunnels.setCloudflareQuickTunnelHandoffRetiredHandler((event) => { retired.push(event); });
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (condition, timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !condition()) await sleep(50);
      return condition();
    };
    const endpointUrls = () => getDeviceEndpointsSnapshot("127.0.0.1", { maxAgeMs: 0 }).candidates.map((candidate) => candidate.baseUrl);
    const startQuickThenNamed = async () => {
      const quick = await tunnels.startManagedCloudflareTunnel("4567", 3000);
      tunnels.generateCloudflareNamedTunnelConfig({
        name: "lifeos-ai",
        hostname: "lifeos.example.com",
        credentialsFile: ${JSON.stringify(credentialsFile)},
        port: "4567",
      });
      const named = await tunnels.startConfiguredCloudflareNamedTunnel(3000).catch((error) => ({ error: error.message }));
      return { quick, named };
    };
    const result = await (async () => { ${body} })();
    await tunnels.stopManagedCloudflareTunnel();
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_PORT: "4567",
      LIFEOS_HOST: "127.0.0.1",
      LIFEOS_CLOUDFLARED_BIN: cloudflaredPath,
      LIFEOS_TAILSCALE_BIN: "/definitely/missing/tailscale",
      LIFEOS_ICLOUD_DRIVE_DIR: path.join(dataDir, "no-icloud"),
      LIFEOS_DEVICE_ENDPOINTS_CACHE_MS: "0",
      LIFEOS_ALLOW_PUBLIC: "1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      ...extraEnv,
    },
    encoding: "utf8",
  }));
  return { run, stateDir };
}

test("a Named Tunnel start keeps the quick tunnel it replaced reachable for the handoff window", async (t) => {
  const { run } = await createQuickTunnelHandoffFixture(t);
  const result = run(`
    const { quick, named } = await startQuickThenNamed();
    // What the named start route does once the stable hostname is ready.
    process.env.PUBLIC_BASE_URL = named.url;
    const during = {
      status: tunnels.getManagedCloudflareTunnelStatus(),
      quickAlive: alive(quick.pid),
      candidates: getNetworkDiagnostics().connectionCandidates.map(({ id, baseUrl, priority, stability }) => ({ id, baseUrl, priority, stability })),
      endpoints: endpointUrls(),
      quickOriginKnown: isKnownCandidateOrigin(quick.url, "127.0.0.1"),
      retired: retired.length,
    };
    await waitFor(() => !alive(quick.pid) && retired.length > 0, 8000);
    const after = {
      handoff: tunnels.getManagedCloudflareTunnelStatus().handoff,
      quickAlive: alive(quick.pid),
      namedAlive: alive(named.pid),
      retired,
      endpoints: endpointUrls(),
      quickOriginKnown: isKnownCandidateOrigin(quick.url, "127.0.0.1"),
    };
    return { quick, named, during, after };
  `, { LIFEOS_QUICK_TUNNEL_HANDOFF_MS: "2000" });

  assert.equal(result.quick.url, "https://quick-1-lifeos.trycloudflare.com");
  assert.equal(result.named.kind, "named");
  assert.equal(result.named.url, "https://lifeos.example.com");
  assert.equal(result.named.handoff.running, true);
  assert.equal(result.named.handoff.url, result.quick.url);
  assert.equal(result.named.handoff.pid, result.quick.pid);
  assert.ok(result.named.handoff.expiresAt > result.named.handoff.handoffStartedAt);

  // During the window the quick origin is still a live, lower-ranked entry.
  assert.equal(result.during.quickAlive, true);
  assert.equal(result.during.status.kind, "named");
  const handoffCandidate = result.during.candidates.find((candidate) => candidate.baseUrl === result.quick.url);
  const namedPriority = Math.max(...result.during.candidates
    .filter((candidate) => candidate.baseUrl === result.named.url)
    .map((candidate) => candidate.priority));
  assert.equal(handoffCandidate?.id, "cloudflare-handoff");
  assert.equal(handoffCandidate?.stability, "temporary");
  assert.ok(handoffCandidate.priority < namedPriority);
  assert.deepEqual(result.during.endpoints, [result.named.url, result.quick.url]);
  assert.equal(result.during.quickOriginKnown, true);
  assert.equal(result.during.retired, 0);

  // When the window ends the quick child is stopped and announced as retired.
  assert.equal(result.after.quickAlive, false);
  assert.equal(result.after.namedAlive, true);
  assert.equal(result.after.handoff.running, false);
  assert.deepEqual(result.after.retired, [{ url: result.quick.url, reason: "expired" }]);
  assert.deepEqual(result.after.endpoints, [result.named.url]);
  assert.equal(result.after.quickOriginKnown, false);
});

test("Stop Cloudflare Tunnel also stops a quick tunnel in its handoff window", async (t) => {
  const { run } = await createQuickTunnelHandoffFixture(t);
  const result = run(`
    const { quick, named } = await startQuickThenNamed();
    const handoffBeforeStop = tunnels.getManagedCloudflareTunnelStatus().handoff;
    const stopped = await tunnels.stopManagedCloudflareTunnel();
    return { quick, named, handoffBeforeStop, stopped, quickAlive: alive(quick.pid), namedAlive: alive(named.pid), retired };
  `);
  assert.equal(result.handoffBeforeStop.running, true);
  // Default window: ten minutes.
  assert.ok(result.handoffBeforeStop.expiresAt - result.handoffBeforeStop.handoffStartedAt >= 10 * 60 * 1000 - 1000);
  assert.equal(result.stopped.running, false);
  assert.equal(result.stopped.handoff.running, false);
  assert.equal(result.quickAlive, false);
  assert.equal(result.namedAlive, false);
  // The stop route announces the change itself.
  assert.deepEqual(result.retired, []);
});

test("a quick tunnel that exits during its handoff window clears the slot and is announced", async (t) => {
  const { run } = await createQuickTunnelHandoffFixture(t);
  const result = run(`
    const { quick, named } = await startQuickThenNamed();
    process.env.PUBLIC_BASE_URL = named.url;
    process.kill(quick.pid, "SIGKILL");
    await waitFor(() => retired.length > 0);
    return {
      quick,
      named,
      retired,
      status: tunnels.getManagedCloudflareTunnelStatus(),
      endpoints: endpointUrls(),
    };
  `);
  assert.deepEqual(result.retired, [{ url: result.quick.url, reason: "exited" }]);
  assert.equal(result.status.handoff.running, false);
  assert.equal(result.status.handoff.url, "");
  assert.equal(result.status.kind, "named");
  assert.equal(result.status.running, true);
  // The quick child's exit never leaks into the named tunnel's own state.
  assert.equal(result.status.lastError, "");
  assert.deepEqual(result.endpoints, [result.named.url]);
});

test("a Named Tunnel that never comes up gives the quick tunnel its slot back", async (t) => {
  const { run, stateDir } = await createQuickTunnelHandoffFixture(t);
  await writeFile(path.join(stateDir, "named-fails"), "1");
  const result = run(`
    const { quick, named } = await startQuickThenNamed();
    const restored = tunnels.getManagedCloudflareTunnelStatus();
    // Past the handoff window: a restored quick tunnel is not retired.
    await sleep(900);
    return {
      quick,
      named,
      restored,
      later: tunnels.getManagedCloudflareTunnelStatus(),
      quickAlive: alive(quick.pid),
      retired,
      endpoints: endpointUrls(),
    };
  `, { LIFEOS_QUICK_TUNNEL_HANDOFF_MS: "300" });
  assert.match(result.named.error, /exited before becoming ready/);
  assert.equal(result.restored.kind, "quick");
  assert.equal(result.restored.ready, true);
  assert.equal(result.restored.url, result.quick.url);
  assert.equal(result.restored.pid, result.quick.pid);
  assert.equal(result.restored.handoff.running, false);
  assert.equal(result.later.ready, true);
  assert.equal(result.quickAlive, true);
  assert.deepEqual(result.retired, []);
  assert.ok(result.endpoints.includes(result.quick.url));
});
