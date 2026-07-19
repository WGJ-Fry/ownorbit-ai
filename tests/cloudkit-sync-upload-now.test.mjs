import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolatedCloudKitUploadNow(env, scenario) {
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
    process.env.LIFEOS_ICLOUD_DATA_SYNC = ${JSON.stringify(scenario)} === "needs-setup" ? "" : "1";
    process.env.LIFEOS_CLOUDKIT_CONTAINER_ID = "iCloud.ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_TEAM_ID = "TEAM123456";
    process.env.LIFEOS_CLOUDKIT_BUNDLE_ID = "ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_HELPER_BIN = helper;
    process.env.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH = entitlements;
    process.env.LIFEOS_CLOUDKIT_SYNC_TYPES = "chat-history";

    if (["upload", "conflicts"].includes(${JSON.stringify(scenario)})) {
      const session = createChatSession("Local upload conversation");
      insertMessage(session.id, "user", { parts: [{ text: "local text should only reach helper stdin" }] });
    }

    const { getIcloudDataSyncReadiness } = await import("./server/icloudDataSyncReadiness.ts");
    const { runCloudKitSyncUploadNow } = await import("./server/cloudKitSyncUploadNow.ts");
    const now = 1700000000000;
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });

    const fakeRunHelper = async (_readiness, options) => {
      if (options.operation !== "sync-export") throw new Error("unexpected operation " + options.operation);
      if (!options.syncExportPackage?.ok) throw new Error("missing export package");
      const conflictOnly = ${JSON.stringify(scenario)} === "conflicts";
      const attempted = options.syncExportPackage.helperSyncBatch.records.length;
      return {
        ok: !conflictOnly,
        status: conflictOnly ? "failed" : "passed",
        operation: "sync-export",
        checkedAt: new Date(now).toISOString(),
        readinessStatus: "ready",
        requestHash: "sha256:uploadnow",
        evidenceId: "safe-upload-evidence",
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
        syncImportQuarantine: { scannedZones: [], changed: 0, deleted: 0, failed: 0, moreComing: false, rawPayloadIncluded: false, zones: [], changedRecords: [], deletedRecords: [] },
        roundtrip: { created: false, fetched: false, deleted: false },
        warnings: [],
        errors: conflictOnly ? ["CloudKit kept one newer remote record for review."] : [],
      };
    };

    const createBackup = () => ({ file: "lifeos-upload.db", path: "/Users/example/private/lifeos-upload.db", size: 42, createdAt: now, redaction: "sqlite-only" });
    const result = await runCloudKitSyncUploadNow(readiness, { now, runHelper: fakeRunHelper, createBackup });
    process.stdout.write(JSON.stringify({ result }));
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

test("CloudKit safe upload now writes approved local records and returns only safe summaries", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-upload-now-"));
  try {
    const { result } = runIsolatedCloudKitUploadNow({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "upload");

    assert.equal(result.status, "uploaded");
    assert.equal(result.nextAction, "done");
    assert.equal(result.export.ok, true);
    assert.equal(result.export.exportRecordCount >= 2, true);
    assert.equal(result.result.syncExport.saved, result.export.exportRecordCount);
    assert.equal(result.backup.created, true);
    assert.equal(result.safety.rawPayloadReturnedToAdmin, false);
    assert.equal(result.safety.localBackupPathReturnedToAdmin, false);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("payloadJson"), false);
    assert.equal(serialized.includes("local text should only reach helper stdin"), false);
    assert.equal(serialized.includes("/Users/example"), false);
    assert.equal(serialized.includes(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit safe upload now gives one setup action when CloudKit is not enabled", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-upload-now-setup-"));
  try {
    const { result } = runIsolatedCloudKitUploadNow({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "needs-setup");

    assert.equal(result.status, "needs-setup");
    assert.equal(result.nextAction, "configure-cloudkit");
    assert.equal(result.export.exportRecordCount, 0);
    assert.equal(result.backup, undefined);
    assert.equal(result.result, undefined);
    assert.equal(result.safety.rawPayloadReturnedToAdmin, false);
    assert.equal(result.safety.localBackupPathReturnedToAdmin, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit safe upload reports remote record conflicts without asking for a blind retry", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-upload-now-conflicts-"));
  try {
    const { result } = runIsolatedCloudKitUploadNow({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "conflicts");

    assert.equal(result.ok, false);
    assert.equal(result.status, "conflicts");
    assert.equal(result.nextAction, "review-conflicts");
    assert.equal(result.result.syncExport.conflicts, 1);
    assert.equal(result.result.syncExport.saved > 0, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
