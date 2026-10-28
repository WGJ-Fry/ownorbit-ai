import crypto from "crypto";
import { db } from "./db";

type CloudKitDeviceKeyCountRow = {
  count: number;
};

export function countActiveCloudKitDevices(now = Date.now()) {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM cloudkit_device_keys
    WHERE status = 'active'
      AND expires_at > ?
      AND revoked_at IS NULL
      AND approved_at IS NOT NULL
  `).get(now) as CloudKitDeviceKeyCountRow | undefined;
  return Math.max(0, Number(row?.count || 0));
}

function approvalId(deviceIdHash: string) {
  return crypto.createHash("sha256").update(`ownorbit-cloudkit-device-approval:${deviceIdHash}`, "utf8").digest("hex").slice(0, 24);
}

type CloudKitDeviceKeyRow = {
  deviceIdHash: string;
  displayName: string;
  publicKeyFingerprint: string;
  status: string;
  expiresAt: number;
  approvedAt?: number | null;
  revokedAt?: number | null;
  appliedAt: number;
};

export function listCloudKitChatDevices(options: { limit?: number; now?: number } = {}) {
  const now = options.now || Date.now();
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit || 50)));
  const rows = db.prepare(`
    SELECT
      device_id_hash as deviceIdHash,
      display_name as displayName,
      public_key_fingerprint as publicKeyFingerprint,
      status,
      expires_at as expiresAt,
      approved_at as approvedAt,
      revoked_at as revokedAt,
      applied_at as appliedAt
    FROM cloudkit_device_keys
    ORDER BY applied_at DESC
    LIMIT ?
  `).all(limit) as CloudKitDeviceKeyRow[];
  const items = rows.map((row) => {
    const state = row.status === "revoked" || Number(row.revokedAt || 0) > 0
      ? "revoked"
      : Number(row.expiresAt || 0) <= now
        ? "expired"
        : Number(row.approvedAt || 0) > 0
          ? "approved"
          : "pending";
    return {
      id: approvalId(row.deviceIdHash),
      displayName: String(row.displayName || "iPhone").slice(0, 80),
      publicKeyFingerprintShort: String(row.publicKeyFingerprint || "").slice(0, 12),
      state,
      expiresAt: Number(row.expiresAt || 0),
      approvedAt: Number(row.approvedAt || 0) || null,
      revokedAt: Number(row.revokedAt || 0) || null,
      appliedAt: Number(row.appliedAt || 0),
    };
  });
  return {
    items,
    summary: {
      total: items.length,
      pending: items.filter((item) => item.state === "pending").length,
      approved: items.filter((item) => item.state === "approved").length,
      revoked: items.filter((item) => item.state === "revoked").length,
      rawPublicKeyReturned: false as const,
      rawDeviceIdReturned: false as const,
    },
  };
}

function findDeviceByApprovalId(id: string) {
  const rows = db.prepare(`
    SELECT device_id as deviceId, device_id_hash as deviceIdHash
    FROM cloudkit_device_keys
  `).all() as Array<{ deviceId: string; deviceIdHash: string }>;
  return rows.find((row) => approvalId(row.deviceIdHash) === id);
}

export function approveCloudKitChatDevice(id: string, actor: string, now = Date.now()) {
  const device = findDeviceByApprovalId(String(id || "").trim());
  if (!device) throw new Error("CloudKit chat device was not found.");
  const result = db.prepare(`
    UPDATE cloudkit_device_keys
    SET approved_at = ?, approval_actor = ?
    WHERE device_id = ?
      AND status = 'active'
      AND revoked_at IS NULL
      AND expires_at > ?
  `).run(now, String(actor || "admin").slice(0, 120), device.deviceId, now) as any;
  if (!result?.changes) throw new Error("CloudKit chat device cannot be approved in its current state.");
  db.prepare(`
    UPDATE cloudkit_sync_quarantine
    SET status = 'auto-ready', error = NULL
    WHERE zone = 'LifeOSChatRelayZone'
      AND record_type = 'LifeOSChatRequest'
      AND status IN ('failed', 'conflict')
      AND error = 'CloudKit chat request is not signed by an active paired device.'
      AND json_extract(payload_json, '$.sourceDeviceHash') = ?
  `).run(device.deviceIdHash);
  return { id, state: "approved" as const, approvedAt: now };
}

export function revokeCloudKitChatDevice(id: string, actor: string, now = Date.now()) {
  const device = findDeviceByApprovalId(String(id || "").trim());
  if (!device) throw new Error("CloudKit chat device was not found.");
  const result = db.prepare(`
    UPDATE cloudkit_device_keys
    SET status = 'revoked',
        revoked_at = COALESCE(revoked_at, ?),
        approval_actor = ?,
        approved_at = NULL
    WHERE device_id = ?
  `).run(now, String(actor || "admin").slice(0, 120), device.deviceId) as any;
  if (!result?.changes) throw new Error("CloudKit chat device could not be revoked.");
  return { id, state: "revoked" as const, revokedAt: now };
}
