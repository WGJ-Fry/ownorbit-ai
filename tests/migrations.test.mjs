import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

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
  const port = await getFreePort();
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
  const cloudKitSyncCheckpointsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 19").get();
  const cloudKitSyncQuarantineMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 20").get();
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
  const cloudKitSyncCheckpointColumns = db.prepare("PRAGMA table_info(cloudkit_sync_checkpoints)").all().map((column) => column.name);
  const cloudKitSyncQuarantineColumns = db.prepare("PRAGMA table_info(cloudkit_sync_quarantine)").all().map((column) => column.name);
  const cloudKitDeviceTrustColumns = db.prepare("PRAGMA table_info(cloudkit_device_trust_metadata)").all().map((column) => column.name);
  const legacyDevice = db.prepare("SELECT id, access_token_expires_at as accessTokenExpiresAt FROM devices WHERE id = 'legacy-device'").get();
  const legacyCustomApp = db.prepare("SELECT id, name, description, code FROM custom_apps WHERE id = 'legacy-app-1'").get();
  const legacyCustomAppVersion = db.prepare("SELECT app_id as appId, version, code, note FROM custom_app_versions WHERE app_id = 'legacy-app-1'").get();
  const cloudKitDeviceTrustMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 21").get();
  const deviceRequestNonceMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 25").get();
  const deviceRequestNonceColumns = db.prepare("PRAGMA table_info(device_request_nonces)").all().map((column) => column.name);
  const adminSessionCredentialMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 26").get();
  const adminSessionColumns = db.prepare("PRAGMA table_info(admin_sessions)").all().map((column) => column.name);
  const chatConversationOwnerMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 27").get();
  const chatConversationOwnerColumns = db.prepare("PRAGMA table_info(cloudkit_chat_conversation_owners)").all().map((column) => column.name);
  const cloudKitDeviceApprovalMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 28").get();
  const cloudKitDeviceKeyColumns = db.prepare("PRAGMA table_info(cloudkit_device_keys)").all().map((column) => column.name);
  const cloudKitRelayLeaseMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 29").get();
  const cloudKitRelayLeaseColumns = db.prepare("PRAGMA table_info(cloudkit_chat_relay_leases)").all().map((column) => column.name);
  const cloudKitResponseDeliveryMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 30").get();
  const cloudKitChatJobColumns = db.prepare("PRAGMA table_info(cloudkit_chat_jobs)").all().map((column) => column.name);
  const cloudKitDeviceSequencesMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 31").get();
  const cloudKitDeviceSequenceColumns = db.prepare("PRAGMA table_info(cloudkit_chat_device_sequences)").all().map((column) => column.name);
  const cloudKitRelayFencingMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 32").get();
  const cloudKitResponseReceiptsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 33").get();
  const cloudKitRemoteCleanupMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 34").get();
  const cloudKitRemoteCleanupColumns = db.prepare("PRAGMA table_info(cloudkit_chat_remote_cleanup)").all().map((column) => column.name);
  const cloudKitTrustedMacMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 35").get();
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
  assert.equal(customAppCapabilityColumns.includes("allowed_network_origins_json"), true);
  assert.equal(customAppCapabilityRequestColumns.includes("requested_network_origins_json"), true);
  assert.equal(customAppCapabilityRequestColumns.includes("missing_network_origins_json"), true);
  assert.equal(customAppRuntimeEventsMigration.name, "custom_app_runtime_events");
  assert.equal(messageOfflineSyncMigration.name, "message_offline_sync_identity");
  assert.equal(calendarSyncOperationsMigration.name, "calendar_sync_operations");
  assert.equal(calendarSyncRunsMigration.name, "calendar_sync_runs");
  assert.equal(icloudHandoffEventsMigration.name, "device_icloud_handoff_events");
  assert.equal(cloudKitSyncCheckpointsMigration.name, "cloudkit_sync_checkpoints");
  assert.equal(cloudKitSyncQuarantineMigration.name, "cloudkit_sync_quarantine");
  assert.equal(cloudKitDeviceTrustMigration.name, "cloudkit_device_trust_metadata");
  assert.equal(deviceRequestNonceMigration.name, "device_request_nonces");
  assert.deepEqual(deviceRequestNonceColumns, ["device_id", "nonce_hash", "used_at", "expires_at"]);
  assert.equal(adminSessionCredentialMigration.name, "admin_session_credential_version");
  assert.ok(adminSessionColumns.includes("credential_source"));
  assert.ok(adminSessionColumns.includes("credential_version"));
  assert.ok(adminSessionColumns.includes("revoked_reason"));
  assert.equal(chatConversationOwnerMigration.name, "cloudkit_chat_conversation_owners");
  assert.deepEqual(chatConversationOwnerColumns, ["conversation_id", "source_device_hash", "created_at", "last_seen_at"]);
  assert.equal(cloudKitDeviceApprovalMigration.name, "cloudkit_device_key_approvals");
  assert.ok(cloudKitDeviceKeyColumns.includes("approved_at"));
  assert.ok(cloudKitDeviceKeyColumns.includes("approval_actor"));
  assert.equal(cloudKitRelayLeaseMigration.name, "cloudkit_chat_relay_lease");
  assert.deepEqual(cloudKitRelayLeaseColumns, ["lease_name", "lease_id", "holder_pid", "acquired_at", "expires_at", "fencing_token"]);
  assert.equal(cloudKitRelayFencingMigration.name, "cloudkit_chat_relay_fencing");
  assert.equal(cloudKitResponseReceiptsMigration.name, "cloudkit_chat_response_receipts");
  assert.equal(cloudKitRemoteCleanupMigration.name, "cloudkit_chat_remote_cleanup");
  assert.equal(cloudKitTrustedMacMigration.name, "cloudkit_chat_trusted_mac");
  assert.deepEqual(cloudKitRemoteCleanupColumns, [
    "request_id",
    "status",
    "attempt_count",
    "next_attempt_at",
    "created_at",
    "completed_at",
    "last_error",
  ]);
  assert.equal(cloudKitResponseDeliveryMigration.name, "cloudkit_chat_response_delivery");
  assert.ok(cloudKitChatJobColumns.includes("response_exported_updated_at"));
  assert.ok(cloudKitChatJobColumns.includes("response_exported_at"));
  assert.ok(cloudKitChatJobColumns.includes("response_exported_content_hash"));
  assert.ok(cloudKitChatJobColumns.includes("response_consumed_at"));
  assert.ok(cloudKitChatJobColumns.includes("trusted_mac_fingerprint"));
  assert.equal(cloudKitDeviceSequencesMigration.name, "cloudkit_chat_device_sequences");
  assert.deepEqual(cloudKitDeviceSequenceColumns, ["source_device_hash", "client_sequence", "request_id", "created_at"]);
  assert.ok(connectivityColumns.includes("current_base_url"));
  assert.ok(connectivityColumns.includes("mobile_shell_ok"));
  assert.ok(connectivityColumns.includes("websocket_ok"));
  assert.ok(icloudHandoffEventColumns.includes("entry_base_url"));
  assert.ok(icloudHandoffEventColumns.includes("stored_base_url"));
  assert.ok(icloudHandoffEventColumns.includes("checksum_sha256"));
  assert.ok(icloudHandoffEventColumns.includes("ignored_at"));
  assert.ok(cloudKitSyncCheckpointColumns.includes("applied_server_change_token"));
  assert.ok(cloudKitSyncCheckpointColumns.includes("pending_server_change_token"));
  assert.ok(cloudKitSyncCheckpointColumns.includes("token_state"));
  assert.ok(cloudKitSyncCheckpointColumns.includes("more_coming"));
  assert.ok(cloudKitSyncQuarantineColumns.includes("change_type"));
  assert.ok(cloudKitSyncQuarantineColumns.includes("status"));
  assert.ok(cloudKitSyncQuarantineColumns.includes("payload_json"));
  assert.ok(cloudKitSyncQuarantineColumns.includes("payload_hash"));
  assert.ok(cloudKitSyncQuarantineColumns.includes("source_evidence_id"));
  assert.ok(cloudKitDeviceTrustColumns.includes("device_id_hash"));
  assert.ok(cloudKitDeviceTrustColumns.includes("public_key_fingerprint"));
  assert.ok(cloudKitDeviceTrustColumns.includes("review_status"));
  assert.ok(cloudKitDeviceTrustColumns.includes("access_granted"));
  assert.equal(cloudKitDeviceTrustColumns.includes("access_token_hash"), false);
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
  const port = await getFreePort();
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
  const cloudKitDeviceTrustColumns = db.prepare("PRAGMA table_info(cloudkit_device_trust_metadata)").all().map((column) => column.name);
  const bindingBaseUrlMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 5").get();
  const customAppsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 8").get();
  const calendarSyncRunsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 17").get();
  const icloudHandoffEventsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 18").get();
  const cloudKitDeviceTrustMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 21").get();
  const deviceRequestNonceMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 25").get();
  const deviceRequestNonceColumns = db.prepare("PRAGMA table_info(device_request_nonces)").all().map((column) => column.name);
  const adminSessionCredentialMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 26").get();
  const adminSessionColumns = db.prepare("PRAGMA table_info(admin_sessions)").all().map((column) => column.name);
  const chatConversationOwnerMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 27").get();
  const chatConversationOwnerColumns = db.prepare("PRAGMA table_info(cloudkit_chat_conversation_owners)").all().map((column) => column.name);
  const cloudKitDeviceApprovalMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 28").get();
  const cloudKitDeviceKeyColumns = db.prepare("PRAGMA table_info(cloudkit_device_keys)").all().map((column) => column.name);
  const cloudKitRelayLeaseMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 29").get();
  const cloudKitRelayLeaseColumns = db.prepare("PRAGMA table_info(cloudkit_chat_relay_leases)").all().map((column) => column.name);
  const cloudKitResponseDeliveryMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 30").get();
  const cloudKitChatJobColumns = db.prepare("PRAGMA table_info(cloudkit_chat_jobs)").all().map((column) => column.name);
  const cloudKitDeviceSequencesMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 31").get();
  const cloudKitDeviceSequenceColumns = db.prepare("PRAGMA table_info(cloudkit_chat_device_sequences)").all().map((column) => column.name);
  const cloudKitRelayFencingMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 32").get();
  const cloudKitResponseReceiptsMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 33").get();
  const cloudKitRemoteCleanupMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 34").get();
  const cloudKitRemoteCleanupColumns = db.prepare("PRAGMA table_info(cloudkit_chat_remote_cleanup)").all().map((column) => column.name);
  const cloudKitTrustedMacMigration = db.prepare("SELECT version, name FROM schema_migrations WHERE version = 35").get();
  const legacyBinding = db.prepare("SELECT id, base_url as baseUrl FROM binding_sessions WHERE id = 'legacy-binding'").get();
  db.close();

  assert.ok(bindingSessionColumns.includes("base_url"));
  assert.ok(messageColumns.includes("idempotency_key"));
  assert.ok(customAppColumns.includes("code"));
  assert.ok(calendarSyncRunColumns.includes("summary_json"));
  assert.ok(icloudHandoffEventColumns.includes("entry_base_url"));
  assert.ok(icloudHandoffEventColumns.includes("stored_base_url"));
  assert.ok(cloudKitDeviceTrustColumns.includes("device_id_hash"));
  assert.ok(cloudKitDeviceTrustColumns.includes("access_granted"));
  assert.equal(bindingBaseUrlMigration.name, "binding_session_base_url");
  assert.equal(customAppsMigration.name, "custom_apps");
  assert.equal(calendarSyncRunsMigration.name, "calendar_sync_runs");
  assert.equal(icloudHandoffEventsMigration.name, "device_icloud_handoff_events");
  assert.equal(cloudKitDeviceTrustMigration.name, "cloudkit_device_trust_metadata");
  assert.equal(deviceRequestNonceMigration.name, "device_request_nonces");
  assert.deepEqual(deviceRequestNonceColumns, ["device_id", "nonce_hash", "used_at", "expires_at"]);
  assert.equal(adminSessionCredentialMigration.name, "admin_session_credential_version");
  assert.ok(adminSessionColumns.includes("credential_source"));
  assert.ok(adminSessionColumns.includes("credential_version"));
  assert.ok(adminSessionColumns.includes("revoked_reason"));
  assert.equal(chatConversationOwnerMigration.name, "cloudkit_chat_conversation_owners");
  assert.deepEqual(chatConversationOwnerColumns, ["conversation_id", "source_device_hash", "created_at", "last_seen_at"]);
  assert.equal(cloudKitDeviceApprovalMigration.name, "cloudkit_device_key_approvals");
  assert.ok(cloudKitDeviceKeyColumns.includes("approved_at"));
  assert.ok(cloudKitDeviceKeyColumns.includes("approval_actor"));
  assert.equal(cloudKitRelayLeaseMigration.name, "cloudkit_chat_relay_lease");
  assert.deepEqual(cloudKitRelayLeaseColumns, ["lease_name", "lease_id", "holder_pid", "acquired_at", "expires_at", "fencing_token"]);
  assert.equal(cloudKitRelayFencingMigration.name, "cloudkit_chat_relay_fencing");
  assert.equal(cloudKitResponseReceiptsMigration.name, "cloudkit_chat_response_receipts");
  assert.equal(cloudKitRemoteCleanupMigration.name, "cloudkit_chat_remote_cleanup");
  assert.equal(cloudKitTrustedMacMigration.name, "cloudkit_chat_trusted_mac");
  assert.deepEqual(cloudKitRemoteCleanupColumns, [
    "request_id",
    "status",
    "attempt_count",
    "next_attempt_at",
    "created_at",
    "completed_at",
    "last_error",
  ]);
  assert.equal(cloudKitResponseDeliveryMigration.name, "cloudkit_chat_response_delivery");
  assert.ok(cloudKitChatJobColumns.includes("response_exported_updated_at"));
  assert.ok(cloudKitChatJobColumns.includes("response_exported_at"));
  assert.ok(cloudKitChatJobColumns.includes("response_exported_content_hash"));
  assert.ok(cloudKitChatJobColumns.includes("response_consumed_at"));
  assert.ok(cloudKitChatJobColumns.includes("trusted_mac_fingerprint"));
  assert.equal(cloudKitDeviceSequencesMigration.name, "cloudkit_chat_device_sequences");
  assert.deepEqual(cloudKitDeviceSequenceColumns, ["source_device_hash", "client_sequence", "request_id", "created_at"]);
  assert.equal(legacyBinding.baseUrl, null);
});

test("migration 34 backfills consumed CloudKit chat jobs into durable remote cleanup", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "ownorbit-migration-34-"));
  const databasePath = path.join(dataDir, "migration-34.db");
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      CREATE TABLE cloudkit_chat_jobs (
        request_id TEXT PRIMARY KEY,
        response_consumed_at INTEGER
      );
      INSERT INTO cloudkit_chat_jobs (request_id, response_consumed_at)
      VALUES ('consumed-request', 1700000000123), ('pending-request', NULL);
    `);
    db.exec(readFileSync(path.join(rootDir, "server", "migrations", "034_cloudkit_chat_remote_cleanup.sql"), "utf8"));
    const cleanupRows = db.prepare(`
      SELECT request_id as requestId, status, next_attempt_at as nextAttemptAt, created_at as createdAt
      FROM cloudkit_chat_remote_cleanup
      ORDER BY request_id
    `).all();
    assert.equal(cleanupRows.length, 1);
    assert.equal(cleanupRows[0].requestId, "consumed-request");
    assert.equal(cleanupRows[0].status, "queued");
    assert.equal(cleanupRows[0].nextAttemptAt, 1700000000123);
    assert.equal(cleanupRows[0].createdAt, 1700000000123);
  } finally {
    db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
