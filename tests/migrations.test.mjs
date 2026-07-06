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

    CREATE TABLE binding_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      confirmed_device_id TEXT
    );
    INSERT INTO binding_sessions (id, token_hash, created_at, expires_at, confirmed_at, confirmed_device_id)
    VALUES ('legacy-binding', 'legacy-token-hash', 1, 9999999999999, NULL, NULL);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      source_device_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE client_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by_type TEXT,
      updated_by_id TEXT
    );
    INSERT INTO client_state (key, value_json, updated_at, updated_by_type, updated_by_id)
    VALUES (
      'lifeos_apps',
      '[{"id":"legacy-app-1","name":"Legacy Ledger","description":"Old local app /Users/example/private.csv","visibility":"private","status":"active","createdAt":1,"code":"<script>const token = ''github_pat_legacyCustomAppSecret_1234567890'';</script>"}]',
      1,
      'device',
      'legacy-device'
    );
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
  const customAppsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 8").get();
  const customAppRuntimeMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 9").get();
  const customAppActionRequestsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 10").get();
  const customAppActionPoliciesMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 11").get();
  const customAppCapabilitiesMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 12").get();
  const customAppCapabilityRequestsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 13").get();
  const customAppRuntimeEventsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 14").get();
  const messageOfflineSyncMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 15").get();
  const calendarSyncOperationsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 16").get();
  const calendarSyncRunsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 17").get();
  const icloudHandoffEventsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 18").get();
  const connectivityColumns = db.prepare("PRAGMA table_info(device_connectivity_reports)").all().map((column) => column.name);
  const icloudHandoffEventColumns = db.prepare("PRAGMA table_info(device_icloud_handoff_events)").all().map((column) => column.name);
  const messageColumns = db.prepare("PRAGMA table_info(messages)").all().map((column) => column.name);
  const bindingSessionColumns = db.prepare("PRAGMA table_info(binding_sessions)").all().map((column) => column.name);
  const problemBlueprintColumns = db.prepare("PRAGMA table_info(problem_blueprints)").all().map((column) => column.name);
  const customAppColumns = db.prepare("PRAGMA table_info(custom_apps)").all().map((column) => column.name);
  const customAppVersionColumns = db.prepare("PRAGMA table_info(custom_app_versions)").all().map((column) => column.name);
  const customAppStateColumns = db.prepare("PRAGMA table_info(custom_app_state)").all().map((column) => column.name);
  const customAppActionRequestColumns = db.prepare("PRAGMA table_info(custom_app_action_requests)").all().map((column) => column.name);
  const customAppActionPolicyColumns = db.prepare("PRAGMA table_info(custom_app_action_policies)").all().map((column) => column.name);
  const customAppCapabilityColumns = db.prepare("PRAGMA table_info(custom_app_capability_manifests)").all().map((column) => column.name);
  const customAppCapabilityRequestColumns = db.prepare("PRAGMA table_info(custom_app_capability_requests)").all().map((column) => column.name);
  const customAppRuntimeEventColumns = db.prepare("PRAGMA table_info(custom_app_runtime_events)").all().map((column) => column.name);
  const calendarSyncOperationColumns = db.prepare("PRAGMA table_info(calendar_sync_operations)").all().map((column) => column.name);
  const calendarSyncRunColumns = db.prepare("PRAGMA table_info(calendar_sync_runs)").all().map((column) => column.name);
  const legacyDevice = db.prepare("SELECT id, access_token_expires_at as accessTokenExpiresAt FROM devices WHERE id = 'legacy-device'").get();
  const legacyCustomApp = db.prepare("SELECT id, name, description, code FROM custom_apps WHERE id = 'legacy-app-1'").get();
  const legacyCustomAppVersion = db.prepare("SELECT app_id as appId, version, code, note FROM custom_app_versions WHERE app_id = 'legacy-app-1'").get();
  db.close();

  assert.ok(columns.includes("access_token_expires_at"));
  assert.equal(migration.name, "device_token_expiry");
  assert.equal(connectivityMigration.name, "device_connectivity_reports");
  assert.equal(bindingBaseUrlMigration.name, "binding_session_base_url");
  assert.equal(mobileShellMigration.name, "device_connectivity_mobile_shell");
  assert.equal(problemBlueprintMigration.name, "problem_blueprints");
  assert.equal(customAppsMigration.name, "custom_apps");
  assert.equal(customAppRuntimeMigration.name, "custom_app_runtime");
  assert.equal(customAppActionRequestsMigration.name, "custom_app_action_requests");
  assert.equal(customAppActionPoliciesMigration.name, "custom_app_action_policies");
  assert.equal(customAppCapabilitiesMigration.name, "custom_app_capability_manifests");
  assert.equal(customAppCapabilityRequestsMigration.name, "custom_app_capability_requests");
  assert.equal(customAppRuntimeEventsMigration.name, "custom_app_runtime_events");
  assert.equal(messageOfflineSyncMigration.name, "message_offline_sync_identity");
  assert.equal(calendarSyncOperationsMigration.name, "calendar_sync_operations");
  assert.equal(calendarSyncRunsMigration.name, "calendar_sync_runs");
  assert.equal(icloudHandoffEventsMigration.name, "device_icloud_handoff_events");
  assert.ok(connectivityColumns.includes("current_base_url"));
  assert.ok(connectivityColumns.includes("mobile_shell_ok"));
  assert.ok(connectivityColumns.includes("websocket_ok"));
  assert.ok(icloudHandoffEventColumns.includes("entry_base_url"));
  assert.ok(icloudHandoffEventColumns.includes("stored_base_url"));
  assert.ok(icloudHandoffEventColumns.includes("checksum_sha256"));
  assert.ok(icloudHandoffEventColumns.includes("ignored_at"));
  assert.ok(messageColumns.includes("offline_mutation_id"));
  assert.ok(messageColumns.includes("idempotency_key"));
  assert.ok(messageColumns.includes("client_sequence"));
  assert.ok(messageColumns.includes("source_version"));
  assert.ok(messageColumns.includes("queued_at"));
  assert.ok(bindingSessionColumns.includes("base_url"));
  assert.ok(problemBlueprintColumns.includes("app_prompt"));
  assert.ok(problemBlueprintColumns.includes("generated_app_id"));
  assert.ok(customAppColumns.includes("code"));
  assert.ok(customAppColumns.includes("problem_blueprint_id"));
  assert.ok(customAppVersionColumns.includes("version"));
  assert.ok(customAppVersionColumns.includes("code"));
  assert.ok(customAppStateColumns.includes("state_json"));
  assert.ok(customAppStateColumns.includes("updated_at"));
  assert.ok(customAppActionRequestColumns.includes("target_url"));
  assert.ok(customAppActionRequestColumns.includes("target_scheme"));
  assert.ok(customAppActionRequestColumns.includes("status"));
  assert.ok(customAppActionRequestColumns.includes("decision_note"));
  assert.ok(customAppActionPolicyColumns.includes("allowed_schemes_json"));
  assert.ok(customAppActionPolicyColumns.includes("require_confirmation"));
  assert.ok(customAppCapabilityColumns.includes("allowed_capabilities_json"));
  assert.ok(customAppCapabilityColumns.includes("risk_level"));
  assert.ok(customAppCapabilityRequestColumns.includes("requested_capabilities_json"));
  assert.ok(customAppCapabilityRequestColumns.includes("missing_capabilities_json"));
  assert.ok(customAppRuntimeEventColumns.includes("event_type"));
  assert.ok(customAppRuntimeEventColumns.includes("detail_json"));
  assert.ok(calendarSyncOperationColumns.includes("provider_id"));
  assert.ok(calendarSyncOperationColumns.includes("rollback_plan_json"));
  assert.ok(calendarSyncOperationColumns.includes("rolled_back_at"));
  assert.ok(calendarSyncOperationColumns.includes("rollback_result_json"));
  assert.ok(calendarSyncRunColumns.includes("summary_json"));
  assert.ok(calendarSyncRunColumns.includes("conflicts_json"));
  assert.ok(calendarSyncRunColumns.includes("next_steps_json"));
  assert.equal(legacyCustomApp.name, "Legacy Ledger");
  assert.equal(legacyCustomApp.description.includes("/Users/example/private.csv"), false);
  assert.equal(legacyCustomApp.code.includes("github_pat_legacyCustomAppSecret"), false);
  assert.equal(legacyCustomAppVersion.appId, "legacy-app-1");
  assert.equal(legacyCustomAppVersion.version, 1);
  assert.equal(legacyCustomAppVersion.note, "Imported from legacy client state");
  assert.equal(legacyCustomAppVersion.code.includes("github_pat_legacyCustomAppSecret"), false);
  assert.equal(legacyDevice.accessTokenExpiresAt, null);
});

