import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import "./cloudkit-device-key-protocol.test.mjs";

import {
  assertCloudKitChatJobTransition,
  canTransitionCloudKitChatJob,
  cloudKitChatRequestRecordName,
  cloudKitChatResponseId,
  parseCloudKitChatRequestPayload,
  parseCloudKitChatResponsePayload,
} from "../server/cloudKitChatProtocol.ts";

const now = 1_700_000_000_000;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const conversationId = "223e4567-e89b-42d3-a456-426614174000";
const userMessageId = "323e4567-e89b-42d3-a456-426614174000";
const deviceId = "423e4567-e89b-42d3-a456-426614174000";
const sourceDeviceHash = crypto.createHash("sha256").update(deviceId).digest("hex");

function requestPayload(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId,
    conversationId,
    userMessageId,
    deviceId,
    sourceDeviceHash,
    publicKeyFingerprint: "a".repeat(64),
    signature: "A".repeat(86),
    prompt: "Please help me plan tomorrow.",
    locale: "en-US",
    status: "queued",
    clientSequence: 7,
    createdAt: now,
    expiresAt: now + 60 * 60 * 1000,
    syncMutation: {
      kind: "chat-request",
      origin: "ios-native",
      mutatedAt: now,
    },
    ...overrides,
  };
}

test("CloudKit chat request accepts only canonical safe phone payloads", () => {
  const parsed = parseCloudKitChatRequestPayload(requestPayload(), {
    now,
    recordName: cloudKitChatRequestRecordName(requestId),
    mutationId: `ios-chat-request:${requestId}`,
    logicalClock: now,
  });
  assert.equal(parsed.requestId, requestId);
  assert.equal(parsed.status, "queued");
  assert.equal(parsed.prompt, "Please help me plan tomorrow.");

  assert.throws(() => parseCloudKitChatRequestPayload(requestPayload({ providerApiKey: "not-allowed" }), { now }), /unsupported fields/i);
  assert.throws(() => parseCloudKitChatRequestPayload(requestPayload({ prompt: `Bearer ${"x".repeat(32)}` }), { now }), /secret-like/i);
  assert.throws(() => parseCloudKitChatRequestPayload(requestPayload({ expiresAt: now + 25 * 60 * 60 * 1000 }), { now }), /time window/i);
  assert.throws(() => parseCloudKitChatRequestPayload(requestPayload(), {
    now,
    recordName: "chat-request:wrong",
  }), /record name/i);
});

test("CloudKit chat response id and terminal payloads are deterministic and strict", () => {
  const responseId = cloudKitChatResponseId(requestId);
  const completed = parseCloudKitChatResponsePayload({
    schemaVersion: 1,
    requestId,
    responseId,
    conversationId,
    assistantMessageId: "423e4567-e89b-42d3-a456-426614174000",
    status: "completed",
    text: "Here is a safe plan.",
    providerLabel: "OpenAI",
    modelLabel: "gpt-4o-mini",
    requestContentHash: "b".repeat(64),
    startedAt: now + 100,
    completedAt: now + 200,
    updatedAt: now + 200,
  });
  assert.equal(completed.responseId, responseId);
  assert.equal(completed.status, "completed");

  assert.throws(() => parseCloudKitChatResponsePayload({
    ...completed,
    responseId: "523e4567-e89b-42d3-a456-426614174000",
  }), /response id/i);
  assert.throws(() => parseCloudKitChatResponsePayload({
    schemaVersion: 1,
    requestId,
    responseId,
    conversationId,
    status: "failed",
    safeErrorCode: "raw error text is not an error code",
    requestContentHash: "b".repeat(64),
    completedAt: now + 200,
    updatedAt: now + 200,
  }), /incomplete or unsafe/i);
});

test("CloudKit chat state machine permits retry but keeps terminal states terminal", () => {
  assert.equal(canTransitionCloudKitChatJob("queued", "processing"), true);
  assert.equal(canTransitionCloudKitChatJob("processing", "queued"), true);
  assert.equal(canTransitionCloudKitChatJob("processing", "completed"), true);
  assert.equal(canTransitionCloudKitChatJob("completed", "queued"), false);
  assert.throws(() => assertCloudKitChatJobTransition("completed", "processing"), /invalid/i);
});
