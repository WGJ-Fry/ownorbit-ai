import crypto from "crypto";
import {
  CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
  CLOUDKIT_SYNC_EXPORT_SCHEMA,
  type CloudKitSyncExportPackage,
} from "./cloudKitSyncBatch";
import { listCloudKitChatResponsePayloads } from "./cloudKitChatJobs";
import {
  cloudKitChatClaimRecordName,
  cloudKitChatReceiptRecordName,
  cloudKitChatRequestRecordName,
  cloudKitChatResponseRecordName,
} from "./cloudKitChatProtocol";
import {
  listDueCloudKitChatRemoteCleanup,
} from "./cloudKitChatLifecycle";
import {
  CLOUDKIT_CHAT_RELAY_CONTROL_ZONE,
  CLOUDKIT_CHAT_RELAY_ZONE,
} from "./cloudKitChatRelayConfig";

function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildCloudKitChatRelayExportPackage(options: { limit?: number; now?: Date } = {}) {
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 20)));
  const generatedAt = (options.now || new Date()).toISOString();
  const cleanupRequests = listDueCloudKitChatRemoteCleanup({
    limit,
    now: (options.now || new Date()).getTime(),
  });
  const records = listCloudKitChatResponsePayloads(limit).map((payload) => {
    const payloadJson = JSON.stringify(payload);
    return {
      zone: CLOUDKIT_CHAT_RELAY_ZONE,
      recordType: "LifeOSChatResponse",
      recordName: cloudKitChatResponseRecordName(payload.requestId),
      mutationId: `mac-chat-response:${payload.requestId}`,
      contentHash: sha256(payloadJson),
      fields: {
        lifeosSchema: "lifeos-cloudkit-record.v1",
        lifeosDataType: "chat-relay",
        lifeosRecordType: "LifeOSChatResponse",
        lifeosRecordName: cloudKitChatResponseRecordName(payload.requestId),
        sourceIdHash: `chat-relay:${sha256(payload.requestId).slice(0, 16)}`,
        mutationId: `mac-chat-response:${payload.requestId}`,
        logicalClock: payload.updatedAt,
        contentHash: sha256(payloadJson),
        payloadJson,
        payloadByteSize: Buffer.byteLength(payloadJson, "utf8"),
        requiresUserReview: false,
      },
    };
  });
  const deletions = cleanupRequests.flatMap(({ requestId }) => [
    {
      zone: CLOUDKIT_CHAT_RELAY_ZONE,
      recordType: "LifeOSChatRequest",
      recordName: cloudKitChatRequestRecordName(requestId),
    },
    {
      zone: CLOUDKIT_CHAT_RELAY_ZONE,
      recordType: "LifeOSChatResponse",
      recordName: cloudKitChatResponseRecordName(requestId),
    },
    {
      zone: CLOUDKIT_CHAT_RELAY_ZONE,
      recordType: "LifeOSChatReceipt",
      recordName: cloudKitChatReceiptRecordName(requestId),
    },
    {
      zone: CLOUDKIT_CHAT_RELAY_CONTROL_ZONE,
      recordType: "LifeOSChatClaim",
      recordName: cloudKitChatClaimRecordName(requestId),
    },
  ]);
  const recordPlanHash = sha256(JSON.stringify([
    ...records.map((record) => [
      "save",
      record.zone,
      record.recordType,
      record.recordName,
      record.contentHash,
    ]),
    ...deletions.map((record) => [
      "delete",
      record.zone,
      record.recordType,
      record.recordName,
    ]),
  ])).slice(0, 32);
  const zoneCounts = new Map<string, number>();
  for (const record of records) {
    zoneCounts.set(record.zone, (zoneCounts.get(record.zone) || 0) + 1);
  }
  for (const deletion of deletions) {
    zoneCounts.set(deletion.zone, (zoneCounts.get(deletion.zone) || 0) + 1);
  }
  const helperSyncBatch: CloudKitSyncExportPackage["helperSyncBatch"] = {
    schema: CLOUDKIT_SYNC_EXPORT_SCHEMA,
    confirmation: CLOUDKIT_SYNC_EXPORT_CONFIRMATION,
    recordPlanHash,
    generatedAt,
    records,
    deletions,
    zones: Array.from(zoneCounts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([zone, count]) => ({ zone, records: count })),
  };
  return {
    ok: records.length > 0 || deletions.length > 0,
    status: records.length > 0 || deletions.length > 0 ? "ready" as const : "empty" as const,
    generatedAt,
    requestId: `ownorbit-cloudkit-chat-relay-${recordPlanHash}`,
    helperSyncBatch,
    deliveryReceipts: records.map((record) => {
      const payload = JSON.parse(record.fields.payloadJson) as { requestId: string; updatedAt: number };
      return { requestId: payload.requestId, updatedAt: payload.updatedAt, contentHash: record.contentHash };
    }),
    cleanupReceipts: cleanupRequests.map((item) => ({ requestId: item.requestId })),
    recordCount: records.length,
    deletionCount: deletions.length,
    safety: {
      uploadsLocalHistory: false,
      uploadsMemory: false,
      uploadsTasks: false,
      uploadsGeneratedApps: false,
      uploadsOnlyMatchingResponses: true,
      deletesOnlyConsumedRelayRecords: true,
      rawPayloadReturnedToAdmin: false,
    },
  };
}

export type CloudKitChatRelayExportPackage = ReturnType<typeof buildCloudKitChatRelayExportPackage>;
