import { db } from "./db";
import { tokenHash } from "./security";

export type DeviceRecord = {
  id: string;
  name: string;
  type: "mobile" | "desktop" | "browser";
  status: "online" | "offline" | "revoked";
  publicKey?: string;
  accessTokenHash: string;
  accessTokenExpiresAt?: number;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
};

export type DeviceConnectivityReport = {
  id: string;
  deviceId: string;
  ok: boolean;
  currentBaseUrl: string;
  healthOk: boolean;
  mobileShellOk: boolean;
  websocketOk: boolean;
  latencyMs: number;
  error?: string;
  createdAt: number;
};

export type DeviceIcloudHandoffEvent = {
  id: string;
  deviceId: string;
  deviceName?: string;
  deviceType?: DeviceRecord["type"];
  eventType: "opened-current-entry" | "ignored-superseded-entry" | "opened-stale-entry" | "opened-expired-entry" | "opened-legacy-entry" | "opened-address-mismatch-entry";
  entryBaseUrl: string;
  currentBaseUrl: string;
  storedBaseUrl: string;
  entryGeneratedAt?: number;
  storedGeneratedAt?: number;
  checksumSha256?: string;
  ignoredAt: number;
  createdAt: number;
};

export type BindingSession = {
  id: string;
  tokenHash: string;
  baseUrl?: string;
  expiresAt: number;
  createdAt: number;
  confirmedAt?: number;
  confirmedDeviceId?: string;
};

function mapDevice(row: any): DeviceRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    publicKey: row.public_key || undefined,
    accessTokenHash: row.access_token_hash,
    accessTokenExpiresAt: row.access_token_expires_at || undefined,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at || undefined,
  };
}

function mapBindingSession(row: any): BindingSession {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    baseUrl: row.base_url || undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at || undefined,
    confirmedDeviceId: row.confirmed_device_id || undefined,
  };
}

function mapConnectivityReport(row: any): DeviceConnectivityReport {
  return {
    id: row.id,
    deviceId: row.device_id,
    ok: Boolean(row.ok),
    currentBaseUrl: row.current_base_url,
    healthOk: Boolean(row.health_ok),
    mobileShellOk: Boolean(row.mobile_shell_ok),
    websocketOk: Boolean(row.websocket_ok),
    latencyMs: row.latency_ms,
    error: row.error || undefined,
    createdAt: row.created_at,
  };
}

function mapIcloudHandoffEvent(row: any): DeviceIcloudHandoffEvent {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name || undefined,
    deviceType: row.device_type || undefined,
    eventType: row.event_type,
    entryBaseUrl: row.entry_base_url,
    currentBaseUrl: row.current_base_url,
    storedBaseUrl: row.stored_base_url,
    entryGeneratedAt: row.entry_generated_at || undefined,
    storedGeneratedAt: row.stored_generated_at || undefined,
    checksumSha256: row.checksum_sha256 || undefined,
    ignoredAt: row.ignored_at,
    createdAt: row.created_at,
  };
}

export function getDevices(includeRevoked = false) {
  const rows = includeRevoked
    ? db.prepare("SELECT * FROM devices ORDER BY created_at DESC").all()
    : db.prepare("SELECT * FROM devices WHERE revoked_at IS NULL ORDER BY created_at DESC").all();
  return rows.map(mapDevice);
}

export function getDevice(deviceId: string) {
  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
  return row ? mapDevice(row) : undefined;
}

