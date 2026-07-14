import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { classifyRemoteEntry, normalizeRemoteBaseUrl, resolveRemoteBaseUrl, runRemoteConnectionSmoke } from "../scripts/remote-connection-smoke.mjs";
import { runRemoteAcceptanceRunbook } from "../scripts/remote-acceptance-runbook.mjs";

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("remote connection smoke verifies health, mobile shell, and websocket", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/lifeos/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "lifeos-local-core" }));
      return;
    }
    if (req.url === "/lifeos/mobile/chat") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>OwnOrbit AI</title><div id=\"root\"></div>");
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
  const result = await runRemoteConnectionSmoke(`http://127.0.0.1:${port}/lifeos`, { timeoutMs: 2000 });
  assert.equal(result.ok, true);
  assert.equal(result.baseUrl, `http://127.0.0.1:${port}/lifeos`);
  assert.equal(result.entryKind, "local");
  assert.equal(result.longTermCandidate, false);
  assert.match(result.longTermReason, /desktop/);
  assert.equal(result.httpsStatus.ok, false);
  assert.equal(result.httpsStatus.protocol, "http");
  assert.match(result.httpsStatus.error, /not using HTTPS/);
  assert.deepEqual(result.steps.map((step) => step.ok), [true, true, true]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("remote connection smoke classifies long-term and temporary entries", () => {
  assert.deepEqual(classifyRemoteEntry("https://mac.tailnet.example.ts.net/lifeos"), {
    entryKind: "tailscale-https",
    longTermCandidate: true,
    longTermReason: "Tailscale HTTPS Serve is a recommended long-term remote entry.",
  });
  assert.deepEqual(classifyRemoteEntry("https://lifeos.example.com"), {
    entryKind: "stable-https",
    longTermCandidate: true,
    longTermReason: "This is an HTTPS non-temporary remote entry; confirm the domain is controlled and restart recovery works.",
  });
  assert.equal(classifyRemoteEntry("https://fresh.trycloudflare.com").entryKind, "temporary-cloudflare");
  assert.equal(classifyRemoteEntry("https://fresh.trycloudflare.com").longTermCandidate, false);
  assert.equal(classifyRemoteEntry("http://192.168.1.20:3000").entryKind, "insecure-http");
  assert.equal(classifyRemoteEntry("http://127.0.0.1:3000").entryKind, "local");
});

test("remote connection smoke rejects unsafe or broken entries", async () => {
  assert.throws(() => normalizeRemoteBaseUrl("ftp://example.com/lifeos"), /HTTP or HTTPS/);
  assert.throws(() => normalizeRemoteBaseUrl("https://user:pass@example.com/lifeos"), /username or password/);
  assert.throws(() => normalizeRemoteBaseUrl("https://example.com/lifeos?token=secret"), /query parameters or fragments/);
  assert.throws(() => normalizeRemoteBaseUrl("https://example.com/lifeos#debug"), /query parameters or fragments/);
  const cli = spawnSync(process.execPath, ["scripts/remote-connection-smoke.mjs", "https://user:pass@example.com/lifeos"], {
    encoding: "utf8",
  });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /username or password/);
  const queryCli = spawnSync(process.execPath, ["scripts/remote-connection-smoke.mjs", "https://example.com/lifeos?token=secret"], {
    encoding: "utf8",
  });
  assert.equal(queryCli.status, 1);
  assert.match(queryCli.stderr, /query parameters or fragments/);

  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const result = await runRemoteConnectionSmoke(`http://127.0.0.1:${port}`, { timeoutMs: 500 });
    assert.equal(result.ok, false);
    assert.equal(result.steps.some((step) => !step.ok), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("remote connection smoke resolves env and saved desktop runtime config", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-smoke-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });
  const configPath = path.join(dataDir, "desktop-runtime-config.json");

  assert.equal(
    resolveRemoteBaseUrl("", { LIFEOS_REMOTE_BASE_URL: "https://env.example.com/lifeos" }),
    "https://env.example.com/lifeos",
  );
  assert.throws(
    () => resolveRemoteBaseUrl("", { LIFEOS_REMOTE_BASE_URL: "https://env.example.com/lifeos?token=secret#debug" }),
    /query parameters or fragments/,
  );

  await writeFile(configPath, JSON.stringify({
    mode: "tailscale",
    publicBaseUrl: "https://mac.tailnet.example.ts.net/lifeos",
    baseUrl: "https://mac.tailnet.example.ts.net/lifeos",
  }));
  assert.equal(
    resolveRemoteBaseUrl("", { LIFEOS_DESKTOP_RUNTIME_CONFIG: configPath }),
    "https://mac.tailnet.example.ts.net/lifeos",
  );

  await writeFile(configPath, JSON.stringify({
    mode: "lan",
    publicBaseUrl: "",
    baseUrl: "http://192.168.1.20:3000",
  }));
  assert.throws(
    () => resolveRemoteBaseUrl("", { LIFEOS_DESKTOP_RUNTIME_CONFIG: configPath }),
    /local\/LAN only/,
  );
});

test("remote acceptance runbook writes long-term evidence and manual steps", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-remote-acceptance-runbook-"));
  const server = createServer((req, res) => {
    if (req.url === "/lifeos/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "lifeos-local-core" }));
      return;
    }
    if (req.url === "/lifeos/mobile/chat") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>OwnOrbit AI</title><div id=\"root\"></div>");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/lifeos/api/v1/ws") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(1000, "ok"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });

  const { port } = server.address();
  const report = await runRemoteAcceptanceRunbook(`http://127.0.0.1:${port}/lifeos`, { timeoutMs: 2000 });
  assert.equal(report.automatedChecks.ok, true);
  assert.equal(report.entryKind, "local");
  assert.equal(report.longTermReady, false);
  assert.equal(report.realWorldAcceptanceRequired, true);
  assert.equal(report.completionStatus, "not-ready");
  assert.equal(report.automatedChecks.httpsStatus.ok, false);
  assert.equal(report.automatedChecks.httpsStatus.requiredForLongTerm, true);
  assert.match(report.longTermReason, /desktop/);
  assert.equal(report.manualAcceptance.some((step) => step.id === "cellular-mobile-chat"), true);
  assert.equal(report.manualAcceptance.some((step) => step.id === "network-switch"), true);
  assert.equal(report.manualAcceptance.some((step) => step.id === "stale-qr-repair"), true);
  assert.equal(JSON.stringify(report).includes("secret"), false);

  const outPath = path.join(dataDir, "acceptance.json");
  const unsafeCli = await runNode(["scripts/remote-acceptance-runbook.mjs", `http://127.0.0.1:${port}/lifeos?token=secret`, "--json"]);
  assert.equal(unsafeCli.status, 1);
  assert.match(unsafeCli.stderr, /query parameters or fragments/);

  const cli = await runNode(["scripts/remote-acceptance-runbook.mjs", `http://127.0.0.1:${port}/lifeos`, "--out", outPath, "--json"]);
  assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
  const written = await readFile(outPath, "utf8");
  assert.equal(written.includes("secret"), false);
  assert.match(written, /network-interruption/);
  assert.match(written, /network-switch/);
  assert.match(written, /stale-qr-repair/);
  assert.match(written, /realWorldAcceptanceRequired/);
  assert.match(written, /httpsStatus/);
});
