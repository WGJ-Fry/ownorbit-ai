import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runConfigScript(dataDir, script, extraEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_CLOUDKIT_CHAT_RELAY: "",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

test("CloudKit chat relay defaults to receive-only without enabling full data sync", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-relay-"));
  try {
    const result = runConfigScript(path.join(dir, "data"), `
      const { runMigrations } = await import("./server/migrations.ts");
      runMigrations();
      const relay = await import("./server/cloudKitChatRelayConfig.ts");
      const fullSync = await import("./server/cloudKitDataSyncConfig.ts");
      const before = relay.getCloudKitChatRelayConfig();
      const fullBefore = fullSync.getCloudKitDataSyncConfig();
      const disabled = relay.updateCloudKitChatRelayConfig({ enabled: false }, { type: "admin", id: "owner" });
      const enabled = relay.updateCloudKitChatRelayConfig({ enabled: true }, { type: "admin", id: "owner" });
      process.stdout.write(JSON.stringify({ before, fullBefore, disabled, enabled }));
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout);
    assert.equal(data.before.enabled, true);
    assert.equal(data.before.mode, "armed_receive_only");
    assert.equal(data.before.source, "default");
    assert.deepEqual(data.before.privacy.allowedRecordTypes, [
      "LifeOSDeviceKey",
      "LifeOSChatRequest",
      "LifeOSChatResponse",
      "LifeOSChatReceipt",
    ]);
    assert.equal(data.before.privacy.allowedZone, "LifeOSChatRelayZone");
    assert.equal(data.before.privacy.uploadsLocalHistory, false);
    assert.equal(data.before.privacy.uploadsMemory, false);
    assert.equal(data.before.privacy.uploadsTasks, false);
    assert.equal(data.before.privacy.uploadsGeneratedApps, false);
    assert.equal(data.fullBefore.enabled, false);
    assert.deepEqual(data.fullBefore.selectedDataTypes, []);
    assert.equal(data.disabled.mode, "disabled");
    assert.equal(data.enabled.mode, "armed_receive_only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay environment switch locks the local preference", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-relay-env-"));
  try {
    const result = runConfigScript(path.join(dir, "data"), `
      const { runMigrations } = await import("./server/migrations.ts");
      runMigrations();
      const relay = await import("./server/cloudKitChatRelayConfig.ts");
      const config = relay.getCloudKitChatRelayConfig();
      let updateError;
      try {
        relay.updateCloudKitChatRelayConfig({ enabled: true });
      } catch (error) {
        updateError = { statusCode: error.statusCode, message: error.message };
      }
      process.stdout.write(JSON.stringify({ config, updateError }));
    `, { LIFEOS_CLOUDKIT_CHAT_RELAY: "0" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout);
    assert.equal(data.config.enabled, false);
    assert.equal(data.config.mode, "disabled");
    assert.equal(data.config.source, "environment");
    assert.equal(data.config.environmentLocked, true);
    assert.equal(data.updateError.statusCode, 409);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
