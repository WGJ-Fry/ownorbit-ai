import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  cloudKitDeviceIdHash,
  cloudKitDeviceKeyFingerprint,
  cloudKitDeviceKeyProofText,
  cloudKitDeviceKeyRecordName,
  parseCloudKitDeviceKeyPayload,
} from "../server/cloudKitDeviceKeyProtocol.ts";
import {
  cloudKitChatRequestSignatureText,
  parseCloudKitChatRequestPayload,
  verifyCloudKitChatRequestSignature,
} from "../server/cloudKitChatProtocol.ts";

const now = 1_700_000_000_000;
const deviceId = "423e4567-e89b-42d3-a456-426614174000";

function fixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyValue = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const payload = {
    schemaVersion: 1,
    deviceId,
    deviceIdHash: cloudKitDeviceIdHash(deviceId),
    displayName: "Test iPhone",
    deviceType: "ios",
    channelScope: "cloudkit-chat",
    publicKey: publicKeyValue,
    publicKeyFingerprint: cloudKitDeviceKeyFingerprint(publicKeyValue),
    proofSignature: "",
    status: "active",
    createdAt: now,
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
    syncMutation: { kind: "device-key-register", origin: "ios-native", mutatedAt: now },
  };
  payload.proofSignature = crypto.sign(
    "sha256",
    Buffer.from(cloudKitDeviceKeyProofText(payload)),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return { privateKey, payload };
}

test("CloudKit device key registration verifies P-256 possession without private material", () => {
  const { payload } = fixture();
  const parsed = parseCloudKitDeviceKeyPayload(payload, {
    now,
    recordName: cloudKitDeviceKeyRecordName(payload.deviceIdHash),
    mutationId: `ios-device-key:${deviceId}`,
    logicalClock: now,
  });
  assert.equal(parsed.channelScope, "cloudkit-chat");
  assert.equal(JSON.stringify(parsed).includes("PRIVATE KEY"), false);
  assert.throws(() => parseCloudKitDeviceKeyPayload({
    ...payload,
    createdAt: now + 1,
    syncMutation: { ...payload.syncMutation, mutatedAt: now + 1 },
  }, { now }), /proof/i);
  assert.throws(() => parseCloudKitDeviceKeyPayload({ ...payload, expiresAt: now - 1 }, { now }), /expired|time window/i);
});

test("CloudKit chat signatures bind prompt, request, and paired public key", () => {
  const { privateKey, payload: deviceKey } = fixture();
  const request = {
    schemaVersion: 1,
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    conversationId: "223e4567-e89b-42d3-a456-426614174000",
    userMessageId: "323e4567-e89b-42d3-a456-426614174000",
    deviceId,
    sourceDeviceHash: deviceKey.deviceIdHash,
    publicKeyFingerprint: deviceKey.publicKeyFingerprint,
    signature: "",
    prompt: "Plan a safe focus block.",
    locale: "en-US",
    status: "queued",
    clientSequence: 7,
    createdAt: now,
    expiresAt: now + 60 * 60 * 1000,
    syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
  };
  request.signature = crypto.sign(
    "sha256",
    Buffer.from(cloudKitChatRequestSignatureText(request)),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  const parsed = parseCloudKitChatRequestPayload(request, { now });
  assert.equal(verifyCloudKitChatRequestSignature(parsed, deviceKey.publicKey), true);
  assert.throws(() => verifyCloudKitChatRequestSignature({ ...parsed, prompt: "Tampered" }, deviceKey.publicKey), /signature/i);
});
