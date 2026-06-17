// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("diagnostic bundle redacts URL credentials, query secrets, and local paths", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-diagnostic-redaction-"));
  const oldDataDir = process.env.LIFEOS_DATA_DIR;
  const oldPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.APP_URL;
  const oldHost = process.env.LIFEOS_HOST;
  const oldPort = process.env.LIFEOS_PORT;
  const oldGeminiKey = process.env.GEMINI_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  const oldOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const oldLocalModelBaseUrl = process.env.LOCAL_MODEL_BASE_URL;
  const oldReleaseDir = process.env.LIFEOS_RELEASE_DIR;
  const releaseDir = path.join(dataDir, "private-release-token-should-not-leak");

  process.env.LIFEOS_DATA_DIR = dataDir;
  process.env.PUBLIC_BASE_URL = "https://user:password@example.com/lifeos?token=diagnostic-secret#debug";
  process.env.APP_URL = "";
  process.env.LIFEOS_HOST = "0.0.0.0";
  process.env.LIFEOS_PORT = "4321";
  process.env.GEMINI_API_KEY = "AIzaSy-diagnostic-provider-secret";
  process.env.OPENAI_API_KEY = "sk-diagnostic-openai-secret";
  process.env.OPENROUTER_API_KEY = "sk-or-diagnostic-secret";
  process.env.LOCAL_MODEL_BASE_URL = "http://user:password@127.0.0.1:11434/v1?token=local-secret";
  process.env.LIFEOS_RELEASE_DIR = releaseDir;
  const releaseSha256 = "b".repeat(64);
  await mkdir(path.join(releaseDir, "update-feed"), { recursive: true });
  await writeFile(path.join(releaseDir, "SHA256SUMS"), `${releaseSha256}  LifeOS AI-0.0.0-arm64-unsigned.zip\n`);
  await writeFile(path.join(releaseDir, "update-feed", "release-manifest.json"), `${JSON.stringify({
    version: "0.0.0",
    generatedAt: new Date(0).toISOString(),
    artifacts: [{
      platform: "mac",
      feedFile: "latest-mac.yml",
      fileName: path.join(releaseDir, "LifeOS AI-0.0.0-arm64-unsigned.zip"),
      size: 1234,
      sha512: "fake-sha512",
      sha256: releaseSha256,
      releaseDate: new Date(0).toISOString(),
    }],
  }, null, 2)}\n`);

  t.after(async () => {
    if (oldDataDir === undefined) delete process.env.LIFEOS_DATA_DIR;
    else process.env.LIFEOS_DATA_DIR = oldDataDir;
    if (oldPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldPublicBaseUrl;
    if (oldAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = oldAppUrl;
    if (oldHost === undefined) delete process.env.LIFEOS_HOST;
    else process.env.LIFEOS_HOST = oldHost;
    if (oldPort === undefined) delete process.env.LIFEOS_PORT;
    else process.env.LIFEOS_PORT = oldPort;
    if (oldGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldGeminiKey;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
    if (oldOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldOpenRouterKey;
    if (oldLocalModelBaseUrl === undefined) delete process.env.LOCAL_MODEL_BASE_URL;
    else process.env.LOCAL_MODEL_BASE_URL = oldLocalModelBaseUrl;
    if (oldReleaseDir === undefined) delete process.env.LIFEOS_RELEASE_DIR;
    else process.env.LIFEOS_RELEASE_DIR = oldReleaseDir;
    await rm(dataDir, { recursive: true, force: true });
  });

  const auditModule = await import(`../server/audit.ts?diagnostic=${Date.now()}`);
  auditModule.insertAuditLog("diagnostic_redaction_seed", "network", "https://user:password@example.com/pair?token=audit-secret#frag", {
    command: `PUBLIC_BASE_URL=${process.env.PUBLIC_BASE_URL} npm run start`,
    localPath: path.join(dataDir, "lifeos.db"),
  });
  const remoteValidationModule = await import(`../server/remoteValidationReport.ts?diagnostic=${Date.now()}`);
  const remoteAcceptanceModule = await import(`../server/remoteAcceptance.ts?diagnostic=${Date.now()}`);
  remoteValidationModule.saveRemoteValidationReport({
    label: "Remote health check after auto-restore",
    baseUrl: "https://example.com/lifeos",
    result: {
      ok: true,
      status: 200,
      url: "https://user:password@example.com/lifeos/api/v1/health?token=remote-secret#frag",
      latencyMs: 12,
      steps: [
        { id: "health", ok: true, status: 200, url: "https://example.com/lifeos/api/v1/health?token=remote-secret", latencyMs: 4 },
        { id: "mobile-shell", ok: true, status: 200, url: "https://example.com/lifeos/mobile/chat?token=remote-secret", latencyMs: 4 },
        { id: "websocket", ok: true, status: 101, url: "wss://example.com/lifeos/api/v1/ws?token=remote-secret", latencyMs: 4 },
      ],
    },
  }, { type: "system", id: "diagnostic-test" });
  remoteAcceptanceModule.saveRemoteAcceptanceRecord({
    id: "cellular-mobile-chat",
    baseUrl: "https://example.com/lifeos",
    note: "Phone cellular passed token=remote-secret",
  }, { type: "admin", id: "owner" });
  remoteAcceptanceModule.saveRemoteAcceptanceRunbookReport({
    generatedAt: "2026-06-17T00:00:00.000Z",
    baseUrl: "https://example.com/lifeos",
    entryKind: "stable-https",
    longTermReady: true,
    longTermReason: "Ready token=remote-secret",
    automatedChecks: {
      ok: true,
      passed: 3,
      total: 3,
      latencyMs: 12,
      steps: [
        { id: "health", ok: true, status: 200, url: "https://example.com/lifeos/api/v1/health", latencyMs: 4 },
      ],
    },
    manualAcceptance: [{ id: "cellular-mobile-chat", title: "Phone cellular", required: true }],
  }, { type: "admin", id: "owner" });

  const { createDiagnosticBundle } = await import(`../server/diagnosticBundle.ts?diagnostic=${Date.now()}`);
  const bundle = createDiagnosticBundle();
  const serialized = JSON.stringify(bundle);

  assert.equal(serialized.includes("diagnostic-secret"), false);
  assert.equal(serialized.includes("audit-secret"), false);
  assert.equal(serialized.includes("AIzaSy-diagnostic-provider-secret"), false);
  assert.equal(serialized.includes("sk-diagnostic-openai-secret"), false);
  assert.equal(serialized.includes("sk-or-diagnostic-secret"), false);
  assert.equal(serialized.includes("local-secret"), false);
  assert.equal(serialized.includes("remote-secret"), false);
  assert.equal(bundle.remote.acceptanceRunbooks.total, 1);
  assert.equal(bundle.remote.acceptanceRunbooks.latest[0].entryKind, "stable-https");
  assert.equal(serialized.includes("remote-secret"), false);
  assert.equal(serialized.includes("private-release-token-should-not-leak"), false);
  assert.equal(serialized.includes("user:password"), false);
  assert.equal(serialized.includes(dataDir), false);
  assert.equal(serialized.includes("LOCAL_MODEL_BASE_URL\":\"http"), false);
  assert.equal(bundle.environment.GEMINI_API_KEY_CONFIGURED, true);
  assert.equal(bundle.environment.OPENAI_API_KEY_CONFIGURED, true);
  assert.equal(bundle.environment.OPENROUTER_API_KEY_CONFIGURED, true);
  assert.equal(bundle.environment.LOCAL_MODEL_BASE_URL_CONFIGURED, true);
  assert.equal(bundle.network.publicBaseUrl, "https://example.com/lifeos");
  assert.equal(bundle.network.recommendedBaseUrl, "https://example.com/lifeos");
  assert.equal(bundle.remote.healthSummary.status, "healthy");
  assert.equal(bundle.remote.validationReport.ok, true);
  assert.equal(bundle.remote.acceptanceChecklist.some((item) => item.id === "cellular-mobile-chat" && item.status === "passed"), true);
  assert.equal(bundle.remote.acceptanceRecords.total, 1);
  assert.equal(bundle.release.manifestAvailable, true);
  assert.equal(bundle.release.checksumAvailable, true);
  assert.equal(bundle.release.artifactCount, 1);
  assert.deepEqual(bundle.release.artifacts[0], {
    platform: "mac",
    fileName: "LifeOS AI-0.0.0-arm64-unsigned.zip",
    feedFile: "latest-mac.yml",
    size: 1234,
    sha512Present: true,
    sha256: releaseSha256,
    releaseDate: new Date(0).toISOString(),
  });
  assert.ok(bundle.ai.providers.every((provider) => !("apiKey" in provider)));
});
