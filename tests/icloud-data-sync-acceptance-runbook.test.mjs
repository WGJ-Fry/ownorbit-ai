import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runIcloudDataSyncAcceptanceRunbook } from "../scripts/icloud-data-sync-acceptance-runbook.mjs";
import { CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA } from "../server/cloudKitNativeHelper.ts";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function writeEntitlements(dir) {
  const entitlements = path.join(dir, "LifeOS.entitlements");
  await writeFile(entitlements, [
    "<plist>",
    "<key>com.apple.developer.icloud-container-identifiers</key>",
    "<array><string>iCloud.ai.lifeos.desktop</string></array>",
    "</plist>",
  ].join("\n"));
  return entitlements;
}

async function writeHelper(dir) {
  const helper = path.join(dir, "lifeos-cloudkit-helper");
  await writeFile(helper, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  const operation = request.operation;
  const base = {
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    evidenceId: "fake-icloud-acceptance-" + operation
  };
  if (operation === "roundtrip") {
    console.log(JSON.stringify({
      ...base,
      capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "create-fetch-delete-roundtrip"],
      roundtrip: {
        created: true,
        fetched: true,
        deleted: true,
        recordType: "LifeOSMessage",
        zone: "LifeOSChatZone"
      }
    }));
    return;
  }
  if (operation === "subscription-probe") {
    console.log(JSON.stringify({
      ...base,
      capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "subscription-push"],
      subscriptionProbe: {
        subscriptionId: "lifeos-private-database-changes-v1",
        exists: true,
        saved: true,
        contentAvailable: true
      }
    }));
    return;
  }
  console.log(JSON.stringify({
    ...base,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities]
  }));
});
`);
  await chmod(helper, 0o755);
  return helper;
}

async function configuredCloudKitEnv(dir) {
  return {
    LIFEOS_ICLOUD_DATA_SYNC: "1",
    LIFEOS_CLOUDKIT_CONTAINER_ID: "iCloud.ai.lifeos.desktop",
    LIFEOS_CLOUDKIT_TEAM_ID: "MOCKTEAMID",
    LIFEOS_CLOUDKIT_BUNDLE_ID: "ai.lifeos.desktop",
    LIFEOS_CLOUDKIT_HELPER_BIN: await writeHelper(dir),
    LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH: await writeEntitlements(dir),
    LIFEOS_CLOUDKIT_SYNC_TYPES: "chat-history,memory,tasks,generated-app-state,device-trust",
    LIFEOS_CLOUDKIT_TEST_WRITE_CONFIRM: "DELETE_DISPOSABLE_RECORDS",
  };
}

test("iCloud data sync acceptance reports missing readiness without leaking local paths", async () => {
  const report = await runIcloudDataSyncAcceptanceRunbook({
    env: {
      LIFEOS_ICLOUD_DATA_SYNC: undefined,
      LIFEOS_CLOUDKIT_CONTAINER_ID: undefined,
      LIFEOS_CLOUDKIT_TEAM_ID: undefined,
      LIFEOS_CLOUDKIT_BUNDLE_ID: undefined,
      LIFEOS_CLOUDKIT_HELPER_BIN: undefined,
      LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH: undefined,
      LIFEOS_CLOUDKIT_SYNC_TYPES: undefined,
    },
    platformSupported: true,
  });
  assert.equal(report.ok, false);
  assert.equal(report.realWorldReady, false);
  assert.equal(report.completionStatus, "automated-not-ready");
  assert.equal(report.readiness.status, "not-enabled");
  assert.equal(report.readiness.configuration.nativeHelperPathReturned, false);
  assert.equal(report.manualAcceptance.some((step) => step.id === "mac-restart-recovery"), true);
  assert.equal(report.manualAcceptance.some((step) => step.id === "cloudkit-background-push"), true);
  assert.match(report.claimBoundary, /never proves complete unattended iCloud data sync/);
  assert.doesNotMatch(JSON.stringify(report), /\/Users\/|lifeos-cloudkit-helper|secret-token/);
});

test("iCloud data sync acceptance runbook writes full helper evidence and real-device steps", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-icloud-acceptance-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const env = await configuredCloudKitEnv(dir);
  const report = await runIcloudDataSyncAcceptanceRunbook({
    env,
    all: true,
    platformSupported: true,
    timeoutMs: 5000,
  });
  assert.equal(report.ok, true);
  assert.equal(report.realWorldReady, false);
  assert.equal(report.completionStatus, "automated-ready-manual-required");
  assert.equal(report.automatedChecks.fullHelperEvidence, true);
  assert.equal(report.automatedChecks.steps.some((step) => step.operation === "roundtrip" && step.roundtrip.created), true);
  assert.equal(report.automatedChecks.steps.some((step) => step.operation === "subscription-probe" && step.subscriptionProbe.contentAvailable), true);
  for (const id of ["mac-a-cloudkit-upload", "mac-b-cloudkit-import", "iphone-cellular-entry-boundary", "wifi-cellular-switch", "mac-restart-recovery", "icloud-delay-human-copy", "old-entry-qr-expiry", "multi-desktop-default-entry", "cloudkit-background-push", "offline-conflict-review"]) {
    assert.equal(report.manualAcceptance.some((step) => step.id === id && step.required), true, `${id} should be required`);
  }
  assert.doesNotMatch(JSON.stringify(report), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("iCloud data sync acceptance CLI writes redacted evidence", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-icloud-acceptance-cli-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const env = await configuredCloudKitEnv(dir);
  const outPath = path.join(dir, "icloud-acceptance.json");
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "scripts/icloud-data-sync-acceptance-runbook.mjs",
    "--all",
    "--out",
    outPath,
    "--json",
  ], {
    cwd: rootDir,
    env: {
      PATH: process.env.PATH || "",
      ...env,
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /automated-ready-manual-required/);
  assert.match(result.stdout, /cloudkit-background-push/);
  const written = await readFile(outPath, "utf8");
  assert.match(written, /mac-b-cloudkit-import/);
  assert.match(written, /subscription-probe/);
  assert.match(written, /nativeHelperPathReturned/);
  assert.doesNotMatch(written, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(written, /DELETE_DISPOSABLE_RECORDS|MOCKTEAMID/);
});
