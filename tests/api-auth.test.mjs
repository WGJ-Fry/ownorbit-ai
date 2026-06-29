import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));

function request(port, pathname, options = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

function cookieHeader(response) {
  const cookie = response.headers.get("set-cookie") || "";
  assert.match(cookie, /lifeos_admin_session=/);
  assert.match(cookie, /lifeos_csrf=/);
  const session = cookie.match(/lifeos_admin_session=[^;,\s]+/)?.[0];
  const csrf = cookie.match(/lifeos_csrf=[^;,\s]+/)?.[0];
  assert.ok(session);
  assert.ok(csrf);
  return { Cookie: `${session}; ${csrf}`, "X-LifeOS-CSRF": decodeURIComponent(csrf.split("=")[1]) };
}

function createDeviceKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    privateKey,
  };
}

function signedDeviceHeaders({ deviceId, privateKey, method = "GET", pathname, body = "" }) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const bodyHash = crypto.createHash("sha256").update(body).digest("base64url");
  const payload = [method.toUpperCase(), pathname, bodyHash, timestamp, nonce].join("\n");
  const signature = crypto.sign("sha256", Buffer.from(payload), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return {
    "X-LifeOS-Device-ID": deviceId,
    "X-LifeOS-Device-Timestamp": timestamp,
    "X-LifeOS-Device-Nonce": nonce,
    "X-LifeOS-Device-Signature": signature,
  };
}

const sensitiveResponseKeys = new Set([
  "accesstoken",
  "accesstokenhash",
  "apikey",
  "api_key",
  "authtag",
  "auth_tag",
  "ciphertext",
  "hash",
  "iv",
  "passphrase",
  "password",
  "passwordhash",
  "password_hash",
  "path",
  "privatekey",
  "private_key",
  "secret",
  "token",
  "tokenhash",
]);

function collectUnexpectedSensitiveFields(value, options = {}, currentPath = []) {
  const allowedPaths = options.allowedPaths || new Set();
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUnexpectedSensitiveFields(item, options, [...currentPath, String(index)]));
  }
  return Object.entries(value).flatMap(([key, item]) => {
    const nextPath = [...currentPath, key];
    const pathKey = nextPath.join(".");
    if (item !== undefined && item !== null && sensitiveResponseKeys.has(key.toLowerCase()) && !allowedPaths.has(pathKey)) {
      return [pathKey];
    }
    return collectUnexpectedSensitiveFields(item, options, nextPath);
  });
}

function collectUnexpectedSensitiveStrings(value, options = {}, currentPath = []) {
  const allowedPaths = options.allowedPaths || new Set();
  if (typeof value === "string") {
    const leaks = [];
    const normalized = value.trim();
    const pathKey = currentPath.join(".") || "(root)";
    if (allowedPaths.has(pathKey)) return [];
    if (/\/Users\/[^\s,;"]+/.test(normalized) || /[A-Za-z]:\\[^\s,;"]+/.test(normalized)) {
      leaks.push(`${pathKey}: local path`);
    }
    if (/\b(github_pat_|ghp_|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{12,})/.test(normalized)) {
      leaks.push(`${pathKey}: secret-like token`);
    }
    try {
      const parsed = /^https?:\/\//i.test(normalized) || /^wss?:\/\//i.test(normalized) ? new URL(normalized) : null;
      if (parsed?.username || parsed?.password || parsed?.hash) {
        leaks.push(`${pathKey}: credentialed or fragment URL`);
      }
      for (const key of parsed?.searchParams.keys() || []) {
        if (/api[-_]?key|token|password|passphrase|secret|authorization|cookie/i.test(key)) {
          leaks.push(`${pathKey}: URL query secret`);
        }
      }
    } catch {}
    return leaks;
  }
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUnexpectedSensitiveStrings(item, options, [...currentPath, String(index)]));
  }
  return Object.entries(value).flatMap(([key, item]) => collectUnexpectedSensitiveStrings(item, options, [...currentPath, key]));
}

function assertPublicApiResponse(label, value, options = {}) {
  const leaks = collectUnexpectedSensitiveFields(value, options);
  assert.deepEqual(leaks, [], `${label} returned sensitive fields: ${leaks.join(", ")}`);
  const stringLeaks = collectUnexpectedSensitiveStrings(value, options);
  assert.deepEqual(stringLeaks, [], `${label} returned sensitive strings: ${stringLeaks.join(", ")}`);
}

function assertSecretNotLeaked(samples, secret, allowedLabels = new Set()) {
  if (!secret) return;
  for (const sample of samples) {
    if (allowedLabels.has(sample.label)) continue;
    assert.equal(JSON.stringify(sample.value).includes(secret), false, `${sample.label} leaked secret value`);
  }
}

