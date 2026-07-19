import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("CloudKit chat jobs are idempotent, leased, retried, and exported as responses", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-jobs-"));
  try {
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const { runMigrations } = await import("./server/migrations.ts");
      const { db } = await import("./server/db.ts");
      runMigrations();
      const jobs = await import("./server/cloudKitChatJobs.ts");
      const now = 1700000000000;
      const request = {
        schemaVersion: 1,
        requestId: "123e4567-e89b-42d3-a456-426614174000",
        conversationId: "223e4567-e89b-42d3-a456-426614174000",
        userMessageId: "323e4567-e89b-42d3-a456-426614174000",
        sourceDeviceHash: "a".repeat(64),
        prompt: "Create a short plan for tomorrow.",
        locale: "en-US",
        status: "queued",
        clientSequence: 1,
        createdAt: now,
        expiresAt: now + 60 * 60 * 1000,
        syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
      };
      const metadata = { recordName: "chat-request:" + request.requestId, contentHash: "b".repeat(64), importedAt: now + 1, now };
      const first = jobs.enqueueCloudKitChatRequest(request, metadata);
      const duplicate = jobs.enqueueCloudKitChatRequest(request, metadata);
      assert.equal(first.created, true);
      assert.equal(duplicate.created, false);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE id = ?").get(request.userMessageId).count, 1);

      const claimed = jobs.claimNextCloudKitChatJob({ now: now + 2, leaseMs: 30000 });
      assert.equal(claimed.status, "processing");
      assert.equal(claimed.prompt, request.prompt);
      const retry = jobs.failCloudKitChatJob({
        requestId: request.requestId,
        leaseId: claimed.leaseId,
        safeErrorCode: "provider-temporary",
        retryable: true,
        now: now + 3,
      });
      assert.equal(retry.status, "queued");
      const retryingResponses = jobs.listCloudKitChatResponsePayloads();
      assert.equal(retryingResponses.length, 1);
      assert.equal(retryingResponses[0].status, "retrying");
      assert.equal(retryingResponses[0].safeErrorCode, "provider-temporary");
      assert.equal(jobs.claimNextCloudKitChatJob({ now: now + 4000 }), undefined);

      const reclaimed = jobs.claimNextCloudKitChatJob({ now: now + 6000, leaseMs: 30000 });
      assert.equal(reclaimed.attemptCount, 2);
      const completed = jobs.completeCloudKitChatJob({
        requestId: request.requestId,
        leaseId: reclaimed.leaseId,
        text: "1. Review priorities. 2. Reserve focus time.",
        providerLabel: "OpenAI",
        modelLabel: "gpt-4o-mini",
        assistantMessageId: "423e4567-e89b-42d3-a456-426614174000",
        now: now + 7000,
      });
      assert.equal(completed.status, "completed");
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE id = ?").get(completed.assistantMessageId).count, 1);
      const responses = jobs.listCloudKitChatResponsePayloads();
      assert.equal(responses.length, 1);
      assert.equal(responses[0].status, "completed");
      assert.match(responses[0].text, /Review priorities/);

      const configurationRequest = {
        ...request,
        requestId: "523e4567-e89b-42d3-a456-426614174000",
        conversationId: "623e4567-e89b-42d3-a456-426614174000",
        userMessageId: "723e4567-e89b-42d3-a456-426614174000",
        clientSequence: 2,
      };
      jobs.enqueueCloudKitChatRequest(configurationRequest, {
        recordName: "chat-request:" + configurationRequest.requestId,
        contentHash: "c".repeat(64),
        importedAt: now + 8000,
        now: now + 8000,
      });
      const configurationClaim = jobs.claimNextCloudKitChatJob({ now: now + 8001, leaseMs: 30000 });
      const configurationFailure = jobs.failCloudKitChatJob({
        requestId: configurationRequest.requestId,
        leaseId: configurationClaim.leaseId,
        safeErrorCode: "ai-not-configured",
        retryable: false,
        now: now + 8002,
      });
      assert.equal(configurationFailure.status, "failed");
      const configurationRetry = jobs.requeueCloudKitChatJobsAfterAiConfiguration({ now: now + 9000 });
      assert.deepEqual(configurationRetry, { requeued: 1, requestIds: [configurationRequest.requestId] });
      assert.equal(jobs.getCloudKitChatJob(configurationRequest.requestId).status, "queued");
      assert.equal(jobs.getCloudKitChatJob(configurationRequest.requestId).safeErrorCode, "configuration-updated");

      assert.throws(() => jobs.enqueueCloudKitChatRequest({ ...request, prompt: "different" }, metadata), /conflicts/i);
      console.log(JSON.stringify({ status: completed.status, attempts: completed.attemptCount, responses: responses.length, retryStatus: retryingResponses[0].status, configurationRequeued: configurationRetry.requeued }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { status: "completed", attempts: 2, responses: 1, retryStatus: "retrying", configurationRequeued: 1 });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("CloudKit chat jobs expire without calling AI", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-expiry-"));
  try {
    const script = `
      const { runMigrations } = await import("./server/migrations.ts");
      runMigrations();
      const jobs = await import("./server/cloudKitChatJobs.ts");
      const now = 1700000000000;
      const request = {
        schemaVersion: 1,
        requestId: "623e4567-e89b-42d3-a456-426614174000",
        conversationId: "723e4567-e89b-42d3-a456-426614174000",
        userMessageId: "823e4567-e89b-42d3-a456-426614174000",
        sourceDeviceHash: "c".repeat(64),
        prompt: "This request should expire.", locale: "en-US", status: "queued", clientSequence: 2,
        createdAt: now - 60000, expiresAt: now - 1,
        syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now - 60000 },
      };
      const created = jobs.enqueueCloudKitChatRequest(request, {
        recordName: "chat-request:" + request.requestId,
        contentHash: "d".repeat(64),
        now,
      });
      const response = jobs.listCloudKitChatResponsePayloads()[0];
      console.log(JSON.stringify({ status: created.job.status, claimable: Boolean(jobs.claimNextCloudKitChatJob({ now })), error: response.safeErrorCode }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { status: "expired", claimable: false, error: "request-expired" });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("CloudKit quarantine imports a phone chat request and exports the completed Mac response", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-roundtrip-"));
  try {
    const script = `
      const crypto = await import("node:crypto");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { runMigrations } = await import("./server/migrations.ts");
      const { db } = await import("./server/db.ts");
      const deviceProtocol = await import("./server/cloudKitDeviceKeyProtocol.ts");
      const chatProtocol = await import("./server/cloudKitChatProtocol.ts");
      runMigrations();
      const now = 1700000000000;
      const requestId = "923e4567-e89b-42d3-a456-426614174000";
      const deviceId = "d23e4567-e89b-42d3-a456-426614174000";
      const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const publicKey = keyPair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
      const devicePayload = {
        schemaVersion: 1,
        deviceId,
        deviceIdHash: deviceProtocol.cloudKitDeviceIdHash(deviceId),
        displayName: "Roundtrip iPhone",
        deviceType: "ios",
        channelScope: "cloudkit-chat",
        publicKey,
        publicKeyFingerprint: deviceProtocol.cloudKitDeviceKeyFingerprint(publicKey),
        proofSignature: "",
        status: "active",
        createdAt: now,
        expiresAt: now + 30 * 24 * 60 * 60 * 1000,
        syncMutation: { kind: "device-key-register", origin: "ios-native", mutatedAt: now },
      };
      devicePayload.proofSignature = crypto.sign(
        "sha256",
        Buffer.from(deviceProtocol.cloudKitDeviceKeyProofText(devicePayload)),
        { key: keyPair.privateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64url");
      const payload = {
        schemaVersion: 1,
        requestId,
        conversationId: "a23e4567-e89b-42d3-a456-426614174000",
        userMessageId: "b23e4567-e89b-42d3-a456-426614174000",
        deviceId,
        sourceDeviceHash: devicePayload.deviceIdHash,
        publicKeyFingerprint: devicePayload.publicKeyFingerprint,
        signature: "",
        prompt: "Summarize today's priorities.",
        locale: "en-US",
        status: "queued",
        clientSequence: 3,
        createdAt: now,
        expiresAt: now + 3600000,
        syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
      };
      payload.signature = crypto.sign(
        "sha256",
        Buffer.from(chatProtocol.cloudKitChatRequestSignatureText(payload)),
        { key: keyPair.privateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64url");
      const devicePayloadJson = JSON.stringify(devicePayload);
      const deviceContentHash = crypto.createHash("sha256").update(JSON.stringify(devicePayload)).digest("hex");
      const devicePayloadHash = crypto.createHash("sha256").update(JSON.stringify(devicePayloadJson)).digest("hex");
      const payloadJson = JSON.stringify(payload);
      const contentHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payloadJson)).digest("hex");
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, source_evidence_id, imported_at) VALUES (?, 'LifeOSDeviceTrustZone', 'LifeOSDeviceKey', ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, 'device-key-evidence', ?)")
        .run("device-key-row", deviceProtocol.cloudKitDeviceKeyRecordName(devicePayload.deviceIdHash), "ios-device-key:" + deviceId, deviceContentHash, devicePayloadHash, now, Buffer.byteLength(devicePayloadJson), devicePayloadJson, new Date(now).toISOString(), now + 1);
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, source_evidence_id, imported_at) VALUES (?, 'LifeOSChatZone', 'LifeOSChatRequest', ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, 'chat-request-evidence', ?)")
        .run("chat-request-row", "chat-request:" + requestId, "ios-chat-request:" + requestId, contentHash, payloadHash, now, Buffer.byteLength(payloadJson), payloadJson, new Date(now).toISOString(), now + 2);
      const { applyCloudKitSyncQuarantine } = await import("./server/cloudKitSyncApply.ts");
      const applied = applyCloudKitSyncQuarantine({ now: now + 3 });
      const jobs = await import("./server/cloudKitChatJobs.ts");
      const worker = await import("./server/cloudKitChatWorker.ts");
      const beforeWorker = jobs.listCloudKitChatResponsePayloads();
      const workerResult = await worker.runCloudKitChatWorkerQueue({
        now: now + 4,
        limit: 1,
        generate: async () => ({
          providerId: "gemini",
          providerName: "Google Gemini",
          model: "gemini-2.5-flash",
          text: "Focus on the release gate and the iCloud roundtrip.",
        }),
      });

      const helper = path.join(process.env.LIFEOS_DATA_DIR, "helper");
      const entitlements = path.join(process.env.LIFEOS_DATA_DIR, "entitlements.plist");
      fs.writeFileSync(helper, "#!/bin/sh\\nexit 0\\n");
      fs.chmodSync(helper, 0o755);
      fs.writeFileSync(entitlements, "<plist><dict><key>com.apple.developer.icloud-container-identifiers</key><array><string>iCloud.ai.lifeos.desktop</string></array></dict></plist>");
      Object.assign(process.env, {
        LIFEOS_ICLOUD_DATA_SYNC: "1",
        LIFEOS_CLOUDKIT_SYNC_TYPES: "chat-history",
        LIFEOS_CLOUDKIT_CONTAINER_ID: "iCloud.ai.lifeos.desktop",
        LIFEOS_CLOUDKIT_TEAM_ID: "TEAM123456",
        LIFEOS_CLOUDKIT_BUNDLE_ID: "ai.lifeos.desktop",
        LIFEOS_CLOUDKIT_HELPER_BIN: helper,
        LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH: entitlements,
      });
      const { getIcloudDataSyncReadiness } = await import("./server/icloudDataSyncReadiness.ts");
      const { buildCloudKitSyncBatchPreview } = await import("./server/cloudKitSyncBatch.ts");
      const preview = buildCloudKitSyncBatchPreview(getIcloudDataSyncReadiness({ platformSupported: true }), { limit: 20 });
      const response = preview.records.find((record) => record.recordType === "LifeOSChatResponse");
      const responsePayload = jobs.listCloudKitChatResponsePayloads()[0];
      console.log(JSON.stringify({
        applied: applied.applied,
        responsesBeforeWorker: beforeWorker.length,
        workerCompleted: workerResult.completed,
        job: jobs.getCloudKitChatJob(requestId).status,
        response: response?.recordName,
        responseStatus: responsePayload?.status,
      }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      applied: 2,
      responsesBeforeWorker: 0,
      workerCompleted: 1,
      job: "completed",
      response: "chat-response:923e4567-e89b-42d3-a456-426614174000",
      responseStatus: "completed",
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
