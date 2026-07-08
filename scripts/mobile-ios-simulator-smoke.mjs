#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeRemoteBaseUrl, runRemoteConnectionSmoke } from "./remote-connection-smoke.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_OUT_DIR = path.join(process.cwd(), "tmp", "ios-simulator-smoke");
const DEFAULT_HANDOFF_WAIT_MS = 7_000;
const DEFAULT_CHAT_WAIT_MS = 4_000;

function log(message) {
  console.log(`[ios-simulator-smoke] ${message}`);
}

async function xcrun(args, options = {}) {
  try {
    const result = await execFileAsync("xcrun", args, {
      timeout: options.timeoutMs || 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout || "";
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || "");
    if (options.allowFailure) return stderr;
    throw new Error(`xcrun ${args.join(" ")} failed: ${stderr || error?.message || "unknown error"}`);
  }
}

function runtimeScore(runtime) {
  const match = String(runtime || "").match(/iOS-(\d+)-(\d+)/);
  if (!match) return 0;
  return Number(match[1]) * 100 + Number(match[2]);
}

async function selectSimulator() {
  const requested = String(process.env.LIFEOS_IOS_SIMULATOR_UDID || "").trim();
  const raw = await xcrun(["simctl", "list", "devices", "available", "--json"], { timeoutMs: 30_000 });
  const parsed = JSON.parse(raw);
  const allDevices = Object.entries(parsed.devices || {})
    .flatMap(([runtime, devices]) => (devices || []).map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable && /iPhone/i.test(device.name || ""));
  if (requested) {
    const found = allDevices.find((device) => device.udid === requested);
    if (!found) throw new Error(`Requested iOS simulator was not found or is unavailable: ${requested}`);
    return found;
  }
  const booted = allDevices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const sorted = [...allDevices].sort((left, right) => runtimeScore(right.runtime) - runtimeScore(left.runtime));
  if (!sorted[0]) throw new Error("No available iPhone simulator was found. Install an iOS simulator runtime in Xcode first.");
  return sorted[0];
}

async function bootSimulator(device) {
  if (device.state !== "Booted") {
    log(`Booting ${device.name} (${device.runtime})`);
    const output = await xcrun(["simctl", "boot", device.udid], { allowFailure: true, timeoutMs: 60_000 });
    if (output && !/current state: Booted|already booted/i.test(output)) {
      throw new Error(`Could not boot simulator: ${output}`);
    }
  } else {
    log(`Using already booted ${device.name}`);
  }
  await xcrun(["simctl", "bootstatus", device.udid, "-b"], { timeoutMs: 180_000 });
}

function buildIcloudEntryChecksum(packet) {
  const checksumPayload = {
    version: packet.version,
    desktopId: packet.desktopId,
    desktopName: packet.desktopName,
    generatedAt: packet.generatedAt,
    refreshAfter: packet.refreshAfter,
    expiresAt: packet.expiresAt,
    candidateId: packet.candidateId,
    baseUrl: packet.baseUrl,
    mobilePairUrl: packet.mobilePairUrl,
    mobileChatUrl: packet.mobileChatUrl,
    mode: packet.mode,
    secure: packet.secure,
    stability: packet.stability,
    requiresRestart: packet.requiresRestart,
    fallbackCandidates: packet.fallbackCandidates,
    sameWifiOnly: packet.sameWifiOnly,
    transport: packet.transport,
    realtimeTransport: packet.realtimeTransport,
  };
  return crypto.createHash("sha256").update(JSON.stringify(checksumPayload)).digest("hex");
}

function buildSimulatorPacket(baseUrl) {
  const now = Date.now();
  const isHttps = baseUrl.startsWith("https://");
  const packet = {
    version: 3,
    desktopId: "ios-simulator-smoke",
    desktopName: "iOS Simulator Smoke",
    desktopSlug: "ios-simulator-smoke",
    generatedAt: now,
    refreshAfter: now + 24 * 60 * 60 * 1000,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    candidateId: isHttps ? "simulator-https" : "simulator-local",
    label: "LifeOS iOS Simulator Smoke",
    baseUrl,
    mobilePairUrl: `${baseUrl}/mobile/pair`,
    mobileChatUrl: `${baseUrl}/mobile/chat`,
    mode: isHttps ? "simulator-https" : "simulator-local",
    secure: isHttps,
    stability: isHttps ? "stable" : "local",
    requiresRestart: false,
    fallbackCandidates: [],
    sameWifiOnly: !isHttps,
    transport: "icloud-handoff",
    realtimeTransport: false,
  };
  packet.entryChecksumSha256 = buildIcloudEntryChecksum(packet);
  return packet;
}

function buildSimulatorHandoffUrl(baseUrl) {
  const packet = buildSimulatorPacket(baseUrl);
  const url = new URL(`${baseUrl}/mobile/device`);
  url.searchParams.set("lifeosEntry", "icloud");
  url.searchParams.set("entryGeneratedAt", String(packet.generatedAt));
  url.searchParams.set("entryRefreshAfter", String(packet.refreshAfter));
  url.searchParams.set("entryExpiresAt", String(packet.expiresAt));
  url.searchParams.set("entryBaseUrl", baseUrl);
  url.searchParams.set("entryMode", packet.mode);
  url.searchParams.set("entryStability", packet.stability);
  url.searchParams.set("entryLabel", packet.label);
  url.searchParams.set("entryDesktopId", packet.desktopId);
  url.searchParams.set("entryDesktopName", packet.desktopName);
  url.searchParams.set("entryDesktopSlug", packet.desktopSlug);
  url.searchParams.set("entryChecksumSha256", packet.entryChecksumSha256);
  return { url: url.toString(), packet };
}

async function screenshot(device, outDir, name) {
  const filePath = path.join(outDir, `${name}.png`);
  await xcrun(["simctl", "io", device.udid, "screenshot", filePath], { timeoutMs: 60_000 });
  return filePath;
}

async function main() {
  const baseUrl = normalizeRemoteBaseUrl(process.argv[2] || process.env.LIFEOS_SIMULATOR_BASE_URL || DEFAULT_BASE_URL);
  const outDir = path.resolve(process.env.LIFEOS_SIMULATOR_SMOKE_OUT_DIR || DEFAULT_OUT_DIR);
  const handoffWaitMs = Number.parseInt(process.env.LIFEOS_SIMULATOR_HANDOFF_WAIT_MS || String(DEFAULT_HANDOFF_WAIT_MS), 10);
  const chatWaitMs = Number.parseInt(process.env.LIFEOS_SIMULATOR_CHAT_WAIT_MS || String(DEFAULT_CHAT_WAIT_MS), 10);
  fs.mkdirSync(outDir, { recursive: true });

  log(`Checking desktop/mobile endpoint first: ${baseUrl}`);
  const remoteSmoke = await runRemoteConnectionSmoke(baseUrl, {
    timeoutMs: Number.parseInt(process.env.LIFEOS_SIMULATOR_SMOKE_TIMEOUT_MS || "10000", 10),
  });
  if (!remoteSmoke.ok) {
    console.error(JSON.stringify(remoteSmoke, null, 2));
    throw new Error("Desktop/mobile endpoint is not reachable from the Mac. Start LifeOS first, then rerun this smoke.");
  }

  const device = await selectSimulator();
  await bootSimulator(device);

  const handoff = buildSimulatorHandoffUrl(baseUrl);
  const handoffUrl = handoff.url;
  const chatUrl = `${baseUrl}/mobile/chat`;
  log(`Opening handoff entry in Mobile Safari on ${device.name}`);
  await xcrun(["simctl", "openurl", device.udid, handoffUrl], { timeoutMs: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, handoffWaitMs));
  const handoffScreenshot = await screenshot(device, outDir, "handoff-entry");

  log("Opening mobile chat shell");
  await xcrun(["simctl", "openurl", device.udid, chatUrl], { timeoutMs: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, chatWaitMs));
  const chatScreenshot = await screenshot(device, outDir, "mobile-chat");

  const evidence = {
    ok: true,
    generatedAt: new Date().toISOString(),
    baseUrl,
    simulator: {
      name: device.name,
      udid: device.udid,
      runtime: device.runtime,
    },
    remoteSmoke,
    openedUrls: {
      handoff: handoffUrl,
      chat: chatUrl,
    },
    handoffPacket: handoff.packet,
    screenshots: {
      handoff: handoffScreenshot,
      chat: chatScreenshot,
    },
    limits: [
      "This proves the mobile shell opens in iOS Simulator through the selected entry.",
      "This does not replace real cellular, Wi-Fi switching, restart, stale QR, or tunnel interruption acceptance.",
    ],
  };
  const evidencePath = path.join(outDir, "latest.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  log(`PASS. Evidence written to ${evidencePath}`);
  log(`Screenshots: ${handoffScreenshot}, ${chatScreenshot}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error?.message || error}`);
  process.exitCode = 1;
});
