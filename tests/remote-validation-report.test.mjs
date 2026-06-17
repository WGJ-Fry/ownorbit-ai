// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
