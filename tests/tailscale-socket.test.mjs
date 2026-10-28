import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cleanupTailscaleSocket,
  prepareTailscaleSocketPath,
  protectTailscaleSocket,
  tailscaleServeTarget,
} from "../server/tailscaleSocket.ts";

test("Windows Tailscale target requires the per-run private relay instead of the public core port", () => {
  assert.equal(tailscaleServeTarget("3000", { platform: "win32", windowsRelayPort: "49152" }), "http://127.0.0.1:49152");
  assert.equal(tailscaleServeTarget("3000", { platform: "win32", windowsRelayPort: "" }), "");
});

test("macOS Tailscale Serve uses the loopback-only core", () => {
  const originalSocketPath = process.env.LIFEOS_TAILSCALE_SOCKET_PATH;
  process.env.LIFEOS_TAILSCALE_SOCKET_PATH = "/private/ownorbit/core.sock";
  try {
    assert.equal(tailscaleServeTarget("3000", { platform: "darwin" }), "http://127.0.0.1:3000");
  } finally {
    if (originalSocketPath === undefined) delete process.env.LIFEOS_TAILSCALE_SOCKET_PATH;
    else process.env.LIFEOS_TAILSCALE_SOCKET_PATH = originalSocketPath;
  }
});

test("private Tailscale socket serves OwnOrbit with owner-only permissions and cleans up", { skip: process.platform !== "linux" }, async () => {
  const originalDataDir = process.env.LIFEOS_DATA_DIR;
  const originalSocketPath = process.env.LIFEOS_TAILSCALE_SOCKET_PATH;
  const root = await mkdtemp(path.join(os.tmpdir(), "ownorbit-tailscale-socket-"));
  process.env.LIFEOS_DATA_DIR = path.join(root, "data");
  delete process.env.LIFEOS_TAILSCALE_SOCKET_PATH;

  let server;
  try {
    const socketPath = prepareTailscaleSocketPath();
    assert.equal(tailscaleServeTarget("3000"), `unix:${socketPath}`);
    assert.equal((await stat(path.dirname(socketPath))).mode & 0o777, 0o700);

    server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ service: "ownorbit-local-core" }));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    protectTailscaleSocket(socketPath);
    assert.equal((await stat(socketPath)).mode & 0o777, 0o600);

    const payload = await new Promise((resolve, reject) => {
      const request = http.get({ socketPath, path: "/api/v1/health" }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      });
      request.on("error", reject);
    });
    assert.equal(payload.status, 200);
    assert.equal(JSON.parse(payload.body).service, "ownorbit-local-core");

    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server = undefined;
    cleanupTailscaleSocket(socketPath);
    await assert.rejects(stat(socketPath), { code: "ENOENT" });
  } finally {
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    if (originalDataDir === undefined) delete process.env.LIFEOS_DATA_DIR;
    else process.env.LIFEOS_DATA_DIR = originalDataDir;
    if (originalSocketPath === undefined) delete process.env.LIFEOS_TAILSCALE_SOCKET_PATH;
    else process.env.LIFEOS_TAILSCALE_SOCKET_PATH = originalSocketPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("private Tailscale socket refuses outside paths and regular-file replacement", { skip: process.platform !== "linux" }, async () => {
  const originalDataDir = process.env.LIFEOS_DATA_DIR;
  const originalSocketPath = process.env.LIFEOS_TAILSCALE_SOCKET_PATH;
  const root = await mkdtemp(path.join(os.tmpdir(), "ownorbit-tailscale-socket-safety-"));
  const dataDir = path.join(root, "data");
  try {
    process.env.LIFEOS_DATA_DIR = dataDir;
    process.env.LIFEOS_TAILSCALE_SOCKET_PATH = path.join(root, "outside.sock");
    assert.throws(() => prepareTailscaleSocketPath(), /private runtime directory/);

    const socketPath = path.join(dataDir, "runtime", "tailscale", "core.sock");
    await mkdir(path.dirname(socketPath), { recursive: true });
    await writeFile(socketPath, "do-not-delete");
    process.env.LIFEOS_TAILSCALE_SOCKET_PATH = socketPath;
    assert.throws(() => prepareTailscaleSocketPath(), /refused to replace a non-socket file/);
    assert.equal(await readFile(socketPath, "utf8"), "do-not-delete");
  } finally {
    if (originalDataDir === undefined) delete process.env.LIFEOS_DATA_DIR;
    else process.env.LIFEOS_DATA_DIR = originalDataDir;
    if (originalSocketPath === undefined) delete process.env.LIFEOS_TAILSCALE_SOCKET_PATH;
    else process.env.LIFEOS_TAILSCALE_SOCKET_PATH = originalSocketPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("Tailscale Serve CLI output never carries the private socket path out of the process", async () => {
  const { redactTailscaleServeTarget } = await import("../server/networkDiagnostics.ts");
  const socketPath = "/home/alice/.config/OwnOrbit AI/data/runtime/tailscale/core.sock";
  const target = `unix:${socketPath}`;
  const cliOutput = [
    "Available within your tailnet:",
    "",
    "https://mac.tailnet.ts.net/",
    `|-- / proxy ${target}`,
    `error: could not reach ${socketPath}`,
  ].join("\n");

  const redacted = redactTailscaleServeTarget(cliOutput, target);
  assert.equal(redacted.includes(socketPath), false);
  assert.equal(redacted.includes("alice"), false);
  assert.match(redacted, /\|-- \/ proxy unix:\[OwnOrbit private socket\]/);
  // The public hostname stays readable.
  assert.match(redacted, /https:\/\/mac\.tailnet\.ts\.net\//);
});

test("a loopback Serve target is not private and is left as is", async () => {
  const { redactTailscaleServeTarget } = await import("../server/networkDiagnostics.ts");
  if (process.platform === "win32") return;
  const output = "|-- / proxy http://127.0.0.1:3000";
  assert.equal(redactTailscaleServeTarget(output, "http://127.0.0.1:3000"), output);
  assert.equal(redactTailscaleServeTarget("", "unix:/tmp/x.sock"), "");
});
