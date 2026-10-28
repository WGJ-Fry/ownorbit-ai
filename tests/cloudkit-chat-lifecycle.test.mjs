import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  cleanupCloudKitChatLifecycle,
  listDueCloudKitChatRemoteCleanup,
  markCloudKitChatRemoteCleanupCompleted,
  markCloudKitChatRemoteCleanupFailed,
  queueCloudKitChatRemoteCleanup,
} from "../server/cloudKitChatLifecycle.ts";

function createLifecycleDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE cloudkit_chat_jobs (
      request_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      response_exported_at INTEGER,
      response_consumed_at INTEGER
    );
    CREATE TABLE cloudkit_chat_device_sequences (
      source_device_hash TEXT NOT NULL,
      client_sequence INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (source_device_hash, client_sequence)
    );
    CREATE TABLE cloudkit_sync_quarantine (
      id TEXT PRIMARY KEY,
      zone TEXT NOT NULL,
      status TEXT NOT NULL,
      imported_at INTEGER NOT NULL
    );
    CREATE TABLE cloudkit_chat_relay_leases (
      lease_name TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE cloudkit_chat_conversation_owners (
      conversation_id TEXT PRIMARY KEY,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE cloudkit_chat_remote_cleanup (
      request_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      next_attempt_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      last_error TEXT
    );
  `);
  return database;
}

test("relay lifecycle preserves completed replies until a verified mobile receipt exists", () => {
  const database = createLifecycleDatabase();
  const now = Date.UTC(2026, 6, 26);
  const old = now - 120 * 24 * 60 * 60 * 1000;
  const recent = now - 24 * 60 * 60 * 1000;
  const insertJob = database.prepare("INSERT INTO cloudkit_chat_jobs VALUES (?, ?, ?, ?, ?, ?)");
  insertJob.run("delivered", "old-conversation", "completed", old, old, old);
  insertJob.run("not-consumed", "kept-conversation", "completed", old, old, null);
  insertJob.run("not-exported", "kept-conversation-2", "completed", old, null, null);
  insertJob.run("failed", "failed-conversation", "failed", old, old, old);
  insertJob.run("expired", "expired-conversation", "expired", old, old, old);
  insertJob.run("queued", "live-conversation", "queued", old, null, null);
  insertJob.run("recent", "recent-conversation", "completed", recent, recent, recent);
  const insertCleanup = database.prepare(
    "INSERT INTO cloudkit_chat_remote_cleanup VALUES (?, ?, 0, ?, ?, ?, NULL)",
  );
  insertCleanup.run("delivered", "completed", old, old, old);
  insertCleanup.run("failed", "completed", old, old, old);
  insertCleanup.run("expired", "completed", old, old, old);
  insertCleanup.run("recent", "completed", recent, recent, recent);
  insertCleanup.run("not-consumed", "queued", old, old, null);
  database.prepare("INSERT INTO cloudkit_chat_device_sequences VALUES ('device', 1, 'delivered', ?)").run(old);
  database.prepare("INSERT INTO cloudkit_sync_quarantine VALUES ('applied-chat', 'LifeOSChatRelayZone', 'applied', ?)").run(old);
  database.prepare("INSERT INTO cloudkit_sync_quarantine VALUES ('manual-chat', 'LifeOSChatRelayZone', 'pending-review', ?)").run(old);
  database.prepare("INSERT INTO cloudkit_sync_quarantine VALUES ('other-zone', 'LifeOSDataZone', 'applied', ?)").run(old);
  database.prepare("INSERT INTO cloudkit_chat_relay_leases VALUES ('expired', ?)").run(now - 1);
  database.prepare("INSERT INTO cloudkit_chat_conversation_owners VALUES ('old-conversation', ?)").run(old);
  database.prepare("INSERT INTO cloudkit_chat_conversation_owners VALUES ('kept-conversation', ?)").run(old);

  const result = cleanupCloudKitChatLifecycle({ database, now });
  assert.deepEqual(result, {
    jobsDeleted: 3,
    remoteCleanupDeleted: 3,
    sequencesDeleted: 1,
    quarantineDeleted: 1,
    leasesDeleted: 0,
    conversationOwnersDeleted: 1,
    cleanedAt: now,
  });
  assert.deepEqual(
    database.prepare("SELECT request_id FROM cloudkit_chat_jobs ORDER BY request_id").all().map((row) => row.request_id),
    ["not-consumed", "not-exported", "queued", "recent"],
  );
  assert.deepEqual(
    database.prepare("SELECT id FROM cloudkit_sync_quarantine ORDER BY id").all().map((row) => row.id),
    ["manual-chat", "other-zone"],
  );
  assert.deepEqual(
    database.prepare("SELECT request_id, status FROM cloudkit_chat_remote_cleanup ORDER BY request_id").all()
      .map((row) => ({ request_id: row.request_id, status: row.status })),
    [
      { request_id: "not-consumed", status: "queued" },
      { request_id: "recent", status: "completed" },
    ],
  );
  assert.deepEqual(
    database.prepare("SELECT conversation_id FROM cloudkit_chat_conversation_owners ORDER BY conversation_id").all().map((row) => row.conversation_id),
    ["kept-conversation"],
  );
  database.close();
});

test("remote cleanup retries with backoff and completes only after a successful delete export", () => {
  const database = createLifecycleDatabase();
  const now = Date.UTC(2026, 6, 26);
  const requestId = "123e4567-e89b-42d3-a456-426614174000";

  queueCloudKitChatRemoteCleanup(requestId, { database, now });
  assert.deepEqual(listDueCloudKitChatRemoteCleanup({ database, now }), [
    { requestId, attemptCount: 0 },
  ]);

  assert.deepEqual(
    markCloudKitChatRemoteCleanupFailed([requestId], "temporary CloudKit failure", { database, now }),
    { marked: 1 },
  );
  assert.deepEqual(listDueCloudKitChatRemoteCleanup({ database, now: now + 29_999 }), []);
  assert.deepEqual(listDueCloudKitChatRemoteCleanup({ database, now: now + 30_000 }), [
    { requestId, attemptCount: 1 },
  ]);

  assert.deepEqual(
    markCloudKitChatRemoteCleanupCompleted([requestId], { database, now: now + 30_001 }),
    { marked: 1 },
  );
  assert.deepEqual(listDueCloudKitChatRemoteCleanup({ database, now: now + 60_000 }), []);
  const completed = database.prepare(`
    SELECT status, attempt_count as attemptCount, completed_at as completedAt, last_error as lastError
    FROM cloudkit_chat_remote_cleanup
    WHERE request_id = ?
  `).get(requestId);
  assert.deepEqual(
    { ...completed },
    {
      status: "completed",
      attemptCount: 1,
      completedAt: now + 30_001,
      lastError: null,
    },
  );
  database.close();
});
