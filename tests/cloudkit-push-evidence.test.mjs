import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolated(env) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    runMigrations();
    const evidenceModule = await import("./server/cloudKitPushEvidence.ts");
    const auditModule = await import("./server/audit.ts");
    const before = evidenceModule.getCloudKitPushEvidence();
    const ready = evidenceModule.recordCloudKitPushEvent({ event: "listener-ready", reason: "ready", subscriptionMatched: true }, { type: "system", id: "desktop-test" }, 1700000000000);
    const ignored = evidenceModule.recordCloudKitPushEvent({ event: "notification-ignored", reason: "subscription-mismatch", subscriptionMatched: false }, { type: "system", id: "desktop-test" }, 1700000001000);
    const remote = evidenceModule.recordCloudKitPushEvent({ event: "remote-change", reason: "database-change", subscriptionMatched: true }, { type: "system", id: "desktop-test" }, 1700000002000);
    const after = evidenceModule.getCloudKitPushEvidence();
    let invalidError = "";
    try {
      evidenceModule.recordCloudKitPushEvent({ event: "remote-change", reason: "raw-payload", subscriptionMatched: true });
    } catch (error) {
      invalidError = error.message;
    }
    let mismatchedError = "";
    try {
      evidenceModule.recordCloudKitPushEvent({ event: "remote-change", reason: "ready", subscriptionMatched: true });
    } catch (error) {
      mismatchedError = error.message;
    }
    const audits = auditModule.listAuditLogs(10).map((log) => ({ action: log.action, metadata: log.metadata }));
    process.stdout.write(JSON.stringify({ before, ready, ignored, remote, after, invalidError, mismatchedError, audits }));
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

test("CloudKit push evidence persists only delivery counts and safe status", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-push-evidence-"));
  try {
    const result = runIsolated({ ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") });
    assert.equal(result.before.receivedRemoteChanges, 0);
    assert.equal(result.ready.listenerReadyAt, 1700000000000);
    assert.equal(result.ready.deliveryVerified, false);
    assert.equal(result.ignored.receivedRemoteChanges, 0);
    assert.equal(result.remote.receivedRemoteChanges, 1);
    assert.equal(result.remote.deliveryVerified, true);
    assert.equal(result.after.lastRemoteChangeAt, 1700000002000);
    assert.equal(result.after.rawPayloadStored, false);
    assert.equal(result.after.deviceTokenStored, false);
    assert.equal(result.after.cloudKitChangeTokenStored, false);
    assert.match(result.invalidError, /did not match/);
    assert.match(result.mismatchedError, /did not match/);
    assert.equal(result.audits.filter((item) => item.action === "icloud_cloudkit_push_event").length, 3);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("payloadJson"), false);
    assert.equal(serialized.includes("serverChangeToken"), false);
    assert.equal(serialized.includes("device-token-value"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
