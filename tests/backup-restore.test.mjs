import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import net from "node:net";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const password = "correct horse battery staple";

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
  const session = cookie.match(/lifeos_admin_session=[^;,\s]+/)?.[0];
  const csrf = cookie.match(/lifeos_csrf=[^;,\s]+/)?.[0];
  assert.ok(session);
  assert.ok(csrf);
  return { Cookie: `${session}; ${csrf}`, "X-LifeOS-CSRF": decodeURIComponent(csrf.split("=")[1]) };
}

async function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
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

async function startServer(port, dataDir, extraEnv = {}) {
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
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  await waitForServer(port, child, output);
  return child;
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
    const timer = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(killTimer);
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

test("scheduled restore is applied before the next SQLite connection opens", { timeout: 30_000 }, async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-restore-test-"));
  let child = await startServer(port, dataDir);

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const setupResponse = await request(port, "/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const adminHeaders = cookieHeader(setupResponse);

  const baseline = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());

  await request(port, "/api/v1/chat/sessions", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ title: "Session created after baseline backup" }),
  });

  const beforeRestore = await request(port, "/api/v1/chat/sessions", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(beforeRestore.sessions.length, 1);

  const scheduled = await request(port, `/api/v1/backups/${encodeURIComponent(baseline.backup.file)}/restore`, {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(scheduled.restore.restartRequired, true);

  await stopServer(child);
  child = await startServer(port, dataDir);

  const loginResponse = await request(port, "/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const restartedAdminHeaders = cookieHeader(loginResponse);

  const afterRestore = await request(port, "/api/v1/chat/sessions", { headers: restartedAdminHeaders }).then((res) => res.json());
  assert.equal(afterRestore.sessions.length, 0);

  const pending = await request(port, "/api/v1/backups/pending-restore", { headers: restartedAdminHeaders }).then((res) => res.json());
  assert.equal(pending.pendingRestore, null);
});

test("scheduled restore can be cancelled before restart", { timeout: 30_000 }, async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-restore-cancel-test-"));
  let child = await startServer(port, dataDir);

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const setupResponse = await request(port, "/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const adminHeaders = cookieHeader(setupResponse);

  const baseline = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());

  await request(port, "/api/v1/chat/sessions", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ title: "Session should survive cancelled restore" }),
  });

  const scheduled = await request(port, `/api/v1/backups/${encodeURIComponent(baseline.backup.file)}/restore`, {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(scheduled.restore.restartRequired, true);
  assert.deepEqual(Object.keys(scheduled.restore).sort(), [
    "preRestoreBackup",
    "restartRequired",
    "restoredFrom",
    "scheduledAt",
    "scheduledForNextStart",
  ]);
  assert.equal(scheduled.restore.preRestoreBackup.path, undefined);
  assert.equal(scheduled.restore.path, undefined);
  assert.equal(scheduled.restore.sourcePath, undefined);
  assert.equal(scheduled.restore.targetPath, undefined);

  const cancelled = await request(port, "/api/v1/backups/pending-restore", {
    method: "DELETE",
    headers: adminHeaders,
  }).then((res) => res.json());
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.cancelledRestore.restoredFrom, baseline.backup.file);
  assert.deepEqual(Object.keys(cancelled.cancelledRestore).sort(), [
    "preRestoreBackup",
    "restartRequired",
    "restoredFrom",
    "scheduledAt",
    "scheduledForNextStart",
  ]);
  assert.equal(cancelled.cancelledRestore.preRestoreBackup.path, undefined);
  assert.equal(cancelled.cancelledRestore.path, undefined);
  assert.equal(cancelled.cancelledRestore.sourcePath, undefined);
  assert.equal(cancelled.cancelledRestore.targetPath, undefined);

  const pending = await request(port, "/api/v1/backups/pending-restore", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(pending.pendingRestore, null);
  assert.equal(await fileExists(path.join(dataDir, "restore-pending.db")), false);
  assert.equal(await fileExists(path.join(dataDir, "restore-pending.json")), false);

  const audit = await request(port, "/api/v1/audit-logs", { headers: adminHeaders }).then((res) => res.json());
  const cancelledAudit = audit.logs.find((log) => log.action === "database_restore_cancelled");
  assert.equal(cancelledAudit.actorType, "admin");
  assert.equal(cancelledAudit.targetId, baseline.backup.file);
  assert.equal(cancelledAudit.metadata.restoredFrom, baseline.backup.file);
  assert.equal(cancelledAudit.metadata.preRestoreBackup.path, undefined);

  await stopServer(child);
  child = await startServer(port, dataDir);

  const loginResponse = await request(port, "/api/v1/admin/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const restartedAdminHeaders = cookieHeader(loginResponse);

  const afterRestart = await request(port, "/api/v1/chat/sessions", { headers: restartedAdminHeaders }).then((res) => res.json());
  assert.equal(afterRestart.sessions.length, 1);
});

test("automatic backup retention keeps the newest configured backups", { timeout: 30_000 }, async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-retention-test-"));
  const child = await startServer(port, dataDir, { LIFEOS_BACKUP_RETENTION_COUNT: "2" });

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const setupResponse = await request(port, "/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const adminHeaders = cookieHeader(setupResponse);

  const createdFiles = [];
  for (let index = 0; index < 4; index += 1) {
    const backup = await request(port, "/api/v1/backups", {
      method: "POST",
      headers: adminHeaders,
    }).then((res) => res.json());
    createdFiles.push(backup.backup.file);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const backups = await request(port, "/api/v1/backups", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(backups.backups.length, 2);
  assert.deepEqual(
    backups.backups.map((backup) => backup.file),
    createdFiles.slice(-2).reverse(),
  );
});

test("data cleanup treats zero retention windows as no-op", { timeout: 30_000 }, async (t) => {
  const port = await getOpenPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-cleanup-zero-test-"));
  const child = await startServer(port, dataDir);

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const setupResponse = await request(port, "/api/v1/admin/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  const adminHeaders = cookieHeader(setupResponse);

  const backup = await request(port, "/api/v1/backups", {
    method: "POST",
    headers: adminHeaders,
  }).then((res) => res.json());

  await request(port, "/api/v1/chat/sessions", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ title: "Cleanup zero should keep this session" }),
  });

  const cleanupPreview = await request(port, "/api/v1/data/cleanup/preview", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ backupKeepCount: 0, auditOlderThanDays: 0, chatOlderThanDays: 0 }),
  }).then((res) => res.json());
  assert.equal(cleanupPreview.cleanup.backupsDeleted, 0);
  assert.equal(cleanupPreview.cleanup.auditLogsDeleted, 0);
  assert.equal(cleanupPreview.cleanup.chatSessionsDeleted, 0);
  assert.equal(cleanupPreview.cleanup.messagesDeleted, 0);

  const cleanup = await request(port, "/api/v1/data/cleanup", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ backupKeepCount: 0, auditOlderThanDays: 0, chatOlderThanDays: 0 }),
  }).then((res) => res.json());
  assert.deepEqual(cleanup.cleanup, cleanupPreview.cleanup);
  assert.equal(cleanup.cleanup.backupsDeleted, 0);
  assert.equal(cleanup.cleanup.auditLogsDeleted, 0);
  assert.equal(cleanup.cleanup.chatSessionsDeleted, 0);
  assert.equal(cleanup.cleanup.messagesDeleted, 0);

  const sessions = await request(port, "/api/v1/chat/sessions", { headers: adminHeaders }).then((res) => res.json());
  assert.equal(sessions.sessions.length, 1);
  const backups = await request(port, "/api/v1/backups", { headers: adminHeaders }).then((res) => res.json());
  assert.ok(backups.backups.some((item) => item.file === backup.backup.file));
});
