import crypto from "crypto";
import { importCloudKitDevicePublicKey } from "./cloudKitDeviceKeyProtocol";

export const CLOUDKIT_CHAT_PROTOCOL_SCHEMA = "ownorbit-cloudkit-chat.v1";
export const CLOUDKIT_CHAT_REQUEST_RECORD_TYPE = "LifeOSChatRequest";
export const CLOUDKIT_CHAT_RESPONSE_RECORD_TYPE = "LifeOSChatResponse";
export const CLOUDKIT_CHAT_MAX_PROMPT_CHARS = 8_000;
export const CLOUDKIT_CHAT_MAX_RESPONSE_CHARS = 16_000;
export const CLOUDKIT_CHAT_MAX_REQUEST_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const CLOUDKIT_CHAT_MAX_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export type CloudKitChatJobStatus = "queued" | "processing" | "completed" | "failed" | "expired";
export type CloudKitChatRequestPayload = {
  schemaVersion: 1;
  requestId: string;
  conversationId: string;
  userMessageId: string;
  deviceId: string;
  sourceDeviceHash: string;
  publicKeyFingerprint: string;
  signature: string;
  prompt: string;
  locale: "zh-CN" | "en-US";
  status: "queued";
  clientSequence: number;
  createdAt: number;
  expiresAt: number;
  syncMutation: {
    kind: "chat-request";
    origin: "ios-native";
    mutatedAt: number;
  };
};

export type CloudKitChatResponsePayload = {
  schemaVersion: 1;
  requestId: string;
  responseId: string;
  conversationId: string;
  assistantMessageId?: string;
  status: "retrying" | Exclude<CloudKitChatJobStatus, "queued">;
  text?: string;
  safeErrorCode?: string;
  providerLabel?: string;
  modelLabel?: string;
  requestContentHash: string;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/i;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;
const safeCodePattern = /^[a-z][a-z0-9-]{0,63}$/;
const secretLikePattern = /\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]+)\b|\/Users\/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+/i;

const transitions: Record<CloudKitChatJobStatus, ReadonlySet<CloudKitChatJobStatus>> = {
  queued: new Set(["processing", "expired"]),
  processing: new Set(["queued", "completed", "failed", "expired"]),
  completed: new Set(),
  failed: new Set(["queued", "expired"]),
  expired: new Set(),
};

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : "";
}

function safeLabel(value: unknown, maxLength = 120) {
  if (value === undefined) return undefined;
  const normalized = boundedText(value, maxLength).replace(/\s+/g, " ");
  if (!normalized || secretLikePattern.test(normalized)) throw new Error("CloudKit chat response label is invalid.");
  return normalized;
}

function parseJsonPayload(input: unknown) {
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as unknown;
    } catch {
      throw new Error("CloudKit chat payload is not valid JSON.");
    }
  }
  return input;
}

export function cloudKitChatRequestRecordName(requestId: string) {
  if (!uuidPattern.test(requestId)) throw new Error("CloudKit chat request id is invalid.");
  return `chat-request:${requestId.toLowerCase()}`;
}

export function cloudKitChatResponseRecordName(requestId: string) {
  if (!uuidPattern.test(requestId)) throw new Error("CloudKit chat request id is invalid.");
  return `chat-response:${requestId.toLowerCase()}`;
}

