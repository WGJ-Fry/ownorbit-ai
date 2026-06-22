// @ts-nocheck
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

test("network diagnostics detects mocked Cloudflare and Tailscale CLIs", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-network-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldHost = process.env.LIFEOS_HOST;
  const oldAllowPublic = process.env.LIFEOS_ALLOW_PUBLIC;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldHost === undefined) delete process.env.LIFEOS_HOST;
    else process.env.LIFEOS_HOST = oldHost;
    if (oldAllowPublic === undefined) delete process.env.LIFEOS_ALLOW_PUBLIC;
    else process.env.LIFEOS_ALLOW_PUBLIC = oldAllowPublic;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    await rm(binDir, { recursive: true, force: true });
  });

  const cloudflaredPath = path.join(binDir, "cloudflared");
  const pgrepPath = path.join(binDir, "pgrep");
  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(cloudflaredPath, "#!/bin/sh\necho 'cloudflared version 2026.6.0'\n");
  await writeFile(pgrepPath, `#!/bin/sh
if [ "$2" = "cloudflared" ]; then
  echo '123 cloudflared tunnel --url http://127.0.0.1:4567 https://amber-lifeos.trycloudflare.com'
  exit 0
fi
exit 1
`);
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo '{"TCP":{},"Web":{"lifeos-mac.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  exit 0
fi
exit 1
`);
  await chmod(cloudflaredPath, 0o755);
  await chmod(pgrepPath, 0o755);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_HOST = "127.0.0.1";
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  delete process.env.LIFEOS_ALLOW_PUBLIC;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?mock=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.cloudflare.installed, true);
  assert.match(diagnostics.cloudflare.version, /cloudflared version 2026\.6\.0/);
  assert.equal(diagnostics.cloudflare.running, true);
  assert.equal(typeof diagnostics.cloudflare.managed.running, "boolean");
  assert.deepEqual(diagnostics.cloudflare.detectedUrls, ["https://amber-lifeos.trycloudflare.com"]);
  assert.equal(diagnostics.cloudflare.suggestedCommand, "cloudflared tunnel --url http://127.0.0.1:4567");
  assert.match(diagnostics.cloudflare.installUrl, /^https:\/\/developers\.cloudflare\.com\//);
  assert.match(diagnostics.cloudflare.envTemplate, /PUBLIC_BASE_URL=https:\/\/amber-lifeos\.trycloudflare\.com/);
  assert.equal(diagnostics.tailscale.installed, true);
  assert.equal(diagnostics.tailscale.online, true);
  assert.equal(diagnostics.tailscale.deviceName, "lifeos-mac");
  assert.equal(diagnostics.tailscale.tailnetName, "tailnet.example.ts.net");
  assert.deepEqual(diagnostics.tailscale.urls, ["http://100.64.0.10:4567"]);
  assert.deepEqual(diagnostics.tailscale.magicDnsUrls, ["http://lifeos-mac.tailnet.example.ts.net:4567"]);
  assert.equal(diagnostics.tailscale.loginCommand, "tailscale up");
  assert.equal(diagnostics.tailscale.magicDnsEnabled, true);
  assert.equal(diagnostics.tailscale.httpsServeUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.tailscale.httpsServeReady, true);
  assert.equal(diagnostics.tailscale.serveRunning, true);
  assert.equal(diagnostics.tailscale.serveCommand, "tailscale serve --bg https:443 http://127.0.0.1:4567");
  assert.deepEqual(diagnostics.tailscale.mobileUrls, ["https://lifeos-mac.tailnet.example.ts.net", "http://lifeos-mac.tailnet.example.ts.net:4567", "http://100.64.0.10:4567"]);
  assert.match(diagnostics.tailscale.installUrl, /^https:\/\/tailscale\.com\/download/);
  assert.equal(diagnostics.tailscale.envTemplate, "LIFEOS_HOST=127.0.0.1 LIFEOS_ALLOW_PUBLIC=1 PUBLIC_BASE_URL=https://lifeos-mac.tailnet.example.ts.net npm run start");
  assert.equal(diagnostics.lanEnvTemplate, "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start");
  assert.equal(diagnostics.recommendedBaseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.connectionCandidates[0].id, "tailscale-serve-https");
  assert.equal(diagnostics.connectionCandidates[0].mobilePairUrl, "https://lifeos-mac.tailnet.example.ts.net/mobile/pair");
  assert.equal(diagnostics.connectionCandidates[0].secure, true);
  assert.equal(diagnostics.connectionCandidates[0].stability, "stable");
  assert.equal(diagnostics.remoteReadiness.status, "needs-restart");
  assert.equal(diagnostics.remoteReadiness.severity, "warning");
  assert.equal(diagnostics.remoteReadiness.baseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.remoteReadiness.actions.some((action) => action.id === "needsRestart"), true);
  assert.equal(diagnostics.connectionCandidates[0].envTemplate, "LIFEOS_HOST=127.0.0.1 LIFEOS_ALLOW_PUBLIC=1 PUBLIC_BASE_URL=https://lifeos-mac.tailnet.example.ts.net npm run start");
  assert.match(diagnostics.connectionCandidates[0].restartInstruction, /Copy the startup environment/);
  const cloudflareCandidate = diagnostics.connectionCandidates.find((candidate) => candidate.id === "cloudflare-0");
  assert.equal(cloudflareCandidate.stability, "temporary");
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-serve-https" && candidate.baseUrl === "https://lifeos-mac.tailnet.example.ts.net"), true);
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-magicdns-0" && candidate.baseUrl === "http://lifeos-mac.tailnet.example.ts.net:4567"), true);
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-ip-0" && candidate.baseUrl === "http://100.64.0.10:4567"), true);
  const tailscaleCandidate = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-serve-https");
  const tailscaleHttpCandidate = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-magicdns-0");
  assert.match(tailscaleCandidate.envTemplate, /PUBLIC_BASE_URL=https:\/\/lifeos-mac\.tailnet\.example\.ts\.net/);
  assert.match(tailscaleCandidate.notes[0], /HTTPS Serve is already active/);
  assert.equal(tailscaleHttpCandidate.stability, "temporary");
  assert.match(tailscaleHttpCandidate.notes[0], /not a long-term phone\/PWA entry/);
});

test("network diagnostics normalizes configured public base URLs before UI and pairing use", async (t) => {
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldAllowPublic = process.env.LIFEOS_ALLOW_PUBLIC;
  const oldPath = process.env.PATH || "";
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-network-empty-bin-"));

  t.after(async () => {
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldAllowPublic === undefined) delete process.env.LIFEOS_ALLOW_PUBLIC;
    else process.env.LIFEOS_ALLOW_PUBLIC = oldAllowPublic;
    process.env.PATH = oldPath;
    await rm(binDir, { recursive: true, force: true });
  });

  process.env.PUBLIC_BASE_URL = "https://user:password@example.com/lifeos/?token=pair-secret#debug";
  process.env.APP_URL = "";
  delete process.env.LIFEOS_ALLOW_PUBLIC;
  process.env.PATH = binDir;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?public-url=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.publicBaseUrl, "https://example.com/lifeos");
  assert.equal(diagnostics.recommendedBaseUrl, "https://example.com/lifeos");
  assert.equal(diagnostics.connectionCandidates[0].id, "configured-public");
  assert.equal(diagnostics.connectionCandidates[0].requiresRestart, false);
  assert.equal(diagnostics.remoteReadiness.status, "blocked");
  assert.equal(diagnostics.remoteReadiness.blockers.some((blocker) => blocker.id === "needsPublicOptIn"), true);
  assert.equal(JSON.stringify(diagnostics).includes("pair-secret"), false);
  assert.equal(JSON.stringify(diagnostics).includes("user:password"), false);
});

test("connection URL tests strip credentials, query secrets, and fragments from returned probe URL", async (t) => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    const urlString = String(url);
    return {
      ok: true,
      status: 200,
      text: async () => urlString.endsWith("/api/v1/health")
        ? JSON.stringify({ service: "lifeos-local-core", publicAccessWarning: true })
        : "<!doctype html><title>LifeOS AI</title>",
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { testConnectionUrl } = await import(`../server/networkDiagnostics.ts?test-url=${Date.now()}`);
  const result = await testConnectionUrl("https://user:password@example.test/lifeos?token=connection-secret#debug", { includeWebSocket: false });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.test/lifeos/api/v1/health");
  assert.deepEqual(fetchedUrls, [
    "https://example.test/lifeos/api/v1/health",
    "https://example.test/lifeos/mobile/chat",
  ]);
  assert.equal(result.publicAccessWarning, true);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell"]);
  assert.deepEqual(result.fixes.map((fix) => fix.id), ["public-mode-risk"]);
  assert.equal(JSON.stringify(result).includes("connection-secret"), false);
  assert.equal(JSON.stringify(result).includes("user:password"), false);
  assert.equal(JSON.stringify(result).includes("#debug"), false);
});

test("connection URL tests health, mobile shell, and websocket under a remote base path", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/lifeos/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "lifeos-local-core", publicAccessWarning: false }));
      return;
    }
    if (req.url === "/lifeos/mobile/chat") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><title>LifeOS AI</title></html>");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/lifeos/api/v1/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.close(1000, "ok");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  const { port } = server.address();
  const { testConnectionUrl } = await import(`../server/networkDiagnostics.ts?websocket=${Date.now()}`);
  const result = await testConnectionUrl(`http://127.0.0.1:${port}/lifeos`);

  assert.equal(result.ok, true);
  assert.equal(result.publicAccessWarning, false);
  assert.equal(result.url, `http://127.0.0.1:${port}/lifeos/api/v1/health`);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell", "websocket"]);
  assert.equal(result.steps.find((step) => step.id === "websocket").status, 101);
  assert.deepEqual(result.fixes.map((fix) => fix.id), ["localhost-phone-unreachable", "https-required"]);
});