export function getLatestDeviceConnectivityReport(deviceId: string) {
  const row = db
    .prepare("SELECT * FROM device_connectivity_reports WHERE device_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(deviceId);
  return row ? mapConnectivityReport(row) : undefined;
}

export function getLatestDeviceIcloudHandoffEvent(deviceId: string) {
  const row = db
    .prepare("SELECT * FROM device_icloud_handoff_events WHERE device_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(deviceId);
  return row ? mapIcloudHandoffEvent(row) : undefined;
}

export function getLatestIcloudHandoffEvent() {
  const row = db
    .prepare(`
      SELECT
        e.*,
        d.name AS device_name,
        d.type AS device_type
      FROM device_icloud_handoff_events e
      LEFT JOIN devices d ON d.id = e.device_id
      ORDER BY e.created_at DESC
      LIMIT 1
    `)
    .get();
  return row ? mapIcloudHandoffEvent(row) : undefined;
}

export function getLatestIcloudHandoffEventByTypes(eventTypes: DeviceIcloudHandoffEvent["eventType"][]) {
  const normalized = Array.from(new Set(eventTypes.filter(Boolean)));
  if (!normalized.length) return undefined;
  const placeholders = normalized.map(() => "?").join(", ");
  const row = db
    .prepare(`
      SELECT
        e.*,
        d.name AS device_name,
        d.type AS device_type
      FROM device_icloud_handoff_events e
      LEFT JOIN devices d ON d.id = e.device_id
      WHERE e.event_type IN (${placeholders})
      ORDER BY e.created_at DESC
      LIMIT 1
    `)
    .get(...normalized);
  return row ? mapIcloudHandoffEvent(row) : undefined;
}

export function insertDeviceConnectivityReport(report: DeviceConnectivityReport) {
  db.prepare(`
    INSERT INTO device_connectivity_reports (id, device_id, ok, current_base_url, health_ok, mobile_shell_ok, websocket_ok, latency_ms, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.id,
    report.deviceId,
    report.ok ? 1 : 0,
    report.currentBaseUrl,
    report.healthOk ? 1 : 0,
    report.mobileShellOk ? 1 : 0,
    report.websocketOk ? 1 : 0,
    report.latencyMs,
    report.error || null,
    report.createdAt,
  );
  return getLatestDeviceConnectivityReport(report.deviceId);
}

export function insertDeviceIcloudHandoffEvent(event: DeviceIcloudHandoffEvent) {
  db.prepare(`
    INSERT INTO device_icloud_handoff_events (
      id,
      device_id,
      event_type,
      entry_base_url,
      current_base_url,
      stored_base_url,
      entry_generated_at,
      stored_generated_at,
      checksum_sha256,
      ignored_at,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.deviceId,
    event.eventType,
    event.entryBaseUrl,
    event.currentBaseUrl,
    event.storedBaseUrl,
    event.entryGeneratedAt || null,
    event.storedGeneratedAt || null,
    event.checksumSha256 || null,
    event.ignoredAt,
    event.createdAt,
  );
  return getLatestDeviceIcloudHandoffEvent(event.deviceId);
}

export function getActiveDeviceByToken(deviceId: string | null, accessToken: string | null) {
  if (!deviceId || !accessToken) return undefined;
  const now = Date.now();
  const row = db
    .prepare("SELECT * FROM devices WHERE id = ? AND access_token_hash = ? AND revoked_at IS NULL AND (access_token_expires_at IS NULL OR access_token_expires_at > ?)")
    .get(deviceId, tokenHash(accessToken), now);
  return row ? mapDevice(row) : undefined;
}

export function getActiveDeviceById(deviceId: string | null) {
  if (!deviceId) return undefined;
  const row = db.prepare("SELECT * FROM devices WHERE id = ? AND revoked_at IS NULL").get(deviceId);
  return row ? mapDevice(row) : undefined;
}

export function insertDevice(device: DeviceRecord) {
  db.prepare(`
    INSERT INTO devices (id, name, type, status, public_key, access_token_hash, access_token_expires_at, created_at, last_seen_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    device.id,
    device.name,
    device.type,
    device.status,
    device.publicKey || null,
    device.accessTokenHash,
    device.accessTokenExpiresAt || null,
    device.createdAt,
    device.lastSeenAt,
    device.revokedAt || null,
  );
}

export function rotateDeviceToken(deviceId: string, accessTokenHash: string, accessTokenExpiresAt: number) {
  db.prepare("UPDATE devices SET access_token_hash = ?, access_token_expires_at = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL").run(
    accessTokenHash,
    accessTokenExpiresAt,
    Date.now(),
    deviceId,
  );
  return getDevice(deviceId);
}

export function updateDevicePresence(deviceId: string, status: "online" | "offline", lastSeenAt: number) {
  db.prepare("UPDATE devices SET status = ?, last_seen_at = ? WHERE id = ? AND revoked_at IS NULL").run(status, lastSeenAt, deviceId);
}

export function revokeDeviceRecord(deviceId: string, revokedAt: number) {
  db.prepare("UPDATE devices SET status = 'revoked', revoked_at = ? WHERE id = ?").run(revokedAt, deviceId);
}

export function insertBindingSession(session: BindingSession) {
  db.prepare(`
    INSERT INTO binding_sessions (id, token_hash, base_url, created_at, expires_at, confirmed_at, confirmed_device_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.tokenHash,
    session.baseUrl || null,
    session.createdAt,
    session.expiresAt,
    session.confirmedAt || null,
    session.confirmedDeviceId || null,
  );
}

export function getBindingSessionById(bindingId: string) {
  const row = db.prepare("SELECT * FROM binding_sessions WHERE id = ?").get(bindingId);
  return row ? mapBindingSession(row) : undefined;
}

export function getLatestBindingSession() {
  const row = db.prepare("SELECT * FROM binding_sessions ORDER BY created_at DESC LIMIT 1").get();
  return row ? mapBindingSession(row) : undefined;
}

export function getOpenBindingSessionByToken(token: string, now: number) {
  const row = db
    .prepare("SELECT * FROM binding_sessions WHERE token_hash = ? AND expires_at > ? AND confirmed_at IS NULL")
    .get(tokenHash(token), now);
  return row ? mapBindingSession(row) : undefined;
}

export function getBindingSessionByToken(token: string) {
  const row = db.prepare("SELECT * FROM binding_sessions WHERE token_hash = ?").get(tokenHash(token));
  return row ? mapBindingSession(row) : undefined;
}

export function confirmBindingSessionWithDevice(bindingId: string, device: DeviceRecord, confirmedAt: number) {
  db.exec("BEGIN IMMEDIATE");
  try {
    insertDevice(device);
    const claimed = db.prepare(`
      UPDATE binding_sessions
      SET confirmed_at = ?, confirmed_device_id = ?
      WHERE id = ? AND confirmed_at IS NULL AND expires_at > ?
    `).run(confirmedAt, device.id, bindingId, confirmedAt).changes === 1;
    if (!claimed) {
      db.exec("ROLLBACK");
      return false;
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Migration vouchers let an already-authenticated phone move its binding to a
// different origin without a new QR scan. A voucher is requested over the old
// working origin, redeemed exactly once on the new one, and expires fast —
// only its hash is stored.
export type DeviceMigrationVoucher = {
  id: string;
  deviceId: string;
  tokenHash: string;
  targetBaseUrl?: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
};

function mapMigrationVoucher(row: any): DeviceMigrationVoucher {
  return {
    id: row.id,
    deviceId: row.device_id,
    tokenHash: row.token_hash,
    targetBaseUrl: row.target_base_url || undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at || undefined,
  };
}

export function insertDeviceMigrationVoucher(voucher: DeviceMigrationVoucher) {
  db.prepare(`
    INSERT INTO device_migration_vouchers (id, device_id, token_hash, target_base_url, created_at, expires_at, used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(voucher.id, voucher.deviceId, voucher.tokenHash, voucher.targetBaseUrl || null, voucher.createdAt, voucher.expiresAt, voucher.usedAt || null);
}

export function getOpenDeviceMigrationVoucherByToken(token: string, now: number) {
  const row = db
    .prepare("SELECT * FROM device_migration_vouchers WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL")
    .get(tokenHash(token), now);
  return row ? mapMigrationVoucher(row) : undefined;
}

// Self-guarding burn: the used_at predicate makes single-use hold even if a
// future refactor introduces an await between lookup and burn.
export function markDeviceMigrationVoucherUsed(voucherId: string, usedAt: number) {
  const result = db.prepare("UPDATE device_migration_vouchers SET used_at = ? WHERE id = ? AND used_at IS NULL").run(usedAt, voucherId);
  return result.changes > 0;
}

export function pruneExpiredDeviceMigrationVouchers(now: number) {
  db.prepare("DELETE FROM device_migration_vouchers WHERE expires_at <= ?").run(now);
}

// Rotating onto a new origin replaces the whole credential: the new public key
// (or NULL when the new origin has no WebCrypto and falls back to token auth)
// and a fresh token hash. The old origin's stored credential stops working at
// this moment — one active credential per device, same as bind/confirm.
export function migrateDeviceCredential(deviceId: string, input: {
  publicKey?: string;
  accessTokenHash: string;
  accessTokenExpiresAt?: number;
  migratedAt: number;
}) {
  const result = db.prepare(`
    UPDATE devices
    SET public_key = ?, access_token_hash = ?, access_token_expires_at = ?, last_seen_at = ?
    WHERE id = ? AND revoked_at IS NULL
  `).run(input.publicKey || null, input.accessTokenHash, input.accessTokenExpiresAt || null, input.migratedAt, deviceId);
  // A concurrent revocation between voucher check and rotation must read as
  // failure, not as the stale pre-rotation record.
  if (!result.changes) return undefined;
  return getDevice(deviceId);
}

export function pruneExpiredBindingSessions(now: number) {
  db.prepare("DELETE FROM binding_sessions WHERE expires_at <= ? AND confirmed_at IS NULL").run(now);
}
