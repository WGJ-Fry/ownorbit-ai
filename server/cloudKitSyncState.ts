import { db } from "./db";
import type { CloudKitNativeHelperResult } from "./cloudKitNativeHelper";

export type CloudKitSyncCheckpoint = {
  zone: string;
  tokenState: "none" | "pending-preview" | "applied";
  appliedServerChangeTokenPresent: boolean;
  pendingServerChangeTokenPresent: boolean;
  lastEvidenceId?: string;
  lastPreviewAt?: number;
  lastAppliedAt?: number;
  changedCount: number;
  deletedCount: number;
  failedCount: number;
  moreComing: boolean;
  updatedAt: number;
};

export type CloudKitSyncStateSnapshot = {
  generatedAt: string;
  zones: Array<{
    zone: string;
    serverChangeToken?: string;
    tokenState: "none" | "applied";
    updatedAt: number;
  }>;
};

type CloudKitSyncCheckpointRow = {
  zone: string;
  appliedServerChangeToken: string | null;
  pendingServerChangeToken: string | null;
  tokenState: string;
  lastEvidenceId: string | null;
  lastPreviewAt: number | null;
  lastAppliedAt: number | null;
  changedCount: number;
  deletedCount: number;
  failedCount: number;
  moreComing: number;
  updatedAt: number;
};

function normalizeTokenState(value: unknown): CloudKitSyncCheckpoint["tokenState"] {
  return value === "pending-preview" || value === "applied" ? value : "none";
}

function rowToCheckpoint(row: CloudKitSyncCheckpointRow): CloudKitSyncCheckpoint {
  return {
    zone: row.zone,
    tokenState: normalizeTokenState(row.tokenState),
    appliedServerChangeTokenPresent: Boolean(row.appliedServerChangeToken),
    pendingServerChangeTokenPresent: Boolean(row.pendingServerChangeToken),
    lastEvidenceId: row.lastEvidenceId || undefined,
    lastPreviewAt: row.lastPreviewAt || undefined,
    lastAppliedAt: row.lastAppliedAt || undefined,
    changedCount: Number(row.changedCount || 0),
    deletedCount: Number(row.deletedCount || 0),
    failedCount: Number(row.failedCount || 0),
    moreComing: Boolean(row.moreComing),
    updatedAt: Number(row.updatedAt || 0),
  };
}

export function listCloudKitSyncCheckpoints(): CloudKitSyncCheckpoint[] {
  const rows = db.prepare(`
    SELECT
      zone,
      applied_server_change_token as appliedServerChangeToken,
      pending_server_change_token as pendingServerChangeToken,
      token_state as tokenState,
      last_evidence_id as lastEvidenceId,
      last_preview_at as lastPreviewAt,
      last_applied_at as lastAppliedAt,
      changed_count as changedCount,
      deleted_count as deletedCount,
      failed_count as failedCount,
      more_coming as moreComing,
      updated_at as updatedAt
    FROM cloudkit_sync_checkpoints
    ORDER BY zone ASC
  `).all() as CloudKitSyncCheckpointRow[];
  return rows.map(rowToCheckpoint);
}

export function getCloudKitSyncStateSnapshot(now = new Date()): CloudKitSyncStateSnapshot {
  const rows = db.prepare(`
    SELECT
      zone,
      applied_server_change_token as appliedServerChangeToken,
      token_state as tokenState,
      updated_at as updatedAt
    FROM cloudkit_sync_checkpoints
    WHERE applied_server_change_token IS NOT NULL AND applied_server_change_token != ''
    ORDER BY zone ASC
  `).all() as Pick<CloudKitSyncCheckpointRow, "zone" | "appliedServerChangeToken" | "tokenState" | "updatedAt">[];
  return {
    generatedAt: now.toISOString(),
    zones: rows.map((row) => ({
      zone: row.zone,
      serverChangeToken: row.appliedServerChangeToken || undefined,
      tokenState: "applied",
      updatedAt: Number(row.updatedAt || 0),
    })),
  };
}

export function saveCloudKitSyncChangesPreview(result: CloudKitNativeHelperResult, now = Date.now()) {
  const zones = result.syncChangesPreview?.zones || [];
  if (!zones.length) return { saved: 0, checkpoints: listCloudKitSyncCheckpoints() };
  const statement = db.prepare(`
    INSERT INTO cloudkit_sync_checkpoints (
      zone,
      applied_server_change_token,
      pending_server_change_token,
      token_state,
      last_evidence_id,
      last_preview_at,
      last_applied_at,
      changed_count,
      deleted_count,
      failed_count,
      more_coming,
      updated_at
    )
    VALUES (?, NULL, ?, 'pending-preview', ?, ?, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(zone) DO UPDATE SET
      pending_server_change_token = excluded.pending_server_change_token,
      token_state = 'pending-preview',
      last_evidence_id = excluded.last_evidence_id,
      last_preview_at = excluded.last_preview_at,
      changed_count = excluded.changed_count,
      deleted_count = excluded.deleted_count,
      failed_count = excluded.failed_count,
      more_coming = excluded.more_coming,
      updated_at = excluded.updated_at
  `);
  db.exec("BEGIN");
  try {
    let saved = 0;
    for (const zone of zones) {
      if (!zone.zone || !zone.serverChangeToken) continue;
      statement.run(
        zone.zone,
        zone.serverChangeToken,
        "evidenceId" in result ? result.evidenceId || null : null,
        now,
        zone.changed,
        zone.deleted,
        zone.failed,
        zone.moreComing ? 1 : 0,
        now,
      );
      saved += 1;
    }
    db.exec("COMMIT");
    return { saved, checkpoints: listCloudKitSyncCheckpoints() };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function publicCloudKitHelperResult<T extends CloudKitNativeHelperResult>(result: T): T {
  const clone = JSON.parse(JSON.stringify(result)) as T;
  for (const zone of clone.syncChangesPreview?.zones || []) {
    const tokenCaptured = Boolean(zone.serverChangeToken);
    delete zone.serverChangeToken;
    zone.serverChangeTokenCaptured = tokenCaptured;
  }
  return clone;
}
