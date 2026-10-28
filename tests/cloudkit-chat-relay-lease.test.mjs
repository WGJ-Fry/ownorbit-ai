import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("CloudKit chat relay lease is exclusive, releasable, and recoverable after expiry", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-lease-"));
  try {
    const script = `
      const { runMigrations } = await import("./server/migrations.ts");
      const {
        acquireCloudKitChatRelayLease,
        assertCloudKitChatRelayLease,
        releaseCloudKitChatRelayLease,
        renewCloudKitChatRelayLease,
      } = await import("./server/cloudKitChatRelayLease.ts");
      runMigrations();
      const now = 1700000000000;
      const first = acquireCloudKitChatRelayLease({ now, leaseMs: 30_000 });
      const blocked = acquireCloudKitChatRelayLease({ now: now + 1, leaseMs: 30_000 });
      const renewed = renewCloudKitChatRelayLease(first.lease, { now: now + 2, leaseMs: 30_000 });
      const stillOwned = assertCloudKitChatRelayLease(first.lease, now + 3);
      const wrongRelease = releaseCloudKitChatRelayLease("wrong-lease");
      const released = releaseCloudKitChatRelayLease(first.lease.leaseId, first.lease.fencingToken);
      const second = acquireCloudKitChatRelayLease({ now: now + 4, leaseMs: 30_000 });
      const staleRenewal = renewCloudKitChatRelayLease(first.lease, { now: now + 5, leaseMs: 30_000 });
      const expiredReplacement = acquireCloudKitChatRelayLease({ now: now + 30_005, leaseMs: 30_000 });
      process.stdout.write(JSON.stringify({
        first,
        blocked,
        renewed,
        stillOwned,
        wrongRelease,
        released,
        second,
        staleRenewal,
        expiredReplacement,
      }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.first.acquired, true);
    assert.equal(output.blocked.acquired, false);
    assert.equal(output.blocked.lease.leaseId, output.first.lease.leaseId);
    assert.equal(output.renewed, true);
    assert.equal(output.stillOwned, true);
    assert.equal(output.wrongRelease, false);
    assert.equal(output.released, true);
    assert.equal(output.second.acquired, true);
    assert.equal(output.second.lease.fencingToken, output.first.lease.fencingToken + 1);
    assert.equal(output.staleRenewal, false);
    assert.equal(output.expiredReplacement.acquired, true);
    assert.notEqual(output.expiredReplacement.lease.leaseId, output.second.lease.leaseId);
    assert.equal(output.expiredReplacement.lease.fencingToken, output.second.lease.fencingToken + 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
