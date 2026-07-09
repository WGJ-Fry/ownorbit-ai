import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolatedCloudKitSyncNow(env, scenario) {
  const script = `
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { runMigrations } = await import("./server/migrations.ts");
    const { db } = await import("./server/db.ts");
    runMigrations();

    const dataDir = process.env.LIFEOS_DATA_DIR;
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

    const { getIcloudDataSyncReadiness } = await import("./server/icloudDataSyncReadiness.ts");
    const { runCloudKitSyncNow } = await import("./server/cloudKitSyncNow.ts");
    const now = 1700000000000;
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const requiresReview = ${JSON.stringify(scenario)} === "manual-review";
    const remoteChangedCount = ${JSON.stringify(scenario)} === "apply" ? 1 : 2;

    const skippedResult = (operation, reason) => ({
      ok: false,
      status: "skipped",
      operation,
      checkedAt: new Date(now).toISOString(),
      readinessStatus: "not-enabled",
      reason,
      syncChangesPreview: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
      syncImportQuarantine: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
    });

    const fakeRunHelper = async (_readiness, options) => {
      if (${JSON.stringify(scenario)} === "needs-setup") return skippedResult(options.operation, "CloudKit data sync is not enabled.");
      if (options.operation === "sync-changes-preview") {
        return {
          ok: true,
          status: "passed",
          operation: "sync-changes-preview",
          checkedAt: new Date(now).toISOString(),
          readinessStatus: "ready",
          evidenceId: "sync-now-evidence-preview",
          syncChangesPreview: {
            scannedZones: ["LifeOSChatZone"],
            changed: remoteChangedCount,
            deleted: 0,
            failed: 0,
            moreComing: false,
            rawPayloadIncluded: false,
            zones: [{
              zone: "LifeOSChatZone",
              previousServerChangeTokenPresent: false,
              serverChangeToken: "opaque-preview-token",
              changed: remoteChangedCount,
              deleted: 0,
              failed: 0,
              moreComing: false
            }],
            changedRecords: [],
            deletedRecords: []
          },
          syncImportQuarantine: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
        };
      }
      return {
        ok: true,
        status: "passed",
        operation: "sync-import-quarantine",
        checkedAt: new Date(now).toISOString(),
        readinessStatus: "ready",
        evidenceId: "sync-now-evidence-import",
        syncChangesPreview: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
        syncImportQuarantine: {
          scannedZones: ["LifeOSChatZone"],
          changed: remoteChangedCount,
          deleted: 0,
          failed: 0,
          moreComing: false,
          rawPayloadIncluded: true,
          zones: [{
            zone: "LifeOSChatZone",
            previousServerChangeTokenPresent: false,
            serverChangeToken: "opaque-import-token",
            changed: remoteChangedCount,
            deleted: 0,
            failed: 0,
            moreComing: false
          }],
          changedRecords: ${JSON.stringify(scenario)} === "apply" ? [{
            zone: "LifeOSChatZone",
            recordType: "LifeOSMessage",
            recordName: "message:remote-message",
            mutationId: "mut-message",
            contentHash: "hash-message",
            logicalClock: now + 2,
            payloadByteSize: 120,
            modifiedAt: new Date(now + 2).toISOString(),
            requiresUserReview: false,
            payloadJson: JSON.stringify({ conversationId: "remote-convo", conversationTitle: "Remote synced", messageId: "remote-message", role: "user", contentJson: { parts: [{ text: "hello from cloudkit" }] }, createdAt: now + 2, mutationId: "mut-message", logicalClock: now + 2 })
          }] : [{
            zone: "LifeOSChatZone",
            recordType: "LifeOSConversation",
            recordName: "conversation:remote-convo",
            mutationId: "mut-convo",
            contentHash: "hash-convo",
            logicalClock: now + 1,
            payloadByteSize: 100,
            modifiedAt: new Date(now + 1).toISOString(),
            requiresUserReview: requiresReview,
            payloadJson: JSON.stringify({ conversationId: "remote-convo", title: "Remote synced", createdAt: now, updatedAt: now + 1 })
          }, {
            zone: "LifeOSChatZone",
            recordType: "LifeOSMessage",
            recordName: "message:remote-message",
            mutationId: "mut-message",
            contentHash: "hash-message",
            logicalClock: now + 2,
            payloadByteSize: 120,
            modifiedAt: new Date(now + 2).toISOString(),
            requiresUserReview: requiresReview,
            payloadJson: JSON.stringify({ conversationId: "remote-convo", messageId: "remote-message", role: "user", contentJson: { parts: [{ text: "hello from cloudkit" }] }, createdAt: now + 2, mutationId: "mut-message", logicalClock: now + 2 })
          }],
          deletedRecords: []
        },
      };
    };

    const createBackup = () => ({ file: "/Users/example/lifeos.db", size: 12, createdAt: now, redaction: "sqlite-only" });
    const result = await runCloudKitSyncNow(readiness, { now, runHelper: fakeRunHelper, createBackup });
    const sessions = db.prepare("SELECT id, title FROM chat_sessions ORDER BY id").all();
    const messages = db.prepare("SELECT id, session_id as sessionId, content_json as contentJson, source_device_id as sourceDeviceId FROM messages ORDER BY id").all();
    process.stdout.write(JSON.stringify({ result, sessions, messages }));
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

test("CloudKit safe sync now imports, applies conflict-free records, and returns only safe summaries", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-now-"));
  try {
    const { result, sessions, messages } = runIsolatedCloudKitSyncNow({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "apply");

    assert.equal(result.status, "applied");
    assert.equal(result.nextAction, "done");
    assert.equal(result.changes.savedCheckpointCount, 1);
    assert.equal(result.import.quarantine.importedChanged, 1);
    assert.equal(result.import.quarantine.autoReady, 1);
    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 1);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.equal(result.apply.conflicts, 0);
    assert.equal(result.quarantine.summary.autoReady, 0);
    assert.equal(result.quarantine.summary.pendingReview, 0);
    assert.equal(result.safety.rawPayloadReturnedToAdmin, false);
    assert.equal(result.safety.serverChangeTokenReturnedToAdmin, false);
    assert.equal(result.backups.length, 2);
    assert.equal(sessions[0].id, "remote-convo");
    assert.equal(sessions[0].title, "Remote synced");
    assert.equal(messages[0].id, "remote-message");
    assert.equal(messages[0].sourceDeviceId, "cloudkit");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("payloadJson"), false);
    assert.equal(serialized.includes("hello from cloudkit"), false);
    assert.equal(serialized.includes("opaque-preview-token"), false);
    assert.equal(serialized.includes("opaque-import-token"), false);
    assert.equal(serialized.includes("/Users/example"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit safe sync now leaves manual-review records in quarantine instead of auto-applying them", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-now-review-"));
  try {
    const { result, sessions, messages } = runIsolatedCloudKitSyncNow({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "manual-review");

    assert.equal(result.status, "conflicts");
    assert.equal(result.nextAction, "review-conflicts");
    assert.equal(result.import.quarantine.importedChanged, 2);
    assert.equal(result.import.quarantine.autoReady, 0);
    assert.equal(result.import.quarantine.pendingReview, 2);
    assert.equal(result.apply.attempted, 0);
    assert.equal(result.apply.applied, 0);
    assert.equal(result.apply.manualReviewRequired, 2);
    assert.equal(result.quarantine.summary.pendingReview, 2);
    assert.equal(result.backups.length, 1);
    assert.deepEqual(sessions, []);
    assert.deepEqual(messages, []);
    assert.equal(JSON.stringify(result).includes("payloadJson"), false);
    assert.equal(JSON.stringify(result).includes("hello from cloudkit"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit safe sync now gives one setup action when native CloudKit is not ready", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-now-setup-"));
  try {
    const { result } = runIsolatedCloudKitSyncNow({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "needs-setup");

    assert.equal(result.status, "needs-setup");
    assert.equal(result.nextAction, "configure-cloudkit");
    assert.equal(result.apply.attempted, 0);
    assert.equal(result.backups.length, 0);
    assert.equal(JSON.stringify(result).includes("opaque-preview-token"), false);
    assert.equal(JSON.stringify(result).includes("opaque-import-token"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
