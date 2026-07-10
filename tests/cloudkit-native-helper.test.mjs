import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCloudKitNativeHelperRequest,
  CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA,
  runCloudKitNativeHelper,
} from "../server/cloudKitNativeHelper.ts";
import { CLOUDKIT_SYNC_EXPORT_CONFIRMATION, CLOUDKIT_SYNC_EXPORT_SCHEMA } from "../server/cloudKitSyncBatch.ts";
import { CLOUDKIT_SYNC_IMPORT_CONFIRMATION, publicCloudKitHelperResult } from "../server/cloudKitSyncState.ts";
import { getIcloudDataSyncReadiness } from "../server/icloudDataSyncReadiness.ts";

const envKeys = [
  "LIFEOS_ICLOUD_DATA_SYNC",
  "LIFEOS_CLOUDKIT_CONTAINER_ID",
  "LIFEOS_CLOUDKIT_TEAM_ID",
  "APPLE_TEAM_ID",
  "LIFEOS_CLOUDKIT_BUNDLE_ID",
  "LIFEOS_APP_BUNDLE_ID",
  "LIFEOS_CLOUDKIT_HELPER_BIN",
  "LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH",
  "LIFEOS_CLOUDKIT_SYNC_TYPES",
];

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);

function snapshotEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of envKeys) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

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

async function configureReadyCloudKitEnv(dir, helperSource) {
  const helper = path.join(dir, "lifeos-cloudkit-helper");
  const entitlements = await writeEntitlements(dir);
  await writeFile(helper, helperSource || "#!/bin/sh\nexit 0\n");
  await chmod(helper, 0o755);
  process.env.LIFEOS_ICLOUD_DATA_SYNC = "1";
  process.env.LIFEOS_CLOUDKIT_CONTAINER_ID = "iCloud.ai.lifeos.desktop";
  process.env.LIFEOS_CLOUDKIT_TEAM_ID = "TEAM123456";
  process.env.LIFEOS_CLOUDKIT_BUNDLE_ID = "ai.lifeos.desktop";
  process.env.LIFEOS_CLOUDKIT_HELPER_BIN = helper;
  process.env.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH = entitlements;
  process.env.LIFEOS_CLOUDKIT_SYNC_TYPES = "chat-history,tasks,raw-tokens";
  return helper;
}

