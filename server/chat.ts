import crypto from "crypto";
import { db } from "./db";

export type ChatMessageSyncMetadata = {
  mutationId?: string;
  idempotencyKey?: string;
  clientSequence?: number;
  sourceVersion?: number;
  queuedAt?: number;
};

export function createChatSession(title?: string) {
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(),
    title: title?.trim()?.slice(0, 120) || "New Chat",
    createdAt: now,
    updatedAt: now,
  };

  db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(session.id, session.title, session.createdAt, session.updatedAt);
  return session;
}

export function getChatSessions() {
  return db.prepare(`
    SELECT id, title, created_at as createdAt, updated_at as updatedAt
    FROM chat_sessions
    ORDER BY updated_at DESC
  `).all();
}

export function getChatSession(sessionId: string) {
  return db.prepare(`
    SELECT id, title, created_at as createdAt, updated_at as updatedAt
    FROM chat_sessions
    WHERE id = ?
  `).get(sessionId);
}

function sanitizeSyncText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || null;
}

function normalizeMessageSyncMetadata(metadata: unknown): ChatMessageSyncMetadata {
  if (!metadata || typeof metadata !== "object") return {};
  const value = metadata as Record<string, unknown>;
  return {
    mutationId: sanitizeSyncText(value.mutationId, 120) || undefined,
    idempotencyKey: sanitizeSyncText(value.idempotencyKey, 240) || undefined,
    clientSequence: Number.isFinite(value.clientSequence) ? Number(value.clientSequence) : undefined,
    sourceVersion: Number.isFinite(value.sourceVersion) ? Number(value.sourceVersion) : undefined,
    queuedAt: Number.isFinite(value.queuedAt) ? Number(value.queuedAt) : undefined,
  };
}

function mapMessageRow(row: any) {
  return {
    ...row,
    contentJson: JSON.parse(row.contentJson),
  };
}

function getMessageByIdempotencyKey(sessionId: string, idempotencyKey?: string | null) {
  if (!idempotencyKey) return null;
  const row = db.prepare(`
    SELECT id, session_id as sessionId, role, content_json as contentJson, source_device_id as sourceDeviceId,
           offline_mutation_id as offlineMutationId, idempotency_key as idempotencyKey,
           client_sequence as clientSequence, source_version as sourceVersion, queued_at as queuedAt,
           created_at as createdAt
    FROM messages
    WHERE session_id = ? AND idempotency_key = ?
  `).get(sessionId, idempotencyKey);
  return row ? mapMessageRow(row) : null;
}

export function getExistingMessageForSyncMetadata(sessionId: string, metadata?: ChatMessageSyncMetadata) {
  const syncMetadata = normalizeMessageSyncMetadata(metadata);
  return getMessageByIdempotencyKey(sessionId, syncMetadata.idempotencyKey);
}

export function insertMessage(sessionId: string, role: string, contentJson: unknown, sourceDeviceId?: string, metadata?: ChatMessageSyncMetadata) {
  const now = Date.now();
  const syncMetadata = normalizeMessageSyncMetadata(metadata);
  const existing = getMessageByIdempotencyKey(sessionId, syncMetadata.idempotencyKey);
  if (existing) return existing;

  const message = {
    id: crypto.randomUUID(),
    sessionId,
    role,
    contentJson,
    sourceDeviceId,
    offlineMutationId: syncMetadata.mutationId || null,
    idempotencyKey: syncMetadata.idempotencyKey || null,
    clientSequence: syncMetadata.clientSequence ?? null,
    sourceVersion: syncMetadata.sourceVersion ?? null,
    queuedAt: syncMetadata.queuedAt ?? null,
    createdAt: now,
  };

  db.prepare(`
    INSERT INTO messages (
      id, session_id, role, content_json, source_device_id,
      offline_mutation_id, idempotency_key, client_sequence, source_version, queued_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    sessionId,
    role,
    JSON.stringify(contentJson),
    sourceDeviceId || null,
    message.offlineMutationId,
    message.idempotencyKey,
    message.clientSequence,
    message.sourceVersion,
    message.queuedAt,
    now,
  );
  db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
  return message;
}

export function getMessages(sessionId: string) {
  return db.prepare(`
    SELECT id, session_id as sessionId, role, content_json as contentJson, source_device_id as sourceDeviceId,
           offline_mutation_id as offlineMutationId, idempotency_key as idempotencyKey,
           client_sequence as clientSequence, source_version as sourceVersion, queued_at as queuedAt,
           created_at as createdAt
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId).map(mapMessageRow);
}
