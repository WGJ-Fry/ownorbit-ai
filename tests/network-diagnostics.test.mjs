// @ts-nocheck
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { createServer } from "node:http";
import os, { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

const rootDir = process.cwd();

test("iCloud pairing session status guides stale QR repair", async () => {
  const { buildIcloudPairingSessionStatus } = await import(`../server/icloudPairingSession.ts?pairing-status=${Date.now()}`);
  const now = 1_000_000;
  const baseSession = {
    id: "pairing-session-1",
    tokenHash: "redacted",
    baseUrl: "https://lifeos.example.test",
    createdAt: now - 30_000,
    expiresAt: now + 120_000,
  };

  assert.equal(buildIcloudPairingSessionStatus({ session: null, recommendedBaseUrl: "https://lifeos.example.test", now }).status, "missing");
  assert.equal(buildIcloudPairingSessionStatus({ session: baseSession, recommendedBaseUrl: "https://lifeos.example.test/", now }).status, "ready");
  assert.equal(buildIcloudPairingSessionStatus({ session: { ...baseSession, expiresAt: now + 30_000 }, recommendedBaseUrl: "https://lifeos.example.test", now }).status, "expiring-soon");
  assert.equal(buildIcloudPairingSessionStatus({ session: { ...baseSession, expiresAt: now - 1 }, recommendedBaseUrl: "https://lifeos.example.test", now }).action, "regenerate-qr");
  assert.equal(buildIcloudPairingSessionStatus({ session: baseSession, recommendedBaseUrl: "https://new-lifeos.example.test", now }).status, "address-changed");
  assert.equal(buildIcloudPairingSessionStatus({ session: { ...baseSession, confirmedAt: now - 5_000, confirmedDeviceId: "phone-1" }, recommendedBaseUrl: "https://new-lifeos.example.test", now }).status, "confirmed");
});

test("iCloud acceptance summary separates synced entry from real-device evidence", async () => {
  const { buildIcloudAcceptanceSummary } = await import(`../server/icloudAcceptance.ts?icloud-acceptance=${Date.now()}`);
  const now = 1_800_000_000_000;
  const baseUrl = "https://lifeos.example.test";
  const icloud = {
    recommendedBaseUrl: baseUrl,
    recommendedMode: "configured",
    recommendedStability: "stable",
    syncReadiness: { status: "ready", canOpenOnPhone: true },
    handoffHealth: {
      status: "fresh",
      lastExportedAt: now - 1_000,
      lastExportedBaseUrl: baseUrl,
      expiresAt: now + 60_000,
      htmlConsistency: { ok: true },
    },
    indexConsistency: { ok: true },
    phoneConfirmation: {
      status: "confirmed",
      confirmedAt: now - 800,
      confirmedDeviceName: "iPhone",
    },
    pairingSession: {
      status: "ready",
      expiresAt: now + 30_000,
    },
  };

  const missingRealDeviceEvidence = buildIcloudAcceptanceSummary({ icloud, now });
  assert.equal(missingRealDeviceEvidence.ready, false);
  assert.equal(missingRealDeviceEvidence.passed, 4);
  assert.equal(missingRealDeviceEvidence.manualRequired, 5);
  assert.equal(missingRealDeviceEvidence.recommendedAction, "record-real-world-check");
  assert.equal(missingRealDeviceEvidence.nextItemId, "cellular-mobile-chat");
  assert.equal(missingRealDeviceEvidence.nextManualItemId, "cellular-mobile-chat");
  assert.equal(missingRealDeviceEvidence.items.find((item) => item.id === "icloud-entry-synced")?.status, "passed");
  assert.equal(missingRealDeviceEvidence.items.find((item) => item.id === "realtime-entry-ready")?.status, "passed");
  assert.equal(missingRealDeviceEvidence.items.find((item) => item.id === "cellular-mobile-chat")?.status, "manual-required");
  assert.equal(missingRealDeviceEvidence.items.find((item) => item.id === "restart-restore")?.status, "manual-required");
  assert.equal(missingRealDeviceEvidence.items.find((item) => item.id === "network-interruption")?.status, "manual-required");

  const lanOnlyEntry = buildIcloudAcceptanceSummary({
    icloud: {
      ...icloud,
      recommendedBaseUrl: "http://192.168.0.12:3000",
      recommendedMode: "lan",
      recommendedStability: "temporary",
      handoffHealth: {
        ...icloud.handoffHealth,
        lastExportedBaseUrl: "http://192.168.0.12:3000",
      },
    },
    now,
  });
  const realtimeItem = lanOnlyEntry.items.find((item) => item.id === "realtime-entry-ready");
  assert.equal(realtimeItem?.status, "needs-action");
  assert.equal(realtimeItem?.action, "choose-live-network-entry");
  assert.match(realtimeItem?.evidence || "", /not a stable HTTPS\/VPN entry/);
  assert.equal(lanOnlyEntry.recommendedAction, "choose-live-network-entry");
  assert.equal(lanOnlyEntry.nextItemId, "realtime-entry-ready");
  assert.equal(lanOnlyEntry.nextManualItemId, "cellular-mobile-chat");

  const complete = buildIcloudAcceptanceSummary({
    icloud: {
      ...icloud,
      latestEntryIssueEvent: {
        eventType: "opened-expired-entry",
        entryBaseUrl: "https://old-lifeos.example.test",
        ignoredAt: now,
        createdAt: now,
      },
    },
    remoteAcceptanceRecords: [
      {
        id: "cellular-mobile-chat",
        baseUrl,
        note: "iPhone cellular data opened the iCloud entry with Wi-Fi off and sent a mobile chat message.",
        createdAt: now - 500,
      },
      {
        id: "network-switch",
        baseUrl,
        note: "iPhone switched between Wi-Fi and cellular, then chat reconnected and queue recovered.",
        createdAt: now - 400,
      },
      {
        id: "restart-restore",
        baseUrl,
        note: "Mac desktop app was restarted and the same HTTPS iCloud entry still opened mobile chat and health checks.",
        createdAt: now - 300,
      },
      {
        id: "network-interruption",
        baseUrl,
        note: "Tailscale or HTTPS tunnel disconnected and reconnected; the phone recovered without changing the iCloud entry.",
        createdAt: now - 200,
      },
    ],
    now,
  });
  assert.equal(complete.ready, true);
  assert.equal(complete.passed, complete.total);
  assert.equal(complete.recommendedAction, "ready");
  assert.equal(complete.nextItemId, undefined);
  assert.equal(complete.nextManualItemId, undefined);
  assert.equal(complete.items.find((item) => item.id === "old-entry-repair")?.status, "passed");

  const staleQrEvidence = buildIcloudAcceptanceSummary({
    icloud,
    remoteAcceptanceRecords: [
      {
        id: "stale-qr-repair",
        baseUrl,
        note: "Old home-screen entry was stale; generated a fresh QR and re-paired the phone successfully.",
        createdAt: now - 100,
      },
    ],
    now,
  });
  assert.equal(staleQrEvidence.items.find((item) => item.id === "old-entry-repair")?.status, "passed");
  assert.equal(staleQrEvidence.items.find((item) => item.id === "old-entry-repair")?.acceptedAt, now - 100);
});

test("network diagnostics filters non-LAN interface addresses from LAN candidates", async (t) => {
  const oldNetworkInterfaces = os.networkInterfaces;
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;

  t.after(() => {
    os.networkInterfaces = oldNetworkInterfaces;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
  });

  os.networkInterfaces = () => ({
    en0: [
      { family: "IPv4", internal: false, address: "192.168.0.117" },
      { family: "IPv4", internal: false, address: "10.0.0.8" },
      { family: "IPv4", internal: false, address: "172.20.1.9" },
      { family: "IPv4", internal: false, address: "198.18.0.1" },
      { family: "IPv4", internal: false, address: "100.64.0.10" },
      { family: "IPv4", internal: false, address: "169.254.1.2" },
      { family: "IPv4", internal: true, address: "127.0.0.1" },
    ],
  });
  process.env.LIFEOS_PORT = "3000";
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?lan-filter=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();

  assert.deepEqual(diagnostics.lanUrls, [
    "http://192.168.0.117:3000",
    "http://10.0.0.8:3000",
    "http://172.20.1.9:3000",
  ]);
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.baseUrl.includes("198.18.0.1")), false);
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.baseUrl.includes("100.64.0.10") && candidate.mode === "lan"), false);
});

test("network diagnostics detects mocked Cloudflare and Tailscale CLIs", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-network-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldHost = process.env.LIFEOS_HOST;
  const oldAllowPublic = process.env.LIFEOS_ALLOW_PUBLIC;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldIcloudSyncServiceStatus = process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;
  const oldIcloudAccountStatus = process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldHost === undefined) delete process.env.LIFEOS_HOST;
    else process.env.LIFEOS_HOST = oldHost;
    if (oldAllowPublic === undefined) delete process.env.LIFEOS_ALLOW_PUBLIC;
    else process.env.LIFEOS_ALLOW_PUBLIC = oldAllowPublic;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldIcloudSyncServiceStatus === undefined) delete process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;
    else process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = oldIcloudSyncServiceStatus;
    if (oldIcloudAccountStatus === undefined) delete process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS;
    else process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS = oldIcloudAccountStatus;
    await rm(binDir, { recursive: true, force: true });
  });

  const cloudflaredPath = path.join(binDir, "cloudflared");
  const pgrepPath = path.join(binDir, "pgrep");
  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(cloudflaredPath, `#!/bin/sh
if [ "$1" = "--version" ] || [ "$1" = "version" ] || [ -z "$1" ]; then
  echo 'cloudflared version 2026.6.0'
  exit 0
fi
exit 1
`);
  await writeFile(pgrepPath, `#!/bin/sh
if [ "$2" = "cloudflared" ]; then
  echo '123 cloudflared tunnel --url http://127.0.0.1:4567 https://amber-lifeos.trycloudflare.com'
  exit 0
fi
exit 1
`);
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo '{"TCP":{},"Web":{"lifeos-mac.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  exit 0
fi
exit 1
`);
  await chmod(cloudflaredPath, 0o755);
  await chmod(pgrepPath, 0o755);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_HOST = "127.0.0.1";
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = path.join(binDir, "iCloud Drive");
  process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = "running";
  process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS = "ready";
  fs.mkdirSync(process.env.LIFEOS_ICLOUD_DRIVE_DIR, { recursive: true });
  delete process.env.LIFEOS_ALLOW_PUBLIC;

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { getNetworkDiagnostics } = await import("./server/networkDiagnostics.ts?mock-child=" + Date.now());
    process.stdout.write(JSON.stringify(getNetworkDiagnostics()));
  `], {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: "utf8",
  });
  const diagnostics = JSON.parse(output);
  assert.equal(diagnostics.cloudflare.installed, true);
  assert.match(diagnostics.cloudflare.version, /cloudflared version 2026\.6\.0/);
  assert.equal(diagnostics.cloudflare.running, true);
  assert.equal(typeof diagnostics.cloudflare.managed.running, "boolean");
  assert.deepEqual(diagnostics.cloudflare.detectedUrls, ["https://amber-lifeos.trycloudflare.com"]);
  assert.equal(diagnostics.cloudflare.suggestedCommand, "cloudflared tunnel --url http://127.0.0.1:4567");
  assert.match(diagnostics.cloudflare.installUrl, /^https:\/\/developers\.cloudflare\.com\//);
  assert.match(diagnostics.cloudflare.envTemplate, /LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https:\/\/amber-lifeos\.trycloudflare\.com/);
  assert.equal(diagnostics.tailscale.installed, true);
  assert.equal(diagnostics.tailscale.online, true);
  assert.equal(diagnostics.tailscale.deviceName, "lifeos-mac");
  assert.equal(diagnostics.tailscale.tailnetName, "tailnet.example.ts.net");
  assert.deepEqual(diagnostics.tailscale.urls, ["http://100.64.0.10:4567"]);
  assert.deepEqual(diagnostics.tailscale.magicDnsUrls, ["http://lifeos-mac.tailnet.example.ts.net:4567"]);
  assert.equal(diagnostics.tailscale.loginCommand, "tailscale up");
  assert.equal(diagnostics.tailscale.magicDnsEnabled, true);
  assert.equal(diagnostics.tailscale.httpsServeUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.tailscale.httpsServeReady, true);
  assert.equal(diagnostics.tailscale.serveRunning, true);
  assert.equal(diagnostics.tailscale.serveCommand, "tailscale serve --bg https:443 http://127.0.0.1:4567");
  assert.deepEqual(diagnostics.tailscale.mobileUrls, ["https://lifeos-mac.tailnet.example.ts.net", "http://lifeos-mac.tailnet.example.ts.net:4567", "http://100.64.0.10:4567"]);
  assert.match(diagnostics.tailscale.installUrl, /^https:\/\/tailscale\.com\/download/);
  assert.equal(diagnostics.tailscale.autoInstall.command, "brew install --cask tailscale-app");
  assert.equal(diagnostics.tailscale.autoInstall.reason, "already-installed");
  assert.equal(diagnostics.tailscale.envTemplate, "LIFEOS_HOST=127.0.0.1 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://lifeos-mac.tailnet.example.ts.net npm run start");
  assert.equal(diagnostics.lanEnvTemplate, "LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start");
  assert.equal(diagnostics.recommendedBaseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.connectionCandidates[0].id, "tailscale-serve-https");
  assert.equal(diagnostics.connectionCandidates[0].mobilePairUrl, "https://lifeos-mac.tailnet.example.ts.net/mobile/pair");
  assert.equal(diagnostics.connectionCandidates[0].secure, true);
  assert.equal(diagnostics.connectionCandidates[0].stability, "stable");
  assert.equal(diagnostics.remoteReadiness.status, "needs-restart");
  assert.equal(diagnostics.remoteReadiness.severity, "warning");
  assert.equal(diagnostics.remoteReadiness.baseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.icloud.available, true);
  assert.equal(diagnostics.icloud.canExport, true);
  assert.equal(diagnostics.icloud.recommendedBaseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.icloud.realtimeTransport, false);
  assert.equal(diagnostics.remoteReadiness.actions.some((action) => action.id === "needsRestart"), true);
  assert.equal(diagnostics.connectionCandidates[0].envTemplate, "LIFEOS_HOST=127.0.0.1 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://lifeos-mac.tailnet.example.ts.net npm run start");
  assert.match(diagnostics.connectionCandidates[0].restartInstruction, /Copy the startup environment/);
  const cloudflareCandidate = diagnostics.connectionCandidates.find((candidate) => candidate.id === "cloudflare-0");
  assert.equal(cloudflareCandidate.stability, "temporary");
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-serve-https" && candidate.baseUrl === "https://lifeos-mac.tailnet.example.ts.net"), true);
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-magicdns-0" && candidate.baseUrl === "http://lifeos-mac.tailnet.example.ts.net:4567"), true);
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-ip-0" && candidate.baseUrl === "http://100.64.0.10:4567"), true);
  const tailscaleCandidate = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-serve-https");
  const tailscaleHttpCandidate = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-magicdns-0");
  assert.match(tailscaleCandidate.envTemplate, /LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https:\/\/lifeos-mac\.tailnet\.example\.ts\.net/);
  assert.match(tailscaleCandidate.notes[0], /HTTPS Serve is already active/);
  assert.equal(tailscaleHttpCandidate.stability, "temporary");
  assert.match(tailscaleHttpCandidate.notes[0], /not a long-term phone\/PWA entry/);
  assert.equal(tailscaleHttpCandidate.envTemplate.includes("LIFEOS_TRUST_PROXY=1"), false);
});