test("connection URL returns structured repair hints for blocked websocket and unsafe phone entry", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/lifeos/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "lifeos-local-core", publicAccessWarning: false }));
      return;
    }
    if (req.url === "/lifeos/mobile/chat") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><title>LifeOS AI</title></html>");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.on("upgrade", (_req, socket) => {
    socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const { port } = server.address();
  const { testConnectionUrl } = await import(`../server/networkDiagnostics.ts?repair-hints=${Date.now()}`);
  const result = await testConnectionUrl(`http://127.0.0.1:${port}/lifeos?token=secret#debug`);

  assert.equal(result.ok, false);
  assert.equal(result.url, `http://127.0.0.1:${port}/lifeos/api/v1/health`);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell", "websocket"]);
  assert.deepEqual(result.fixes.map((fix) => fix.id), [
    "localhost-phone-unreachable",
    "https-required",
    "websocket-upgrade-blocked",
  ]);
  assert.equal(result.fixes.find((fix) => fix.id === "websocket-upgrade-blocked").stepId, "websocket");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("#debug"), false);
});

test("Tailscale HTTPS Serve helpers run controlled start and stop commands", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-serve-bin-"));
  const commandLog = path.join(binDir, "tailscale.log");
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
echo "$@" >> "${commandLog}"
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{"Web":{"lifeos-mac.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo "ok"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";

  const { startTailscaleHttpsServe, stopTailscaleHttpsServe } = await import(`../server/networkDiagnostics.ts?tailscale-serve=${Date.now()}`);
  const started = startTailscaleHttpsServe("4567");
  assert.equal(started.url, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(started.command, "tailscale serve --bg https:443 http://127.0.0.1:4567");

  const stopped = stopTailscaleHttpsServe();
  assert.equal(stopped.command, "tailscale serve --https=443 off");

  const log = await import("node:fs/promises").then((fs) => fs.readFile(commandLog, "utf8"));
  assert.match(log, /serve --bg https:443 http:\/\/127\.0\.0\.1:4567/);
  assert.match(log, /serve --https=443 off/);
});

test("Tailscale HTTP fallback is not accepted as a long-term remote entry", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-http-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldAllowPublic = process.env.LIFEOS_ALLOW_PUBLIC;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldAllowPublic === undefined) delete process.env.LIFEOS_ALLOW_PUBLIC;
    else process.env.LIFEOS_ALLOW_PUBLIC = oldAllowPublic;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{}'
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.LIFEOS_ALLOW_PUBLIC = "1";

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?tailscale-http=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  const magicDns = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-magicdns-0");
  const tailnetIp = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-ip-0");

  assert.equal(magicDns.baseUrl, "http://lifeos-mac.tailnet.example.ts.net:4567");
  assert.equal(diagnostics.tailscale.loginCommand, "tailscale up");
  assert.equal(diagnostics.tailscale.magicDnsEnabled, true);
  assert.equal(diagnostics.tailscale.httpsServeReady, true);
  assert.equal(diagnostics.tailscale.serveRunning, false);
  assert.equal(magicDns.secure, false);
  assert.equal(magicDns.stability, "temporary");
  assert.equal(tailnetIp.baseUrl, "http://100.64.0.10:4567");
  assert.equal(tailnetIp.secure, false);
  assert.equal(tailnetIp.stability, "temporary");
  assert.equal(diagnostics.recommendedBaseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.connectionCandidates[0].id, "tailscale-serve-https");
  assert.equal(diagnostics.remoteReadiness.status, "needs-restart");
  assert.equal(diagnostics.remoteReadiness.baseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.remoteReadiness.actions.some((action) => action.id === "needsRestart"), true);
});

