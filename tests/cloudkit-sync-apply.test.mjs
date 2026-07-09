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
      const insert = db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, NULL, NULL)");
      for (const item of [
        ["q-convo", "LifeOSConversation", "conversation:remote-convo", conversationPayload, "mut-convo", now + 1000],
        ["q-message", "LifeOSMessage", "message:remote-message", messagePayload, "remote-mut", now + 2000],
      ]) {
        const payloadJson = JSON.stringify(item[3]);
        insert.run(item[0], "LifeOSChatZone", item[1], item[2], item[4], stableHash(item[3]), stableHash(payloadJson), item[5], Buffer.byteLength(payloadJson), payloadJson, new Date(item[5]).toISOString(), "evidence-chat", now + 3000);
      }
    } else if (${JSON.stringify(scenario)} === "message-title") {
      const messagePayload = {
        conversationId: "remote-title-convo",
        conversationTitle: "Remote planning room",
        messageId: "remote-title-message",
        role: "assistant",
        contentJson: { parts: [{ text: "hello with title snapshot" }] },
        createdAt: now + 2000,
        mutationId: "remote-title-mut",
        logicalClock: now + 2000,
      };
      const payloadJson = JSON.stringify(messagePayload);
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, NULL, NULL)")
        .run("q-message-title", "LifeOSChatZone", "LifeOSMessage", "message:remote-title-message", "remote-title-mut", stableHash(messagePayload), stableHash(payloadJson), now + 2000, Buffer.byteLength(payloadJson), payloadJson, new Date(now + 2000).toISOString(), "evidence-chat", now + 3000);
    } else if (${JSON.stringify(scenario)} === "memory-new" || ${JSON.stringify(scenario)} === "memory-existing") {
      db.prepare("INSERT INTO cloudkit_sync_checkpoints (zone, applied_server_change_token, pending_server_change_token, token_state, last_evidence_id, last_preview_at, last_applied_at, changed_count, deleted_count, failed_count, more_coming, updated_at) VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, 0, 0, ?)")
        .run("LifeOSMemoryZone", "opaque-memory-token", "evidence-memory", now, 1, 0, now);
      if (${JSON.stringify(scenario)} === "memory-existing") {
        db.prepare("INSERT INTO memories (id, title, content, sensitivity, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'normal', ?, ?, NULL)")
          .run("remote-memory", "Local memory", "Local memory should stay", now - 5000, now + 1500);
      }
      const memoryPayload = {
        memoryId: "remote-memory",
        title: "Remote memory",
        text: "Remember safe thing",
        sensitivity: "normal",
        createdAt: now + 1000,
        updatedAt: now + 2000,
      };
      const payloadJson = JSON.stringify(memoryPayload);
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, NULL, NULL)")
        .run("q-memory-new", "LifeOSMemoryZone", "LifeOSMemory", "memory:remote-memory", "memory-mut", stableHash(memoryPayload), stableHash(payloadJson), now + 2000, Buffer.byteLength(payloadJson), payloadJson, new Date(now + 2000).toISOString(), "evidence-memory", now + 3000);
    } else if (${JSON.stringify(scenario)} === "task-new" || ${JSON.stringify(scenario)} === "task-existing") {
      db.prepare("INSERT INTO cloudkit_sync_checkpoints (zone, applied_server_change_token, pending_server_change_token, token_state, last_evidence_id, last_preview_at, last_applied_at, changed_count, deleted_count, failed_count, more_coming, updated_at) VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, 0, 0, ?)")
        .run("LifeOSTaskZone", "opaque-task-token", "evidence-task", now, 1, 0, now);
      if (${JSON.stringify(scenario)} === "task-existing") {
        db.prepare("INSERT INTO tasks (id, type, status, input_json, result_json, error, created_by_device_id, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, NULL, 'local-device', ?, ?, NULL)")
          .run("remote-task", "planning", "local-ready", JSON.stringify({ title: "Local task should stay" }), JSON.stringify({ local: true }), now - 5000, now + 1500);
      }
      const taskPayload = {
        taskId: "remote-task",
        type: "planning",
        state: "ready",
        input: { title: "Review CloudKit task" },
        result: { ok: true },
        createdAt: now + 1000,
        startedAt: now + 2000,
      };
      const payloadJson = JSON.stringify(taskPayload);
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, NULL, NULL)")
        .run("q-task-new", "LifeOSTaskZone", "LifeOSTask", "task:remote-task", "task-mut", stableHash(taskPayload), stableHash(payloadJson), now + 2000, Buffer.byteLength(payloadJson), payloadJson, new Date(now + 2000).toISOString(), "evidence-task", now + 3000);
    } else if (${JSON.stringify(scenario)} === "generated-app-state" || ${JSON.stringify(scenario)} === "generated-app-state-missing-app" || ${JSON.stringify(scenario)} === "generated-app-state-local-newer") {
      db.prepare("INSERT INTO cloudkit_sync_checkpoints (zone, applied_server_change_token, pending_server_change_token, token_state, last_evidence_id, last_preview_at, last_applied_at, changed_count, deleted_count, failed_count, more_coming, updated_at) VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, 0, 0, ?)")
        .run("LifeOSGeneratedAppZone", "opaque-generated-app-token", "evidence-generated-app", now, 1, 0, now);
      if (${JSON.stringify(scenario)} !== "generated-app-state-missing-app") {
        db.prepare("INSERT INTO custom_apps (id, name, description, visibility, status, source, problem_blueprint_id, code, created_by_type, created_by_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'private', 'active', 'studio', NULL, ?, 'admin', 'admin', ?, ?, NULL)")
          .run("budget-helper", "Budget Helper", "Tracks a monthly budget", "<div>Budget Helper</div>", now - 5000, now - 5000);
      }
      if (${JSON.stringify(scenario)} === "generated-app-state-local-newer") {
        db.prepare("INSERT INTO custom_app_state (app_id, state_json, updated_by_type, updated_by_id, updated_at) VALUES (?, ?, 'local', 'admin', ?)")
          .run("budget-helper", JSON.stringify({ entries: [{ label: "local", amount: 99 }] }), now + 5000);
      }
      const generatedPayload = {
        appId: "budget-helper",
        appName: "Budget Helper",
        stateJson: { entries: [{ label: "rent", amount: 1200 }], currency: "USD" },
        schemaVersion: 1,
        updatedAt: now + 2000,
      };
      const payloadJson = JSON.stringify(generatedPayload);
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, NULL, NULL)")
        .run("q-generated-app-state", "LifeOSGeneratedAppZone", "LifeOSGeneratedAppState", "generated-app-state:budget-helper", "generated-app-mut", stableHash(generatedPayload), stableHash(payloadJson), now + 2000, Buffer.byteLength(payloadJson), payloadJson, new Date(now + 2000).toISOString(), "evidence-generated-app", now + 3000);
    } else if (${JSON.stringify(scenario)} === "device-trust" || ${JSON.stringify(scenario)} === "device-trust-raw-public-key") {
      db.prepare("INSERT INTO cloudkit_sync_checkpoints (zone, applied_server_change_token, pending_server_change_token, token_state, last_evidence_id, last_preview_at, last_applied_at, changed_count, deleted_count, failed_count, more_coming, updated_at) VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, 0, 0, ?)")
        .run("LifeOSDeviceTrustZone", "opaque-device-trust-token", "evidence-device-trust", now, 1, 0, now);
      const deviceIdHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const trustPayload = {
        deviceIdHash,
        displayName: "Alice iPhone",
        deviceType: "mobile",
        trustState: "online",
        publicKeyFingerprint: "abcdef0123456789abcdef0123456789",
        accessExpiresAt: now + 86400000,
        createdAt: now - 5000,
        lastSeenAt: now + 2000,
        mutationId: "device-trust-mut",
        logicalClock: now + 2000,
        ...(${JSON.stringify(scenario)} === "device-trust-raw-public-key" ? { publicKey: "RAW_PUBLIC_KEY_SHOULD_NOT_APPLY" } : {}),
      };
      const payloadJson = JSON.stringify(trustPayload);
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'changed', 'pending-review', ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL, NULL)")
        .run("q-device-trust", "LifeOSDeviceTrustZone", "LifeOSDeviceTrust", "device:" + deviceIdHash.slice(0, 24), "device-trust-mut", stableHash(trustPayload), stableHash(payloadJson), now + 2000, Buffer.byteLength(payloadJson), payloadJson, new Date(now + 2000).toISOString(), "evidence-device-trust", now + 3000);
    } else {
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, deleted_at, source_evidence_id, imported_at, applied_at, error) VALUES (?, ?, ?, ?, 'deleted', 'pending-review', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, NULL)")
        .run("q-delete", "LifeOSChatZone", "LifeOSMessage", "message:remote-message", "remote-mut", "delete-hash", "delete-payload-hash", now + 2000, 0, null, new Date(now + 2000).toISOString(), new Date(now + 2000).toISOString(), "evidence-chat", now + 3000);
    }

    const listed = listCloudKitSyncQuarantineItems({ limit: 10 });
    const apply = applyCloudKitSyncQuarantine({
      limit: 10,
      now: now + 4000,
      includeManualReview: ${JSON.stringify(scenario)} === "delete" || ${JSON.stringify(scenario)}.startsWith("device-trust"),
    });
    const sessions = db.prepare("SELECT id, title, updated_at as updatedAt FROM chat_sessions ORDER BY id").all();
    const messages = db.prepare("SELECT id, session_id as sessionId, content_json as contentJson, source_device_id as sourceDeviceId, offline_mutation_id as mutationId FROM messages ORDER BY id").all();
    const memories = db.prepare("SELECT id, title, content, sensitivity, updated_at as updatedAt FROM memories ORDER BY id").all();
    const tasks = db.prepare("SELECT id, type, status, input_json as inputJson, result_json as resultJson, created_by_device_id as createdByDeviceId, started_at as startedAt FROM tasks ORDER BY id").all();
    const devices = db.prepare("SELECT id, name, access_token_hash as accessTokenHash FROM devices ORDER BY id").all();
    const trustMetadata = db.prepare("SELECT device_id_hash as deviceIdHash, display_name as displayName, device_type as deviceType, trust_state as trustState, public_key_fingerprint as publicKeyFingerprint, access_expires_at as accessExpiresAt, review_status as reviewStatus, access_granted as accessGranted, source_record_name as sourceRecordName, source_evidence_id as sourceEvidenceId, logical_clock as logicalClock, applied_at as appliedAt FROM cloudkit_device_trust_metadata ORDER BY device_id_hash").all();
    const customAppStates = db.prepare("SELECT app_id as appId, state_json as stateJson, updated_by_type as updatedByType, updated_at as updatedAt FROM custom_app_state ORDER BY app_id").all();
    const checkpoint = db.prepare("SELECT token_state as tokenState, applied_server_change_token as appliedToken, pending_server_change_token as pendingToken, last_applied_at as lastAppliedAt FROM cloudkit_sync_checkpoints WHERE zone = 'LifeOSChatZone'").get();
    const memoryCheckpoint = db.prepare("SELECT token_state as tokenState, applied_server_change_token as appliedToken, pending_server_change_token as pendingToken, last_applied_at as lastAppliedAt FROM cloudkit_sync_checkpoints WHERE zone = 'LifeOSMemoryZone'").get();
    const taskCheckpoint = db.prepare("SELECT token_state as tokenState, applied_server_change_token as appliedToken, pending_server_change_token as pendingToken, last_applied_at as lastAppliedAt FROM cloudkit_sync_checkpoints WHERE zone = 'LifeOSTaskZone'").get();
    const deviceTrustCheckpoint = db.prepare("SELECT token_state as tokenState, applied_server_change_token as appliedToken, pending_server_change_token as pendingToken, last_applied_at as lastAppliedAt FROM cloudkit_sync_checkpoints WHERE zone = 'LifeOSDeviceTrustZone'").get();
    const generatedAppCheckpoint = db.prepare("SELECT token_state as tokenState, applied_server_change_token as appliedToken, pending_server_change_token as pendingToken, last_applied_at as lastAppliedAt FROM cloudkit_sync_checkpoints WHERE zone = 'LifeOSGeneratedAppZone'").get();
    process.stdout.write(JSON.stringify({ listed, apply, sessions, messages, memories, tasks, devices, trustMetadata, customAppStates, checkpoint, memoryCheckpoint, taskCheckpoint, deviceTrustCheckpoint, generatedAppCheckpoint }));
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
    assert.equal(result.apply.manualReviewRequired, 0);
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

