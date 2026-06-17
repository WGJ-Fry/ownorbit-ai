// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("remote validation report persists sanitized remote smoke results", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-validation-"));
  try {
    const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
      const { saveRemoteValidationReport, getRemoteValidationReport } = await import("./server/remoteValidationReport.ts");
      saveRemoteValidationReport({
        label: "Cloudflare",
        baseUrl: "https://user:pass@example.test/lifeos?token=secret#debug",
        result: {
          ok: true,
          status: 200,
          url: "https://user:pass@example.test/lifeos/api/v1/health?token=secret#debug",
          latencyMs: 42,
          steps: [
            { id: "health", ok: true, status: 200, url: "https://user:pass@example.test/lifeos/api/v1/health?token=secret#debug", latencyMs: 10 },
            { id: "mobile-shell", ok: true, status: 200, url: "https://example.test/lifeos/mobile/chat?token=secret", latencyMs: 12 },
          ],
        },
      }, { type: "test", id: "runner" });
      const report = getRemoteValidationReport();
      process.stdout.write(JSON.stringify(report));
    `], {
      cwd: process.cwd(),
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    const report = JSON.parse(output);
    assert.equal(report.ok, true);
    assert.equal(report.passed, 2);
    assert.equal(report.total, 2);
    assert.equal(report.baseUrl, "https://example.test/lifeos");
    assert.equal(report.url, "https://example.test/lifeos/api/v1/health");
    assert.equal(report.steps[0].url, "https://example.test/lifeos/api/v1/health");
    assert.doesNotMatch(output, /user:|:pass|token=secret|#debug/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("remote health monitor persists the saved stable remote entry report", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { createServer } = await import("node:http");
    const { WebSocketServer } = await import("ws");
    const server = createServer((req, res) => {
      if (req.url === "/lifeos/api/v1/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ service: "lifeos-local-core" }));
        return;
      }
      if (req.url === "/lifeos/mobile/chat") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>LifeOS AI</title><div id=\\\"root\\\"></div>");
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
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(1000, "ok"));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const { saveDesktopRuntimeConfig } = await import("./server/desktopRuntimeConfig.ts");
    const { runRemoteHealthCheck } = await import("./server/remoteHealthMonitor.ts");
    saveDesktopRuntimeConfig({ mode: "tailscale", label: "Stable Test", baseUrl: \`http://127.0.0.1:\${port}/lifeos\` });
    const result = await runRemoteHealthCheck("manual");
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify(result.report));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const report = JSON.parse(output);
  assert.equal(report.ok, true, JSON.stringify(report, null, 2));
  assert.equal(report.passed, 3);
  assert.match(report.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/lifeos$/);
});

test("remote health monitor restores saved Cloudflare Named Tunnel before refreshing report", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-restore-"));
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-bin-"));
  const tlsDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-tls-"));
  const credentialsFile = path.join(dataDir, "named.json");
  const cloudflaredPath = path.join(binDir, "cloudflared");
  const certFile = path.join(tlsDir, "localhost.crt");
  const keyFile = path.join(tlsDir, "localhost.key");
  await writeFile(credentialsFile, "{}");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyFile,
    "-out",
    certFile,
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });
  await writeFile(cloudflaredPath, `#!/bin/sh
echo "INF Registered tunnel connection" >&2
while true; do sleep 1; done
`);
  await chmod(cloudflaredPath, 0o755);
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
    await rm(tlsDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { createServer } = await import("node:https");
    const { readFileSync } = await import("node:fs");
    const { WebSocketServer } = await import("ws");
    let healthHits = 0;
    const server = createServer({
      cert: readFileSync(${JSON.stringify(certFile)}),
      key: readFileSync(${JSON.stringify(keyFile)}),
    }, (req, res) => {
      if (req.url === "/api/v1/health") {
        healthHits += 1;
        if (healthHits === 1) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ service: "starting" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ service: "lifeos-local-core" }));
        return;
      }
      if (req.url === "/mobile/chat") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>LifeOS AI</title><div id=\\\"root\\\"></div>");
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/api/v1/ws") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(1000, "ok"));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    process.env.LIFEOS_PORT = String(port);
    process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME = "lifeos-ai";
    process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME = \`127.0.0.1:\${port}\`;
    process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS = ${JSON.stringify(credentialsFile)};
    const { generateCloudflareNamedTunnelConfig, stopManagedCloudflareTunnel } = await import("./server/cloudflareTunnel.ts");
    const { runRemoteHealthCheck } = await import("./server/remoteHealthMonitor.ts");
    generateCloudflareNamedTunnelConfig({});
    const result = await runRemoteHealthCheck("manual");
    stopManagedCloudflareTunnel();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify({ restored: result.restored, report: result.report }));
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_CLOUDFLARED_BIN: cloudflaredPath,
      NODE_EXTRA_CA_CERTS: certFile,
    },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.restored, true);
  assert.equal(result.report.ok, true, JSON.stringify(result.report, null, 2));
  assert.equal(result.report.passed, 3);
});

test("remote health summary classifies long-term entry readiness", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-summary-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { saveRemoteValidationReport, summarizeRemoteHealth } = await import("./server/remoteValidationReport.ts");
    const now = 1781676000000;
    const report = saveRemoteValidationReport({
      label: "Tailscale",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      result: {
        ok: true,
        status: 200,
        url: "https://lifeos.tailnet.example.ts.net/api/v1/health",
        latencyMs: 42,
        steps: [
          { id: "health", ok: true, status: 200, url: "https://lifeos.tailnet.example.ts.net/api/v1/health", latencyMs: 10 },
          { id: "mobile-shell", ok: true, status: 200, url: "https://lifeos.tailnet.example.ts.net/mobile/chat", latencyMs: 12 },
          { id: "websocket", ok: true, status: 101, url: "wss://lifeos.tailnet.example.ts.net/api/v1/ws", latencyMs: 20 },
        ],
      },
    });
    report.createdAt = now - 1000;
    const healthy = summarizeRemoteHealth({ baseUrl: "https://lifeos.tailnet.example.ts.net", readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" }, report, now });
    const temporary = summarizeRemoteHealth({ baseUrl: "https://demo.trycloudflare.com", readiness: { status: "temporary", baseUrl: "https://demo.trycloudflare.com" }, report: null, now });
    const insecure = summarizeRemoteHealth({ baseUrl: "http://100.64.0.10:3000", readiness: { status: "blocked", baseUrl: "http://100.64.0.10:3000" }, report: null, now });
    const stale = summarizeRemoteHealth({ baseUrl: "https://lifeos.tailnet.example.ts.net", readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" }, report: { ...report, createdAt: now - 11 * 60 * 1000 }, now });
    process.stdout.write(JSON.stringify({ healthy, temporary, insecure, stale }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.healthy.status, "healthy");
  assert.equal(result.healthy.severity, "ok");
  assert.equal(result.healthy.checks.every((check) => check.status === "ok"), true);
  assert.equal(result.temporary.status, "temporary");
  assert.equal(result.temporary.checks.find((check) => check.id === "qr-entry").status, "warning");
  assert.equal(result.insecure.status, "insecure");
  assert.equal(result.insecure.checks.find((check) => check.id === "https").status, "fail");
  assert.equal(result.stale.status, "stale");
});
