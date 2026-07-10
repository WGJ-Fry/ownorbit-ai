import { insertAuditLog } from "./audit";
import { getClientState, setClientState } from "./clientState";

const CLOUDKIT_PUSH_EVIDENCE_KEY = "lifeos_cloudkit_push_evidence";
const allowedEvents = new Set([
  "listener-starting",
  "listener-ready",
  "registration-failed",
  "subscription-failed",
  "remote-change",
  "notification-ignored",
]);
const allowedReasons = new Set([
  "starting",
  "ready",
  "apns-registration-failed",
  "subscription-save-failed",
  "database-change",
  "subscription-mismatch",
  "unsupported-notification",
]);
const eventReasons = new Map([
  ["listener-starting", new Set(["starting"])],
  ["listener-ready", new Set(["ready"])],
  ["registration-failed", new Set(["apns-registration-failed"])],
  ["subscription-failed", new Set(["subscription-save-failed"])],
  ["remote-change", new Set(["database-change"])],
  ["notification-ignored", new Set(["subscription-mismatch", "unsupported-notification"])],
]);

export type CloudKitPushEventInput = {
  event: string;
  reason: string;
  emittedAt?: string;
  subscriptionMatched?: boolean;
};

export type CloudKitPushEvidence = {
  listenerReadyAt?: number;
  lastEventAt?: number;
  lastRemoteChangeAt?: number;
  lastEvent?: string;
  lastReason?: string;
  receivedRemoteChanges: number;
  deliveryVerified: boolean;
  subscriptionMatched: boolean;
  updatedAt: number;
  rawPayloadStored: false;
  deviceTokenStored: false;
  cloudKitChangeTokenStored: false;
};

function normalizeEvent(value: unknown) {
  const event = String(value || "").trim().slice(0, 40);
  return allowedEvents.has(event) ? event : "";
}

function normalizeReason(value: unknown) {
  const reason = String(value || "").trim().slice(0, 60);
  return allowedReasons.has(reason) ? reason : "";
}

export function isCloudKitPushEventPair(eventValue: unknown, reasonValue: unknown) {
  const event = normalizeEvent(eventValue);
  const reason = normalizeReason(reasonValue);
  return Boolean(event && reason && eventReasons.get(event)?.has(reason));
}

function normalizeEvidence(value: any): CloudKitPushEvidence {
  const listenerReadyAt = Number(value?.listenerReadyAt || 0);
  const lastEventAt = Number(value?.lastEventAt || 0);
  const lastRemoteChangeAt = Number(value?.lastRemoteChangeAt || 0);
  const receivedRemoteChanges = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value?.receivedRemoteChanges || 0))));
  const lastEvent = normalizeEvent(value?.lastEvent);
  const lastReason = normalizeReason(value?.lastReason);
  return {
    listenerReadyAt: listenerReadyAt > 0 ? listenerReadyAt : undefined,
    lastEventAt: lastEventAt > 0 ? lastEventAt : undefined,
    lastRemoteChangeAt: lastRemoteChangeAt > 0 ? lastRemoteChangeAt : undefined,
    lastEvent: lastEvent || undefined,
    lastReason: lastReason || undefined,
    receivedRemoteChanges,
    deliveryVerified: receivedRemoteChanges > 0 && Boolean(value?.subscriptionMatched),
    subscriptionMatched: Boolean(value?.subscriptionMatched),
    updatedAt: Number(value?.updatedAt || 0) > 0 ? Number(value.updatedAt) : 0,
    rawPayloadStored: false,
    deviceTokenStored: false,
    cloudKitChangeTokenStored: false,
  };
}

export function getCloudKitPushEvidence() {
  return normalizeEvidence(getClientState(CLOUDKIT_PUSH_EVIDENCE_KEY)?.value);
}

export function recordCloudKitPushEvent(
  input: CloudKitPushEventInput,
  actor: { type: string; id: string } = { type: "system", id: "desktop-cloudkit-listener" },
  now = Date.now(),
) {
  const event = normalizeEvent(input.event);
  const reason = normalizeReason(input.reason);
  if (!event || !reason || !isCloudKitPushEventPair(event, reason)) throw new Error("CloudKit push event did not match the LifeOS listener contract.");
  const previous = getCloudKitPushEvidence();
  const isRemoteChange = event === "remote-change" && Boolean(input.subscriptionMatched);
  const next: CloudKitPushEvidence = {
    ...previous,
    listenerReadyAt: event === "listener-ready" ? now : previous.listenerReadyAt,
    lastEventAt: now,
    lastRemoteChangeAt: isRemoteChange ? now : previous.lastRemoteChangeAt,
    lastEvent: event,
    lastReason: reason,
    receivedRemoteChanges: isRemoteChange
      ? Math.min(Number.MAX_SAFE_INTEGER, previous.receivedRemoteChanges + 1)
      : previous.receivedRemoteChanges,
    deliveryVerified: isRemoteChange || previous.deliveryVerified,
    subscriptionMatched: isRemoteChange || previous.subscriptionMatched,
    updatedAt: now,
    rawPayloadStored: false,
    deviceTokenStored: false,
    cloudKitChangeTokenStored: false,
  };
  setClientState(CLOUDKIT_PUSH_EVIDENCE_KEY, next, actor);
  insertAuditLog("icloud_cloudkit_push_event", "network", "cloudkit-push-listener", {
    event,
    reason,
    subscriptionMatched: Boolean(input.subscriptionMatched),
    deliveryVerified: next.deliveryVerified,
    receivedRemoteChanges: next.receivedRemoteChanges,
    rawPayloadStored: false,
    deviceTokenStored: false,
    cloudKitChangeTokenStored: false,
  }, actor.type, actor.id);
  return next;
}