test("iCloud handoff export writes mobile entry files without requiring Tailscale", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-drive-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldDeviceName = process.env.LIFEOS_DEVICE_NAME;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldDeviceName === undefined) delete process.env.LIFEOS_DEVICE_NAME;
    else process.env.LIFEOS_DEVICE_NAME = oldDeviceName;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_DEVICE_NAME = "Kitchen Mac";

  const appDir = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appDir, { recursive: true });
  const otherGeneratedAt = Date.now() - 60_000;
  await writeFile(path.join(appDir, "lifeos-mobile-entry-old-mac.json"), JSON.stringify({
    kind: "lifeos-mobile-entry",
    version: 3,
    desktopId: "old-mac",
    desktopName: "Kitchen Mac",
    desktopSlug: "old-mac",
    htmlFileName: "lifeos-mobile-entry-old-mac.html",
    packetFileName: "lifeos-mobile-entry-old-mac.json",
    generatedAt: otherGeneratedAt,
    refreshAfter: otherGeneratedAt + 24 * 60 * 60 * 1000,
    expiresAt: otherGeneratedAt + 7 * 24 * 60 * 60 * 1000,
    candidateId: "old-lan",
    label: "Old LAN",
    baseUrl: "http://192.168.0.50:4567",
    mobilePairUrl: "http://192.168.0.50:4567/mobile/pair",
    mobileChatUrl: "http://192.168.0.50:4567/mobile/chat",
    mode: "lan",
    secure: false,
    stability: "temporary",
    requiresRestart: false,
    transport: "icloud-handoff",
    realtimeTransport: false,
    entryChecksumSha256: "1".repeat(64),
  }, null, 2));
  await writeFile(path.join(appDir, "lifeos-mobile-entry-old-mac.html"), "<!doctype html><title>Kitchen Mac</title>");

  const { exportIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-export=${Date.now()}`);
  const result = exportIcloudHandoff();

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.canExport, true);
  assert.equal(result.realtimeTransport, false);
  assert.equal(result.recommendedBaseUrl, "https://lifeos.example.com");

  const html = await readFile(result.handoffFilePath, "utf8");
  const packet = JSON.parse(await readFile(result.packetFilePath, "utf8"));
  assert.match(html, /LifeOS AI Mobile Entry/);
  assert.match(html, /name="lifeos-entry-generated-at"/);
  assert.match(html, /name="lifeos-entry-checksum"/);
  assert.match(html, /绑定这台设备/);
  assert.match(html, /Pair This Device/);
  assert.match(html, /https:\/\/lifeos\.example\.com\/mobile\/pair/);
  assert.match(html, /lifeosEntry=icloud/);
  assert.match(html, /entryExpiresAt=/);
  assert.match(html, /entryDesktopId=/);
  assert.match(html, /entryDesktopName=/);
  assert.match(html, /entryChecksumSha256=/);
  assert.match(html, /Refresh after:/);
  assert.match(html, /entry-age-status/);
  assert.match(html, /正在确认这个入口是否可用/);
  assert.match(html, /Checking whether this entry is usable/);
  assert.match(html, /下一步只做这一步/);
  assert.match(html, /Do this one thing next/);
  assert.match(html, /data-lifeos-expirable-action="pair"/);
  assert.match(html, /data-lifeos-expirable-action="chat"/);
  assert.match(html, /data-lifeos-expired-entry-action="regenerate"/);
  assert.match(html, /这个入口已经停止使用/);
  assert.match(html, /This old entry is no longer safe to use/);
  assert.match(html, /body\.dataset\.lifeosEntryExpired/);
  assert.match(html, /aria-disabled/);
  assert.match(html, /disabled-link/);
  assert.match(html, /这个入口旧了/);
  assert.match(html, /这个入口可能不是最新/);
  assert.match(html, /这个入口可用/);
  assert.match(html, /从 iPhone 文件 App 打开最新入口/);
  assert.match(html, /如果绑定失败/);
  assert.match(html, /高级排障/);
  assert.match(html, /Advanced recovery/);
  assert.match(html, /Copy Recovery Info/);
  assert.match(html, /LifeOS iCloud Mobile Entry Recovery/);
  assert.match(html, /entryBaseUrl=https:\/\/lifeos\.example\.com/);
  assert.match(html, /desktopName=/);
  assert.match(html, /entryChecksumSha256=[a-f0-9]{64}/);
  assert.doesNotMatch(html.match(/<textarea id="lifeos-recovery" readonly>([\s\S]*?)<\/textarea>/)?.[1] || "", /lifeosEntry=icloud/);
  assert.equal(packet.baseUrl, "https://lifeos.example.com");
  assert.equal(packet.version, 3);
  assert.equal(typeof packet.desktopId, "string");
  assert.equal(typeof packet.desktopName, "string");
  assert.match(packet.htmlFileName, /^lifeos-mobile-entry-.+\.html$/);
  assert.match(packet.packetFileName, /^lifeos-mobile-entry-.+\.json$/);
  assert.equal(path.basename(result.handoffFilePath), packet.htmlFileName);
  assert.equal(path.basename(result.packetFilePath), packet.packetFileName);
  assert.equal(path.basename(result.indexFilePath), "lifeos-mobile-entry.html");
  assert.equal(path.basename(result.historyFilePath), "lifeos-mobile-entry-history.json");
  assert.match(packet.entryChecksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(packet.candidateId, "configured-public");
  assert.equal(packet.exportReason, "manual");
  assert.equal(packet.changeType, "first-export");
  assert.equal(packet.previousBaseUrl, "");
  assert.equal(packet.previousGeneratedAt, 0);
  assert.equal(packet.previousFallbackCandidateCount, 0);
  assert.equal(packet.fallbackCandidateCount, packet.fallbackCandidates.length);
  assert.equal(packet.mobileChatUrl, "https://lifeos.example.com/mobile/chat");
  assert.equal(packet.refreshAfter > packet.generatedAt, true);
  assert.equal(packet.expiresAt > packet.refreshAfter, true);
  assert.equal(Array.isArray(packet.fallbackCandidates), true);
  assert.equal(packet.fallbackCandidates.some((candidate) => candidate.baseUrl === "https://lifeos.example.com"), true);
  assert.equal(Array.isArray(packet.recoveryActions), true);
  assert.match(packet.recoveryActions.join("\n"), /Refresh this iCloud entry after changing Wi-Fi/);
  assert.equal(packet.realtimeTransport, false);
  assert.equal(packet.transport, "icloud-handoff");
  assert.equal(packet.sameWifiOnly, false);
  assert.equal(result.handoffHealth.checksumOk, true);
  assert.equal(result.handoffHealth.entryChecksumSha256, packet.entryChecksumSha256);
  assert.equal(result.handoffHealth.expectedChecksumSha256, packet.entryChecksumSha256);
  assert.equal(result.handoffHealth.htmlConsistency.status, "matching");
  assert.equal(result.handoffHealth.htmlConsistency.checksumSha256, packet.entryChecksumSha256);
  assert.equal(result.handoffHealth.htmlConsistency.generatedAt, packet.generatedAt);
  assert.equal(result.syncReadiness.status, "ready");
  assert.equal(result.syncReadiness.canOpenOnPhone, true);
  assert.equal(result.syncReadiness.action, "open-files-app");
  assert.equal(result.syncReadiness.userStep.humanRecovery.titleKey, "onboarding.appleRemoteIcloudHumanRecoveryOpenTitle");
  assert.equal(result.syncReadiness.userStep.humanRecovery.phoneAction, "open-files-app");
  assert.equal(result.syncReadiness.userStep.humanRecovery.showTechnicalDetails, false);
  const indexHtml = await readFile(result.indexFilePath, "utf8");
  const history = JSON.parse(await readFile(result.historyFilePath, "utf8"));
  assert.match(indexHtml, /打开推荐入口/);
  assert.match(indexHtml, /Open the Recommended Entry/);
  assert.match(indexHtml, /通常只点第一个入口即可/);
  assert.match(indexHtml, /Advanced: other or older entries/);
  assert.match(indexHtml, /如果两台电脑名字一样/);
  assert.match(indexHtml, /If two desktops share a name/);
  assert.match(indexHtml, /data-lifeos-desktop-short-id="oldmac"/);
  assert.match(indexHtml, /Kitchen Mac · oldmac/);
  assert.match(indexHtml, /ID oldmac/);
  assert.match(indexHtml, /data-lifeos-entry-same-wifi-only="1"/);
  assert.match(indexHtml, /data-lifeos-entry-status="usable"/);
  assert.match(indexHtml, /同一 Wi-Fi \/ Same Wi-Fi only/);
  assert.match(indexHtml, /class="entry primary"/);
  assert.match(indexHtml, /推荐原因：这是当前最适合手机使用的异地入口/);
  assert.match(indexHtml, /打开推荐入口 \/ Open recommended entry/);
  assert.match(indexHtml, /name="lifeos-entry-index-checksum" content="[a-f0-9]{64}"/);
  assert.match(indexHtml, /name="lifeos-entry-index-entry-count" content="2"/);
  assert.match(indexHtml, /name="lifeos-entry-index-latest-entry-generated-at"/);
  assert.match(indexHtml, /name="lifeos-entry-index-writer-desktop-id"/);
  assert.match(indexHtml, /name="lifeos-entry-index-recommended-desktop-id"/);
  assert.match(indexHtml, /name="lifeos-entry-index-recommended-html-file"/);
  assert.match(indexHtml, new RegExp(packet.htmlFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(indexHtml.indexOf(packet.htmlFileName) < indexHtml.indexOf("lifeos-mobile-entry-old-mac.html"), true);
  assert.equal(result.indexConsistency.status, "matching");
  assert.equal(result.indexConsistency.ok, true);
  assert.equal(result.indexConsistency.entryCount, 2);
  assert.equal(result.indexConsistency.expectedEntryCount, 2);
  assert.equal(Array.isArray(result.availableEntries), true);
  assert.equal(result.availableEntries.some((entry) => entry.desktopId === packet.desktopId), true);
  assert.equal(result.availableEntries.some((entry) => entry.desktopId === "old-mac"), true);
  assert.equal(result.availableEntries.some((entry) => entry.desktopName === packet.desktopName && entry.baseUrl === packet.baseUrl && entry.expiresAt === packet.expiresAt), true);
  assert.equal(Array.isArray(result.entryHistory), true);
  assert.equal(result.lifecycle.entryCount >= 2, true);
  assert.equal(result.lifecycle.retentionLimit, 12);
  assert.equal(result.lifecycle.expiredEntryCount, 0);
  assert.equal(history[0].desktopId, packet.desktopId);
  assert.equal(history[0].baseUrl, "https://lifeos.example.com");
  assert.equal(history[0].reason, "manual");
  assert.equal(history[0].changeType, "first-export");
  assert.equal(history[0].previousBaseUrl, "");
  assert.equal(history[0].mode, "configured");
  assert.equal(history[0].stability, "stable");
  assert.equal(history[0].fallbackCandidateCount, packet.fallbackCandidates.length);
  assert.equal(history[0].previousGeneratedAt, 0);
  assert.equal(fs.readdirSync(path.dirname(result.handoffFilePath)).some((name) => name.endsWith(".tmp")), false);
});

test("iCloud desktop chooser prefers off-LAN entries over same-Wi-Fi current entries", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-remote-entry-preferred-"));
  const appDir = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appDir, { recursive: true });
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldDeviceName = process.env.LIFEOS_DEVICE_NAME;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldDeviceName === undefined) delete process.env.LIFEOS_DEVICE_NAME;
    else process.env.LIFEOS_DEVICE_NAME = oldDeviceName;
    await rm(icloudDir, { recursive: true, force: true });
  });

  const remoteGeneratedAt = Date.now() - 60_000;
  await writeFile(path.join(appDir, "lifeos-mobile-entry-remote-mac.json"), JSON.stringify({
    kind: "lifeos-mobile-entry",
    version: 3,
    desktopId: "remote-mac",
    desktopName: "Home Mac",
    desktopSlug: "remote-mac",
    htmlFileName: "lifeos-mobile-entry-remote-mac.html",
    packetFileName: "lifeos-mobile-entry-remote-mac.json",
    generatedAt: remoteGeneratedAt,
    refreshAfter: remoteGeneratedAt + 24 * 60 * 60 * 1000,
    expiresAt: remoteGeneratedAt + 7 * 24 * 60 * 60 * 1000,
    candidateId: "tailscale-https",
    label: "Tailscale HTTPS Serve",
    baseUrl: "https://home-mac.tailnet.example.ts.net",
    mobilePairUrl: "https://home-mac.tailnet.example.ts.net/mobile/pair",
    mobileChatUrl: "https://home-mac.tailnet.example.ts.net/mobile/chat",
    mode: "tailscale",
    secure: true,
    stability: "stable",
    requiresRestart: false,
    transport: "icloud-handoff",
    realtimeTransport: false,
    sameWifiOnly: false,
    entryChecksumSha256: "2".repeat(64),
  }, null, 2));
  await writeFile(path.join(appDir, "lifeos-mobile-entry-remote-mac.html"), "<!doctype html><title>Home Mac</title>");

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "http://192.168.0.50:4567";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_DEVICE_NAME = "Home Mac";

  const { exportIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-remote-entry-preferred=${Date.now()}`);
  const result = exportIcloudHandoff("remote-entry-preferred-test");
  const packet = JSON.parse(await readFile(result.packetFilePath, "utf8"));
  const indexHtml = await readFile(result.indexFilePath, "utf8");

  assert.equal(result.ok, true);
  assert.equal(packet.sameWifiOnly, true);
  assert.match(indexHtml, /name="lifeos-entry-index-recommended-desktop-id" content="remote-mac"/);
  assert.match(indexHtml, /name="lifeos-entry-index-recommended-html-file" content="lifeos-mobile-entry-remote-mac\.html"/);
  assert.match(indexHtml, /class="entry primary" href="lifeos-mobile-entry-remote-mac\.html"/);
  assert.match(indexHtml, /异地可用入口 \/ Off-LAN entry/);
  assert.match(indexHtml, /LifeOS 优先推荐了可异地访问的 HTTPS\/VPN 入口/);
  assert.match(indexHtml, /LifeOS picked an off-LAN HTTPS\/VPN entry/);
  assert.match(indexHtml, /高级：其他电脑或旧入口 \/ Advanced: other or older entries \(1\)/);
  assert.match(indexHtml, /data-lifeos-entry-same-wifi-only="1"/);
  assert.match(indexHtml, /data-lifeos-entry-status="usable"/);
  assert.equal(indexHtml.includes("这个入口只适合同一 Wi-Fi。离家使用请先在电脑端切换 Tailscale 或 Cloudflare。"), false);
  assert.equal(indexHtml.indexOf("lifeos-mobile-entry-remote-mac.html") < indexHtml.indexOf(packet.htmlFileName), true);
});