test("HTTPS tunnel is preferred over Tailscale HTTP fallback when HTTPS Serve is unavailable", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-http-cloudflare-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  const cloudflaredPath = path.join(binDir, "cloudflared");
  const pgrepPath = path.join(binDir, "pgrep");
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]}}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{}'
  exit 0
fi
exit 1
`);
  await writeFile(cloudflaredPath, "#!/bin/sh\necho 'cloudflared version 2026.6.0'\n");
  await writeFile(pgrepPath, `#!/bin/sh
if [ "$2" = "cloudflared" ]; then
  echo '123 cloudflared tunnel --url http://127.0.0.1:4567 https://amber-lifeos.trycloudflare.com'
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);
  await chmod(cloudflaredPath, 0o755);
  await chmod(pgrepPath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?tailscale-http-cloudflare=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.tailscale.magicDnsEnabled, false);
  assert.equal(diagnostics.tailscale.httpsServeReady, false);
  assert.match(diagnostics.tailscale.notes.join("\n"), /MagicDNS suffix was not detected/);
  assert.equal(diagnostics.connectionCandidates[0].id, "cloudflare-0");
  assert.equal(diagnostics.connectionCandidates[0].baseUrl, "https://amber-lifeos.trycloudflare.com");
  assert.equal(diagnostics.connectionCandidates[0].secure, true);
  assert.equal(diagnostics.connectionCandidates[0].stability, "temporary");
  assert.equal(diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-ip-0").stability, "temporary");
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-serve-https"), false);
});

