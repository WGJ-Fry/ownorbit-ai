import type { DatabaseSync } from "node:sqlite";
import { insertAuditLog } from "./audit";
import { db } from "./db";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_JOB_RETENTION_DAYS = 30;
const DEFAULT_QUARANTINE_RETENTION_DAYS = 30;
const DEFAULT_CONVERSATION_RETENTION_DAYS = 90;
const DEFAULT_SEQUENCE_RETENTION_DAYS = 31;
const SCHEDULER_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000;

let schedulerTimer: NodeJS.Timeout | undefined;
let schedulerStartupTimer: NodeJS.Timeout | undefined;
let schedulerStarted = false;

function positiveDays(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.floor(number), 3650) : fallback;
}

function changes(result: unknown) {
  return Number((result as { changes?: number } | undefined)?.changes || 0);
}

export type CloudKitChatLifecycleResult = {
  jobsDeleted: number;
  remoteCleanupDeleted: number;
  sequencesDeleted: number;
  quarantineDeleted: number;
  leasesDeleted: number;
  conversationOwnersDeleted: number;
  cleanedAt: number;
};

export function queueCloudKitChatRemoteCleanup(
  requestId: string,
  options: { database?: DatabaseSync; now?: number } = {},
) {
  const database = options.database || db;
  const now = options.now ?? Date.now();
  database.prepare(`
    INSERT INTO cloudkit_chat_remote_cleanup (
      request_id, status, attempt_count, next_attempt_at, created_at, completed_at, last_error
    ) VALUES (?, 'queued', 0, ?, ?, NULL, NULL)
    ON CONFLICT(request_id) DO UPDATE SET
      status = CASE WHEN cloudkit_chat_remote_cleanup.status = 'completed' THEN 'completed' ELSE 'queued' END,
      next_attempt_at = CASE
        WHEN cloudkit_chat_remote_cleanup.status = 'completed' THEN cloudkit_chat_remote_cleanup.next_attempt_at
        ELSE MIN(cloudkit_chat_remote_cleanup.next_attempt_at, excluded.next_attempt_at)
      END,
      last_error = CASE WHEN cloudkit_chat_remote_cleanup.status = 'completed' THEN cloudkit_chat_remote_cleanup.last_error ELSE NULL END
  `).run(requestId, now, now);
}

export function listDueCloudKitChatRemoteCleanup(
  options: { database?: DatabaseSync; now?: number; limit?: number } = {},
) {
  const database = options.database || db;
  const now = options.now ?? Date.now();
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 20)));
  const rows = database.prepare(`
    SELECT request_id as requestId, attempt_count as attemptCount
    FROM cloudkit_chat_remote_cleanup
    WHERE status = 'queued' AND next_attempt_at <= ?
    ORDER BY created_at ASC, request_id ASC
    LIMIT ?
  `).all(now, limit) as Array<{ requestId: string; attemptCount: number }>;
  return rows.map((row) => ({
    requestId: String(row.requestId),
    attemptCount: Number(row.attemptCount),
  }));
}

export function markCloudKitChatRemoteCleanupCompleted(
  requestIds: string[],
  options: { database?: DatabaseSync; now?: number } = {},
) {
  const database = options.database || db;
  const now = options.now ?? Date.now();
  const update = database.prepare(`
    UPDATE cloudkit_chat_remote_cleanup
    SET status = 'completed', completed_at = ?, last_error = NULL
    WHERE request_id = ? AND status = 'queued'
  `);
  let marked = 0;
  for (const requestId of Array.from(new Set(requestIds))) {
    marked += changes(update.run(now, requestId));
  }
  return { marked };
}

export function markCloudKitChatRemoteCleanupFailed(
  requestIds: string[],
  error: unknown,
  options: { database?: DatabaseSync; now?: number } = {},
) {
  const database = options.database || db;
  const now = options.now ?? Date.now();
  const safeError = String(error || "CloudKit remote cleanup failed").replace(/\s+/g, " ").slice(0, 240);
  const update = database.prepare(`
    UPDATE cloudkit_chat_remote_cleanup
    SET attempt_count = attempt_count + 1,
        next_attempt_at = ? + MIN(3600000, 30000 * (1 << MIN(6, attempt_count))),
        last_error = ?
    WHERE request_id = ? AND status = 'queued'
  `);
  let marked = 0;
  for (const requestId of Array.from(new Set(requestIds))) {
    marked += changes(update.run(now, safeError, requestId));
  }
  return { marked };
}