test("iCloud handoff entry page warns when the exported address only works on the same Wi-Fi", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-lan-entry-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldDeviceName = process.env.LIFEOS_DEVICE_NAME;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldDeviceName === undefined) delete process.env.LIFEOS_DEVICE_NAME;
    else process.env.LIFEOS_DEVICE_NAME = oldDeviceName;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "http://192.168.0.50:4567";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_DEVICE_NAME = "Kitchen Mac";

  const { exportIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-lan-entry-warning=${Date.now()}`);
  const result = exportIcloudHandoff("lan-warning-test");
  const html = await readFile(result.handoffFilePath, "utf8");
  const packet = JSON.parse(await readFile(result.packetFilePath, "utf8"));

  assert.equal(result.ok, true);
  assert.equal(result.recommendedBaseUrl, "http://192.168.0.50:4567");
  assert.equal(packet.sameWifiOnly, true);
  assert.equal(packet.baseUrl, "http://192.168.0.50:4567");
  assert.match(packet.entryChecksumSha256, /^[a-f0-9]{64}$/);
  assert.match(html, /id="lifeos-same-wifi-warning"/);
  assert.match(html, /这个入口只适合同一 Wi-Fi/);
  assert.match(html, /This entry only works on the same Wi-Fi/);
  assert.match(html, /开启 Tailscale HTTPS Serve 或 Cloudflare Tunnel/);
  assert.match(html, /Away from home, enable Tailscale or Cloudflare/);
  assert.match(html, /只适合同一 Wi-Fi \/ Same Wi-Fi only/);
  assert.match(html, /packet\.sameWifiOnly === true/);
  assert.equal(result.handoffHealth.checksumOk, true);
});

test("iCloud handoff export prunes expired entries from other desktops", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-cleanup-"));
  const appDir = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appDir, { recursive: true });
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldCleanupGrace = process.env.LIFEOS_ICLOUD_EXPIRED_CLEANUP_GRACE_MS;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldCleanupGrace === undefined) delete process.env.LIFEOS_ICLOUD_EXPIRED_CLEANUP_GRACE_MS;
    else process.env.LIFEOS_ICLOUD_EXPIRED_CLEANUP_GRACE_MS = oldCleanupGrace;
    await rm(icloudDir, { recursive: true, force: true });
  });

  const oldGeneratedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
  const oldPacket = {
    kind: "lifeos-mobile-entry",
    version: 3,
    desktopId: "old-desktop",
    desktopName: "Old Mac",
    desktopSlug: "old-mac",
    htmlFileName: "lifeos-mobile-entry-old-mac.html",
    packetFileName: "lifeos-mobile-entry-old-mac.json",
    generatedAt: oldGeneratedAt,
    refreshAfter: oldGeneratedAt + 60_000,
    expiresAt: oldGeneratedAt + 120_000,
    candidateId: "old-cloudflare",
    label: "Old Tunnel",
    baseUrl: "https://old-lifeos.example.com",
    mobilePairUrl: "https://old-lifeos.example.com/mobile/pair",
    mobileChatUrl: "https://old-lifeos.example.com/mobile/chat",
    mode: "cloudflare",
    secure: true,
    stability: "temporary",
    requiresRestart: false,
    transport: "icloud-handoff",
    realtimeTransport: false,
    entryChecksumSha256: "0".repeat(64),
  };
  await writeFile(path.join(appDir, oldPacket.packetFileName), `${JSON.stringify(oldPacket, null, 2)}\n`);
  await writeFile(path.join(appDir, oldPacket.htmlFileName), "<!doctype html><title>old</title>");
  await writeFile(path.join(appDir, "lifeos-mobile-entry-orphan.json"), "{not json");
  await writeFile(path.join(appDir, "lifeos-mobile-entry-orphan.html"), "<!doctype html><title>orphan</title>");

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://new-lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_ICLOUD_EXPIRED_CLEANUP_GRACE_MS = "0";

  const { exportIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-cleanup=${Date.now()}`);
  const result = exportIcloudHandoff("cleanup-test");

  assert.equal(result.cleanup.removedEntryCount, 1);
  assert.equal(result.cleanup.removedOrphanedFileCount, 2);
  assert.equal(result.cleanup.removedFiles.includes(oldPacket.packetFileName), true);
  assert.equal(result.cleanup.removedFiles.includes(oldPacket.htmlFileName), true);
  assert.equal(result.cleanup.removedFiles.includes("lifeos-mobile-entry-orphan.json"), true);
  assert.equal(result.cleanup.removedFiles.includes("lifeos-mobile-entry-orphan.html"), true);
  assert.equal(fs.existsSync(path.join(appDir, oldPacket.packetFileName)), false);
  assert.equal(fs.existsSync(path.join(appDir, oldPacket.htmlFileName)), false);
  assert.equal(fs.existsSync(path.join(appDir, "lifeos-mobile-entry-orphan.json")), false);
  assert.equal(fs.existsSync(path.join(appDir, "lifeos-mobile-entry-orphan.html")), false);
  assert.equal(result.availableEntries.some((entry) => entry.desktopId === "old-desktop"), false);
  assert.equal(result.lifecycle.entryCount, 1);
  assert.equal(result.lifecycle.expiredEntryCount, 0);
  assert.equal(result.lifecycle.prunableEntryCount, 0);
});

test("iCloud handoff diagnostics detect HTML and JSON packet mismatches", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-html-mismatch-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { exportIcloudHandoff, getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-html-mismatch=${Date.now()}`);
  const exported = exportIcloudHandoff();
  const html = await readFile(exported.handoffFilePath, "utf8");
  await writeFile(exported.handoffFilePath, html.replace(/name="lifeos-entry-checksum" content="[a-f0-9]{64}"/, `name="lifeos-entry-checksum" content="${"0".repeat(64)}"`));

  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.icloud.handoffHealth.status, "html-mismatch");
  assert.equal(diagnostics.icloud.handoffHealth.needsRefresh, true);
  assert.equal(diagnostics.icloud.handoffHealth.htmlConsistency.status, "mismatch");
  assert.equal(diagnostics.icloud.handoffHealth.htmlConsistency.checksumSha256, "0".repeat(64));
  assert.match(diagnostics.icloud.handoffHealth.reason, /HTML entry/);
});

test("iCloud handoff diagnostics detect stale desktop chooser index files", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-index-mismatch-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldIcloudSyncServiceStatus = process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldIcloudSyncServiceStatus === undefined) delete process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;
    else process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = oldIcloudSyncServiceStatus;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = "running";

  const { exportIcloudHandoff, getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-index-mismatch=${Date.now()}`);
  const exported = exportIcloudHandoff();
  const indexHtml = await readFile(exported.indexFilePath, "utf8");
  await writeFile(
    exported.indexFilePath,
    indexHtml.replace(/name="lifeos-entry-index-checksum" content="[a-f0-9]{64}"/, `name="lifeos-entry-index-checksum" content="${"1".repeat(64)}"`),
  );

  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.icloud.handoffHealth.status, "fresh");
  assert.equal(diagnostics.icloud.indexConsistency.status, "mismatch");
  assert.equal(diagnostics.icloud.indexConsistency.ok, false);
  assert.equal(diagnostics.icloud.indexConsistency.checksumSha256, "1".repeat(64));
  assert.equal(diagnostics.icloud.syncReadiness.status, "needs-refresh");
  assert.equal(diagnostics.icloud.syncReadiness.canOpenOnPhone, false);
  assert.equal(diagnostics.icloud.syncReadiness.action, "refresh-entry");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.humanRecovery.titleKey, "onboarding.appleRemoteIcloudHumanRecoveryRefreshTitle");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.humanRecovery.phoneAction, "open-latest-entry");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.humanRecovery.showTechnicalDetails, false);
});

