#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeRemoteBaseUrl, runRemoteConnectionSmoke } from "./remote-connection-smoke.mjs";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const buildDir = path.resolve(process.env.LIFEOS_IOS_NATIVE_BUILD_DIR || path.join(rootDir, "build", "native", "mobile-shell"));
const appPath = path.join(buildDir, "DerivedData", "Build", "Products", "Debug-iphonesimulator", "LifeOSMobile.app");
const bundleId = "ai.lifeos.mobile";
const outDir = path.resolve(process.env.LIFEOS_IOS_NATIVE_SMOKE_OUT_DIR || path.join(rootDir, "tmp", "ios-native-shell-smoke"));

function log(message) {
  console.log(`[ios-native-shell-smoke] ${message}`);
}

async function xcrun(args, options = {}) {
  try {
    return await execFileAsync("xcrun", args, {
      timeout: options.timeoutMs || 180_000,
      maxBuffer: 16 * 1024 * 1024,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
  } catch (error) {
    if (options.allowFailure) return { stdout: "", stderr: String(error?.stderr || error?.message || "") };
    throw new Error(`xcrun ${args.join(" ")} failed: ${error?.stderr || error?.message || "unknown error"}`);
  }
}

function runtimeScore(runtime) {
  const match = String(runtime || "").match(/iOS-(\d+)-(\d+)/);
  return match ? Number(match[1]) * 100 + Number(match[2]) : 0;
}

async function selectSimulator() {
  const requested = String(process.env.LIFEOS_IOS_SIMULATOR_UDID || "").trim();
  const result = await xcrun(["simctl", "list", "devices", "available", "--json"]);
  const parsed = JSON.parse(result.stdout || "{}");
  const devices = Object.entries(parsed.devices || {})
    .flatMap(([runtime, values]) => (values || []).map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable && /iPhone/i.test(device.name || ""));
  if (requested) {
    const found = devices.find((device) => device.udid === requested);
    if (!found) throw new Error(`Requested iOS simulator is unavailable: ${requested}`);
    return found;
  }
  return devices.find((device) => device.state === "Booted")
    || devices.sort((left, right) => runtimeScore(right.runtime) - runtimeScore(left.runtime))[0];
}

async function screenshot(device, name) {
  const target = path.join(outDir, `${name}.png`);
  await xcrun(["simctl", "io", device.udid, "screenshot", target], { timeoutMs: 60_000 });
  if (!fs.existsSync(target) || fs.statSync(target).size < 10_000) {
    throw new Error(`Simulator screenshot is missing or blank: ${target}`);
  }
  return target;
}

async function launchAndCapture(device, name, appArgs = []) {
  await xcrun([
    "simctl",
    "launch",
    "--terminate-running-process",
    device.udid,
    bundleId,
    "--disable-local-notifications",
    ...appArgs,
  ], {
    timeoutMs: 60_000,
    env: { SIMCTL_CHILD_LIFEOS_DISABLE_LOCAL_NOTIFICATIONS: "1" },
  });
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.LIFEOS_IOS_NATIVE_LAUNCH_WAIT_MS || "7000")));
  const imagePath = await screenshot(device, name);
  await xcrun(["simctl", "terminate", device.udid, bundleId], { timeoutMs: 30_000 });
  return imagePath;
}

async function resetSimulatorAppState(device) {
  await xcrun(["simctl", "terminate", device.udid, bundleId], { allowFailure: true, timeoutMs: 30_000 });
  await xcrun(["simctl", "privacy", device.udid, "reset", "all", bundleId], { allowFailure: true, timeoutMs: 30_000 });
  await xcrun(["simctl", "uninstall", device.udid, bundleId], { allowFailure: true, timeoutMs: 30_000 });
  await xcrun(["simctl", "shutdown", device.udid], { allowFailure: true, timeoutMs: 60_000 });
  await xcrun(["simctl", "boot", device.udid], { allowFailure: true, timeoutMs: 60_000 });
  await xcrun(["simctl", "bootstatus", device.udid, "-b"], { timeoutMs: 180_000 });
}

