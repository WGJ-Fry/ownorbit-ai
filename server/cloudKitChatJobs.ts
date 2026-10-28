import crypto from "crypto";
import { db } from "./db";
import {
  assertCloudKitChatJobTransition,
  cloudKitChatResponseId,
  parseCloudKitChatResponsePayload,
  type CloudKitChatJobStatus,
  type CloudKitChatRequestPayload,
  type CloudKitChatResponsePayload,
  type CloudKitChatUnsignedResponsePayload,
} from "./cloudKitChatProtocol";
import { signCloudKitChatResponse } from "./cloudKitMacIdentity";

const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_ACTIVE_REQUESTS_PER_DEVICE = 50;
const MAX_DAILY_REQUESTS_PER_DEVICE = 500;
const DEVICE_SEQUENCE_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;

type ChatJobRow = {
  requestId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId?: string | null;
  sourceDeviceHash: string;
  trustedMacFingerprint?: string | null;
  requestRecordName: string;
  requestContentHash: string;
  locale: "zh-CN" | "en-US";
  status: CloudKitChatJobStatus;
  attemptCount: number;
  nextAttemptAt?: number | null;
  leaseId?: string | null;
  leaseExpiresAt?: number | null;
  expiresAt: number;
  responseId: string;
  safeErrorCode?: string | null;
  providerLabel?: string | null;
  modelLabel?: string | null;
  createdAt: number;
  importedAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  responseExportedUpdatedAt?: number | null;
  responseExportedAt?: number | null;
  responseExportedContentHash?: string | null;
  responseConsumedAt?: number | null;
  updatedAt: number;
};

export type ClaimedCloudKitChatJob = ChatJobRow & {
  leaseId: string;
  prompt: string;
};

function mapJob(row: any): ChatJobRow {
  return {
    requestId: row.requestId,
    conversationId: row.conversationId,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId || undefined,
    sourceDeviceHash: row.sourceDeviceHash,
    trustedMacFingerprint: row.trustedMacFingerprint || undefined,
    requestRecordName: row.requestRecordName,
    requestContentHash: row.requestContentHash,
    locale: row.locale === "en-US" ? "en-US" : "zh-CN",
    status: row.status,
    attemptCount: Number(row.attemptCount || 0),
    nextAttemptAt: row.nextAttemptAt || undefined,
    leaseId: row.leaseId || undefined,
    leaseExpiresAt: row.leaseExpiresAt || undefined,
    expiresAt: Number(row.expiresAt || 0),
    responseId: row.responseId,
    safeErrorCode: row.safeErrorCode || undefined,
    providerLabel: row.providerLabel || undefined,
    modelLabel: row.modelLabel || undefined,
    createdAt: Number(row.createdAt || 0),
    importedAt: Number(row.importedAt || 0),
    startedAt: row.startedAt || undefined,
    completedAt: row.completedAt || undefined,
    responseExportedUpdatedAt: row.responseExportedUpdatedAt || undefined,
    responseExportedAt: row.responseExportedAt || undefined,
    responseExportedContentHash: row.responseExportedContentHash || undefined,
    responseConsumedAt: row.responseConsumedAt || undefined,
    updatedAt: Number(row.updatedAt || 0),
  };
}

const selectJobSql = `
  SELECT request_id as requestId, conversation_id as conversationId,
         user_message_id as userMessageId, assistant_message_id as assistantMessageId,
         source_device_hash as sourceDeviceHash, trusted_mac_fingerprint as trustedMacFingerprint,
         request_record_name as requestRecordName,
         request_content_hash as requestContentHash, locale, status,
         attempt_count as attemptCount, next_attempt_at as nextAttemptAt,
         lease_id as leaseId, lease_expires_at as leaseExpiresAt,
         expires_at as expiresAt, response_id as responseId,
         safe_error_code as safeErrorCode, provider_label as providerLabel,
         model_label as modelLabel, created_at as createdAt, imported_at as importedAt,
         started_at as startedAt, completed_at as completedAt,
         response_exported_updated_at as responseExportedUpdatedAt,
         response_exported_at as responseExportedAt,
         response_exported_content_hash as responseExportedContentHash,
         response_consumed_at as responseConsumedAt,
         updated_at as updatedAt
  FROM cloudkit_chat_jobs
`;