test("iCloud handoff auto refresh updates exported entry after address changes", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-auto-refresh-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://old-lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { exportIcloudHandoff, maybeRefreshIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-auto-refresh=${Date.now()}`);
  const first = exportIcloudHandoff();
  const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(firstPacket.baseUrl, "https://old-lifeos.example.com");

  process.env.PUBLIC_BASE_URL = "https://new-lifeos.example.com";
  const refresh = maybeRefreshIcloudHandoff("test-address-change");
  const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  const nextHtml = await readFile(first.handoffFilePath, "utf8");
  const history = JSON.parse(await readFile(first.historyFilePath, "utf8"));
  assert.equal(refresh.refreshed, true);
  assert.equal(refresh.previousStatus, "address-changed");
  assert.equal(nextPacket.baseUrl, "https://new-lifeos.example.com");
  assert.equal(nextPacket.changeType, "public-base-url-changed");
  assert.equal(nextPacket.previousBaseUrl, "https://old-lifeos.example.com");
  assert.equal(nextPacket.previousCandidateId, "configured-public");
  assert.equal(nextPacket.previousMode, "configured");
  assert.equal(nextPacket.previousStability, "stable");
  assert.equal(nextPacket.previousGeneratedAt, firstPacket.generatedAt);
  assert.equal(nextPacket.previousEntryChecksumSha256, firstPacket.entryChecksumSha256);
  assert.equal(nextPacket.previousFallbackCandidateCount, firstPacket.fallbackCandidates.length);
  assert.equal(nextPacket.fallbackCandidateCount, nextPacket.fallbackCandidates.length);
  assert.equal(nextPacket.exportReason, "test-address-change");
  assert.equal(history[0].baseUrl, "https://new-lifeos.example.com");
  assert.equal(history[0].changeType, "public-base-url-changed");
  assert.equal(history[0].previousBaseUrl, "https://old-lifeos.example.com");
  assert.equal(history[0].previousGeneratedAt, firstPacket.generatedAt);
  assert.equal(history[0].previousMode, "configured");
  assert.equal(history[0].mode, "configured");
  assert.match(nextHtml, /https:\/\/new-lifeos\.example\.com\/mobile\/pair/);
  assert.match(nextHtml, new RegExp(`name="lifeos-entry-checksum" content="${nextPacket.entryChecksumSha256}"`));
});

test("iCloud handoff auto refresh updates exported entry after LAN fallback changes", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-lan-fallback-refresh-"));
  const oldNetworkInterfaces = os.networkInterfaces;
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    os.networkInterfaces = oldNetworkInterfaces;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://stable-lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  os.networkInterfaces = () => ({
    en0: [{ family: "IPv4", internal: false, address: "192.168.0.10" }],
  });

  const { exportIcloudHandoff, maybeRefreshIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-lan-fallback-refresh=${Date.now()}`);
  const first = exportIcloudHandoff();
  const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(firstPacket.baseUrl, "https://stable-lifeos.example.com");
  assert.equal(firstPacket.fallbackCandidates.some((candidate) => candidate.baseUrl === "http://192.168.0.10:4567"), true);

  os.networkInterfaces = () => ({
    en0: [{ family: "IPv4", internal: false, address: "192.168.0.11" }],
  });

  const refresh = maybeRefreshIcloudHandoff("test-lan-fallback-change");
  const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(refresh.refreshed, true);
  assert.equal(refresh.previousStatus, "address-changed");
  assert.equal(nextPacket.baseUrl, "https://stable-lifeos.example.com");
  assert.equal(nextPacket.changeType, "fallback-candidates-changed");
  assert.equal(nextPacket.exportReason, "test-lan-fallback-change");
  assert.equal(nextPacket.previousFallbackCandidateCount, firstPacket.fallbackCandidates.length);
  assert.equal(nextPacket.fallbackCandidateCount, nextPacket.fallbackCandidates.length);
  assert.equal(nextPacket.previousGeneratedAt, firstPacket.generatedAt);
  assert.equal(nextPacket.fallbackCandidates.some((candidate) => candidate.baseUrl === "http://192.168.0.11:4567"), true);
  assert.equal(nextPacket.fallbackCandidates.some((candidate) => candidate.baseUrl === "http://192.168.0.10:4567"), false);
});

test("iCloud handoff auto refresh records LAN IP address changes", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-lan-address-refresh-"));
  const oldNetworkInterfaces = os.networkInterfaces;
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    os.networkInterfaces = oldNetworkInterfaces;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  os.networkInterfaces = () => ({
    en0: [{ family: "IPv4", internal: false, address: "192.168.8.10" }],
  });

  const { exportIcloudHandoff, maybeRefreshIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-lan-address-refresh=${Date.now()}`);
  const first = exportIcloudHandoff("test-lan-address-initial");
  const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(firstPacket.baseUrl, "http://192.168.8.10:4567");
  assert.equal(firstPacket.candidateId, "lan-0");

  os.networkInterfaces = () => ({
    en0: [{ family: "IPv4", internal: false, address: "192.168.8.11" }],
  });

  const refresh = maybeRefreshIcloudHandoff("test-lan-address-change");
  const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  const history = JSON.parse(await readFile(first.historyFilePath, "utf8"));
  assert.equal(refresh.refreshed, true);
  assert.equal(refresh.previousStatus, "address-changed");
  assert.equal(nextPacket.baseUrl, "http://192.168.8.11:4567");
  assert.equal(nextPacket.changeType, "lan-address-changed");
  assert.equal(nextPacket.previousBaseUrl, "http://192.168.8.10:4567");
  assert.equal(history[0].changeType, "lan-address-changed");
});

