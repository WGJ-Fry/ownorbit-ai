import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_AUTOMATION_ALLOWLIST_ENV,
  NATIVE_AUTOMATION_CONFIRMATION_TEXT,
  NATIVE_AUTOMATION_ENABLE_ENV,
  NATIVE_AUTOMATION_FILE_ROOTS_ENV,
  NATIVE_AUTOMATION_MOCK_ENV,
  buildNativeAutomationPlan,
  executeNativeAutomation,
} from "../server/nativeAutomationBridge.ts";

test("native automation bridge is disabled by default and redacts sensitive fields", () => {
  const plan = buildNativeAutomationPlan({
    kind: "clipboard",
    title: "Copy user@example.test token=secret",
    target: "/Users/example/private.txt",
    payload: "github_pat_secret token=secret",
    source: "AI Agent Bearer abc123",
  }, { env: {}, platform: "darwin" });

  assert.equal(plan.status, "blocked");
  assert.equal(plan.canExecute, false);
  assert.equal(plan.safety.bridgeEnabled, false);
  assert.equal(plan.safety.sensitivePayloadBlocked, true);
  assert.ok(plan.blockedReasons.includes("native_bridge_disabled"));
  assert.ok(plan.blockedReasons.includes("action_not_in_allowlist"));
  assert.ok(plan.blockedReasons.includes("sensitive_payload_blocked"));
  assert.doesNotMatch(JSON.stringify(plan), /user@example|github_pat_secret|token=secret|\/Users\/example|Bearer abc123/);
});

