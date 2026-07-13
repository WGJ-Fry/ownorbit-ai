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
      LIFEOS_ICLOUD_DATA_SYNC: "",
      LIFEOS_CLOUDKIT_SYNC_TYPES: "",
      ...extraEnv,
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

test("CloudKit data sync opt-in persists only safe non-sensitive settings in SQLite", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-data-sync-config-"));
  try {
    const result = runConfigScript(path.join(dir, "data"), `
      const { runMigrations } = await import("./server/migrations.ts");
      runMigrations();
      const configModule = await import("./server/cloudKitDataSyncConfig.ts");
      const { getClientState } = await import("./server/clientState.ts");
      const before = configModule.getCloudKitDataSyncConfig();
      const enabled = configModule.updateCloudKitDataSyncConfig({
        enabled: true,
        selectedDataTypes: ["memory", "tasks", "memory"],
      }, { type: "admin", id: "owner" });
      const { getIcloudDataSyncReadiness } = await import("./server/icloudDataSyncReadiness.ts");
      const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
      const stored = getClientState(configModule.CLOUDKIT_DATA_SYNC_CONFIG_STATE_KEY);
      const disabled = configModule.updateCloudKitDataSyncConfig({
        enabled: false,
        selectedDataTypes: enabled.selectedDataTypes,
      }, { type: "admin", id: "owner" });
      let blockedError = null;
      try {
        configModule.updateCloudKitDataSyncConfig({ enabled: true, selectedDataTypes: ["memory", "ai-keys"] });
      } catch (error) {
        blockedError = { message: error.message, statusCode: error.statusCode, blockedDataTypes: error.blockedDataTypes };
      }
      process.stdout.write(JSON.stringify({ before, enabled, readiness, stored, disabled, blockedError }));
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout);
    assert.equal(data.before.enabled, false);
    assert.equal(data.before.enabledSource, "default");
    assert.deepEqual(data.before.selectedDataTypes, ["chat-history", "memory", "tasks", "generated-app-state", "device-trust"]);
    assert.equal(data.enabled.enabled, true);
    assert.equal(data.enabled.enabledSource, "sqlite");
    assert.deepEqual(data.enabled.selectedDataTypes, ["memory", "tasks"]);
    assert.equal(data.readiness.enabled, true);
    assert.equal(data.readiness.status, "missing-container");
    assert.equal(data.readiness.setupStatus, "missing-container");
    assert.equal(data.readiness.configuration.enabledSource, "sqlite");
    assert.equal(data.stored.value.version, 1);
    assert.deepEqual(Object.keys(data.stored.value).sort(), ["enabled", "selectedDataTypes", "updatedAt", "version"]);
    assert.equal(JSON.stringify(data.stored).match(/token|password|secret|credential|apple.?id|helper.?path/i), null);
    assert.equal(data.disabled.enabled, false);
    assert.equal(data.blockedError.statusCode, 400);
    assert.deepEqual(data.blockedError.blockedDataTypes, ["ai-keys"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit environment settings override and lock the persisted UI configuration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-data-sync-env-"));
  try {
    const result = runConfigScript(path.join(dir, "data"), `
      const { runMigrations } = await import("./server/migrations.ts");
      runMigrations();
      const configModule = await import("./server/cloudKitDataSyncConfig.ts");
      const config = configModule.getCloudKitDataSyncConfig();
      let updateError = null;
      try {
        configModule.updateCloudKitDataSyncConfig({ enabled: false, selectedDataTypes: ["memory"] });
      } catch (error) {
        updateError = { message: error.message, statusCode: error.statusCode };
      }
      process.stdout.write(JSON.stringify({ config, updateError }));
    `, {
      LIFEOS_ICLOUD_DATA_SYNC: "1",
      LIFEOS_CLOUDKIT_SYNC_TYPES: "memory,tasks,ai-keys",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout);
    assert.equal(data.config.enabled, true);
    assert.equal(data.config.enabledSource, "environment");
    assert.equal(data.config.dataTypesSource, "environment");
    assert.equal(data.config.environmentLocked, true);
    assert.deepEqual(data.config.selectedDataTypes, ["memory", "tasks"]);
    assert.equal(data.updateError.statusCode, 409);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
