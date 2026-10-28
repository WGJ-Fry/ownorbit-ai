import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runIsolatedRelay(env, body) {
  const result = spawnRelayProcess(env, body);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function spawnRelayProcess(env, body) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", body],
    {
      cwd: rootDir,
      env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
}

function relayPayloadScript(extra) {
  return `
    const crypto = await import("node:crypto");
    const { runMigrations } = await import("./server/migrations.ts");
    const { db } = await import("./server/db.ts");
    const {
      claimNextCloudKitChatJob,
      completeCloudKitChatJob,
      enqueueCloudKitChatRequest,
      getCloudKitChatJob,
      listCloudKitChatResponsePayloads,
    } = await import("./server/cloudKitChatJobs.ts");
    runMigrations();
    const now = 1700000000000;
    const ids = {
      request: "10000000-0000-4000-8000-000000000001",
      conversation: "10000000-0000-4000-8000-000000000002",
      message: "10000000-0000-4000-8000-000000000003",
      device: "10000000-0000-4000-8000-000000000004",
    };
    const sourceDeviceHash = crypto.createHash("sha256").update(ids.device).digest("hex");
    const payload = {
      schemaVersion: 1,
      requestId: ids.request,
      conversationId: ids.conversation,
      userMessageId: ids.message,
      deviceId: ids.device,
      sourceDeviceHash,
      publicKeyFingerprint: "a".repeat(64),
      signature: "A".repeat(86),
      prompt: "private iPhone relay question",
      locale: "en-US",
      status: "queued",
      clientSequence: 1,
      createdAt: now,
      expiresAt: now + 60_000,
      syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
    };
    const contentHash = "b".repeat(64);
    ${extra}
  `;
}

test("CloudKit chat relay treats an existing relay lease as healthy in-progress work", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-busy-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      `
        const { runMigrations } = await import("./server/migrations.ts");
        const { acquireCloudKitChatRelayLease } = await import("./server/cloudKitChatRelayLease.ts");
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        runMigrations();
        const now = 1700000000000;
        const held = acquireCloudKitChatRelayLease({ now, leaseMs: 30_000 });
        const cycle = await runCloudKitChatRelayCycle({
          now: now + 1,
          readiness: {
            enabled: true,
            ready: true,
            status: "ready",
            privacy: {
              syncsChatHistory: false,
              syncsMemory: false,
              syncsTasks: false,
              syncsGeneratedApps: false,
            },
          },
        });
        process.stdout.write(JSON.stringify({ held, cycle }));
      `,
    );

    assert.equal(result.held.acquired, true);
    assert.equal(result.cycle.ok, true);
    assert.equal(result.cycle.status, "relay-busy");
    assert.equal(result.cycle.leaseExpiresAt, 1700000030000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay exports only matching responses and never local business data", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-export-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      relayPayloadScript(`
        db.prepare("INSERT INTO memories (id, title, content, sensitivity, created_at, updated_at) VALUES (?, ?, ?, 'normal', ?, ?)")
          .run("local-memory", "LOCAL MEMORY MARKER", "never upload this memory", now, now);
        db.prepare("INSERT INTO tasks (id, type, status, input_json, created_at) VALUES (?, 'private-task', 'pending', ?, ?)")
          .run("local-task", JSON.stringify({ marker: "LOCAL TASK MARKER" }), now);
        db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
          .run("20000000-0000-4000-8000-000000000001", "LOCAL CHAT MARKER", now, now);
        db.prepare("INSERT INTO messages (id, session_id, role, content_json, created_at) VALUES (?, ?, 'user', ?, ?)")
          .run(
            "20000000-0000-4000-8000-000000000002",
            "20000000-0000-4000-8000-000000000001",
            JSON.stringify({ parts: [{ text: "LOCAL MESSAGE MARKER" }] }),
            now,
          );
        enqueueCloudKitChatRequest(payload, {
          recordName: "chat-request:" + ids.request,
          contentHash,
          now,
        });
        const claimed = claimNextCloudKitChatJob({ now });
        completeCloudKitChatJob({
          requestId: claimed.requestId,
          leaseId: claimed.leaseId,
          text: "relay answer",
          providerLabel: "test-provider",
          modelLabel: "test-model",
          now: now + 1,
        });
        const { buildCloudKitChatRelayExportPackage } = await import("./server/cloudKitChatRelayBatch.ts");
        const batch = buildCloudKitChatRelayExportPackage({ now: new Date(now + 2) });
        process.stdout.write(JSON.stringify(batch));
      `),
    );

    assert.equal(result.ok, true);
    assert.equal(result.recordCount, 1);
    assert.deepEqual(result.helperSyncBatch.zones, [{ zone: "LifeOSChatRelayZone", records: 1 }]);
    assert.deepEqual(
      result.helperSyncBatch.records.map((record) => [record.zone, record.recordType]),
      [["LifeOSChatRelayZone", "LifeOSChatResponse"]],
    );
    assert.equal(result.safety.uploadsLocalHistory, false);
    assert.equal(result.safety.uploadsMemory, false);
    assert.equal(result.safety.uploadsTasks, false);
    assert.equal(result.safety.uploadsGeneratedApps, false);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("LOCAL MEMORY MARKER"), false);
    assert.equal(serialized.includes("LOCAL TASK MARKER"), false);
    assert.equal(serialized.includes("LOCAL CHAT MARKER"), false);
    assert.equal(serialized.includes("LOCAL MESSAGE MARKER"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay cycle pulls first, runs the worker, and uploads only the relay zone", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-cycle-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      relayPayloadScript(`
        enqueueCloudKitChatRequest(payload, {
          recordName: "chat-request:" + ids.request,
          contentHash,
          now,
        });
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        const operations = [];
        const exported = [];
        const emptyChanges = {
          scannedZones: ["LifeOSChatRelayZone"],
          changed: 0,
          deleted: 0,
          failed: 0,
          moreComing: false,
          changeTokenResetZones: [],
          rawPayloadIncluded: false,
          zones: [],
          changedRecords: [],
          deletedRecords: [],
        };
        const fakeRunHelper = async (_readiness, options) => {
          operations.push(options.operation);
          if (options.operation === "chat-claim") {
            return {
              ok: true,
              status: "passed",
              operation: options.operation,
              chatClaim: {
                attempted: true,
                acquired: true,
                busy: false,
                claimId: options.chatClaim.claimId,
              },
              warnings: [],
              errors: [],
            };
          }
          if (options.operation === "sync-export") {
            exported.push(options.syncExportPackage.helperSyncBatch);
            return {
              ok: true,
              status: "passed",
              operation: options.operation,
              syncExport: {
                attempted: options.syncExportPackage.helperSyncBatch.records.length,
                saved: options.syncExportPackage.helperSyncBatch.records.length,
                failed: 0,
                zones: options.syncExportPackage.helperSyncBatch.zones,
              },
              warnings: [],
              errors: [],
            };
          }
          return {
            ok: true,
            status: "passed",
            operation: options.operation,
            syncChangesPreview: emptyChanges,
            warnings: [],
            errors: [],
          };
        };
        const fakeWorker = async () => {
          const claimed = claimNextCloudKitChatJob({ now });
          completeCloudKitChatJob({
            requestId: claimed.requestId,
            leaseId: claimed.leaseId,
            text: "cycle relay answer",
            providerLabel: "test-provider",
            modelLabel: "test-model",
            now: now + 1,
          });
          return {
            status: "processed",
            processed: 1,
            completed: 1,
            retryScheduled: 0,
            failed: 0,
            expired: 0,
            items: [{ requestId: claimed.requestId, status: "completed" }],
            safety: {
              toolExecutionEnabled: false,
              promptReturnedToAdmin: false,
              responseReturnedToAdmin: false,
              credentialsPersistedToCloudKit: false,
            },
          };
        };
        const readiness = {
          enabled: true,
          ready: true,
          status: "ready",
          privacy: {
            syncsChatHistory: false,
            syncsMemory: false,
            syncsTasks: false,
            syncsGeneratedApps: false,
          },
        };
        const cycle = await runCloudKitChatRelayCycle({
          now,
          readiness,
          runHelper: fakeRunHelper,
          runWorker: fakeWorker,
        });
        const pendingAfterUpload = listCloudKitChatResponsePayloads();
        process.stdout.write(JSON.stringify({ cycle, operations, exported, pendingAfterUpload }));
      `),
    );

    assert.deepEqual(result.operations, ["sync-changes-preview", "chat-claim", "sync-export"]);
    assert.equal(result.cycle.ok, true);
    assert.equal(result.cycle.status, "completed");
    assert.equal(result.cycle.worker.completed, 1);
    assert.equal(result.cycle.export.delivered, 1);
    assert.deepEqual(result.pendingAfterUpload, []);
    assert.equal(result.exported.length, 1);
    assert.deepEqual(result.exported[0].zones, [{ zone: "LifeOSChatRelayZone", records: 1 }]);
    assert.deepEqual(
      result.exported[0].records.map((record) => [record.zone, record.recordType]),
      [["LifeOSChatRelayZone", "LifeOSChatResponse"]],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay idle cycle does not open the Mac identity store", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-idle-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      `
        const { runMigrations } = await import("./server/migrations.ts");
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        runMigrations();
        const operations = [];
        const cycle = await runCloudKitChatRelayCycle({
          now: 1700000000000,
          readiness: {
            enabled: true,
            ready: true,
            status: "ready",
            privacy: {
              syncsChatHistory: false,
              syncsMemory: false,
              syncsTasks: false,
              syncsGeneratedApps: false,
            },
          },
          getMacIdentity: () => {
            throw new Error("idle relay must not open the Mac identity store");
          },
          runHelper: async (_readiness, options) => {
            operations.push(options.operation);
            return {
              ok: true,
              status: "passed",
              operation: options.operation,
              syncChangesPreview: {
                scannedZones: ["LifeOSChatRelayZone"],
                changed: 0,
                deleted: 0,
                failed: 0,
                moreComing: false,
                changeTokenResetZones: [],
                rawPayloadIncluded: false,
                zones: [],
                changedRecords: [],
                deletedRecords: [],
              },
              warnings: [],
              errors: [],
            };
          },
          runWorker: async () => {
            throw new Error("idle relay must not run the AI worker");
          },
        });
        process.stdout.write(JSON.stringify({ cycle, operations }));
      `,
    );
    assert.equal(result.cycle.ok, true);
    assert.equal(result.cycle.status, "completed");
    assert.equal(result.cycle.worker.status, "idle");
    assert.deepEqual(result.operations, ["sync-changes-preview"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay restart recovers an uploaded response without calling AI twice", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-crash-recovery-"));
  const dataDir = path.join(dir, "data");
  const remoteRecordPath = path.join(dir, "remote-response.json");
  const env = {
    ...process.env,
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_CRASH_REMOTE_RECORD: remoteRecordPath,
  };
  try {
    const firstProcess = spawnRelayProcess(
      env,
      relayPayloadScript(`
        const fs = await import("node:fs");
        enqueueCloudKitChatRequest(payload, {
          recordName: "chat-request:" + ids.request,
          contentHash,
          now,
        });
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        const emptyChanges = {
          scannedZones: ["LifeOSChatRelayZone"],
          changed: 0,
          deleted: 0,
          failed: 0,
          moreComing: false,
          changeTokenResetZones: [],
          rawPayloadIncluded: false,
          zones: [],
          changedRecords: [],
          deletedRecords: [],
        };
        await runCloudKitChatRelayCycle({
          now,
          readiness: {
            enabled: true,
            ready: true,
            status: "ready",
            privacy: {
              syncsChatHistory: false,
              syncsMemory: false,
              syncsTasks: false,
              syncsGeneratedApps: false,
            },
          },
          runHelper: async (_readiness, options) => {
            if (options.operation === "sync-changes-preview") {
              return {
                ok: true,
                status: "passed",
                operation: options.operation,
                syncChangesPreview: emptyChanges,
                warnings: [],
                errors: [],
              };
            }
            if (options.operation === "chat-claim") {
              return {
                ok: true,
                status: "passed",
                operation: options.operation,
                chatClaim: {
                  attempted: true,
                  acquired: true,
                  busy: false,
                  claimId: options.chatClaim.claimId,
                },
                warnings: [],
                errors: [],
              };
            }
            if (options.operation === "sync-export") {
              fs.writeFileSync(
                process.env.LIFEOS_CRASH_REMOTE_RECORD,
                JSON.stringify(options.syncExportPackage.helperSyncBatch.records[0]),
                { mode: 0o600 },
              );
              process.exit(86);
            }
            throw new Error("unexpected helper operation " + options.operation);
          },
          runWorker: async () => {
            const claimed = claimNextCloudKitChatJob({ requestId: ids.request, now });
            completeCloudKitChatJob({
              requestId: claimed.requestId,
              leaseId: claimed.leaseId,
              text: "response uploaded before the desktop crash",
              providerLabel: "test-provider",
              modelLabel: "test-model",
              now: now + 1,
            });
            return {
              status: "processed",
              processed: 1,
              completed: 1,
              retryScheduled: 0,
              failed: 0,
              expired: 0,
              items: [{ requestId: ids.request, status: "completed" }],
              safety: {
                toolExecutionEnabled: false,
                promptReturnedToAdmin: false,
                responseReturnedToAdmin: false,
                credentialsPersistedToCloudKit: false,
              },
            };
          },
        });
      `),
    );
    assert.equal(firstProcess.status, 86, firstProcess.stderr || firstProcess.stdout);

    const recovered = runIsolatedRelay(
      env,
      `
        const fs = await import("node:fs");
        const { runMigrations } = await import("./server/migrations.ts");
        const { getCloudKitChatJob, listCloudKitChatResponsePayloads } = await import("./server/cloudKitChatJobs.ts");
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        runMigrations();
        const now = 1700000310000;
        const requestId = "10000000-0000-4000-8000-000000000001";
        const exportedRecord = JSON.parse(fs.readFileSync(process.env.LIFEOS_CRASH_REMOTE_RECORD, "utf8"));
        const remoteRecord = {
          zone: exportedRecord.zone,
          recordType: exportedRecord.recordType,
          recordName: exportedRecord.recordName,
          ...exportedRecord.fields,
          fullResync: false,
          modifiedAt: new Date(now).toISOString(),
        };
        const emptyChanges = {
          scannedZones: ["LifeOSChatRelayZone"],
          changed: 0,
          deleted: 0,
          failed: 0,
          moreComing: false,
          changeTokenResetZones: [],
          rawPayloadIncluded: false,
          zones: [],
          changedRecords: [],
          deletedRecords: [],
        };
        const operations = [];
        let aiCalls = 0;
        const cycle = await runCloudKitChatRelayCycle({
          now,
          readiness: {
            enabled: true,
            ready: true,
            status: "ready",
            privacy: {
              syncsChatHistory: false,
              syncsMemory: false,
              syncsTasks: false,
              syncsGeneratedApps: false,
            },
          },
          runHelper: async (_readiness, options) => {
            operations.push(options.operation);
            if (options.operation === "sync-changes-preview") {
              return {
                ok: true,
                status: "passed",
                operation: options.operation,
                evidenceId: "restart-preview",
                syncChangesPreview: { ...emptyChanges, changed: 1 },
                warnings: [],
                errors: [],
              };
            }
            if (options.operation === "sync-import-quarantine") {
              return {
                ok: true,
                status: "passed",
                operation: options.operation,
                evidenceId: "restart-import",
                syncImportQuarantine: {
                  ...emptyChanges,
                  changed: 1,
                  changedRecords: [remoteRecord],
                },
                warnings: [],
                errors: [],
              };
            }
            throw new Error("unexpected helper operation " + options.operation);
          },
          runWorker: async () => {
            aiCalls += 1;
            throw new Error("AI must not run after the uploaded response is recovered");
          },
        });
        const job = getCloudKitChatJob(requestId);
        process.stdout.write(JSON.stringify({
          cycle,
          operations,
          aiCalls,
          job: {
            status: job.status,
            responseExportedAt: job.responseExportedAt,
            responseExportedUpdatedAt: job.responseExportedUpdatedAt,
            responseExportedContentHash: job.responseExportedContentHash,
          },
          pendingResponses: listCloudKitChatResponsePayloads().length,
        }));
      `,
    );

    assert.equal(recovered.cycle.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.cycle.status, "completed");
    assert.deepEqual(recovered.operations, ["sync-changes-preview", "sync-import-quarantine"]);
    assert.equal(recovered.aiCalls, 0);
    assert.equal(recovered.job.status, "completed");
    assert.equal(recovered.job.responseExportedAt > 0, true);
    assert.equal(recovered.job.responseExportedUpdatedAt, 1700000000001);
    assert.match(recovered.job.responseExportedContentHash, /^[a-f0-9]{64}$/);
    assert.equal(recovered.pendingResponses, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay cycle leaves a request pinned to another Mac untouched", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-trusted-mac-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      relayPayloadScript(`
        payload.trustedMacFingerprint = "f".repeat(64);
        enqueueCloudKitChatRequest(payload, {
          recordName: "chat-request:" + ids.request,
          contentHash,
          now,
        });
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        const operations = [];
        let workerCalled = false;
        const fakeRunHelper = async (_readiness, options) => {
          operations.push(options.operation);
          return {
            ok: true,
            status: "passed",
            operation: options.operation,
            syncChangesPreview: {
              scannedZones: ["LifeOSChatRelayZone"],
              changed: 0,
              deleted: 0,
              failed: 0,
              moreComing: false,
              changeTokenResetZones: [],
              rawPayloadIncluded: false,
              zones: [],
              changedRecords: [],
              deletedRecords: [],
            },
            warnings: [],
            errors: [],
          };
        };
        const readiness = {
          enabled: true,
          ready: true,
          status: "ready",
          privacy: {
            syncsChatHistory: false,
            syncsMemory: false,
            syncsTasks: false,
            syncsGeneratedApps: false,
          },
        };
        const cycle = await runCloudKitChatRelayCycle({
          now,
          readiness,
          runHelper: fakeRunHelper,
          runWorker: async () => {
            workerCalled = true;
            throw new Error("worker must not run for another trusted Mac");
          },
        });
        process.stdout.write(JSON.stringify({
          status: cycle.status,
          workerStatus: cycle.worker.status,
          operations,
          workerCalled,
          jobStatus: getCloudKitChatJob(ids.request).status,
        }));
      `),
    );

    assert.deepEqual(result, {
      status: "completed",
      workerStatus: "idle",
      operations: ["sync-changes-preview"],
      workerCalled: false,
      jobStatus: "queued",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay does not call the AI worker when another Mac owns the global claim", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-global-claim-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      relayPayloadScript(`
        enqueueCloudKitChatRequest(payload, {
          recordName: "chat-request:" + ids.request,
          contentHash,
          now,
        });
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        let workerCalls = 0;
        const readiness = {
          enabled: true,
          ready: true,
          status: "ready",
          privacy: {
            syncsChatHistory: false,
            syncsMemory: false,
            syncsTasks: false,
            syncsGeneratedApps: false,
          },
        };
        const emptyChanges = {
          scannedZones: [],
          changed: 0,
          deleted: 0,
          failed: 0,
          moreComing: false,
          changeTokenResetZones: [],
          rawPayloadIncluded: false,
          zones: [],
          changedRecords: [],
          deletedRecords: [],
        };
        const cycle = await runCloudKitChatRelayCycle({
          now,
          readiness,
          runHelper: async (_readiness, options) => {
            if (options.operation === "sync-changes-preview") {
              return {
                ok: true,
                status: "passed",
                operation: options.operation,
                syncChangesPreview: emptyChanges,
                warnings: [],
                errors: [],
              };
            }
            if (options.operation === "chat-claim") {
              return {
                ok: true,
                status: "passed",
                operation: options.operation,
                chatClaim: {
                  attempted: true,
                  acquired: false,
                  busy: true,
                  ownerMatches: false,
                },
                warnings: [],
                errors: [],
              };
            }
            throw new Error("unexpected helper operation " + options.operation);
          },
          runWorker: async () => {
            workerCalls += 1;
            throw new Error("worker must not run without the global CloudKit claim");
          },
        });
        process.stdout.write(JSON.stringify({
          cycle,
          workerCalls,
          jobStatus: getCloudKitChatJob(ids.request)?.status,
        }));
      `),
    );

    assert.equal(result.cycle.ok, false);
    assert.equal(result.cycle.status, "claim-busy");
    assert.equal(result.cycle.claim.chatClaim.busy, true);
    assert.equal(result.workerCalls, 0);
    assert.equal(result.jobStatus, "queued");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat relay cycle verifies and applies a signed iPhone request before answering", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-signed-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      `
        const crypto = await import("node:crypto");
        const { runMigrations } = await import("./server/migrations.ts");
        const { db } = await import("./server/db.ts");
        const deviceProtocol = await import("./server/cloudKitDeviceKeyProtocol.ts");
        const chatProtocol = await import("./server/cloudKitChatProtocol.ts");
        const jobs = await import("./server/cloudKitChatJobs.ts");
        const deviceKeys = await import("./server/cloudKitDeviceKeys.ts");
        const { runCloudKitChatRelayCycle } = await import("./server/cloudKitChatRelayCycle.ts");
        runMigrations();
        const now = 1700000000000;
        const keyPair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        const publicKey = keyPair.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
        const deviceId = "50000000-0000-4000-8000-000000000001";
        const requestId = "50000000-0000-4000-8000-000000000002";
        const devicePayload = {
          schemaVersion: 1,
          deviceId,
          deviceIdHash: deviceProtocol.cloudKitDeviceIdHash(deviceId),
          displayName: "Test iPhone",
          deviceType: "ios",
          channelScope: "cloudkit-chat",
          publicKey,
          publicKeyFingerprint: deviceProtocol.cloudKitDeviceKeyFingerprint(publicKey),
          proofSignature: "",
          status: "active",
          createdAt: now,
          expiresAt: now + 30 * 24 * 60 * 60 * 1000,
          syncMutation: { kind: "device-key-register", origin: "ios-native", mutatedAt: now },
        };
        devicePayload.proofSignature = crypto.sign(
          "sha256",
          Buffer.from(deviceProtocol.cloudKitDeviceKeyProofText(devicePayload)),
          { key: keyPair.privateKey, dsaEncoding: "ieee-p1363" },
        ).toString("base64url");
        const requestPayload = {
          schemaVersion: 1,
          requestId,
          conversationId: "50000000-0000-4000-8000-000000000003",
          userMessageId: "50000000-0000-4000-8000-000000000004",
          deviceId,
          sourceDeviceHash: devicePayload.deviceIdHash,
          publicKeyFingerprint: devicePayload.publicKeyFingerprint,
          signature: "",
          prompt: "Answer this signed iPhone request.",
          locale: "en-US",
          status: "queued",
          clientSequence: 1,
          createdAt: now,
          expiresAt: now + 60_000,
          syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
        };
        requestPayload.signature = crypto.sign(
          "sha256",
          Buffer.from(chatProtocol.cloudKitChatRequestSignatureText(requestPayload)),
          { key: keyPair.privateKey, dsaEncoding: "ieee-p1363" },
        ).toString("base64url");
        const changedRecord = (recordType, recordName, mutationId, payload, logicalClock) => {
          const payloadJson = JSON.stringify(payload);
          return {
            zone: "LifeOSChatRelayZone",
            recordType,
            recordName,
            lifeosSchema: "lifeos-cloudkit-record.v1",
            lifeosDataType: "chat-relay",
            sourceIdHash: "chat-relay:" + crypto.createHash("sha256").update(recordName).digest("hex").slice(0, 16),
            mutationId,
            logicalClock,
            contentHash: crypto.createHash("sha256").update(payloadJson).digest("hex"),
            payloadByteSize: Buffer.byteLength(payloadJson),
            requiresUserReview: false,
            fullResync: false,
            payloadJson,
            modifiedAt: new Date(now).toISOString(),
          };
        };
        const records = [
          changedRecord(
            "LifeOSDeviceKey",
            deviceProtocol.cloudKitDeviceKeyRecordName(devicePayload.deviceIdHash),
            "ios-device-key:" + deviceId,
            devicePayload,
            now,
          ),
          changedRecord(
            "LifeOSChatRequest",
            "chat-request:" + requestId,
            "ios-chat-request:" + requestId,
            requestPayload,
            now,
          ),
        ];
        const operations = [];
        let previewCalls = 0;
        let uploaded;
        const emptyChanges = {
          scannedZones: ["LifeOSChatRelayZone"],
          changed: 0,
          deleted: 0,
          failed: 0,
          moreComing: false,
          changeTokenResetZones: [],
          rawPayloadIncluded: false,
          zones: [],
          changedRecords: [],
          deletedRecords: [],
        };
        const runHelper = async (_readiness, options) => {
          operations.push(options.operation);
          if (options.operation === "sync-changes-preview") {
            previewCalls += 1;
            return {
              ok: true,
              status: "passed",
              operation: options.operation,
              evidenceId: "signed-preview",
              syncChangesPreview: { ...emptyChanges, changed: previewCalls === 1 ? 2 : 0 },
              warnings: [],
              errors: [],
            };
          }
          if (options.operation === "sync-import-quarantine") {
            return {
              ok: true,
              status: "passed",
              operation: options.operation,
              evidenceId: "signed-import",
              syncImportQuarantine: {
                ...emptyChanges,
                changed: 2,
                changedRecords: records,
              },
              warnings: [],
              errors: [],
            };
          }
          if (options.operation === "chat-claim") {
            return {
              ok: true,
              status: "passed",
              operation: options.operation,
              chatClaim: {
                attempted: true,
                acquired: true,
                busy: false,
                claimId: options.chatClaim.claimId,
              },
              warnings: [],
              errors: [],
            };
          }
          if (options.operation === "sync-export") {
            uploaded = options.syncExportPackage.helperSyncBatch;
            return {
              ok: true,
              status: "passed",
              operation: options.operation,
              syncExport: { attempted: uploaded.records.length, saved: uploaded.records.length, failed: 0, zones: uploaded.zones },
              warnings: [],
              errors: [],
            };
          }
          throw new Error("unexpected helper operation " + options.operation);
        };
        const runWorker = async () => {
          const claimed = jobs.claimNextCloudKitChatJob({ now: now + 3 });
          jobs.completeCloudKitChatJob({
            requestId: claimed.requestId,
            leaseId: claimed.leaseId,
            text: "Verified signed relay response.",
            providerLabel: "test-provider",
            modelLabel: "test-model",
            now: now + 4,
          });
          return {
            status: "processed",
            processed: 1,
            completed: 1,
            retryScheduled: 0,
            failed: 0,
            expired: 0,
            items: [{ requestId, status: "completed" }],
            safety: {
              toolExecutionEnabled: false,
              promptReturnedToAdmin: false,
              responseReturnedToAdmin: false,
              credentialsPersistedToCloudKit: false,
            },
          };
        };
        const firstCycle = await runCloudKitChatRelayCycle({
          now: now + 5,
          readiness: {
            enabled: true,
            ready: true,
            status: "ready",
            privacy: {
              syncsChatHistory: false,
              syncsMemory: false,
              syncsTasks: false,
              syncsGeneratedApps: false,
            },
          },
          runHelper,
          runWorker,
        });
        const pendingDevice = deviceKeys.listCloudKitChatDevices({ now: now + 6 }).items[0];
        const approval = deviceKeys.approveCloudKitChatDevice(pendingDevice.id, "test-admin", now + 7);
        const cycle = await runCloudKitChatRelayCycle({
          now: now + 8,
          readiness: {
            enabled: true,
            ready: true,
            status: "ready",
            privacy: {
              syncsChatHistory: false,
              syncsMemory: false,
              syncsTasks: false,
              syncsGeneratedApps: false,
            },
          },
          runHelper,
          runWorker,
        });
        const deviceCount = deviceKeys.countActiveCloudKitDevices(now + 9);
        process.stdout.write(JSON.stringify({
          firstCycle,
          pendingDevice,
          approval,
          cycle,
          operations,
          deviceCount,
          jobStatus: jobs.getCloudKitChatJob(requestId)?.status,
          uploaded,
        }));
      `,
    );

    assert.deepEqual(result.operations, [
      "sync-changes-preview",
      "sync-import-quarantine",
      "sync-changes-preview",
      "chat-claim",
      "sync-export",
    ]);
    assert.equal(result.firstCycle.ok, false);
    assert.equal(result.firstCycle.status, "relay-conflict");
    assert.equal(result.firstCycle.apply.applied, 1);
    assert.equal(result.firstCycle.apply.conflicts, 1);
    assert.equal(result.pendingDevice.state, "pending");
    assert.equal(result.approval.state, "approved");
    assert.equal(result.cycle.ok, true);
    assert.equal(result.cycle.apply.applied, 1);
    assert.equal(result.deviceCount, 1);
    assert.equal(result.jobStatus, "completed");
    assert.deepEqual(result.uploaded.zones, [{ zone: "LifeOSChatRelayZone", records: 1 }]);
    assert.equal(result.uploaded.records[0].recordType, "LifeOSChatResponse");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit chat conversations cannot be taken over by another device or a remote id collision", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-owner-"));
  try {
    const result = runIsolatedRelay(
      { ...process.env, LIFEOS_DATA_DIR: path.join(dir, "data") },
      relayPayloadScript(`
        enqueueCloudKitChatRequest(payload, {
          recordName: "chat-request:" + ids.request,
          contentHash,
          now,
        });
        const other = {
          ...payload,
          requestId: "30000000-0000-4000-8000-000000000001",
          userMessageId: "30000000-0000-4000-8000-000000000002",
          deviceId: "30000000-0000-4000-8000-000000000003",
          sourceDeviceHash: crypto.createHash("sha256").update("30000000-0000-4000-8000-000000000003").digest("hex"),
          clientSequence: 2,
        };
        let takeoverError = "";
        try {
          enqueueCloudKitChatRequest(other, {
            recordName: "chat-request:" + other.requestId,
            contentHash: "c".repeat(64),
            now,
          });
        } catch (error) {
          takeoverError = error.message;
        }

        const localConversationId = "40000000-0000-4000-8000-000000000001";
        db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, 'local-only', ?, ?)")
          .run(localConversationId, now, now);
        const collision = {
          ...payload,
          requestId: "40000000-0000-4000-8000-000000000002",
          conversationId: localConversationId,
          userMessageId: "40000000-0000-4000-8000-000000000003",
          clientSequence: 3,
        };
        let collisionError = "";
        try {
          enqueueCloudKitChatRequest(collision, {
            recordName: "chat-request:" + collision.requestId,
            contentHash: "d".repeat(64),
            now,
          });
        } catch (error) {
          collisionError = error.message;
        }
        const ownerRows = db.prepare("SELECT conversation_id, source_device_hash FROM cloudkit_chat_conversation_owners ORDER BY conversation_id").all();
        process.stdout.write(JSON.stringify({ takeoverError, collisionError, ownerRows }));
      `),
    );

    assert.match(result.takeoverError, /another device/);
    assert.match(result.collisionError, /existing local conversation/);
    assert.equal(result.ownerRows.length, 1);
    assert.equal(result.ownerRows[0].conversation_id, "10000000-0000-4000-8000-000000000002");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
