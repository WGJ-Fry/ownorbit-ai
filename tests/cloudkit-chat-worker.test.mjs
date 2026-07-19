import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function runWorkerScenario(dataDir, scenario) {
  const script = `
    const { runMigrations } = await import("./server/migrations.ts");
    runMigrations();
    const jobs = await import("./server/cloudKitChatJobs.ts");
    const worker = await import("./server/cloudKitChatWorker.ts");
    const now = 1700000000000;
    const request = {
      schemaVersion: 1,
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      conversationId: "223e4567-e89b-42d3-a456-426614174000",
      userMessageId: "323e4567-e89b-42d3-a456-426614174000",
      sourceDeviceHash: "a".repeat(64),
      prompt: "Plan a safe focus block.",
      locale: "en-US",
      status: "queued",
      clientSequence: 1,
      createdAt: now,
      expiresAt: now + 3600000,
      syncMutation: { kind: "chat-request", origin: "ios-native", mutatedAt: now },
    };
    jobs.enqueueCloudKitChatRequest(request, {
      recordName: "chat-request:" + request.requestId,
      contentHash: "b".repeat(64),
      importedAt: now,
      now,
    });
    let generatorInput;
    const scenario = ${JSON.stringify(scenario)};
    const generate = async (input) => {
      generatorInput = input;
      if (scenario === "missing-config") {
        const error = new Error("provider not configured");
        error.code = "AI_CONFIG_MISSING";
        throw error;
      }
      if (scenario === "temporary") throw new Error("503 service unavailable");
      if (scenario === "tool") return {
        providerId: "openai", providerName: "OpenAI", model: "gpt-test", text: "",
        functionCalls: [{ name: "open_url", args: { url: "https://example.com" } }],
      };
      return {
        providerId: "openai",
        providerName: "OpenAI",
        model: "gpt-test",
        text: "Reserve 45 minutes and silence notifications.",
      };
    };
    const result = await worker.runCloudKitChatWorkerQueue({ now: now + 10, limit: 3, generate });
    const job = jobs.getCloudKitChatJob(request.requestId);
    const response = jobs.listCloudKitChatResponsePayloads()[0];
    console.log(JSON.stringify({
      result,
      jobStatus: job.status,
      responseStatus: response?.status,
      safeErrorCode: response?.safeErrorCode,
      responseText: response?.text,
      systemInstruction: generatorInput?.systemInstruction,
      contents: generatorInput?.contents,
      generatorInputHasTools: Object.hasOwn(generatorInput || {}, "tools"),
    }));
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test("CloudKit chat worker generates a text-only response without exposing tools or payloads", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-worker-"));
  try {
    const output = runWorkerScenario(dataDir, "success");
    assert.equal(output.jobStatus, "completed");
    assert.equal(output.responseStatus, "completed");
    assert.match(output.responseText, /45 minutes/);
    assert.equal(output.generatorInputHasTools, false);
    assert.match(output.systemInstruction, /Never claim that you executed a local action/);
    assert.equal(output.contents.at(-1).parts[0].text, "Plan a safe focus block.");
    assert.equal(JSON.stringify(output.result).includes("Plan a safe focus block"), false);
    assert.equal(JSON.stringify(output.result).includes("45 minutes"), false);
    assert.equal(output.result.safety.toolExecutionEnabled, false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("CloudKit chat worker returns safe terminal errors for missing AI config and tool attempts", async () => {
  for (const [scenario, expectedCode] of [["missing-config", "ai-not-configured"], ["tool", "remote-action-blocked"]]) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), `ownorbit-cloudkit-chat-worker-${scenario}-`));
    try {
      const output = runWorkerScenario(dataDir, scenario);
      assert.equal(output.jobStatus, "failed");
      assert.equal(output.responseStatus, "failed");
      assert.equal(output.safeErrorCode, expectedCode);
      assert.equal(output.responseText, undefined);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }
});

test("CloudKit chat worker schedules bounded retries for temporary provider failures", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ownorbit-cloudkit-chat-worker-retry-"));
  try {
    const output = runWorkerScenario(dataDir, "temporary");
    assert.equal(output.jobStatus, "queued");
    assert.equal(output.result.retryScheduled, 1);
    assert.equal(output.result.items[0].safeErrorCode, "ai-temporarily-unavailable");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
