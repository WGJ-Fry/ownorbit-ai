import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolatedAutoSync(env, scenario) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    runMigrations();

    const scheduleModule = await import("./server/cloudKitAutoSyncSchedule.ts");
    const auditModule = await import("./server/audit.ts");
    const now = 1700000000000;
    const calls = [];
    const readyReadiness = {
      enabled: true,
      ready: true,
      status: "ready-to-test",
      dataSyncScope: "cloudkit-native-candidate",
    };
    const notReadyReadiness = {
      enabled: false,
      ready: false,
      status: "not-enabled",
      dataSyncScope: "entry-file-only",
    };
    const fakeRunCycle = async () => {
      calls.push("cycle");
      return {
        ok: true,
        status: "completed",
        nextAction: "done",
        startedAt: now,
        finishedAt: now + 25,
        limit: 100,
        pull: {
          ok: true,
          status: "applied",
          nextAction: "done",
          startedAt: now,
          finishedAt: now + 10,
          limit: 100,
          changes: { result: { status: "passed" }, savedCheckpointCount: 1, checkpoints: [] },
          apply: { attempted: 2, applied: 2, manualReviewRequired: 0, conflicts: 0, failed: 0, skipped: 0, promotedZones: ["LifeOSChatZone"], blockedZones: [], records: [], summary: {}, checkpoints: [] },
          quarantine: { summary: {}, checkpoints: [] },
          backups: [],
          safety: { rawPayloadReturnedToAdmin: false, cloudKitChangeTokenReturnedToAdmin: false, appliesOnlyConflictFreeRecords: true },
        },
        upload: {
          ok: true,
          status: "uploaded",
          nextAction: "done",
          startedAt: now + 10,
          finishedAt: now + 25,
          limit: 100,
          export: { exportRecordCount: 3 },
          result: { syncExport: { saved: 3 } },
          safety: { rawPayloadReturnedToAdmin: false, rawPayloadSentOnlyToNativeHelper: true, localBackupPathReturnedToAdmin: false, requiresExplicitConfirmation: true },
        },
        safety: { rawPayloadReturnedToAdmin: false, cloudKitChangeTokenReturnedToAdmin: false, localBackupPathReturnedToAdmin: false, uploadRunsOnlyAfterConflictFreePull: true },
      };
    };

    const defaultSchedule = scheduleModule.getCloudKitAutoSyncSchedule();
    const tooEarly = await scheduleModule.runDueCloudKitAutoSync(now, { getReadiness: () => readyReadiness, runCycle: fakeRunCycle });
    const saved = scheduleModule.updateCloudKitAutoSyncSchedule({
      enabled: true,
      intervalMinutes: 15,
      lastRunAt: now - 16 * 60 * 1000,
    }, { type: "admin", id: "owner" });

    let due;
    if (${JSON.stringify(scenario)} === "not-ready") {
      due = await scheduleModule.runDueCloudKitAutoSync(now, { getReadiness: () => notReadyReadiness, runCycle: fakeRunCycle });
    } else {
      due = await scheduleModule.runDueCloudKitAutoSync(now, { getReadiness: () => readyReadiness, runCycle: fakeRunCycle });
    }
    const after = scheduleModule.getCloudKitAutoSyncSchedule();
    const audits = auditModule.listAuditLogs(20).map((log) => ({ action: log.action, metadata: log.metadata }));
    process.stdout.write(JSON.stringify({ defaultSchedule, tooEarly, saved, due, after, calls, audits }));
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

test("CloudKit auto sync stays off by default and records safe scheduled cycle summaries", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-auto-sync-"));
  try {
    const result = runIsolatedAutoSync({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "ready");

    assert.equal(result.defaultSchedule.enabled, false);
    assert.equal(result.tooEarly, null);
    assert.equal(result.saved.enabled, true);
    assert.equal(result.saved.intervalMinutes, 15);
    assert.deepEqual(result.calls, ["cycle"]);
    assert.equal(result.due.skipped, false);
    assert.equal(result.due.lastResult.status, "completed");
    assert.equal(result.due.lastResult.pullStatus, "applied");
    assert.equal(result.due.lastResult.pullApplied, 2);
    assert.equal(result.due.lastResult.uploadStatus, "uploaded");
    assert.equal(result.due.lastResult.uploadSaved, 3);
    assert.equal(result.after.lastRunAt, 1700000000000);
    assert.equal(result.after.nextRunAt, 1700000000000 + 15 * 60 * 1000);
    assert.equal(JSON.stringify(result.after).includes("payloadJson"), false);
    assert.ok(result.audits.some((log) => log.action === "icloud_cloudkit_auto_sync_run" && log.metadata.rawPayloadReturnedToAdmin === false));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit auto sync records a single setup action when native data sync is not ready", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-auto-sync-not-ready-"));
  try {
    const result = runIsolatedAutoSync({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "not-ready");

    assert.deepEqual(result.calls, []);
    assert.equal(result.due.skipped, true);
    assert.equal(result.due.reason, "not-ready");
    assert.equal(result.due.lastResult.status, "skipped");
    assert.equal(result.due.lastResult.nextAction, "configure-cloudkit");
    assert.equal(result.due.lastResult.readinessStatus, "not-enabled");
    assert.equal(result.due.lastResult.dataSyncScope, "entry-file-only");
    assert.ok(result.audits.some((log) => log.action === "icloud_cloudkit_auto_sync_skipped"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
