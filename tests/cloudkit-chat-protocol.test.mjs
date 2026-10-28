import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import "./cloudkit-device-key-protocol.test.mjs";

import {
  assertCloudKitChatJobTransition,
  canTransitionCloudKitChatJob,
  cloudKitChatReceiptRecordName,
  cloudKitChatReceiptSignatureText,
  cloudKitChatRequestRecordName,
  cloudKitChatRequestSignatureText,
  cloudKitChatResponseRecordName,
  cloudKitChatResponseSignatureText,
  cloudKitChatResponseId,
  parseCloudKitChatReceiptPayload,
  parseCloudKitChatRequestPayload,
  parseCloudKitChatResponsePayload,
  verifyCloudKitChatReceiptSignature,
  verifyCloudKitChatResponseSignature,
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

test("CloudKit chat requests bind an optional trusted Mac fingerprint into the signed payload", () => {
  const trustedMacFingerprint = "f".repeat(64);
  const trusted = parseCloudKitChatRequestPayload(requestPayload({ trustedMacFingerprint }), { now });
  const untrusted = parseCloudKitChatRequestPayload(requestPayload(), { now });

  assert.equal(trusted.trustedMacFingerprint, trustedMacFingerprint);
  assert.notEqual(
    cloudKitChatRequestSignatureText(trusted),
    cloudKitChatRequestSignatureText(untrusted),
  );
  assert.throws(
    () => parseCloudKitChatRequestPayload(requestPayload({ trustedMacFingerprint: "not-a-fingerprint" }), { now }),
    /trusted Mac (?:fingerprint|identity)/i,
  );
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

test("CloudKit chat response signatures bind Mac identity, request, text, and status", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyData = publicKey.export({ format: "der", type: "spki" });
  const unsigned = parseCloudKitChatResponsePayload({
    schemaVersion: 1,
    requestId,
    responseId: cloudKitChatResponseId(requestId),
    conversationId,
    assistantMessageId: "423e4567-e89b-42d3-a456-426614174000",
    status: "completed",
    text: "Signed only by the local Mac.",
    requestContentHash: "c".repeat(64),
    startedAt: now + 100,
    completedAt: now + 200,
    updatedAt: now + 200,
  });
  const response = {
    ...unsigned,
    macPublicKey: publicKeyData.toString("base64url"),
    macPublicKeyFingerprint: crypto.createHash("sha256").update(publicKeyData).digest("hex"),
  };
  response.macSignature = crypto.sign(
    "sha256",
    Buffer.from(cloudKitChatResponseSignatureText(response)),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");

  assert.equal(verifyCloudKitChatResponseSignature(response), true);
  assert.equal(parseCloudKitChatResponsePayload(response, { requireMacSignature: true }).macPublicKeyFingerprint, response.macPublicKeyFingerprint);
  assert.doesNotThrow(() => parseCloudKitChatResponsePayload(response, {
    requireMacSignature: true,
    recordName: cloudKitChatResponseRecordName(requestId),
    mutationId: `mac-chat-response:${requestId}`,
    logicalClock: response.updatedAt,
  }));
  assert.throws(() => parseCloudKitChatResponsePayload(response, {
    requireMacSignature: true,
    recordName: cloudKitChatResponseRecordName(requestId),
    mutationId: `mac-chat-response:${requestId}`,
    logicalClock: response.updatedAt + 1,
  }), /logical clock/i);
  assert.throws(() => parseCloudKitChatResponsePayload(response, {
    requireMacSignature: true,
    recordName: cloudKitChatResponseRecordName(requestId),
    mutationId: `mac-chat-response:${crypto.randomUUID()}`,
    logicalClock: response.updatedAt,
  }), /mutation id/i);
  assert.throws(() => verifyCloudKitChatResponseSignature({ ...response, text: "Tampered" }), /signature is invalid/i);
  assert.throws(
    () => parseCloudKitChatResponsePayload(unsigned, { requireMacSignature: true }),
    /signature is required/i,
  );
});

test("CloudKit chat receipts bind the paired device to one exact exported response", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyData = publicKey.export({ format: "der", type: "spki" });
  const fingerprint = crypto.createHash("sha256").update(publicKeyData).digest("hex");
  const responseUpdatedAt = now + 200;
  const receipt = {
    schemaVersion: 1,
    requestId,
    responseId: cloudKitChatResponseId(requestId),
    deviceId,
    sourceDeviceHash,
    publicKeyFingerprint: fingerprint,
    responseContentHash: "d".repeat(64),
    responseUpdatedAt,
    acknowledgedAt: responseUpdatedAt,
    signature: "",
    syncMutation: {
      kind: "chat-receipt",
      origin: "ios-native",
      mutatedAt: responseUpdatedAt,
    },
  };
  receipt.signature = crypto.sign(
    "sha256",
    Buffer.from(cloudKitChatReceiptSignatureText(receipt)),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");

  const parsed = parseCloudKitChatReceiptPayload(receipt, {
    now: responseUpdatedAt,
    recordName: cloudKitChatReceiptRecordName(requestId),
    mutationId: `ios-chat-receipt:${requestId}`,
    logicalClock: responseUpdatedAt,
  });
  assert.equal(parsed.responseContentHash, "d".repeat(64));
  assert.equal(verifyCloudKitChatReceiptSignature(parsed, publicKeyData.toString("base64url")), true);
  assert.throws(
    () => verifyCloudKitChatReceiptSignature({ ...parsed, responseContentHash: "e".repeat(64) }, publicKeyData.toString("base64url")),
    /signature is invalid/i,
  );
  assert.throws(
    () => parseCloudKitChatReceiptPayload({ ...receipt, acknowledgedAt: responseUpdatedAt + 1 }, { now: responseUpdatedAt + 1 }),
    /timestamp/i,
  );
  assert.throws(
    () => parseCloudKitChatReceiptPayload(receipt, {
      now: responseUpdatedAt,
      recordName: "chat-receipt:wrong",
    }),
    /record name/i,
  );
});

test("CloudKit chat state machine permits retry but keeps terminal states terminal", () => {
  assert.equal(canTransitionCloudKitChatJob("queued", "processing"), true);
  assert.equal(canTransitionCloudKitChatJob("processing", "queued"), true);
  assert.equal(canTransitionCloudKitChatJob("processing", "completed"), true);
  assert.equal(canTransitionCloudKitChatJob("completed", "queued"), false);
  assert.throws(() => assertCloudKitChatJobTransition("completed", "processing"), /invalid/i);
});