function parseMessageText(contentJson: string) {
  try {
    const value = JSON.parse(contentJson);
    const parts = Array.isArray(value?.parts) ? value.parts : [];
    return parts.map((part: any) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n").trim();
  } catch {
    return "";
  }
}

function canonicalMessage(prompt: string) {
  return JSON.stringify({ parts: [{ text: prompt }] });
}

function ensureConversationOwnership(payload: CloudKitChatRequestPayload, now: number) {
  const existing = db.prepare(`
    SELECT source_device_hash as sourceDeviceHash
    FROM cloudkit_chat_conversation_owners
    WHERE conversation_id = ?
  `).get(payload.conversationId) as { sourceDeviceHash?: string } | undefined;
  if (existing) {
    if (existing.sourceDeviceHash !== payload.sourceDeviceHash) {
      throw new Error("CloudKit chat conversation belongs to another device.");
    }
    db.prepare(`
      UPDATE cloudkit_chat_conversation_owners
      SET last_seen_at = MAX(last_seen_at, ?)
      WHERE conversation_id = ? AND source_device_hash = ?
    `).run(now, payload.conversationId, payload.sourceDeviceHash);
    return;
  }
  const localConversation = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(payload.conversationId);
  if (localConversation) {
    throw new Error("CloudKit chat conversation conflicts with an existing local conversation.");
  }
  db.prepare(`
    INSERT INTO cloudkit_chat_conversation_owners (
      conversation_id, source_device_hash, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?)
  `).run(payload.conversationId, payload.sourceDeviceHash, now, now);
}

function ensureConversation(payload: CloudKitChatRequestPayload) {
  const existing = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(payload.conversationId);
  if (existing) return;
  db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(payload.conversationId, payload.locale === "en-US" ? "iPhone chat" : "iPhone 对话", payload.createdAt, payload.createdAt);
}

function ensureUserMessage(payload: CloudKitChatRequestPayload) {
  const contentJson = canonicalMessage(payload.prompt);
  const existing = db.prepare("SELECT session_id as sessionId, role, content_json as contentJson FROM messages WHERE id = ?")
    .get(payload.userMessageId) as { sessionId?: string; role?: string; contentJson?: string } | undefined;
  if (existing) {
    if (existing.sessionId !== payload.conversationId || existing.role !== "user" || existing.contentJson !== contentJson) {
      throw new Error("CloudKit chat request message id conflicts with existing local content.");
    }
    return;
  }
  db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content_json, source_device_id,
      offline_mutation_id, idempotency_key, client_sequence, source_version, queued_at, created_at
    ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.userMessageId,
    payload.conversationId,
    contentJson,
    `icloud:${payload.sourceDeviceHash.slice(0, 16)}`,
    `ios-chat-request:${payload.requestId}`,
    `cloudkit-chat-request:${payload.requestId}`,
    payload.clientSequence,
    payload.createdAt,
    payload.createdAt,
    payload.createdAt,
  );
  db.prepare("UPDATE chat_sessions SET updated_at = MAX(updated_at, ?) WHERE id = ?")
    .run(payload.createdAt, payload.conversationId);
}