test("configured Tailscale HTTPS Serve autostart refreshes the saved stable URL", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-autostart-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldDisableAutostart = process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  const oldAutostart = process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldDisableAutostart === undefined) delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART = oldDisableAutostart;
    if (oldAutostart === undefined) delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART = oldAutostart;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-new","TailscaleIPs":["100.64.0.11"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{"Web":{"lifeos-new.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo "ok"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.PUBLIC_BASE_URL = "https://lifeos-old.tailnet.example.ts.net";
  delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  const cacheKey = Date.now();
  const desktopConfig = await import("../server/desktopRuntimeConfig.ts");
  const networkDiagnostics = await import(`../server/networkDiagnostics.ts?tailscale-autostart=${cacheKey}`);
  const configPath = desktopConfig.desktopRuntimeConfigPath;
  const previousConfig = fs.existsSync(configPath) ? await readFile(configPath, "utf8") : null;
  t.after(async () => {
    if (previousConfig === null) await rm(configPath, { force: true });
    else await writeFile(configPath, previousConfig);
  });

  desktopConfig.saveDesktopRuntimeConfig({
    mode: "tailscale",
    label: "Tailscale HTTPS Serve",
    baseUrl: "https://lifeos-old.tailnet.example.ts.net",
  });

  const result = networkDiagnostics.maybeStartConfiguredTailscaleServe("4567");
  assert.equal(result.reason, "already_running");
  assert.equal(result.config.publicBaseUrl, "https://lifeos-new.tailnet.example.ts.net");
  assert.equal(process.env.PUBLIC_BASE_URL, "https://lifeos-new.tailnet.example.ts.net");

  const rawConfig = await readFile(configPath, "utf8");
  const savedConfig = JSON.parse(rawConfig);
  assert.equal(savedConfig.mode, "tailscale");
  assert.equal(savedConfig.publicBaseUrl, "https://lifeos-new.tailnet.example.ts.net");
  assert.equal(savedConfig.baseUrl, "https://lifeos-new.tailnet.example.ts.net");
});

