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
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const operations = [];

    const emptyImport = { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] };
    const fakeRunHelper = async (_readiness, options) => {
      operations.push(options.operation);
      if (options.operation === "sync-changes-preview") {
        const failed = ${JSON.stringify(scenario)} === "remote-failed";
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
            moreComing: false,
            rawPayloadIncluded: false,
            zones: [],
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
        return {
          ok: true,
          status: "passed",
          operation: "sync-export",
          checkedAt: new Date(now).toISOString(),
          readinessStatus: "ready",
          requestHash: "sha256:cycle",
          evidenceId: "cycle-upload-evidence",
          syncExport: {
            attempted: options.syncExportPackage.helperSyncBatch.records.length,
            saved: options.syncExportPackage.helperSyncBatch.records.length,
            failed: 0,
            recordPlanHash: options.syncExportPackage.helperSyncBatch.recordPlanHash,
            zones: options.syncExportPackage.helperSyncBatch.zones,
          },
          syncImportPreview: { scannedZones: [], fetched: 0, failed: 0, truncated: false, rawPayloadIncluded: false, scannedRecordTypes: [], records: [] },
          syncChangesPreview: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
          syncImportQuarantine: emptyImport,
          roundtrip: { created: false, fetched: false, deleted: false },
          warnings: [],
          errors: [],
        };
      }
      throw new Error("unexpected operation " + options.operation);
    };

    const createBackup = () => ({ file: "lifeos-cycle.db", path: "/Users/example/private/lifeos-cycle.db", size: 77, createdAt: now, redaction: "sqlite-only" });
    const result = await runCloudKitSyncCycle(readiness, { now, runHelper: fakeRunHelper, createBackup });
    process.stdout.write(JSON.stringify({ result, operations }));
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