test("iCloud handoff auto refresh records Cloudflare tunnel address changes", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-cloudflare-address-refresh-"));
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-cloudflare-bin-"));
  const urlFile = path.join(binDir, "cloudflare-url.txt");
  const cloudflaredPath = path.join(binDir, "cloudflared");
  const pgrepPath = path.join(binDir, "pgrep");
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldUrlFile = process.env.LIFEOS_TEST_CLOUDFLARE_URL_FILE;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldUrlFile === undefined) delete process.env.LIFEOS_TEST_CLOUDFLARE_URL_FILE;
    else process.env.LIFEOS_TEST_CLOUDFLARE_URL_FILE = oldUrlFile;
    await rm(icloudDir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  await writeFile(cloudflaredPath, "#!/bin/sh\necho 'cloudflared version 2026.6.0'\n");
  await writeFile(pgrepPath, `#!/bin/sh
if [ "$2" = "cloudflared" ]; then
  url="$(cat "$LIFEOS_TEST_CLOUDFLARE_URL_FILE")"
  echo "123 cloudflared tunnel --url http://127.0.0.1:4567 $url"
  exit 0
fi
exit 1
`);
  await chmod(cloudflaredPath, 0o755);
  await chmod(pgrepPath, 0o755);
  await writeFile(urlFile, "https://old-lifeos.trycloudflare.com");

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_TEST_CLOUDFLARE_URL_FILE = urlFile;

  const { exportIcloudHandoff, maybeRefreshIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-cloudflare-address-refresh=${Date.now()}`);
  const first = exportIcloudHandoff("test-cloudflare-address-initial");
  const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(firstPacket.baseUrl, "https://old-lifeos.trycloudflare.com");
  assert.equal(firstPacket.candidateId, "cloudflare-0");

  await writeFile(urlFile, "https://new-lifeos.trycloudflare.com");
  const refresh = maybeRefreshIcloudHandoff("test-cloudflare-address-change");
  const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  const history = JSON.parse(await readFile(first.historyFilePath, "utf8"));
  assert.equal(refresh.refreshed, true);
  assert.equal(refresh.previousStatus, "address-changed");
  assert.equal(nextPacket.baseUrl, "https://new-lifeos.trycloudflare.com");
  assert.equal(nextPacket.changeType, "cloudflare-address-changed");
  assert.equal(nextPacket.previousBaseUrl, "https://old-lifeos.trycloudflare.com");
  assert.equal(history[0].changeType, "cloudflare-address-changed");
});

test("iCloud handoff auto refresh records Tailscale HTTPS address changes", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-tailscale-address-refresh-"));
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-tailscale-bin-"));
  const hostFile = path.join(binDir, "tailscale-host.txt");
  const tailscalePath = path.join(binDir, "tailscale");
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldTailscaleHostFile = process.env.LIFEOS_TEST_TAILSCALE_HOST_FILE;
  const oldTailscaleBinArgs = process.env.LIFEOS_TAILSCALE_BIN_ARGS;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldTailscaleHostFile === undefined) delete process.env.LIFEOS_TEST_TAILSCALE_HOST_FILE;
    else process.env.LIFEOS_TEST_TAILSCALE_HOST_FILE = oldTailscaleHostFile;
    if (oldTailscaleBinArgs === undefined) delete process.env.LIFEOS_TAILSCALE_BIN_ARGS;
    else process.env.LIFEOS_TAILSCALE_BIN_ARGS = oldTailscaleBinArgs;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  await writeFile(tailscalePath, `#!/bin/sh
host="$(cat "$LIFEOS_TEST_TAILSCALE_HOST_FILE")"
if [ "$1" = "version" ]; then
  echo "1.98.8"
  exit 0
fi
if [ "$1" = "status" ] && [ "$2" = "--json" ]; then
  printf '{"Self":{"Online":true,"HostName":"%s","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}' "$host"
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  printf '{"Web":{"%s.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}' "$host"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);
  await writeFile(hostFile, "lifeos-old");

  process.env.LIFEOS_PORT = "4567";
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.LIFEOS_TAILSCALE_BIN_ARGS = "[]";
  process.env.LIFEOS_TEST_TAILSCALE_HOST_FILE = hostFile;
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { exportIcloudHandoff, maybeRefreshIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-tailscale-address-refresh=${Date.now()}`);
  const first = exportIcloudHandoff("test-tailscale-address-initial");
  const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(firstPacket.baseUrl, "https://lifeos-old.tailnet.example.ts.net");
  assert.equal(firstPacket.candidateId, "tailscale-serve-https");

  await writeFile(hostFile, "lifeos-new");
  const refresh = maybeRefreshIcloudHandoff("test-tailscale-address-change");
  const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  const history = JSON.parse(await readFile(first.historyFilePath, "utf8"));
  assert.equal(refresh.refreshed, true);
  assert.equal(refresh.previousStatus, "address-changed");
  assert.equal(nextPacket.baseUrl, "https://lifeos-new.tailnet.example.ts.net");
  assert.equal(nextPacket.changeType, "tailscale-address-changed");
  assert.equal(nextPacket.previousBaseUrl, "https://lifeos-old.tailnet.example.ts.net");
  assert.equal(history[0].changeType, "tailscale-address-changed");
});

test("iCloud handoff monitor refreshes stale entries without remote health checks", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-monitor-refresh-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldMonitor = process.env.LIFEOS_ICLOUD_HANDOFF_MONITOR;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldMonitor === undefined) delete process.env.LIFEOS_ICLOUD_HANDOFF_MONITOR;
    else process.env.LIFEOS_ICLOUD_HANDOFF_MONITOR = oldMonitor;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://monitor-old-lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_ICLOUD_HANDOFF_MONITOR = "1";

  const { exportIcloudHandoff } = await import(`../server/networkDiagnostics.ts?icloud-monitor-export=${Date.now()}`);
  const { getIcloudHandoffMonitorStatus, runIcloudHandoffRefreshCheck } = await import(`../server/icloudHandoffMonitor.ts?icloud-monitor=${Date.now()}`);
  const first = exportIcloudHandoff();
  const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(firstPacket.baseUrl, "https://monitor-old-lifeos.example.com");

  process.env.PUBLIC_BASE_URL = "https://monitor-new-lifeos.example.com";
  const monitorRun = runIcloudHandoffRefreshCheck("test-icloud-monitor-address-change");
  const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
  assert.equal(monitorRun.refreshed, true);
  assert.equal(monitorRun.refreshReason, "refreshed");
  assert.equal(monitorRun.trigger, "scheduled-check");
  assert.equal(monitorRun.changeType, "public-base-url-changed");
  assert.equal(monitorRun.status, "address-changed");
  assert.equal(monitorRun.previousStatus, "address-changed");
  assert.equal(monitorRun.recommendedBaseUrl, "https://monitor-new-lifeos.example.com");
  assert.equal(typeof monitorRun.generatedAt, "number");
  assert.equal(nextPacket.baseUrl, "https://monitor-new-lifeos.example.com");
  assert.equal(getIcloudHandoffMonitorStatus().lastResult?.refreshed, true);
  assert.equal(getIcloudHandoffMonitorStatus().lastResult?.trigger, "scheduled-check");
  assert.equal(getIcloudHandoffMonitorStatus().lastResult?.changeType, "public-base-url-changed");
  assert.equal(getIcloudHandoffMonitorStatus().lastResult?.recommendedBaseUrl, "https://monitor-new-lifeos.example.com");
});

test("iCloud startup refresh records local core restart state", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-startup-refresh-db-"));
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-startup-refresh-drive-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(icloudDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { readFile } = await import("node:fs/promises");
    const { exportIcloudHandoff } = await import("./server/networkDiagnostics.ts");
    const { getIcloudHandoffMonitorStatus, runIcloudHandoffStartupRefresh } = await import("./server/icloudHandoffMonitor.ts");

    const first = exportIcloudHandoff("test-initial-startup-refresh");
    const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
    process.env.PUBLIC_BASE_URL = "https://startup-new-lifeos.example.com";

    const startupRun = runIcloudHandoffStartupRefresh("test-local-core-startup");
    const status = getIcloudHandoffMonitorStatus();
    const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
    process.stdout.write(JSON.stringify({ firstPacket, startupRun, status, nextPacket }));
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_ICLOUD_DRIVE_DIR: icloudDir,
      LIFEOS_FORCE_ICLOUD_HANDOFF: "1",
      LIFEOS_PORT: "4567",
      PUBLIC_BASE_URL: "https://startup-old-lifeos.example.com",
      APP_URL: "",
      LIFEOS_CLOUDFLARED_BIN: "/definitely/missing/cloudflared",
      LIFEOS_TAILSCALE_BIN: "/definitely/missing/tailscale",
      LIFEOS_ICLOUD_HANDOFF_MONITOR: "1",
    },
    encoding: "utf8",
  });
  const { firstPacket, startupRun, status, nextPacket } = JSON.parse(output);
  assert.equal(firstPacket.baseUrl, "https://startup-old-lifeos.example.com");
  assert.equal(startupRun.refreshed, true);
  assert.equal(startupRun.refreshReason, "refreshed");
  assert.equal(startupRun.trigger, "local-core-startup");
  assert.equal(startupRun.changeType, "public-base-url-changed");
  assert.equal(startupRun.status, "address-changed");
  assert.equal(startupRun.previousStatus, "address-changed");
  assert.equal(startupRun.recommendedBaseUrl, "https://startup-new-lifeos.example.com");
  assert.equal(nextPacket.baseUrl, "https://startup-new-lifeos.example.com");
  assert.equal(nextPacket.exportReason, "test-local-core-startup");
  assert.equal(status.startupRunAt, startupRun.checkedAt);
  assert.equal(status.startupRunReason, "test-local-core-startup");
  assert.equal(status.startupResult.trigger, "local-core-startup");
  assert.equal(status.startupResult.changeType, "public-base-url-changed");
  assert.equal(status.startupResult.recommendedBaseUrl, "https://startup-new-lifeos.example.com");
  assert.equal(status.lastResult.recommendedBaseUrl, "https://startup-new-lifeos.example.com");
});

test("iCloud handoff monitor refreshes after a phone reports an old entry", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-phone-confirmation-refresh-db-"));
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-phone-confirmation-refresh-drive-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(icloudDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { readFile } = await import("node:fs/promises");
    const { exportIcloudHandoff } = await import("./server/networkDiagnostics.ts");
    const { insertDevice, insertDeviceIcloudHandoffEvent } = await import("./server/devices.ts");
    const { runIcloudHandoffRefreshCheck } = await import("./server/icloudHandoffMonitor.ts");

    const first = exportIcloudHandoff("test-initial-phone-confirmation-refresh");
    const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
    const now = Date.now();
    insertDevice({
      id: "phone-confirmation-refresh-phone",
      name: "Phone Confirmation Test",
      type: "mobile",
      status: "online",
      accessTokenHash: "test-hash",
      createdAt: now,
      lastSeenAt: now,
    });
    insertDeviceIcloudHandoffEvent({
      id: "phone-confirmation-current",
      deviceId: "phone-confirmation-refresh-phone",
      eventType: "opened-current-entry",
      entryBaseUrl: firstPacket.baseUrl,
      currentBaseUrl: firstPacket.baseUrl,
      storedBaseUrl: firstPacket.baseUrl,
      entryGeneratedAt: firstPacket.generatedAt,
      storedGeneratedAt: firstPacket.generatedAt,
      checksumSha256: firstPacket.entryChecksumSha256,
      ignoredAt: now + 1,
      createdAt: now + 1,
    });
    insertDeviceIcloudHandoffEvent({
      id: "phone-confirmation-expired",
      deviceId: "phone-confirmation-refresh-phone",
      eventType: "opened-expired-entry",
      entryBaseUrl: "https://expired-phone-entry.example.test/lifeos",
      currentBaseUrl: "https://expired-phone-entry.example.test/lifeos",
      storedBaseUrl: firstPacket.baseUrl,
      entryGeneratedAt: firstPacket.generatedAt - 1000,
      storedGeneratedAt: firstPacket.generatedAt,
      checksumSha256: "f".repeat(64),
      ignoredAt: now + 2,
      createdAt: now + 2,
    });

    const monitorRun = runIcloudHandoffRefreshCheck("test-phone-confirmation-issue");
    const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
    process.stdout.write(JSON.stringify({ monitorRun, firstPacket, nextPacket }));
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_ICLOUD_DRIVE_DIR: icloudDir,
      LIFEOS_FORCE_ICLOUD_HANDOFF: "1",
      LIFEOS_PORT: "4567",
      PUBLIC_BASE_URL: "https://phone-confirmation-lifeos.example.com",
      APP_URL: "",
      LIFEOS_CLOUDFLARED_BIN: "/definitely/missing/cloudflared",
      LIFEOS_TAILSCALE_BIN: "/definitely/missing/tailscale",
      LIFEOS_ICLOUD_HANDOFF_MONITOR: "1",
    },
    encoding: "utf8",
  });
  const { monitorRun, firstPacket, nextPacket } = JSON.parse(output);
  assert.equal(firstPacket.baseUrl, "https://phone-confirmation-lifeos.example.com");
  assert.equal(monitorRun.refreshed, true);
  assert.equal(monitorRun.refreshReason, "phone-confirmation-refresh");
  assert.equal(monitorRun.trigger, "phone-entry");
  assert.equal(monitorRun.changeType, "refreshed-same-address");
  assert.equal(monitorRun.status, "fresh");
  assert.equal(monitorRun.previousStatus, "fresh");
  assert.equal(monitorRun.previousPhoneConfirmationStatus, "issue-after-confirm");
  assert.equal(monitorRun.phoneConfirmationAction, "refresh-entry");
  assert.equal(nextPacket.baseUrl, "https://phone-confirmation-lifeos.example.com");
  assert.equal(nextPacket.changeType, "refreshed-same-address");
  assert.equal(nextPacket.exportReason, "test-phone-confirmation-issue");
  assert.notEqual(nextPacket.generatedAt, firstPacket.generatedAt);
});

test("iCloud handoff monitor refreshes after the latest pairing QR expires", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-pairing-refresh-db-"));
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-pairing-refresh-drive-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(icloudDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { readFile } = await import("node:fs/promises");
    const { exportIcloudHandoff } = await import("./server/networkDiagnostics.ts");
    const { insertBindingSession } = await import("./server/devices.ts");
    const { runIcloudHandoffRefreshCheck } = await import("./server/icloudHandoffMonitor.ts");

    const first = exportIcloudHandoff("test-initial-pairing-session-refresh");
    const firstPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
    const now = Date.now();
    insertBindingSession({
      id: "expired-pairing-session",
      tokenHash: "redacted-token-hash",
      baseUrl: firstPacket.baseUrl,
      createdAt: now - 10 * 60 * 1000,
      expiresAt: now - 60 * 1000,
    });

    const monitorRun = runIcloudHandoffRefreshCheck("test-expired-pairing-session");
    const nextPacket = JSON.parse(await readFile(first.packetFilePath, "utf8"));
    process.stdout.write(JSON.stringify({ monitorRun, firstPacket, nextPacket }));
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_ICLOUD_DRIVE_DIR: icloudDir,
      LIFEOS_FORCE_ICLOUD_HANDOFF: "1",
      LIFEOS_PORT: "4567",
      PUBLIC_BASE_URL: "https://pairing-session-lifeos.example.com",
      APP_URL: "",
      LIFEOS_CLOUDFLARED_BIN: "/definitely/missing/cloudflared",
      LIFEOS_TAILSCALE_BIN: "/definitely/missing/tailscale",
      LIFEOS_ICLOUD_HANDOFF_MONITOR: "1",
    },
    encoding: "utf8",
  });
  const { monitorRun, firstPacket, nextPacket } = JSON.parse(output);
  assert.equal(firstPacket.baseUrl, "https://pairing-session-lifeos.example.com");
  assert.equal(monitorRun.refreshed, true);
  assert.equal(monitorRun.refreshReason, "pairing-session-refresh");
  assert.equal(monitorRun.trigger, "pairing-session");
  assert.equal(monitorRun.changeType, "refreshed-same-address");
  assert.equal(monitorRun.status, "fresh");
  assert.equal(monitorRun.previousStatus, "fresh");
  assert.equal(monitorRun.previousPairingSessionStatus, "expired");
  assert.equal(monitorRun.pairingSessionAction, "regenerate-qr");
  assert.equal(nextPacket.baseUrl, "https://pairing-session-lifeos.example.com");
  assert.equal(nextPacket.changeType, "refreshed-same-address");
  assert.equal(nextPacket.exportReason, "test-expired-pairing-session");
  assert.notEqual(nextPacket.generatedAt, firstPacket.generatedAt);
});

test("iCloud handoff monitor refreshes stale desktop chooser index files", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-monitor-index-refresh-"));
  t.after(async () => {
    await rm(icloudDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { readFile, writeFile } = await import("node:fs/promises");
    const { exportIcloudHandoff, getNetworkDiagnostics } = await import("./server/networkDiagnostics.ts");
    const { runIcloudHandoffRefreshCheck } = await import("./server/icloudHandoffMonitor.ts");

    const first = exportIcloudHandoff("test-initial-index-monitor-refresh");
    const staleIndexHtml = await readFile(first.indexFilePath, "utf8");
    await writeFile(
      first.indexFilePath,
      staleIndexHtml.replace(/name="lifeos-entry-index-checksum" content="[a-f0-9]{64}"/, 'name="lifeos-entry-index-checksum" content="${"2".repeat(64)}"'),
    );
    const before = getNetworkDiagnostics();
    const monitorRun = runIcloudHandoffRefreshCheck("test-index-consistency-monitor");
    const after = getNetworkDiagnostics();
    process.stdout.write(JSON.stringify({ before: before.icloud.indexConsistency, monitorRun, after: after.icloud.indexConsistency }));
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      LIFEOS_ICLOUD_DRIVE_DIR: icloudDir,
      LIFEOS_FORCE_ICLOUD_HANDOFF: "1",
      LIFEOS_PORT: "4567",
      PUBLIC_BASE_URL: "https://index-monitor-lifeos.example.com",
      APP_URL: "",
      LIFEOS_CLOUDFLARED_BIN: "/definitely/missing/cloudflared",
      LIFEOS_TAILSCALE_BIN: "/definitely/missing/tailscale",
      LIFEOS_ICLOUD_SYNC_SERVICE_STATUS: "running",
      LIFEOS_ICLOUD_HANDOFF_MONITOR: "1",
    },
    encoding: "utf8",
  });
  const { before, monitorRun, after } = JSON.parse(output);
  assert.equal(before.status, "mismatch");
  assert.equal(monitorRun.refreshed, true);
  assert.equal(monitorRun.refreshReason, "index-consistency-refresh");
  assert.equal(monitorRun.previousIndexConsistencyStatus, "mismatch");
  assert.equal(monitorRun.indexConsistencyStatus, "matching");
  assert.equal(monitorRun.syncReadinessStatus, "ready");
  assert.equal(monitorRun.syncReadinessAction, "open-files-app");
  assert.equal(after.status, "matching");
});

test("iCloud repair packet analysis compares phone entry with current desktop entry", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-repair-analysis-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://new-lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { analyzeIcloudHandoffRepairPacket } = await import(`../server/networkDiagnostics.ts?icloud-repair-analysis=${Date.now()}`);
  const analysis = analyzeIcloudHandoffRepairPacket([
    "LifeOS iCloud Mobile Entry Recovery",
    "status=stale",
    "action=mobileDevice.icloudHandoffActionRefresh",
    "oneNextAction=refresh-icloud-entry",
    "entryBaseUrl=https://old-lifeos.example.com",
    "currentBaseUrl=https://old-lifeos.example.com/mobile/chat?token=should-not-survive",
    "mode=cloudflare",
    "stability=temporary",
    "label=Old Tunnel",
    "generatedAt=2026-06-01T00:00:00.000Z",
    "expiresAt=2026-06-02T00:00:00.000Z",
    "lastConnectivityOk=false",
  ].join("\n"));

  assert.equal(analysis.reason, "desktop-entry-changed");
  assert.equal(analysis.severity, "danger");
  assert.equal(analysis.parsed.oneNextAction, "refresh-icloud-entry");
  assert.equal(analysis.parsed.entryBaseUrl, "https://old-lifeos.example.com");
  assert.equal(analysis.parsed.currentBaseUrl, "https://old-lifeos.example.com/mobile/chat");
  assert.equal(analysis.desktop.recommendedBaseUrl, "https://new-lifeos.example.com");
  assert.equal(analysis.recommendations.some((item) => item.id === "refresh-icloud"), true);
  assert.equal(analysis.recommendations.some((item) => item.id === "regenerate-qr"), true);
  assert.equal(analysis.nextAction.id, "refresh-icloud");
  assert.equal(analysis.nextAction.severity, "danger");
  assert.equal(JSON.stringify(analysis).includes("should-not-survive"), false);

  const cleanupAnalysis = analyzeIcloudHandoffRepairPacket([
    "LifeOS iCloud Mobile Entry Recovery",
    "status=fresh",
    "action=mobileDevice.icloudHandoffActionReady",
    "oneNextAction=cleanup-old-entry",
    "entryBaseUrl=https://new-lifeos.example.com",
    "currentBaseUrl=https://new-lifeos.example.com/mobile/chat",
    "lastConnectivityOk=true",
  ].join("\n"));
  assert.equal(cleanupAnalysis.parsed.oneNextAction, "cleanup-old-entry");
  assert.equal(cleanupAnalysis.recommendations.some((item) => item.id === "cleanup-old-entry"), true);
  assert.equal(cleanupAnalysis.nextAction.id, "cleanup-old-entry");
});

test("iCloud availability detects placeholder files that are still syncing", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-placeholder-"));
  const appFolder = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appFolder, { recursive: true });
  await writeFile(path.join(appFolder, ".lifeos-mobile-entry-placeholder.html.icloud"), "placeholder");
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-placeholder=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.icloud.availability.status, "sync-pending");
  assert.equal(diagnostics.icloud.availability.severity, "warning");
  assert.equal(diagnostics.icloud.availability.placeholderCount, 1);
  assert.equal(diagnostics.icloud.availability.metadataPendingCount, 0);
  assert.equal(diagnostics.icloud.availability.pendingCount, 1);
  assert.equal(diagnostics.icloud.availability.appFolderExists, true);
  assert.equal(diagnostics.icloud.syncReadiness.status, "syncing");
  assert.equal(diagnostics.icloud.syncReadiness.canOpenOnPhone, false);
  assert.equal(diagnostics.icloud.syncReadiness.action, "wait-for-sync");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.humanRecovery.titleKey, "onboarding.appleRemoteIcloudHumanRecoveryWaitTitle");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.humanRecovery.primaryCtaKey, "onboarding.appleRemoteIcloudActionWaitSync");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.humanRecovery.phoneAction, "open-files-app-after-sync");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.humanRecovery.showTechnicalDetails, false);
  assert.equal(diagnostics.icloud.syncReadiness.userStep.id, "waiting-for-icloud-sync");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.primaryAction, "wait");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.titleKey, "onboarding.appleRemoteIcloudNextStepWaitTitle");
  assert.deepEqual(diagnostics.icloud.syncReadiness.userStep.pendingFiles, ["html"]);
  assert.deepEqual(diagnostics.icloud.syncReadiness.userStep.missingFiles, []);
  assert.equal(diagnostics.icloud.syncReadiness.pendingCount, 1);
  assert.deepEqual(diagnostics.icloud.availability.placeholderSamples, [".lifeos-mobile-entry-placeholder.html.icloud"]);
});

test("iCloud availability uses macOS metadata to detect files that are still syncing", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-mdls-"));
  const mdlsBin = path.join(icloudDir, "mock-mdls");
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldMdlsBin = process.env.LIFEOS_MDLS_BIN;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldMdlsBin === undefined) delete process.env.LIFEOS_MDLS_BIN;
    else process.env.LIFEOS_MDLS_BIN = oldMdlsBin;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { exportIcloudHandoff, getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-mdls=${Date.now()}`);
  const exported = exportIcloudHandoff();
  assert.equal(exported.ok, true);

  await writeFile(mdlsBin, `#!/usr/bin/env node
const file = process.argv[process.argv.length - 1] || "";
if (file.endsWith(".html")) {
  console.log(["0", "1", "1", "0", "not downloaded", "current"].join("\\n"));
} else {
  console.log(["1", "0", "1", "0", "current", "current"].join("\\n"));
}
`);
  await chmod(mdlsBin, 0o755);
  process.env.LIFEOS_MDLS_BIN = mdlsBin;

  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.icloud.availability.status, "sync-pending");
  assert.equal(diagnostics.icloud.availability.severity, "warning");
  assert.equal(diagnostics.icloud.availability.placeholderCount, 0);
  assert.equal(diagnostics.icloud.availability.metadataPendingCount >= 1, true);
  assert.equal(diagnostics.icloud.availability.pendingCount >= 1, true);
  assert.equal(diagnostics.icloud.availability.handoffFile.metadata.available, true);
  assert.equal(diagnostics.icloud.availability.handoffFile.metadata.downloading, true);
  assert.equal(diagnostics.icloud.availability.handoffFile.metadata.syncState, "syncing");
  assert.equal(diagnostics.icloud.syncReadiness.status, "syncing");
  assert.equal(diagnostics.icloud.syncReadiness.canOpenOnPhone, false);
  assert.equal(diagnostics.icloud.syncReadiness.action, "wait-for-sync");
  assert.equal(diagnostics.icloud.syncReadiness.pendingFiles.includes("html"), true);
});

