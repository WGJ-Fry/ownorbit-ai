import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runScript(dataDir, script) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("relay schedule survives a server restart without storing chat payloads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-chat-relay-schedule-"));
  const dataDir = path.join(dir, "data");
  try {
    const first = runScript(dataDir, `
      const { runMigrations } = await import("./server/migrations.ts");
      runMigrations();
      const schedule = await import("./server/cloudKitChatRelaySchedule.ts");
      const now = 1700000000000;
      let cycleClockValue = 0;
      const due = await schedule.runDueCloudKitChatRelay(now, {
        getReadiness: () => ({
          enabled: true,
          ready: true,
          status: "ready",
          privacy: {
            syncsChatHistory: false,
            syncsMemory: false,
            syncsTasks: false,
            syncsGeneratedApps: false,
          },
        }),
        runCycle: async (options) => {
          cycleClockValue = options.clock();
          return {
            ok: true,
            status: "completed",
            safety: { rawPayloadReturned: false },
          };
        },
        clock: () => now + 25,
      });
      process.stdout.write(JSON.stringify({
        due,
        cycleClockValue,
        state: schedule.getCloudKitChatRelaySchedule(now + 25),
      }));
    `);
    assert.equal(first.due.skipped, false);
    assert.equal(first.state.lastStatus, "completed");
    assert.equal(first.cycleClockValue, 1700000000000 + 25);
    assert.equal(first.state.nextRunAt, 1700000000000 + 25 + 20_000);
    assert.equal(first.state.rawPayloadStored, false);
    assert.equal(JSON.stringify(first.state).includes("prompt"), false);

    const afterRestart = runScript(dataDir, `
      const { runMigrations } = await import("./server/migrations.ts");
      runMigrations();
      const schedule = await import("./server/cloudKitChatRelaySchedule.ts");
      const now = 1700000000000 + 1000;
      const state = schedule.getCloudKitChatRelaySchedule(now);
      const early = await schedule.runDueCloudKitChatRelay(now, {
        getReadiness: () => { throw new Error("must not inspect readiness before due"); },
        runCycle: async () => { throw new Error("must not run before due"); },
      });
      process.stdout.write(JSON.stringify({ state, early }));
    `);
    assert.equal(afterRestart.state.lastStatus, "completed");
    assert.equal(afterRestart.early, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
