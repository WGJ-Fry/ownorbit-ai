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

test("remote health monitor exposes scheduler status", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-health-status-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    process.env.LIFEOS_REMOTE_HEALTH_INTERVAL_MS = "30000";
    const { getRemoteHealthMonitorStatus, startRemoteHealthMonitor } = await import("./server/remoteHealthMonitor.ts");
    const before = getRemoteHealthMonitorStatus();
    startRemoteHealthMonitor();
    const after = getRemoteHealthMonitorStatus();
    process.stdout.write(JSON.stringify({ before, after }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_REMOTE_HEALTH_MONITOR: "1" },
    encoding: "utf8",
  });
  const { before, after } = JSON.parse(output);
  assert.equal(before.enabled, true);
  assert.equal(before.running, false);
  assert.equal(after.enabled, true);
  assert.equal(after.running, true);
  assert.equal(after.inFlight, false);
  assert.equal(after.intervalMs, 30000);
  assert.equal(typeof after.startedAt, "number");
  assert.equal(typeof after.nextRunAt, "number");
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
  assert.equal(result.recovery.healthOkBefore, false);
  assert.equal(result.recovery.healthOkAfter, true);
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
    const expiredQr = summarizeRemoteHealth({ baseUrl: "https://lifeos.tailnet.example.ts.net", readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" }, report, pairingSession: { expiresAt: now - 1 }, now });
    const mismatchedQr = summarizeRemoteHealth({ baseUrl: "https://lifeos.tailnet.example.ts.net", readiness: { status: "ready", baseUrl: "https://lifeos.tailnet.example.ts.net" }, report, pairingSession: { baseUrl: "https://old.trycloudflare.com", expiresAt: now + 60_000 }, now });
    const custom = summarizeRemoteHealth({ baseUrl: "https://remote.example.com", readiness: { status: "blocked", baseUrl: "https://remote.example.com" }, report: null, now });
    process.stdout.write(JSON.stringify({ healthy, temporary, insecure, stale, expiredQr, mismatchedQr, custom }));
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
  assert.equal(result.temporary.status, "temporary");
  assert.equal(result.temporary.entryKind, "temporary-cloudflare");
  assert.equal(result.temporary.checks.find((check) => check.id === "qr-entry").status, "warning");
  assert.equal(result.insecure.status, "insecure");
  assert.equal(result.insecure.entryKind, "insecure-http");
  assert.equal(result.insecure.checks.find((check) => check.id === "https").status, "fail");
  assert.equal(result.stale.status, "stale");
  assert.equal(result.expiredQr.status, "healthy");
  assert.equal(result.expiredQr.severity, "warning");
  assert.equal(result.expiredQr.entryKind, "tailscale");
  assert.equal(result.custom.entryKind, "custom");
  assert.equal(result.expiredQr.checks.find((check) => check.id === "qr-entry").status, "warning");
  assert.equal(result.expiredQr.recommendations.includes("ready"), true);
  assert.equal(result.expiredQr.recommendations.includes("refresh-pairing-qr"), true);
  assert.equal(result.mismatchedQr.status, "healthy");
  assert.equal(result.mismatchedQr.severity, "warning");
  assert.equal(result.mismatchedQr.checks.find((check) => check.id === "qr-entry").status, "warning");
  assert.equal(result.mismatchedQr.checks.find((check) => check.id === "qr-entry").detail, "https://old.trycloudflare.com");
  assert.equal(result.mismatchedQr.recommendations.includes("refresh-pairing-qr"), true);
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
      note: "Phone cellular /mobile/chat verified with token=secret",
      evidence: {
        source: "admin-long-term-remote-checklist",
        requirements: [
          "Saved remote entry: https://lifeos.tailnet.example.ts.net",
          "Phone Wi-Fi disabled and /mobile/chat verified over cellular data.",
          "secret=hidden",
        ],
      },
    }, { type: "admin", id: "owner" });
    saveRemoteAcceptanceRecord({
      id: "network-interruption",
      baseUrl: "https://lifeos.tailnet.example.ts.net",
      note: "Tailscale disconnected and reconnected with token=secret",
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
  assert.equal(cellularRecord.evidence.source, "admin-long-term-remote-checklist");
  assert.equal(cellularRecord.evidence.requirements.some((item) => item.includes("token=secret") || item.includes("secret=hidden")), false);
  assert.equal(checklist.find((item) => item.id === "tailscale-https-serve").status, "passed");
  assert.equal(checklist.find((item) => item.id === "remote-smoke").status, "passed");
  assert.equal(checklist.find((item) => item.id === "restart-restore").status, "passed");
  assert.match(checklist.find((item) => item.id === "cellular-mobile-chat").evidence, /Phone cellular/);
  assert.doesNotMatch(checklist.find((item) => item.id === "cellular-mobile-chat").evidence, /secret=hidden/);
  assert.equal(checklist.find((item) => item.id === "cloudflare-named-tunnel").status, "needs-action");
  assert.equal(checklist.find((item) => item.id === "cellular-mobile-chat").status, "passed");
  assert.equal(checklist.find((item) => item.id === "cellular-mobile-chat").evidence.includes("secret"), false);
  assert.equal(checklist.find((item) => item.id === "network-interruption").status, "passed");
  assert.equal(checklist.find((item) => item.id === "network-interruption").evidence.includes("secret"), false);
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
  assert.equal(checklist.find((item) => item.id === "diagnostic-export").status, "manual-required");
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
    process.stdout.write(JSON.stringify({ record, validation, records: getRemoteAcceptanceRunbookRecords(), attempts }));
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
  assert.equal(result.record.longTermReason.includes("secret"), false);
  assert.equal(result.validation.ok, true);
  assert.equal(result.validation.label, "remote-acceptance:tailscale-https");
  assert.equal(result.validation.passed, 3);
  assert.equal(result.records.length, 1);
  assert.equal(result.attempts.filter((item) => item === "accepted").length, 0);
  assert.match(result.attempts.join("\\n"), /HTTPS/);
  assert.match(result.attempts.join("\\n"), /username, password, token, query, or fragment/);
  assert.match(result.attempts.join("\\n"), /unsupported entry kind/);
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
  assert.equal(result.temporary.entryKind, "temporary-cloudflare");
  assert.equal(result.temporary.longTermReady, false);
  assert.equal(result.temporary.completionStatus, "not-ready");
  assert.match(result.temporary.longTermReason, /Temporary/);
  assert.equal(result.validation.label, "remote-acceptance:temporary-cloudflare");
  assert.equal(result.records.length, 2);
});
