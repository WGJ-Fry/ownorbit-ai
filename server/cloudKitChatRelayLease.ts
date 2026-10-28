import crypto from "crypto";
import { db } from "./db";

const RELAY_LEASE_NAME = "cloudkit-chat-relay";
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export type CloudKitChatRelayLease = {
  leaseId: string;
  acquiredAt: number;
  expiresAt: number;
  fencingToken: number;
};

export function acquireCloudKitChatRelayLease(options: { now?: number; leaseMs?: number } = {}) {
  const now = options.now ?? Date.now();
  const leaseMs = Math.min(15 * 60 * 1000, Math.max(30_000, options.leaseMs ?? DEFAULT_LEASE_MS));
  const leaseId = crypto.randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO cloudkit_chat_relay_leases (
        lease_name, lease_id, holder_pid, acquired_at, expires_at, fencing_token
      ) VALUES (?, ?, ?, ?, ?, 1)
    `).run(RELAY_LEASE_NAME, leaseId, process.pid, now, now + leaseMs) as any;
    const replaced = Number(inserted?.changes || 0) === 1
      ? inserted
      : db.prepare(`
          UPDATE cloudkit_chat_relay_leases
          SET lease_id = ?,
              holder_pid = ?,
              acquired_at = ?,
              expires_at = ?,
              fencing_token = fencing_token + 1
          WHERE lease_name = ? AND expires_at <= ?
        `).run(leaseId, process.pid, now, now + leaseMs, RELAY_LEASE_NAME, now) as any;
    const current = db.prepare(`
      SELECT lease_id as leaseId, acquired_at as acquiredAt, expires_at as expiresAt,
             fencing_token as fencingToken
      FROM cloudkit_chat_relay_leases
      WHERE lease_name = ?
    `).get(RELAY_LEASE_NAME) as CloudKitChatRelayLease | undefined;
    db.exec("COMMIT");
    return Number(replaced?.changes || 0) === 1 && current?.leaseId === leaseId
      ? { acquired: true as const, lease: current! }
      : { acquired: false as const, lease: current };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function renewCloudKitChatRelayLease(
  lease: Pick<CloudKitChatRelayLease, "leaseId" | "fencingToken">,
  options: { now?: number; leaseMs?: number } = {},
) {
  const now = options.now ?? Date.now();
  const leaseMs = Math.min(15 * 60 * 1000, Math.max(30_000, options.leaseMs ?? DEFAULT_LEASE_MS));
  const result = db.prepare(`
    UPDATE cloudkit_chat_relay_leases
    SET expires_at = ?
    WHERE lease_name = ?
      AND lease_id = ?
      AND fencing_token = ?
      AND expires_at > ?
  `).run(now + leaseMs, RELAY_LEASE_NAME, lease.leaseId, lease.fencingToken, now) as any;
  return Number(result?.changes || 0) === 1;
}

export function assertCloudKitChatRelayLease(
  lease: Pick<CloudKitChatRelayLease, "leaseId" | "fencingToken">,
  now = Date.now(),
) {
  const row = db.prepare(`
    SELECT 1
    FROM cloudkit_chat_relay_leases
    WHERE lease_name = ?
      AND lease_id = ?
      AND fencing_token = ?
      AND expires_at > ?
  `).get(RELAY_LEASE_NAME, lease.leaseId, lease.fencingToken, now);
  return Boolean(row);
}

export function releaseCloudKitChatRelayLease(leaseId: string, fencingToken?: number) {
  const result = db.prepare(`
    UPDATE cloudkit_chat_relay_leases
    SET expires_at = 0
    WHERE lease_name = ? AND lease_id = ?
      ${fencingToken === undefined ? "" : "AND fencing_token = ?"}
  `).run(...(fencingToken === undefined
    ? [RELAY_LEASE_NAME, leaseId]
    : [RELAY_LEASE_NAME, leaseId, fencingToken])) as any;
  return Number(result?.changes || 0) === 1;
}
