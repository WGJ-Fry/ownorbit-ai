import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function makeReadyCloudKitEnv(dir) {
  const helper = path.join(dir, "lifeos-cloudkit-helper");
  const entitlements = path.join(dir, "LifeOS.entitlements");
  await writeFile(helper, "#!/bin/sh\nexit 0\n");
  await chmod(helper, 0o755);
  await writeFile(entitlements, [
    "<plist>",
    "<key>com.apple.developer.icloud-container-identifiers</key>",
    "<array><string>iCloud.ai.lifeos.desktop</string></array>",
    "</plist>",
  ].join("\n"));
  return { helper, entitlements };
}

function runIsolatedCloudKitBatch(env) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    const { db } = await import("./server/db.ts");
    runMigrations();
    const { createChatSession, insertMessage } = await import("./server/chat.ts");
    const { insertMemory } = await import("./server/memories.ts");
    const { getIcloudDataSyncReadiness } = await import("./server/icloudDataSyncReadiness.ts");
    const { buildCloudKitSyncBatchPreview } = await import("./server/cloudKitSyncBatch.ts");

    const session = createChatSession("Sync smoke conversation");
    insertMessage(session.id, "user", { parts: [{ text: "Plan the family budget safely" }] });
    insertMessage(session.id, "user", { parts: [{ text: "do not sync sk-secret-value-1234567890" }] });
    insertMemory("Safe memory", "Buy milk and plan the week", "normal");
    insertMemory("Sensitive memory", "passport token=secret", "sensitive");
    db.prepare("INSERT INTO tasks (id, type, status, input_json, result_json, error, created_by_device_id, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)")
      .run("task-sync-1", "planning", "ready", JSON.stringify({ title: "Review tasks" }), JSON.stringify({ ok: true }), 1700000000000, 1700000001000);
    db.prepare("INSERT INTO custom_apps (id, name, description, visibility, status, source, code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("app-sync-1", "Budget helper", "Generated helper", "private", "active", "studio", "<html></html>", 1700000000000, 1700000001000);
    db.prepare("INSERT INTO custom_app_state (app_id, state_json, updated_at) VALUES (?, ?, ?)")
      .run("app-sync-1", JSON.stringify({ rows: [{ name: "Rent", amount: 1 }] }), 1700000002000);

    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const preview = buildCloudKitSyncBatchPreview(readiness, { limit: 100 });
    process.stdout.write(JSON.stringify(preview));
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

function runIsolatedCloudKitExport(env) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    const { db } = await import("./server/db.ts");
    runMigrations();
    const { createChatSession, insertMessage } = await import("./server/chat.ts");
    const { insertMemory } = await import("./server/memories.ts");
    const { getIcloudDataSyncReadiness } = await import("./server/icloudDataSyncReadiness.ts");
    const {
      buildCloudKitSyncExportPackage,
      CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
      summarizeCloudKitSyncExportPackage,
    } = await import("./server/cloudKitSyncBatch.ts");

    const session = createChatSession("Safe export conversation");
    insertMessage(session.id, "user", { parts: [{ text: "Plan tomorrow without secrets" }] });
    insertMemory("Safe export memory", "Prepare the weekly plan", "normal");
    db.prepare("INSERT INTO tasks (id, type, status, input_json, result_json, error, created_by_device_id, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?)")
      .run("task-export-1", "planning", "ready", JSON.stringify({ title: "Review export" }), JSON.stringify({ ok: true }), 1700000000000, 1700000001000);

    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    const exportPackage = buildCloudKitSyncExportPackage(readiness, {
      limit: 100,
      confirmation: CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
      now: new Date("2026-01-02T03:04:05.000Z"),
    });
    process.stdout.write(JSON.stringify({
      exportPackage,
      summary: summarizeCloudKitSyncExportPackage(exportPackage),
    }));
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

test("CloudKit sync batch preview builds safe records and blocks sensitive payloads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-batch-"));
  try {
    const { helper, entitlements } = await makeReadyCloudKitEnv(dir);
    const preview = runIsolatedCloudKitBatch({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
      LIFEOS_ICLOUD_DATA_SYNC: "1",
      LIFEOS_CLOUDKIT_CONTAINER_ID: "iCloud.ai.lifeos.desktop",
      LIFEOS_CLOUDKIT_TEAM_ID: "TEAM123456",
      LIFEOS_CLOUDKIT_BUNDLE_ID: "ai.lifeos.desktop",
      LIFEOS_CLOUDKIT_HELPER_BIN: helper,
      LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH: entitlements,
      LIFEOS_CLOUDKIT_SYNC_TYPES: "chat-history,memory,tasks,generated-app-state,raw-tokens",
    });

    assert.equal(preview.status, "needs-review");
    assert.equal(preview.dataSyncScope, "cloudkit-native-candidate");
    assert.equal(preview.readyRecordCount >= 5, true);
    assert.equal(preview.blockedRecordCount >= 2, true);
    assert.equal(preview.safety.rawPayloadIncluded, false);
    assert.equal(preview.safety.secretLikeContentBlocked >= 1, true);
    assert.equal(preview.safety.sensitiveMemoryBlocked >= 1, true);
    assert.ok(preview.recordTypes.some((item) => item.recordType === "LifeOSMessage"));
    assert.ok(preview.recordTypes.some((item) => item.recordType === "LifeOSMemory"));
    assert.ok(preview.recordTypes.some((item) => item.recordType === "LifeOSTask"));
    assert.ok(preview.recordTypes.some((item) => item.recordType === "LifeOSGeneratedAppState"));
    assert.equal(preview.records.some((record) => record.recordType === "LifeOSMessage" && record.requiresUserReview === false), true);
    assert.equal(preview.records.some((record) => record.recordType === "LifeOSConversation" && record.requiresUserReview === true), true);
    assert.equal(preview.helperPayloadPlan.sendsRawUserContent, false);
    assert.equal(preview.helperPayloadPlan.nextHelperOperation, "sync-export-blocked");
    const serialized = JSON.stringify(preview);
    assert.equal(serialized.includes("Plan the family budget safely"), false);
    assert.equal(serialized.includes("Buy milk and plan the week"), false);
    assert.equal(serialized.includes("sk-secret-value"), false);
    assert.equal(serialized.includes("passport token"), false);
    assert.equal(serialized.includes(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit sync batch preview skips when data sync is not explicitly enabled", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-batch-disabled-"));
  try {
    const preview = runIsolatedCloudKitBatch({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
      LIFEOS_ICLOUD_DATA_SYNC: "",
      LIFEOS_CLOUDKIT_SYNC_TYPES: "",
    });
    assert.equal(preview.status, "skipped");
    assert.equal(preview.readyRecordCount, 0);
    assert.equal(preview.blockedRecordCount, 0);
    assert.equal(preview.helperPayloadPlan.nextHelperOperation, "sync-export-blocked");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit sync export package is ready only after confirmation and keeps admin summary payload-free", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-export-"));
  try {
    const { helper, entitlements } = await makeReadyCloudKitEnv(dir);
    const { exportPackage, summary } = runIsolatedCloudKitExport({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
      LIFEOS_ICLOUD_DATA_SYNC: "1",
      LIFEOS_CLOUDKIT_CONTAINER_ID: "iCloud.ai.lifeos.desktop",
      LIFEOS_CLOUDKIT_TEAM_ID: "TEAM123456",
      LIFEOS_CLOUDKIT_BUNDLE_ID: "ai.lifeos.desktop",
      LIFEOS_CLOUDKIT_HELPER_BIN: helper,
      LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH: entitlements,
      LIFEOS_CLOUDKIT_SYNC_TYPES: "chat-history,memory,tasks",
    });
    assert.equal(exportPackage.ok, true);
    assert.equal(exportPackage.status, "ready");
    assert.equal(exportPackage.safety.rawPayloadReturnedToAdmin, false);
    assert.equal(exportPackage.safety.rawPayloadSentToNativeHelper, true);
    assert.equal(exportPackage.helperSyncBatch.schema, "lifeos-cloudkit-sync-export.v1");
    assert.equal(exportPackage.helperSyncBatch.confirmation, "SYNC_APPROVED_RECORDS");
    assert.equal(exportPackage.helperSyncBatch.records.length >= 3, true);
    assert.equal(exportPackage.helperSyncBatch.records.some((record) => record.recordType === "LifeOSMessage" && record.fields.requiresUserReview === false), true);
    assert.equal(exportPackage.helperSyncBatch.records.some((record) => record.recordType === "LifeOSConversation" && record.fields.requiresUserReview === true), true);
    assert.equal(exportPackage.helperSyncBatch.records.some((record) => (
      record.recordType === "LifeOSMessage" &&
      JSON.parse(String(record.fields.payloadJson || "{}")).conversationTitle === "Safe export conversation"
    )), true);
    assert.equal(JSON.stringify(exportPackage.helperSyncBatch).includes("Plan tomorrow without secrets"), true);
    assert.equal(summary.ok, true);
    assert.equal(summary.exportRecordCount, exportPackage.helperSyncBatch.records.length);
    const serializedSummary = JSON.stringify(summary);
    assert.equal(serializedSummary.includes("Safe export conversation"), false);
    assert.equal(serializedSummary.includes("Plan tomorrow without secrets"), false);
    assert.equal(serializedSummary.includes("Prepare the weekly plan"), false);
    assert.equal(serializedSummary.includes(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