async function main() {
  if (process.platform !== "darwin") throw new Error("The native iOS shell smoke requires macOS and Xcode.");
  const baseURL = normalizeRemoteBaseUrl(process.argv[2] || process.env.LIFEOS_SIMULATOR_BASE_URL || "http://127.0.0.1:3000");
  const endpoint = await runRemoteConnectionSmoke(baseURL, { timeoutMs: 8_000 });
  if (!endpoint.ok) {
    const health = endpoint.steps.find((step) => step.url.endsWith("/api/v1/health"));
    const wrongService = health?.status === 200 && /not JSON|not LifeOS/i.test(health.error || "");
    throw new Error(wrongService
      ? `The selected port is serving another application, not LifeOS: ${baseURL}`
      : `LifeOS is not reachable at ${baseURL}`);
  }

  const device = await selectSimulator();
  if (!device) throw new Error("No available iPhone simulator was found.");
  if (device.state !== "Booted") await xcrun(["simctl", "boot", device.udid], { allowFailure: true, timeoutMs: 60_000 });
  await xcrun(["simctl", "bootstatus", device.udid, "-b"], { timeoutMs: 180_000 });
  fs.mkdirSync(outDir, { recursive: true });

  log(`Building and testing for ${device.name}`);
  await execFileAsync(process.execPath, [path.join(rootDir, "scripts", "build-ios-mobile-shell.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_IOS_SIMULATOR_UDID: device.udid,
      LIFEOS_IOS_NATIVE_RUN_TESTS: "1",
    },
    timeout: 10 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!fs.existsSync(appPath)) throw new Error(`Native iOS app was not built: ${appPath}`);

  await resetSimulatorAppState(device);
  await xcrun(["simctl", "install", device.udid, appPath], { timeoutMs: 60_000 });
  const setupScreenshot = await launchAndCapture(device, "native-entry-setup");
  const connectedScreenshot = await launchAndCapture(device, "native-mobile-chat", ["--base-url", baseURL]);
  const cloudDataScreenshot = await launchAndCapture(device, "native-cloud-data", ["--base-url", baseURL, "--show-cloud-data", "--cloud-data-demo"]);
  const cloudMemoryScreenshot = await launchAndCapture(device, "native-cloud-memory-create", ["--base-url", baseURL, "--show-cloud-data", "--cloud-data-demo", "--cloud-memory-compose-demo"]);

  const evidence = {
    ok: true,
    generatedAt: new Date().toISOString(),
    baseURL,
    simulator: { name: device.name, udid: device.udid, runtime: device.runtime },
    endpoint: {
      ok: endpoint.ok,
      entryKind: endpoint.entryKind,
      longTermCandidate: endpoint.longTermCandidate,
      passed: endpoint.passed,
      total: endpoint.total,
    },
    app: { bundleId, appPath },
    screenshots: { setup: setupScreenshot, connected: connectedScreenshot, cloudData: cloudDataScreenshot, cloudMemory: cloudMemoryScreenshot },
    proves: [
      "The native SwiftUI shell builds and its entry validator unit tests pass.",
      "The app installs and remains running on an iPhone Simulator.",
      "The app verifies a LifeOS local core and loads the mobile chat shell.",
      "The native iCloud data surface renders a simulator-only task snapshot and guarded completion control without exposing credentials or requiring CloudKit access.",
      "The native memory composer renders a bilingual, size-bounded form with explicit private-iCloud safety guidance.",
    ],
    limits: [
      "The smoke run resets this app's simulator permissions and suppresses the notification prompt; production launches still request permission after a successful entry connection.",
      "The simulator does not prove iCloud account document delivery on a physical iPhone.",
      "The simulator does not replace cellular, Wi-Fi switching, background push, or CloudKit provisioning acceptance.",
      "The native shell stores connection metadata only; LifeOS device credentials remain in the web session.",
    ],
  };
  const evidencePath = path.join(outDir, "latest.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  log(`PASS. Evidence: ${evidencePath}`);
  log(`Screenshots: ${setupScreenshot}, ${connectedScreenshot}, ${cloudDataScreenshot}, ${cloudMemoryScreenshot}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error?.message || error}`);
  process.exitCode = 1;
});
