import assert from "node:assert/strict";
import test from "node:test";

test("onboarding handoff summary is actionable and excludes sensitive values", async () => {
  const { buildOnboardingHandoffSummary } = await import(`../src/services/onboardingHandoffSummary.ts?case=${Date.now()}`);
  const summary = buildOnboardingHandoffSummary({
    providers: [
      {
        id: "openai",
        provider: "OpenAI",
        configured: true,
        active: true,
        enabled: true,
        envVar: "OPENAI_API_KEY",
        source: "system_secure_store",
        selectedModel: "gpt-4o-mini",
        restartRequired: false,
        recommendations: [],
      },
    ],
    backups: [{ file: "lifeos-backup-2026.db", size: 1024, createdAt: 1800000000000 }],
    backupSchedule: { enabled: false, intervalHours: 24 },
    devices: [{ id: "device_secret_id", name: "Phone", type: "mobile", status: "online", createdAt: 1, lastSeenAt: 2 }],
    diagnostics: {
      ai: {
        configured: true,
        id: "openai",
        provider: "OpenAI",
        envVar: "OPENAI_API_KEY",
        source: "system_secure_store",
        restartRequired: false,
        recommendations: [],
      },
      network: {
        host: "127.0.0.1",
        publicBaseUrl: "https://lifeos.example.test",
        publicAccessAllowed: true,
        publicAccessWarning: false,
        recommendations: [],
        remoteReadiness: { status: "ready" },
      },
      storage: {
        dataDir: "/Users/example/secret-lifeos-data",
        dataDirConfigured: true,
        backupRetentionCount: "20",
        backupSchedule: { enabled: false, intervalHours: 24 },
        recommendations: [],
      },
      release: {
        manifestAvailable: true,
        checksumAvailable: true,
        version: "0.1.1-alpha.0",
        generatedAt: "2026-06-24T00:00:00Z",
        artifactCount: 1,
        artifacts: [],
        recommendations: [],
      },
      securityCheck: {
        publicMode: true,
        overall: "warning",
        items: [{ id: "backupSchedule", label: "Backup", status: "warning", message: "Enable backups", action: "Enable automatic backups" }],
      },
    },
    onboarding: {
      completed: true,
      completedAt: 1800000000000,
      required: false,
      nextPath: "/chat",
      securityOverall: "warning",
      steps: [
        { id: "ai", label: "AI", done: true, actionPath: "/admin/onboarding", message: "ok" },
        { id: "backup", label: "Backup", done: true, actionPath: "/admin/onboarding", message: "ok" },
        { id: "device", label: "Device", done: true, actionPath: "/admin/devices/pair", message: "ok" },
        { id: "security", label: "Security", done: true, actionPath: "/admin/settings", message: "ok" },
      ],
    },
  });

  assert.match(summary, /LifeOS AI first-launch handoff/);
  assert.match(summary, /AI provider: OpenAI \(gpt-4o-mini\)/);
  assert.match(summary, /Automatic backups: disabled/);
  assert.match(summary, /Remote access readiness: ready/);
  assert.match(summary, /Security items needing attention: 1/);
  assert.match(summary, /Enable automatic backups/);
  assert.doesNotMatch(summary, /OPENAI_API_KEY/);
  assert.doesNotMatch(summary, /device_secret_id/);
  assert.doesNotMatch(summary, /secret-lifeos-data/);
});
