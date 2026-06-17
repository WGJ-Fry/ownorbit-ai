import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import test from "node:test";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

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

function assertPublicApiResponse(label, value, options = {}) {
  const leaks = collectUnexpectedSensitiveFields(value, options);
  assert.deepEqual(leaks, [], `${label} returned sensitive fields: ${leaks.join(", ")}`);
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
  assert.equal(JSON.stringify(diagnostics.release).includes(dataDir), false);
  assert.equal(JSON.stringify(diagnostics).includes(dataDir), false);
  assert.equal(diagnostics.securityCheck.overall, "warning");
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "backup" && item.status === "warning"), true);
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "backupSchedule" && item.status === "warning"), true);

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
  const strongPasswordChange = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ currentPassword: "password123", newPassword: "correct horse battery staple" }),
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

  const blockedDesktopConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    body: JSON.stringify({ mode: "cloudflare", label: "Unsafe", baseUrl: "https://unsafe.example.com" }),
  });
  assert.equal(blockedDesktopConnectionConfig.status, 401);
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
  const desktopConnectionConfig = await request(port, "/api/v1/admin/desktop-connection-config", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      mode: "cloudflare",
      label: "Cloudflare Smoke",
      baseUrl: "https://user:password@desktop-config.example.com/mobile?token=desktop-secret#debug",
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
  assert.match(testedOpenAi.message, /is configured/);
  assert.equal(JSON.stringify(testedOpenAi).includes(openAiKey), false);
  const activeOpenAi = await request(port, "/api/v1/admin/ai-providers/openai/active", {
    method: "PUT",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(activeOpenAi.provider.id, "openai");
  assert.equal(activeOpenAi.provider.active, true);
  assert.equal(activeOpenAi.providers.find((provider) => provider.id === "openai").active, true);
  assert.equal(activeOpenAi.providers.find((provider) => provider.id === "gemini").active, false);
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

  const encryptedPassphrase = "correct horse backup";
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
  assert.deepEqual(dataExport.scopes, ["chat", "memories", "devices", "auditLogs"]);
  assert.ok(Array.isArray(dataExport.chat.sessions));
  assert.ok(Array.isArray(dataExport.memories));
  assert.ok(Array.isArray(dataExport.devices));
  assert.ok(Array.isArray(dataExport.auditLogs));
  const exportedConnectionAudit = dataExport.auditLogs.find((log) => log.action === "network_connection_tested");
  assert.ok(exportedConnectionAudit);
  assert.equal(exportedConnectionAudit.targetId, `http://127.0.0.1:${port}/?[redacted]`);
  assert.equal(typeof exportedConnectionAudit.metadata.status, "number");
  assert.equal(JSON.stringify(dataExport).includes(testAiKey), false);
  assert.equal(JSON.stringify(dataExport).includes("connection-secret"), false);
  assert.equal(JSON.stringify(dataExport).includes(dataDir), false);

  const scopedDataExport = await request(port, "/api/v1/data/export?scope=chat,devices", { headers: adminHeaders }).then((res) => res.json());
  assert.deepEqual(scopedDataExport.scopes, ["chat", "devices"]);
  assert.ok(Array.isArray(scopedDataExport.chat.sessions));
  assert.ok(Array.isArray(scopedDataExport.devices));
  assert.equal(scopedDataExport.memories, undefined);
  assert.equal(scopedDataExport.auditLogs, undefined);

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
  assert.equal(remoteAcceptanceImportBody.record.longTermReason.includes("hidden"), false);
  assert.equal(remoteAcceptanceImportBody.diagnostics.remoteValidationReport.label, "remote-acceptance:stable-https");

  const diagnosticBundleResponse = await request(port, "/api/v1/admin/diagnostic-bundle", { headers: adminHeaders });
  assert.equal(diagnosticBundleResponse.status, 200);
  assert.match(diagnosticBundleResponse.headers.get("content-disposition") || "", /lifeos-diagnostics-.*\.json/);
  const diagnosticBundle = await diagnosticBundleResponse.json();
  assert.deepEqual(Object.keys(diagnosticBundle).sort(), [
    "ai",
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
  ]);
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
  assert.equal(diagnosticBundle.remote.validationReport === null || typeof diagnosticBundle.remote.validationReport.ok === "boolean", true);
  assert.equal(Array.isArray(diagnosticBundle.remote.acceptanceChecklist), true);
  assert.equal(typeof diagnosticBundle.remote.acceptanceRecords.total, "number");
  assert.equal(typeof diagnosticBundle.remote.acceptanceRunbooks.total, "number");
  assert.equal(diagnosticBundle.remote.acceptanceRunbooks.total, 1);
  assert.equal(JSON.stringify(diagnosticBundle.release).includes(dataDir), false);
  assert.equal(JSON.stringify(diagnosticBundle).includes(testAiKey), false);
  assert.equal(JSON.stringify(diagnosticBundle).includes(dataDir), false);

  const auditAfterExports = await request(port, "/api/v1/audit-logs", { headers: adminHeaders }).then((res) => res.json());
  const auditActions = auditAfterExports.logs.map((log) => log.action);
  assert.ok(auditActions.includes("database_backup_previewed"));
  assert.ok(auditActions.includes("database_backup_downloaded"));
  assert.ok(auditActions.includes("backup_schedule_updated"));
  assert.ok(auditActions.includes("encrypted_backup_exported"));
  assert.ok(auditActions.includes("encrypted_backup_imported"));
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
  assert.equal(diagnosticExportAudit.metadata.pendingRestore, true);
  assert.equal(typeof diagnosticExportAudit.metadata.releaseManifestAvailable, "boolean");
  assert.equal(typeof diagnosticExportAudit.metadata.releaseChecksumAvailable, "boolean");
  assert.equal(typeof diagnosticExportAudit.metadata.releaseArtifactCount, "number");
  assert.equal(diagnosticExportAudit.metadata.securityOverall, "warning");
  assert.equal(diagnosticExportAudit.metadata.publicMode, false);
  const desktopConnectionConfigAudit = auditAfterExports.logs.find((log) => log.action === "desktop_connection_config_saved" && log.targetId === "cloudflare");
  assert.equal(desktopConnectionConfigAudit.targetType, "network");
  assert.equal(desktopConnectionConfigAudit.targetId, "cloudflare");
  assert.equal(desktopConnectionConfigAudit.metadata.publicBaseUrlConfigured, true);
  assert.equal(desktopConnectionConfigAudit.metadata.restartRequired, true);
  const findConfigAudit = (action, targetId) => auditAfterExports.logs.find((log) => log.action === action && log.targetType === "config" && log.targetId === targetId);
  const geminiKeySavedAudit = findConfigAudit("ai_key_saved", "google_gemini");
  assert.equal(geminiKeySavedAudit.metadata.provider, "Google Gemini");
  assert.equal(geminiKeySavedAudit.metadata.configured, true);
  assert.equal(geminiKeySavedAudit.metadata.source, "encrypted_store");
  assert.equal(typeof geminiKeySavedAudit.metadata.secureStorage.label, "string");
  assert.equal(typeof geminiKeySavedAudit.metadata.secureStorage.fallbackActive, "boolean");
  const geminiKeyDeletedAudit = findConfigAudit("ai_key_deleted", "google_gemini");
  assert.equal(geminiKeyDeletedAudit.metadata.provider, "Google Gemini");
  assert.equal(geminiKeyDeletedAudit.metadata.configured, false);
  assert.equal(geminiKeyDeletedAudit.metadata.source, "missing");
  assert.equal(typeof geminiKeyDeletedAudit.metadata.secureStorage.migrationRecommended, "boolean");
  const openAiKeySavedAudit = findConfigAudit("ai_key_saved", "openai");
  assert.equal(openAiKeySavedAudit.metadata.provider, "OpenAI");
  assert.equal(openAiKeySavedAudit.metadata.configured, true);
  assert.equal(openAiKeySavedAudit.metadata.enabled, true);
  assert.equal(openAiKeySavedAudit.metadata.source, "encrypted_store");
  assert.equal(typeof openAiKeySavedAudit.metadata.selectedModel, "string");
  assert.equal(typeof openAiKeySavedAudit.metadata.secureStorage.systemAvailable, "boolean");
  const openAiKeyDeletedAudit = findConfigAudit("ai_key_deleted", "openai");
  assert.equal(openAiKeyDeletedAudit.metadata.provider, "OpenAI");
  assert.equal(openAiKeyDeletedAudit.metadata.configured, false);
  assert.equal(openAiKeyDeletedAudit.metadata.enabled, true);
  assert.equal(openAiKeyDeletedAudit.metadata.source, "missing");
  const openAiTestAudit = findConfigAudit("ai_provider_tested", "openai");
  assert.equal(openAiTestAudit.metadata.provider, "OpenAI");
  assert.equal(openAiTestAudit.metadata.configured, true);
  assert.equal(openAiTestAudit.metadata.result, "ready");
  const openAiDefaultAudit = findConfigAudit("ai_provider_default_updated", "openai");
  assert.equal(openAiDefaultAudit.metadata.provider, "OpenAI");
  assert.equal(openAiDefaultAudit.metadata.active, true);
  const openAiModelAudit = findConfigAudit("ai_provider_model_updated", "openai");
  assert.equal(openAiModelAudit.metadata.provider, "OpenAI");
  assert.equal(openAiModelAudit.metadata.model, "gpt-4o");
  const localModelAudit = findConfigAudit("ai_provider_model_updated", "local");
  assert.equal(localModelAudit.metadata.provider, "Local Model");
  assert.equal(localModelAudit.metadata.model, "custom-local-model:latest");
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
  assert.equal(networkDiagnosticsWithBinding.latestBindingSession.expiresAt, binding.expiresAt);
  assert.equal(networkDiagnosticsWithBinding.latestBindingSession.expired, false);
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
  const connectivityReport = await request(port, "/api/v1/devices/me/connectivity-report", {
    method: "POST",
    headers: deviceHeaders,
    body: JSON.stringify({
      ok: true,
      currentBase: "https://phone.example.test/lifeos",
      latencyMs: 42,
      steps: [
        { id: "health", ok: true, latencyMs: 12, status: 200 },
        { id: "websocket", ok: true, latencyMs: 30, status: 101 },
      ],
    }),
  }).then((res) => res.json().then((body) => ({ status: res.status, body })));
  assert.equal(connectivityReport.status, 200);
  assert.equal(connectivityReport.body.report.ok, true);
  assert.equal(connectivityReport.body.report.currentBaseUrl, "https://phone.example.test/lifeos");
  assert.equal(connectivityReport.body.report.healthOk, true);
  assert.equal(connectivityReport.body.report.websocketOk, true);
  const devicesAfterConnectivityReport = await request(port, "/api/v1/devices", { headers: adminHeaders }).then((res) => res.json());
  const reportedDevice = devicesAfterConnectivityReport.devices.find((device) => device.id === credential.device.id);
  assert.equal(reportedDevice.connectivityReport.ok, true);
  assert.equal(reportedDevice.connectivityReport.currentBaseUrl, "https://phone.example.test/lifeos");

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

  const savedLocalProvider = await request(port, "/api/v1/admin/ai-providers/local/key", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ apiKey: "http://127.0.0.1:11434/v1" }),
  }).then((res) => res.json());
  assert.equal(savedLocalProvider.provider.id, "local");
  assert.equal(savedLocalProvider.provider.configured, true);

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
    body: JSON.stringify({ role: "user", content: "Hello from mobile", sourceDeviceId: credential.device.id }),
  }).then((res) => res.json());
  assert.equal(chatMessage.message.contentJson, "Hello from mobile");

  const loadedMessages = await request(port, `/api/v1/chat/sessions/${chatSession.session.id}/messages`, { headers: adminHeaders }).then((res) => res.json());
  assert.equal(loadedMessages.messages.length, 1);
  assert.equal(loadedMessages.messages[0].role, "user");
  assert.equal(loadedMessages.messages[0].contentJson, "Hello from mobile");

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
        paramsSummary: "apiKey=sk-state-secret-value-should-not-leak",
        status: "opened",
        risk: "medium",
        createdAt: Date.now(),
      }],
    }),
  }).then((res) => res.json());
  assert.equal(JSON.stringify(redactedActionLog).includes("state-secret-token"), false);
  assert.equal(JSON.stringify(redactedActionLog).includes("sk-state-secret-value-should-not-leak"), false);
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
  assert.equal(selfRevokedAudit.metadata.authMethod, "token");
  assert.equal(typeof selfRevokedAudit.metadata.revokedAt, "number");
  const revokedAudit = findAudit("device_revoked");
  assert.equal(revokedAudit.actorType, "admin");
  assert.equal(revokedAudit.metadata.deviceName, "Test Phone");
  assert.equal(revokedAudit.metadata.authMethod, "token");
  assert.equal(revokedAudit.metadata.publicKeyConfigured, false);
  assert.equal(typeof revokedAudit.metadata.credentialExpiresAt, "number");
  assert.equal(typeof revokedAudit.metadata.lastSeenAt, "number");
  assert.equal(typeof revokedAudit.metadata.wasOnline, "boolean");
  assert.equal(typeof revokedAudit.metadata.revokedAt, "number");
  const onboardingCompletedAudit = finalAudit.logs.find((log) => log.action === "admin_onboarding_completed");
  assert.equal(onboardingCompletedAudit.actorType, "admin");
  assert.equal(onboardingCompletedAudit.targetType, "admin");
  assert.equal(onboardingCompletedAudit.metadata.securityOverall, "ok");
  assert.equal(onboardingCompletedAudit.metadata.steps.every((step) => step.done), true);
  const finalAuditJson = JSON.stringify(finalAudit);
  assert.equal(finalAuditJson.includes(binding.token), false);
  assert.equal(finalAuditJson.includes(credential.accessToken), false);
  assert.equal(finalAuditJson.includes(rotated.accessToken), false);
  assert.equal(finalAuditJson.includes(adminRequestedRotation.accessToken), false);

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
    { label: "signature credential", value: signatureCredential, allowedPaths: new Set(["accessToken"]) },
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
  assertSecretNotLeaked(publicResponses, "state-secret-token");
  assertSecretNotLeaked(publicResponses, "sk-state-secret-value-should-not-leak");
  assertSecretNotLeaked(publicResponses, "AIzaSy-state-secret-value-should-not-leak");
  assertSecretNotLeaked(publicResponses, "test-key");
  assertSecretNotLeaked(publicResponses, "correct horse battery staple");
  assertSecretNotLeaked(publicResponses, "password123");
  assertSecretNotLeaked(publicResponses, binding.token, new Set(["binding"]));
  assertSecretNotLeaked(publicResponses, credential.accessToken, new Set(["credential"]));
  assertSecretNotLeaked(publicResponses, signatureCredential.accessToken, new Set(["signature credential"]));
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