test("configured Tailscale HTTPS Serve autostart uses the runtime port instead of the environment default", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-autostart-port-bin-"));
  const stateFile = path.join(binDir, "serve-target.txt");
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldDisableAutostart = process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  const oldAutostart = process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldDisableAutostart === undefined) delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART = oldDisableAutostart;
    if (oldAutostart === undefined) delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART = oldAutostart;
    await rm(binDir, { recursive: true, force: true });
  });

  await writeFile(stateFile, "http://127.0.0.1:3000");
  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
STATE_FILE=${JSON.stringify(stateFile)}
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-port","TailscaleIPs":["100.64.0.12"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  target=$(cat "$STATE_FILE")
  echo '{"Web":{"lifeos-port.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"'"$target"'"}}}}}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "--bg" ]; then
  echo "$4" > "$STATE_FILE"
  echo "ok"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "3000";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.PUBLIC_BASE_URL = "https://lifeos-port.tailnet.example.ts.net";
  delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  const cacheKey = Date.now();
  const desktopConfig = await import("../server/desktopRuntimeConfig.ts");
  const networkDiagnostics = await import(`../server/networkDiagnostics.ts?tailscale-autostart-runtime-port=${cacheKey}`);
  const configPath = desktopConfig.desktopRuntimeConfigPath;
  const previousConfig = fs.existsSync(configPath) ? await readFile(configPath, "utf8") : null;
  t.after(async () => {
    if (previousConfig === null) await rm(configPath, { force: true });
    else await writeFile(configPath, previousConfig);
  });

  desktopConfig.saveDesktopRuntimeConfig({
    mode: "tailscale",
    label: "Tailscale HTTPS Serve",
    baseUrl: "https://lifeos-port.tailnet.example.ts.net",
  });

  const result = networkDiagnostics.maybeStartConfiguredTailscaleServe("4567");
  assert.equal(result.started, true);
  assert.equal(result.reason, "tailscale_configured");
  assert.equal(await readFile(stateFile, "utf8"), "http://127.0.0.1:4567\n");
  assert.equal(result.serve.status.serveRunning, true);
  assert.match(result.serve.status.serveStatus, /4567/);
});