export function cloudKitChatResponseId(requestId: string) {
  if (!uuidPattern.test(requestId)) throw new Error("CloudKit chat request id is invalid.");
  const seed = crypto.createHash("sha256").update(`ownorbit-chat-response:${requestId.toLowerCase()}`).digest("hex");
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-a${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
}

export function cloudKitChatRequestSignatureText(value: Pick<CloudKitChatRequestPayload,
  "requestId" | "conversationId" | "userMessageId" | "deviceId" | "sourceDeviceHash" |
  "publicKeyFingerprint" | "prompt" | "locale" | "clientSequence" | "createdAt" | "expiresAt">) {
  const promptHash = crypto.createHash("sha256").update(value.prompt, "utf8").digest("hex");
  return [
    CLOUDKIT_CHAT_PROTOCOL_SCHEMA,
    value.requestId.toLowerCase(),
    value.conversationId.toLowerCase(),
    value.userMessageId.toLowerCase(),
    value.deviceId.toLowerCase(),
    value.sourceDeviceHash.toLowerCase(),
    value.publicKeyFingerprint.toLowerCase(),
    promptHash,
    value.locale,
    String(value.clientSequence),
    String(value.createdAt),
    String(value.expiresAt),
  ].join("\n");
}

export function verifyCloudKitChatRequestSignature(request: CloudKitChatRequestPayload, publicKey: string) {
  if (!signaturePattern.test(request.signature)) throw new Error("CloudKit chat request signature encoding is invalid.");
  const signature = Buffer.from(request.signature, "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== request.signature) {
    throw new Error("CloudKit chat request signature encoding is invalid.");
  }
  const valid = crypto.verify(
    "sha256",
    Buffer.from(cloudKitChatRequestSignatureText(request), "utf8"),
    { key: importCloudKitDevicePublicKey(publicKey), dsaEncoding: "ieee-p1363" },
    signature,
  );
  if (!valid) throw new Error("CloudKit chat request signature is invalid.");
  return true;
}

export function canTransitionCloudKitChatJob(from: CloudKitChatJobStatus, to: CloudKitChatJobStatus) {
  return from === to || transitions[from].has(to);
}

export function assertCloudKitChatJobTransition(from: CloudKitChatJobStatus, to: CloudKitChatJobStatus) {
  if (!canTransitionCloudKitChatJob(from, to)) {
    throw new Error(`Invalid CloudKit chat job transition: ${from} -> ${to}`);
  }
}

export function parseCloudKitChatRequestPayload(
  input: unknown,
  options: { now?: number; recordName?: string; mutationId?: string; logicalClock?: number } = {},
): CloudKitChatRequestPayload {
  const value = parseJsonPayload(input);
  if (!plainObject(value) || !exactFields(value, [
    "schemaVersion", "requestId", "conversationId", "userMessageId", "deviceId", "sourceDeviceHash",
    "publicKeyFingerprint", "signature", "prompt",
    "locale", "status", "clientSequence", "createdAt", "expiresAt", "syncMutation",
  ])) throw new Error("CloudKit chat request contains unsupported fields.");
  if (value.schemaVersion !== 1 || value.status !== "queued") throw new Error("CloudKit chat request schema or status is invalid.");

  const requestId = boundedText(value.requestId, 36).toLowerCase();
  const conversationId = boundedText(value.conversationId, 36).toLowerCase();
  const userMessageId = boundedText(value.userMessageId, 36).toLowerCase();
  const deviceId = boundedText(value.deviceId, 36).toLowerCase();
  const sourceDeviceHash = boundedText(value.sourceDeviceHash, 64).toLowerCase();
  const publicKeyFingerprint = boundedText(value.publicKeyFingerprint, 64).toLowerCase();
  const signature = boundedText(value.signature, 128);
  const prompt = boundedText(value.prompt, CLOUDKIT_CHAT_MAX_PROMPT_CHARS);
  const locale = value.locale === "en-US" ? "en-US" : value.locale === "zh-CN" ? "zh-CN" : "";
  const clientSequence = integer(value.clientSequence);
  const createdAt = integer(value.createdAt);
  const expiresAt = integer(value.expiresAt);
  const now = options.now ?? Date.now();
  if (!uuidPattern.test(requestId) || !uuidPattern.test(conversationId) || !uuidPattern.test(userMessageId) || !uuidPattern.test(deviceId)) {
    throw new Error("CloudKit chat request identifiers are invalid.");
  }
  const expectedDeviceHash = crypto.createHash("sha256").update(deviceId, "utf8").digest("hex");
  if (!hashPattern.test(sourceDeviceHash) || sourceDeviceHash !== expectedDeviceHash || !hashPattern.test(publicKeyFingerprint)) {
    throw new Error("CloudKit chat request device identity is invalid.");
  }
  if (!signaturePattern.test(signature)) throw new Error("CloudKit chat request signature encoding is invalid.");
  if (!prompt || secretLikePattern.test(prompt)) throw new Error("CloudKit chat request prompt is empty, too large, or contains secret-like content.");
  if (!locale || clientSequence === undefined || clientSequence < 0) throw new Error("CloudKit chat request metadata is invalid.");
  if (
    createdAt === undefined || expiresAt === undefined ||
    createdAt <= 0 || createdAt > now + 5 * 60 * 1000 || createdAt < now - CLOUDKIT_CHAT_MAX_REQUEST_AGE_MS ||
    expiresAt <= createdAt || expiresAt - createdAt > CLOUDKIT_CHAT_MAX_REQUEST_TTL_MS
  ) throw new Error("CloudKit chat request time window is invalid.");

  if (!plainObject(value.syncMutation) || !exactFields(value.syncMutation, ["kind", "origin", "mutatedAt"])) {
    throw new Error("CloudKit chat request mutation metadata is invalid.");
  }
  if (value.syncMutation.kind !== "chat-request" || value.syncMutation.origin !== "ios-native" || integer(value.syncMutation.mutatedAt) !== createdAt) {
    throw new Error("CloudKit chat request mutation metadata is invalid.");
  }
  if (options.recordName && options.recordName !== cloudKitChatRequestRecordName(requestId)) {
    throw new Error("CloudKit chat request id does not match its record name.");
  }
  if (options.mutationId && options.mutationId !== `ios-chat-request:${requestId}`) {
    throw new Error("CloudKit chat request mutation id is invalid.");
  }
  if (options.logicalClock !== undefined && options.logicalClock !== createdAt) {
    throw new Error("CloudKit chat request logical clock is invalid.");
  }

  return {
    schemaVersion: 1,
    requestId,
    conversationId,
    userMessageId,
    deviceId,
    sourceDeviceHash,
    publicKeyFingerprint,
    signature,
    prompt,
    locale,
    status: "queued",
    clientSequence,
    createdAt,
    expiresAt,
    syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: createdAt },
  };
}

