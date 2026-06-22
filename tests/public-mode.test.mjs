import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
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

function startServer(env) {
  const child = spawn(process.execPath, ["dist/server.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  return { child, output };
}

async function waitForExit(child, output) {
  if (child.exitCode !== null) return { code: child.exitCode, output: output.join("") };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: child.exitCode, output: output.join("") });
    }, 3000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.join("") });
    });
  });
}

async function waitForHealth(port, child, output) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}\n${output.join("")}`);
    try {
      const response = await request(port, "/api/v1/health");
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server did not become healthy\n${output.join("")}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

test("LAN host requires explicit public access opt-in", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-public-host-test-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const { child, output } = startServer({
    LIFEOS_PORT: String(7410 + Math.floor(Math.random() * 1000)),
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_HOST: "0.0.0.0",
  });

  const result = await waitForExit(child, output);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /requires LIFEOS_ALLOW_PUBLIC=1/);
});

test("public mode diagnostics flag weak password, non-HTTPS, and missing backup", async (t) => {
  const port = 10410 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-public-diagnostics-test-"));
  const { child, output } = startServer({
    LIFEOS_PORT: String(port),
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_HOST: "0.0.0.0",
    LIFEOS_ALLOW_PUBLIC: "1",
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
  });

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(port, child, output);

  const initialHealth = await request(port, "/api/v1/health").then((res) => res.json());
  assert.equal(initialHealth.adminConfigured, false);
  assert.equal(initialHealth.publicAccessWarning, true);
  assert.equal(initialHealth.publicSetupRisk, true);
  assert.equal(initialHealth.publicRisk.overall, "critical");
  assert.equal(initialHealth.publicRisk.items.some((item) => item.id === "admin" && item.status === "critical"), true);
  assert.equal(initialHealth.publicRisk.items.some((item) => item.id === "backup" && item.status === "critical"), true);
  assert.equal(initialHealth.publicRisk.items.some((item) => item.id === "backupFreshness" && item.status === "critical"), true);
  assert.equal(initialHealth.publicRisk.items.some((item) => item.id === "backupSchedule" && item.status === "critical"), true);

  const setupResponse = await request(port, "/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password: "password123" }),
  });
  assert.equal(setupResponse.status, 200);
  const adminHeaders = cookieHeader(setupResponse);

  const configuredHealth = await request(port, "/api/v1/health").then((res) => res.json());
  assert.equal(configuredHealth.adminConfigured, true);
  assert.equal(configuredHealth.publicSetupRisk, true);
  assert.equal(configuredHealth.publicRisk.items.some((item) => item.id === "password" && item.status === "critical"), true);
  assert.equal(configuredHealth.publicRisk.items.some((item) => item.id === "https" && item.status === "critical"), true);
  assert.equal(configuredHealth.publicRisk.items.some((item) => item.id === "backup" && item.status === "critical"), true);
  assert.equal(configuredHealth.publicRisk.items.some((item) => item.id === "backupFreshness" && item.status === "critical"), true);
  assert.equal(configuredHealth.publicRisk.items.some((item) => item.id === "backupSchedule" && item.status === "critical"), true);

  const diagnostics = await request(port, "/api/v1/admin/config-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(diagnostics.securityCheck.publicMode, true);
  assert.equal(diagnostics.securityCheck.overall, "critical");
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "password" && item.status === "critical"), true);
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "https" && item.status === "critical"), true);
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "backup" && item.status === "critical"), true);
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "backupFreshness" && item.status === "critical"), true);
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "backupSchedule" && item.status === "critical"), true);
  assert.equal(diagnostics.securityCheck.items.some((item) => item.id === "publicOptIn" && item.status === "ok"), true);
  assert.equal(diagnostics.storage.backupSchedule.enabled, false);

  const backupResponse = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: adminHeaders,
  });
  assert.equal(backupResponse.status, 200);
  const staleBackup = await backupResponse.json();
  const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await utimes(path.join(dataDir, "backups", staleBackup.backup.file), staleDate, staleDate);

  const staleBackupDiagnostics = await request(port, "/api/v1/admin/config-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(staleBackupDiagnostics.securityCheck.items.some((item) => item.id === "backup" && item.status === "ok"), true);
  assert.equal(staleBackupDiagnostics.securityCheck.items.some((item) => item.id === "backupFreshness" && item.status === "critical"), true);

  const freshBackupResponse = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: adminHeaders,
  });
  assert.equal(freshBackupResponse.status, 200);

  const passwordResponse = await request(port, "/api/v1/admin/password", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ currentPassword: "password123", newPassword: "correct horse battery staple" }),
  });
  assert.equal(passwordResponse.status, 200);

  const scheduleResponse = await request(port, "/api/v1/backups/schedule", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ enabled: true, intervalHours: 12 }),
  });
  assert.equal(scheduleResponse.status, 200);

  const improvedDiagnostics = await request(port, "/api/v1/admin/config-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(improvedDiagnostics.securityCheck.items.some((item) => item.id === "password" && item.status === "ok"), true);
  assert.equal(improvedDiagnostics.securityCheck.items.some((item) => item.id === "backup" && item.status === "ok"), true);
  assert.equal(improvedDiagnostics.securityCheck.items.some((item) => item.id === "backupFreshness" && item.status === "ok"), true);
  assert.equal(improvedDiagnostics.securityCheck.items.some((item) => item.id === "backupSchedule" && item.status === "ok"), true);
  assert.equal(improvedDiagnostics.securityCheck.items.some((item) => item.id === "https" && item.status === "critical"), true);
  assert.equal(improvedDiagnostics.storage.backupSchedule.enabled, true);
  assert.equal(improvedDiagnostics.storage.backupSchedule.intervalHours, 12);

  const improvedHealth = await request(port, "/api/v1/health").then((res) => res.json());
  assert.equal(improvedHealth.publicSetupRisk, true);
  assert.equal(improvedHealth.publicRisk.items.some((item) => item.id === "password"), false);
  assert.equal(improvedHealth.publicRisk.items.some((item) => item.id === "backup"), false);
  assert.equal(improvedHealth.publicRisk.items.some((item) => item.id === "backupFreshness"), false);
  assert.equal(improvedHealth.publicRisk.items.some((item) => item.id === "backupSchedule"), false);
  assert.equal(improvedHealth.publicRisk.items.some((item) => item.id === "https" && item.status === "critical"), true);
});

test("PUBLIC_BASE_URL requires explicit public access opt-in", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-public-url-test-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const { child, output } = startServer({
    LIFEOS_PORT: String(8410 + Math.floor(Math.random() * 1000)),
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_HOST: "127.0.0.1",
    PUBLIC_BASE_URL: "https://lifeos.example.test",
  });

  const result = await waitForExit(child, output);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /requires LIFEOS_ALLOW_PUBLIC=1/);
});

test("quickstart env password login skips onboarding and routes to chat", async (t) => {
  const port = 11410 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-quickstart-login-test-"));
  const { child, output } = startServer({
    LIFEOS_PORT: String(port),
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_HOST: "127.0.0.1",
    LIFEOS_QUICKSTART: "1",
    LIFEOS_ADMIN_PASSWORD: "lifeos-local-demo",
    LIFEOS_ACTIVE_AI_PROVIDER: "local",
    LOCAL_MODEL_BASE_URL: "http://ollama:11434/v1",
    LOCAL_MODEL_NAME: "llama3.2",
  });

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(port, child, output);

  const loginResponse = await request(port, "/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: "lifeos-local-demo" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.onboardingRequired, false);
  assert.equal(login.nextPath, "/chat");

  const adminHeaders = cookieHeader(loginResponse);
  const onboarding = await request(port, "/api/v1/admin/onboarding", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(onboarding.onboarding.required, false);
  assert.equal(onboarding.onboarding.completed, true);
  assert.equal(onboarding.onboarding.nextPath, "/chat");
  assert.equal(onboarding.onboarding.steps.every((step) => step.done), true);
});

test("public mode security diagnostics flag unsafe raw PUBLIC_BASE_URL input", async (t) => {
  const port = 12410 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-public-url-input-test-"));
  const { child, output } = startServer({
    LIFEOS_PORT: String(port),
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_HOST: "127.0.0.1",
    LIFEOS_ALLOW_PUBLIC: "1",
    PUBLIC_BASE_URL: "https://user:password@lifeos.example.test/mobile?token=public-secret#debug",
  });

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const health = await waitForHealth(port, child, output);
  assert.equal(health.publicBaseUrl, "https://lifeos.example.test/mobile");
  assert.equal(JSON.stringify(health).includes("public-secret"), false);
  assert.equal(JSON.stringify(health).includes("user:password"), false);
  assert.equal(health.publicRisk.items.some((item) => item.id === "publicBaseUrlInput" && item.status === "critical"), true);

  const setupResponse = await request(port, "/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password: "correct horse battery staple" }),
  });
  assert.equal(setupResponse.status, 200);
  const adminHeaders = cookieHeader(setupResponse);
  const diagnostics = await request(port, "/api/v1/admin/config-diagnostics", { headers: adminHeaders }).then((res) => res.json());
  const unsafeInput = diagnostics.securityCheck.items.find((item) => item.id === "publicBaseUrlInput");
  assert.equal(unsafeInput.status, "critical");
  assert.match(unsafeInput.action, /PUBLIC_BASE_URL/);
  assert.equal(JSON.stringify(diagnostics).includes("public-secret"), false);
  assert.equal(JSON.stringify(diagnostics).includes("user:password"), false);
});

test("explicit public access opt-in exposes health warning metadata", async (t) => {
  const port = 9410 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-public-allowed-test-"));
  const { child, output } = startServer({
    LIFEOS_PORT: String(port),
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_HOST: "0.0.0.0",
    LIFEOS_ALLOW_PUBLIC: "1",
    PUBLIC_BASE_URL: "https://lifeos.example.test",
  });

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const health = await waitForHealth(port, child, output);
  assert.equal(health.host, "0.0.0.0");
  assert.equal(health.networkMode, "lan");
  assert.equal(health.publicBaseUrl, "https://lifeos.example.test");
  assert.equal(health.publicAccessWarning, true);
  assert.equal(health.publicAccessAllowed, true);
  assert.equal(health.adminConfigured, false);
  assert.equal(health.publicSetupRisk, true);
  assert.equal(health.publicRisk.overall, "critical");
  assert.equal(health.publicRisk.items.some((item) => item.id === "admin"), true);
});

test("health exposes saved desktop remote entry mode for mobile recovery", async (t) => {
  const port = 9510 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-health-desktop-mode-"));
  await writeFile(path.join(dataDir, "desktop-runtime-config.json"), `${JSON.stringify({
    mode: "cloudflare",
    label: "Cloudflare Named Tunnel",
    host: "0.0.0.0",
    port,
    publicBaseUrl: "https://lifeos.example.com",
    allowPublic: true,
    baseUrl: "https://lifeos.example.com",
    updatedAt: Date.now(),
  }, null, 2)}\n`);
  const { child, output } = startServer({
    LIFEOS_PORT: String(port),
    LIFEOS_DATA_DIR: dataDir,
    LIFEOS_HOST: "127.0.0.1",
    LIFEOS_ALLOW_PUBLIC: "1",
  });

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const health = await waitForHealth(port, child, output);
  assert.equal(health.publicBaseUrl, "https://lifeos.example.com");
  assert.equal(health.remoteEntryMode, "cloudflare");
});