function reserveDeviceSequence(payload: CloudKitChatRequestPayload, now: number) {
  db.prepare("DELETE FROM cloudkit_chat_device_sequences WHERE created_at < ?")
    .run(now - DEVICE_SEQUENCE_RETENTION_MS);
  const existingSequence = db.prepare(`
    SELECT request_id as requestId
    FROM cloudkit_chat_device_sequences
    WHERE source_device_hash = ? AND client_sequence = ?
  `).get(payload.sourceDeviceHash, payload.clientSequence) as { requestId?: string } | undefined;
  if (existingSequence && existingSequence.requestId !== payload.requestId) {
    throw new Error("CloudKit chat request sequence was already used by this device.");
  }
  const active = db.prepare(`
    SELECT COUNT(*) as count
    FROM cloudkit_chat_jobs
    WHERE source_device_hash = ? AND status IN ('queued', 'processing')
  `).get(payload.sourceDeviceHash) as { count?: number } | undefined;
  if (Number(active?.count || 0) >= MAX_ACTIVE_REQUESTS_PER_DEVICE) {
    throw new Error("CloudKit chat device has too many active requests.");
  }
  const daily = db.prepare(`
    SELECT COUNT(*) as count
    FROM cloudkit_chat_device_sequences
    WHERE source_device_hash = ? AND created_at >= ?
  `).get(payload.sourceDeviceHash, now - 24 * 60 * 60 * 1000) as { count?: number } | undefined;
  if (Number(daily?.count || 0) >= MAX_DAILY_REQUESTS_PER_DEVICE) {
    throw new Error("CloudKit chat device reached its daily request limit.");
  }
  if (!existingSequence) {
    db.prepare(`
      INSERT INTO cloudkit_chat_device_sequences (
        source_device_hash, client_sequence, request_id, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(payload.sourceDeviceHash, payload.clientSequence, payload.requestId, now);
  }
}

export function getCloudKitChatJob(requestId: string) {
  const row = db.prepare(`${selectJobSql} WHERE request_id = ?`).get(requestId);
  return row ? mapJob(row) : undefined;
}

export function enqueueCloudKitChatRequest(
  payload: CloudKitChatRequestPayload,
  metadata: { recordName: string; contentHash: string; importedAt?: number; now?: number },
) {
  const now = metadata.now ?? Date.now();
  const importedAt = metadata.importedAt ?? now;
  db.exec("SAVEPOINT cloudkit_chat_enqueue");
  try {
    const existing = getCloudKitChatJob(payload.requestId);
    if (existing) {
      if (
        existing.requestContentHash !== metadata.contentHash ||
        existing.requestRecordName !== metadata.recordName ||
        existing.conversationId !== payload.conversationId ||
        existing.userMessageId !== payload.userMessageId ||
        existing.sourceDeviceHash !== payload.sourceDeviceHash ||
        (existing.trustedMacFingerprint || undefined) !== payload.trustedMacFingerprint
      ) throw new Error("CloudKit chat request conflicts with an existing request id.");
      ensureConversationOwnership(payload, now);
      ensureConversation(payload);
      ensureUserMessage(payload);
      db.exec("RELEASE SAVEPOINT cloudkit_chat_enqueue");
      return { job: existing, created: false };
    }

    reserveDeviceSequence(payload, now);
    ensureConversationOwnership(payload, now);
    ensureConversation(payload);
    ensureUserMessage(payload);
    const status: CloudKitChatJobStatus = payload.expiresAt <= now ? "expired" : "queued";
    db.prepare(`
      INSERT INTO cloudkit_chat_jobs (
        request_id, conversation_id, user_message_id, source_device_hash, trusted_mac_fingerprint,
        request_record_name, request_content_hash, locale, status,
        attempt_count, expires_at, response_id, safe_error_code,
        created_at, imported_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.requestId,
      payload.conversationId,
      payload.userMessageId,
      payload.sourceDeviceHash,
      payload.trustedMacFingerprint || null,
      metadata.recordName,
      metadata.contentHash,
      payload.locale,
      status,
      payload.expiresAt,
      cloudKitChatResponseId(payload.requestId),
      status === "expired" ? "request-expired" : null,
      payload.createdAt,
      importedAt,
      status === "expired" ? now : null,
      now,
    );
    const job = getCloudKitChatJob(payload.requestId)!;
    db.exec("RELEASE SAVEPOINT cloudkit_chat_enqueue");
    return { job, created: true };
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT cloudkit_chat_enqueue");
    db.exec("RELEASE SAVEPOINT cloudkit_chat_enqueue");
    throw error;
  }
}

function expireAndRecoverJobs(now: number) {
  db.prepare(`
    UPDATE cloudkit_chat_jobs
    SET status = 'expired', safe_error_code = 'request-expired',
        lease_id = NULL, lease_expires_at = NULL, completed_at = ?, updated_at = ?
    WHERE status IN ('queued', 'processing', 'failed') AND expires_at <= ?
  `).run(now, now, now);
  db.prepare(`
    UPDATE cloudkit_chat_jobs
    SET status = 'queued', lease_id = NULL, lease_expires_at = NULL,
        next_attempt_at = ?, safe_error_code = 'worker-interrupted', updated_at = ?
    WHERE status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND expires_at > ?
  `).run(now, now, now, now);
}

export function hasDueCloudKitChatJob(now = Date.now()) {
  expireAndRecoverJobs(now);
  const row = db.prepare(`
    SELECT 1 as found
    FROM cloudkit_chat_jobs
    WHERE status = 'queued' AND expires_at > ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    LIMIT 1
  `).get(now, now) as { found?: number } | undefined;
  return row?.found === 1;
}

export function getNextCloudKitChatJobForRelayClaim(options: { now?: number; trustedMacFingerprint?: string } = {}) {
  const now = options.now ?? Date.now();
  const trustedMacFingerprint = String(options.trustedMacFingerprint || "").trim().toLowerCase();
  if (trustedMacFingerprint && !/^[a-f0-9]{64}$/.test(trustedMacFingerprint)) {
    throw new Error("CloudKit relay Mac fingerprint is invalid.");
  }
  expireAndRecoverJobs(now);
  const row = db.prepare(`
    ${selectJobSql}
    WHERE status = 'queued' AND expires_at > ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (trusted_mac_fingerprint IS NULL OR trusted_mac_fingerprint = ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(now, now, trustedMacFingerprint || null);
  return row ? mapJob(row) : undefined;
}

export function claimNextCloudKitChatJob(options: { now?: number; leaseMs?: number; requestId?: string } = {}): ClaimedCloudKitChatJob | undefined {
  const now = options.now ?? Date.now();
  const leaseMs = Math.min(10 * 60 * 1000, Math.max(30_000, options.leaseMs ?? DEFAULT_LEASE_MS));
  const leaseId = crypto.randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    expireAndRecoverJobs(now);
    const candidate = options.requestId
      ? db.prepare(`
        ${selectJobSql}
        WHERE request_id = ? AND status = 'queued' AND expires_at > ?
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        LIMIT 1
      `).get(options.requestId, now, now) as any
      : db.prepare(`
      ${selectJobSql}
      WHERE status = 'queued' AND expires_at > ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT 1
    `).get(now, now) as any;
    if (!candidate) {
      db.exec("COMMIT");
      return undefined;
    }
    assertCloudKitChatJobTransition(candidate.status, "processing");
    const changes = (db.prepare(`
      UPDATE cloudkit_chat_jobs
      SET status = 'processing', attempt_count = attempt_count + 1,
          lease_id = ?, lease_expires_at = ?, next_attempt_at = NULL,
          safe_error_code = NULL, started_at = COALESCE(started_at, ?), updated_at = ?
      WHERE request_id = ? AND status = 'queued'
    `).run(leaseId, now + leaseMs, now, now, candidate.requestId) as any).changes;
    if (changes !== 1) throw new Error("CloudKit chat request could not be leased.");
    const message = db.prepare("SELECT content_json as contentJson FROM messages WHERE id = ?").get(candidate.userMessageId) as { contentJson?: string } | undefined;
    const prompt = parseMessageText(message?.contentJson || "");
    if (!prompt) throw new Error("CloudKit chat request message is unavailable.");
    const claimed = getCloudKitChatJob(candidate.requestId)!;
    db.exec("COMMIT");
    return { ...claimed, leaseId, prompt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function requireLease(requestId: string, leaseId: string) {
  const job = getCloudKitChatJob(requestId);
  if (!job || job.status !== "processing" || job.leaseId !== leaseId) {
    throw new Error("CloudKit chat request lease is missing or stale.");
  }
  return job;
}

export function completeCloudKitChatJob(input: {
  requestId: string;
  leaseId: string;
  text: string;
  providerLabel: string;
  modelLabel: string;
  assistantMessageId?: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const job = requireLease(input.requestId, input.leaseId);
  assertCloudKitChatJobTransition(job.status, "completed");
  if (job.expiresAt <= now) throw new Error("CloudKit chat request expired before completion.");
  const text = input.text.trim().slice(0, 16_000);
  if (!text) throw new Error("CloudKit chat response is empty.");
  const assistantMessageId = (input.assistantMessageId || crypto.randomUUID()).toLowerCase();
  const validatedResponse = parseCloudKitChatResponsePayload({
    schemaVersion: 1,
    requestId: job.requestId,
    responseId: job.responseId,
    conversationId: job.conversationId,
    assistantMessageId,
    status: "completed",
    text,
    providerLabel: input.providerLabel,
    modelLabel: input.modelLabel,
    requestContentHash: job.requestContentHash,
    startedAt: job.startedAt,
    completedAt: now,
    updatedAt: now,
  }) as CloudKitChatUnsignedResponsePayload;
  const contentJson = canonicalMessage(validatedResponse.text!);
  const existingMessage = db.prepare("SELECT content_json as contentJson FROM messages WHERE id = ?").get(assistantMessageId) as { contentJson?: string } | undefined;
  if (existingMessage && existingMessage.contentJson !== contentJson) throw new Error("CloudKit chat response message id conflicts with local content.");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!existingMessage) {
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content_json, source_device_id, idempotency_key, source_version, created_at)
        VALUES (?, ?, 'assistant', ?, 'cloudkit-worker', ?, ?, ?)
      `).run(assistantMessageId, job.conversationId, contentJson, `cloudkit-chat-response:${job.requestId}`, now, now);
    }
    const changes = (db.prepare(`
      UPDATE cloudkit_chat_jobs
      SET status = 'completed', assistant_message_id = ?, provider_label = ?, model_label = ?,
          safe_error_code = NULL, lease_id = NULL, lease_expires_at = NULL,
          completed_at = ?, updated_at = ?
      WHERE request_id = ? AND status = 'processing' AND lease_id = ?
    `).run(
      assistantMessageId,
      validatedResponse.providerLabel,
      validatedResponse.modelLabel,
      now,
      now,
      job.requestId,
      input.leaseId,
    ) as any).changes;
    if (changes !== 1) throw new Error("CloudKit chat request lease changed before completion.");
    db.prepare("UPDATE chat_sessions SET updated_at = MAX(updated_at, ?) WHERE id = ?").run(now, job.conversationId);
    db.exec("COMMIT");
    return getCloudKitChatJob(job.requestId)!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function failCloudKitChatJob(input: {
  requestId: string;
  leaseId: string;
  safeErrorCode: string;
  retryable: boolean;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const job = requireLease(input.requestId, input.leaseId);
  const safeErrorCode = /^[a-z][a-z0-9-]{0,63}$/.test(input.safeErrorCode) ? input.safeErrorCode : "ai-request-failed";
  const canRetry = input.retryable && job.attemptCount < MAX_ATTEMPTS && job.expiresAt > now;
  const nextStatus: CloudKitChatJobStatus = canRetry ? "queued" : job.expiresAt <= now ? "expired" : "failed";
  assertCloudKitChatJobTransition(job.status, nextStatus);
  const retryDelay = Math.min(5 * 60 * 1000, 5_000 * 2 ** Math.max(0, job.attemptCount - 1));
  const changes = (db.prepare(`
    UPDATE cloudkit_chat_jobs
    SET status = ?, next_attempt_at = ?, lease_id = NULL, lease_expires_at = NULL,
        safe_error_code = ?, completed_at = ?, updated_at = ?
    WHERE request_id = ? AND status = 'processing' AND lease_id = ?
  `).run(
    nextStatus,
    canRetry ? now + retryDelay : null,
    nextStatus === "expired" ? "request-expired" : safeErrorCode,
    canRetry ? null : now,
    now,
    job.requestId,
    input.leaseId,
  ) as any).changes;
  if (changes !== 1) throw new Error("CloudKit chat request lease changed before failure handling.");
  return getCloudKitChatJob(job.requestId)!;
}

export function requeueCloudKitChatJobsAfterAiConfiguration(options: { now?: number } = {}) {
  const now = options.now ?? Date.now();
  expireAndRecoverJobs(now);
  const candidates = db.prepare(`
    ${selectJobSql}
    WHERE status = 'failed'
      AND safe_error_code = 'ai-not-configured'
      AND response_consumed_at IS NULL
      AND response_exported_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM cloudkit_chat_remote_cleanup
        WHERE cloudkit_chat_remote_cleanup.request_id = cloudkit_chat_jobs.request_id
      )
      AND attempt_count < ?
      AND expires_at > ?
    ORDER BY created_at ASC
    LIMIT 100
  `).all(MAX_ATTEMPTS, now) as any[];
  if (!candidates.length) return { requeued: 0, requestIds: [] as string[] };

  const update = db.prepare(`
    UPDATE cloudkit_chat_jobs
    SET status = 'queued', next_attempt_at = ?, safe_error_code = 'configuration-updated',
        completed_at = NULL, lease_id = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE request_id = ?
      AND status = 'failed'
      AND safe_error_code = 'ai-not-configured'
      AND response_consumed_at IS NULL
      AND response_exported_at IS NULL
      AND attempt_count < ?
      AND expires_at > ?
      AND NOT EXISTS (
        SELECT 1
        FROM cloudkit_chat_remote_cleanup
        WHERE cloudkit_chat_remote_cleanup.request_id = cloudkit_chat_jobs.request_id
      )
  `);
  const requestIds: string[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of candidates) {
      const job = mapJob(row);
      assertCloudKitChatJobTransition(job.status, "queued");
      if ((update.run(now, now, job.requestId, MAX_ATTEMPTS, now) as any).changes === 1) {
        requestIds.push(job.requestId);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { requeued: requestIds.length, requestIds };
}

export function listCloudKitChatResponsePayloads(limit = 100): CloudKitChatResponsePayload[] {
  const rows = db.prepare(`
    ${selectJobSql}
    WHERE (status IN ('processing', 'completed', 'failed', 'expired') OR (status = 'queued' AND attempt_count > 0))
      AND (response_exported_updated_at IS NULL OR response_exported_updated_at < updated_at)
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(Math.min(500, Math.max(1, limit))) as any[];
  return rows.map((row) => {
    const job = mapJob(row);
    let text: string | undefined;
    if (job.status === "completed" && job.assistantMessageId) {
      const message = db.prepare("SELECT content_json as contentJson FROM messages WHERE id = ?").get(job.assistantMessageId) as { contentJson?: string } | undefined;
      text = parseMessageText(message?.contentJson || "");
    }
    const responseStatus = job.status === "queued" ? "retrying" : job.status;
    const unsigned = parseCloudKitChatResponsePayload({
      schemaVersion: 1,
      requestId: job.requestId,
      responseId: job.responseId,
      conversationId: job.conversationId,
      ...(job.assistantMessageId ? { assistantMessageId: job.assistantMessageId } : {}),
      status: responseStatus,
      ...(text ? { text } : {}),
      ...(job.safeErrorCode ? { safeErrorCode: job.safeErrorCode } : {}),
      ...(job.providerLabel ? { providerLabel: job.providerLabel } : {}),
      ...(job.modelLabel ? { modelLabel: job.modelLabel } : {}),
      requestContentHash: job.requestContentHash,
      ...(job.startedAt ? { startedAt: job.startedAt } : {}),
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
      updatedAt: job.updatedAt,
    }) as CloudKitChatUnsignedResponsePayload;
    return parseCloudKitChatResponsePayload(
      signCloudKitChatResponse(unsigned),
      { requireMacSignature: true },
    ) as CloudKitChatResponsePayload;
  });
}

export function markCloudKitChatResponsesExported(
  deliveries: Array<{ requestId: string; updatedAt: number; contentHash: string }>,
  now = Date.now(),
) {
  const normalized = deliveries
    .filter((item) =>
      typeof item?.requestId === "string" &&
      Number.isSafeInteger(item?.updatedAt) &&
      item.updatedAt > 0 &&
      /^[a-f0-9]{64}$/i.test(String(item?.contentHash || "")),
    )
    .slice(0, 100);
  if (!normalized.length) return { marked: 0 };
  const update = db.prepare(`
    UPDATE cloudkit_chat_jobs
    SET response_exported_updated_at = ?, response_exported_at = ?,
        response_exported_content_hash = ?, response_consumed_at = NULL
    WHERE request_id = ? AND updated_at = ?
      AND (response_exported_updated_at IS NULL OR response_exported_updated_at < updated_at)
  `);
  let marked = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of normalized) {
      marked += Number((update.run(
        item.updatedAt,
        now,
        item.contentHash.toLowerCase(),
        item.requestId,
        item.updatedAt,
      ) as any)?.changes || 0);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { marked };
}