test("iCloud availability warns when the sync service is not running", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-service-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldIcloudSyncServiceStatus = process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldIcloudSyncServiceStatus === undefined) delete process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;
    else process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = oldIcloudSyncServiceStatus;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = "stopped";

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-service-stopped=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();

  assert.equal(diagnostics.icloud.availability.status, "sync-service-unavailable");
  assert.equal(diagnostics.icloud.availability.severity, "warning");
  assert.equal(diagnostics.icloud.availability.syncService.checked, true);
  assert.equal(diagnostics.icloud.availability.syncService.running, false);
  assert.match(diagnostics.icloud.availability.syncService.error, /not detected|unknown|not running/i);
  assert.equal(diagnostics.icloud.syncReadiness.status, "syncing");
  assert.equal(diagnostics.icloud.syncReadiness.canOpenOnPhone, false);
  assert.equal(diagnostics.icloud.syncReadiness.action, "wait-for-sync");
});

test("iCloud availability blocks export when Apple ID or iCloud Drive is disabled", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-account-disabled-"));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldAccountStatus = process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldAccountStatus === undefined) delete process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS;
    else process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS = oldAccountStatus;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS = "signed-out";

  const { exportIcloudHandoff, getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-account-disabled=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.icloud.available, true);
  assert.equal(diagnostics.icloud.canExport, false);
  assert.equal(diagnostics.icloud.availability.status, "account-unavailable");
  assert.equal(diagnostics.icloud.availability.severity, "danger");
  assert.equal(diagnostics.icloud.availability.account.checked, true);
  assert.equal(diagnostics.icloud.availability.account.status, "signed-out");
  assert.equal(diagnostics.icloud.availability.account.signedIn, false);
  assert.equal(diagnostics.icloud.availability.account.driveEnabled, false);
  assert.equal(diagnostics.icloud.syncReadiness.status, "missing-drive");
  assert.equal(diagnostics.icloud.syncReadiness.action, "enable-icloud-drive");
  assert.throws(() => exportIcloudHandoff("test-account-disabled"), (error) => {
    assert.equal(error.code, "icloud_handoff_account_unavailable");
    assert.match(error.message, /iCloud account or iCloud Drive is not enabled/);
    return true;
  });
});

test("iCloud availability flags entry files that appear stuck syncing", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-stuck-"));
  const appFolder = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appFolder, { recursive: true });
  const placeholderPath = path.join(appFolder, ".lifeos-mobile-entry-stuck.html.icloud");
  await writeFile(placeholderPath, "placeholder");
  const oldTimestamp = new Date(Date.now() - 15 * 60 * 1000);
  fs.utimesSync(placeholderPath, oldTimestamp, oldTimestamp);

  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
  const oldIcloudSyncServiceStatus = process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;
  const oldIcloudSyncStuckAfterMs = process.env.LIFEOS_ICLOUD_SYNC_STUCK_AFTER_MS;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    if (oldIcloudSyncServiceStatus === undefined) delete process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS;
    else process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = oldIcloudSyncServiceStatus;
    if (oldIcloudSyncStuckAfterMs === undefined) delete process.env.LIFEOS_ICLOUD_SYNC_STUCK_AFTER_MS;
    else process.env.LIFEOS_ICLOUD_SYNC_STUCK_AFTER_MS = oldIcloudSyncStuckAfterMs;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;
  process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS = "running";
  process.env.LIFEOS_ICLOUD_SYNC_STUCK_AFTER_MS = "1000";

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-sync-stuck=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();

  assert.equal(diagnostics.icloud.availability.status, "sync-stuck");
  assert.equal(diagnostics.icloud.availability.severity, "warning");
  assert.equal(diagnostics.icloud.availability.pendingCount, 1);
  assert.equal(diagnostics.icloud.availability.syncStuckCount, 1);
  assert.equal(diagnostics.icloud.availability.placeholderStuckCount, 1);
  assert.equal(diagnostics.icloud.availability.syncStuckAfterMs, 1000);
  assert.deepEqual(diagnostics.icloud.availability.placeholderSamples, [".lifeos-mobile-entry-stuck.html.icloud"]);
  assert.equal(diagnostics.icloud.syncReadiness.status, "sync-stuck");
  assert.equal(diagnostics.icloud.syncReadiness.canOpenOnPhone, false);
  assert.equal(diagnostics.icloud.syncReadiness.action, "fix-icloud-sync");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.id, "repair-icloud-sync");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.primaryAction, "open-icloud-settings");
  assert.equal(diagnostics.icloud.syncReadiness.userStep.titleKey, "onboarding.appleRemoteIcloudNextStepFixSyncTitle");
  assert.deepEqual(diagnostics.icloud.syncReadiness.userStep.pendingFiles, ["html"]);
});

test("iCloud handoff diagnostics mark modified entry invalid when checksum mismatches", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-invalid-"));
  const appDir = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appDir, { recursive: true });
  const generatedAt = Date.now() - 60_000;
  await writeFile(path.join(appDir, "lifeos-mobile-entry.json"), JSON.stringify({
    kind: "lifeos-mobile-entry",
    version: 2,
    generatedAt,
    refreshAfter: generatedAt + 60_000,
    expiresAt: generatedAt + 600_000,
    candidateId: "configured-public",
    baseUrl: "https://lifeos.example.com",
    mobilePairUrl: "https://lifeos.example.com/mobile/pair",
    mobileChatUrl: "https://lifeos.example.com/mobile/chat",
    mode: "configured",
    secure: true,
    stability: "stable",
    requiresRestart: false,
    transport: "icloud-handoff",
    realtimeTransport: false,
    entryChecksumSha256: "0".repeat(64),
  }));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-invalid=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();

  assert.equal(diagnostics.icloud.handoffHealth.status, "invalid");
  assert.equal(diagnostics.icloud.handoffHealth.needsRefresh, true);
  assert.equal(diagnostics.icloud.handoffHealth.checksumOk, false);
  assert.equal(diagnostics.icloud.handoffHealth.entryChecksumSha256, "0".repeat(64));
  assert.match(diagnostics.icloud.handoffHealth.expectedChecksumSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(diagnostics.icloud.handoffHealth.expectedChecksumSha256, diagnostics.icloud.handoffHealth.entryChecksumSha256);
  assert.match(diagnostics.icloud.handoffHealth.reason, /checksum does not match/);
});

test("iCloud handoff diagnostics request refresh for legacy entries without checksum", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-legacy-"));
  const appDir = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appDir, { recursive: true });
  const generatedAt = Date.now() - 60_000;
  await writeFile(path.join(appDir, "lifeos-mobile-entry.json"), JSON.stringify({
    kind: "lifeos-mobile-entry",
    version: 1,
    generatedAt,
    refreshAfter: generatedAt + 60_000,
    expiresAt: generatedAt + 600_000,
    baseUrl: "https://lifeos.example.com",
  }));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-legacy=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();

  assert.equal(diagnostics.icloud.handoffHealth.status, "legacy");
  assert.equal(diagnostics.icloud.handoffHealth.needsRefresh, true);
  assert.equal(diagnostics.icloud.handoffHealth.checksumOk, null);
  assert.equal(diagnostics.icloud.handoffHealth.entryChecksumSha256, "");
  assert.match(diagnostics.icloud.handoffHealth.expectedChecksumSha256, /^[a-f0-9]{64}$/);
  assert.match(diagnostics.icloud.handoffHealth.reason, /older LifeOS version/);
});

