import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolatedCloudKitApply(env, scenario) {
  const script = `
    const crypto = await import("node:crypto");
    const { runMigrations } = await import("./server/migrations.ts");
    const { db } = await import("./server/db.ts");
    runMigrations();
    const { listCloudKitSyncQuarantineItems, applyCloudKitSyncQuarantine } = await import("./server/cloudKitSyncApply.ts");

    function stableHash(value) {
      return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
    }

    const now = 1700000000000;
    db.prepare("INSERT INTO cloudkit_sync_checkpoints (zone, applied_server_change_token, pending_server_change_token, token_state, last_evidence_id, last_preview_at, last_applied_at, changed_count, deleted_count, failed_count, more_coming, updated_at) VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, 0, 0, ?)")
      .run("LifeOSChatZone", "opaque-next-token", "evidence-chat", now, 2, 0, now);

    if (${JSON.stringify(scenario)} === "apply") {
      const conversationPayload = {
        conversationId: "remote-convo",
        title: "Remote synced",
        createdAt: now,
        updatedAt: now + 1000,
      };
      const messagePayload = {
        conversationId: "remote-convo",
        messageId: "remote-message",
        role: "user",
        contentJson: { parts: [{ text: "hello from cloudkit" }] },
        createdAt: now + 2000,
        mutationId: "remote-mut",
        logicalClock: now + 2000,
      };
      const insert = db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'changed', 'pending-review', ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL, NULL)");
      for (const item of [
        ["q-convo", "LifeOSConversation", "conversation:remote-convo", conversationPayload, "mut-convo", now + 1000],
        ["q-message", "LifeOSMessage", "message:remote-message", messagePayload, "remote-mut", now + 2000],
      ]) {
        const payloadJson = JSON.stringify(item[3]);
        insert.run(item[0], "LifeOSChatZone", item[1], item[2], item[4], stableHash(item[3]), stableHash(payloadJson), item[5], Buffer.byteLength(payloadJson), payloadJson, new Date(item[5]).toISOString(), "evidence-chat", now + 3000);
      }
    } else {
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'deleted', 'pending-review', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, NULL)")
        .run("q-delete", "LifeOSChatZone", "LifeOSMessage", "message:remote-message", "remote-mut", "delete-hash", "delete-payload-hash", now + 2000, 0, null, new Date(now + 2000).toISOString(), new Date(now + 2000).toISOString(), "evidence-chat", now + 3000);
    }

    const listed = listCloudKitSyncQuarantineItems({ limit: 10 });
    const apply = applyCloudKitSyncQuarantine({ limit: 10, now: now + 4000 });
    const sessions = db.prepare("SELECT id, title, updated_at as updatedAt FROM chat_sessions ORDER BY id").all();
    const messages = db.prepare("SELECT id, session_id as sessionId, content_json as contentJson, source_device_id as sourceDeviceId, offline_mutation_id as mutationId FROM messages ORDER BY id").all();
    const checkpoint = db.prepare("SELECT token_state as tokenState, applied_server_change_token as appliedToken, pending_server_change_token as pendingToken, last_applied_at as lastAppliedAt FROM cloudkit_sync_checkpoints WHERE zone = 'LifeOSChatZone'").get();
    process.stdout.write(JSON.stringify({ listed, apply, sessions, messages, checkpoint }));
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

test("CloudKit quarantine apply writes conflict-free records and promotes pending checkpoint only after applying", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-apply-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "apply");

    assert.equal(result.listed.items.length, 2);
    assert.equal(JSON.stringify(result.listed).includes("payloadJson"), false);
    assert.equal(JSON.stringify(result.listed).includes("hello from cloudkit"), false);
    assert.equal(result.apply.attempted, 2);
    assert.equal(result.apply.applied, 2);
    assert.equal(result.apply.conflicts, 0);
    assert.deepEqual(result.apply.promotedZones, ["LifeOSChatZone"]);
    assert.deepEqual(result.apply.blockedZones, []);
    assert.equal(result.sessions[0].id, "remote-convo");
    assert.equal(result.messages[0].id, "remote-message");
    assert.equal(result.messages[0].sourceDeviceId, "cloudkit");
    assert.equal(result.messages[0].mutationId, "remote-mut");
    assert.equal(JSON.parse(result.messages[0].contentJson).parts[0].text, "hello from cloudkit");
    assert.equal(result.checkpoint.tokenState, "applied");
    assert.equal(result.checkpoint.appliedToken, "opaque-next-token");
    assert.equal(result.checkpoint.pendingToken, null);
    assert.equal(result.checkpoint.lastAppliedAt, 1700000004000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit quarantine apply keeps hard deletes unresolved and blocks checkpoint promotion", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-delete-conflict-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "delete");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 0);
    assert.equal(result.apply.conflicts, 1);
    assert.deepEqual(result.apply.promotedZones, []);
    assert.deepEqual(result.apply.blockedZones, ["LifeOSChatZone"]);
    assert.equal(result.checkpoint.tokenState, "pending-preview");
    assert.equal(result.checkpoint.appliedToken, null);
    assert.equal(result.checkpoint.pendingToken, "opaque-next-token");
    assert.match(result.apply.records[0].error, /manual review/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