export function parseCloudKitChatResponsePayload(input: unknown): CloudKitChatResponsePayload {
  const value = parseJsonPayload(input);
  if (!plainObject(value) || !exactFields(value, [
    "schemaVersion", "requestId", "responseId", "conversationId", "status", "requestContentHash", "updatedAt",
  ], ["assistantMessageId", "text", "safeErrorCode", "providerLabel", "modelLabel", "startedAt", "completedAt"])) {
    throw new Error("CloudKit chat response contains unsupported fields.");
  }
  const status = value.status;
  if (value.schemaVersion !== 1 || !["retrying", "processing", "completed", "failed", "expired"].includes(String(status))) {
    throw new Error("CloudKit chat response schema or status is invalid.");
  }
  const requestId = boundedText(value.requestId, 36).toLowerCase();
  const responseId = boundedText(value.responseId, 36).toLowerCase();
  const conversationId = boundedText(value.conversationId, 36).toLowerCase();
  const assistantMessageId = value.assistantMessageId === undefined ? undefined : boundedText(value.assistantMessageId, 36).toLowerCase();
  const requestContentHash = boundedText(value.requestContentHash, 64).toLowerCase();
  const updatedAt = integer(value.updatedAt);
  const startedAt = value.startedAt === undefined ? undefined : integer(value.startedAt);
  const completedAt = value.completedAt === undefined ? undefined : integer(value.completedAt);
  const text = value.text === undefined ? undefined : boundedText(value.text, CLOUDKIT_CHAT_MAX_RESPONSE_CHARS);
  const safeErrorCode = value.safeErrorCode === undefined ? undefined : boundedText(value.safeErrorCode, 64);
  if (!uuidPattern.test(requestId) || !uuidPattern.test(responseId) || !uuidPattern.test(conversationId) || !hashPattern.test(requestContentHash)) {
    throw new Error("CloudKit chat response identifiers are invalid.");
  }
  if (responseId !== cloudKitChatResponseId(requestId)) throw new Error("CloudKit chat response id is invalid.");
  if (assistantMessageId && !uuidPattern.test(assistantMessageId)) throw new Error("CloudKit chat response message id is invalid.");
  if (updatedAt === undefined || updatedAt <= 0 || (startedAt !== undefined && startedAt <= 0) || (completedAt !== undefined && completedAt <= 0)) {
    throw new Error("CloudKit chat response timestamps are invalid.");
  }
  if (status === "completed" && (!assistantMessageId || !text || completedAt === undefined)) {
    throw new Error("Completed CloudKit chat response is incomplete.");
  }
  if (status === "processing" && (startedAt === undefined || text !== undefined || safeErrorCode !== undefined || completedAt !== undefined)) {
    throw new Error("Processing CloudKit chat response contains terminal fields.");
  }
  if (status === "retrying" && (!safeErrorCode || !safeCodePattern.test(safeErrorCode) || text !== undefined || completedAt !== undefined)) {
    throw new Error("Retrying CloudKit chat response is incomplete or unsafe.");
  }
  if ((status === "failed" || status === "expired") && (!safeErrorCode || !safeCodePattern.test(safeErrorCode) || completedAt === undefined || text !== undefined)) {
    throw new Error("Failed CloudKit chat response is incomplete or unsafe.");
  }
  if (text && secretLikePattern.test(text)) throw new Error("CloudKit chat response contains secret-like content.");

  return {
    schemaVersion: 1,
    requestId,
    responseId,
    conversationId,
    assistantMessageId,
    status: status as CloudKitChatResponsePayload["status"],
    text,
    safeErrorCode,
    providerLabel: safeLabel(value.providerLabel),
    modelLabel: safeLabel(value.modelLabel),
    requestContentHash,
    startedAt,
    completedAt,
    updatedAt,
  };
}
