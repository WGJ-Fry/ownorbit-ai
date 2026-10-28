import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readIdentity(dataDir) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    runMigrations();
    const protocol = await import("./server/cloudKitChatProtocol.ts");
    const identity = await import("./server/cloudKitMacIdentity.ts");
    const unsigned = protocol.parseCloudKitChatResponsePayload({
      schemaVersion: 1,
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      responseId: protocol.cloudKitChatResponseId("123e4567-e89b-42d3-a456-426614174000"),
      conversationId: "223e4567-e89b-42d3-a456-426614174000",
      assistantMessageId: "323e4567-e89b-42d3-a456-426614174000",
      status: "completed",
      text: "Identity continuity test.",
      requestContentHash: "a".repeat(64),
      startedAt: 1700000000000,
      completedAt: 1700000001000,
      updatedAt: 1700000001000,
    });
    const signed = identity.signCloudKitChatResponse(unsigned);
    protocol.verifyCloudKitChatResponseSignature(signed);
    process.stdout.write(JSON.stringify({
      fingerprint: signed.macPublicKeyFingerprint,
      publicKey: signed.macPublicKey,
      signatureValid: true,
    }));
  `;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
}

test("CloudKit Mac response identity survives a process restart and remains verifiable", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-mac-identity-"));
  try {
    const first = readIdentity(dataDir);
    const second = readIdentity(dataDir);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const firstIdentity = JSON.parse(first.stdout);
    const secondIdentity = JSON.parse(second.stdout);
    assert.match(firstIdentity.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(firstIdentity.signatureValid, true);
    assert.deepEqual(secondIdentity, firstIdentity);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// isUnsignedDesktop() only holds on macOS; elsewhere there is no Keychain
// identity to archive and the system-storage path applies instead.
test("unsigned macOS archives an inaccessible Keychain identity without decrypting it", { skip: process.platform !== "darwin" }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-unsigned-identity-"));
  try {
    const script = `
      const { runMigrations } = await import("./server/migrations.ts");
      const { db } = await import("./server/db.ts");
      runMigrations();
      const now = Date.now();
      db.prepare(\`
        INSERT INTO app_secrets (id, provider, secret_storage, ciphertext, iv, auth_tag, created_at, updated_at)
        VALUES ('internal.cloudkit-chat-mac-identity.v1', 'internal', 'electron_safe_storage',
          'ciphertext-that-must-not-be-decrypted', 'electron_safe_storage', '', ?, ?)
      \`).run(now, now);
      const identity = await import("./server/cloudKitMacIdentity.ts");
      const publicIdentity = identity.getCloudKitMacIdentityPublic();
      const rows = db.prepare(\`
        SELECT id, secret_storage as storage
        FROM app_secrets
        WHERE provider = 'internal' AND id LIKE 'internal.cloudkit-chat-mac-identity%'
        ORDER BY id
      \`).all();
      process.stdout.write(JSON.stringify({ publicIdentity, rows }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_DATA_DIR: dataDir, LIFEOS_DISTRIBUTION: "unsigned" },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.match(payload.publicIdentity.publicKeyFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(payload.rows.length, 2);
    assert.deepEqual(payload.rows.map((row) => row.storage).sort(), ["electron_safe_storage", "local_aes_gcm"]);
    assert.equal(payload.rows.some((row) => row.id === "internal.cloudkit-chat-mac-identity.v1" && row.storage === "local_aes_gcm"), true);
    assert.equal(payload.rows.some((row) => row.id.includes("archived-unsigned-keychain") && row.storage === "electron_safe_storage"), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