test("iCloud handoff diagnostics mark exported entry stale when the recommended address changes", async (t) => {
  const icloudDir = await mkdtemp(path.join(tmpdir(), "lifeos-icloud-stale-"));
  const appDir = path.join(icloudDir, "LifeOS AI");
  fs.mkdirSync(appDir, { recursive: true });
  await writeFile(path.join(appDir, "lifeos-mobile-entry.json"), JSON.stringify({
    kind: "lifeos-mobile-entry",
    version: 2,
    generatedAt: Date.now() - 60_000,
    refreshAfter: Date.now() + 60_000,
    expiresAt: Date.now() + 600_000,
    baseUrl: "https://old-lifeos.example.com",
  }));
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldIcloudDriveDir = process.env.LIFEOS_ICLOUD_DRIVE_DIR;
  const oldForceIcloud = process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;

  t.after(async () => {
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldIcloudDriveDir === undefined) delete process.env.LIFEOS_ICLOUD_DRIVE_DIR;
    else process.env.LIFEOS_ICLOUD_DRIVE_DIR = oldIcloudDriveDir;
    if (oldForceIcloud === undefined) delete process.env.LIFEOS_FORCE_ICLOUD_HANDOFF;
    else process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = oldForceIcloud;
    await rm(icloudDir, { recursive: true, force: true });
  });

  process.env.LIFEOS_PORT = "4567";
  process.env.PUBLIC_BASE_URL = "https://new-lifeos.example.com";
  delete process.env.APP_URL;
  process.env.LIFEOS_CLOUDFLARED_BIN = "/definitely/missing/cloudflared";
  process.env.LIFEOS_TAILSCALE_BIN = "/definitely/missing/tailscale";
  process.env.LIFEOS_FORCE_ICLOUD_HANDOFF = "1";
  process.env.LIFEOS_ICLOUD_DRIVE_DIR = icloudDir;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?icloud-stale=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();

  assert.equal(diagnostics.icloud.handoffHealth.status, "address-changed");
  assert.equal(diagnostics.icloud.handoffHealth.needsRefresh, true);
  assert.equal(diagnostics.icloud.handoffHealth.lastExportedBaseUrl, "https://old-lifeos.example.com");
  assert.equal(diagnostics.icloud.recommendedBaseUrl, "https://new-lifeos.example.com");
});

test("Tailscale installer uses explicit confirmation and mocked Homebrew only", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-install-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldBrewBin = process.env.LIFEOS_BREW_BIN;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldDisableTerminalOpen = process.env.LIFEOS_DISABLE_TAILSCALE_TERMINAL_OPEN;
  const markerPath = path.join(binDir, "tailscale-installed");

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldBrewBin === undefined) delete process.env.LIFEOS_BREW_BIN;
    else process.env.LIFEOS_BREW_BIN = oldBrewBin;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldDisableTerminalOpen === undefined) delete process.env.LIFEOS_DISABLE_TAILSCALE_TERMINAL_OPEN;
    else process.env.LIFEOS_DISABLE_TAILSCALE_TERMINAL_OPEN = oldDisableTerminalOpen;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  const brewPath = path.join(binDir, "brew");
  await writeFile(tailscalePath, `#!/bin/sh
if [ ! -f ${JSON.stringify(markerPath)} ]; then
  exit 1
fi
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":false,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo '{}'
  exit 0
fi
exit 1
`);
  await writeFile(brewPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Homebrew 5.0.0"
  exit 0
fi
if [ "$1" = "install" ] && [ "$2" = "--cask" ] && [ "$3" = "tailscale-app" ]; then
  touch ${JSON.stringify(markerPath)}
  echo "tailscale installed"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);
  await chmod(brewPath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_BREW_BIN = brewPath;
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.LIFEOS_DISABLE_TAILSCALE_TERMINAL_OPEN = "1";

  const { installTailscaleClient } = await import(`../server/networkDiagnostics.ts?tailscale-install=${Date.now()}`);
  assert.throws(() => installTailscaleClient("wrong-confirmation", "4567"), /explicit confirmation/);
  if (process.platform !== "darwin") {
    assert.throws(() => installTailscaleClient("install-tailscale", "4567"), /only supported on macOS/);
    return;
  }
  const result = installTailscaleClient("install-tailscale", "4567");

  assert.equal(result.ok, false);
  assert.equal(result.alreadyInstalled, false);
  assert.equal(result.needsUserAction, true);
  assert.equal(result.terminalOpened, false);
  assert.equal(result.action, "copy-command");
  assert.equal(result.command, "brew install --cask tailscale-app");
  assert.match(result.terminalCommand, /tailscale-app/);
  assert.equal(result.status.installed, false);
  assert.match(result.message, /Mac password|Terminal/);
});

test("network diagnostics normalizes configured public base URLs before UI and pairing use", async (t) => {
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldAllowPublic = process.env.LIFEOS_ALLOW_PUBLIC;
  const oldPath = process.env.PATH || "";
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-network-empty-bin-"));

  t.after(async () => {
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldAllowPublic === undefined) delete process.env.LIFEOS_ALLOW_PUBLIC;
    else process.env.LIFEOS_ALLOW_PUBLIC = oldAllowPublic;
    process.env.PATH = oldPath;
    await rm(binDir, { recursive: true, force: true });
  });

  process.env.PUBLIC_BASE_URL = "https://user:password@example.com/lifeos/?token=pair-secret#debug";
  process.env.APP_URL = "";
  delete process.env.LIFEOS_ALLOW_PUBLIC;
  process.env.PATH = binDir;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?public-url=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.publicBaseUrl, "https://example.com/lifeos");
  assert.equal(diagnostics.recommendedBaseUrl, "https://example.com/lifeos");
  assert.equal(diagnostics.connectionCandidates[0].id, "configured-public");
  assert.equal(diagnostics.connectionCandidates[0].requiresRestart, false);
  assert.equal(diagnostics.remoteReadiness.status, "blocked");
  assert.equal(diagnostics.remoteReadiness.blockers.some((blocker) => blocker.id === "needsPublicOptIn"), true);
  assert.equal(JSON.stringify(diagnostics).includes("pair-secret"), false);
  assert.equal(JSON.stringify(diagnostics).includes("user:password"), false);
});

test("network diagnostics recommends saved desktop remote config before local-only entries", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-saved-remote-config-"));
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-empty-network-bin-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { saveDesktopRuntimeConfig } = await import("./server/desktopRuntimeConfig.ts");
    const { getNetworkDiagnostics } = await import("./server/networkDiagnostics.ts");
    saveDesktopRuntimeConfig({
      mode: "configured",
      label: "Home HTTPS Proxy",
      baseUrl: "https://lifeos.example.com/base",
    });
    const diagnostics = getNetworkDiagnostics();
    process.stdout.write(JSON.stringify({
      recommendedBaseUrl: diagnostics.recommendedBaseUrl,
      firstCandidate: diagnostics.connectionCandidates[0],
      remoteReadiness: diagnostics.remoteReadiness,
      desktopRuntimeConfig: diagnostics.desktopRuntimeConfig,
    }));
  `], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      PATH: binDir,
      LIFEOS_PORT: "4567",
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ALLOW_PUBLIC: "",
    },
    encoding: "utf8",
  });
  const diagnostics = JSON.parse(output);

  assert.equal(diagnostics.recommendedBaseUrl, "https://lifeos.example.com/base");
  assert.equal(diagnostics.firstCandidate.id, "saved-desktop-config");
  assert.equal(diagnostics.firstCandidate.label, "Home HTTPS Proxy");
  assert.equal(diagnostics.firstCandidate.baseUrl, "https://lifeos.example.com/base");
  assert.equal(diagnostics.firstCandidate.mode, "configured");
  assert.equal(diagnostics.firstCandidate.secure, true);
  assert.equal(diagnostics.firstCandidate.stability, "stable");
  assert.equal(diagnostics.firstCandidate.requiresRestart, true);
  assert.equal(diagnostics.remoteReadiness.status, "blocked");
  assert.equal(diagnostics.remoteReadiness.baseUrl, "https://lifeos.example.com/base");
  assert.equal(diagnostics.remoteReadiness.blockers.some((blocker) => blocker.id === "needsPublicOptIn"), true);
  assert.equal(diagnostics.remoteReadiness.actions.some((action) => action.id === "needsRestart"), true);
  assert.equal(diagnostics.desktopRuntimeConfig.publicBaseUrl, "https://lifeos.example.com/base");
});

test("network diagnostics ignores stale saved temporary Cloudflare URLs", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-stale-cloudflare-config-"));
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-no-cloudflare-bin-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const { saveDesktopRuntimeConfig } = await import("./server/desktopRuntimeConfig.ts");
    const { getNetworkDiagnostics } = await import("./server/networkDiagnostics.ts");
    saveDesktopRuntimeConfig({
      mode: "cloudflare",
      label: "Expired Cloudflare Tunnel",
      baseUrl: "https://old-lifeos.trycloudflare.com",
    });
    const diagnostics = getNetworkDiagnostics();
    process.stdout.write(JSON.stringify({
      recommendedBaseUrl: diagnostics.recommendedBaseUrl,
      candidates: diagnostics.connectionCandidates.map((candidate) => ({
        id: candidate.id,
        baseUrl: candidate.baseUrl,
        mode: candidate.mode,
      })),
      icloud: diagnostics.icloud,
      desktopRuntimeConfig: diagnostics.desktopRuntimeConfig,
    }));
  `], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      PATH: binDir,
      LIFEOS_PORT: "4567",
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ALLOW_PUBLIC: "",
      LIFEOS_CLOUDFLARED_BIN: "/definitely/missing/cloudflared",
      LIFEOS_TAILSCALE_BIN: "/definitely/missing/tailscale",
      LIFEOS_FORCE_ICLOUD_HANDOFF: "1",
      LIFEOS_ICLOUD_DRIVE_DIR: path.join(dataDir, "iCloud Drive"),
    },
    encoding: "utf8",
  });
  const diagnostics = JSON.parse(output);

  assert.equal(diagnostics.desktopRuntimeConfig, null);
  assert.equal(diagnostics.candidates.some((candidate) => candidate.baseUrl === "https://old-lifeos.trycloudflare.com"), false);
  assert.notEqual(diagnostics.recommendedBaseUrl, "https://old-lifeos.trycloudflare.com");
  assert.notEqual(diagnostics.icloud.recommendedBaseUrl, "https://old-lifeos.trycloudflare.com");
  assert.equal(diagnostics.icloud.canExport, false);
});

test("connection URL tests strip credentials, query secrets, and fragments from returned probe URL", async (t) => {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    const urlString = String(url);
    return {
      ok: true,
      status: 200,
      text: async () => urlString.endsWith("/api/v1/health")
        ? JSON.stringify({ service: "lifeos-local-core", publicAccessWarning: true })
        : "<!doctype html><title>LifeOS AI</title>",
    };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { testConnectionUrl } = await import(`../server/networkDiagnostics.ts?test-url=${Date.now()}`);
  const result = await testConnectionUrl("https://user:password@example.test/lifeos?token=connection-secret#debug", { includeWebSocket: false });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.test/lifeos/api/v1/health");
  assert.deepEqual(fetchedUrls, [
    "https://example.test/lifeos/api/v1/health",
    "https://example.test/lifeos/mobile/chat",
  ]);
  assert.equal(result.publicAccessWarning, true);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell"]);
  assert.deepEqual(result.fixes.map((fix) => fix.id), ["public-mode-risk"]);
  assert.equal(JSON.stringify(result).includes("connection-secret"), false);
  assert.equal(JSON.stringify(result).includes("user:password"), false);
  assert.equal(JSON.stringify(result).includes("#debug"), false);
});

test("connection URL tests health, mobile shell, and websocket under a remote base path", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/lifeos/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "lifeos-local-core", publicAccessWarning: false }));
      return;
    }
    if (req.url === "/lifeos/mobile/chat") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><title>LifeOS AI</title></html>");
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
  const { testConnectionUrl } = await import(`../server/networkDiagnostics.ts?websocket=${Date.now()}`);
  const result = await testConnectionUrl(`http://127.0.0.1:${port}/lifeos`);

  assert.equal(result.ok, true);
  assert.equal(result.publicAccessWarning, false);
  assert.equal(result.url, `http://127.0.0.1:${port}/lifeos/api/v1/health`);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell", "websocket"]);
  assert.equal(result.steps.find((step) => step.id === "websocket").status, 101);
  assert.deepEqual(result.fixes.map((fix) => fix.id), ["localhost-phone-unreachable", "https-required"]);
});

test("connection URL returns structured repair hints for blocked websocket and unsafe phone entry", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/lifeos/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ service: "lifeos-local-core", publicAccessWarning: false }));
      return;
    }
    if (req.url === "/lifeos/mobile/chat") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><title>LifeOS AI</title></html>");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.on("upgrade", (_req, socket) => {
    socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const { port } = server.address();
  const { testConnectionUrl } = await import(`../server/networkDiagnostics.ts?repair-hints=${Date.now()}`);
  const result = await testConnectionUrl(`http://127.0.0.1:${port}/lifeos?token=secret#debug`);

  assert.equal(result.ok, false);
  assert.equal(result.url, `http://127.0.0.1:${port}/lifeos/api/v1/health`);
  assert.deepEqual(result.steps.map((step) => step.id), ["health", "mobile-shell", "websocket"]);
  assert.deepEqual(result.fixes.map((fix) => fix.id), [
    "localhost-phone-unreachable",
    "https-required",
    "websocket-upgrade-blocked",
  ]);
  assert.equal(result.fixes.find((fix) => fix.id === "websocket-upgrade-blocked").stepId, "websocket");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("#debug"), false);
});