test("CloudKit auto message apply creates a readable conversation from the safe title snapshot", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-message-title-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "message-title");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 1);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.equal(result.sessions[0].id, "remote-title-convo");
    assert.equal(result.sessions[0].title, "Remote planning room");
    assert.equal(result.messages[0].id, "remote-title-message");
    assert.equal(JSON.parse(result.messages[0].contentJson).parts[0].text, "hello with title snapshot");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit auto memory apply writes a new normal memory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-memory-new-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "memory-new");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 1);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.equal(result.apply.conflicts, 0);
    assert.deepEqual(result.apply.promotedZones, ["LifeOSMemoryZone"]);
    assert.equal(result.memories[0].id, "remote-memory");
    assert.equal(result.memories[0].title, "Remote memory");
    assert.equal(result.memories[0].content, "Remember safe thing");
    assert.equal(result.memories[0].sensitivity, "normal");
    assert.equal(result.memoryCheckpoint.tokenState, "applied");
    assert.equal(result.memoryCheckpoint.appliedToken, "opaque-memory-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit auto memory apply refuses to overwrite an existing memory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-memory-existing-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "memory-existing");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 0);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.equal(result.apply.conflicts, 1);
    assert.deepEqual(result.apply.promotedZones, []);
    assert.deepEqual(result.apply.blockedZones, ["LifeOSMemoryZone"]);
    assert.match(result.apply.records[0].error, /Existing memory requires manual review/);
    assert.equal(result.memories[0].id, "remote-memory");
    assert.equal(result.memories[0].title, "Local memory");
    assert.equal(result.memories[0].content, "Local memory should stay");
    assert.equal(result.memoryCheckpoint.tokenState, "pending-preview");
    assert.equal(result.memoryCheckpoint.appliedToken, null);
    assert.equal(result.memoryCheckpoint.pendingToken, "opaque-memory-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit auto task apply writes a new task without touching existing local tasks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-task-new-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "task-new");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 1);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.equal(result.apply.conflicts, 0);
    assert.deepEqual(result.apply.promotedZones, ["LifeOSTaskZone"]);
    assert.equal(result.tasks[0].id, "remote-task");
    assert.equal(result.tasks[0].type, "planning");
    assert.equal(result.tasks[0].status, "ready");
    assert.deepEqual(JSON.parse(result.tasks[0].inputJson), { title: "Review CloudKit task" });
    assert.deepEqual(JSON.parse(result.tasks[0].resultJson), { ok: true });
    assert.equal(result.tasks[0].createdByDeviceId, "cloudkit");
    assert.equal(result.taskCheckpoint.tokenState, "applied");
    assert.equal(result.taskCheckpoint.appliedToken, "opaque-task-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit auto task apply refuses to overwrite an existing task", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-task-existing-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "task-existing");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 0);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.equal(result.apply.conflicts, 1);
    assert.deepEqual(result.apply.promotedZones, []);
    assert.deepEqual(result.apply.blockedZones, ["LifeOSTaskZone"]);
    assert.match(result.apply.records[0].error, /Existing task requires manual review/);
    assert.equal(result.tasks[0].id, "remote-task");
    assert.equal(result.tasks[0].status, "local-ready");
    assert.deepEqual(JSON.parse(result.tasks[0].inputJson), { title: "Local task should stay" });
    assert.deepEqual(JSON.parse(result.tasks[0].resultJson), { local: true });
    assert.equal(result.tasks[0].createdByDeviceId, "local-device");
    assert.equal(result.taskCheckpoint.tokenState, "pending-preview");
    assert.equal(result.taskCheckpoint.appliedToken, null);
    assert.equal(result.taskCheckpoint.pendingToken, "opaque-task-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit auto generated app state apply updates an existing generated app only", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-generated-app-state-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "generated-app-state");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 1);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.equal(result.apply.conflicts, 0);
    assert.deepEqual(result.apply.promotedZones, ["LifeOSGeneratedAppZone"]);
    assert.equal(result.customAppStates[0].appId, "budget-helper");
    assert.deepEqual(JSON.parse(result.customAppStates[0].stateJson), { entries: [{ label: "rent", amount: 1200 }], currency: "USD" });
    assert.equal(result.customAppStates[0].updatedByType, "cloudkit");
    assert.equal(result.customAppStates[0].updatedAt, 1700000002000);
    assert.equal(result.generatedAppCheckpoint.tokenState, "applied");
    assert.equal(result.generatedAppCheckpoint.appliedToken, "opaque-generated-app-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit generated app state apply refuses to create unknown generated apps", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-generated-app-missing-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "generated-app-state-missing-app");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 0);
    assert.equal(result.apply.conflicts, 1);
    assert.deepEqual(result.apply.promotedZones, []);
    assert.deepEqual(result.apply.blockedZones, ["LifeOSGeneratedAppZone"]);
    assert.match(result.apply.records[0].error, /Generated app must exist locally/);
    assert.equal(result.customAppStates.length, 0);
    assert.equal(result.generatedAppCheckpoint.tokenState, "pending-preview");
    assert.equal(result.generatedAppCheckpoint.appliedToken, null);
    assert.equal(result.generatedAppCheckpoint.pendingToken, "opaque-generated-app-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit generated app state apply refuses to overwrite newer local generated app state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-generated-app-local-newer-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "generated-app-state-local-newer");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 0);
    assert.equal(result.apply.conflicts, 1);
    assert.deepEqual(result.apply.promotedZones, []);
    assert.deepEqual(result.apply.blockedZones, ["LifeOSGeneratedAppZone"]);
    assert.match(result.apply.records[0].error, /Local generated app state is newer/);
    assert.equal(result.customAppStates[0].appId, "budget-helper");
    assert.deepEqual(JSON.parse(result.customAppStates[0].stateJson), { entries: [{ label: "local", amount: 99 }] });
    assert.equal(result.customAppStates[0].updatedByType, "local");
    assert.equal(result.generatedAppCheckpoint.tokenState, "pending-preview");
    assert.equal(result.generatedAppCheckpoint.appliedToken, null);
    assert.equal(result.generatedAppCheckpoint.pendingToken, "opaque-generated-app-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit device trust apply stores metadata without granting device access", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-device-trust-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "device-trust");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 1);
    assert.equal(result.apply.manualReviewRequired, 0);
    assert.deepEqual(result.apply.promotedZones, ["LifeOSDeviceTrustZone"]);
    assert.equal(result.devices.length, 0);
    assert.equal(result.trustMetadata.length, 1);
    assert.equal(result.trustMetadata[0].displayName, "Alice iPhone");
    assert.equal(result.trustMetadata[0].deviceType, "mobile");
    assert.equal(result.trustMetadata[0].trustState, "online");
    assert.equal(result.trustMetadata[0].publicKeyFingerprint, "abcdef0123456789abcdef0123456789");
    assert.equal(result.trustMetadata[0].reviewStatus, "needs-rebind");
    assert.equal(result.trustMetadata[0].accessGranted, 0);
    assert.equal(result.trustMetadata[0].sourceRecordName, "device:0123456789abcdef01234567");
    assert.equal(result.trustMetadata[0].sourceEvidenceId, "evidence-device-trust");
    assert.equal(result.trustMetadata[0].appliedAt, 1700000004000);
    assert.equal(result.deviceTrustCheckpoint.tokenState, "applied");
    assert.equal(result.deviceTrustCheckpoint.appliedToken, "opaque-device-trust-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit device trust apply rejects raw public key payloads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-sync-device-trust-raw-key-"));
  try {
    const result = runIsolatedCloudKitApply({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    }, "device-trust-raw-public-key");

    assert.equal(result.apply.attempted, 1);
    assert.equal(result.apply.applied, 0);
    assert.equal(result.apply.conflicts, 1);
    assert.deepEqual(result.apply.promotedZones, []);
    assert.deepEqual(result.apply.blockedZones, ["LifeOSDeviceTrustZone"]);
    assert.match(result.apply.records[0].error, /raw public keys/i);
    assert.equal(result.devices.length, 0);
    assert.equal(result.trustMetadata.length, 0);
    assert.equal(result.deviceTrustCheckpoint.tokenState, "pending-preview");
    assert.equal(result.deviceTrustCheckpoint.appliedToken, null);
    assert.equal(result.deviceTrustCheckpoint.pendingToken, "opaque-device-trust-token");
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
    assert.equal(result.apply.manualReviewRequired, 0);
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