test("native automation bridge executes only after enable flag, allowlist, and confirmation", async () => {
  const env = {
    [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
    [NATIVE_AUTOMATION_MOCK_ENV]: "1",
    [NATIVE_AUTOMATION_ALLOWLIST_ENV]: "clipboard:write-text",
  };
  const result = await executeNativeAutomation({
    kind: "clipboard",
    payload: "safe copied text",
    explicitConsent: true,
    confirmationText: NATIVE_AUTOMATION_CONFIRMATION_TEXT,
  }, { env, platform: "linux" });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.equal(result.plan.mode, "mock");
  assert.equal(result.plan.canExecute, true);
  assert.equal(result.auditSummary.connector, "native-automation-bridge");
  assert.equal(result.auditSummary.writesExternalSystem, true);
  assert.equal(result.commandResult?.stdout, "[mock]");
});

test("native automation bridge can run an allowlisted Shortcut through the command runner", async () => {
  const env = {
    [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
    [NATIVE_AUTOMATION_ALLOWLIST_ENV]: "shortcut:OwnOrbit Safe Shortcut",
  };
  const calls = [];
  const result = await executeNativeAutomation({
    kind: "shortcut",
    shortcutName: "OwnOrbit Safe Shortcut",
    explicitConsent: true,
    confirmationText: NATIVE_AUTOMATION_CONFIRMATION_TEXT,
  }, {
    env,
    platform: "darwin",
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.status, "ready");
  assert.deepEqual(calls[0].args, ["run", "OwnOrbit Safe Shortcut"]);
  assert.equal(calls[0].options.timeoutMs, 8000);
});

test("native automation bridge can reveal an allowlisted file target through the command runner", async () => {
  const env = {
    [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
    [NATIVE_AUTOMATION_ALLOWLIST_ENV]: "file:reveal",
    [NATIVE_AUTOMATION_FILE_ROOTS_ENV]: "/tmp/lifeos-safe-files",
  };
  const calls = [];
  const result = await executeNativeAutomation({
    kind: "file",
    target: "/tmp/lifeos-safe-files/report.md",
    explicitConsent: true,
    confirmationText: NATIVE_AUTOMATION_CONFIRMATION_TEXT,
  }, {
    env,
    platform: "darwin",
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: 0, stdout: "revealed", stderr: "", timedOut: false };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.actionId, "file:reveal");
  assert.equal(result.plan.safety.targetWithinAllowedRoots, true);
  assert.deepEqual(calls[0].args, ["-R", "/tmp/lifeos-safe-files/report.md"]);
  assert.doesNotMatch(JSON.stringify(result.plan), /\/tmp\/lifeos-safe-files\/report.md/);
});

test("native automation bridge can open an allowlisted app bundle id", async () => {
  const env = {
    [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
    [NATIVE_AUTOMATION_ALLOWLIST_ENV]: "app:com.apple.Maps",
  };
  const calls = [];
  const result = await executeNativeAutomation({
    kind: "app",
    target: "com.apple.Maps",
    explicitConsent: true,
    confirmationText: NATIVE_AUTOMATION_CONFIRMATION_TEXT,
  }, {
    env,
    platform: "darwin",
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: 0, stdout: "opened", stderr: "", timedOut: false };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan.actionId, "app:com.apple.Maps");
  assert.equal(result.plan.risk, "medium");
  assert.deepEqual(calls[0].args, ["-b", "com.apple.Maps"]);
});

test("native automation bridge refuses malformed app bundle ids", () => {
  const plan = buildNativeAutomationPlan({
    kind: "app",
    target: "com.apple.Maps;rm -rf /",
    explicitConsent: true,
    confirmationText: NATIVE_AUTOMATION_CONFIRMATION_TEXT,
  }, {
    env: {
      [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
      [NATIVE_AUTOMATION_ALLOWLIST_ENV]: "app:com.apple.Maps",
    },
    platform: "darwin",
  });

  assert.equal(plan.canExecute, false);
  assert.ok(plan.blockedReasons.includes("action_not_in_allowlist"));
  assert.ok(plan.blockedReasons.includes("app_bundle_id_required"));
  assert.equal(plan.writesExternalSystem, false);
});

test("native automation bridge refuses file targets outside allowed roots", () => {
  const plan = buildNativeAutomationPlan({
    kind: "file",
    target: "/tmp/private/report.md",
    explicitConsent: true,
    confirmationText: NATIVE_AUTOMATION_CONFIRMATION_TEXT,
  }, {
    env: {
      [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
      [NATIVE_AUTOMATION_ALLOWLIST_ENV]: "file:reveal",
      [NATIVE_AUTOMATION_FILE_ROOTS_ENV]: "/tmp/lifeos-safe-files",
    },
    platform: "darwin",
  });

  assert.equal(plan.canExecute, false);
  assert.ok(plan.blockedReasons.includes("file_target_not_in_allowed_roots"));
  assert.equal(plan.safety.targetWithinAllowedRoots, false);
});

test("native automation bridge refuses shell, calendar, and reminder writes even with consent", () => {
  for (const kind of ["shell", "calendar", "reminder"]) {
    const plan = buildNativeAutomationPlan({
      kind,
      target: "rm -rf /Users/example",
      explicitConsent: true,
      confirmationText: NATIVE_AUTOMATION_CONFIRMATION_TEXT,
    }, {
      env: {
        [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
        [NATIVE_AUTOMATION_ALLOWLIST_ENV]: `${kind}:blocked`,
      },
      platform: "darwin",
    });

    assert.equal(plan.canExecute, false);
    assert.ok(plan.blockedReasons.includes("unsupported_native_action_kind"));
    assert.equal(plan.writesExternalSystem, false);
    assert.doesNotMatch(JSON.stringify(plan), /\/Users\/example/);
  }
});

test("native automation bridge requires the exact confirmation phrase", async () => {
  const env = {
    [NATIVE_AUTOMATION_ENABLE_ENV]: "1",
    [NATIVE_AUTOMATION_MOCK_ENV]: "1",
    [NATIVE_AUTOMATION_ALLOWLIST_ENV]: "clipboard:write-text",
  };
  const result = await executeNativeAutomation({
    kind: "clipboard",
    payload: "safe copied text",
    explicitConsent: true,
    confirmationText: "yes",
  }, { env, platform: "darwin" });

  assert.equal(result.ok, false);
  assert.equal(result.dryRun, true);
  assert.ok(result.plan.blockedReasons.includes("confirmation_text_required"));
});
