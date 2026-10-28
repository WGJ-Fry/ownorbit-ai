import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolatedDeviceTrustMetadata(env) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    const { db } = await import("./server/db.ts");
    runMigrations();
    const { listCloudKitDeviceTrustMetadata } = await import("./server/cloudKitDeviceTrustMetadata.ts");
    const now = 1700000000000;
    db.prepare("INSERT INTO cloudkit_device_trust_metadata (device_id_hash, display_name, device_type, trust_state, public_key_fingerprint, access_expires_at, created_at, last_seen_at, revoked_at, mutation_id, logical_clock, source_record_name, source_evidence_id, review_status, access_granted, imported_at, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "Alice iPhone",
        "mobile",
        "online",
        "abcdef0123456789abcdef0123456789",
        now + 86400000,
        now - 5000,
        now + 1000,
        null,
        "device-trust-mut",
        now + 1000,
        "device:0123456789abcdef01234567",
        "evidence-device-trust",
        "needs-rebind",
        0,
        now + 2000,
        now + 3000
      );
    db.prepare("INSERT INTO cloudkit_device_trust_metadata (device_id_hash, display_name, device_type, trust_state, public_key_fingerprint, access_expires_at, created_at, last_seen_at, revoked_at, mutation_id, logical_clock, source_record_name, source_evidence_id, review_status, access_granted, imported_at, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        "Old iPhone",
        "mobile",
        "revoked",
        "1234567890abcdef1234567890abcdef",
        null,
        now - 10000,
        now - 9000,
        now - 8000,
        "device-trust-revoked",
        now - 8000,
        "device:fedcba9876543210fedcba98",
        "evidence-device-trust-revoked",
        "needs-rebind",
        0,
        now + 1000,
        now + 1000
      );
    process.stdout.write(JSON.stringify(listCloudKitDeviceTrustMetadata({ limit: 10 })));
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runIsolatedActiveDeviceCount(env) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    const { db } = await import("./server/db.ts");
    runMigrations();
    const { countActiveCloudKitDevices } = await import("./server/cloudKitDeviceKeys.ts");
    const now = 1700000000000;
    const insert = db.prepare("INSERT INTO cloudkit_device_keys (device_id, device_id_hash, display_name, device_type, channel_scope, public_key, public_key_fingerprint, status, created_at, expires_at, logical_clock, mutation_id, source_record_name, source_evidence_id, imported_at, applied_at, revoked_at) VALUES (?, ?, ?, 'ios', 'cloudkit-chat', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run("active-device", "active-hash", "Active iPhone", "active-public-key", "active-fingerprint", "active", now - 1000, now + 60000, 1, "active-mutation", "active-record", "active-evidence", now, now, null);
    insert.run("expired-device", "expired-hash", "Expired iPhone", "expired-public-key", "expired-fingerprint", "active", now - 2000, now - 1, 2, "expired-mutation", "expired-record", "expired-evidence", now, now, null);
    insert.run("revoked-device", "revoked-hash", "Revoked iPhone", "revoked-public-key", "revoked-fingerprint", "revoked", now - 3000, now + 60000, 3, "revoked-mutation", "revoked-record", "revoked-evidence", now, now, now - 10);
    const pendingCount = countActiveCloudKitDevices(now);
    db.prepare("UPDATE cloudkit_device_keys SET approved_at = ?, approval_actor = 'test-admin' WHERE device_id = ?")
      .run(now, "active-device");
    const approvedCount = countActiveCloudKitDevices(now);
    db.prepare("UPDATE cloudkit_device_keys SET status = 'revoked', revoked_at = ?, approved_at = NULL WHERE device_id = ?")
      .run(now + 1, "active-device");
    const revokedCount = countActiveCloudKitDevices(now + 1);
    process.stdout.write(JSON.stringify({ pendingCount, approvedCount, revokedCount }));
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("CloudKit device trust metadata view shows rebind guidance without granting access", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-device-trust-metadata-"));
  try {
    const result = runIsolatedDeviceTrustMetadata({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.summary.total, 2);
    assert.equal(result.summary.needsRebind, 1);
    assert.equal(result.summary.revoked, 1);
    assert.equal(result.summary.accessGranted, 0);
    assert.equal(result.summary.nextAction, "rebind-device");
    assert.equal(result.summary.rawCredentialReturnedToAdmin, false);
    assert.equal(result.summary.deviceAccessGrantedFromCloudKit, false);
    assert.equal(result.items[0].displayName, "Alice iPhone");
    assert.equal(result.items[0].id, "0123456789abcdef");
    assert.equal(result.items[0].publicKeyFingerprintShort, "abcdef012345");
    assert.equal(result.items[0].accessGranted, false);
    assert.equal(result.items[0].nextAction, "rebind-device");
    assert.match(result.items[0].guidance, /Bind this device again/);
    assert.equal(result.items[1].nextAction, "review-revoked-device");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), false);
    assert.equal(serialized.includes("abcdef0123456789abcdef0123456789"), false);
    assert.equal(serialized.includes("source_record_name"), false);
    assert.equal(serialized.includes("accessToken"), false);
    assert.equal(serialized.includes("access_token"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit onboarding device count includes only approved, active, unexpired device keys", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-active-device-count-"));
  try {
    const result = runIsolatedActiveDeviceCount({
      ...process.env,
      LIFEOS_DATA_DIR: path.join(dir, "data"),
    });
    assert.equal(result.pendingCount, 0);
    assert.equal(result.approvedCount, 1);
    assert.equal(result.revokedCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
