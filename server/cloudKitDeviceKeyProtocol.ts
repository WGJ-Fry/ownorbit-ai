import crypto from "crypto";

export const CLOUDKIT_DEVICE_KEY_SCHEMA = "ownorbit-cloudkit-device-key.v1";
export const CLOUDKIT_DEVICE_KEY_RECORD_TYPE = "LifeOSDeviceKey";
export const CLOUDKIT_DEVICE_KEY_CHANNEL_SCOPE = "cloudkit-chat";
export const CLOUDKIT_DEVICE_KEY_MAX_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export type CloudKitDeviceKeyPayload = {
  schemaVersion: 1;
  deviceId: string;
  deviceIdHash: string;
  displayName: string;
  deviceType: "ios";
  channelScope: "cloudkit-chat";
  publicKey: string;
  publicKeyFingerprint: string;
  proofSignature: string;
  status: "active";
  createdAt: number;
  expiresAt: number;
  syncMutation: {
    kind: "device-key-register";
    origin: "ios-native";
    mutatedAt: number;
  };
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/i;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, required: string[]) {
  const allowed = new Set(required);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function decodeBase64Url(value: string, expectedLength?: number) {
  if (!value || !base64UrlPattern.test(value) || value.includes("=")) throw new Error("CloudKit device key encoding is invalid.");
  const buffer = Buffer.from(value, "base64url");
  if (!buffer.length || (expectedLength !== undefined && buffer.length !== expectedLength)) {
    throw new Error("CloudKit device key length is invalid.");
  }
  if (buffer.toString("base64url") !== value) throw new Error("CloudKit device key encoding is not canonical.");
  return buffer;
}

export function cloudKitDeviceIdHash(deviceId: string) {
  if (!uuidPattern.test(deviceId)) throw new Error("CloudKit device id is invalid.");
  return crypto.createHash("sha256").update(deviceId.toLowerCase(), "utf8").digest("hex");
}

export function cloudKitDeviceKeyFingerprint(publicKey: string) {
  return crypto.createHash("sha256").update(decodeBase64Url(publicKey)).digest("hex");
}

export function cloudKitDeviceKeyRecordName(deviceIdHash: string) {
  if (!hashPattern.test(deviceIdHash)) throw new Error("CloudKit device id hash is invalid.");
  return `device-key:${deviceIdHash.toLowerCase().slice(0, 24)}`;
}

export function cloudKitDeviceKeyProofText(value: Pick<CloudKitDeviceKeyPayload,
  "deviceId" | "deviceIdHash" | "publicKeyFingerprint" | "createdAt" | "expiresAt">) {
  return [
    CLOUDKIT_DEVICE_KEY_SCHEMA,
    value.deviceId.toLowerCase(),
    value.deviceIdHash.toLowerCase(),
    value.publicKeyFingerprint.toLowerCase(),
    String(value.createdAt),
    String(value.expiresAt),
  ].join("\n");
}

export function importCloudKitDevicePublicKey(publicKey: string) {
  const key = crypto.createPublicKey({ key: decodeBase64Url(publicKey), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("CloudKit device key must be a P-256 signing key.");
  }
  return key;
}

export function verifyCloudKitDeviceKeyProof(payload: CloudKitDeviceKeyPayload) {
  const publicKey = importCloudKitDevicePublicKey(payload.publicKey);
  const signature = decodeBase64Url(payload.proofSignature, 64);
  const valid = crypto.verify(
    "sha256",
    Buffer.from(cloudKitDeviceKeyProofText(payload), "utf8"),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    signature,
  );
  if (!valid) throw new Error("CloudKit device key possession proof is invalid.");
  return true;
}

export function parseCloudKitDeviceKeyPayload(
  input: unknown,
  options: { now?: number; recordName?: string; mutationId?: string; logicalClock?: number } = {},
): CloudKitDeviceKeyPayload {
  let value = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input) as unknown; } catch { throw new Error("CloudKit device key payload is not valid JSON."); }
  }
  if (!plainObject(value) || !exactFields(value, [
    "schemaVersion", "deviceId", "deviceIdHash", "displayName", "deviceType", "channelScope",
    "publicKey", "publicKeyFingerprint", "proofSignature", "status", "createdAt", "expiresAt", "syncMutation",
  ])) throw new Error("CloudKit device key contains unsupported fields.");
  if (
    value.schemaVersion !== 1 || value.deviceType !== "ios" || value.channelScope !== CLOUDKIT_DEVICE_KEY_CHANNEL_SCOPE ||
    value.status !== "active"
  ) throw new Error("CloudKit device key schema or scope is invalid.");

  const deviceId = boundedText(value.deviceId, 36).toLowerCase();
  const deviceIdHash = boundedText(value.deviceIdHash, 64).toLowerCase();
  const displayName = boundedText(value.displayName, 80).replace(/\s+/g, " ");
  const publicKey = boundedText(value.publicKey, 256);
  const publicKeyFingerprint = boundedText(value.publicKeyFingerprint, 64).toLowerCase();
  const proofSignature = boundedText(value.proofSignature, 128);
  const createdAt = integer(value.createdAt);
  const expiresAt = integer(value.expiresAt);
  const now = options.now ?? Date.now();
  if (!uuidPattern.test(deviceId) || !hashPattern.test(deviceIdHash) || !displayName) {
    throw new Error("CloudKit device key identity is invalid.");
  }
  if (deviceIdHash !== cloudKitDeviceIdHash(deviceId)) throw new Error("CloudKit device id hash does not match the device id.");
  if (publicKeyFingerprint !== cloudKitDeviceKeyFingerprint(publicKey)) {
    throw new Error("CloudKit device key fingerprint does not match its public key.");
  }
  if (
    createdAt === undefined || expiresAt === undefined || createdAt <= 0 ||
    createdAt > now + 5 * 60 * 1000 || expiresAt <= createdAt || expiresAt - createdAt > CLOUDKIT_DEVICE_KEY_MAX_TTL_MS ||
    expiresAt <= now
  ) throw new Error("CloudKit device key time window is invalid or expired.");
  if (!plainObject(value.syncMutation) || !exactFields(value.syncMutation, ["kind", "origin", "mutatedAt"])) {
    throw new Error("CloudKit device key mutation metadata is invalid.");
  }
  if (
    value.syncMutation.kind !== "device-key-register" || value.syncMutation.origin !== "ios-native" ||
    integer(value.syncMutation.mutatedAt) !== createdAt
  ) throw new Error("CloudKit device key mutation metadata is invalid.");
  if (options.recordName && options.recordName !== cloudKitDeviceKeyRecordName(deviceIdHash)) {
    throw new Error("CloudKit device key identity does not match its record name.");
  }
  if (options.mutationId && options.mutationId !== `ios-device-key:${deviceId}`) {
    throw new Error("CloudKit device key mutation id is invalid.");
  }
  if (options.logicalClock !== undefined && options.logicalClock !== createdAt) {
    throw new Error("CloudKit device key logical clock is invalid.");
  }

  const payload: CloudKitDeviceKeyPayload = {
    schemaVersion: 1,
    deviceId,
    deviceIdHash,
    displayName,
    deviceType: "ios",
    channelScope: CLOUDKIT_DEVICE_KEY_CHANNEL_SCOPE,
    publicKey,
    publicKeyFingerprint,
    proofSignature,
    status: "active",
    createdAt,
    expiresAt,
    syncMutation: { kind: "device-key-register", origin: "ios-native", mutatedAt: createdAt },
  };
  verifyCloudKitDeviceKeyProof(payload);
  return payload;
}
