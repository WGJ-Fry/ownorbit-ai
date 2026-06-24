import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function request(port, pathname) {
  return fetch(`http://127.0.0.1:${port}${pathname}`);
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

function createLegacyDatabase(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "lifeos.db"));
  db.exec(`
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      public_key TEXT,
      access_token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    INSERT INTO devices (id, name, type, status, public_key, access_token_hash, created_at, last_seen_at, revoked_at)
    VALUES ('legacy-device', 'Legacy Phone', 'mobile', 'offline', NULL, 'hash', 1, 1, NULL);
  `);
  db.close();
}

test("startup migrations upgrade a legacy SQLite schema", async (t) => {
  const port = 7210 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-migration-test-"));
  createLegacyDatabase(dataDir);

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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    await stopServer(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(port, child, output);
  await stopServer(child);

  const db = new DatabaseSync(path.join(dataDir, "lifeos.db"));
  const columns = db.prepare("PRAGMA table_info(devices)").all().map((column) => column.name);
  const migration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 1").get();
  const connectivityMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 4").get();
  const bindingBaseUrlMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 5").get();
  const mobileShellMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 6").get();
  const problemBlueprintMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 7").get();
  const connectivityColumns = db.prepare("PRAGMA table_info(device_connectivity_reports)").all().map((column) => column.name);
  const bindingSessionColumns = db.prepare("PRAGMA table_info(binding_sessions)").all().map((column) => column.name);
  const problemBlueprintColumns = db.prepare("PRAGMA table_info(problem_blueprints)").all().map((column) => column.name);
  const legacyDevice = db.prepare("SELECT id, access_token_expires_at as accessTokenExpiresAt FROM devices WHERE id = 'legacy-device'").get();
  db.close();

  assert.ok(columns.includes("access_token_expires_at"));
  assert.equal(migration.name, "device_token_expiry");
  assert.equal(connectivityMigration.name, "device_connectivity_reports");
  assert.equal(bindingBaseUrlMigration.name, "binding_session_base_url");
  assert.equal(mobileShellMigration.name, "device_connectivity_mobile_shell");
  assert.equal(problemBlueprintMigration.name, "problem_blueprints");
  assert.ok(connectivityColumns.includes("current_base_url"));
  assert.ok(connectivityColumns.includes("mobile_shell_ok"));
  assert.ok(connectivityColumns.includes("websocket_ok"));
  assert.ok(bindingSessionColumns.includes("base_url"));
  assert.ok(problemBlueprintColumns.includes("app_prompt"));
  assert.ok(problemBlueprintColumns.includes("generated_app_id"));
  assert.equal(legacyDevice.accessTokenExpiresAt, null);
});
