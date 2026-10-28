import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("CloudKit relay exposes a pinned phone request only to its trusted Mac", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-trusted-mac-"));
  try {
    const script = `
      const { runMigrations } = await import("./server/migrations.ts");
      const jobs = await import("./server/cloudKitChatJobs.ts");
      runMigrations();
      const now = 1700000000000;
      const trustedMacFingerprint = "f".repeat(64);
      const request = {
        schemaVersion: 1,
        requestId: "023e4567-e89b-42d3-a456-426614174000",
        conversationId: "123e4567-e89b-42d3-a456-426614174001",
        userMessageId: "223e4567-e89b-42d3-a456-426614174002",
        sourceDeviceHash: "a".repeat(64),
        trustedMacFingerprint,
        prompt: "Use only my trusted Mac.",
        locale: "en-US",
        status: "queued",
        clientSequence: 1,
        createdAt: now,
        expiresAt: now + 60_000,
        syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
      };
      jobs.enqueueCloudKitChatRequest(request, {
        recordName: "chat-request:" + request.requestId,
        contentHash: "b".repeat(64),
        now,
      });
      const wrongMac = jobs.getNextCloudKitChatJobForRelayClaim({
        now,
        trustedMacFingerprint: "e".repeat(64),
      });
      const trustedMac = jobs.getNextCloudKitChatJobForRelayClaim({
        now,
        trustedMacFingerprint,
      });
      console.log(JSON.stringify({
        wrongMac: wrongMac?.requestId || null,
        trustedMac: trustedMac?.requestId || null,
        persistedFingerprint: jobs.getCloudKitChatJob(request.requestId)?.trustedMacFingerprint,
      }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      wrongMac: null,
      trustedMac: "023e4567-e89b-42d3-a456-426614174000",
      persistedFingerprint: "f".repeat(64),
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("CloudKit chat jobs are idempotent, leased, retried, and exported as responses", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-jobs-"));
  try {
    const script = `
      const assert = (await import("node:assert/strict")).default;
      const crypto = await import("node:crypto");
      const { runMigrations } = await import("./server/migrations.ts");
      const { db } = await import("./server/db.ts");
      runMigrations();
      const jobs = await import("./server/cloudKitChatJobs.ts");
      const protocol = await import("./server/cloudKitChatProtocol.ts");
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
      assert.match(responses[0].macPublicKeyFingerprint, /^[0-9a-f]{64}$/);
      assert.match(responses[0].macSignature, /^[A-Za-z0-9_-]{86}$/);
      assert.equal(Object.hasOwn(responses[0], "privateKey"), false);
      const delivery = jobs.markCloudKitChatResponsesExported([
        { requestId: request.requestId, updatedAt: responses[0].updatedAt, contentHash: "e".repeat(64) },
      ], now + 7001);
      assert.equal(delivery.marked, 1);
      assert.deepEqual(jobs.listCloudKitChatResponsePayloads(), []);
      assert.equal(jobs.markCloudKitChatResponsesExported([
        { requestId: request.requestId, updatedAt: responses[0].updatedAt, contentHash: "e".repeat(64) },
      ], now + 7002).marked, 0);

      const reusedSequenceRequest = {
        ...request,
        requestId: "823e4567-e89b-42d3-a456-426614174000",
        conversationId: "923e4567-e89b-42d3-a456-426614174000",
        userMessageId: "a23e4567-e89b-42d3-a456-426614174000",
      };
      assert.throws(() => jobs.enqueueCloudKitChatRequest(reusedSequenceRequest, {
        recordName: "chat-request:" + reusedSequenceRequest.requestId,
        contentHash: "d".repeat(64),
        importedAt: now + 7500,
        now: now + 7500,
      }), /sequence was already used/i);

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

      const exportedFailureRequest = {
        ...request,
        requestId: "d23e4567-e89b-42d3-a456-426614174000",
        conversationId: "e23e4567-e89b-42d3-a456-426614174000",
        userMessageId: "f23e4567-e89b-42d3-a456-426614174000",
        clientSequence: 3,
      };
      jobs.enqueueCloudKitChatRequest(exportedFailureRequest, {
        recordName: "chat-request:" + exportedFailureRequest.requestId,
        contentHash: "f".repeat(64),
        importedAt: now + 10000,
        now: now + 10000,
      });
      const exportedFailureClaim = jobs.claimNextCloudKitChatJob({
        requestId: exportedFailureRequest.requestId,
        now: now + 10001,
      });
      jobs.failCloudKitChatJob({
        requestId: exportedFailureRequest.requestId,
        leaseId: exportedFailureClaim.leaseId,
        safeErrorCode: "ai-not-configured",
        retryable: false,
        now: now + 10002,
      });
      db.prepare("UPDATE cloudkit_chat_jobs SET response_exported_at = ? WHERE request_id = ?")
        .run(now + 10003, exportedFailureRequest.requestId);
      const exportedRetry = jobs.requeueCloudKitChatJobsAfterAiConfiguration({ now: now + 11000 });
      assert.equal(exportedRetry.requestIds.includes(exportedFailureRequest.requestId), false);
      assert.equal(jobs.getCloudKitChatJob(exportedFailureRequest.requestId).status, "failed");

      const consumedFailureRequest = {
        ...request,
        requestId: "213e4567-e89b-42d3-a456-426614174002",
        conversationId: "313e4567-e89b-42d3-a456-426614174002",
        userMessageId: "413e4567-e89b-42d3-a456-426614174002",
        clientSequence: 4,
      };
      jobs.enqueueCloudKitChatRequest(consumedFailureRequest, {
        recordName: "chat-request:" + consumedFailureRequest.requestId,
        contentHash: "2".repeat(64),
        importedAt: now + 12000,
        now: now + 12000,
      });
      const consumedClaim = jobs.claimNextCloudKitChatJob({
        requestId: consumedFailureRequest.requestId,
        now: now + 12001,
      });
      jobs.failCloudKitChatJob({
        requestId: consumedFailureRequest.requestId,
        leaseId: consumedClaim.leaseId,
        safeErrorCode: "ai-not-configured",
        retryable: false,
        now: now + 12002,
      });
      db.prepare("UPDATE cloudkit_chat_jobs SET response_consumed_at = ? WHERE request_id = ?")
        .run(now + 12003, consumedFailureRequest.requestId);
      db.prepare(
        "INSERT INTO cloudkit_chat_remote_cleanup (" +
        "request_id, status, attempt_count, next_attempt_at, created_at, completed_at, last_error" +
        ") VALUES (?, 'queued', 0, ?, ?, NULL, NULL)"
      ).run(consumedFailureRequest.requestId, now + 12003, now + 12003);
      const consumedRetry = jobs.requeueCloudKitChatJobsAfterAiConfiguration({ now: now + 13000 });
      assert.equal(consumedRetry.requestIds.includes(consumedFailureRequest.requestId), false);
      assert.equal(jobs.getCloudKitChatJob(consumedFailureRequest.requestId).status, "failed");

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

test("CloudKit quarantine orders chat responses before receipts from the same import batch", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-order-"));
  try {
    const script = `
      const { runMigrations } = await import("./server/migrations.ts");
      const { db } = await import("./server/db.ts");
      runMigrations();
      const importedAt = 1700000000000;
      const insert = db.prepare(
        "INSERT INTO cloudkit_sync_quarantine (" +
        "id, zone, record_type, record_name, change_type, status, requires_user_review, payload_json, imported_at" +
        ") VALUES (?, 'LifeOSChatRelayZone', ?, ?, 'changed', 'auto-ready', 0, '{}', ?)"
      );
      insert.run("receipt-row", "LifeOSChatReceipt", "chat-receipt:request", importedAt);
      insert.run("response-row", "LifeOSChatResponse", "chat-response:request", importedAt);
      const { listCloudKitSyncQuarantineItems } = await import("./server/cloudKitSyncApply.ts");
      const recordTypes = listCloudKitSyncQuarantineItems({ limit: 10 }).items.map((item) => item.recordType);
      console.log(JSON.stringify(recordTypes));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), ["LifeOSChatResponse", "LifeOSChatReceipt"]);
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
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, source_evidence_id, imported_at) VALUES (?, 'LifeOSChatRelayZone', 'LifeOSDeviceKey', ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, 'device-key-evidence', ?)")
        .run("device-key-row", deviceProtocol.cloudKitDeviceKeyRecordName(devicePayload.deviceIdHash), "ios-device-key:" + deviceId, deviceContentHash, devicePayloadHash, now, Buffer.byteLength(devicePayloadJson), devicePayloadJson, new Date(now).toISOString(), now + 1);
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, source_evidence_id, imported_at) VALUES (?, 'LifeOSChatRelayZone', 'LifeOSChatRequest', ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, 'chat-request-evidence', ?)")
        .run("chat-request-row", "chat-request:" + requestId, "ios-chat-request:" + requestId, contentHash, payloadHash, now, Buffer.byteLength(payloadJson), payloadJson, new Date(now).toISOString(), now + 2);
      const { applyCloudKitSyncQuarantine } = await import("./server/cloudKitSyncApply.ts");
      const firstApply = applyCloudKitSyncQuarantine({ now: now + 3, allowedZones: ["LifeOSChatRelayZone"] });
      const deviceKeys = await import("./server/cloudKitDeviceKeys.ts");
      const pendingDevice = deviceKeys.listCloudKitChatDevices({ now: now + 4 }).items[0];
      deviceKeys.approveCloudKitChatDevice(pendingDevice.id, "test-admin", now + 5);
      const secondApply = applyCloudKitSyncQuarantine({ now: now + 6, allowedZones: ["LifeOSChatRelayZone"] });
      const jobs = await import("./server/cloudKitChatJobs.ts");
      const worker = await import("./server/cloudKitChatWorker.ts");
      const remoteMacKeyPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const remoteMacPublicKeyData = remoteMacKeyPair.publicKey.export({ type: "spki", format: "der" });
      const untrustedResponse = {
        schemaVersion: 1,
        requestId,
        responseId: chatProtocol.cloudKitChatResponseId(requestId),
        conversationId: payload.conversationId,
        assistantMessageId: "c23e4567-e89b-42d3-a456-426614174000",
        status: "completed",
        text: "This response must not be trusted.",
        requestContentHash: contentHash,
        completedAt: now + 6,
        updatedAt: now + 6,
        macPublicKey: remoteMacPublicKeyData.toString("base64url"),
        macPublicKeyFingerprint: crypto.createHash("sha256").update(remoteMacPublicKeyData).digest("hex"),
        macSignature: "",
      };
      untrustedResponse.macSignature = crypto.sign(
        "sha256",
        Buffer.from(chatProtocol.cloudKitChatResponseSignatureText(untrustedResponse)),
        { key: remoteMacKeyPair.privateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64url");
      const untrustedResponseJson = JSON.stringify(untrustedResponse);
      const untrustedResponseContentHash = crypto.createHash("sha256").update(untrustedResponseJson).digest("hex");
      const untrustedResponsePayloadHash = crypto.createHash("sha256").update(JSON.stringify(untrustedResponseJson)).digest("hex");
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, source_evidence_id, imported_at) VALUES (?, 'LifeOSChatRelayZone', 'LifeOSChatResponse', ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, 'untrusted-response-evidence', ?)")
        .run(
          "untrusted-response-row",
          chatProtocol.cloudKitChatResponseRecordName(requestId),
          "mac-chat-response:" + requestId,
          untrustedResponseContentHash,
          untrustedResponsePayloadHash,
          now + 6,
          Buffer.byteLength(untrustedResponseJson),
          untrustedResponseJson,
          new Date(now + 6).toISOString(),
          now + 6,
        );
      const untrustedApply = applyCloudKitSyncQuarantine({ now: now + 6, allowedZones: ["LifeOSChatRelayZone"] });
      const untrustedRow = db.prepare("SELECT status, error FROM cloudkit_sync_quarantine WHERE id = 'untrusted-response-row'").get();
      if (untrustedRow.status !== "conflict" || !/untrusted Mac identity/i.test(untrustedRow.error)) {
        throw new Error("response from an untrusted Mac was not rejected");
      }
      if (jobs.getCloudKitChatJob(requestId).status !== "queued") {
        throw new Error("untrusted Mac response changed the local job");
      }
      const beforeWorker = jobs.listCloudKitChatResponsePayloads();
      const workerResult = await worker.runCloudKitChatWorkerQueue({
        now: now + 7,
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
      const { buildCloudKitChatRelayExportPackage } = await import("./server/cloudKitChatRelayBatch.ts");
      const preview = buildCloudKitChatRelayExportPackage({ limit: 20, now: new Date(now + 8) });
      const response = preview.helperSyncBatch.records.find((record) => record.recordType === "LifeOSChatResponse");
      const responsePayload = JSON.parse(response.fields.payloadJson);
      const responsePayloadHash = crypto.createHash("sha256").update(JSON.stringify(response.fields.payloadJson)).digest("hex");
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, source_evidence_id, imported_at) VALUES (?, 'LifeOSChatRelayZone', 'LifeOSChatResponse', ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, 'local-response-recovery-evidence', ?)")
        .run(
          "local-response-recovery-row",
          chatProtocol.cloudKitChatResponseRecordName(requestId),
          "mac-chat-response:" + requestId,
          response.contentHash,
          responsePayloadHash,
          responsePayload.updatedAt,
          Buffer.byteLength(response.fields.payloadJson),
          response.fields.payloadJson,
          new Date(now + 9).toISOString(),
          now + 9,
        );
      const receiptPayload = {
        schemaVersion: 1,
        requestId,
        responseId: responsePayload.responseId,
        deviceId,
        sourceDeviceHash: devicePayload.deviceIdHash,
        publicKeyFingerprint: devicePayload.publicKeyFingerprint,
        responseContentHash: response.contentHash,
        responseUpdatedAt: responsePayload.updatedAt,
        acknowledgedAt: responsePayload.updatedAt,
        signature: "",
        syncMutation: {
          kind: "chat-receipt",
          origin: "ios-native",
          mutatedAt: responsePayload.updatedAt,
        },
      };
      receiptPayload.signature = crypto.sign(
        "sha256",
        Buffer.from(chatProtocol.cloudKitChatReceiptSignatureText(receiptPayload)),
        { key: keyPair.privateKey, dsaEncoding: "ieee-p1363" },
      ).toString("base64url");
      const receiptJson = JSON.stringify(receiptPayload);
      const receiptContentHash = crypto.createHash("sha256").update(receiptJson).digest("hex");
      const receiptPayloadHash = crypto.createHash("sha256").update(JSON.stringify(receiptJson)).digest("hex");
      db.prepare("INSERT INTO cloudkit_sync_quarantine (id, zone, record_type, record_name, change_type, status, mutation_id, content_hash, payload_hash, logical_clock, payload_byte_size, requires_user_review, payload_json, server_modified_at, source_evidence_id, imported_at) VALUES (?, 'LifeOSChatRelayZone', 'LifeOSChatReceipt', ?, 'changed', 'auto-ready', ?, ?, ?, ?, ?, 0, ?, ?, 'chat-receipt-evidence', ?)")
        .run(
          "chat-receipt-row",
          chatProtocol.cloudKitChatReceiptRecordName(requestId),
          "ios-chat-receipt:" + requestId,
          receiptContentHash,
          receiptPayloadHash,
          responsePayload.updatedAt,
          Buffer.byteLength(receiptJson),
          receiptJson,
          new Date(now + 9).toISOString(),
          now + 9,
        );
      const receiptApply = applyCloudKitSyncQuarantine({ now: now + 10, allowedZones: ["LifeOSChatRelayZone"] });
      const cleanupPreview = buildCloudKitChatRelayExportPackage({ limit: 20, now: new Date(now + 11) });
      console.log(JSON.stringify({
        applied: firstApply.applied + secondApply.applied + receiptApply.applied,
        pendingConflicts: firstApply.conflicts,
        untrustedConflicts: untrustedApply.conflicts,
        responsesBeforeWorker: beforeWorker.length,
        workerCompleted: workerResult.completed,
        job: jobs.getCloudKitChatJob(requestId).status,
        consumedAt: jobs.getCloudKitChatJob(requestId).responseConsumedAt,
        recoveredExportedAt: jobs.getCloudKitChatJob(requestId).responseExportedAt,
        recoveredExportMatches: jobs.getCloudKitChatJob(requestId).responseExportedContentHash === response.contentHash,
        response: response?.recordName,
        responseStatus: responsePayload?.status,
        cleanupDeletions: cleanupPreview.helperSyncBatch.deletions,
        cleanupZones: cleanupPreview.helperSyncBatch.zones,
        cleanupReceipts: cleanupPreview.cleanupReceipts,
      }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      applied: 4,
      pendingConflicts: 1,
      untrustedConflicts: 1,
      responsesBeforeWorker: 0,
      workerCompleted: 1,
      job: "completed",
      consumedAt: 1700000000007,
      recoveredExportedAt: 1700000000009,
      recoveredExportMatches: true,
      response: "chat-response:923e4567-e89b-42d3-a456-426614174000",
      responseStatus: "completed",
      cleanupDeletions: [
        {
          zone: "LifeOSChatRelayZone",
          recordType: "LifeOSChatRequest",
          recordName: "chat-request:923e4567-e89b-42d3-a456-426614174000",
        },
        {
          zone: "LifeOSChatRelayZone",
          recordType: "LifeOSChatResponse",
          recordName: "chat-response:923e4567-e89b-42d3-a456-426614174000",
        },
        {
          zone: "LifeOSChatRelayZone",
          recordType: "LifeOSChatReceipt",
          recordName: "chat-receipt:923e4567-e89b-42d3-a456-426614174000",
        },
        {
          zone: "LifeOSChatRelayControlZone",
          recordType: "LifeOSChatClaim",
          recordName: "chat-claim:923e4567-e89b-42d3-a456-426614174000",
        },
      ],
      cleanupZones: [
        { zone: "LifeOSChatRelayControlZone", records: 1 },
        { zone: "LifeOSChatRelayZone", records: 3 },
      ],
      cleanupReceipts: [
        { requestId: "923e4567-e89b-42d3-a456-426614174000" },
      ],
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