export function cleanupCloudKitChatLifecycle(options: {
  database?: DatabaseSync;
  now?: number;
  jobRetentionDays?: number;
  quarantineRetentionDays?: number;
  conversationRetentionDays?: number;
  sequenceRetentionDays?: number;
} = {}): CloudKitChatLifecycleResult {
  const database = options.database || db;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const jobCutoff = now - positiveDays(options.jobRetentionDays, DEFAULT_JOB_RETENTION_DAYS) * DAY_MS;
  const quarantineCutoff = now - positiveDays(options.quarantineRetentionDays, DEFAULT_QUARANTINE_RETENTION_DAYS) * DAY_MS;
  const conversationCutoff = now - positiveDays(options.conversationRetentionDays, DEFAULT_CONVERSATION_RETENTION_DAYS) * DAY_MS;
  const sequenceCutoff = now - positiveDays(options.sequenceRetentionDays, DEFAULT_SEQUENCE_RETENTION_DAYS) * DAY_MS;

  database.exec("BEGIN IMMEDIATE");
  try {
    // Lease rows retain their monotonic fencing token across restarts.
    const leasesDeleted = 0;
    const sequencesDeleted = changes(database.prepare(`
      DELETE FROM cloudkit_chat_device_sequences
      WHERE created_at < ?
    `).run(sequenceCutoff));
    const jobsDeleted = changes(database.prepare(`
      DELETE FROM cloudkit_chat_jobs
      WHERE status IN ('completed', 'failed', 'expired')
        AND response_consumed_at IS NOT NULL
        AND updated_at < ?
        AND EXISTS (
          SELECT 1
          FROM cloudkit_chat_remote_cleanup
          WHERE cloudkit_chat_remote_cleanup.request_id = cloudkit_chat_jobs.request_id
            AND cloudkit_chat_remote_cleanup.status = 'completed'
        )
    `).run(jobCutoff));
    const remoteCleanupDeleted = changes(database.prepare(`
      DELETE FROM cloudkit_chat_remote_cleanup
      WHERE status = 'completed'
        AND completed_at IS NOT NULL
        AND completed_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM cloudkit_chat_jobs
          WHERE cloudkit_chat_jobs.request_id = cloudkit_chat_remote_cleanup.request_id
        )
    `).run(jobCutoff));
    const quarantineDeleted = changes(database.prepare(`
      DELETE FROM cloudkit_sync_quarantine
      WHERE zone = 'LifeOSChatRelayZone'
        AND status = 'applied'
        AND imported_at < ?
    `).run(quarantineCutoff));
    const conversationOwnersDeleted = changes(database.prepare(`
      DELETE FROM cloudkit_chat_conversation_owners
      WHERE last_seen_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM cloudkit_chat_jobs
          WHERE cloudkit_chat_jobs.conversation_id = cloudkit_chat_conversation_owners.conversation_id
        )
    `).run(conversationCutoff));
    database.exec("COMMIT");
    return {
      jobsDeleted,
      remoteCleanupDeleted,
      sequencesDeleted,
      quarantineDeleted,
      leasesDeleted,
      conversationOwnersDeleted,
      cleanedAt: now,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function runCloudKitChatLifecycleCleanup(now = Date.now()) {
  const result = cleanupCloudKitChatLifecycle({ now });
  const removed = result.jobsDeleted
    + result.remoteCleanupDeleted
    + result.sequencesDeleted
    + result.quarantineDeleted
    + result.leasesDeleted
    + result.conversationOwnersDeleted;
  if (removed > 0) {
    insertAuditLog("icloud_chat_relay_lifecycle_cleaned", "database", "cloudkit-chat-relay", {
      jobsDeleted: result.jobsDeleted,
      remoteCleanupDeleted: result.remoteCleanupDeleted,
      sequencesDeleted: result.sequencesDeleted,
      quarantineDeleted: result.quarantineDeleted,
      leasesDeleted: result.leasesDeleted,
      conversationOwnersDeleted: result.conversationOwnersDeleted,
      retention: {
        jobsDays: DEFAULT_JOB_RETENTION_DAYS,
        quarantineDays: DEFAULT_QUARANTINE_RETENTION_DAYS,
        conversationOwnersDays: DEFAULT_CONVERSATION_RETENTION_DAYS,
        sequencesDays: DEFAULT_SEQUENCE_RETENTION_DAYS,
      },
    }, "system", "cloudkit-chat-lifecycle");
  }
  return result;
}

export function startCloudKitChatLifecycleScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerStartupTimer = setTimeout(() => {
    schedulerStartupTimer = undefined;
    try {
      runCloudKitChatLifecycleCleanup();
    } catch (error) {
      insertAuditLog("icloud_chat_relay_lifecycle_failed", "database", "cloudkit-chat-relay", {
        error: error instanceof Error ? error.message : String(error),
      }, "system", "cloudkit-chat-lifecycle");
    }
  }, STARTUP_DELAY_MS);
  schedulerStartupTimer.unref?.();
  schedulerTimer = setInterval(() => {
    try {
      runCloudKitChatLifecycleCleanup();
    } catch (error) {
      insertAuditLog("icloud_chat_relay_lifecycle_failed", "database", "cloudkit-chat-relay", {
        error: error instanceof Error ? error.message : String(error),
      }, "system", "cloudkit-chat-lifecycle");
    }
  }, SCHEDULER_INTERVAL_MS);
  schedulerTimer.unref?.();
}

export function stopCloudKitChatLifecycleSchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (schedulerStartupTimer) clearTimeout(schedulerStartupTimer);
  schedulerTimer = undefined;
  schedulerStartupTimer = undefined;
  schedulerStarted = false;
}
