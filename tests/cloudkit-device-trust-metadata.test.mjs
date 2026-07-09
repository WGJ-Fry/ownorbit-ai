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