test("Tailscale HTTPS Serve helpers run controlled start and stop commands", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-serve-bin-"));
  const commandLog = path.join(binDir, "tailscale.log");
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
echo "$@" >> "${commandLog}"
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{"Web":{"lifeos-mac.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo "ok"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;

  const { startTailscaleHttpsServe, stopTailscaleHttpsServe } = await import(`../server/networkDiagnostics.ts?tailscale-serve=${Date.now()}`);
  const started = startTailscaleHttpsServe("4567");
  assert.equal(started.url, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(started.command, "tailscale serve --bg https:443 http://127.0.0.1:4567");

  const stopped = stopTailscaleHttpsServe();
  assert.equal(stopped.command, "tailscale serve --https=443 off");

  const log = await import("node:fs/promises").then((fs) => fs.readFile(commandLog, "utf8"));
  assert.match(log, /serve --bg https:443 http:\/\/127\.0\.0\.1:4567/);
  assert.match(log, /serve --https=443 off/);
});

test("Tailscale HTTP fallback is not accepted as a long-term remote entry", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-http-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldAllowPublic = process.env.LIFEOS_ALLOW_PUBLIC;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldAllowPublic === undefined) delete process.env.LIFEOS_ALLOW_PUBLIC;
    else process.env.LIFEOS_ALLOW_PUBLIC = oldAllowPublic;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{}'
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.LIFEOS_ALLOW_PUBLIC = "1";

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?tailscale-http=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  const magicDns = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-magicdns-0");
  const tailnetIp = diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-ip-0");

  assert.equal(magicDns.baseUrl, "http://lifeos-mac.tailnet.example.ts.net:4567");
  assert.equal(diagnostics.tailscale.loginCommand, "tailscale up");
  assert.equal(diagnostics.tailscale.magicDnsEnabled, true);
  assert.equal(diagnostics.tailscale.httpsServeReady, true);
  assert.equal(diagnostics.tailscale.serveRunning, false);
  assert.equal(magicDns.secure, false);
  assert.equal(magicDns.stability, "temporary");
  assert.equal(tailnetIp.baseUrl, "http://100.64.0.10:4567");
  assert.equal(tailnetIp.secure, false);
  assert.equal(tailnetIp.stability, "temporary");
  assert.equal(diagnostics.recommendedBaseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.connectionCandidates[0].id, "tailscale-serve-https");
  assert.equal(diagnostics.remoteReadiness.status, "needs-restart");
  assert.equal(diagnostics.remoteReadiness.baseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(diagnostics.remoteReadiness.actions.some((action) => action.id === "needsRestart"), true);
});

test("HTTPS tunnel is preferred over Tailscale HTTP fallback when HTTPS Serve is unavailable", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-http-cloudflare-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldCloudflaredBin = process.env.LIFEOS_CLOUDFLARED_BIN;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldCloudflaredBin === undefined) delete process.env.LIFEOS_CLOUDFLARED_BIN;
    else process.env.LIFEOS_CLOUDFLARED_BIN = oldCloudflaredBin;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  const cloudflaredPath = path.join(binDir, "cloudflared");
  const pgrepPath = path.join(binDir, "pgrep");
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-mac","TailscaleIPs":["100.64.0.10"]}}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{}'
  exit 0
fi
exit 1
`);
  await writeFile(cloudflaredPath, "#!/bin/sh\necho 'cloudflared version 2026.6.0'\n");
  await writeFile(pgrepPath, `#!/bin/sh
if [ "$2" = "cloudflared" ]; then
  echo '123 cloudflared tunnel --url http://127.0.0.1:4567 https://amber-lifeos.trycloudflare.com'
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);
  await chmod(cloudflaredPath, 0o755);
  await chmod(pgrepPath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.LIFEOS_CLOUDFLARED_BIN = cloudflaredPath;

  const { getNetworkDiagnostics } = await import(`../server/networkDiagnostics.ts?tailscale-http-cloudflare=${Date.now()}`);
  const diagnostics = getNetworkDiagnostics();
  assert.equal(diagnostics.tailscale.magicDnsEnabled, false);
  assert.equal(diagnostics.tailscale.httpsServeReady, false);
  assert.match(diagnostics.tailscale.notes.join("\n"), /MagicDNS suffix was not detected/);
  assert.equal(diagnostics.connectionCandidates[0].id, "cloudflare-0");
  assert.equal(diagnostics.connectionCandidates[0].baseUrl, "https://amber-lifeos.trycloudflare.com");
  assert.equal(diagnostics.connectionCandidates[0].secure, true);
  assert.equal(diagnostics.connectionCandidates[0].stability, "temporary");
  assert.equal(diagnostics.connectionCandidates.find((candidate) => candidate.id === "tailscale-ip-0").stability, "temporary");
  assert.equal(diagnostics.connectionCandidates.some((candidate) => candidate.id === "tailscale-serve-https"), false);
});

test("configured Tailscale HTTPS Serve autostart refreshes the saved stable URL", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-autostart-bin-"));
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldDisableAutostart = process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  const oldAutostart = process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldDisableAutostart === undefined) delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART = oldDisableAutostart;
    if (oldAutostart === undefined) delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART = oldAutostart;
    await rm(binDir, { recursive: true, force: true });
  });

  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-new","TailscaleIPs":["100.64.0.11"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  echo '{"Web":{"lifeos-new.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4567"}}}}}'
  exit 0
fi
if [ "$1" = "serve" ]; then
  echo "ok"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "4567";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.PUBLIC_BASE_URL = "https://lifeos-old.tailnet.example.ts.net";
  delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  const cacheKey = Date.now();
  const desktopConfig = await import("../server/desktopRuntimeConfig.ts");
  const networkDiagnostics = await import(`../server/networkDiagnostics.ts?tailscale-autostart=${cacheKey}`);
  const configPath = desktopConfig.desktopRuntimeConfigPath;
  const previousConfig = fs.existsSync(configPath) ? await readFile(configPath, "utf8") : null;
  t.after(async () => {
    if (previousConfig === null) await rm(configPath, { force: true });
    else await writeFile(configPath, previousConfig);
  });

  desktopConfig.saveDesktopRuntimeConfig({
    mode: "tailscale",
    label: "Tailscale HTTPS Serve",
    baseUrl: "https://lifeos-old.tailnet.example.ts.net",
  });

  const result = networkDiagnostics.maybeStartConfiguredTailscaleServe("4567");
  assert.equal(result.reason, "already_running");
  assert.equal(result.config.publicBaseUrl, "https://lifeos-new.tailnet.example.ts.net");
  assert.equal(process.env.PUBLIC_BASE_URL, "https://lifeos-new.tailnet.example.ts.net");

  const rawConfig = await readFile(configPath, "utf8");
  const savedConfig = JSON.parse(rawConfig);
  assert.equal(savedConfig.mode, "tailscale");
  assert.equal(savedConfig.publicBaseUrl, "https://lifeos-new.tailnet.example.ts.net");
  assert.equal(savedConfig.baseUrl, "https://lifeos-new.tailnet.example.ts.net");
});

test("configured Tailscale HTTPS Serve autostart uses the runtime port instead of the environment default", async (t) => {
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-tailscale-autostart-port-bin-"));
  const stateFile = path.join(binDir, "serve-target.txt");
  const oldPath = process.env.PATH || "";
  const oldPort = process.env.LIFEOS_PORT;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldTailscaleBin = process.env.LIFEOS_TAILSCALE_BIN;
  const oldDisableAutostart = process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  const oldAutostart = process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  t.after(async () => {
    process.env.PATH = oldPath;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldTailscaleBin === undefined) delete process.env.LIFEOS_TAILSCALE_BIN;
    else process.env.LIFEOS_TAILSCALE_BIN = oldTailscaleBin;
    if (oldDisableAutostart === undefined) delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART = oldDisableAutostart;
    if (oldAutostart === undefined) delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;
    else process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART = oldAutostart;
    await rm(binDir, { recursive: true, force: true });
  });

  await writeFile(stateFile, "http://127.0.0.1:3000");
  const tailscalePath = path.join(binDir, "tailscale");
  await writeFile(tailscalePath, `#!/bin/sh
STATE_FILE=${JSON.stringify(stateFile)}
if [ "$1" = "version" ]; then
  echo "1.66.4"
  exit 0
fi
if [ "$1" = "status" ]; then
  echo '{"Self":{"Online":true,"HostName":"lifeos-port","TailscaleIPs":["100.64.0.12"]},"MagicDNSSuffix":"tailnet.example.ts.net"}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  target=$(cat "$STATE_FILE")
  echo '{"Web":{"lifeos-port.tailnet.example.ts.net:443":{"Handlers":{"/":{"Proxy":"'"$target"'"}}}}}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "--bg" ]; then
  echo "$4" > "$STATE_FILE"
  echo "ok"
  exit 0
fi
exit 1
`);
  await chmod(tailscalePath, 0o755);

  process.env.PATH = `${binDir}:${oldPath}`;
  process.env.LIFEOS_PORT = "3000";
  process.env.LIFEOS_TAILSCALE_BIN = tailscalePath;
  process.env.PUBLIC_BASE_URL = "https://lifeos-port.tailnet.example.ts.net";
  delete process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART;
  delete process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART;

  const cacheKey = Date.now();
  const desktopConfig = await import("../server/desktopRuntimeConfig.ts");
  const networkDiagnostics = await import(`../server/networkDiagnostics.ts?tailscale-autostart-runtime-port=${cacheKey}`);
  const configPath = desktopConfig.desktopRuntimeConfigPath;
  const previousConfig = fs.existsSync(configPath) ? await readFile(configPath, "utf8") : null;
  t.after(async () => {
    if (previousConfig === null) await rm(configPath, { force: true });
    else await writeFile(configPath, previousConfig);
  });

  desktopConfig.saveDesktopRuntimeConfig({
    mode: "tailscale",
    label: "Tailscale HTTPS Serve",
    baseUrl: "https://lifeos-port.tailnet.example.ts.net",
  });

  const result = networkDiagnostics.maybeStartConfiguredTailscaleServe("4567");
  assert.equal(result.started, true);
  assert.equal(result.reason, "tailscale_configured");
  assert.equal(await readFile(stateFile, "utf8"), "http://127.0.0.1:4567\n");
  assert.equal(result.serve.status.serveRunning, true);
  assert.match(result.serve.status.serveStatus, /4567/);
});

test("iCloud phone confirmation status classifies missing, stale, and issue-after-confirm", async () => {
  const { buildIcloudPhoneConfirmationStatus } = await import(`../server/icloudPhoneConfirmation.ts?phone-confirmation=${Date.now()}`);
  const handoffHealth = {
    status: "fresh",
    needsRefresh: false,
    lastExportedAt: 2_000,
    lastExportedBaseUrl: "https://current.example.test/lifeos",
  };
  assert.equal(buildIcloudPhoneConfirmationStatus({ handoffHealth }).status, "missing");

  const stale = buildIcloudPhoneConfirmationStatus({
    handoffHealth,
    latestEntryOpenEvent: {
      id: "stale-open",
      deviceId: "phone-1",
      deviceName: "iPhone",
      deviceType: "mobile",
      eventType: "opened-current-entry",
      entryBaseUrl: "https://old.example.test/lifeos",
      currentBaseUrl: "https://old.example.test/lifeos",
      storedBaseUrl: "https://old.example.test/lifeos",
      entryGeneratedAt: 1_000,
      storedGeneratedAt: 1_000,
      checksumSha256: "a".repeat(64),
      ignoredAt: 3_000,
      createdAt: 3_000,
    },
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.action, "refresh-entry");

  const issueAfterConfirm = buildIcloudPhoneConfirmationStatus({
    handoffHealth,
    latestEntryOpenEvent: {
      id: "current-open",
      deviceId: "phone-1",
      deviceName: "iPhone",
      deviceType: "mobile",
      eventType: "opened-current-entry",
      entryBaseUrl: "https://current.example.test/lifeos",
      currentBaseUrl: "https://current.example.test/lifeos",
      storedBaseUrl: "https://current.example.test/lifeos",
      entryGeneratedAt: 2_000,
      storedGeneratedAt: 2_000,
      checksumSha256: "b".repeat(64),
      ignoredAt: 3_000,
      createdAt: 3_000,
    },
    latestEntryIssueEvent: {
      id: "expired-open",
      deviceId: "phone-1",
      deviceName: "iPhone",
      deviceType: "mobile",
      eventType: "opened-expired-entry",
      entryBaseUrl: "https://expired.example.test/lifeos",
      currentBaseUrl: "https://expired.example.test/lifeos",
      storedBaseUrl: "https://expired.example.test/lifeos",
      entryGeneratedAt: 1_000,
      storedGeneratedAt: 1_000,
      checksumSha256: "c".repeat(64),
      ignoredAt: 4_000,
      createdAt: 4_000,
    },
  });
  assert.equal(issueAfterConfirm.status, "issue-after-confirm");
  assert.equal(issueAfterConfirm.severity, "danger");
  assert.equal(issueAfterConfirm.latestProblemEventType, "opened-expired-entry");
});
