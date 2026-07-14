import { db } from "./db";

export type CloudKitDeviceTrustMetadataItem = {
  id: string;
  displayName: string;
  deviceType: string;
  trustState: string;
  publicKeyFingerprintShort?: string;
  accessExpiresAt?: number;
  createdAt?: number;
  lastSeenAt?: number;
  revokedAt?: number;
  reviewStatus: "needs-rebind" | "reviewed" | "ignored";
  accessGranted: false;
  importedAt: number;
  appliedAt: number;
  nextAction: "rebind-device" | "review-revoked-device" | "keep-for-reference";
  guidance: string;
};

type CloudKitDeviceTrustMetadataRow = {
  deviceIdHash: string;
  displayName: string;
  deviceType: string;
  trustState: string;
  publicKeyFingerprint: string | null;
  accessExpiresAt: number | null;
  createdAt: number | null;
  lastSeenAt: number | null;
  revokedAt: number | null;
  reviewStatus: string;
  accessGranted: number;
  importedAt: number;
  appliedAt: number;
};

function publicItem(row: CloudKitDeviceTrustMetadataRow): CloudKitDeviceTrustMetadataItem {
  const revoked = Boolean(row.revokedAt) || row.trustState === "revoked";
  const nextAction = revoked ? "review-revoked-device" : row.reviewStatus === "needs-rebind" ? "rebind-device" : "keep-for-reference";
  return {
    id: row.deviceIdHash.slice(0, 16),
    displayName: row.displayName || "Synced Apple device",
    deviceType: row.deviceType || "unknown",
    trustState: row.trustState || "unknown",
    publicKeyFingerprintShort: row.publicKeyFingerprint ? row.publicKeyFingerprint.slice(0, 12) : undefined,
    accessExpiresAt: row.accessExpiresAt || undefined,
    createdAt: row.createdAt || undefined,
    lastSeenAt: row.lastSeenAt || undefined,
    revokedAt: row.revokedAt || undefined,
    reviewStatus: ["reviewed", "ignored"].includes(row.reviewStatus) ? row.reviewStatus as "reviewed" | "ignored" : "needs-rebind",
    accessGranted: false,
    importedAt: Number(row.importedAt || 0),
    appliedAt: Number(row.appliedAt || 0),
    nextAction,
    guidance: revoked
      ? "This iCloud device record is revoked. Keep it for review or bind the device again if it should be active."
      : "Bind this device again before it can access this OwnOrbit computer.",
  };
}

export function listCloudKitDeviceTrustMetadata(options: { limit?: number } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit || 50)));
  const rows = db.prepare(`
    SELECT
      device_id_hash as deviceIdHash,
      display_name as displayName,
      device_type as deviceType,
      trust_state as trustState,
      public_key_fingerprint as publicKeyFingerprint,
      access_expires_at as accessExpiresAt,
      created_at as createdAt,
      last_seen_at as lastSeenAt,
      revoked_at as revokedAt,
      review_status as reviewStatus,
      access_granted as accessGranted,
      imported_at as importedAt,
      applied_at as appliedAt
    FROM cloudkit_device_trust_metadata
    ORDER BY applied_at DESC, imported_at DESC
    LIMIT ?
  `).all(safeLimit) as CloudKitDeviceTrustMetadataRow[];
  const items = rows.map(publicItem);
  const summary = {
    total: items.length,
    needsRebind: items.filter((item) => item.reviewStatus === "needs-rebind" && item.nextAction === "rebind-device").length,
    revoked: items.filter((item) => item.nextAction === "review-revoked-device").length,
    accessGranted: 0,
    newestAppliedAt: items[0]?.appliedAt || null,
    nextAction: items.some((item) => item.nextAction === "rebind-device")
      ? "rebind-device"
      : items.some((item) => item.nextAction === "review-revoked-device")
        ? "review-revoked-device"
        : "none",
    rawCredentialReturnedToAdmin: false,
    deviceAccessGrantedFromCloudKit: false,
  };
  return { items, summary };
}