test("CloudKit helper request is a safe JSON contract without local helper paths", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-contract-"));
  try {
    const helper = await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const request = buildCloudKitNativeHelperRequest(readiness, "roundtrip", new Date("2026-01-02T03:04:05.000Z"));
    const serialized = JSON.stringify(request);
    assert.equal(readiness.ready, true);
    assert.equal(serialized.includes(helper), false);
    assert.equal(serialized.includes(dir), false);
    assert.equal(request.schema, "lifeos-cloudkit-helper-request.v1");
    assert.equal(request.operation, "roundtrip");
    assert.deepEqual(request.selectedDataTypes, ["chat-history", "tasks"]);
    assert.equal(request.recordPlan[0].recordTypes.includes("LifeOSConversation"), true);
    assert.equal(request.safety.neverSyncDataTypes.includes("ai-keys"), true);
    assert.equal(request.safety.blockedDataTypes.includes("raw-tokens"), true);
    assert.equal(request.safety.forbiddenFieldNames.includes("rawToken"), true);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper request carries only applied change tokens for changes preview", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-sync-changes-contract-"));
  try {
    const helper = await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const request = buildCloudKitNativeHelperRequest(
      readiness,
      "sync-changes-preview",
      new Date("2026-01-02T03:04:05.000Z"),
      undefined,
      {
        generatedAt: "2026-01-02T03:04:04.000Z",
        zones: [{ zone: "LifeOSChatZone", serverChangeToken: "opaque-token", tokenState: "applied", updatedAt: 1 }],
      },
    );
    const serialized = JSON.stringify(request);
    assert.equal(readiness.ready, true);
    assert.equal(request.operation, "sync-changes-preview");
    assert.equal(request.syncState.zones.length, 1);
    assert.equal(request.syncState.zones[0].zone, "LifeOSChatZone");
    assert.equal(request.syncState.zones[0].serverChangeToken, "opaque-token");
    assert.equal(serialized.includes(helper), false);
    assert.equal(serialized.includes(dir), false);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper request carries explicit confirmation for quarantine import", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-sync-import-quarantine-contract-"));
  try {
    const helper = await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const request = buildCloudKitNativeHelperRequest(
      readiness,
      "sync-import-quarantine",
      new Date("2026-01-02T03:04:05.000Z"),
      undefined,
      {
        generatedAt: "2026-01-02T03:04:04.000Z",
        zones: [{ zone: "LifeOSChatZone", serverChangeToken: "opaque-token", tokenState: "applied", updatedAt: 1 }],
      },
      CLOUDKIT_SYNC_IMPORT_CONFIRMATION,
    );
    const serialized = JSON.stringify(request);
    assert.equal(readiness.ready, true);
    assert.equal(request.operation, "sync-import-quarantine");
    assert.equal(request.importConfirmation, CLOUDKIT_SYNC_IMPORT_CONFIRMATION);
    assert.equal(request.syncState.zones[0].serverChangeToken, "opaque-token");
    assert.equal(serialized.includes(helper), false);
    assert.equal(serialized.includes(dir), false);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper request carries an approved sync export batch only for native helper stdin", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-sync-export-contract-"));
  try {
    const helper = await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const syncExportPackage = {
      ok: true,
      helperSyncBatch: {
        schema: CLOUDKIT_SYNC_EXPORT_SCHEMA,
        confirmation: CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
        recordPlanHash: "abc123",
        generatedAt: "2026-01-02T03:04:05.000Z",
        zones: [{ zone: "LifeOSChatZone", records: 1 }],
        records: [{
          zone: "LifeOSChatZone",
          recordType: "LifeOSMessage",
          recordName: "message:one",
          mutationId: "mutation-one",
          contentHash: "hash-one",
          fields: {
            lifeosSchema: "lifeos-cloudkit-record.v1",
            payloadJson: JSON.stringify({ text: "safe helper payload" }),
            logicalClock: 1,
          },
        }],
      },
    };
    const request = buildCloudKitNativeHelperRequest(readiness, "sync-export", new Date("2026-01-02T03:04:05.000Z"), syncExportPackage);
    const serialized = JSON.stringify(request);
    assert.equal(readiness.ready, true);
    assert.equal(request.operation, "sync-export");
    assert.equal(request.syncBatch.schema, CLOUDKIT_SYNC_EXPORT_SCHEMA);
    assert.equal(request.syncBatch.confirmation, CLOUDKIT_SYNC_EXPORT_CONFIRMATION);
    assert.equal(request.syncBatch.records[0].fields.payloadJson.includes("safe helper payload"), true);
    assert.equal(serialized.includes(helper), false);
    assert.equal(serialized.includes(dir), false);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("Apple CloudKit helper source implements the native JSON stdio contract", async () => {
  const swiftSource = await readFile(path.join(rootDir, "native/apple/cloudkit-helper/LifeOSCloudKitHelper.swift"), "utf8");
  const buildScript = await readFile(path.join(rootDir, "scripts/build-cloudkit-helper.mjs"), "utf8");
  const xcodeBuildScript = await readFile(path.join(rootDir, "scripts/build-cloudkit-helper-xcode.mjs"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  assert.match(swiftSource, /import CloudKit/);
  assert.match(swiftSource, /lifeos-cloudkit-helper-request\.v1/);
  assert.match(swiftSource, /lifeos-cloudkit-helper-response\.v1/);
  assert.match(swiftSource, /--lifeos-cloudkit-json/);
  assert.match(swiftSource, /CKContainer\(identifier: containerId\)/);
  assert.match(swiftSource, /accountStatus\(\)/);
  assert.match(swiftSource, /privateCloudDatabase/);
  assert.match(swiftSource, /DELETE_DISPOSABLE_RECORDS/);
  assert.match(swiftSource, /SYNC_APPROVED_RECORDS/);
  assert.match(swiftSource, /runSyncExport/);
  assert.match(swiftSource, /sync-export-save/);
  assert.match(swiftSource, /runSyncImportPreview/);
  assert.match(swiftSource, /sync-import-preview-query/);
  assert.match(swiftSource, /runSyncChangesPreview/);
  assert.match(swiftSource, /sync-changes-preview/);
  assert.match(swiftSource, /IMPORT_CLOUDKIT_CHANGES/);
  assert.match(swiftSource, /runSyncImportQuarantine/);
  assert.match(swiftSource, /sync-import-quarantine/);
  assert.match(swiftSource, /runSubscriptionProbe/);
  assert.match(swiftSource, /CKDatabaseSubscription/);
  assert.match(swiftSource, /subscription-push/);
  assert.match(swiftSource, /subscriptionProbe/);
  assert.match(swiftSource, /payloadJson/);
  assert.match(swiftSource, /recordZoneChanges/);
  assert.match(swiftSource, /CKServerChangeToken/);
  assert.match(swiftSource, /database\.save\(record\)/);
  assert.match(swiftSource, /database\.record\(for: recordId\)/);
  assert.match(swiftSource, /database\.records\(/);
  assert.match(swiftSource, /database\.deleteRecord\(withID: recordId\)/);
  assert.match(swiftSource, /rawPayloadIncluded/);
  assert.doesNotMatch(swiftSource, /deviceCredential|sessionCookie|providerApiKey|sqliteBlob/);
  assert.match(buildScript, /CloudKit\.framework/);
  assert.match(buildScript, /build\/native\/LifeOSCloudKitHelper/);
  assert.match(buildScript, /LIFEOS_CLOUDKIT_SIGN_HELPER/);
  assert.match(buildScript, /LIFEOS_CLOUDKIT_SIGN_IDENTITY/);
  assert.match(buildScript, /LIFEOS_CLOUDKIT_CONTAINER_ID/);
  assert.match(buildScript, /com\.apple\.developer\.icloud-container-identifiers/);
  assert.match(buildScript, /com\.apple\.developer\.icloud-services/);
  assert.match(buildScript, /codesign/);
  assert.match(buildScript, /--entitlements/);
  assert.match(buildScript, /--verify/);
  assert.match(buildScript, /launchCheck/);
  assert.match(buildScript, /matching Apple provisioning profile/);
  assert.match(xcodeBuildScript, /xcodegen/);
  assert.match(xcodeBuildScript, /xcodebuild/);
  assert.match(xcodeBuildScript, /type: application/);
  assert.match(xcodeBuildScript, /CODE_SIGN_STYLE: Automatic/);
  assert.match(xcodeBuildScript, /LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES/);
  assert.match(xcodeBuildScript, /-allowProvisioningUpdates/);
  assert.match(xcodeBuildScript, /PLA Update available/);
  assert.match(xcodeBuildScript, /Program License Agreement must be accepted/);
  assert.match(xcodeBuildScript, /com\.apple\.developer\.icloud-container-identifiers/);
  assert.match(xcodeBuildScript, /launchCheck/);
  assert.match(packageJson.scripts["icloud:helper:build"], /build-cloudkit-helper\.mjs/);
  assert.match(packageJson.scripts["icloud:helper:xcode:build"], /build-cloudkit-helper-xcode\.mjs/);
});

test("CloudKit helper roundtrip executes the configured native helper contract", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-roundtrip-"));
  try {
    await configureReadyCloudKitEnv(dir, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  const firstPlan = request.recordPlan[0] || {};
  console.log(JSON.stringify({
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation: request.operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "create-fetch-delete-roundtrip"],
    roundtrip: {
      created: true,
      fetched: true,
      deleted: true,
      recordType: firstPlan.recordTypes?.[0] || "LifeOSSyncCheckpoint",
      zone: firstPlan.zone || "LifeOSChatZone"
    },
    evidenceId: "fake-cloudkit-evidence"
  }));
});
`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "roundtrip",
      now: new Date("2026-01-02T03:04:05.000Z"),
      timeoutMs: 5000,
    });
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.operation, "roundtrip");
    assert.equal(result.roundtrip.created, true);
    assert.equal(result.roundtrip.fetched, true);
    assert.equal(result.roundtrip.deleted, true);
    assert.equal(result.capabilitiesVerified.includes("change-token-fetch"), true);
    assert.equal(result.evidenceId, "fake-cloudkit-evidence");
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper subscription probe executes the configured native helper contract", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-subscription-probe-"));
  try {
    await configureReadyCloudKitEnv(dir, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  if (request.operation !== "subscription-probe") process.exit(8);
  console.log(JSON.stringify({
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation: request.operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "subscription-push"],
    subscriptionProbe: {
      subscriptionId: "lifeos-private-database-changes-v1",
      exists: true,
      saved: true,
      contentAvailable: true
    },
    evidenceId: "fake-cloudkit-subscription-probe-evidence"
  }));
});
`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "subscription-probe",
      now: new Date("2026-01-02T03:04:05.000Z"),
      timeoutMs: 5000,
    });
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.operation, "subscription-probe");
    assert.equal(result.subscriptionProbe.subscriptionId, "lifeos-private-database-changes-v1");
    assert.equal(result.subscriptionProbe.exists, true);
    assert.equal(result.subscriptionProbe.saved, true);
    assert.equal(result.subscriptionProbe.contentAvailable, true);
    assert.equal(result.operationCapabilityCoverageOk, true);
    assert.equal(result.capabilitiesVerified.includes("subscription-push"), true);
    assert.equal(result.evidenceId, "fake-cloudkit-subscription-probe-evidence");
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper smoke CLI can run the subscription probe in strict mode", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-subscription-cli-"));
  try {
    await configureReadyCloudKitEnv(dir, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  if (request.operation !== "subscription-probe") process.exit(8);
  console.log(JSON.stringify({
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation: request.operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "subscription-push"],
    subscriptionProbe: {
      subscriptionId: "lifeos-private-database-changes-v1",
      exists: true,
      saved: true,
      contentAvailable: true
    },
    evidenceId: "fake-cloudkit-subscription-cli-evidence"
  }));
});
`);
    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      path.join(rootDir, "scripts/cloudkit-native-helper-smoke.mjs"),
      "--subscription-probe",
      "--strict",
    ], {
      cwd: rootDir,
      env: { ...process.env },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"operation": "subscription-probe"/);
    assert.match(result.stdout, /"status": "passed"/);
    assert.match(result.stdout, /fake-cloudkit-subscription-cli-evidence/);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper sync export executes the configured native helper contract", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-sync-export-"));
  try {
    await configureReadyCloudKitEnv(dir, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  const records = request.syncBatch?.records || [];
  console.log(JSON.stringify({
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation: request.operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "sync-export-save"],
    syncExport: {
      attempted: records.length,
      saved: records.length,
      failed: 0,
      recordPlanHash: request.syncBatch?.recordPlanHash || "",
      zones: [...new Set(records.map((record) => record.zone))],
      recordTypes: [...new Set(records.map((record) => record.recordType))]
    },
    evidenceId: "fake-cloudkit-sync-export-evidence"
  }));
});
`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "sync-export",
      now: new Date("2026-01-02T03:04:05.000Z"),
      timeoutMs: 5000,
      syncExportPackage: {
        ok: true,
        helperSyncBatch: {
          schema: CLOUDKIT_SYNC_EXPORT_SCHEMA,
          confirmation: CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
          recordPlanHash: "sync-export-hash",
          generatedAt: "2026-01-02T03:04:05.000Z",
          zones: [{ zone: "LifeOSChatZone", records: 1 }],
          records: [{
            zone: "LifeOSChatZone",
            recordType: "LifeOSMessage",
            recordName: "message:one",
            mutationId: "mutation-one",
            contentHash: "hash-one",
            fields: {
              lifeosSchema: "lifeos-cloudkit-record.v1",
              payloadJson: JSON.stringify({ text: "safe helper payload" }),
              logicalClock: 1,
            },
          }],
        },
      },
    });
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.operation, "sync-export");
    assert.equal(result.syncExport.attempted, 1);
    assert.equal(result.syncExport.saved, 1);
    assert.equal(result.syncExport.failed, 0);
    assert.equal(result.syncExport.recordPlanHash, "sync-export-hash");
    assert.equal(result.capabilitiesVerified.includes("sync-export-save"), true);
    assert.equal(result.evidenceId, "fake-cloudkit-sync-export-evidence");
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper sync import preview executes the configured native helper contract", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-sync-import-preview-"));
  try {
    await configureReadyCloudKitEnv(dir, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  const plans = request.recordPlan || [];
  console.log(JSON.stringify({
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation: request.operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "sync-import-preview-query"],
    syncImportPreview: {
      scannedZones: [...new Set(plans.map((plan) => plan.zone))],
      scannedRecordTypes: [...new Set(plans.flatMap((plan) => plan.recordTypes || []))],
      fetched: 1,
      failed: 0,
      truncated: false,
      rawPayloadIncluded: false,
      records: [{
        zone: "LifeOSChatZone",
        recordType: "LifeOSMessage",
        recordName: "message:one",
        mutationId: "mutation-one",
        contentHash: "hash-one",
        logicalClock: 1,
        payloadByteSize: 123,
        modifiedAt: "2026-01-02T03:04:05.000Z",
        requiresUserReview: true
      }]
    },
    evidenceId: "fake-cloudkit-sync-import-preview-evidence"
  }));
});
`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "sync-import-preview",
      now: new Date("2026-01-02T03:04:05.000Z"),
      timeoutMs: 5000,
    });
    const serialized = JSON.stringify(result);
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.operation, "sync-import-preview");
    assert.equal(result.syncImportPreview.fetched, 1);
    assert.equal(result.syncImportPreview.failed, 0);
    assert.equal(result.syncImportPreview.truncated, false);
    assert.equal(result.syncImportPreview.records[0].contentHash, "hash-one");
    assert.equal(result.syncImportPreview.records[0].requiresUserReview, true);
    assert.equal(result.capabilitiesVerified.includes("sync-import-preview-query"), true);
    assert.equal(result.evidenceId, "fake-cloudkit-sync-import-preview-evidence");
    assert.equal(serialized.includes("payloadJson"), false);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper sync changes preview executes the configured native helper contract", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-sync-changes-preview-"));
  try {
    await configureReadyCloudKitEnv(dir, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  const plans = request.recordPlan || [];
  const zones = [...new Set(plans.map((plan) => plan.zone).filter(Boolean))];
  console.log(JSON.stringify({
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation: request.operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "sync-changes-preview"],
    syncChangesPreview: {
      scannedZones: zones,
      changed: 1,
      deleted: 1,
      failed: 0,
      moreComing: false,
      rawPayloadIncluded: false,
      zones: [{
        zone: "LifeOSChatZone",
        previousServerChangeTokenPresent: Boolean(request.syncState?.zones?.[0]?.serverChangeToken),
        serverChangeToken: "opaque-next-token",
        changed: 1,
        deleted: 1,
        failed: 0,
        moreComing: false
      }],
      changedRecords: [{
        zone: "LifeOSChatZone",
        recordType: "LifeOSMessage",
        recordName: "message:changed",
        mutationId: "mutation-changed",
        contentHash: "hash-changed",
        logicalClock: 2,
        payloadByteSize: 456,
        modifiedAt: "2026-01-02T03:05:05.000Z",
        requiresUserReview: true
      }],
      deletedRecords: [{
        zone: "LifeOSChatZone",
        recordType: "LifeOSMessage",
        recordName: "message:deleted",
        deletedAt: "2026-01-02T03:05:06.000Z"
      }]
    },
    evidenceId: "fake-cloudkit-sync-changes-preview-evidence"
  }));
});
`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "sync-changes-preview",
      now: new Date("2026-01-02T03:04:05.000Z"),
      timeoutMs: 5000,
      syncState: {
        generatedAt: "2026-01-02T03:04:04.000Z",
        zones: [{ zone: "LifeOSChatZone", serverChangeToken: "opaque-previous-token", tokenState: "applied", updatedAt: 1 }],
      },
    });
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.operation, "sync-changes-preview");
    assert.equal(result.syncChangesPreview.changed, 1);
    assert.equal(result.syncChangesPreview.deleted, 1);
    assert.equal(result.syncChangesPreview.failed, 0);
    assert.equal(result.syncChangesPreview.zones[0].previousServerChangeTokenPresent, true);
    assert.equal(result.syncChangesPreview.zones[0].serverChangeToken, "opaque-next-token");
    assert.equal(result.syncChangesPreview.rawPayloadIncluded, false);
    assert.equal(result.capabilitiesVerified.includes("sync-changes-preview"), true);
    assert.equal(result.evidenceId, "fake-cloudkit-sync-changes-preview-evidence");
    const publicResult = publicCloudKitHelperResult(result);
    assert.equal(publicResult.syncChangesPreview.zones[0].serverChangeTokenCaptured, true);
    assert.equal(JSON.stringify(publicResult).includes("opaque-next-token"), false);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper sync import quarantine keeps payloads off public admin responses", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-sync-import-quarantine-"));
  try {
    await configureReadyCloudKitEnv(dir, `#!/usr/bin/env node
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  if (!process.argv.includes("--lifeos-cloudkit-json")) process.exit(7);
  const request = JSON.parse(body);
  if (request.importConfirmation !== "${CLOUDKIT_SYNC_IMPORT_CONFIRMATION}") process.exit(8);
  const plans = request.recordPlan || [];
  const zones = [...new Set(plans.map((plan) => plan.zone).filter(Boolean))];
  console.log(JSON.stringify({
    protocolVersion: 1,
    schema: "${CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA}",
    operation: request.operation,
    ok: true,
    accountStatus: "available",
    containerReachable: true,
    capabilitiesVerified: ["container-reachability", ...request.requiredNativeCapabilities, "sync-import-quarantine"],
    syncImportQuarantine: {
      scannedZones: zones,
      changed: 1,
      deleted: 1,
      failed: 0,
      moreComing: false,
      rawPayloadIncluded: true,
      zones: [{
        zone: "LifeOSChatZone",
        previousServerChangeTokenPresent: Boolean(request.syncState?.zones?.[0]?.serverChangeToken),
        serverChangeToken: "opaque-import-token",
        changed: 1,
        deleted: 1,
        failed: 0,
        moreComing: false
      }],
      changedRecords: [{
        zone: "LifeOSChatZone",
        recordType: "LifeOSMessage",
        recordName: "message:remote",
        mutationId: "mutation-remote",
        contentHash: "hash-remote",
        logicalClock: 3,
        payloadByteSize: 77,
        modifiedAt: "2026-01-02T03:06:05.000Z",
        requiresUserReview: true,
        payloadJson: JSON.stringify({ messageId: "m1", text: "remote text" })
      }],
      deletedRecords: [{
        zone: "LifeOSChatZone",
        recordType: "LifeOSMessage",
        recordName: "message:deleted",
        deletedAt: "2026-01-02T03:06:06.000Z"
      }]
    },
    evidenceId: "fake-cloudkit-sync-import-quarantine-evidence"
  }));
});
`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "sync-import-quarantine",
      now: new Date("2026-01-02T03:04:05.000Z"),
      timeoutMs: 5000,
      importConfirmation: CLOUDKIT_SYNC_IMPORT_CONFIRMATION,
      syncState: {
        generatedAt: "2026-01-02T03:04:04.000Z",
        zones: [{ zone: "LifeOSChatZone", serverChangeToken: "opaque-previous-token", tokenState: "applied", updatedAt: 1 }],
      },
    });
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.operation, "sync-import-quarantine");
    assert.equal(result.syncImportQuarantine.changed, 1);
    assert.equal(result.syncImportQuarantine.deleted, 1);
    assert.equal(result.syncImportQuarantine.rawPayloadIncluded, true);
    assert.equal(result.syncImportQuarantine.changedRecords[0].payloadJson.includes("remote text"), true);
    assert.equal(result.syncImportQuarantine.zones[0].serverChangeToken, "opaque-import-token");
    assert.equal(result.capabilitiesVerified.includes("sync-import-quarantine"), true);
    assert.equal(result.evidenceId, "fake-cloudkit-sync-import-quarantine-evidence");
    const publicResult = publicCloudKitHelperResult(result);
    const publicSerialized = JSON.stringify(publicResult);
    assert.equal(publicResult.syncImportQuarantine.zones[0].serverChangeTokenCaptured, true);
    assert.equal(publicResult.syncImportQuarantine.changedRecords[0].payloadCaptured, true);
    assert.equal(publicSerialized.includes("payloadJson"), false);
    assert.equal(publicSerialized.includes("remote text"), false);
    assert.equal(publicSerialized.includes("opaque-import-token"), false);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper smoke redacts helper stderr and payload errors", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-redaction-"));
  try {
    await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "probe",
      runCommand: async () => ({
        exitCode: 1,
        timedOut: false,
        stdout: JSON.stringify({
          protocolVersion: 1,
          schema: CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA,
          operation: "probe",
          ok: false,
          errors: ["token=sk-secret-value /Users/wangguojun/private.txt"],
        }),
        stderr: "Bearer abcdef123456 github_pat_secret /Users/wangguojun/private.txt",
      }),
    });
    const serialized = JSON.stringify(result);
    assert.equal(result.status, "failed");
    assert.equal(serialized.includes("sk-secret-value"), false);
    assert.equal(serialized.includes("github_pat_secret"), false);
    assert.equal(serialized.includes("wangguojun"), false);
    assert.equal(serialized.includes("[redacted"), true);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper reports a provisioning action when macOS blocks startup", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-launch-blocked-"));
  try {
    await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "probe",
      runCommand: async () => ({
        exitCode: null,
        signal: "SIGKILL",
        timedOut: false,
        stdout: "",
        stderr: "",
      }),
    });

    assert.equal(result.status, "failed");
    assert.equal(result.failureKind, "helper-launch-blocked");
    assert.equal(result.command.signal, "SIGKILL");
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /matching Apple provisioning profile/);
    assert.equal(result.errors.some((error) => error.includes("not valid JSON")), false);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper reports missing native capabilities instead of overstating real sync readiness", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-missing-capabilities-"));
  try {
    await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "probe",
      runCommand: async () => ({
        exitCode: 0,
        timedOut: false,
        stdout: JSON.stringify({
          protocolVersion: 1,
          schema: CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA,
          operation: "probe",
          ok: true,
          accountStatus: "available",
          containerReachable: true,
          capabilitiesVerified: ["account-status", "private-database", "container-reachability"],
          evidenceId: "partial-probe-evidence",
        }),
        stderr: "",
      }),
    });
    assert.equal(result.status, "passed");
    assert.equal(result.ok, true);
    assert.equal(result.nativeCapabilityCoverageOk, false);
    assert.equal(result.requiredNativeCapabilities.includes("subscription-push"), true);
    assert.equal(result.missingNativeCapabilities.includes("subscription-push"), true);
    assert.equal(result.missingNativeCapabilities.includes("change-token-fetch"), true);
    assert.equal(result.capabilitiesVerified.includes("private-database"), true);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper fails an operation when its required native capability proof is missing", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-helper-operation-capability-"));
  try {
    await configureReadyCloudKitEnv(dir);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, {
      operation: "sync-changes-preview",
      syncState: {
        generatedAt: "2026-01-02T03:04:04.000Z",
        zones: [{ zone: "LifeOSChatZone", serverChangeToken: "opaque-previous-token", tokenState: "applied", updatedAt: 1 }],
      },
      runCommand: async () => ({
        exitCode: 0,
        timedOut: false,
        stdout: JSON.stringify({
          protocolVersion: 1,
          schema: CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA,
          operation: "sync-changes-preview",
          ok: true,
          accountStatus: "available",
          containerReachable: true,
          capabilitiesVerified: ["account-status", "private-database", "container-reachability", "custom-zones"],
          syncChangesPreview: {
            scannedZones: ["LifeOSChatZone"],
            changed: 0,
            deleted: 0,
            failed: 0,
            moreComing: false,
            rawPayloadIncluded: false,
            zones: [],
            changedRecords: [],
            deletedRecords: [],
          },
          evidenceId: "incomplete-changes-preview-evidence",
        }),
        stderr: "",
      }),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.ok, false);
    assert.equal(result.operationCapabilityCoverageOk, false);
    assert.equal(result.requiredOperationCapabilities.includes("change-token-fetch"), true);
    assert.equal(result.missingOperationCapabilities.includes("change-token-fetch"), true);
    assert.match(result.errors.join("\n"), /required operation capabilities/);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit helper smoke skips instead of pretending real sync is ready", async () => {
  const env = snapshotEnv();
  try {
    for (const key of envKeys) delete process.env[key];
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const result = await runCloudKitNativeHelper(readiness, { operation: "probe" });
    assert.equal(result.status, "skipped");
    assert.equal(result.readinessStatus, "not-enabled");
    assert.match(result.reason, /not enabled/);
  } finally {
    restoreEnv(env);
  }
});
