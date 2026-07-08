import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCloudKitNativeHelperRequest,
  CLOUDKIT_NATIVE_HELPER_RESPONSE_SCHEMA,
  runCloudKitNativeHelper,
} from "../server/cloudKitNativeHelper.ts";
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

test("Apple CloudKit helper source implements the native JSON stdio contract", async () => {
  const swiftSource = await readFile(path.join(rootDir, "native/apple/cloudkit-helper/LifeOSCloudKitHelper.swift"), "utf8");
  const buildScript = await readFile(path.join(rootDir, "scripts/build-cloudkit-helper.mjs"), "utf8");
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  assert.match(swiftSource, /import CloudKit/);
  assert.match(swiftSource, /lifeos-cloudkit-helper-request\.v1/);
  assert.match(swiftSource, /lifeos-cloudkit-helper-response\.v1/);
  assert.match(swiftSource, /--lifeos-cloudkit-json/);
  assert.match(swiftSource, /CKContainer\(identifier: containerId\)/);
  assert.match(swiftSource, /accountStatus\(\)/);
  assert.match(swiftSource, /privateCloudDatabase/);
  assert.match(swiftSource, /DELETE_DISPOSABLE_RECORDS/);
  assert.match(swiftSource, /database\.save\(record\)/);
  assert.match(swiftSource, /database\.record\(for: recordId\)/);
  assert.match(swiftSource, /database\.deleteRecord\(withID: recordId\)/);
  assert.doesNotMatch(swiftSource, /deviceCredential|sessionCookie|providerApiKey|sqliteBlob/);
  assert.match(buildScript, /CloudKit\.framework/);
  assert.match(buildScript, /build\/native\/LifeOSCloudKitHelper/);
  assert.match(packageJson.scripts["icloud:helper:build"], /build-cloudkit-helper\.mjs/);
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
    capabilitiesVerified: request.requiredNativeCapabilities,
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
