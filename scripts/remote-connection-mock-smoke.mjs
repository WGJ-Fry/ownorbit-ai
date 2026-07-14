#!/usr/bin/env node
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { runRemoteConnectionSmoke } from "./remote-connection-smoke.mjs";

const basePath = process.env.LIFEOS_REMOTE_MOCK_BASE_PATH || "/lifeos";

const server = createServer((req, res) => {
  if (req.url === `${basePath}/api/v1/health`) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "lifeos-local-core" }));
    return;
  }
  if (req.url === `${basePath}/mobile/chat`) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>OwnOrbit AI</title><div id=\"root\"></div>");
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== `${basePath}/api/v1/ws`) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.close(1000, "remote-mock-smoke-ok");
  });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}${basePath}`;
  const result = await runRemoteConnectionSmoke(baseUrl, { timeoutMs: 3000 });
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`[${status}] Remote mock smoke ${result.passed}/${result.total} checks passed`);
  for (const step of result.steps) {
    console.log(`- ${step.ok ? "PASS" : "FAIL"} ${step.id} ${step.url}${step.error ? ` (${step.error})` : ""}`);
  }
  if (!result.ok) process.exitCode = 1;
} finally {
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