test("bundled fallback migrations upgrade legacy schema without SQL files on cwd", async (t) => {
  const port = 8210 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-fallback-migration-test-"));
  createLegacyDatabase(dataDir);

  const child = spawn(process.execPath, [path.join(rootDir, "dist/server.cjs")], {
    cwd: dataDir,
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
  const bindingSessionColumns = db.prepare("PRAGMA table_info(binding_sessions)").all().map((column) => column.name);
  const messageColumns = db.prepare("PRAGMA table_info(messages)").all().map((column) => column.name);
  const customAppColumns = db.prepare("PRAGMA table_info(custom_apps)").all().map((column) => column.name);
  const calendarSyncRunColumns = db.prepare("PRAGMA table_info(calendar_sync_runs)").all().map((column) => column.name);
  const icloudHandoffEventColumns = db.prepare("PRAGMA table_info(device_icloud_handoff_events)").all().map((column) => column.name);
  const bindingBaseUrlMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 5").get();
  const customAppsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 8").get();
  const calendarSyncRunsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 17").get();
  const icloudHandoffEventsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 18").get();
  const legacyBinding = db.prepare("SELECT id, base_url as baseUrl FROM binding_sessions WHERE id = 'legacy-binding'").get();
  db.close();

  assert.ok(bindingSessionColumns.includes("base_url"));
  assert.ok(messageColumns.includes("idempotency_key"));
  assert.ok(customAppColumns.includes("code"));
  assert.ok(calendarSyncRunColumns.includes("summary_json"));
  assert.ok(icloudHandoffEventColumns.includes("entry_base_url"));
  assert.ok(icloudHandoffEventColumns.includes("stored_base_url"));
  assert.equal(bindingBaseUrlMigration.name, "binding_session_base_url");
  assert.equal(customAppsMigration.name, "custom_apps");
  assert.equal(calendarSyncRunsMigration.name, "calendar_sync_runs");
  assert.equal(icloudHandoffEventsMigration.name, "device_icloud_handoff_events");
  assert.equal(legacyBinding.baseUrl, null);
});