async function waitForServer(port, child, output) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}\n${output.join("")}`);
    try {
      const response = await request(port, "/api/v1/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not become healthy");
}

async function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test("admin auth protects APIs and device binding enables mobile access", async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-auth-test-"));
  const releaseApiFixture = `data:application/json,${encodeURIComponent(JSON.stringify([
    {
      tag_name: "v0.1.4-alpha",
      name: "LifeOS AI v0.1.4-alpha",
      html_url: "https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.4-alpha",
      draft: false,
      prerelease: true,
      published_at: "2026-06-27T00:00:00.000Z",
      assets: [
        { name: "SHA256SUMS", size: 308, browser_download_url: "https://github.com/WGJ-Fry/lifeos-ai/releases/download/v0.1.4-alpha/SHA256SUMS" },
        { name: "LifeOS.AI.Setup.0.1.4-alpha.0.exe", size: 1000, browser_download_url: "https://github.com/WGJ-Fry/lifeos-ai/releases/download/v0.1.4-alpha/LifeOS.AI.Setup.0.1.4-alpha.0.exe" },
      ],
    },
  ]))}`;
  const child = spawn(process.execPath, ["dist/server.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LIFEOS_PORT: String(port),
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      GEMINI_API_KEY: "",
      LIFEOS_RELEASE_API_URL: releaseApiFixture,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childOutput = [];
  child.stdout.on("data", (chunk) => childOutput.push(chunk.toString()));
  child.stderr.on("data", (chunk) => childOutput.push(chunk.toString()));

  t.after(async () => {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(port, child, childOutput);

  const health = await request(port, "/api/v1/health").then((res) => res.json());
  assert.equal(health.host, "127.0.0.1");
  assert.equal(health.version, packageJson.version);
  assert.equal(health.networkMode, "local");
  assert.equal(health.publicAccessWarning, false);
  const healthHeaders = await request(port, "/api/v1/health");
  assert.equal(healthHeaders.headers.get("x-content-type-options"), "nosniff");
  assert.equal(healthHeaders.headers.get("referrer-policy"), "same-origin");

  const unauthDevices = await request(port, "/api/v1/devices");
  assert.equal(unauthDevices.status, 401);

  const unauthDiagnostics = await request(port, "/api/v1/admin/config-diagnostics");
  assert.equal(unauthDiagnostics.status, 401);

  const statusBefore = await request(port, "/api/v1/admin/status").then((res) => res.json());
  assert.equal(statusBefore.configured, false);

  const setupResponse = await request(port, "/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password: "correct horse battery staple" }),
  });
  const setup = await setupResponse.json();
  assert.equal(setup.token, undefined);
  assert.equal(typeof setup.expiresAt, "number");
  assert.equal(setup.onboardingRequired, true);
  assert.equal(setup.nextPath, "/admin/onboarding");

  const adminHeaders = cookieHeader(setupResponse);

  const statusAfter = await request(port, "/api/v1/admin/status", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(statusAfter.configured, true);
  assert.equal(statusAfter.authenticated, true);
  assert.equal(statusAfter.onboardingRequired, true);
  assert.equal(statusAfter.nextPath, "/admin/onboarding");

  const initialOnboarding = await request(port, "/api/v1/admin/onboarding", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(initialOnboarding.onboarding.completed, false);
  assert.equal(initialOnboarding.onboarding.required, true);
  assert.deepEqual(initialOnboarding.onboarding.steps.map((step) => step.id), ["ai", "backup", "device", "security"]);
  assert.equal(initialOnboarding.onboarding.steps.find((step) => step.id === "ai").done, false);
  assert.equal(initialOnboarding.onboarding.steps.find((step) => step.id === "backup").done, false);
  assert.equal(initialOnboarding.onboarding.steps.find((step) => step.id === "device").done, false);
  assert.equal(initialOnboarding.onboarding.steps.find((step) => step.id === "security").done, true);

  const incompleteOnboarding = await request(port, "/api/v1/admin/onboarding/complete", {
    method: "PUT",
    headers: adminHeaders,
  });
  assert.equal(incompleteOnboarding.status, 409);

  const diagnostics = await request(port, "/api/v1/admin/config-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(diagnostics.ai.provider, "Google Gemini");
  assert.equal(diagnostics.ai.envVar, "GEMINI_API_KEY");
  assert.equal(diagnostics.ai.source, "missing");
  assert.equal(typeof diagnostics.ai.secureStorage.systemAvailable, "boolean");
  assert.equal(diagnostics.ai.accessToken, undefined);
  assert.equal(diagnostics.network.host, "127.0.0.1");
  assert.equal(diagnostics.storage.dataDirConfigured, true);
  assert.equal(diagnostics.storage.dataDir, "Custom data directory configured");
  assert.equal(diagnostics.storage.backupRetentionCount, process.env.LIFEOS_BACKUP_RETENTION_COUNT || "20");
  assert.equal(diagnostics.storage.backupSchedule.enabled, false);
  assert.equal(diagnostics.storage.recommendations.some((item) => item.includes("scheduled backups")), true);
  assert.equal(typeof diagnostics.release.manifestAvailable, "boolean");
  assert.equal(typeof diagnostics.release.checksumAvailable, "boolean");
  assert.equal(typeof diagnostics.release.artifactCount, "number");
  assert.equal(Array.isArray(diagnostics.release.artifacts), true);
  const blockedReleaseUpdateCheck = await request(port, "/api/v1/admin/release/update-check");
  assert.equal(blockedReleaseUpdateCheck.status, 401);
  const releaseUpdateCheck = await request(port, "/api/v1/admin/release/update-check", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(releaseUpdateCheck.status, "up-to-date");
  assert.equal(releaseUpdateCheck.current.tag, "v0.1.4-alpha");
  assert.equal(releaseUpdateCheck.latest.tag, "v0.1.4-alpha");
  assert.equal(releaseUpdateCheck.latest.checksumAsset.name, "SHA256SUMS");
  assert.equal(releaseUpdateCheck.manualUpdateRequired, true);
  assert.equal(releaseUpdateCheck.autoUpdateEnabled, false);
  assert.ok(releaseUpdateCheck.manualUpdatePlan);
  assert.equal(typeof releaseUpdateCheck.manualUpdatePlan.checksumCommand, "string");
  assert.equal(releaseUpdateCheck.manualUpdatePlan.sha256Required, true);
  assert.equal(diagnostics.calendarSync.mode, "preview-only");
  assert.equal(diagnostics.calendarSync.externalWritesEnabled, false);
  assert.equal(diagnostics.calendarSync.writeBackSupported, false);
  assert.equal(diagnostics.calendarSync.summary.providersReadyForWrite, 0);
  assert.equal(Array.isArray(diagnostics.calendarSync.providers), true);
  assert.equal(diagnostics.calendarSync.providers.some((provider) => provider.id === "apple-calendar" && provider.writeSupported === false), true);
  assert.equal(JSON.stringify(diagnostics.release).includes(dataDir), false);
  assert.equal(JSON.stringify(diagnostics).includes(dataDir), false);
  assert.equal(diagnostics.securityCheck.overall, "warning");
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "backup" && item.status === "warning"), true);
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "backupSchedule" && item.status === "warning"), true);

  const blockedCalendarSyncPreview = await request(port, "/api/v1/admin/calendar-sync/preview");
  assert.equal(blockedCalendarSyncPreview.status, 401);
  const calendarSyncPreview = await request(port, "/api/v1/admin/calendar-sync/preview", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(calendarSyncPreview.mode, "preview-only");
  assert.equal(calendarSyncPreview.externalWritesEnabled, false);
  assert.equal(calendarSyncPreview.safety.requiresAuditLogBeforeWrite, true);
  const proposedCalendarSyncPreview = await request(port, "/api/v1/admin/calendar-sync/preview", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      proposedItems: [
        {
          providerId: "google-calendar",
          kind: "event",
          action: "create",
          title: "Follow up with Ada",
          startsAt: "2026-07-03T09:00:00.000Z",
        },
      ],
    }),
  }).then((res) => res.json());
  assert.equal(proposedCalendarSyncPreview.summary.blockedWrites, 1);
  assert.equal(proposedCalendarSyncPreview.operations.some((operation) => operation.providerId === "google-calendar" && operation.status === "blocked"), true);
  assert.equal(JSON.stringify(proposedCalendarSyncPreview).includes(dataDir), false);

  const blockedCalendarSyncRuns = await request(port, "/api/v1/admin/calendar-sync/runs");
  assert.equal(blockedCalendarSyncRuns.status, 401);
  const calendarSyncRun = await request(port, "/api/v1/admin/calendar-sync/runs", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      proposedItems: [
        {
          providerId: "google-calendar",
          kind: "event",
          action: "create",
          title: "Follow up with Ada",
          startsAt: "2026-07-03T09:00:00.000Z",
        },
      ],
    }),
  }).then((res) => res.json());
  assert.equal(calendarSyncRun.record.status, "blocked");
  assert.equal(calendarSyncRun.record.summary.blockedWrites, 1);
  assert.equal(calendarSyncRun.record.conflicts.some((conflict) => conflict.kind === "blocked-write"), true);
  assert.equal(JSON.stringify(calendarSyncRun.record).includes(dataDir), false);
  const calendarSyncRuns = await request(port, "/api/v1/admin/calendar-sync/runs", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(calendarSyncRuns.records.length, 1);
  assert.equal(calendarSyncRuns.records[0].id, calendarSyncRun.record.id);

  const blockedCalendarSyncExecute = await request(port, "/api/v1/admin/calendar-sync/execute", {
    method: "POST",
    body: JSON.stringify({
      providerId: "apple-calendar",
      kind: "event",
      action: "create",
      title: "Blocked event",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    }),
  });
  assert.equal(blockedCalendarSyncExecute.status, 401);
  const disabledCalendarSyncExecute = await request(port, "/api/v1/admin/calendar-sync/execute", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      providerId: "apple-calendar",
      kind: "event",
      action: "create",
      title: "Blocked event",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    }),
  }).then((res) => res.json());
  assert.match(disabledCalendarSyncExecute.error, /connector is not configured|External calendar writes are disabled/);
  const blockedCalendarSyncHistory = await request(port, "/api/v1/admin/calendar-sync/history");
  assert.equal(blockedCalendarSyncHistory.status, 401);
  const calendarSyncHistory = await request(port, "/api/v1/admin/calendar-sync/history", { headers: adminHeaders }).then((res) => res.json());
  assert.deepEqual(calendarSyncHistory.records, []);
  const blockedCalendarSyncRollback = await request(port, "/api/v1/admin/calendar-sync/operations/missing/rollback", {
    method: "POST",
    body: JSON.stringify({ explicitConsent: true, confirmationText: "WRITE TO EXTERNAL CALENDAR" }),
  });
  assert.equal(blockedCalendarSyncRollback.status, 401);
  const missingCalendarSyncRollback = await request(port, "/api/v1/admin/calendar-sync/operations/missing/rollback", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ explicitConsent: true, confirmationText: "WRITE TO EXTERNAL CALENDAR" }),
  });
  assert.equal(missingCalendarSyncRollback.status, 404);

  const blockedNativeAutomationPlan = await request(port, "/api/v1/admin/native-automation/plan", {
    method: "POST",
    body: JSON.stringify({ kind: "clipboard", payload: "hello" }),
  });
  assert.equal(blockedNativeAutomationPlan.status, 401);
  const nativeAutomationPlan = await request(port, "/api/v1/admin/native-automation/plan", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      kind: "clipboard",
      title: "Copy user@example.test token=secret",
      target: "/Users/example/private.txt",
      payload: "github_pat_secret token=secret",
      explicitConsent: true,
      confirmationText: "RUN NATIVE ACTION",
    }),
  }).then((res) => res.json());
  assert.equal(nativeAutomationPlan.status, "blocked");
  assert.equal(nativeAutomationPlan.canExecute, false);
  assert.equal(nativeAutomationPlan.safety.bridgeEnabled, false);
  assert.ok(nativeAutomationPlan.blockedReasons.includes("native_bridge_disabled"));
  assert.ok(nativeAutomationPlan.blockedReasons.includes("sensitive_payload_blocked"));
  assert.equal(JSON.stringify(nativeAutomationPlan).includes("github_pat_secret"), false);
  assert.equal(JSON.stringify(nativeAutomationPlan).includes("/Users/example"), false);
  const nativeAutomationExecuteResponse = await request(port, "/api/v1/admin/native-automation/execute", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      kind: "clipboard",
      payload: "safe text",
      explicitConsent: true,
      confirmationText: "RUN NATIVE ACTION",
    }),
  });
  assert.equal(nativeAutomationExecuteResponse.status, 400);
  const nativeAutomationExecute = await nativeAutomationExecuteResponse.json();
  assert.equal(nativeAutomationExecute.ok, false);
  assert.equal(nativeAutomationExecute.dryRun, true);
  assert.equal(nativeAutomationExecute.auditSummary.connector, "native-automation-bridge");

  const blockedPasswordChange = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    body: JSON.stringify({ currentPassword: "correct horse battery staple", newPassword: "new strong password 123!" }),
  });
  assert.equal(blockedPasswordChange.status, 401);
  const wrongCurrentPasswordChange = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ currentPassword: "wrong-password", newPassword: "new strong password 123!" }),
  });
  assert.equal(wrongCurrentPasswordChange.status, 401);
  const weakPasswordChange = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ currentPassword: "correct horse battery staple", newPassword: "password123" }),
  }).then((res) => res.json());
  assert.equal(weakPasswordChange.ok, true);
  assert.equal(weakPasswordChange.passwordPolicy.meetsPolicy, false);
  assert.equal(weakPasswordChange.securityCheck.items.some((item) => item.id === "password" && item.status === "warning"), true);
  const repetitivePasswordChange = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ currentPassword: "password123", newPassword: "aaaaaaaaaaaa1!" }),
  }).then((res) => res.json());
  assert.equal(repetitivePasswordChange.ok, true);
  assert.equal(repetitivePasswordChange.passwordPolicy.meetsPolicy, false);
  assert.equal(repetitivePasswordChange.passwordPolicy.noLongRepeats, false);
  assert.equal(repetitivePasswordChange.passwordPolicy.noSequentialPattern, true);
  assert.equal(repetitivePasswordChange.securityCheck.items.some((item) => item.id === "password" && item.status === "warning"), true);
  const sequentialPasswordChange = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ currentPassword: "aaaaaaaaaaaa1!", newPassword: "abcdef123456!" }),
  }).then((res) => res.json());
  assert.equal(sequentialPasswordChange.ok, true);
  assert.equal(sequentialPasswordChange.passwordPolicy.meetsPolicy, false);
  assert.equal(sequentialPasswordChange.passwordPolicy.noLongRepeats, true);
  assert.equal(sequentialPasswordChange.passwordPolicy.noSequentialPattern, false);
  assert.equal(sequentialPasswordChange.securityCheck.items.some((item) => item.id === "password" && item.status === "warning"), true);
  const strongPasswordChange = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ currentPassword: "abcdef123456!", newPassword: "correct horse battery staple" }),
  }).then((res) => res.json());
  assert.equal(strongPasswordChange.ok, true);
  assert.equal(strongPasswordChange.passwordPolicy.meetsPolicy, true);
  assert.equal(JSON.stringify(strongPasswordChange).includes("correct horse battery staple"), false);

  const blockedNetworkDiagnostics = await request(port, "/api/v1/admin/network-diagnostics");
  assert.equal(blockedNetworkDiagnostics.status, 401);
  const networkDiagnostics = await request(port, "/api/v1/admin/network-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(networkDiagnostics.host, "127.0.0.1");
  assert.equal(networkDiagnostics.port, String(port));
  assert.ok(Array.isArray(networkDiagnostics.lanUrls));
  assert.equal(typeof networkDiagnostics.cloudflare.installed, "boolean");
  assert.equal(typeof networkDiagnostics.tailscale.installed, "boolean");
  assert.match(networkDiagnostics.cloudflare.suggestedCommand, /cloudflared tunnel --url/);
  assert.equal(typeof networkDiagnostics.cloudflare.managed.running, "boolean");

  const blockedCloudflareTunnelStatus = await request(port, "/api/v1/admin/cloudflare-tunnel");
  assert.equal(blockedCloudflareTunnelStatus.status, 401);
  const cloudflareTunnelStatus = await request(port, "/api/v1/admin/cloudflare-tunnel", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(typeof cloudflareTunnelStatus.tunnel.running, "boolean");
  assert.equal(typeof cloudflareTunnelStatus.diagnostics.recommendedBaseUrl, "string");
  const blockedCloudflareTunnelStart = await request(port, "/api/v1/admin/cloudflare-tunnel/start", { method: "POST" });
  assert.equal(blockedCloudflareTunnelStart.status, 401);
  const blockedCloudflareTunnelStop = await request(port, "/api/v1/admin/cloudflare-tunnel/stop", { method: "POST" });
  assert.equal(blockedCloudflareTunnelStop.status, 401);

  const blockedConnectionTest = await request(port, "/api/v1/admin/network-diagnostics/test-url", {
    method: "POST",
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}` }),
  });
  assert.equal(blockedConnectionTest.status, 401);
  const invalidConnectionTest = await request(port, "/api/v1/admin/network-diagnostics/test-url", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ baseUrl: "file:///etc/passwd" }),
  });
  assert.equal(invalidConnectionTest.status, 400);
  const connectionTest = await request(port, "/api/v1/admin/network-diagnostics/test-url", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}?token=connection-secret` }),
  }).then((res) => res.json());
  assert.equal(connectionTest.result.ok, true);
  assert.equal(connectionTest.result.service, "lifeos-local-core");
  assert.ok(connectionTest.result.fixes.some((fix) => fix.id === "localhost-phone-unreachable"));
  assert.ok(connectionTest.result.fixes.some((fix) => fix.id === "https-required"));
  assert.equal(JSON.stringify(connectionTest.result).includes("connection-secret"), false);

  const blockedDesktopConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    body: JSON.stringify({ mode: "cloudflare", label: "Unsafe", baseUrl: "https://unsafe.example.com" }),
  });
  assert.equal(blockedDesktopConnectionConfig.status, 401);
  const blockedRemoteAcceptanceRun = await request(port, "/api/v1/admin/network-diagnostics/acceptance-run", {
    method: "POST",
  });
  assert.equal(blockedRemoteAcceptanceRun.status, 401);
  const invalidDesktopConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ mode: "cloudflare", label: "Unsafe", baseUrl: "file:///etc/passwd" }),
  });
  assert.equal(invalidDesktopConnectionConfig.status, 400);
  const insecureDesktopConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ mode: "configured", label: "Insecure public", baseUrl: "http://public.example.com" }),
  });
  assert.equal(insecureDesktopConnectionConfig.status, 400);
  const unsafeRemoteDesktopConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      mode: "cloudflare",
      label: "Cloudflare Smoke",
      baseUrl: "https://user:password@desktop-config.example.com/mobile?token=desktop-secret#debug",
    }),
  });
  assert.equal(unsafeRemoteDesktopConnectionConfig.status, 400);
  const unsafeRemoteBody = await unsafeRemoteDesktopConnectionConfig.json();
  assert.match(unsafeRemoteBody.error, /username, password, token, query, or fragment/);
  assert.equal(JSON.stringify(unsafeRemoteBody).includes("desktop-secret"), false);
  assert.equal(JSON.stringify(unsafeRemoteBody).includes("user:password"), false);
  const desktopConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      mode: "cloudflare",
      label: "Cloudflare Smoke",
      baseUrl: "https://desktop-config.example.com/mobile",
    }),
  }).then((res) => res.json());
  assert.equal(desktopConnectionConfig.restartRequired, true);
  assert.equal(desktopConnectionConfig.config.mode, "cloudflare");
  assert.equal(desktopConnectionConfig.config.host, "0.0.0.0");
  assert.equal(desktopConnectionConfig.config.allowPublic, true);
  assert.equal(desktopConnectionConfig.config.publicBaseUrl, "https://desktop-config.example.com/mobile");
  assert.equal(JSON.stringify(desktopConnectionConfig).includes("desktop-secret"), false);
  assert.equal(JSON.stringify(desktopConnectionConfig).includes("user:password"), false);
  const networkDiagnosticsAfterDesktopConfig = await request(port, "/api/v1/admin/network-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(networkDiagnosticsAfterDesktopConfig.desktopRuntimeConfig.label, "Cloudflare Smoke");
  assert.equal(networkDiagnosticsAfterDesktopConfig.desktopRuntimeConfig.publicBaseUrl, "https://desktop-config.example.com/mobile");
  const tailscaleHttpsConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      mode: "tailscale",
      label: "Tailscale HTTPS Serve",
      baseUrl: "https://lifeos-mac.tailnet.example.ts.net",
    }),
  }).then((res) => res.json());
  assert.equal(tailscaleHttpsConnectionConfig.config.mode, "tailscale");
  assert.equal(tailscaleHttpsConnectionConfig.config.host, "127.0.0.1");
  assert.equal(tailscaleHttpsConnectionConfig.config.publicBaseUrl, "https://lifeos-mac.tailnet.example.ts.net");

  const defaultRemoteBinding = await request(port, "/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  }).then((res) => res.json());
  assert.equal(defaultRemoteBinding.baseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(defaultRemoteBinding.pairingUrl, `https://lifeos-mac.tailnet.example.ts.net/mobile/install/${encodeURIComponent(defaultRemoteBinding.token)}`);

  const blockedDiagnosticBundle = await request(port, "/api/v1/admin/diagnostic-bundle");
  assert.equal(blockedDiagnosticBundle.status, 401);

  const shortAiKey = await request(port, "/api/v1/admin/ai-key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ apiKey: "short" }),
  });
  assert.equal(shortAiKey.status, 400);

  const testAiKey = "AIzaSy-test-secret-value-should-not-leak";
  const savedAiKey = await request(port, "/api/v1/admin/ai-key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ apiKey: testAiKey }),
  }).then((res) => res.json());
  assert.equal(savedAiKey.ai.id, "gemini");
  assert.equal(savedAiKey.ai.provider, "Google Gemini");
  assert.equal(savedAiKey.ai.configured, true);
  assert.equal(savedAiKey.ai.source, "encrypted_store");
  assert.equal(savedAiKey.ai.secureStorage.current, "local_aes_gcm");
  assert.equal(savedAiKey.ai.secureStorage.systemAvailable, false);
  assert.equal(savedAiKey.ai.secureStorage.fallbackActive, true);
  assert.equal(savedAiKey.ai.secureStorage.fallbackLabel, "Local AES-GCM encrypted file");
  assert.equal(savedAiKey.ai.apiKey, undefined);
  assert.equal(JSON.stringify(savedAiKey).includes(testAiKey), false);

  const secretDb = new DatabaseSync(path.join(dataDir, "lifeos.db"));
  const secretRow = secretDb.prepare("SELECT ciphertext, iv, auth_tag FROM app_secrets WHERE id = 'ai.google_gemini.api_key'").get();
  secretDb.close();
  assert.ok(secretRow?.ciphertext);
  assert.equal(JSON.stringify(secretRow).includes(testAiKey), false);

  const deletedAiKey = await request(port, "/api/v1/admin/ai-key", {
    method: "DELETE",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(deletedAiKey.ai.id, "gemini");
  assert.equal(deletedAiKey.ai.provider, "Google Gemini");
  assert.equal(deletedAiKey.ai.configured, false);
  assert.equal(deletedAiKey.ai.source, "missing");
  assert.equal(deletedAiKey.ai.secureStorage.current, undefined);
  assert.equal(deletedAiKey.ai.secureStorage.fallbackActive, true);

  const aiProviders = await request(port, "/api/v1/admin/ai-providers", { headers: adminHeaders }).then((res) => res.json());
  assert.deepEqual(aiProviders.providers.map((provider) => provider.id), ["gemini", "openai", "openrouter", "local"]);
  const openAiProvider = aiProviders.providers.find((provider) => provider.id === "openai");
  assert.deepEqual(openAiProvider.models, ["gpt-4o-mini", "gpt-4o"]);
  assert.equal(openAiProvider.selectedModel, "gpt-4o-mini");
  const updatedOpenAiModel = await request(port, "/api/v1/admin/ai-providers/openai/model", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ model: "gpt-4o" }),
  }).then((res) => res.json());
  assert.equal(updatedOpenAiModel.provider.selectedModel, "gpt-4o");
  const rejectedOpenAiModel = await request(port, "/api/v1/admin/ai-providers/openai/model", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ model: "not-a-real-openai-model" }),
  });
  assert.equal(rejectedOpenAiModel.status, 400);
  const updatedLocalModel = await request(port, "/api/v1/admin/ai-providers/local/model", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ model: "custom-local-model:latest" }),
  }).then((res) => res.json());
  assert.equal(updatedLocalModel.provider.selectedModel, "custom-local-model:latest");
  const invalidLocalProviderScheme = await request(port, "/api/v1/admin/ai-providers/local/key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ apiKey: "file:///tmp/ollama.sock" }),
  });
  assert.equal(invalidLocalProviderScheme.status, 400);
  const credentialedLocalProvider = await request(port, "/api/v1/admin/ai-providers/local/key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ apiKey: "https://user:password@local-model.test/v1?token=endpoint-secret#debug" }),
  }).then((res) => res.json().then((body) => ({ status: res.status, body })));
  assert.equal(credentialedLocalProvider.status, 400);
  assert.equal(JSON.stringify(credentialedLocalProvider.body).includes("endpoint-secret"), false);
  assert.equal(JSON.stringify(credentialedLocalProvider.body).includes("user:password"), false);
  const testedMissingLocalProvider = await request(port, "/api/v1/admin/ai-providers/local/test", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(testedMissingLocalProvider.ok, false);
  assert.equal(testedMissingLocalProvider.mode, "configuration");
  assert.equal(testedMissingLocalProvider.liveSupported, true);
  assert.equal(testedMissingLocalProvider.result, "not_configured");
  assert.equal(testedMissingLocalProvider.reason, "missing_local_endpoint");
  assert.equal(testedMissingLocalProvider.credentialKind, "endpoint");
  assert.match(testedMissingLocalProvider.message, /endpoint configured/);
  assert.doesNotMatch(testedMissingLocalProvider.message, /key configured/);
  const openAiKey = "sk-test-openai-value-should-not-leak";
  const savedOpenAi = await request(port, "/api/v1/admin/ai-providers/openai/key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ apiKey: openAiKey }),
  }).then((res) => res.json());
  assert.equal(savedOpenAi.provider.id, "openai");
  assert.equal(savedOpenAi.provider.configured, true);
  assert.equal(savedOpenAi.provider.enabled, true);
  assert.equal(savedOpenAi.provider.secureStorage.current, "local_aes_gcm");
  assert.equal(savedOpenAi.provider.secureStorage.fallbackActive, true);
  assert.equal(JSON.stringify(savedOpenAi).includes(openAiKey), false);
  const testedOpenAi = await request(port, "/api/v1/admin/ai-providers/openai/test", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(testedOpenAi.ok, true);
  assert.equal(testedOpenAi.mode, "configuration");
  assert.equal(testedOpenAi.liveSupported, false);
  assert.equal(testedOpenAi.selectedModel, "gpt-4o");
  assert.equal(testedOpenAi.result, "ready");
  assert.equal(testedOpenAi.reason, "ready");
  assert.equal(testedOpenAi.credentialKind, "api_key");
  assert.equal(typeof testedOpenAi.checkedAt, "number");
  assert.match(testedOpenAi.message, /configuration is ready/);
  assert.match(testedOpenAi.message, /Live API call was not run/);
  assert.equal(JSON.stringify(testedOpenAi).includes(openAiKey), false);
  const activeOpenAi = await request(port, "/api/v1/admin/ai-providers/openai/active", {
    method: "PUT",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(activeOpenAi.provider.id, "openai");
  assert.equal(activeOpenAi.provider.active, true);
  assert.equal(activeOpenAi.providers.find((provider) => provider.id === "openai").active, true);
  assert.equal(activeOpenAi.providers.find((provider) => provider.id === "gemini").active, false);
  const legacyByokProviderState = await request(port, "/api/v1/state/lifeos_byok_provider", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(legacyByokProviderState.value, "OpenAI");
  const legacyModelEngineState = await request(port, "/api/v1/state/lifeos_model_engine", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(legacyModelEngineState.value, "gpt-4o");
  await request(port, "/api/v1/state/lifeos_byok_key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ value: "AIzaSy-backup-state-secret-should-not-leak" }),
  });
  const sanitizedBackup = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(sanitizedBackup.backup.redaction.appSecretsDeleted >= 1, true);
  assert.equal(sanitizedBackup.backup.redaction.sensitiveClientStateDeleted >= 1, true);
  assert.equal(sanitizedBackup.backup.redaction.adminSessionsDeleted >= 1, true);
  const sanitizedBackupDb = new DatabaseSync(path.join(dataDir, "backups", sanitizedBackup.backup.file));
  const sanitizedSecretCount = sanitizedBackupDb.prepare("SELECT COUNT(*) as count FROM app_secrets").get().count;
  const sanitizedSensitiveState = sanitizedBackupDb.prepare("SELECT value_json as valueJson FROM client_state WHERE key = 'lifeos_byok_key'").get();
  const sanitizedAdminSessionCount = sanitizedBackupDb.prepare("SELECT COUNT(*) as count FROM admin_sessions").get().count;
  sanitizedBackupDb.close();
  assert.equal(sanitizedSecretCount, 0);
  assert.equal(sanitizedSensitiveState, undefined);
  assert.equal(sanitizedAdminSessionCount, 0);
  const deletedOpenAi = await request(port, "/api/v1/admin/ai-providers/openai/key", {
    method: "DELETE",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(deletedOpenAi.provider.configured, false);

  const badLogin = await request(port, "/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(badLogin.status, 401);
  for (let index = 0; index < 4; index += 1) {
    const response = await request(port, "/api/v1/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: "wrong-password" }),
    });
    assert.equal(response.status, 401);
  }
  const lockedLogin = await request(port, "/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(lockedLogin.status, 423);

  const bindWithoutAdmin = await request(port, "/api/v1/devices/bind/start", { method: "POST" });
  assert.equal(bindWithoutAdmin.status, 401);

  const csrfBlockedBackup = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: { Cookie: adminHeaders.Cookie },
  });
  assert.equal(csrfBlockedBackup.status, 403);

  const backup = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.match(backup.backup.file, /^lifeos-.*\.db$/);
  assert.equal(backup.backup.path, undefined);

  const backups = await request(port, "/api/v1/backups", { headers: adminHeaders }).then((res) => res.json());
  assert.ok(backups.backups.length >= 1);
  assert.equal(backups.backups[0].path, undefined);

  const defaultSchedule = await request(port, "/api/v1/backups/schedule", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(defaultSchedule.schedule.enabled, false);
  assert.equal(defaultSchedule.schedule.intervalHours, 24);

  const updatedSchedule = await request(port, "/api/v1/backups/schedule", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ enabled: true, intervalHours: 12 }),
  }).then((res) => res.json());
  assert.equal(updatedSchedule.schedule.enabled, true);
  assert.equal(updatedSchedule.schedule.intervalHours, 12);
  assert.equal(typeof updatedSchedule.schedule.nextRunAt, "number");

  const runScheduleNow = await request(port, "/api/v1/backups/schedule/run-now", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.match(runScheduleNow.backup.file, /^lifeos-.*\.db$/);
  assert.equal(runScheduleNow.backup.path, undefined);
  assert.equal(runScheduleNow.schedule.enabled, true);
  assert.equal(runScheduleNow.schedule.intervalHours, 12);
  assert.equal(typeof runScheduleNow.schedule.lastRunAt, "number");
  assert.equal(typeof runScheduleNow.schedule.nextRunAt, "number");

  const backupPreview = await request(port, `/api/v1/backups/${encodeURIComponent(backup.backup.file)}/preview`, { headers: adminHeaders }).then((res) => res.json());
  assert.equal(backupPreview.preview.backup.file, backup.backup.file);
  assert.equal(typeof backupPreview.preview.tables.devices, "number");
  assert.equal(typeof backupPreview.preview.tables.schema_migrations, "number");
  assert.equal(backupPreview.preview.backup.path, undefined);
  assert.equal(backupPreview.preview.tables.app_secrets, 0);
  assert.equal(backupPreview.preview.sensitiveData.appSecretsRows, 0);
  assert.equal(backupPreview.preview.sensitiveData.sensitiveClientStateRows, 0);
  assert.equal(backupPreview.preview.sensitiveData.ordinaryBackupExcludesSecrets, true);
  assert.ok(backupPreview.preview.migrations.length >= 1);
  assert.equal(typeof backupPreview.preview.migrations[0].version, "number");
  assert.equal(typeof backupPreview.preview.migrations[0].name, "string");
  assert.equal(typeof backupPreview.preview.migrations[0].appliedAt, "number");
  assert.ok(backupPreview.preview.warnings.includes("Restore will replace the current SQLite database before the next startup."));
  assert.ok(backupPreview.preview.warnings.includes("The system will automatically create a backup of the current database before restore."));
  assert.ok(backupPreview.preview.warnings.includes("Ordinary backups do not include AI Keys or sensitive client state. Reconfigure keys in Settings after restore if AI features are needed."));

  const downloadedBackup = await request(port, `/api/v1/backups/${encodeURIComponent(backup.backup.file)}/download`, { headers: adminHeaders });
  assert.equal(downloadedBackup.status, 200);
  assert.match(downloadedBackup.headers.get("content-disposition") || "", /attachment/);

  const weakEncryptedExport = await request(port, `/api/v1/backups/${encodeURIComponent(backup.backup.file)}/encrypted-export`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ passphrase: "correcthorsebackup" }),
  });
  assert.equal(weakEncryptedExport.status, 400);

  const encryptedPassphrase = "Correct-Horse-Backup-2026";
  const encryptedExport = await request(port, `/api/v1/backups/${encodeURIComponent(backup.backup.file)}/encrypted-export`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ passphrase: encryptedPassphrase }),
  }).then((res) => res.json());
  assert.equal(encryptedExport.payload.magic, "lifeos.encrypted.sqlite.backup");
  assert.equal(encryptedExport.payload.originalFile, backup.backup.file);
  assert.equal(JSON.stringify(encryptedExport).includes("SQLite format 3"), false);

  const rejectedEncryptedImport = await request(port, "/api/v1/backups/encrypted-import", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ payload: encryptedExport.payload, passphrase: "wrong password value" }),
  });
  assert.equal(rejectedEncryptedImport.status, 400);
  const malformedEncryptedImport = await request(port, "/api/v1/backups/encrypted-import", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      payload: {
        ...encryptedExport.payload,
        cipher: { ...encryptedExport.payload.cipher, iv: "bad" },
      },
      passphrase: encryptedPassphrase,
    }),
  });
  assert.equal(malformedEncryptedImport.status, 400);
  const pathTraversalEncryptedImport = await request(port, "/api/v1/backups/encrypted-import", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      payload: {
        ...encryptedExport.payload,
        originalFile: "../lifeos.db",
      },
      passphrase: encryptedPassphrase,
    }),
  });
  assert.equal(pathTraversalEncryptedImport.status, 400);

  const encryptedImport = await request(port, "/api/v1/backups/encrypted-import", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ payload: encryptedExport.payload, passphrase: encryptedPassphrase }),
  }).then((res) => res.json());
  assert.match(encryptedImport.backup.file, /^lifeos-encrypted-import-.*\.db$/);
  assert.equal(encryptedImport.backup.path, undefined);
  assert.equal(typeof encryptedImport.preview.tables.messages, "number");

  const originBlockedBackup = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: { ...adminHeaders, Origin: "https://evil.example" },
  });
  assert.equal(originBlockedBackup.status, 403);

  const restoredBackup = await request(port, `/api/v1/backups/${encodeURIComponent(backup.backup.file)}/restore`, {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(restoredBackup.restore.restoredFrom, backup.backup.file);
  assert.match(restoredBackup.restore.preRestoreBackup.file, /^lifeos-.*\.db$/);
  assert.equal(restoredBackup.restore.preRestoreBackup.path, undefined);
  assert.equal(restoredBackup.restore.scheduledForNextStart, true);

  const dataExportResponse = await request(port, "/api/v1/data/export", { headers: adminHeaders });
  assert.equal(dataExportResponse.status, 200);
  assert.match(dataExportResponse.headers.get("content-disposition") || "", /lifeos-data-export-.*\.json/);
  const dataExport = await dataExportResponse.json();
  assert.deepEqual(dataExport.scopes, ["chat", "memories", "devices", "auditLogs", "customApps"]);
  assert.equal(dataExport.version, packageJson.version);
  assert.ok(Array.isArray(dataExport.chat.sessions));
  assert.ok(Array.isArray(dataExport.memories));
  assert.ok(Array.isArray(dataExport.devices));
  assert.ok(Array.isArray(dataExport.auditLogs));
  assert.ok(Array.isArray(dataExport.customApps.apps));
  assert.ok(Array.isArray(dataExport.customApps.versions));
  assert.ok(Array.isArray(dataExport.customApps.state));
  assert.ok(Array.isArray(dataExport.customApps.actionRequests));
  assert.ok(Array.isArray(dataExport.customApps.actionPolicies));
  assert.ok(Array.isArray(dataExport.customApps.capabilityManifests));
  assert.ok(Array.isArray(dataExport.customApps.capabilityRequests));
  assert.ok(Array.isArray(dataExport.customApps.runtimeEvents));
  const exportedConnectionAudit = dataExport.auditLogs.find((log) => log.action === "network_connection_tested");
  assert.ok(exportedConnectionAudit);
  assert.equal(exportedConnectionAudit.targetId, `http://127.0.0.1:${port}/?[redacted]`);
  assert.equal(typeof exportedConnectionAudit.metadata.status, "number");
  assert.equal(JSON.stringify(dataExport).includes(testAiKey), false);
  assert.equal(JSON.stringify(dataExport).includes("connection-secret"), false);
  assert.equal(JSON.stringify(dataExport).includes(dataDir), false);

  const scopedDataExport = await request(port, "/api/v1/data/export?scope=chat,devices", { headers: adminHeaders }).then((res) => res.json());
  assert.deepEqual(scopedDataExport.scopes, ["chat", "devices"]);
  assert.equal(scopedDataExport.version, packageJson.version);
  assert.ok(Array.isArray(scopedDataExport.chat.sessions));
  assert.ok(Array.isArray(scopedDataExport.devices));
  assert.equal(scopedDataExport.memories, undefined);
  assert.equal(scopedDataExport.auditLogs, undefined);
  assert.equal(scopedDataExport.customApps, undefined);

  const invalidDataExport = await request(port, "/api/v1/data/export?scope=chat,secrets", { headers: adminHeaders });
  assert.equal(invalidDataExport.status, 400);

  const cleanupPreviewResponse = await request(port, "/api/v1/data/cleanup/preview", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ backupKeepCount: 1, auditOlderThanDays: 99999, chatOlderThanDays: 99999 }),
  }).then((res) => res.json());
  assert.equal(typeof cleanupPreviewResponse.cleanup.backupsDeleted, "number");
  assert.equal(typeof cleanupPreviewResponse.cleanup.auditLogsDeleted, "number");

  const cleanupResponse = await request(port, "/api/v1/data/cleanup", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ backupKeepCount: 1, auditOlderThanDays: 99999, chatOlderThanDays: 99999 }),
  }).then((res) => res.json());
  assert.equal(typeof cleanupResponse.cleanup.backupsDeleted, "number");
  assert.equal(typeof cleanupResponse.cleanup.auditLogsDeleted, "number");

  const remoteAcceptanceImport = await request(port, "/api/v1/admin/network-diagnostics/acceptance-report", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      report: {
        generatedAt: "2026-06-17T00:00:00.000Z",
        baseUrl: "https://lifeos-api-test.example.com",
        entryKind: "stable-https",
        longTermReady: true,
        longTermReason: "Remote entry passed token=hidden",
        automatedChecks: {
          ok: true,
          passed: 3,
          total: 3,
          latencyMs: 30,
          steps: [
            { id: "health", ok: true, status: 200, url: "https://lifeos-api-test.example.com/api/v1/health", latencyMs: 10 },
            { id: "mobile-shell", ok: true, status: 200, url: "https://lifeos-api-test.example.com/mobile/chat", latencyMs: 10 },
            { id: "websocket", ok: true, status: 101, url: "wss://lifeos-api-test.example.com/api/v1/ws", latencyMs: 10 },
          ],
        },
        manualAcceptance: [{ id: "cellular-mobile-chat", title: "Phone cellular", required: true }],
      },
    }),
  });
  assert.equal(remoteAcceptanceImport.status, 200);
  const remoteAcceptanceImportBody = await remoteAcceptanceImport.json();
  assert.equal(remoteAcceptanceImportBody.record.longTermReady, true);
  assert.equal(remoteAcceptanceImportBody.record.realWorldAcceptanceRequired, true);
  assert.equal(remoteAcceptanceImportBody.record.completionStatus, "automated-ready-manual-required");
  assert.equal(remoteAcceptanceImportBody.record.longTermReason.includes("hidden"), false);
  assert.equal(remoteAcceptanceImportBody.diagnostics.remoteValidationReport.label, "remote-acceptance:stable-https");
  assert.equal(remoteAcceptanceImportBody.diagnostics.remoteAcceptanceRunbooks.total, 1);

  const diagnosticBundleResponse = await request(port, "/api/v1/admin/diagnostic-bundle", { headers: adminHeaders });
  assert.equal(diagnosticBundleResponse.status, 200);
  assert.match(diagnosticBundleResponse.headers.get("content-disposition") || "", /lifeos-diagnostics-.*\.json/);
  const diagnosticBundle = await diagnosticBundleResponse.json();
  assert.deepEqual(Object.keys(diagnosticBundle).sort(), [
    "ai",
    "calendarSync",
    "calendarSyncReadiness",
    "database",
    "devices",
    "environment",
    "generatedAt",
    "network",
    "recentAudit",
    "release",
    "remote",
    "security",
    "service",
    "systemActions",
  ]);
  assert.equal(typeof diagnosticBundle.systemActions.totalLogs, "number");
  assert.equal(diagnosticBundle.calendarSync.mode, "preview-only");
  assert.equal(diagnosticBundle.calendarSync.externalWritesEnabled, false);
  assert.equal(diagnosticBundle.calendarSync.summary.providersReadyForWrite, 0);
  assert.equal(diagnosticBundle.calendarSyncReadiness.canAdvertiseTwoWaySync, false);
  assert.equal(typeof diagnosticBundle.systemActions.topSource, "string");
  assert.equal(Array.isArray(diagnosticBundle.systemActions.recent), true);
  assert.deepEqual(Object.keys(diagnosticBundle.database.tables).sort(), [
    "auditLogs",
    "backups",
    "bindingSessions",
    "chatSessions",
    "devices",
    "memories",
    "messages",
  ]);
  assert.equal(diagnosticBundle.ai.configured, false);
  assert.deepEqual(diagnosticBundle.ai.providers.map((provider) => provider.id), ["gemini", "openai", "openrouter", "local"]);
  assert.equal(diagnosticBundle.environment.GEMINI_API_KEY_CONFIGURED, false);
  assert.equal(diagnosticBundle.environment.OPENAI_API_KEY_CONFIGURED, false);
  assert.equal(diagnosticBundle.environment.OPENROUTER_API_KEY_CONFIGURED, false);
  assert.equal(diagnosticBundle.environment.LOCAL_MODEL_BASE_URL_CONFIGURED, false);
  assert.equal(diagnosticBundle.database.backups[0].path, undefined);
  assert.equal(diagnosticBundle.security.overall, "warning");
  assert.equal(diagnosticBundle.security.items.some((item) => item.id === "backup" && item.status === "ok"), true);
  assert.equal(typeof diagnosticBundle.release.manifestAvailable, "boolean");
  assert.equal(typeof diagnosticBundle.release.checksumAvailable, "boolean");
  assert.equal(typeof diagnosticBundle.release.artifactCount, "number");
  assert.equal(Array.isArray(diagnosticBundle.release.artifacts), true);
  assert.equal(typeof diagnosticBundle.remote.healthSummary.status, "string");
  assert.equal(diagnosticBundle.remote.recoveryReport === null || typeof diagnosticBundle.remote.recoveryReport.restored === "boolean", true);
  assert.equal(diagnosticBundle.remote.validationReport === null || typeof diagnosticBundle.remote.validationReport.ok === "boolean", true);
  assert.equal(Array.isArray(diagnosticBundle.remote.acceptanceChecklist), true);
  assert.equal(typeof diagnosticBundle.remote.acceptanceEvidencePack.ready, "boolean");
  assert.equal(typeof diagnosticBundle.remote.acceptanceEvidencePack.recommendedAction, "string");
  assert.equal(Array.isArray(diagnosticBundle.remote.acceptanceEvidencePack.missingRealWorldIds), true);
  assert.equal(Array.isArray(diagnosticBundle.remote.acceptanceEvidencePack.coverage), true);
  assert.equal(typeof diagnosticBundle.remote.acceptanceRecords.total, "number");
  assert.equal(typeof diagnosticBundle.remote.acceptanceRunbooks.total, "number");
  assert.equal(diagnosticBundle.remote.acceptanceRunbooks.total, 1);
  assert.equal(Array.isArray(diagnosticBundle.recentAudit), true);
  assert.equal(diagnosticBundle.recentAudit.length > 0, true);
  assert.equal(JSON.stringify(diagnosticBundle.recentAudit).includes(testAiKey), false);
  assert.equal(JSON.stringify(diagnosticBundle.release).includes(dataDir), false);
  assert.equal(JSON.stringify(diagnosticBundle).includes(testAiKey), false);
  assert.equal(JSON.stringify(diagnosticBundle).includes(dataDir), false);

  await request(port, "/api/v1/data/export", { headers: adminHeaders });
  await request(port, "/api/v1/data/export?scope=chat,devices", { headers: adminHeaders });

  const auditAfterExports = await request(port, "/api/v1/audit-logs", { headers: adminHeaders }).then((res) => res.json());
  const auditActions = auditAfterExports.logs.map((log) => log.action);
  assert.ok(auditActions.includes("database_backup_previewed"));
  assert.ok(auditActions.includes("database_backup_downloaded"));
  assert.ok(auditActions.includes("backup_schedule_updated"));
  assert.ok(auditActions.includes("scheduled_backup_run_now"));
  assert.ok(auditActions.includes("encrypted_backup_exported"));
  assert.ok(auditActions.includes("encrypted_backup_imported"));
  assert.ok(auditActions.includes("encrypted_backup_import_failed"));
  assert.ok(auditActions.includes("data_export_created"));
  assert.ok(auditActions.includes("data_cleanup_previewed"));
  assert.ok(auditActions.includes("diagnostic_bundle_exported"));
  assert.ok(auditActions.includes("remote_acceptance_report_imported"));
  assert.ok(auditActions.includes("desktop_connection_config_saved"));
  assert.ok(auditActions.includes("admin_password_change_failed"));
  assert.ok(auditActions.includes("admin_password_changed"));
  const createdBackupAudit = auditAfterExports.logs.find((log) => log.action === "database_backup_created");
  assert.equal(createdBackupAudit.actorType, "admin");
  assert.match(createdBackupAudit.metadata.file, /^lifeos-.*\.db$/);
  assert.equal(typeof createdBackupAudit.metadata.size, "number");
  assert.equal(typeof createdBackupAudit.metadata.createdAt, "number");
  const previewAudit = auditAfterExports.logs.find((log) => log.action === "database_backup_previewed");
  assert.equal(previewAudit.metadata.tableCount >= 1, true);
  assert.equal(typeof previewAudit.metadata.rowTotal, "number");
  assert.equal(typeof previewAudit.metadata.migrationCount, "number");
  assert.equal(typeof previewAudit.metadata.warningCount, "number");
  const downloadedAudit = auditAfterExports.logs.find((log) => log.action === "database_backup_downloaded");
  assert.equal(downloadedAudit.metadata.delivery, "download");
  assert.equal(typeof downloadedAudit.metadata.size, "number");
  const encryptedExportAudit = auditAfterExports.logs.find((log) => log.action === "encrypted_backup_exported");
  assert.equal(encryptedExportAudit.metadata.encryption.kdf, "pbkdf2");
  assert.equal(encryptedExportAudit.metadata.encryption.cipher, "aes-256-gcm");
  assert.equal(typeof encryptedExportAudit.metadata.encryption.iterations, "number");
  assert.equal(typeof encryptedExportAudit.metadata.encryptedBytes, "number");
  const encryptedImportAudit = auditAfterExports.logs.find((log) => log.action === "encrypted_backup_imported");
  assert.equal(encryptedImportAudit.metadata.preview.tableCount >= 1, true);
  assert.equal(typeof encryptedImportAudit.metadata.preview.warningCount, "number");
  const encryptedImportFailureAudits = auditAfterExports.logs.filter((log) => log.action === "encrypted_backup_import_failed");
  assert.equal(encryptedImportFailureAudits.some((log) => log.metadata.reason === "decrypt_failed"), true);
  assert.equal(encryptedImportFailureAudits.some((log) => log.metadata.reason === "malformed_payload"), true);
  assert.equal(encryptedImportFailureAudits.some((log) => log.metadata.reason === "unsupported_file" && log.metadata.payload.originalFileStatus === "unsafe_path"), true);
  assert.equal(encryptedImportFailureAudits.every((log) => log.targetId === "encrypted-import"), true);
  assert.equal(encryptedImportFailureAudits.every((log) => typeof log.metadata.payload.encryptedBytesEstimate === "number"), true);
  const exportAudits = auditAfterExports.logs.filter((log) => log.action === "data_export_created");
  const fullExportAudit = exportAudits.find((log) => Array.isArray(log.metadata.scopes) && log.metadata.scopes.includes("auditLogs"));
  assert.deepEqual(fullExportAudit.metadata.scopes, ["chat", "memories", "devices", "auditLogs", "customApps"]);
  assert.equal(fullExportAudit.metadata.scopeCount, 5);
  assert.equal(fullExportAudit.metadata.includesAuditLogs, true);
  assert.equal(fullExportAudit.metadata.delivery, "download");
  assert.match(fullExportAudit.metadata.fileName, /^lifeos-data-export-.*\.json$/);
  assert.equal(fullExportAudit.metadata.redacted, true);
  assert.match(fullExportAudit.metadata.redactionPolicy, /tokens, credentials, URLs, and local paths/);
  assert.equal(typeof fullExportAudit.metadata.counts.chatSessions, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.messages, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.memories, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.devices, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.auditLogs, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.customApps, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.customAppVersions, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.customAppStates, "number");
  assert.equal(typeof fullExportAudit.metadata.counts.customAppActionRequests, "number");
  const scopedExportAudit = exportAudits.find((log) => Array.isArray(log.metadata.scopes) && log.metadata.scopes.join(",") === "chat,devices");
  assert.deepEqual(scopedExportAudit.metadata.scopes, ["chat", "devices"]);
  assert.equal(scopedExportAudit.metadata.scopeCount, 2);
  assert.equal(scopedExportAudit.metadata.includesAuditLogs, false);
  assert.equal(scopedExportAudit.metadata.counts.memories, 0);
  assert.equal(scopedExportAudit.metadata.counts.auditLogs, 0);
  assert.equal(scopedExportAudit.metadata.counts.customApps, 0);
  assert.equal(scopedExportAudit.metadata.counts.customAppActionRequests, 0);
  const restoreScheduledAudit = auditAfterExports.logs.find((log) => log.action === "database_restore_scheduled");
  assert.equal(restoreScheduledAudit.actorType, "admin");
  assert.equal(restoreScheduledAudit.targetId, backup.backup.file);
  assert.equal(restoreScheduledAudit.metadata.restoredFrom, backup.backup.file);
  assert.equal(restoreScheduledAudit.metadata.preRestoreBackup.path, undefined);
  assert.match(restoreScheduledAudit.metadata.preRestoreBackup.file, /^lifeos-.*\.db$/);
  assert.equal(restoreScheduledAudit.metadata.restartRequired, true);
  assert.equal(typeof restoreScheduledAudit.metadata.scheduledAt, "number");
  const cleanupAudit = auditAfterExports.logs.find((log) => log.action === "data_cleanup_completed");
  assert.equal(cleanupAudit.actorType, "admin");
  assert.deepEqual(cleanupAudit.metadata.requested, {
    backupKeepCount: 1,
    auditOlderThanDays: 99999,
    chatOlderThanDays: 99999,
  });
  assert.equal(cleanupAudit.metadata.protectionBackupCreated, true);
  assert.match(cleanupAudit.metadata.protectionBackup.file, /^lifeos-.*\.db$/);
  assert.equal(cleanupAudit.metadata.protectionBackup.path, undefined);
  assert.equal(cleanupAudit.metadata.ordinaryBackupExcludesSecrets, true);
  const cleanupPreviewAudit = auditAfterExports.logs.find((log) => log.action === "data_cleanup_previewed");
  assert.equal(cleanupPreviewAudit.actorType, "admin");
  assert.deepEqual(cleanupPreviewAudit.metadata.requested, {
    backupKeepCount: 1,
    auditOlderThanDays: 99999,
    chatOlderThanDays: 99999,
  });
  const diagnosticExportAudit = auditAfterExports.logs.find((log) => log.action === "diagnostic_bundle_exported");
  assert.equal(diagnosticExportAudit.actorType, "admin");
  assert.equal(diagnosticExportAudit.metadata.aiProviders, 4);
  assert.equal(diagnosticExportAudit.metadata.configuredAiProviders, 0);
  assert.equal(diagnosticExportAudit.metadata.backupCount >= 1, true);
  assert.equal(diagnosticExportAudit.metadata.databaseTableCount >= 1, true);
  assert.equal(diagnosticExportAudit.metadata.databaseRowTotal >= diagnosticExportAudit.metadata.backupCount, true);
  assert.equal(diagnosticExportAudit.metadata.pendingRestore, true);
  assert.equal(diagnosticExportAudit.metadata.recentAuditCount >= 1, true);
  assert.equal(typeof diagnosticExportAudit.metadata.releaseManifestAvailable, "boolean");
  assert.equal(typeof diagnosticExportAudit.metadata.releaseChecksumAvailable, "boolean");
  assert.equal(typeof diagnosticExportAudit.metadata.releaseArtifactCount, "number");
  assert.equal(typeof diagnosticExportAudit.metadata.publicBaseUrlConfigured, "boolean");
  assert.ok(["cloudflare", "tailscale", "public", "lan", "none"].includes(diagnosticExportAudit.metadata.remoteEntryMode));
  assert.equal(typeof diagnosticExportAudit.metadata.remoteAcceptanceReady, "boolean");
  assert.equal(typeof diagnosticExportAudit.metadata.remoteAcceptanceHasLongTermEntry, "boolean");
  assert.equal(typeof diagnosticExportAudit.metadata.remoteAcceptanceHasRealWorldEvidence, "boolean");
  assert.equal(typeof diagnosticExportAudit.metadata.remoteAcceptancePassed, "number");
  assert.equal(typeof diagnosticExportAudit.metadata.remoteAcceptanceManualRequired, "number");
  assert.equal(typeof diagnosticExportAudit.metadata.systemActionLogCount, "number");
  assert.equal(typeof diagnosticExportAudit.metadata.systemActionBlockedCount, "number");
  assert.equal(typeof diagnosticExportAudit.metadata.systemActionHighRiskCount, "number");
  assert.equal(typeof diagnosticExportAudit.metadata.systemActionSourceCount, "number");
  assert.equal(diagnosticExportAudit.metadata.securityOverall, "warning");
  assert.equal(typeof diagnosticExportAudit.metadata.securityCriticalCount, "number");
  assert.equal(typeof diagnosticExportAudit.metadata.securityWarningCount, "number");
  assert.equal(diagnosticExportAudit.metadata.publicMode, false);
  const desktopConnectionConfigAudit = auditAfterExports.logs.find((log) => log.action === "desktop_connection_config_saved" && log.targetId === "cloudflare");
  assert.equal(desktopConnectionConfigAudit.targetType, "network");
  assert.equal(desktopConnectionConfigAudit.targetId, "cloudflare");
  assert.equal(desktopConnectionConfigAudit.metadata.publicBaseUrlConfigured, true);
  assert.equal(desktopConnectionConfigAudit.metadata.restartRequired, true);
  const findConfigAudit = (action, targetId) => auditAfterExports.logs.find((log) => log.action === action && log.targetType === "config" && log.targetId === targetId);
  const geminiKeySavedAudit = findConfigAudit("ai_key_saved", "google_gemini");
  assert.equal(geminiKeySavedAudit.metadata.providerId, "gemini");
  assert.equal(geminiKeySavedAudit.metadata.provider, "Google Gemini");
  assert.equal(geminiKeySavedAudit.metadata.compatibilityEndpoint, true);
  assert.equal(geminiKeySavedAudit.metadata.configured, true);
  assert.equal(geminiKeySavedAudit.metadata.previousConfigured, false);
  assert.equal(geminiKeySavedAudit.metadata.configuredChanged, true);
  assert.equal(geminiKeySavedAudit.metadata.sourceChanged, true);
  assert.equal(geminiKeySavedAudit.metadata.source, "encrypted_store");
  assert.equal(geminiKeySavedAudit.metadata.envManaged, false);
  assert.equal(geminiKeySavedAudit.metadata.defaultModel, "gemini-3.5-flash");
  assert.equal(typeof geminiKeySavedAudit.metadata.modelCatalogCount, "number");
  assert.equal(geminiKeySavedAudit.metadata.restartRequired, false);
  assert.equal(geminiKeySavedAudit.metadata.credentialKind, "api_key");
  assert.equal(geminiKeySavedAudit.metadata.credentialLengthBucket, "40-79");
  assert.equal(typeof geminiKeySavedAudit.metadata.secureStorage.label, "string");
  assert.equal(typeof geminiKeySavedAudit.metadata.secureStorage.fallbackActive, "boolean");
  const geminiKeyDeletedAudit = findConfigAudit("ai_key_deleted", "google_gemini");
  assert.equal(geminiKeyDeletedAudit.metadata.providerId, "gemini");
  assert.equal(geminiKeyDeletedAudit.metadata.provider, "Google Gemini");
  assert.equal(geminiKeyDeletedAudit.metadata.compatibilityEndpoint, true);
  assert.equal(geminiKeyDeletedAudit.metadata.configured, false);
  assert.equal(geminiKeyDeletedAudit.metadata.previousConfigured, true);
  assert.equal(geminiKeyDeletedAudit.metadata.configuredChanged, true);
  assert.equal(geminiKeyDeletedAudit.metadata.sourceChanged, true);
  assert.equal(geminiKeyDeletedAudit.metadata.source, "missing");
  assert.equal(typeof geminiKeyDeletedAudit.metadata.secureStorage.migrationRecommended, "boolean");
  const openAiKeySavedAudit = findConfigAudit("ai_key_saved", "openai");
  assert.equal(openAiKeySavedAudit.metadata.providerId, "openai");
  assert.equal(openAiKeySavedAudit.metadata.provider, "OpenAI");
  assert.equal(openAiKeySavedAudit.metadata.configured, true);
  assert.equal(openAiKeySavedAudit.metadata.previousConfigured, false);
  assert.equal(openAiKeySavedAudit.metadata.configuredChanged, true);
  assert.equal(openAiKeySavedAudit.metadata.sourceChanged, true);
  assert.equal(openAiKeySavedAudit.metadata.enabled, true);
  assert.equal(openAiKeySavedAudit.metadata.active, false);
  assert.equal(openAiKeySavedAudit.metadata.source, "encrypted_store");
  assert.equal(openAiKeySavedAudit.metadata.envVar, "OPENAI_API_KEY");
  assert.equal(openAiKeySavedAudit.metadata.envManaged, false);
  assert.equal(openAiKeySavedAudit.metadata.defaultModel, "gpt-4o-mini");
  assert.equal(openAiKeySavedAudit.metadata.modelCatalogCount >= 2, true);
  assert.equal(openAiKeySavedAudit.metadata.credentialKind, "api_key");
  assert.equal(openAiKeySavedAudit.metadata.credentialLengthBucket, "16-39");
  assert.equal(typeof openAiKeySavedAudit.metadata.selectedModel, "string");
  assert.equal(typeof openAiKeySavedAudit.metadata.secureStorage.systemAvailable, "boolean");
  const openAiKeyDeletedAudit = findConfigAudit("ai_key_deleted", "openai");
  assert.equal(openAiKeyDeletedAudit.metadata.providerId, "openai");
  assert.equal(openAiKeyDeletedAudit.metadata.provider, "OpenAI");
  assert.equal(openAiKeyDeletedAudit.metadata.configured, false);
  assert.equal(openAiKeyDeletedAudit.metadata.previousConfigured, true);
  assert.equal(openAiKeyDeletedAudit.metadata.configuredChanged, true);
  assert.equal(openAiKeyDeletedAudit.metadata.sourceChanged, true);
  assert.equal(openAiKeyDeletedAudit.metadata.enabled, true);
  assert.equal(openAiKeyDeletedAudit.metadata.source, "missing");
  const openAiTestAudit = findConfigAudit("ai_provider_tested", "openai");
  assert.equal(openAiTestAudit.metadata.providerId, "openai");
  assert.equal(openAiTestAudit.metadata.provider, "OpenAI");
  assert.equal(openAiTestAudit.metadata.configured, true);
  assert.equal(openAiTestAudit.metadata.envManaged, false);
  assert.equal(openAiTestAudit.metadata.modelCatalogCount >= 2, true);
  assert.equal(openAiTestAudit.metadata.result, "ready");
  assert.equal(openAiTestAudit.metadata.reason, "ready");
  assert.equal(openAiTestAudit.metadata.credentialKind, "api_key");
  assert.equal(openAiTestAudit.metadata.mode, "configuration");
  assert.equal(openAiTestAudit.metadata.liveSupported, false);
  assert.equal(openAiTestAudit.metadata.selectedModel, "gpt-4o");
  assert.equal(typeof openAiTestAudit.metadata.checkedAt, "number");
  const localTestAudit = findConfigAudit("ai_provider_tested", "local");
  assert.equal(localTestAudit.metadata.providerId, "local");
  assert.equal(localTestAudit.metadata.provider, "Local Model");
  assert.equal(localTestAudit.metadata.configured, false);
  assert.equal(localTestAudit.metadata.modelCatalogCount >= 1, true);
  assert.equal(localTestAudit.metadata.result, "not_configured");
  assert.equal(localTestAudit.metadata.reason, "missing_local_endpoint");
  assert.equal(localTestAudit.metadata.credentialKind, "endpoint");
  assert.equal(localTestAudit.metadata.liveSupported, true);
  const openAiDefaultAudit = findConfigAudit("ai_provider_default_updated", "openai");
  assert.equal(openAiDefaultAudit.metadata.provider, "OpenAI");
  assert.equal(openAiDefaultAudit.metadata.active, true);
  assert.equal(openAiDefaultAudit.metadata.configured, true);
  assert.equal(openAiDefaultAudit.metadata.source, "encrypted_store");
  assert.equal(openAiDefaultAudit.metadata.selectedModel, "gpt-4o");
  assert.equal(openAiDefaultAudit.metadata.previousActiveProvider, "gemini");
  assert.equal(openAiDefaultAudit.metadata.changed, true);
  assert.equal(typeof openAiDefaultAudit.metadata.secureStorage.fallbackActive, "boolean");
  const openAiModelAudit = findConfigAudit("ai_provider_model_updated", "openai");
  assert.equal(openAiModelAudit.metadata.provider, "OpenAI");
  assert.equal(openAiModelAudit.metadata.model, "gpt-4o");
  assert.equal(openAiModelAudit.metadata.previousModel, "gpt-4o-mini");
  assert.equal(openAiModelAudit.metadata.changed, true);
  assert.equal(openAiModelAudit.metadata.selectedModel, "gpt-4o");
  assert.equal(openAiModelAudit.metadata.source, "missing");
  assert.equal(typeof openAiModelAudit.metadata.secureStorage.migrationRecommended, "boolean");
  const localModelAudit = findConfigAudit("ai_provider_model_updated", "local");
  assert.equal(localModelAudit.metadata.provider, "Local Model");
  assert.equal(localModelAudit.metadata.model, "custom-local-model:latest");
  assert.equal(localModelAudit.metadata.previousModel, "llama3.2");
  assert.equal(localModelAudit.metadata.changed, true);
  assert.equal(localModelAudit.metadata.credentialKind, undefined);
  assert.equal(localModelAudit.metadata.source, "missing");
  const auditJson = JSON.stringify(auditAfterExports);
  assert.equal(auditJson.includes(testAiKey), false);
  assert.equal(auditJson.includes(openAiKey), false);
  assert.equal(auditJson.includes(encryptedPassphrase), false);
  assert.equal(auditJson.includes("correct horse battery staple"), false);
  assert.equal(auditJson.includes("password123"), false);
  assert.equal(auditJson.includes("connection-secret"), false);
  assert.equal(auditJson.includes("desktop-secret"), false);
  assert.equal(auditJson.includes("user:password"), false);
  assert.equal(auditJson.includes(dataDir), false);
  assert.equal(auditJson.includes("ciphertext"), false);
  assert.equal(restoredBackup.restore.restartRequired, true);

  const pendingRestore = await request(port, "/api/v1/backups/pending-restore", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(pendingRestore.pendingRestore.restoredFrom, backup.backup.file);

  const binding = await request(port, "/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ baseUrl: "https://phone.example.test/some/path" }),
  }).then((res) => res.json());
  assert.match(binding.token, /^bind_/);
  assert.equal(binding.baseUrl, "https://phone.example.test/some/path");
  assert.equal(binding.pairingUrl, `https://phone.example.test/some/path/mobile/install/${encodeURIComponent(binding.token)}`);
  const networkDiagnosticsWithBinding = await request(port, "/api/v1/admin/network-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(networkDiagnosticsWithBinding.latestBindingSession.id, binding.id);
  assert.equal(networkDiagnosticsWithBinding.latestBindingSession.baseUrl, binding.baseUrl);
  assert.equal(networkDiagnosticsWithBinding.latestBindingSession.expiresAt, binding.expiresAt);
  assert.equal(networkDiagnosticsWithBinding.latestBindingSession.expired, false);
  assert.equal(typeof networkDiagnosticsWithBinding.remoteHealthMonitor.enabled, "boolean");
  assert.equal(typeof networkDiagnosticsWithBinding.remoteHealthMonitor.running, "boolean");
  assert.equal(typeof networkDiagnosticsWithBinding.remoteHealthMonitor.intervalMs, "number");
  assert.notEqual(networkDiagnosticsWithBinding.remoteHealthSummary.checks.find((check) => check.id === "qr-entry").status, "fail");

  const invalidPairingBaseUrl = await request(port, "/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ baseUrl: "lifeos://open-navigation" }),
  });
  assert.equal(invalidPairingBaseUrl.status, 400);

  const credentialUrlPairingBaseUrl = await request(port, "/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ baseUrl: "https://user:pass@example.test" }),
  });
  assert.equal(credentialUrlPairingBaseUrl.status, 400);

  const tokenizedPairingBaseUrl = await request(port, "/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ baseUrl: "https://phone.example.test/mobile?token=secret#debug" }),
  });
  assert.equal(tokenizedPairingBaseUrl.status, 400);
  const tokenizedPairingBaseUrlBody = await tokenizedPairingBaseUrl.json();
  assert.match(tokenizedPairingBaseUrlBody.error, /username, password, token, query, or fragment/);

  for (const unsafePhoneBaseUrl of [
    `http://127.0.0.1:${port}`,
    "http://localhost:3000",
    "http://0.0.0.0:3000",
    "http://169.254.10.20:3000",
    "http://[::1]:3000",
  ]) {
    const localOnlyPairingBaseUrl = await request(port, "/api/v1/devices/bind/start", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ baseUrl: unsafePhoneBaseUrl }),
    });
    assert.equal(localOnlyPairingBaseUrl.status, 400);
    const localOnlyPairingBaseUrlBody = await localOnlyPairingBaseUrl.json();
    assert.match(localOnlyPairingBaseUrlBody.error, /reachable from the phone/);
  }

  const credential = await request(port, "/api/v1/devices/bind/confirm", {
    method: "POST",
    body: JSON.stringify({ token: binding.token, deviceName: "Test Phone", deviceType: "mobile" }),
  }).then((res) => res.json());
  assert.equal(credential.device.name, "Test Phone");
  assert.match(credential.accessToken, /^device_/);
  assert.equal(typeof credential.accessTokenExpiresAt, "number");

  const deviceHeaders = {
    "X-LifeOS-Device-ID": credential.device.id,
    "X-LifeOS-Device-Token": credential.accessToken,
  };
  const unauthConnectivityReport = await request(port, "/api/v1/devices/me/connectivity-report", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ ok: true }),
  });
  assert.equal(unauthConnectivityReport.status, 401);
  const unauthLatestConnectivityReport = await request(port, "/api/v1/devices/me/connectivity-report", {
    headers: adminHeaders,
  });
  assert.equal(unauthLatestConnectivityReport.status, 401);
  const connectivityReport = await request(port, "/api/v1/devices/me/connectivity-report", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      ok: true,
      currentBase: "https://phone.example.test/lifeos",
      latencyMs: 42,
      error: "Recovered after https://user:password@phone.example.test/lifeos?token=connectivity-secret#debug",
      steps: [
        { id: "health", ok: true, latencyMs: 12, status: 200 },
        { id: "mobile-shell", ok: true, latencyMs: 10, status: 200 },
        { id: "websocket", ok: true, latencyMs: 30, status: 101 },
      ],
    }),
  }).then((res) => res.json().then((body) => ({ status: res.status, body })));
  assert.equal(connectivityReport.status, 200);
  assert.equal(connectivityReport.body.report.ok, true);
  assert.equal(connectivityReport.body.report.currentBaseUrl, "https://phone.example.test/lifeos");
  assert.equal(connectivityReport.body.report.healthOk, true);
  assert.equal(connectivityReport.body.report.mobileShellOk, true);
  assert.equal(connectivityReport.body.report.websocketOk, true);
  assert.equal(connectivityReport.body.report.error.includes("connectivity-secret"), false);
  assert.equal(connectivityReport.body.report.error.includes("user:password"), false);
  const latestConnectivityReport = await request(port, "/api/v1/devices/me/connectivity-report", {
    headers: deviceHeaders,
  }).then((res) => res.json());
  assert.equal(latestConnectivityReport.report.id, connectivityReport.body.report.id);
  assert.equal(latestConnectivityReport.report.ok, true);
  assert.equal(latestConnectivityReport.report.currentBaseUrl, "https://phone.example.test/lifeos");
  assert.equal(latestConnectivityReport.report.websocketOk, true);
  assert.equal(latestConnectivityReport.report.error.includes("connectivity-secret"), false);
  const devicesAfterConnectivityReport = await request(port, "/api/v1/devices", { headers: adminHeaders }).then((res) => res.json());
  const reportedDevice = devicesAfterConnectivityReport.devices.find((device) => device.id === credential.device.id);
  assert.equal(reportedDevice.connectivityReport.ok, true);
  assert.equal(reportedDevice.connectivityReport.currentBaseUrl, "https://phone.example.test/lifeos");
  assert.equal(reportedDevice.connectivityReport.mobileShellOk, true);
  assert.equal(reportedDevice.connectivityReport.error.includes("connectivity-secret"), false);

  const selfRevokeBinding = await request(port, "/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  const selfRevokeCredential = await request(port, "/api/v1/devices/bind/confirm", {
    method: "POST",
    body: JSON.stringify({ token: selfRevokeBinding.token, deviceName: "Self Revoke Phone", deviceType: "mobile" }),
  }).then((res) => res.json());
  const selfRevokeHeaders = {
    "X-LifeOS-Device-ID": selfRevokeCredential.device.id,
    "X-LifeOS-Device-Token": selfRevokeCredential.accessToken,
  };
  const selfRevoke = await request(port, "/api/v1/devices/me", {
    method: "DELETE",
    headers: selfRevokeHeaders,
  }).then((res) => res.json().then((body) => ({ status: res.status, body })));
  assert.equal(selfRevoke.status, 200);
  assert.equal(selfRevoke.body.ok, true);
  assert.equal(selfRevoke.body.device.id, selfRevokeCredential.device.id);
  assert.equal(selfRevoke.body.device.status, "revoked");
  assert.equal(selfRevoke.body.device.accessToken, undefined);
  assert.equal(selfRevoke.body.device.accessTokenHash, undefined);
  const selfRevokedStateAccess = await request(port, "/api/v1/state/lifeos_tasks_pro", { headers: selfRevokeHeaders });
  assert.equal(selfRevokedStateAccess.status, 401);

  const signatureBinding = await request(port, "/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  const signatureKeyPair = createDeviceKeyPair();
  const signatureCredential = await request(port, "/api/v1/devices/bind/confirm", {
    method: "POST",
    body: JSON.stringify({
      token: signatureBinding.token,
      deviceName: "Signature Phone",
      deviceType: "mobile",
      publicKey: signatureKeyPair.publicKey,
    }),
  }).then((res) => res.json());
  assert.equal(signatureCredential.authMethod, "signature");
  assert.equal(signatureCredential.accessToken, undefined);
  assert.equal(typeof signatureCredential.accessTokenExpiresAt, "number");
  const signedStateBody = JSON.stringify({ value: { enabled: true } });
  const signedStateHeaders = signedDeviceHeaders({
    deviceId: signatureCredential.device.id,
    privateKey: signatureKeyPair.privateKey,
    method: "PUT",
    pathname: "/api/v1/state/lifeos_proxy_enabled",
    body: signedStateBody,
  });
  const signedState = await request(port, "/api/v1/state/lifeos_proxy_enabled", {
    method: "PUT",
    headers: signedStateHeaders,
    body: signedStateBody,
  }).then((res) => res.json());
  assert.equal(signedState.value.enabled, true);

  const tamperedSignedState = await request(port, "/api/v1/state/lifeos_proxy_enabled", {
    method: "PUT",
    headers: signedStateHeaders,
    body: JSON.stringify({ value: { enabled: false } }),
  });
  assert.equal(tamperedSignedState.status, 401);

  const missingAiChat = await request(port, "/api/chat", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ message: "hello" }),
  }).then((res) => res.json().then((body) => ({ status: res.status, body })));
  assert.equal(missingAiChat.status, 503);
  assert.equal(missingAiChat.body.code, "AI_CONFIG_MISSING");
  assert.equal(missingAiChat.body.providerId, "openai");
  assert.equal(missingAiChat.body.envVar, "OPENAI_API_KEY");
  assert.equal(missingAiChat.body.setupPath, "/admin/settings");

  const missingOpenAiChat = await request(port, "/api/chat", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ message: "hello", modelEngine: "GPT-4o" }),
  }).then((res) => res.json().then((body) => ({ status: res.status, body })));
  assert.equal(missingOpenAiChat.status, 503);
  assert.equal(missingOpenAiChat.body.code, "AI_CONFIG_MISSING");
  assert.equal(missingOpenAiChat.body.providerId, "openai");
  assert.equal(missingOpenAiChat.body.envVar, "OPENAI_API_KEY");

  const missingAiAppGeneration = await request(port, "/api/generate_app", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ appName: "Test", description: "A tiny test app" }),
  }).then((res) => res.json().then((body) => ({ status: res.status, body })));
  assert.equal(missingAiAppGeneration.status, 503);
  assert.equal(missingAiAppGeneration.body.code, "AI_CONFIG_MISSING");

  const localModelServer = createHttpServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { id: "custom-local-model:latest" },
          { id: "llama3.2" },
          { id: "phi4:latest" },
        ],
      }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((resolve) => localModelServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => localModelServer.close(resolve));
  });
  const localModelPort = localModelServer.address().port;
  const localModelEndpoint = `http://127.0.0.1:${localModelPort}/v1`;
  const savedLocalProvider = await request(port, "/api/v1/admin/ai-providers/local/key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ apiKey: localModelEndpoint }),
  }).then((res) => res.json());
  assert.equal(savedLocalProvider.provider.id, "local");
  assert.equal(savedLocalProvider.provider.configured, true);
  const testedLocalLive = await request(port, "/api/v1/admin/ai-providers/local/test", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ mode: "live" }),
  }).then((res) => res.json());
  assert.equal(testedLocalLive.ok, true);
  assert.equal(testedLocalLive.mode, "live");
  assert.equal(testedLocalLive.liveSupported, true);
  assert.equal(testedLocalLive.result, "live_ready");
  assert.equal(testedLocalLive.reason, "models_endpoint_ok");
  assert.equal(testedLocalLive.modelCount, 3);
  assert.equal(testedLocalLive.discoveredModelCount, 3);
  assert.equal(testedLocalLive.modelCatalogUpdated, true);
  assert.equal(testedLocalLive.selectedModelAvailable, true);
  assert.ok(testedLocalLive.provider.models.includes("phi4:latest"));
  assert.match(testedLocalLive.message, /live connection succeeded/);
  assert.match(testedLocalLive.message, /Model list refreshed/);
  assert.equal(JSON.stringify(testedLocalLive).includes(localModelEndpoint), false);
  const localProvidersAfterLive = await request(port, "/api/v1/admin/ai-providers", { headers: adminHeaders }).then((res) => res.json());
  assert.ok(localProvidersAfterLive.providers.find((provider) => provider.id === "local").models.includes("phi4:latest"));
  const auditAfterLocalLive = await request(port, "/api/v1/audit-logs", { headers: adminHeaders }).then((res) => res.json());
  const localLiveTestAudit = auditAfterLocalLive.logs.find((log) => log.action === "ai_provider_tested" && log.targetType === "config" && log.targetId === "local" && log.metadata.result === "live_ready");
  assert.equal(localLiveTestAudit.metadata.provider, "Local Model");
  assert.equal(localLiveTestAudit.metadata.configured, true);
  assert.equal(localLiveTestAudit.metadata.mode, "live");
  assert.equal(localLiveTestAudit.metadata.reason, "models_endpoint_ok");
  assert.equal(localLiveTestAudit.metadata.modelCount, 3);
  assert.equal(localLiveTestAudit.metadata.discoveredModelCount, 3);
  assert.equal(localLiveTestAudit.metadata.modelCatalogUpdated, true);
  assert.equal(localLiveTestAudit.metadata.selectedModelAvailable, true);
  assert.equal(JSON.stringify(localLiveTestAudit).includes("127.0.0.1"), false);

  const completedOnboarding = await request(port, "/api/v1/admin/onboarding/complete", {
    method: "PUT",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(completedOnboarding.onboarding.completed, true);
  assert.equal(completedOnboarding.onboarding.required, false);
  assert.equal(completedOnboarding.onboarding.nextPath, "/chat");
  assert.equal(typeof completedOnboarding.onboarding.completedAt, "number");
  assert.equal(completedOnboarding.onboarding.steps.every((step) => step.done), true);

  const statusAfterOnboarding = await request(port, "/api/v1/admin/status", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(statusAfterOnboarding.onboardingRequired, false);
  assert.equal(statusAfterOnboarding.nextPath, "/chat");

  const rotated = await request(port, "/api/v1/devices/token/rotate", {
    method: "POST",
    headers: deviceHeaders,
  }).then((res) => res.json());
  assert.match(rotated.accessToken, /^device_/);
  assert.notEqual(rotated.accessToken, credential.accessToken);
  assert.equal(typeof rotated.accessTokenExpiresAt, "number");

  const oldTokenAccess = await request(port, "/api/v1/chat/sessions", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ title: "Old Token Test" }),
  });
  assert.equal(oldTokenAccess.status, 401);
  deviceHeaders["X-LifeOS-Device-Token"] = rotated.accessToken;

  const chatSession = await request(port, "/api/v1/chat/sessions", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ title: "Mobile Test" }),
  }).then((res) => res.json());
  assert.equal(chatSession.session.title, "Mobile Test");

  const chatMessage = await request(port, `/api/v1/chat/sessions/${chatSession.session.id}/messages`, {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      role: "user",
      content: "Hello from mobile",
      sourceDeviceId: credential.device.id,
      metadata: {
        mutationId: "offline-mutation-1",
        idempotencyKey: "lifeos-offline:test-device:hello:offline-mutation-1",
        clientSequence: 7,
        sourceVersion: 1,
        queuedAt: Date.now() - 1000,
      },
    }),
  }).then((res) => res.json());
  assert.equal(chatMessage.message.contentJson, "Hello from mobile");
  assert.equal(chatMessage.message.offlineMutationId, "offline-mutation-1");
  assert.equal(chatMessage.message.idempotencyKey, "lifeos-offline:test-device:hello:offline-mutation-1");
  assert.equal(chatMessage.message.clientSequence, 7);

  const duplicateChatMessage = await request(port, `/api/v1/chat/sessions/${chatSession.session.id}/messages`, {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      role: "user",
      content: "Hello from mobile duplicate retry",
      sourceDeviceId: credential.device.id,
      metadata: {
        mutationId: "offline-mutation-1",
        idempotencyKey: "lifeos-offline:test-device:hello:offline-mutation-1",
        clientSequence: 7,
        sourceVersion: 1,
      },
    }),
  }).then((res) => res.json());
  assert.equal(duplicateChatMessage.message.id, chatMessage.message.id);
  assert.equal(duplicateChatMessage.message.contentJson, "Hello from mobile");

  const loadedMessages = await request(port, `/api/v1/chat/sessions/${chatSession.session.id}/messages`, { headers: adminHeaders }).then((res) => res.json());
  assert.equal(loadedMessages.messages.length, 1);
  assert.equal(loadedMessages.messages[0].role, "user");
  assert.equal(loadedMessages.messages[0].contentJson, "Hello from mobile");
  assert.equal(loadedMessages.messages[0].idempotencyKey, "lifeos-offline:test-device:hello:offline-mutation-1");

  const createdMemory = await request(port, "/api/v1/memories", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ title: "Test memory", content: "Remember this", sensitivity: "normal" }),
  }).then((res) => res.json());
  assert.equal(createdMemory.memory.title, "Test memory");

  const updatedMemory = await request(port, `/api/v1/memories/${createdMemory.memory.id}`, {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ content: "Updated memory", sensitivity: "sensitive" }),
  }).then((res) => res.json());
  assert.equal(updatedMemory.memory.content, "Updated memory");
  assert.equal(updatedMemory.memory.sensitivity, "sensitive");

  const deletedMemory = await request(port, `/api/v1/memories/${createdMemory.memory.id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(deletedMemory.status, 200);

  const unauthProblemBlueprints = await request(port, "/api/v1/problem-blueprints");
  assert.equal(unauthProblemBlueprints.status, 401);
  const unauthCustomApps = await request(port, "/api/v1/custom-apps");
  assert.equal(unauthCustomApps.status, 401);
  const unauthCustomAppVersions = await request(port, "/api/v1/custom-apps/custom-ledger-1/versions");
  assert.equal(unauthCustomAppVersions.status, 401);
  const unauthCustomAppVersionCompare = await request(port, "/api/v1/custom-apps/custom-ledger-1/version-compare?from=1&to=2");
  assert.equal(unauthCustomAppVersionCompare.status, 401);
  const unauthCustomAppState = await request(port, "/api/v1/custom-apps/custom-ledger-1/state");
  assert.equal(unauthCustomAppState.status, 401);
  const unauthCustomAppCapabilities = await request(port, "/api/v1/custom-apps/custom-ledger-1/capabilities");
  assert.equal(unauthCustomAppCapabilities.status, 401);
  const unauthCustomAppRuntimeEvents = await request(port, "/api/v1/custom-apps/custom-ledger-1/runtime-events");
  assert.equal(unauthCustomAppRuntimeEvents.status, 401);
  const unauthCustomAppAutoRepairQueue = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs/queue");
  assert.equal(unauthCustomAppAutoRepairQueue.status, 401);
  const unauthCustomAppCapabilityRequests = await request(port, "/api/v1/custom-apps/custom-ledger-1/capability-requests");
  assert.equal(unauthCustomAppCapabilityRequests.status, 401);
  const unauthCustomAppActionPolicy = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-policy");
  assert.equal(unauthCustomAppActionPolicy.status, 401);
  const unauthCustomAppActions = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests");
  assert.equal(unauthCustomAppActions.status, 401);
  const unauthCustomAppAutoRepairComplete = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs/complete", { method: "POST" });
  assert.equal(unauthCustomAppAutoRepairComplete.status, 401);

  const createdProblemBlueprint = await request(port, "/api/v1/problem-blueprints", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      problem: "帮我做一个本月支出记账、预算提醒和分类汇总面板 github_pat_problemSecret_1234567890 /Users/example/private-ledger.csv",
      source: "studio",
    }),
  }).then((res) => res.json());
  assert.equal(createdProblemBlueprint.blueprint.category, "ledger");
  assert.equal(createdProblemBlueprint.blueprint.status, "planned");
  assert.equal(createdProblemBlueprint.blueprint.source, "studio");
  assert.match(createdProblemBlueprint.blueprint.appPrompt, /生成一个可运行的解决程序/);
  assert.equal(JSON.stringify(createdProblemBlueprint).includes("github_pat_problemSecret"), false);
  assert.equal(JSON.stringify(createdProblemBlueprint).includes("/Users/example/private-ledger.csv"), false);

  const problemBlueprintHistory = await request(port, "/api/v1/problem-blueprints?limit=5", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(problemBlueprintHistory.blueprints.length, 1);
  assert.equal(problemBlueprintHistory.blueprints[0].id, createdProblemBlueprint.blueprint.id);

  const createdCustomApp = await request(port, "/api/v1/custom-apps", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: "custom-ledger-1",
      name: "本月预算提醒面板",
      description: "Personal ledger helper /Users/example/private-ledger.csv",
      visibility: "private",
      status: "active",
      source: "studio",
      code: "<script>const token='github_pat_customAppSecret_1234567890'; const path='/Users/example/private-app.html';</script>",
    }),
  }).then((res) => res.json());
  assert.equal(createdCustomApp.app.id, "custom-ledger-1");
  assert.equal(createdCustomApp.app.source, "studio");
  assert.equal(createdCustomApp.app.code.includes("github_pat_customAppSecret"), false);
  assert.equal(createdCustomApp.app.code.includes("/Users/example/private-app.html"), false);
  assert.equal(createdCustomApp.app.description.includes("/Users/example/private-ledger.csv"), false);

  const customAppVersionsAfterCreate = await request(port, "/api/v1/custom-apps/custom-ledger-1/versions", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(customAppVersionsAfterCreate.versions.length, 1);
  assert.equal(customAppVersionsAfterCreate.versions[0].version, 1);
  assert.equal(customAppVersionsAfterCreate.versions[0].note, "Initial version");
  assert.equal(customAppVersionsAfterCreate.versions[0].code.includes("github_pat_customAppSecret"), false);
  assert.equal(customAppVersionsAfterCreate.versions[0].code.includes("/Users/example/private-app.html"), false);

  const initialCustomAppState = await request(port, "/api/v1/custom-apps/custom-ledger-1/state", { headers: adminHeaders }).then((res) => res.json());
  assert.deepEqual(initialCustomAppState.state.state, {});
  assert.equal(initialCustomAppState.state.updatedAt, 0);

  const savedCustomAppState = await request(port, "/api/v1/custom-apps/custom-ledger-1/state", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      state: {
        rows: [{ note: "safe", source: "/Users/example/private-state.csv" }],
        token: "github_pat_customStateSecret_1234567890",
      },
    }),
  }).then((res) => res.json());
  assert.equal(JSON.stringify(savedCustomAppState).includes("github_pat_customStateSecret"), false);
  assert.equal(JSON.stringify(savedCustomAppState).includes("/Users/example/private-state.csv"), false);

  const customAppRuntimeEvent = await request(port, "/api/v1/custom-apps/custom-ledger-1/runtime-events", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      eventType: "error",
      severity: "error",
      label: "Runtime failed with secret",
      message: "Unhandled github_pat_runtimeEventSecret_1234567890 from /Users/example/runtime.log",
      detail: {
        token: "github_pat_runtimeEventDetailSecret_1234567890",
        localPath: "/Users/example/detail.log",
        safe: "kept",
      },
    }),
  }).then((res) => res.json());
  assert.equal(customAppRuntimeEvent.event.eventType, "error");
  assert.equal(customAppRuntimeEvent.event.severity, "error");
  assert.equal(JSON.stringify(customAppRuntimeEvent).includes("github_pat_runtimeEventSecret"), false);
  assert.equal(JSON.stringify(customAppRuntimeEvent).includes("github_pat_runtimeEventDetailSecret"), false);
  assert.equal(JSON.stringify(customAppRuntimeEvent).includes("/Users/example/runtime.log"), false);

  const customAppDebugRequest = await request(port, "/api/v1/custom-apps/custom-ledger-1/debug-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      issue: "Fix the ledger crash with github_pat_debugRequestSecret_1234567890 and /Users/example/debug.txt",
    }),
  }).then((res) => res.json());
  assert.match(customAppDebugRequest.suggestedInstruction, /本月预算提醒面板|LifeOS/);
  assert.equal(customAppDebugRequest.repairProposal.appId, "custom-ledger-1");
  assert.equal(customAppDebugRequest.repairProposal.suspectedArea, "runtime-error");
  assert.equal(customAppDebugRequest.repairProposal.risk, "medium");
  assert.equal(customAppDebugRequest.repairProposal.repairSteps.length >= 3, true);
  assert.equal(customAppDebugRequest.repairProposal.permissionReview.some((item) => item.includes("capability manifest")), true);
  assert.equal(customAppDebugRequest.repairProposal.versionSafety.some((item) => item.includes("Compare")), true);
  assert.equal(customAppDebugRequest.repairProposal.executionPlan.mode, "auto-save");
  assert.equal(customAppDebugRequest.repairProposal.executionPlan.canAutoApply, true);
  assert.equal(customAppDebugRequest.repairProposal.executionPlan.reasonKey, "low-risk-runtime");
  assert.equal(customAppDebugRequest.repairProposal.executionPlan.checks.some((item) => item.includes("rollback")), true);
  assert.equal(customAppDebugRequest.repairProposal.suggestedInstruction, customAppDebugRequest.suggestedInstruction);
  assert.equal(JSON.stringify(customAppDebugRequest).includes("github_pat_debugRequestSecret"), false);
  assert.equal(JSON.stringify(customAppDebugRequest).includes("/Users/example/debug.txt"), false);

  const customAppAutoRepairPlan = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      issue: "Fix the visible ledger crash without changing permissions",
    }),
  }).then((res) => res.json());
  assert.equal(customAppAutoRepairPlan.debugEvent.eventType, "debug_requested");
  assert.equal(customAppAutoRepairPlan.autoRepairEvent.eventType, "auto_repair_planned");
  assert.equal(customAppAutoRepairPlan.autoRepairTask.status, "ready");
  assert.equal(customAppAutoRepairPlan.autoRepairTask.canAutoApply, true);
  assert.equal(customAppAutoRepairPlan.autoRepairTask.reasonKey, "low-risk-runtime");
  assert.equal(customAppAutoRepairPlan.autoRepairTask.repairAttempt, 1);
  assert.equal(customAppAutoRepairPlan.autoRepairTask.retryLimit, 2);
  assert.equal(customAppAutoRepairPlan.autoRepairTask.rollbackVersion >= 1, true);
  assert.equal(customAppAutoRepairPlan.autoRepairTask.requiredChecks.some((item) => item.includes("rollback")), true);
  assert.equal(customAppAutoRepairPlan.executionSession.status, "ready");
  assert.equal(customAppAutoRepairPlan.executionSession.canRunUnattended, true);
  assert.equal(customAppAutoRepairPlan.executionSession.mode, "studio-refine-worker");
  assert.equal(customAppAutoRepairPlan.executionSession.taskId, customAppAutoRepairPlan.autoRepairTask.id);
  assert.equal(customAppAutoRepairPlan.autoRepairTask.executionSession.taskId, customAppAutoRepairPlan.autoRepairTask.id);
  assert.equal(customAppAutoRepairPlan.executionSession.requiredSteps.some((item) => item.includes("completion endpoint")), true);
  assert.equal(customAppAutoRepairPlan.executionSession.smokeChecks.some((item) => item.includes("failing scenario")), true);
  assert.equal(customAppAutoRepairPlan.executionSession.completionEndpoint.includes("/auto-repairs/complete"), true);
  assert.equal(customAppAutoRepairPlan.repairProposal.suggestedInstruction, customAppAutoRepairPlan.suggestedInstruction);
  const customAppAutoRepairQueue = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs/queue?limit=5", {
    headers: adminHeaders,
  }).then((res) => res.json());
  const pendingAutoRepair = customAppAutoRepairQueue.queue.find((item) => item.resumeInstruction === customAppAutoRepairPlan.suggestedInstruction);
  assert.equal(pendingAutoRepair.status, "pending");
  assert.equal(pendingAutoRepair.waitingFor, "studio-refine");
  assert.equal(pendingAutoRepair.canResumeInStudio, true);
  assert.equal(pendingAutoRepair.resumeInstruction, customAppAutoRepairPlan.suggestedInstruction);
  assert.equal(pendingAutoRepair.task.rollbackVersion, customAppAutoRepairPlan.autoRepairTask.rollbackVersion);
  assert.equal(pendingAutoRepair.executionSession.status, "ready");
  assert.equal(pendingAutoRepair.executionSession.canRunUnattended, true);
  assert.equal(pendingAutoRepair.executionSession.instruction, customAppAutoRepairPlan.suggestedInstruction);
  assert.equal(pendingAutoRepair.readiness.status, "ready");
  assert.equal(pendingAutoRepair.readiness.canAutoApply, true);
  assert.equal(pendingAutoRepair.readiness.decision, "resume-in-studio");
  assert.equal(pendingAutoRepair.readiness.failedChecks.length, 0);
  assert.equal(pendingAutoRepair.readiness.passedChecks.some((item) => item.includes("Rollback")), true);
  assert.equal(pendingAutoRepair.readiness.passedChecks.some((item) => item.includes("Execution session")), true);

  await request(port, "/api/v1/custom-apps/custom-ledger-1", {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      code: "<main><h1>Fixed ledger workflow</h1><p>Safe repaired version keeps local state and avoids new permissions.</p></main>",
    }),
  }).then((res) => res.json());
  const customAppAutoRepairComplete = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs/complete", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      taskId: customAppAutoRepairPlan.autoRepairTask.id,
      fromVersion: customAppAutoRepairPlan.autoRepairTask.rollbackVersion,
      suggestedInstruction: customAppAutoRepairPlan.suggestedInstruction,
      autoSmoke: true,
    }),
  }).then((res) => res.json());
  assert.equal(customAppAutoRepairComplete.event.eventType, "auto_repair_applied");
  assert.equal(customAppAutoRepairComplete.result.status, "applied");
  assert.equal(customAppAutoRepairComplete.result.taskId, customAppAutoRepairPlan.autoRepairTask.id);
  assert.equal(customAppAutoRepairComplete.result.fromVersion, customAppAutoRepairPlan.autoRepairTask.rollbackVersion);
  assert.equal(customAppAutoRepairComplete.result.toVersion > customAppAutoRepairComplete.result.fromVersion, true);
  assert.equal(customAppAutoRepairComplete.result.rollbackAvailable, true);
  assert.equal(customAppAutoRepairComplete.result.verification.status, "pending-smoke");
  assert.equal(customAppAutoRepairComplete.result.verification.requiredChecks.some((item) => item.includes("workflow")), true);
  assert.equal(customAppAutoRepairComplete.comparison.risk, "low");
  assert.equal(customAppAutoRepairComplete.comparison.toVersion, customAppAutoRepairComplete.result.toVersion);
  assert.equal(customAppAutoRepairComplete.staticSmoke.review.status, "passed");
  assert.equal(customAppAutoRepairComplete.staticSmoke.review.method, "static-auto");
  assert.equal(customAppAutoRepairComplete.staticSmoke.review.staticChecks.some((item) => item.includes("Version comparison risk is low")), true);
  assert.equal(customAppAutoRepairComplete.staticSmoke.review.rollbackRecommended, false);
  const customAppAutoRepairQueueAfterComplete = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs/queue?limit=5", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(customAppAutoRepairQueueAfterComplete.queue.some((item) => item.resumeInstruction === customAppAutoRepairPlan.suggestedInstruction), false);

  const rollbackAutoRepairPlan = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      issue: "Fix the small runtime rendering error without changing permissions",
    }),
  }).then((res) => res.json());
  assert.equal(rollbackAutoRepairPlan.autoRepairTask.status, "ready");
  await request(port, "/api/v1/custom-apps/custom-ledger-1", {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({
      code: "<p>x</p>",
    }),
  }).then((res) => res.json());
  const failedStaticSmokeAutoRepair = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs/complete", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      taskId: rollbackAutoRepairPlan.autoRepairTask.id,
      fromVersion: rollbackAutoRepairPlan.autoRepairTask.rollbackVersion,
      suggestedInstruction: rollbackAutoRepairPlan.suggestedInstruction,
      autoSmoke: true,
    }),
  }).then((res) => res.json());
  assert.equal(failedStaticSmokeAutoRepair.result.status, "applied");
  assert.equal(failedStaticSmokeAutoRepair.staticSmoke.review.status, "failed");
  assert.equal(failedStaticSmokeAutoRepair.staticSmoke.review.rollbackRecommended, true);
  assert.equal(failedStaticSmokeAutoRepair.autoRollback.status, "rolled-back");
  assert.equal(failedStaticSmokeAutoRepair.autoRollback.attempted, true);
  assert.equal(failedStaticSmokeAutoRepair.autoRollback.rollbackVersion, rollbackAutoRepairPlan.autoRepairTask.rollbackVersion);
  assert.equal(failedStaticSmokeAutoRepair.autoRollback.toVersion > failedStaticSmokeAutoRepair.result.toVersion, true);
  const customAppAfterAutoRollback = await request(port, "/api/v1/custom-apps/custom-ledger-1", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.match(customAppAfterAutoRollback.app.code, /Fixed ledger workflow/);
  assert.doesNotMatch(customAppAfterAutoRollback.app.code, /<p>x<\/p>/);

  const highRiskCustomAppDebugRequest = await request(port, "/api/v1/custom-apps/custom-ledger-1/debug-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      issue: "Fix SMS and Shortcuts launch permissions before the generated app opens external actions",
    }),
  }).then((res) => res.json());
  assert.equal(highRiskCustomAppDebugRequest.repairProposal.risk, "high");
  assert.equal(highRiskCustomAppDebugRequest.repairProposal.executionPlan.mode, "manual-review");
  assert.equal(highRiskCustomAppDebugRequest.repairProposal.executionPlan.canAutoApply, false);
  assert.equal(highRiskCustomAppDebugRequest.repairProposal.executionPlan.reasonKey, "high-risk-action");
  assert.equal(highRiskCustomAppDebugRequest.repairProposal.executionPlan.nextSteps.some((item) => item.includes("permission")), true);

  const highRiskCustomAppAutoRepairPlan = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      issue: "Fix SMS and Shortcuts launch permissions before auto-saving",
    }),
  }).then((res) => res.json());
  assert.equal(highRiskCustomAppAutoRepairPlan.autoRepairEvent.eventType, "auto_repair_blocked");
  assert.equal(highRiskCustomAppAutoRepairPlan.autoRepairTask.status, "blocked");
  assert.equal(highRiskCustomAppAutoRepairPlan.autoRepairTask.canAutoApply, false);
  assert.equal(highRiskCustomAppAutoRepairPlan.autoRepairTask.reasonKey, "high-risk-action");
  assert.equal(highRiskCustomAppAutoRepairPlan.executionSession.status, "blocked");
  assert.equal(highRiskCustomAppAutoRepairPlan.executionSession.canRunUnattended, false);
  assert.equal(highRiskCustomAppAutoRepairPlan.executionSession.mode, "manual-review-gate");
  const blockedAutoRepairQueue = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs/queue?limit=10", {
    headers: adminHeaders,
  }).then((res) => res.json());
  const blockedAutoRepair = blockedAutoRepairQueue.queue.find((item) => item.task.reasonKey === "high-risk-action" && item.status === "blocked");
  assert.equal(blockedAutoRepair.status, "blocked");
  assert.equal(blockedAutoRepair.waitingFor, "manual-review");
  assert.equal(blockedAutoRepair.canResumeInStudio, false);
  assert.equal(blockedAutoRepair.readiness.status, "blocked");
  assert.equal(blockedAutoRepair.readiness.canAutoApply, false);
  assert.equal(blockedAutoRepair.readiness.decision, "manual-review");
  assert.equal(blockedAutoRepair.readiness.failedChecks.some((item) => item.includes("high-risk-action")), true);

  await request(port, "/api/v1/custom-apps/custom-ledger-1/runtime-events", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ eventType: "debug_applied", severity: "info", label: "Repair 1", message: "first repair" }),
  }).then((res) => res.json());
  await request(port, "/api/v1/custom-apps/custom-ledger-1/runtime-events", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ eventType: "debug_applied", severity: "info", label: "Repair 2", message: "second repair" }),
  }).then((res) => res.json());
  const retryLimitedAutoRepairPlan = await request(port, "/api/v1/custom-apps/custom-ledger-1/auto-repairs", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      issue: "Fix the same ledger crash again",
    }),
  }).then((res) => res.json());
  assert.equal(retryLimitedAutoRepairPlan.autoRepairEvent.eventType, "auto_repair_blocked");
  assert.equal(retryLimitedAutoRepairPlan.autoRepairTask.status, "blocked");
  assert.equal(retryLimitedAutoRepairPlan.autoRepairTask.reasonKey, "retry-limit");
  assert.equal(retryLimitedAutoRepairPlan.autoRepairTask.repairAttempt, 3);
  assert.equal(retryLimitedAutoRepairPlan.executionSession.status, "blocked");
  assert.equal(retryLimitedAutoRepairPlan.executionSession.canRunUnattended, false);

  const customAppRuntimeEvents = await request(port, "/api/v1/custom-apps/custom-ledger-1/runtime-events?limit=20", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(customAppRuntimeEvents.events.length >= 2, true);
  assert.equal(customAppRuntimeEvents.events.some((event) => event.eventType === "debug_requested"), true);
  assert.equal(customAppRuntimeEvents.events.some((event) => event.eventType === "auto_repair_planned"), true);
  assert.equal(customAppRuntimeEvents.events.some((event) => event.eventType === "auto_repair_applied"), true);
  assert.equal(customAppRuntimeEvents.events.some((event) => event.eventType === "auto_repair_smoke_passed"), true);
  assert.equal(customAppRuntimeEvents.events.some((event) => event.eventType === "auto_repair_blocked"), true);
  const debugRuntimeEvent = customAppRuntimeEvents.events.find((event) => event.eventType === "debug_requested" && event.detail?.repairProposal?.suspectedArea === "runtime-error");
  assert.equal(debugRuntimeEvent.detail.repairProposal.suspectedArea, "runtime-error");
  assert.equal(debugRuntimeEvent.detail.repairProposal.versionSafety.length >= 2, true);
  assert.equal(typeof debugRuntimeEvent.detail.repairProposal.executionPlan.canAutoApply, "boolean");
  const autoRepairRuntimeEvent = customAppRuntimeEvents.events.find((event) => event.eventType === "auto_repair_planned");
  assert.equal(autoRepairRuntimeEvent.detail.autoRepairExecutionSession.status, "ready");
  assert.equal(autoRepairRuntimeEvent.detail.autoRepairExecutionSession.canRunUnattended, true);

  const defaultCustomAppCapabilities = await request(port, "/api/v1/custom-apps/custom-ledger-1/capabilities", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(defaultCustomAppCapabilities.manifest.allowedCapabilities.includes("storage"), true);
  assert.equal(defaultCustomAppCapabilities.manifest.allowedCapabilities.includes("communication"), true);
  assert.equal(defaultCustomAppCapabilities.manifest.riskLevel, "high");

  const noCommunicationCustomAppCapabilities = await request(port, "/api/v1/custom-apps/custom-ledger-1/capabilities", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ allowedCapabilities: ["storage", "openExternal"] }),
  }).then((res) => res.json());
  assert.deepEqual(noCommunicationCustomAppCapabilities.manifest.allowedCapabilities, ["storage", "openExternal"]);
  assert.equal(noCommunicationCustomAppCapabilities.manifest.riskLevel, "medium");

  const deniedCustomAppCapabilityRequest = await request(port, "/api/v1/custom-apps/custom-ledger-1/capability-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      requestedCapabilities: ["communication"],
      label: "Runtime wants phone access",
      reason: "Needs to call a vendor with github_pat_runtimeCapabilitySecret_1234567890",
    }),
  }).then((res) => res.json());
  assert.equal(deniedCustomAppCapabilityRequest.request.status, "pending");
  assert.deepEqual(deniedCustomAppCapabilityRequest.request.missingCapabilities, ["communication"]);
  assert.equal(JSON.stringify(deniedCustomAppCapabilityRequest).includes("github_pat_runtimeCapabilitySecret"), false);

  const deniedCustomAppCapabilityDecision = await request(port, `/api/v1/custom-apps/custom-ledger-1/capability-requests/${deniedCustomAppCapabilityRequest.request.id}/decision`, {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ decision: "denied", note: "Denied from mobile runtime center" }),
  }).then((res) => res.json());
  assert.equal(deniedCustomAppCapabilityDecision.request.status, "denied");
  assert.equal(deniedCustomAppCapabilityDecision.request.decidedByType, "device");

  const capabilityBlockedCustomAppAction = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      label: "Capability blocked call +15550002222",
      targetUrl: "tel:+15550002222",
      reason: "Generated tool has no communication capability",
    }),
  }).then((res) => res.json());
  assert.equal(capabilityBlockedCustomAppAction.request.status, "blocked");
  assert.equal(capabilityBlockedCustomAppAction.request.targetUrl, "tel:[redacted]");
  assert.equal(JSON.stringify(capabilityBlockedCustomAppAction).includes("+15550002222"), false);

  const approvedCustomAppCapabilityRequest = await request(port, "/api/v1/custom-apps/custom-ledger-1/capability-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      requestedCapabilities: ["communication"],
      label: "Runtime wants communication",
      reason: "User asked this generated tool to prepare a phone call",
    }),
  }).then((res) => res.json());
  assert.equal(approvedCustomAppCapabilityRequest.request.status, "pending");

  const approvedCustomAppCapabilityDecision = await request(port, `/api/v1/custom-apps/custom-ledger-1/capability-requests/${approvedCustomAppCapabilityRequest.request.id}/decision`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ decision: "approved", note: "Allowed at runtime" }),
  }).then((res) => res.json());
  assert.equal(approvedCustomAppCapabilityDecision.request.status, "approved");
  assert.deepEqual(approvedCustomAppCapabilityDecision.request.missingCapabilities, []);

  const capabilitiesAfterRuntimeApproval = await request(port, "/api/v1/custom-apps/custom-ledger-1/capabilities", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(capabilitiesAfterRuntimeApproval.manifest.allowedCapabilities.includes("communication"), true);

  const noStorageCustomAppCapabilities = await request(port, "/api/v1/custom-apps/custom-ledger-1/capabilities", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ allowedCapabilities: ["openExternal"] }),
  }).then((res) => res.json());
  assert.equal(noStorageCustomAppCapabilities.manifest.allowedCapabilities.includes("storage"), false);
  const deniedCustomAppState = await request(port, "/api/v1/custom-apps/custom-ledger-1/state", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ state: { note: "should not save" } }),
  });
  assert.equal(deniedCustomAppState.status, 403);

  const restoredCustomAppCapabilities = await request(port, "/api/v1/custom-apps/custom-ledger-1/capabilities", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ allowedCapabilities: ["storage", "openExternal", "navigation", "communication", "shortcuts"] }),
  }).then((res) => res.json());
  assert.equal(restoredCustomAppCapabilities.manifest.allowedCapabilities.includes("communication"), true);

  const defaultCustomAppActionPolicy = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-policy", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(defaultCustomAppActionPolicy.policy.template, "global");
  assert.equal(defaultCustomAppActionPolicy.policy.allowedSchemes.includes("tel"), true);

  const webOnlyCustomAppActionPolicy = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-policy", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ template: "web" }),
  }).then((res) => res.json());
  assert.equal(webOnlyCustomAppActionPolicy.policy.template, "web");
  assert.deepEqual(webOnlyCustomAppActionPolicy.policy.allowedSchemes, ["http", "https"]);

  const policyBlockedCustomAppAction = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      label: "Policy blocked call +15550001111",
      targetUrl: "tel:+15550001111",
      reason: "Web-only generated tool must not open calls",
    }),
  }).then((res) => res.json());
  assert.equal(policyBlockedCustomAppAction.request.status, "blocked");
  assert.equal(policyBlockedCustomAppAction.request.targetUrl, "tel:[redacted]");
  assert.equal(JSON.stringify(policyBlockedCustomAppAction).includes("+15550001111"), false);

  const restoredCustomAppActionPolicy = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-policy", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ template: "global" }),
  }).then((res) => res.json());
  assert.equal(restoredCustomAppActionPolicy.policy.template, "global");
  assert.equal(restoredCustomAppActionPolicy.policy.allowedSchemes.includes("tel"), true);

  const safeCustomAppAction = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      label: "Open private planner",
      targetUrl: "https://example.test/planner?token=custom-action-secret",
      reason: "Need to open a planning page with a temporary token",
    }),
  }).then((res) => res.json());
  assert.equal(safeCustomAppAction.request.status, "pending");
  assert.equal(safeCustomAppAction.request.risk, "low");
  assert.equal(safeCustomAppAction.request.targetScheme, "https");
  assert.equal(safeCustomAppAction.request.targetUrl, "https://example.test/planner?[redacted]");
  assert.equal(JSON.stringify(safeCustomAppAction).includes("custom-action-secret"), false);

  const approvedCustomAppAction = await request(port, `/api/v1/custom-apps/custom-ledger-1/action-requests/${safeCustomAppAction.request.id}/decision`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ decision: "approved", note: "User confirmed in host frame" }),
  }).then((res) => res.json());
  assert.equal(approvedCustomAppAction.request.status, "approved");
  assert.equal(approvedCustomAppAction.request.decisionNote, "User confirmed in host frame");

  const phoneCustomAppAction = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      label: "Call budget owner +15551234567",
      targetUrl: "tel:+15551234567",
      reason: "Escalate an overdue budget item",
    }),
  }).then((res) => res.json());
  assert.equal(phoneCustomAppAction.request.status, "pending");
  assert.equal(phoneCustomAppAction.request.risk, "high");
  assert.equal(phoneCustomAppAction.request.targetUrl, "tel:[redacted]");
  assert.equal(JSON.stringify(phoneCustomAppAction).includes("+15551234567"), false);

  const cancelledCustomAppAction = await request(port, `/api/v1/custom-apps/custom-ledger-1/action-requests/${phoneCustomAppAction.request.id}/decision`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ decision: "cancelled" }),
  }).then((res) => res.json());
  assert.equal(cancelledCustomAppAction.request.status, "cancelled");

  const blockedCustomAppAction = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      label: "Open unapproved app",
      targetUrl: "weixin://dl/business/?ticket=custom-action-secret",
      reason: "Try a scheme that is not whitelisted",
    }),
  }).then((res) => res.json());
  assert.equal(blockedCustomAppAction.request.status, "blocked");
  assert.equal(blockedCustomAppAction.request.risk, "high");
  assert.equal(blockedCustomAppAction.request.targetUrl, "weixin://[redacted]?[redacted]");
  assert.equal(JSON.stringify(blockedCustomAppAction).includes("custom-action-secret"), false);

  const mobilePendingCustomAppAction = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      label: "Email budget report",
      targetUrl: "mailto:owner@example.test?subject=mobile-action-secret",
      reason: "Created for mobile permission center cancellation",
    }),
  }).then((res) => res.json());
  assert.equal(mobilePendingCustomAppAction.request.status, "pending");
  assert.equal(mobilePendingCustomAppAction.request.targetUrl, "mailto:[redacted]?[redacted]");
  assert.equal(JSON.stringify(mobilePendingCustomAppAction).includes("mobile-action-secret"), false);

  const mobileCustomAppActionHistory = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests?limit=8", { headers: deviceHeaders }).then((res) => res.json());
  assert.equal(mobileCustomAppActionHistory.requests.some((request) => request.id === mobilePendingCustomAppAction.request.id), true);
  assert.equal(JSON.stringify(mobileCustomAppActionHistory).includes("mobile-action-secret"), false);

  const mobileCancelledCustomAppAction = await request(port, `/api/v1/custom-apps/custom-ledger-1/action-requests/${mobilePendingCustomAppAction.request.id}/decision`, {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({ decision: "cancelled", note: "Cancelled from mobile action permission center" }),
  }).then((res) => res.json());
  assert.equal(mobileCancelledCustomAppAction.request.status, "cancelled");
  assert.equal(mobileCancelledCustomAppAction.request.decidedByType, "device");
  assert.equal(mobileCancelledCustomAppAction.request.decisionNote, "Cancelled from mobile action permission center");
  assert.equal(JSON.stringify(mobileCancelledCustomAppAction).includes("mobile-action-secret"), false);

  const customAppActionHistory = await request(port, "/api/v1/custom-apps/custom-ledger-1/action-requests?limit=5", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(customAppActionHistory.requests.length >= 4, true);

  const attachedProblemBlueprint = await request(port, `/api/v1/problem-blueprints/${createdProblemBlueprint.blueprint.id}/generated-app`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ appId: "custom-ledger-1", appName: "本月预算提醒面板" }),
  }).then((res) => res.json());
  assert.equal(attachedProblemBlueprint.blueprint.status, "generated");
  assert.equal(attachedProblemBlueprint.blueprint.generatedAppId, "custom-ledger-1");
  assert.equal(attachedProblemBlueprint.blueprint.generatedAppName, "本月预算提醒面板");

  const rawBlueprintDb = new DatabaseSync(path.join(dataDir, "lifeos.db"));
  const rawBlueprint = rawBlueprintDb.prepare("SELECT problem, app_prompt as appPrompt FROM problem_blueprints WHERE id = ?").get(createdProblemBlueprint.blueprint.id);
  const rawCustomApp = rawBlueprintDb.prepare("SELECT description, code FROM custom_apps WHERE id = ?").get("custom-ledger-1");
  const rawCustomAppVersion = rawBlueprintDb.prepare("SELECT code FROM custom_app_versions WHERE app_id = ? AND version = 1").get("custom-ledger-1");
  const rawCustomAppState = rawBlueprintDb.prepare("SELECT state_json as stateJson FROM custom_app_state WHERE app_id = ?").get("custom-ledger-1");
  const rawCustomAppActions = rawBlueprintDb.prepare("SELECT target_url as targetUrl, reason FROM custom_app_action_requests WHERE app_id = ?").all("custom-ledger-1");
  rawBlueprintDb.close();
  assert.equal(rawBlueprint.problem.includes("github_pat_problemSecret"), false);
  assert.equal(rawBlueprint.problem.includes("/Users/example/private-ledger.csv"), false);
  assert.equal(rawBlueprint.appPrompt.includes("github_pat_problemSecret"), false);
  assert.equal(rawCustomApp.code.includes("github_pat_customAppSecret"), false);
  assert.equal(rawCustomApp.code.includes("/Users/example/private-app.html"), false);
  assert.equal(rawCustomApp.description.includes("/Users/example/private-ledger.csv"), false);
  assert.equal(rawCustomAppVersion.code.includes("github_pat_customAppSecret"), false);
  assert.equal(rawCustomAppState.stateJson.includes("github_pat_customStateSecret"), false);
  assert.equal(rawCustomAppState.stateJson.includes("/Users/example/private-state.csv"), false);
  assert.equal(JSON.stringify(rawCustomAppActions).includes("custom-action-secret"), false);
  assert.equal(JSON.stringify(rawCustomAppActions).includes("+15550001111"), false);
  assert.equal(JSON.stringify(rawCustomAppActions).includes("+15550002222"), false);
  assert.equal(JSON.stringify(rawCustomAppActions).includes("+15551234567"), false);
  assert.equal(JSON.stringify(rawCustomAppActions).includes("mobile-action-secret"), false);

  const customAppHistory = await request(port, "/api/v1/custom-apps?limit=5", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(customAppHistory.apps.some((app) => app.id === "custom-ledger-1"), true);
  const updatedCustomApp = await request(port, "/api/v1/custom-apps/custom-ledger-1", {
    method: "PATCH",
    headers: adminHeaders,
    body: JSON.stringify({ name: "预算提醒面板 Pro", code: "<div>safe updated code</div>" }),
  }).then((res) => res.json());
  assert.equal(updatedCustomApp.app.name, "预算提醒面板 Pro");
  assert.equal(updatedCustomApp.app.code, "<div>safe updated code</div>");
  const customAppVersionsAfterUpdate = await request(port, "/api/v1/custom-apps/custom-ledger-1/versions", {
    headers: adminHeaders,
  }).then((res) => res.json());
  const updatedCustomAppVersion = customAppVersionsAfterUpdate.versions[0].version;
  const previousCustomAppVersion = customAppVersionsAfterUpdate.versions.find((version) => version.version < updatedCustomAppVersion)?.version;
  assert.equal(updatedCustomAppVersion > customAppAutoRepairComplete.result.toVersion, true);
  assert.ok(previousCustomAppVersion);
  assert.equal(customAppVersionsAfterUpdate.versions[0].code, "<div>safe updated code</div>");
  const customAppVersionComparison = await request(port, `/api/v1/custom-apps/custom-ledger-1/version-compare?from=${previousCustomAppVersion}&to=${updatedCustomAppVersion}`, {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(customAppVersionComparison.comparison.appId, "custom-ledger-1");
  assert.equal(customAppVersionComparison.comparison.fromVersion, previousCustomAppVersion);
  assert.equal(customAppVersionComparison.comparison.toVersion, updatedCustomAppVersion);
  assert.equal(customAppVersionComparison.comparison.totalChangedLines >= 1, true);
  assert.equal(customAppVersionComparison.comparison.risk, "low");
  assert.equal(customAppVersionComparison.comparison.riskNotes.some((note) => note.includes("No high-risk")), true);
  assert.equal(customAppVersionComparison.comparison.reviewChecklist.length >= 3, true);
  assert.equal(customAppVersionComparison.comparison.repairHints.some((hint) => hint.includes(`roll back to v${previousCustomAppVersion}`)), true);
  assert.equal(JSON.stringify(customAppVersionComparison).includes("github_pat_customAppSecret"), false);
  assert.equal(JSON.stringify(customAppVersionComparison).includes("/Users/example/private-app.html"), false);
  const defaultCustomAppVersionComparison = await request(port, "/api/v1/custom-apps/custom-ledger-1/version-compare", {
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(defaultCustomAppVersionComparison.comparison.fromVersion, previousCustomAppVersion);
  assert.equal(defaultCustomAppVersionComparison.comparison.toVersion, updatedCustomAppVersion);
  const rollbackCustomApp = await request(port, "/api/v1/custom-apps/custom-ledger-1/versions/1/rollback", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(rollbackCustomApp.app.code, customAppVersionsAfterCreate.versions[0].code);
  assert.equal(rollbackCustomApp.version.version > updatedCustomAppVersion, true);
  const deletedCustomApp = await request(port, "/api/v1/custom-apps/custom-ledger-1", {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(deletedCustomApp.status, 200);
  const deletedCustomAppRead = await request(port, "/api/v1/custom-apps/custom-ledger-1", { headers: adminHeaders });
  assert.equal(deletedCustomAppRead.status, 404);

  const unauthState = await request(port, "/api/v1/state/lifeos_system_actions");
  assert.equal(unauthState.status, 401);

  const storedState = await request(port, "/api/v1/state/lifeos_system_actions", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ value: [{ id: "a1", name: "Shortcut", url: "shortcuts://run-shortcut?name=LifeOS" }] }),
  }).then((res) => res.json());
  assert.equal(storedState.value[0].name, "Shortcut");

  const loadedState = await request(port, "/api/v1/state/lifeos_system_actions", { headers: deviceHeaders }).then((res) => res.json());
  assert.equal(loadedState.value[0].url, "shortcuts://run-shortcut?name=LifeOS");

  const normalizedAllowedSchemes = await request(port, "/api/v1/state/lifeos_allowed_url_schemes", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ value: [" HTTPS ", "shortcuts", "https", "Weixin"] }),
  }).then((res) => res.json());
  assert.deepEqual(normalizedAllowedSchemes.value, ["https", "shortcuts", "weixin"]);

  const unsafeSystemAction = await request(port, "/api/v1/state/lifeos_system_actions", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ value: [{ id: "a2", name: "Unsafe", url: "javascript:alert(1)" }] }),
  });
  assert.equal(unsafeSystemAction.status, 400);

  const unsafeAllowedSchemes = await request(port, "/api/v1/state/lifeos_allowed_url_schemes", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ value: ["https", "shortcuts", "file"] }),
  });
  assert.equal(unsafeAllowedSchemes.status, 400);

  const blockedInvalidActionLog = await request(port, "/api/v1/state/lifeos_system_action_logs", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({
      value: [{
        id: "log-invalid-url",
        label: "Blocked invalid URL",
        url: "[invalid-url]",
        scheme: "unknown",
        source: "test",
        target: "test",
        paramsSummary: "-",
        status: "blocked",
        risk: "high",
        createdAt: Date.now(),
      }],
    }),
  }).then((res) => res.json());
  assert.equal(blockedInvalidActionLog.value[0].url, "[invalid-url]");

  const redactedActionLog = await request(port, "/api/v1/state/lifeos_system_action_logs", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({
      value: [{
        id: "log-redacted-url",
        label: "Redacted URL",
        url: "shortcuts://run-shortcut?token=state-secret-token",
        scheme: "shortcuts",
        source: "test",
        target: "test",
        paramsSummary: "apiKey=sk-state-secret-value-should-not-leak Basic Z2l0aHViOnN0YXRl github_pat_stateSecret_1234567890",
        status: "opened",
        risk: "medium",
        createdAt: Date.now(),
      }],
    }),
  }).then((res) => res.json());
  assert.equal(JSON.stringify(redactedActionLog).includes("state-secret-token"), false);
  assert.equal(JSON.stringify(redactedActionLog).includes("sk-state-secret-value-should-not-leak"), false);
  assert.equal(JSON.stringify(redactedActionLog).includes("Z2l0aHViOnN0YXRl"), false);
  assert.equal(JSON.stringify(redactedActionLog).includes("github_pat_stateSecret"), false);
  assert.equal(redactedActionLog.value[0].url, "shortcuts://run-shortcut?token=%5Bredacted%5D");

  const storedSensitiveState = await request(port, "/api/v1/state/lifeos_byok_key", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ value: "AIzaSy-state-secret-value-should-not-leak" }),
  }).then((res) => res.json());
  assert.equal(storedSensitiveState.value, "[redacted]");

  const rawStateDb = new DatabaseSync(path.join(dataDir, "lifeos.db"));
  const rawAllowedSchemes = rawStateDb.prepare("SELECT value_json as valueJson FROM client_state WHERE key = 'lifeos_allowed_url_schemes'").get();
  assert.deepEqual(JSON.parse(rawAllowedSchemes.valueJson), ["https", "shortcuts", "weixin"]);
  const rawByokState = rawStateDb.prepare("SELECT value_json as valueJson FROM client_state WHERE key = 'lifeos_byok_key'").get();
  rawStateDb.close();
  assert.equal(rawByokState.valueJson.includes("AIzaSy-state-secret-value-should-not-leak"), true);

  const loadedSensitiveState = await request(port, "/api/v1/state/lifeos_byok_key", { headers: deviceHeaders }).then((res) => res.json());
  assert.equal(loadedSensitiveState.value, "[redacted]");

  const unsafeActionLog = await request(port, "/api/v1/state/lifeos_system_action_logs", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({
      value: [{
        id: "log-1",
        label: "Unsafe log",
        url: "data:text/html,secret",
        scheme: "data",
        source: "test",
        target: "test",
        paramsSummary: "-",
        status: "opened",
        risk: "high",
        createdAt: Date.now(),
      }],
    }),
  });
  assert.equal(unsafeActionLog.status, 400);

  const invalidStateKey = await request(port, "/api/v1/state/not_allowed", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ value: true }),
  });
  assert.equal(invalidStateKey.status, 400);

  const oversizedState = await request(port, "/api/v1/state/lifeos_notes", {
    method: "PUT",
    headers: deviceHeaders,
    body: JSON.stringify({ value: "x".repeat(300 * 1024) }),
  });
  assert.equal(oversizedState.status, 413);

  const syncedKeys = {
    lifeos_tasks_pro: [{ id: 1, text: "SQLite task", completed: false, priority: "high", createdAt: Date.now() }],
    lifeos_notes: [{ id: 1, title: "SQLite note", content: "Persisted note" }],
    lifeos_calendar_events: [{ id: "e1", date: "2026-06-09", title: "SQLite event", time: "09:00 AM" }],
    lifeos_timer_stats: { sessions: 1, minutes: 25, streak: 2 },
    lifeos_calculator_history: ["1 + 1 = 2"],
    lifeos_navigation_favs: [{ id: "r1", start: "当前位置", end: "虹桥机场", mode: "drive" }],
    lifeos_apps: [{ id: "app1", name: "Ledger", description: "Personal ledger", visibility: "private", status: "active", createdAt: Date.now(), code: "<div></div>" }],
    lifeos_memories: [{ id: "mem1", title: "Preference", time: "now", content: "Quiet UI", type: "ui" }],
    lifeos_model_engine: "Gemini 2.0 Flash",
    lifeos_tts_voice: "Onyx",
    lifeos_byok_provider: "Google Gemini",
    lifeos_byok_key: "test-key",
    lifeos_proxy_enabled: true,
    lifeos_proxy_url: "https://example.com/sub",
    lifeos_route_mode: "rule",
    lifeos_selected_node_id: "cn-hk",
    lifeos_proxy_nodes: [{ id: "cn-hk", name: "Hong Kong", type: "BGP", delay: 20, status: "active", speed: "100 Mbps" }],
  };

  for (const [key, value] of Object.entries(syncedKeys)) {
    const saved = await request(port, `/api/v1/state/${key}`, {
      method: "PUT",
      headers: deviceHeaders,
      body: JSON.stringify({ value }),
    }).then((res) => res.json());
    assert.deepEqual(saved.value, key === "lifeos_byok_key" ? "[redacted]" : value);
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("websocket auth timed out"));
    }, 3000);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "auth",
        deviceId: credential.device.id,
        accessToken: deviceHeaders["X-LifeOS-Device-Token"],
      }));
    });
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "auth.ok") {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on("error", reject);
  });

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("device token rotation request was not delivered in time"));
    }, 3000);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "auth",
        deviceId: credential.device.id,
        accessToken: deviceHeaders["X-LifeOS-Device-Token"],
      }));
    });
    ws.on("message", async (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "auth.ok") {
        const rotationRequest = await request(port, `/api/v1/devices/${credential.device.id}/token/rotation-request`, {
          method: "POST",
          headers: adminHeaders,
        }).then((res) => res.json());
        assert.equal(rotationRequest.ok, true);
        assert.equal(rotationRequest.delivered, true);
      }
      if (event.type === "device.token.rotate_requested") {
        assert.equal(event.deviceId, credential.device.id);
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on("error", reject);
  });

  const tokenBeforeAdminRequestedRotation = deviceHeaders["X-LifeOS-Device-Token"];
  const adminRequestedRotation = await request(port, "/api/v1/devices/token/rotate", {
    method: "POST",
    headers: deviceHeaders,
  }).then((res) => res.json());
  assert.match(adminRequestedRotation.accessToken, /^device_/);
  assert.notEqual(adminRequestedRotation.accessToken, tokenBeforeAdminRequestedRotation);

  const tokenBeforeAdminRequestedRotationAccess = await request(port, "/api/v1/state/lifeos_tasks_pro", {
    headers: {
      ...deviceHeaders,
      "X-LifeOS-Device-Token": tokenBeforeAdminRequestedRotation,
    },
  });
  assert.equal(tokenBeforeAdminRequestedRotationAccess.status, 401);
  deviceHeaders["X-LifeOS-Device-Token"] = adminRequestedRotation.accessToken;

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/v1/ws?deviceId=${encodeURIComponent(credential.device.id)}&accessToken=${encodeURIComponent(credential.accessToken)}`,
    );
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("query-token websocket was not rejected in time"));
    }, 6500);
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "auth.ok") {
        clearTimeout(timer);
        ws.close();
        reject(new Error("query-token websocket unexpectedly authenticated"));
      }
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on("error", reject);
  });

  const revoke = await request(port, `/api/v1/devices/${credential.device.id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  assert.equal(revoke.status, 200);

  const revokedStateAccess = await request(port, "/api/v1/state/lifeos_tasks_pro", { headers: deviceHeaders });
  assert.equal(revokedStateAccess.status, 401);

  const finalAudit = await request(port, "/api/v1/audit-logs", { headers: adminHeaders }).then((res) => res.json());
  const findAudit = (action) => finalAudit.logs.find((log) => log.action === action && log.targetId === credential.device.id);
  const boundAudit = findAudit("device_bound");
  assert.equal(boundAudit.metadata.name, "Test Phone");
  assert.equal(boundAudit.metadata.type, "mobile");
  assert.equal(boundAudit.metadata.authMethod, "token");
  assert.equal(typeof boundAudit.metadata.credentialExpiresAt, "number");
  const rotationRequestAudit = findAudit("device_token_rotation_requested");
  assert.equal(rotationRequestAudit.actorType, "admin");
  assert.equal(rotationRequestAudit.metadata.deviceName, "Test Phone");
  assert.equal(rotationRequestAudit.metadata.delivered, true);
  const tokenRotatedAudit = findAudit("device_token_rotated");
  assert.equal(tokenRotatedAudit.actorType, "device");
  assert.equal(tokenRotatedAudit.metadata.deviceName, "Test Phone");
  assert.equal(tokenRotatedAudit.metadata.authMethod, "token");
  assert.equal(typeof tokenRotatedAudit.metadata.previousCredentialExpiresAt, "number");
  assert.equal(typeof tokenRotatedAudit.metadata.credentialExpiresAt, "number");
  assert.equal(typeof tokenRotatedAudit.metadata.rotatedAt, "number");
  const selfRevokedAudit = finalAudit.logs.find((log) => log.action === "device_self_revoked" && log.targetId === selfRevokeCredential.device.id);
  assert.equal(selfRevokedAudit.actorType, "device");
  assert.equal(selfRevokedAudit.actorId, selfRevokeCredential.device.id);
  assert.equal(selfRevokedAudit.metadata.deviceName, "Self Revoke Phone");
  assert.equal(selfRevokedAudit.metadata.revokeReason, "self");
  assert.equal(selfRevokedAudit.metadata.previousStatus, "offline");
  assert.equal(selfRevokedAudit.metadata.authMethod, "token");
  assert.equal(typeof selfRevokedAudit.metadata.realtimeConnectionClosed, "boolean");
  assert.equal(typeof selfRevokedAudit.metadata.revokedAt, "number");
  const revokedAudit = findAudit("device_revoked");
  assert.equal(revokedAudit.actorType, "admin");
  assert.equal(revokedAudit.metadata.deviceName, "Test Phone");
  assert.equal(revokedAudit.metadata.revokeReason, "admin");
  assert.equal(revokedAudit.metadata.previousStatus, "offline");
  assert.equal(revokedAudit.metadata.authMethod, "token");
  assert.equal(revokedAudit.metadata.publicKeyConfigured, false);
  assert.equal(typeof revokedAudit.metadata.credentialExpiresAt, "number");
  assert.equal(typeof revokedAudit.metadata.lastSeenAt, "number");
  assert.equal(revokedAudit.metadata.latestConnectivity.ok, true);
  assert.equal(revokedAudit.metadata.latestConnectivity.currentBaseUrl, "https://phone.example.test/lifeos");
  assert.equal(revokedAudit.metadata.latestConnectivity.healthOk, true);
  assert.equal(revokedAudit.metadata.latestConnectivity.mobileShellOk, true);
  assert.equal(revokedAudit.metadata.latestConnectivity.websocketOk, true);
  assert.equal(revokedAudit.metadata.latestConnectivity.latencyMs, 42);
  assert.equal(typeof revokedAudit.metadata.latestConnectivity.createdAt, "number");
  assert.equal(typeof revokedAudit.metadata.wasOnline, "boolean");
  assert.equal(typeof revokedAudit.metadata.realtimeConnectionClosed, "boolean");
  assert.equal(typeof revokedAudit.metadata.revokedAt, "number");
  const onboardingCompletedAudit = finalAudit.logs.find((log) => log.action === "admin_onboarding_completed");
  assert.equal(onboardingCompletedAudit.actorType, "admin");
  assert.equal(onboardingCompletedAudit.targetType, "admin");
  assert.equal(onboardingCompletedAudit.metadata.securityOverall, "ok");
  assert.equal(onboardingCompletedAudit.metadata.steps.every((step) => step.done), true);
  const customAppActionRequestedAudit = finalAudit.logs.find((log) => log.action === "custom_app_action_requested" && log.metadata.requestId === safeCustomAppAction.request.id);
  assert.equal(customAppActionRequestedAudit.targetId, "custom-ledger-1");
  assert.equal(customAppActionRequestedAudit.metadata.targetUrl, "https://example.test/planner?[redacted]");
  assert.equal(customAppActionRequestedAudit.metadata.risk, "low");
  const customAppActionApprovedAudit = finalAudit.logs.find((log) => log.action === "custom_app_action_approved" && log.metadata.requestId === safeCustomAppAction.request.id);
  assert.equal(customAppActionApprovedAudit.metadata.status, "approved");
  const customAppActionCancelledAudit = finalAudit.logs.find((log) => log.action === "custom_app_action_cancelled" && log.metadata.requestId === phoneCustomAppAction.request.id);
  assert.equal(customAppActionCancelledAudit.metadata.targetUrl, "tel:[redacted]");
  assert.equal(customAppActionCancelledAudit.metadata.risk, "high");
  const customAppActionBlockedAudit = finalAudit.logs.find((log) => log.action === "custom_app_action_blocked" && log.metadata.requestId === blockedCustomAppAction.request.id);
  assert.equal(customAppActionBlockedAudit.metadata.targetScheme, "weixin");
  assert.equal(customAppActionBlockedAudit.metadata.status, "blocked");
  const customAppActionPolicyAudit = finalAudit.logs.find((log) => log.action === "custom_app_action_policy_updated" && log.targetId === "custom-ledger-1");
  assert.equal(customAppActionPolicyAudit.metadata.allowedSchemes.includes("https"), true);
  const customAppCapabilitiesAudit = finalAudit.logs.find((log) => log.action === "custom_app_capabilities_updated" && log.targetId === "custom-ledger-1");
  assert.equal(customAppCapabilitiesAudit.metadata.allowedCapabilities.includes("openExternal"), true);
  assert.equal(["medium", "high"].includes(customAppCapabilitiesAudit.metadata.riskLevel), true);
  const deniedCustomAppCapabilityAudit = finalAudit.logs.find((log) => log.action === "custom_app_capability_denied" && log.metadata.requestId === deniedCustomAppCapabilityRequest.request.id);
  assert.equal(deniedCustomAppCapabilityAudit.actorType, "device");
  assert.equal(deniedCustomAppCapabilityAudit.metadata.status, "denied");
  const approvedCustomAppCapabilityAudit = finalAudit.logs.find((log) => log.action === "custom_app_capability_approved" && log.metadata.requestId === approvedCustomAppCapabilityRequest.request.id);
  assert.equal(approvedCustomAppCapabilityAudit.metadata.status, "approved");
  const runtimeEventAudit = finalAudit.logs.find((log) => log.action === "custom_app_runtime_event_recorded" && log.metadata.eventId === customAppRuntimeEvent.event.id);
  assert.equal(runtimeEventAudit.metadata.severity, "error");
  const debugRequestAudit = finalAudit.logs.find((log) =>
    log.action === "custom_app_debug_requested" &&
    log.targetId === "custom-ledger-1" &&
    log.metadata.repairRisk === "medium" &&
    log.metadata.suspectedArea === "runtime-error"
  );
  assert.equal(debugRequestAudit.metadata.recentEventCount >= 1, true);
  assert.equal(debugRequestAudit.metadata.repairRisk, "medium");
  assert.equal(debugRequestAudit.metadata.suspectedArea, "runtime-error");
  assert.equal(debugRequestAudit.metadata.repairStepCount >= 3, true);
  const autoRepairAudit = finalAudit.logs.find((log) =>
    log.action === "custom_app_auto_repair_planned" &&
    log.targetId === "custom-ledger-1" &&
    log.metadata.status === "ready"
  );
  assert.equal(autoRepairAudit.metadata.canAutoApply, true);
  assert.equal(autoRepairAudit.metadata.reasonKey, "low-risk-runtime");
  assert.equal(autoRepairAudit.metadata.repairAttempt, 1);
  const completedAutoRepairAudit = finalAudit.logs.find((log) =>
    log.action === "custom_app_auto_repair_completed" &&
    log.targetId === "custom-ledger-1" &&
    log.metadata.taskId === customAppAutoRepairPlan.autoRepairTask.id
  );
  assert.equal(completedAutoRepairAudit.metadata.status, "applied");
  assert.equal(completedAutoRepairAudit.metadata.rollbackAvailable, true);
  assert.equal(completedAutoRepairAudit.metadata.verificationStatus, "pending-smoke");
  assert.equal(completedAutoRepairAudit.metadata.comparisonRisk, "low");
  assert.equal(completedAutoRepairAudit.metadata.staticSmokeStatus, "passed");
  assert.equal(completedAutoRepairAudit.metadata.staticSmokeMethod, "static-auto");
  assert.equal(completedAutoRepairAudit.metadata.staticSmokeFailures, 0);
  const smokeReviewAudit = finalAudit.logs.find((log) =>
    log.action === "custom_app_auto_repair_smoke_reviewed" &&
    log.targetId === "custom-ledger-1" &&
    log.metadata.resultId === customAppAutoRepairComplete.result.id
  );
  assert.equal(smokeReviewAudit.metadata.status, "passed");
  assert.equal(smokeReviewAudit.metadata.method, "static-auto");
  assert.equal(smokeReviewAudit.metadata.rollbackRecommended, false);
  const autoRollbackAudit = finalAudit.logs.find((log) =>
    log.action === "custom_app_auto_repair_auto_rollback" &&
    log.targetId === "custom-ledger-1" &&
    log.metadata.resultId === failedStaticSmokeAutoRepair.result.id
  );
  assert.equal(autoRollbackAudit.metadata.status, "rolled-back");
  assert.equal(autoRollbackAudit.metadata.attempted, true);
  assert.equal(autoRollbackAudit.metadata.rollbackVersion, rollbackAutoRepairPlan.autoRepairTask.rollbackVersion);
  const blockedAutoRepairAudit = finalAudit.logs.find((log) =>
    log.action === "custom_app_auto_repair_planned" &&
    log.targetId === "custom-ledger-1" &&
    log.metadata.status === "blocked" &&
    log.metadata.reasonKey === "retry-limit"
  );
  assert.equal(blockedAutoRepairAudit.metadata.canAutoApply, false);
  assert.equal(blockedAutoRepairAudit.metadata.repairAttempt, 3);
  const mobileCustomAppActionCancelledAudit = finalAudit.logs.find((log) => log.action === "custom_app_action_cancelled" && log.metadata.requestId === mobilePendingCustomAppAction.request.id);
  assert.equal(mobileCustomAppActionCancelledAudit.actorType, "device");
  assert.equal(mobileCustomAppActionCancelledAudit.metadata.targetUrl, "mailto:[redacted]?[redacted]");
  const finalAuditJson = JSON.stringify(finalAudit);
  assert.equal(finalAuditJson.includes(binding.token), false);
  assert.equal(finalAuditJson.includes(credential.accessToken), false);
  assert.equal(finalAuditJson.includes(rotated.accessToken), false);
  assert.equal(finalAuditJson.includes(adminRequestedRotation.accessToken), false);
  assert.equal(finalAuditJson.includes("custom-action-secret"), false);
  assert.equal(finalAuditJson.includes("github_pat_runtimeCapabilitySecret"), false);
  assert.equal(finalAuditJson.includes("github_pat_runtimeEventSecret"), false);
  assert.equal(finalAuditJson.includes("github_pat_runtimeEventDetailSecret"), false);
  assert.equal(finalAuditJson.includes("github_pat_debugRequestSecret"), false);
  assert.equal(finalAuditJson.includes("+15550001111"), false);
  assert.equal(finalAuditJson.includes("+15550002222"), false);
  assert.equal(finalAuditJson.includes("+15551234567"), false);
  assert.equal(finalAuditJson.includes("mobile-action-secret"), false);

  const publicResponses = [
    { label: "health", value: health },
    { label: "admin status", value: statusAfter },
    { label: "config diagnostics", value: diagnostics },
    { label: "weak password change", value: weakPasswordChange },
    { label: "strong password change", value: strongPasswordChange },
    { label: "network diagnostics", value: networkDiagnostics },
    { label: "network diagnostics after desktop config", value: networkDiagnosticsAfterDesktopConfig },
    { label: "connection test", value: connectionTest },
    { label: "desktop connection config", value: desktopConnectionConfig },
    { label: "saved Gemini key", value: savedAiKey },
    { label: "deleted Gemini key", value: deletedAiKey },
    { label: "AI providers", value: aiProviders },
    { label: "initial onboarding", value: initialOnboarding },
    { label: "updated OpenAI model", value: updatedOpenAiModel },
    { label: "updated local model", value: updatedLocalModel },
    { label: "saved OpenAI key", value: savedOpenAi },
    { label: "tested OpenAI key", value: testedOpenAi },
    { label: "deleted OpenAI key", value: deletedOpenAi },
    { label: "created problem blueprint", value: createdProblemBlueprint },
    { label: "problem blueprint history", value: problemBlueprintHistory },
    { label: "attached problem blueprint", value: attachedProblemBlueprint },
    { label: "created custom app", value: createdCustomApp },
    { label: "custom app versions after create", value: customAppVersionsAfterCreate },
    { label: "initial custom app state", value: initialCustomAppState },
    { label: "saved custom app state", value: savedCustomAppState },
    { label: "custom app runtime event", value: customAppRuntimeEvent },
    { label: "custom app debug request", value: customAppDebugRequest },
    { label: "custom app auto repair plan", value: customAppAutoRepairPlan },
    { label: "high risk custom app auto repair plan", value: highRiskCustomAppAutoRepairPlan },
    { label: "retry limited custom app auto repair plan", value: retryLimitedAutoRepairPlan },
    { label: "custom app runtime events", value: customAppRuntimeEvents },
    { label: "default custom app capabilities", value: defaultCustomAppCapabilities },
    { label: "no communication custom app capabilities", value: noCommunicationCustomAppCapabilities },
    { label: "denied custom app capability request", value: deniedCustomAppCapabilityRequest },
    { label: "denied custom app capability decision", value: deniedCustomAppCapabilityDecision },
    { label: "capability blocked custom app action", value: capabilityBlockedCustomAppAction },
    { label: "approved custom app capability request", value: approvedCustomAppCapabilityRequest },
    { label: "approved custom app capability decision", value: approvedCustomAppCapabilityDecision },
    { label: "capabilities after runtime approval", value: capabilitiesAfterRuntimeApproval },
    { label: "no storage custom app capabilities", value: noStorageCustomAppCapabilities },
    { label: "restored custom app capabilities", value: restoredCustomAppCapabilities },
    { label: "default custom app action policy", value: defaultCustomAppActionPolicy },
    { label: "web-only custom app action policy", value: webOnlyCustomAppActionPolicy },
    { label: "policy blocked custom app action", value: policyBlockedCustomAppAction },
    { label: "restored custom app action policy", value: restoredCustomAppActionPolicy },
    { label: "safe custom app action", value: safeCustomAppAction },
    { label: "approved custom app action", value: approvedCustomAppAction },
    { label: "phone custom app action", value: phoneCustomAppAction },
    { label: "cancelled custom app action", value: cancelledCustomAppAction },
    { label: "blocked custom app action", value: blockedCustomAppAction },
    { label: "mobile pending custom app action", value: mobilePendingCustomAppAction },
    { label: "mobile custom app action history", value: mobileCustomAppActionHistory },
    { label: "mobile cancelled custom app action", value: mobileCancelledCustomAppAction },
    { label: "custom app action history", value: customAppActionHistory },
    { label: "custom app history", value: customAppHistory },
    { label: "updated custom app", value: updatedCustomApp },
    { label: "custom app versions after update", value: customAppVersionsAfterUpdate },
    { label: "rollback custom app", value: rollbackCustomApp },
    { label: "backup", value: backup },
    { label: "backups", value: backups },
    { label: "default backup schedule", value: defaultSchedule },
    { label: "updated backup schedule", value: updatedSchedule },
    { label: "backup preview", value: backupPreview },
    {
      label: "encrypted export",
      value: encryptedExport,
      allowedPaths: new Set(["payload.cipher.iv", "payload.cipher.tag", "payload.ciphertext", "payload.kdf.hash"]),
    },
    { label: "encrypted import", value: encryptedImport },
    { label: "restored backup", value: restoredBackup },
    { label: "data export", value: dataExport },
    { label: "scoped data export", value: scopedDataExport },
    { label: "data cleanup preview", value: cleanupPreviewResponse },
    { label: "data cleanup", value: cleanupResponse },
    { label: "diagnostic bundle", value: diagnosticBundle },
    { label: "audit logs after exports", value: auditAfterExports },
    { label: "pending restore", value: pendingRestore },
    { label: "binding", value: binding, allowedPaths: new Set(["token"]) },
    { label: "signature binding", value: signatureBinding, allowedPaths: new Set(["token"]) },
    { label: "signature credential", value: signatureCredential },
    { label: "missing AI chat", value: missingAiChat.body },
    { label: "missing OpenAI chat", value: missingOpenAiChat.body },
    { label: "missing app generation", value: missingAiAppGeneration.body },
    { label: "saved local provider", value: savedLocalProvider },
    { label: "completed onboarding", value: completedOnboarding },
    { label: "status after onboarding", value: statusAfterOnboarding },
    { label: "rotated token", value: rotated, allowedPaths: new Set(["accessToken"]) },
    { label: "chat session", value: chatSession },
    { label: "chat message", value: chatMessage },
    { label: "loaded messages", value: loadedMessages },
    { label: "created memory", value: createdMemory },
    { label: "updated memory", value: updatedMemory },
    { label: "stored state", value: storedState },
    { label: "loaded state", value: loadedState },
    { label: "redacted action log state", value: redactedActionLog },
    { label: "stored sensitive state", value: storedSensitiveState },
    { label: "loaded sensitive state", value: loadedSensitiveState },
    { label: "admin requested rotation", value: adminRequestedRotation, allowedPaths: new Set(["accessToken"]) },
    { label: "final audit logs", value: finalAudit },
  ];
  for (const sample of publicResponses) {
    assertPublicApiResponse(sample.label, sample.value, { allowedPaths: sample.allowedPaths });
  }
  assertSecretNotLeaked(publicResponses, testAiKey);
  assertSecretNotLeaked(publicResponses, openAiKey);
  assertSecretNotLeaked(publicResponses, encryptedPassphrase);
  assertSecretNotLeaked(publicResponses, dataDir);
  assertSecretNotLeaked(publicResponses, "connection-secret");
  assertSecretNotLeaked(publicResponses, "connectivity-secret");
  assertSecretNotLeaked(publicResponses, "state-secret-token");
  assertSecretNotLeaked(publicResponses, "sk-state-secret-value-should-not-leak");
  assertSecretNotLeaked(publicResponses, "Z2l0aHViOnN0YXRl");
  assertSecretNotLeaked(publicResponses, "github_pat_stateSecret");
  assertSecretNotLeaked(publicResponses, "github_pat_problemSecret");
  assertSecretNotLeaked(publicResponses, "/Users/example/private-ledger.csv");
  assertSecretNotLeaked(publicResponses, "github_pat_customAppSecret");
  assertSecretNotLeaked(publicResponses, "github_pat_runtimeCapabilitySecret");
  assertSecretNotLeaked(publicResponses, "github_pat_runtimeEventSecret");
  assertSecretNotLeaked(publicResponses, "github_pat_runtimeEventDetailSecret");
  assertSecretNotLeaked(publicResponses, "github_pat_debugRequestSecret");
  assertSecretNotLeaked(publicResponses, "/Users/example/private-app.html");
  assertSecretNotLeaked(publicResponses, "/Users/example/runtime.log");
  assertSecretNotLeaked(publicResponses, "/Users/example/detail.log");
  assertSecretNotLeaked(publicResponses, "/Users/example/debug.txt");
  assertSecretNotLeaked(publicResponses, "AIzaSy-state-secret-value-should-not-leak");
  assertSecretNotLeaked(publicResponses, "test-key");
  assertSecretNotLeaked(publicResponses, "correct horse battery staple");
  assertSecretNotLeaked(publicResponses, "password123");
  assertSecretNotLeaked(publicResponses, binding.token, new Set(["binding"]));
  assertSecretNotLeaked(publicResponses, credential.accessToken, new Set(["credential"]));
  assertSecretNotLeaked(publicResponses, rotated.accessToken, new Set(["rotated token"]));
  assertSecretNotLeaked(publicResponses, adminRequestedRotation.accessToken, new Set(["admin requested rotation"]));
});

test("public base path serves API, mobile shell, and realtime websocket", async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-auth-base-path-test-"));
  const child = spawn(process.execPath, ["dist/server.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LIFEOS_PORT: String(port),
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_HOST: "127.0.0.1",
      LIFEOS_ALLOW_PUBLIC: "1",
      PUBLIC_BASE_URL: "https://remote.example.test/lifeos",
      APP_URL: "",
      GEMINI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childOutput = [];
  child.stdout.on("data", (chunk) => childOutput.push(chunk.toString()));
  child.stderr.on("data", (chunk) => childOutput.push(chunk.toString()));

  t.after(async () => {
    child.kill();
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(port, child, childOutput);

  const prefixedHealth = await request(port, "/lifeos/api/v1/health").then((res) => res.json());
  assert.equal(prefixedHealth.ok, true);
  assert.equal(prefixedHealth.publicBaseUrl, "https://remote.example.test/lifeos");

  const mobileShell = await request(port, "/lifeos/mobile/chat");
  assert.equal(mobileShell.status, 200);
  const mobileHtml = await mobileShell.text();
  assert.match(mobileHtml, /<div id="root"><\/div>/);
  assert.match(mobileHtml, /\.\/assets\//);
  const firstAsset = mobileHtml.match(/\.\/assets\/[^"]+\.js/)?.[0]?.replace("./", "/lifeos/");
  assert.ok(firstAsset);
  const prefixedAsset = await request(port, firstAsset);
  assert.equal(prefixedAsset.status, 200);

  const prefixedManifest = await request(port, "/lifeos/manifest.webmanifest?pairingToken=bind_base_path_manifest_123").then((res) => res.json());
  assert.equal(prefixedManifest.id, "/lifeos/mobile/chat");
  assert.equal(prefixedManifest.start_url, "/lifeos/mobile/install/bind_base_path_manifest_123");
  assert.equal(prefixedManifest.scope, "/lifeos/");
  assert.ok(prefixedManifest.icons.every((icon) => icon.src.startsWith("/lifeos/")));
  assert.ok(prefixedManifest.screenshots.every((screenshot) => screenshot.src.startsWith("/lifeos/")));

  const setupResponse = await request(port, "/lifeos/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password: "base-path-password-12345" }),
  });
  assert.equal(setupResponse.status, 200);
  const adminHeaders = cookieHeader(setupResponse);

  const binding = await request(port, "/lifeos/api/v1/devices/bind/start", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(binding.baseUrl, "https://remote.example.test/lifeos");
  assert.match(binding.pairingUrl, /^https:\/\/remote\.example\.test\/lifeos\/mobile\/install\/bind_/);

  const credential = await request(port, "/lifeos/api/v1/devices/bind/confirm", {
    method: "POST",
    body: JSON.stringify({ token: binding.token, deviceName: "Base Path Phone", deviceType: "mobile" }),
  }).then((res) => res.json());

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lifeos/api/v1/ws`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("base-path websocket auth timed out"));
    }, 3000);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "auth",
        deviceId: credential.device.id,
        accessToken: credential.accessToken,
      }));
    });
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "auth.ok") {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.on("error", reject);
  });
});
