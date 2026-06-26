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
        label: "Cloudflare Basic Z2l0aHViOnJlbW90ZQ== github_pat_remoteSecret_1234567890",
        baseUrl: "https://user:pass@example.test/lifeos?token=secret#debug",
        result: {
          ok: true,
          status: 200,
          url: "https://user:pass@example.test/lifeos/api/v1/health?token=secret#debug",
          latencyMs: 42,
          error: "Remote probe failed with Basic Z2l0aHViOnJlbW90ZQ== github_pat_remoteSecret_1234567890 /Users/wangguojun/private.txt",
          httpsStatus: {
            ok: false,
            protocol: "https",
            requiredForLongTerm: true,
            trustedByRuntime: false,
            error: "TLS probe leaked Basic Z2l0aHViOnJlbW90ZQ== and github_pat_remoteSecret_1234567890",
          },
          steps: [
            { id: "health", ok: true, status: 200, url: "https://user:pass@example.test/lifeos/api/v1/health?token=secret#debug", latencyMs: 10, error: "Bearer remote-token-value and /Users/wangguojun/.lifeos" },
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
    assert.doesNotMatch(output, /user:|:pass|token=secret|#debug|Z2l0aHViOnJlbW90ZQ|github_pat_remoteSecret|remote-token-value|wangguojun/);
    assert.match(report.label, /Basic \[redacted\]/);
    assert.match(report.error, /\[local-path\]/);
    assert.match(report.httpsStatus.error, /\[redacted\]/);
    assert.match(report.steps[0].error, /Bearer \[redacted\]/);
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

test("remote health monitor checks configured PUBLIC_BASE_URL without a saved runtime entry", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-env-"));
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
    process.env.PUBLIC_BASE_URL = \`http://127.0.0.1:\${port}/lifeos\`;
    const { runRemoteHealthCheck } = await import("./server/remoteHealthMonitor.ts");
    const result = await runRemoteHealthCheck("manual");
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify(result));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir, PUBLIC_BASE_URL: "" },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.skipped, false);
  assert.equal(result.report.ok, true, JSON.stringify(result.report, null, 2));
  assert.equal(result.report.passed, 3);
  assert.match(result.report.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/lifeos$/);
});

test("remote health monitor exposes scheduler status", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-status-"));
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
    process.env.LIFEOS_REMOTE_HEALTH_INTERVAL_MS = "30000";
    const { getRemoteHealthMonitorStatus, runRemoteHealthCheck, startRemoteHealthMonitor } = await import("./server/remoteHealthMonitor.ts");
    saveDesktopRuntimeConfig({ mode: "tailscale", label: "Stable Test", baseUrl: \`http://127.0.0.1:\${port}/lifeos\` });
    const before = getRemoteHealthMonitorStatus();
    startRemoteHealthMonitor();
    const after = getRemoteHealthMonitorStatus();
    await runRemoteHealthCheck("manual");
    const afterManual = getRemoteHealthMonitorStatus();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify({ before, after, afterManual }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_REMOTE_HEALTH_MONITOR: "1" },
    encoding: "utf8",
  });
  const { before, after, afterManual } = JSON.parse(output);
  assert.equal(before.enabled, true);
  assert.equal(before.running, false);
  assert.equal(after.enabled, true);
  assert.equal(after.running, true);
  assert.equal(after.inFlight, false);
  assert.equal(after.intervalMs, 30000);
  assert.equal(typeof after.startedAt, "number");
  assert.equal(typeof after.nextRunAt, "number");
  assert.equal(typeof afterManual.lastRunAt, "number");
  assert.equal(typeof afterManual.nextRunAt, "number");
  assert.ok(afterManual.nextRunAt >= afterManual.lastRunAt + 29_000);
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
    const { getRemoteRecoveryReport, runRemoteHealthCheck } = await import("./server/remoteHealthMonitor.ts");
    generateCloudflareNamedTunnelConfig({});
    const result = await runRemoteHealthCheck("manual");
    const recovery = getRemoteRecoveryReport();
    stopManagedCloudflareTunnel();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify({ restored: result.restored, recovery, report: result.report }));
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
  assert.equal(result.recovery.mode, "cloudflare");
  assert.equal(result.recovery.attempted, true);
  assert.equal(result.recovery.restored, true);
  assert.equal(result.recovery.started, true);
  assert.equal(result.recovery.baseUrl, `https://127.0.0.1:${result.report.baseUrl.split(":").pop()}`);
  assert.equal(result.recovery.restoredBaseUrl, result.report.baseUrl);
  assert.equal(result.recovery.recoveryReason, "cloudflare_named_configured");
  assert.equal(result.recovery.recoveryAction, "run-remote-health");
  assert.equal(result.recovery.healthOkBefore, false);
  assert.equal(result.recovery.healthOkAfter, true);
  assert.equal(result.report.ok, true, JSON.stringify(result.report, null, 2));
  assert.equal(result.report.passed, 3);
});

test("remote health monitor recommends Tailscale repair when saved serve restore fails", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-tailscale-fail-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
    const { saveDesktopRuntimeConfig } = await import("./server/desktopRuntimeConfig.ts");
    const { runRemoteHealthCheck } = await import("./server/remoteHealthMonitor.ts");
    saveDesktopRuntimeConfig({ mode: "tailscale", label: "Broken Tailscale", baseUrl: "https://127.0.0.1:65534/lifeos" });
    const result = await runRemoteHealthCheck("manual");
    process.stdout.write(JSON.stringify(result.recovery));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const recovery = JSON.parse(output);
  assert.equal(recovery.mode, "tailscale");
  assert.equal(recovery.attempted, true);
  assert.equal(recovery.restored, false);
  assert.equal(recovery.recoveryReason, "restore_failed");
  assert.equal(recovery.recoveryAction, "check-tailscale");
  assert.match(recovery.error, /Tailscale CLI was not detected/);
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
        httpsStatus: {
          ok: true,
          protocol: "https",
          requiredForLongTerm: true,
          trustedByRuntime: true,
        },
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
    const expiredQr = summarizeRemoteHealth({ baseUrl: "https://lifeos.tailnet.example.ts.net", readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" }, report, pairingSession: { expiresAt: now - 1 }, now });
    const mismatchedQr = summarizeRemoteHealth({ baseUrl: "https://lifeos.tailnet.example.ts.net", readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" }, report, pairingSession: { baseUrl: "https://old.trycloudflare.com", expiresAt: now + 60_000 }, now });
    const tlsBlockedReport = saveRemoteValidationReport({
      label: "Tailscale TLS failure",
      baseUrl: "https://broken.tailnet.example.ts.net",
      result: {
        ok: false,
        status: 0,
        url: "https://broken.tailnet.example.ts.net/api/v1/health",
        latencyMs: 19,
        error: "certificate password=secret failed",
        httpsStatus: {
          ok: false,
          protocol: "https",
          requiredForLongTerm: true,
          trustedByRuntime: false,
          error: "certificate password=secret failed",
        },
        steps: [],
      },
    });
    tlsBlockedReport.createdAt = now - 1000;
    const tlsBlocked = summarizeRemoteHealth({ baseUrl: "https://broken.tailnet.example.ts.net", readiness: { status: "ready", baseUrl: "https://broken.tailnet.example.ts.net" }, report: tlsBlockedReport, now });
    const custom = summarizeRemoteHealth({ baseUrl: "https://remote.example.com", readiness: { status: "blocked", baseUrl: "https://remote.example.com" }, report: null, now });
    process.stdout.write(JSON.stringify({ report, healthy, temporary, insecure, stale, expiredQr, mismatchedQr, tlsBlocked, custom }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.healthy.status, "healthy");
  assert.equal(result.healthy.severity, "ok");
  assert.equal(result.healthy.entryKind, "tailscale");
  assert.equal(result.healthy.checks.every((check) => check.status === "ok"), true);
  assert.equal(result.report.httpsStatus.ok, true);
  assert.equal(result.report.httpsStatus.trustedByRuntime, true);
  assert.equal(result.temporary.status, "temporary");
  assert.equal(result.temporary.entryKind, "temporary-cloudflare");
  assert.equal(result.temporary.checks.find((check) => check.id === "qr-entry").status, "warning");
  assert.equal(result.insecure.status, "insecure");
  assert.equal(result.insecure.entryKind, "insecure-http");
  assert.equal(result.insecure.checks.find((check) => check.id === "https").status, "fail");
  assert.equal(result.stale.status, "stale");
  assert.equal(result.expiredQr.status, "qr-warning");
  assert.equal(result.expiredQr.severity, "warning");
  assert.equal(result.expiredQr.entryKind, "tailscale");
  assert.equal(result.custom.entryKind, "custom");
  assert.equal(result.expiredQr.checks.find((check) => check.id === "qr-entry").status, "warning");
  assert.equal(result.expiredQr.recommendations.includes("ready"), false);
  assert.equal(result.expiredQr.recommendations.includes("refresh-pairing-qr"), true);
  assert.equal(result.mismatchedQr.status, "qr-warning");
  assert.equal(result.mismatchedQr.severity, "warning");
  assert.equal(result.mismatchedQr.checks.find((check) => check.id === "qr-entry").status, "warning");
  assert.equal(result.mismatchedQr.checks.find((check) => check.id === "qr-entry").detail, "https://old.trycloudflare.com");
  assert.equal(result.mismatchedQr.recommendations.includes("refresh-pairing-qr"), true);
  assert.equal(result.tlsBlocked.status, "failing");
  assert.equal(result.tlsBlocked.severity, "danger");
  assert.equal(result.tlsBlocked.checks.find((check) => check.id === "https").status, "fail");
  assert.equal(result.tlsBlocked.checks.find((check) => check.id === "https").detail.includes("secret"), false);
  assert.equal(result.tlsBlocked.recommendations.includes("use-https"), true);
});

test("remote acceptance checklist separates automated and real-world verification", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { saveRemoteValidationReport, summarizeRemoteHealth } = await import("./server/remoteValidationReport.ts");
    const { buildRemoteAcceptanceChecklist, getRemoteAcceptanceRecords, saveRemoteAcceptanceRecord } = await import("./server/remoteAcceptance.ts");
    const report = saveRemoteValidationReport({
      label: "Remote health check after auto-restore",
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
    const health = summarizeRemoteHealth({
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" },
      report,
      now: report.createdAt + 1000,
    });
    saveRemoteAcceptanceRecord({
      id: "cellular-mobile-chat",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      note: "Phone cellular /mobile/chat verified with token=secret Basic Z2l0aHViOmFjY2VwdA== github_pat_acceptSecret_1234567890",
      evidence: {
        source: "admin-long-term-remote-checklist Basic Z2l0aHViOmFjY2VwdA==",
        requirements: [
          "Saved remote entry: https://lifeos.tailnet.example.ts.net",
          "Phone Wi-Fi disabled and /mobile/chat verified over cellular data.",
          "secret=hidden",
          "GitHub token github_pat_acceptSecret_1234567890 and /Users/wangguojun/acceptance.log",
        ],
      },
    }, { type: "admin", id: "owner" });
    saveRemoteAcceptanceRecord({
      id: "network-interruption",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      note: "Tailscale disconnected and reconnected with token=secret",
    }, { type: "admin", id: "owner" });
    saveRemoteAcceptanceRecord({
      id: "network-switch",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      note: "Phone switched between Wi-Fi and cellular with token=secret",
    }, { type: "admin", id: "owner" });
    saveRemoteAcceptanceRecord({
      id: "stale-qr-repair",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      note: "Old QR rejected and fresh QR re-pair succeeded with token=secret",
    }, { type: "admin", id: "owner" });
    saveRemoteAcceptanceRecord({
      id: "diagnostic-export",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      note: "Diagnostic bundle exported with token=secret",
    }, { type: "admin", id: "owner" });
    const checklist = buildRemoteAcceptanceChecklist({
      diagnostics: {
        desktopRuntimeConfig: { mode: "tailscale", publicBaseUrl: "https://lifeos.tailnet.example.ts.net" },
        tailscale: { serveRunning: true, httpsServeUrl: "https://lifeos.tailnet.example.ts.net" },
        cloudflareNamedTunnel: { ready: false, baseUrl: "" },
      },
      health,
      report,
      records: getRemoteAcceptanceRecords(),
    });
    const records = getRemoteAcceptanceRecords();
    process.stdout.write(JSON.stringify({ checklist, records }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const { checklist, records } = JSON.parse(output);
  const cellularRecord = records.find((item) => item.id === "cellular-mobile-chat");
  assert.equal(cellularRecord.evidence.entryKind, "tailscale-https");
  assert.match(cellularRecord.evidence.source, /admin-long-term-remote-checklist Basic \[redacted\]/);
  assert.equal(cellularRecord.evidence.requirements.some((item) => /token=secret|secret=hidden|github_pat_acceptSecret|wangguojun/.test(item)), false);
  assert.equal(JSON.stringify(records).includes("Z2l0aHViOmFjY2VwdA"), false);
  assert.equal(JSON.stringify(records).includes("github_pat_acceptSecret"), false);
  assert.equal(checklist.find((item) => item.id === "tailscale-https-serve").status, "passed");
  assert.equal(checklist.find((item) => item.id === "remote-smoke").status, "passed");
  assert.equal(checklist.find((item) => item.id === "restart-restore").status, "passed");
  assert.match(checklist.find((item) => item.id === "cellular-mobile-chat").evidence, /Phone cellular/);
  assert.doesNotMatch(checklist.find((item) => item.id === "cellular-mobile-chat").evidence, /secret=hidden|Z2l0aHViOmFjY2VwdA|github_pat_acceptSecret/);
  assert.equal(checklist.find((item) => item.id === "cloudflare-named-tunnel").status, "needs-action");
  assert.equal(checklist.find((item) => item.id === "cellular-mobile-chat").status, "passed");
  assert.equal(checklist.find((item) => item.id === "cellular-mobile-chat").evidence.includes("secret"), false);
  assert.equal(checklist.find((item) => item.id === "network-interruption").status, "passed");
  assert.equal(checklist.find((item) => item.id === "network-interruption").evidence.includes("secret"), false);
  assert.equal(checklist.find((item) => item.id === "network-switch").status, "passed");
  assert.equal(checklist.find((item) => item.id === "network-switch").evidence.includes("secret"), false);
  assert.equal(checklist.find((item) => item.id === "stale-qr-repair").status, "passed");
  assert.equal(checklist.find((item) => item.id === "stale-qr-repair").evidence.includes("secret"), false);
  assert.equal(checklist.find((item) => item.id === "diagnostic-export").status, "passed");
  assert.equal(checklist.find((item) => item.id === "diagnostic-export").evidence.includes("secret"), false);
  assert.equal(checklist.find((item) => item.id === "ci-remote-mock").status, "passed");
});

test("remote acceptance checklist requires real network interruption and diagnostic evidence", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-manual-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { saveRemoteValidationReport, summarizeRemoteHealth } = await import("./server/remoteValidationReport.ts");
    const { buildRemoteAcceptanceChecklist } = await import("./server/remoteAcceptance.ts");
    const report = saveRemoteValidationReport({
      label: "Remote health check after auto-restore",
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
    const health = summarizeRemoteHealth({
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" },
      report,
      now: report.createdAt + 1000,
    });
    const checklist = buildRemoteAcceptanceChecklist({
      diagnostics: {
        desktopRuntimeConfig: { mode: "tailscale", publicBaseUrl: "https://lifeos.tailnet.example.ts.net" },
        tailscale: { serveRunning: true, httpsServeUrl: "https://lifeos.tailnet.example.ts.net" },
        cloudflareNamedTunnel: { ready: false, baseUrl: "" },
      },
      health,
      report,
      records: [],
    });
    process.stdout.write(JSON.stringify(checklist));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const checklist = JSON.parse(output);
  assert.equal(checklist.find((item) => item.id === "network-interruption").status, "manual-required");
  assert.equal(checklist.find((item) => item.id === "network-switch").status, "manual-required");
  assert.equal(checklist.find((item) => item.id === "stale-qr-repair").status, "manual-required");
  assert.equal(checklist.find((item) => item.id === "diagnostic-export").status, "manual-required");
});

test("remote acceptance checklist expires stale real-world manual evidence", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-stale-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { saveRemoteValidationReport, summarizeRemoteHealth } = await import("./server/remoteValidationReport.ts");
    const { buildRemoteAcceptanceChecklist } = await import("./server/remoteAcceptance.ts");
    const now = 1781676000000;
    const baseUrl = "https://lifeos.tailnet.example.ts.net";
    const report = saveRemoteValidationReport({
      label: "Remote health check after auto-restore",
      baseUrl,
      result: {
        ok: true,
        status: 200,
        url: baseUrl + "/api/v1/health",
        latencyMs: 42,
        steps: [
          { id: "health", ok: true, status: 200, url: baseUrl + "/api/v1/health", latencyMs: 10 },
          { id: "mobile-shell", ok: true, status: 200, url: baseUrl + "/mobile/chat", latencyMs: 12 },
          { id: "websocket", ok: true, status: 101, url: "wss://lifeos.tailnet.example.ts.net/api/v1/ws", latencyMs: 20 },
        ],
      },
    });
    const health = summarizeRemoteHealth({
      baseUrl,
      readiness: { status: "ready", baseUrl },
      report,
      now,
    });
    const staleCreatedAt = now - 8 * 24 * 60 * 60 * 1000;
    const freshCreatedAt = now - 60 * 60 * 1000;
    const staleRecords = ["cellular-mobile-chat", "network-switch", "stale-qr-repair", "network-interruption", "diagnostic-export"].map((id) => ({
      id,
      baseUrl,
      note: id + " stale proof",
      evidence: { entryKind: "tailscale-https", verifiedUrl: baseUrl, source: "test", requirements: [] },
      createdAt: staleCreatedAt,
    }));
    const freshRecords = staleRecords.map((record) => ({ ...record, createdAt: freshCreatedAt, note: record.id + " fresh proof" }));
    const common = {
      diagnostics: {
        desktopRuntimeConfig: { mode: "tailscale", publicBaseUrl: baseUrl },
        tailscale: { serveRunning: true, httpsServeUrl: baseUrl },
        cloudflareNamedTunnel: { ready: false, baseUrl: "" },
      },
      health,
      report,
      now,
    };
    const staleChecklist = buildRemoteAcceptanceChecklist({ ...common, records: staleRecords });
    const freshChecklist = buildRemoteAcceptanceChecklist({ ...common, records: freshRecords });
    process.stdout.write(JSON.stringify({ staleChecklist, freshChecklist }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const { staleChecklist, freshChecklist } = JSON.parse(output);
  for (const id of ["cellular-mobile-chat", "network-switch", "stale-qr-repair", "network-interruption", "diagnostic-export"]) {
    const staleItem = staleChecklist.find((item) => item.id === id);
    assert.equal(staleItem.status, "manual-required");
    assert.match(staleItem.evidence, /older than 7 days/);
    assert.equal(staleItem.acceptedAt, undefined);

    const freshItem = freshChecklist.find((item) => item.id === id);
    assert.equal(freshItem.status, "passed");
    assert.match(freshItem.evidence, /fresh proof/);
    assert.equal(freshItem.acceptedAt > 0, true);
    assert.equal(freshItem.expiresAt, freshItem.acceptedAt + 7 * 24 * 60 * 60 * 1000);
  }
});

test("remote acceptance records reject unsafe or non-HTTPS entries", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-reject-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { saveRemoteAcceptanceRecord } = await import("./server/remoteAcceptance.ts");
    const attempts = [];
    for (const baseUrl of ["http://lifeos.example.test", "https://user:pass@lifeos.example.test", "https://lifeos.example.test?token=abc"]) {
      try {
        saveRemoteAcceptanceRecord({ id: "cellular-mobile-chat", baseUrl });
        attempts.push("accepted");
      } catch (error) {
        attempts.push(error.message);
      }
    }
    try {
      saveRemoteAcceptanceRecord({ id: "remote-smoke", baseUrl: "https://lifeos.example.test" });
      attempts.push("accepted");
    } catch (error) {
      attempts.push(error.message);
    }
    process.stdout.write(JSON.stringify(attempts));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const attempts = JSON.parse(output);
  assert.equal(attempts.filter((item) => item === "accepted").length, 0);
  assert.match(attempts.join("\\n"), /HTTPS/);
  assert.match(attempts.join("\\n"), /username, password, token, query, or fragment/);
  assert.match(attempts.join("\\n"), /Only real-world manual acceptance items/);
});

test("remote acceptance records require a real evidence note", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-note-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { getRemoteAcceptanceRecords, saveRemoteAcceptanceRecord } = await import("./server/remoteAcceptance.ts");
    const results = [];
    try {
      saveRemoteAcceptanceRecord({
        id: "cellular-mobile-chat",
        baseUrl: "https://lifeos.example.test",
        note: "done",
      });
      results.push("accepted-short");
    } catch (error) {
      results.push(error.message);
    }
    saveRemoteAcceptanceRecord({
      id: "cellular-mobile-chat",
      baseUrl: "https://lifeos.example.test",
      note: "Phone Wi-Fi was disabled and a cellular chat message was sent successfully.",
      evidence: {
        source: "admin-long-term-remote-checklist",
        requirements: ["Phone Wi-Fi disabled and /mobile/chat verified over cellular data."],
      },
    });
    results.push(getRemoteAcceptanceRecords()[0].note);
    process.stdout.write(JSON.stringify(results));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const results = JSON.parse(output);
  assert.match(results[0], /evidence note/);
  assert.match(results[1], /cellular chat message/);
});

test("remote acceptance runbook import persists smoke evidence and rejects unsafe reports", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-runbook-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { getRemoteValidationReport } = await import("./server/remoteValidationReport.ts");
    const { getRemoteAcceptanceRunbookRecords, saveRemoteAcceptanceRunbookReport } = await import("./server/remoteAcceptance.ts");
    const report = {
      generatedAt: "2026-06-17T00:00:00.000Z",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      entryKind: "tailscale-https",
      longTermReady: true,
      longTermReason: "Remote entry passed token=secret",
      automatedChecks: {
        ok: true,
        httpsStatus: {
          ok: true,
          protocol: "https",
          requiredForLongTerm: true,
          trustedByRuntime: true,
        },
        passed: 3,
        total: 3,
        latencyMs: 36,
        steps: [
          { id: "health", ok: true, status: 200, url: "https://lifeos.tailnet.example.ts.net/api/v1/health", latencyMs: 10 },
          { id: "mobile-shell", ok: true, status: 200, url: "https://lifeos.tailnet.example.ts.net/mobile/chat", latencyMs: 12 },
          { id: "websocket", ok: true, status: 101, url: "wss://lifeos.tailnet.example.ts.net/api/v1/ws", latencyMs: 14 },
        ],
      },
      manualAcceptance: [{ id: "cellular-mobile-chat", title: "Phone cellular", required: true }],
    };
    const record = saveRemoteAcceptanceRunbookReport(report, { type: "admin", id: "owner" });
    const validation = getRemoteValidationReport();
    const attempts = [];
    for (const bad of [
      { ...report, baseUrl: "http://lifeos.example.test" },
      { ...report, baseUrl: "https://lifeos.example.test?token=abc" },
      { ...report, entryKind: "unknown" },
      { ...report, automatedChecks: { ...report.automatedChecks, steps: [{ id: "health", ok: true, status: 200, url: "https://lifeos.example.test/api/v1/health?token=abc", latencyMs: 1 }] } },
    ]) {
      try {
        saveRemoteAcceptanceRunbookReport(bad, { type: "admin", id: "owner" });
        attempts.push("accepted");
      } catch (error) {
        attempts.push(error.message);
      }
    }
    const forged = saveRemoteAcceptanceRunbookReport({
      ...report,
      baseUrl: "https://demo.trycloudflare.com",
      entryKind: "stable-https",
      longTermReady: true,
      longTermReason: "Forged long-term ready",
      automatedChecks: {
        ...report.automatedChecks,
        steps: [
          { id: "health", ok: true, status: 200, url: "https://demo.trycloudflare.com/api/v1/health", latencyMs: 10 },
          { id: "mobile-shell", ok: true, status: 200, url: "https://demo.trycloudflare.com/mobile/chat", latencyMs: 12 },
          { id: "websocket", ok: true, status: 101, url: "wss://demo.trycloudflare.com/api/v1/ws", latencyMs: 14 },
        ],
      },
    }, { type: "admin", id: "owner" });
    const tlsBlocked = saveRemoteAcceptanceRunbookReport({
      ...report,
      baseUrl: "https://lifeos.example.test",
      entryKind: "stable-https",
      automatedChecks: {
        ...report.automatedChecks,
        httpsStatus: {
          ok: false,
          protocol: "https",
          requiredForLongTerm: true,
          trustedByRuntime: false,
          error: "certificate password=secret failed",
        },
        steps: [
          { id: "health", ok: true, status: 200, url: "https://lifeos.example.test/api/v1/health", latencyMs: 10 },
          { id: "mobile-shell", ok: true, status: 200, url: "https://lifeos.example.test/mobile/chat", latencyMs: 12 },
          { id: "websocket", ok: true, status: 101, url: "wss://lifeos.example.test/api/v1/ws", latencyMs: 14 },
        ],
      },
    }, { type: "admin", id: "owner" });
    process.stdout.write(JSON.stringify({ record, validation, records: getRemoteAcceptanceRunbookRecords(), attempts, forged, tlsBlocked }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.record.entryKind, "tailscale-https");
  assert.equal(result.record.longTermReady, true);
  assert.equal(result.record.realWorldAcceptanceRequired, true);
  assert.equal(result.record.completionStatus, "automated-ready-manual-required");
  assert.equal(result.record.automatedChecks.httpsStatus.ok, true);
  assert.equal(result.record.automatedChecks.httpsStatus.protocol, "https");
  assert.equal(result.record.automatedChecks.httpsStatus.requiredForLongTerm, true);
  assert.equal(result.record.automatedChecks.httpsStatus.trustedByRuntime, true);
  assert.equal(result.record.longTermReason.includes("secret"), false);
  assert.equal(result.record.longTermReason, "Remote entry is HTTPS, non-temporary, and passed automated smoke checks.");
  assert.equal(result.validation.ok, true);
  assert.equal(result.validation.label, "remote-acceptance:tailscale-https");
  assert.equal(result.validation.passed, 3);
  assert.equal(result.records.length, 3);
  assert.equal(result.attempts.filter((item) => item === "accepted").length, 0);
  assert.match(result.attempts.join("\\n"), /HTTPS/);
  assert.match(result.attempts.join("\\n"), /username, password, token, query, or fragment/);
  assert.match(result.attempts.join("\\n"), /unsupported entry kind/);
  assert.equal(result.forged.entryKind, "temporary-cloudflare");
  assert.equal(result.forged.longTermReady, false);
  assert.equal(result.forged.completionStatus, "not-ready");
  assert.match(result.forged.longTermReason, /Temporary/);
  assert.equal(result.tlsBlocked.entryKind, "stable-https");
  assert.equal(result.tlsBlocked.longTermReady, false);
  assert.equal(result.tlsBlocked.automatedChecks.httpsStatus.ok, false);
  assert.equal(result.tlsBlocked.automatedChecks.httpsStatus.trustedByRuntime, false);
  assert.equal(result.tlsBlocked.automatedChecks.httpsStatus.error.includes("secret"), false);
  assert.match(result.tlsBlocked.longTermReason, /Remote smoke checks did not all pass/);
});

test("remote acceptance can be generated from an automated connection test", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-generated-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { getRemoteValidationReport } = await import("./server/remoteValidationReport.ts");
    const { getRemoteAcceptanceRunbookRecords, saveRemoteAcceptanceRunbookFromConnectionTest } = await import("./server/remoteAcceptance.ts");
    const tailscale = saveRemoteAcceptanceRunbookFromConnectionTest({
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      result: {
        ok: true,
        status: 200,
        url: "https://lifeos.tailnet.example.ts.net/api/v1/health",
        latencyMs: 33,
        steps: [
          { id: "health", ok: true, status: 200, url: "https://lifeos.tailnet.example.ts.net/api/v1/health", latencyMs: 10 },
          { id: "mobile-shell", ok: true, status: 200, url: "https://lifeos.tailnet.example.ts.net/mobile/chat", latencyMs: 11 },
          { id: "websocket", ok: true, status: 101, url: "wss://lifeos.tailnet.example.ts.net/api/v1/ws", latencyMs: 12 },
        ],
      },
    }, { type: "admin", id: "owner" });
    const temporary = saveRemoteAcceptanceRunbookFromConnectionTest({
      baseUrl: "https://demo.trycloudflare.com",
      result: {
        ok: true,
        status: 200,
        url: "https://demo.trycloudflare.com/api/v1/health",
        latencyMs: 20,
        steps: [{ id: "health", ok: true, status: 200, url: "https://demo.trycloudflare.com/api/v1/health", latencyMs: 20 }],
      },
    }, { type: "admin", id: "owner" });
    process.stdout.write(JSON.stringify({ tailscale, temporary, validation: getRemoteValidationReport(), records: getRemoteAcceptanceRunbookRecords() }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.tailscale.entryKind, "tailscale-https");
  assert.equal(result.tailscale.longTermReady, true);
  assert.equal(result.tailscale.completionStatus, "automated-ready-manual-required");
  assert.equal(result.tailscale.automatedChecks.httpsStatus.ok, true);
  assert.equal(result.tailscale.automatedChecks.httpsStatus.protocol, "https");
  assert.equal(result.temporary.entryKind, "temporary-cloudflare");
  assert.equal(result.temporary.longTermReady, false);
  assert.equal(result.temporary.automatedChecks.httpsStatus.ok, true);
  assert.equal(result.temporary.completionStatus, "not-ready");
  assert.match(result.temporary.longTermReason, /Temporary/);
  assert.equal(result.validation.label, "remote-acceptance:temporary-cloudflare");
  assert.equal(result.records.length, 2);
});

test("remote acceptance summary requires a long-term entry and real-world evidence", async () => {
  const { summarizeRemoteAcceptanceChecklist } = await import(`../server/remoteAcceptance.ts?summary=${Date.now()}`);
  const baseChecklist = [
    { id: "tailscale-https-serve", status: "passed" },
    { id: "cloudflare-named-tunnel", status: "needs-action" },
    { id: "remote-smoke", status: "passed" },
    { id: "restart-restore", status: "manual-required" },
    { id: "cellular-mobile-chat", status: "manual-required" },
    { id: "network-switch", status: "manual-required" },
    { id: "stale-qr-repair", status: "manual-required" },
    { id: "network-interruption", status: "manual-required" },
    { id: "diagnostic-export", status: "manual-required" },
    { id: "ci-remote-mock", status: "passed" },
  ];
  const incomplete = summarizeRemoteAcceptanceChecklist(baseChecklist);
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.hasLongTermEntry, true);
  assert.equal(incomplete.hasRealWorldEvidence, false);
  assert.equal(incomplete.manualRequired, 6);
  assert.equal(incomplete.blockingItems.length, 6);
  assert.equal(incomplete.blockingItems[0].id, "restart-restore");
  assert.equal(incomplete.blockingItems[0].status, "manual-required");
  assert.equal(incomplete.blockingItems.some((item) => item.id === "cloudflare-named-tunnel"), false);

  const complete = summarizeRemoteAcceptanceChecklist(baseChecklist.map((item) => (
    item.status === "manual-required" ? { ...item, status: "passed" } : item
  )));
  assert.equal(complete.ready, true);
  assert.equal(complete.hasLongTermEntry, true);
  assert.equal(complete.hasRealWorldEvidence, true);
  assert.equal(complete.passed, 9);
  assert.deepEqual(complete.blockingItems, []);
});
