// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Importing the module loads the tunnel manager and its database; keep both
// away from any real OwnOrbit data directory.
process.env.LIFEOS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "lifeos-remote-entry-shutdown-data-"));
const { createRemoteEntryShutdown } = await import("../server/remoteEntryShutdown.ts");

test.after(async () => {
  await rm(process.env.LIFEOS_DATA_DIR, { recursive: true, force: true });
});

function recordingSteps(overrides = {}) {
  const calls = [];
  const warnings = [];
  let waits = 0;
  const steps = {
    signalCloudflareTunnels: () => calls.push("cloudflared-sigterm"),
    stopTailscaleServe: () => {
      calls.push("tailscale-serve-off");
      return { stopped: true, reason: "stopped" };
    },
    cleanupTailscaleSocket: () => calls.push("tailscale-socket-cleanup"),
    clearRuntimeEnv: () => calls.push("runtime-env-cleanup"),
    // cloudflared that never confirms it exited: the graceful wait hangs.
    waitForCloudflareTunnels: () => {
      waits += 1;
      return new Promise(() => {});
    },
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  return { steps, calls, warnings, waits: () => waits };
}

test("quit cleanup turns Tailscale Serve off and removes the socket before waiting for cloudflared", () => {
  const { steps, calls, waits } = recordingSteps();
  const cleanup = createRemoteEntryShutdown(steps);

  const first = cleanup();
  // Nothing has been awaited yet — this is all a process "exit" handler gets.
  assert.deepEqual(calls, ["cloudflared-sigterm", "tailscale-serve-off", "tailscale-socket-cleanup", "runtime-env-cleanup"]);
  assert.equal(waits(), 1);

  // SIGTERM then "exit": the second call re-sends the idempotent cloudflared
  // signal (a child may have slipped in since) and shares the first wait.
  const second = cleanup();
  assert.equal(second, first);
  assert.deepEqual(calls, ["cloudflared-sigterm", "tailscale-serve-off", "tailscale-socket-cleanup", "runtime-env-cleanup", "cloudflared-sigterm"]);
  assert.equal(waits(), 1);
});

test("a failing quit cleanup step never skips the ones after it", async () => {
  const { steps, calls, warnings } = recordingSteps({
    signalCloudflareTunnels: () => {
      calls.push("cloudflared-sigterm");
      throw new Error("kill failed");
    },
    stopTailscaleServe: () => {
      calls.push("tailscale-serve-off");
      return { stopped: false, reason: "stop-failed", error: "tailscale serve refused" };
    },
    waitForCloudflareTunnels: () => Promise.reject(new Error("cloudflared wait failed")),
  });
  const cleanup = createRemoteEntryShutdown(steps);

  const pending = cleanup();
  assert.deepEqual(calls, ["cloudflared-sigterm", "tailscale-serve-off", "tailscale-socket-cleanup", "runtime-env-cleanup"]);
  await pending;
  assert.equal(warnings.some((message) => /Cloudflare Tunnel shutdown signal failed/.test(message)), true);
  assert.equal(warnings.some((message) => /Tailscale HTTPS Serve shutdown cleanup failed/.test(message)), true);
  assert.equal(warnings.some((message) => /Cloudflare Tunnel shutdown failed/.test(message)), true);
});

test("process exit with a quick tunnel in its handoff window still turns Serve off and stops every cloudflared", async (t) => {
  const binDir = mkdtempSync(path.join(tmpdir(), "lifeos-remote-entry-shutdown-bin-"));
  const dataDir = mkdtempSync(path.join(tmpdir(), "lifeos-remote-entry-shutdown-exit-"));
  const stateDir = path.join(dataDir, "fake-cli-state");
  const credentialsFile = path.join(dataDir, "named-tunnel.json");
  t.after(async () => {
    const pids = existsSync(path.join(stateDir, "cloudflared-pids"))
      ? (await readFile(path.join(stateDir, "cloudflared-pids"), "utf8")).split("\n").filter(Boolean)
      : [];
    for (const pid of pids) {
      try { process.kill(Number(pid), "SIGKILL"); } catch {}
    }
    await rm(binDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });
  mkdirSync(stateDir, { recursive: true });
  await writeFile(credentialsFile, "{}");
  const cloudflaredPath = path.join(binDir, "cloudflared");
  await writeFile(cloudflaredPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "cloudflared version 2026.6.0"
  exit 0
fi
echo "$$" >> "${stateDir}/cloudflared-pids"
trap 'echo "$$" >> "${stateDir}/cloudflared-terminated"; exit 0' TERM INT
if [ "$2" = "--url" ]; then
  echo "INF Requesting new quick Tunnel on https://handoff-lifeos.trycloudflare.com" >&2
else
  echo "INF Registered tunnel connection" >&2
fi
while true; do sleep 1 & wait $!; done
`);
  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","DNSName":"lifeos-mac.tailnet.example.ts.net.","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  if [ -f "${stateDir}/serving" ]; then
    echo '{"Web":{"lifeos-mac.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  else
    echo '{}'
  fi
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "--bg" ]; then
  touch "${stateDir}/serving"
  exit 0
fi
if [ "$1" = "serve" ] && [ "$3" = "off" ]; then
  rm -f "${stateDir}/serving"
  echo "off" >> "${stateDir}/tailscale-serve-off"
  exit 0
fi
exit 1
`);
  const pgrepPath = path.join(binDir, "pgrep");
  await writeFile(pgrepPath, "#!/bin/sh\nexit 1\n");
  await chmod(cloudflaredPath, 0o755);
  await chmod(tailscalePath, 0o755);
  await chmod(pgrepPath, 0o755);

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const tunnels = await import("./server/cloudflareTunnel.ts");
    const { startTailscaleHttpsServe } = await import("./server/networkDiagnostics.ts");
    const { createOwnedRemoteEntryShutdown } = await import("./server/remoteEntryShutdown.ts");
    const quick = await tunnels.startManagedCloudflareTunnel("4567", 3000);
    tunnels.generateCloudflareNamedTunnelConfig({
      name: "lifeos-ai",
      hostname: "lifeos.example.com",
      credentialsFile: ${JSON.stringify(credentialsFile)},
      port: "4567",
    });
    const named = await tunnels.startConfiguredCloudflareNamedTunnel(3000);
    startTailscaleHttpsServe("4567");
    process.stdout.write(JSON.stringify({ quickPid: quick.pid, namedPid: named.pid, handoff: named.handoff }));
    const cleanup = createOwnedRemoteEntryShutdown({ port: "4567", tailscaleSocketPath: "" });
    process.once("exit", () => { void cleanup(); });
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
      LIFEOS_TAILSCALE_BIN: tailscalePath,
      LIFEOS_ICLOUD_DRIVE_DIR: path.join(dataDir, "no-icloud"),
      PUBLIC_BASE_URL: "",
      APP_URL: "",
    },
    encoding: "utf8",
  });
  const started = JSON.parse(output);
  assert.equal(started.handoff.running, true);
  assert.equal(started.handoff.pid, started.quickPid);
  assert.equal(started.handoff.url, "https://handoff-lifeos.trycloudflare.com");

  // The Tailscale CLI runs synchronously, so its record exists the moment the
  // process is gone.
  assert.equal(await readFile(path.join(stateDir, "tailscale-serve-off"), "utf8"), "off\n");
  assert.equal(existsSync(path.join(stateDir, "serving")), false);

  // Both cloudflared children — the named tunnel and the quick tunnel in its
  // handoff window — received SIGTERM before the process went away.
  const expected = [String(started.quickPid), String(started.namedPid)].sort();
  const deadline = Date.now() + 5000;
  let terminated = [];
  while (Date.now() < deadline) {
    terminated = existsSync(path.join(stateDir, "cloudflared-terminated"))
      ? (await readFile(path.join(stateDir, "cloudflared-terminated"), "utf8")).split("\n").filter(Boolean).sort()
      : [];
    if (terminated.length >= expected.length) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(terminated, expected);
});
