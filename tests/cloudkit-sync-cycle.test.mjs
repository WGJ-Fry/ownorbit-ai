import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolatedCloudKitCycle(env, scenario) {
  const script = `
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { runMigrations } = await import("./server/migrations.ts");
    const { createChatSession, insertMessage } = await import("./server/chat.ts");
    const { enqueueCloudKitChatRequest, getCloudKitChatJob } = await import("./server/cloudKitChatJobs.ts");
    runMigrations();

    const dataDir = process.env.LIFEOS_DATA_DIR;
    fs.mkdirSync(dataDir, { recursive: true });
    const helper = path.join(dataDir, "LifeOSCloudKitHelper");
    const entitlements = path.join(dataDir, "LifeOS.entitlements");
    fs.writeFileSync(helper, "#!/bin/sh\\nexit 0\\n");
    fs.chmodSync(helper, 0o755);
    fs.writeFileSync(entitlements, "<plist><dict><key>com.apple.developer.icloud-container-identifiers</key><array><string>iCloud.ai.lifeos.desktop</string></array></dict></plist>");
    process.env.LIFEOS_ICLOUD_DATA_SYNC = "1";
    process.env.LIFEOS_CLOUDKIT_CONTAINER_ID = "iCloud.ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_TEAM_ID = "TEAM123456";
    process.env.LIFEOS_CLOUDKIT_BUNDLE_ID = "ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_HELPER_BIN = helper;
    process.env.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH = entitlements;
    process.env.LIFEOS_CLOUDKIT_SYNC_TYPES = "chat-history";

    const session = createChatSession("Cycle local conversation");
    insertMessage(session.id, "user", { parts: [{ text: "cycle local text should only reach helper stdin" }] });

    const { getIcloudDataSyncReadiness } = await import("./server/icloudDataSyncReadiness.ts");
    const { runCloudKitSyncCycle } = await import("./server/cloudKitSyncCycle.ts");
    const now = 1700000000000;
    const pinnedRequestId = "11111111-1111-4111-8111-111111111111";
    if (${JSON.stringify(scenario)} === "pinned-chat") {
      enqueueCloudKitChatRequest({
        schemaVersion: 1,
        requestId: pinnedRequestId,
        conversationId: "22222222-2222-4222-8222-222222222222",
        userMessageId: "33333333-3333-4333-8333-333333333333",
        deviceId: "44444444-4444-4444-8444-444444444444",
        sourceDeviceHash: "a".repeat(64),
        publicKeyFingerprint: "b".repeat(64),
        trustedMacFingerprint: "c".repeat(64),
        signature: "x".repeat(86),
        prompt: "This request belongs to another trusted Mac.",
        locale: "en-US",
        status: "queued",
        clientSequence: 1,
        createdAt: now,
        expiresAt: now + 60_000,
        syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
      }, {
        recordName: "chat-request:" + pinnedRequestId,
        contentHash: "d".repeat(64),
        importedAt: now,
        now,
      });
    }
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const operations = [];

    const emptyImport = { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] };
    const fakeRunHelper = async (_readiness, options) => {
      operations.push(options.operation);
      if (options.operation === "sync-changes-preview") {
        const failed = ${JSON.stringify(scenario)} === "remote-failed";
        const moreComing = ${JSON.stringify(scenario)} === "more-coming";
        return {
          ok: !failed,
          status: failed ? "failed" : "passed",
          operation: "sync-changes-preview",
          checkedAt: new Date(now).toISOString(),
          readinessStatus: "ready",
          evidenceId: failed ? "remote-failed-evidence" : "cycle-preview-evidence",
          syncChangesPreview: {
            scannedZones: ["LifeOSChatZone"],
            changed: 0,
            deleted: 0,
            failed: failed ? 1 : 0,
            moreComing,
            rawPayloadIncluded: false,
            zones: moreComing ? [{ zone: "LifeOSChatZone", serverChangeToken: "next-page-token", changed: 100, deleted: 0, failed: 0, moreComing: true }] : [],
            changedRecords: [],
            deletedRecords: []
          },
          syncImportQuarantine: emptyImport,
          syncImportPreview: { scannedZones: [], fetched: 0, failed: 0, truncated: false, rawPayloadIncluded: false, scannedRecordTypes: [], records: [] },
          syncExport: { attempted: 0, saved: 0, failed: 0, recordPlanHash: "", zones: [] },
          roundtrip: { created: false, fetched: false, deleted: false },
          warnings: [],
          errors: failed ? ["temporary CloudKit failure"] : [],
        };
      }
      if (options.operation === "sync-export") {
        const conflictOnly = ${JSON.stringify(scenario)} === "upload-conflicts";
        const attempted = options.syncExportPackage.helperSyncBatch.records.length;
        return {
          ok: !conflictOnly,
          status: conflictOnly ? "failed" : "passed",
          operation: "sync-export",
          checkedAt: new Date(now).toISOString(),
          readinessStatus: "ready",
          requestHash: "sha256:cycle",
          evidenceId: "cycle-upload-evidence",
          syncExport: {
            attempted,
            saved: conflictOnly ? attempted - 1 : attempted,
            conflicts: conflictOnly ? 1 : 0,
            failed: conflictOnly ? 1 : 0,
            recordPlanHash: options.syncExportPackage.helperSyncBatch.recordPlanHash,
            zones: options.syncExportPackage.helperSyncBatch.zones,
          },
          syncImportPreview: { scannedZones: [], fetched: 0, failed: 0, truncated: false, rawPayloadIncluded: false, scannedRecordTypes: [], records: [] },
          syncChangesPreview: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
          syncImportQuarantine: emptyImport,
          roundtrip: { created: false, fetched: false, deleted: false },
          warnings: [],
          errors: conflictOnly ? ["CloudKit kept one newer remote record for review."] : [],
        };
      }
      if (options.operation === "sync-import-quarantine" && ${JSON.stringify(scenario)} === "more-coming") {
        return {
          ok: true,
          status: "passed",
          operation: "sync-import-quarantine",
          checkedAt: new Date(now).toISOString(),
          readinessStatus: "ready",
          evidenceId: "cycle-import-page-evidence",
          syncChangesPreview: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
          syncImportQuarantine: {
            ...emptyImport,
            scannedZones: ["LifeOSChatZone"],
            moreComing: true,
            zones: [{ zone: "LifeOSChatZone", serverChangeToken: "next-import-page-token", changed: 0, deleted: 0, failed: 0, moreComing: true }],
          },
          warnings: [],
          errors: [],
        };
      }
      throw new Error("unexpected operation " + options.operation);
    };

    const createBackup = () => ({ file: "lifeos-cycle.db", path: "/Users/example/private/lifeos-cycle.db", size: 77, createdAt: now, redaction: "sqlite-only" });
    const result = await runCloudKitSyncCycle(readiness, { now, runHelper: fakeRunHelper, createBackup });
    const pinnedJob = ${JSON.stringify(scenario)} === "pinned-chat" ? getCloudKitChatJob(pinnedRequestId) : undefined;
    process.stdout.write(JSON.stringify({ result, operations, pinnedJob }));
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("CloudKit safe sync cycle pulls first and uploads local records only after the pull is clean", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-cycle-"));
  try {
    const { result, operations } = runIsolatedCloudKitCycle({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "success");

    assert.deepEqual(operations, ["sync-changes-preview", "sync-export"]);
    assert.equal(result.status, "completed");
    assert.equal(result.nextAction, "done");
    assert.equal(result.pull.status, "no-changes");
    assert.equal(result.upload.status, "uploaded");
    assert.equal(result.upload.result.syncExport.saved, result.upload.export.exportRecordCount);
    assert.equal(result.safety.uploadRunsOnlyAfterConflictFreePull, true);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("payloadJson"), false);
    assert.equal(serialized.includes("cycle local text should only reach helper stdin"), false);
    assert.equal(serialized.includes("/Users/example"), false);
    assert.equal(serialized.includes(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit full sync cannot process a request pinned to another Mac", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-cycle-pinned-chat-"));
  try {
    const { result, operations, pinnedJob } = runIsolatedCloudKitCycle({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "pinned-chat");

    assert.deepEqual(operations, ["sync-changes-preview", "sync-export"]);
    assert.equal(result.status, "completed");
    assert.equal(result.chatWorker, undefined);
    assert.equal(result.safety.chatRelayDelegatedToDedicatedCycle, true);
    assert.equal(pinnedJob.status, "queued");
    assert.equal(pinnedJob.attemptCount, 0);
    assert.equal(pinnedJob.trustedMacFingerprint, "c".repeat(64));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit safe sync cycle stops before upload when the remote pull fails", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-cycle-failed-"));
  try {
    const { result, operations } = runIsolatedCloudKitCycle({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "remote-failed");

    assert.deepEqual(operations, ["sync-changes-preview"]);
    assert.equal(result.status, "remote-failed");
    assert.equal(result.nextAction, "retry");
    assert.equal(result.upload, undefined);
    assert.equal(result.safety.rawPayloadReturnedToAdmin, false);
    assert.equal(result.safety.cloudKitChangeTokenReturnedToAdmin, false);
    assert.equal(result.safety.localBackupPathReturnedToAdmin, false);
    assert.equal(JSON.stringify(result).includes("payloadJson"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit safe sync cycle reports partial upload conflicts as review work", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-cycle-upload-conflicts-"));
  try {
    const { result, operations } = runIsolatedCloudKitCycle({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "upload-conflicts");

    assert.deepEqual(operations, ["sync-changes-preview", "sync-export"]);
    assert.equal(result.status, "upload-conflicts");
    assert.equal(result.nextAction, "review-conflicts");
    assert.equal(result.upload.status, "conflicts");
    assert.equal(result.upload.result.syncExport.saved > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit safe sync cycle drains every remote page before uploading local records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-cycle-more-coming-"));
  try {
    const { result, operations } = runIsolatedCloudKitCycle({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "more-coming");

    assert.deepEqual(operations, ["sync-changes-preview", "sync-import-quarantine"]);
    assert.equal(result.status, "remote-more-coming");
    assert.equal(result.nextAction, "continue-pull");
    assert.equal(result.upload, undefined);
    assert.equal(result.pull.status, "more-coming");
    assert.equal(result.safety.uploadRunsOnlyAfterConflictFreePull, true);
    assert.equal(JSON.stringify(result).includes("next-page-token"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
