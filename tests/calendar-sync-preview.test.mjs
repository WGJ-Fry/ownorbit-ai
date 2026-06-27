import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function withCalendarPreview(testName, files, run, env = {}) {
  const root = await mkdtemp(path.join(tmpdir(), `lifeos-calendar-preview-${testName}-`));
  const calendarDir = path.join(root, "calendar");
  const previousVaultDir = process.env.LIFEOS_VAULT_DIR;
  const previousCalendarDir = process.env.LIFEOS_CALENDAR_ICS_DIR;
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  process.env.LIFEOS_VAULT_DIR = root;
  process.env.LIFEOS_CALENDAR_ICS_DIR = calendarDir;
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(calendarDir, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }
    const module = await import(`../server/calendarSyncPreview.ts?case=${testName}-${Date.now()}`);
    await run(module, root);
  } finally {
    if (previousVaultDir === undefined) delete process.env.LIFEOS_VAULT_DIR;
    else process.env.LIFEOS_VAULT_DIR = previousVaultDir;
    if (previousCalendarDir === undefined) delete process.env.LIFEOS_CALENDAR_ICS_DIR;
    else process.env.LIFEOS_CALENDAR_ICS_DIR = previousCalendarDir;
    for (const key of Object.keys(env)) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("calendar sync preview imports local ICS items as read-only operations", async () => {
  await withCalendarPreview("readonly", {
    "personal.ics": [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "DTSTART:20260701T090000Z",
      "SUMMARY:Strategy review",
      "END:VEVENT",
      "BEGIN:VTODO",
      "DUE:20260702T120000Z",
      "SUMMARY:Renew contract",
      "STATUS:NEEDS-ACTION",
      "END:VTODO",
      "BEGIN:VTODO",
      "DUE:20260702T120000Z",
      "SUMMARY:Completed task should stay out",
      "STATUS:COMPLETED",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\n"),
  }, async ({ buildCalendarSyncPreview }, root) => {
    const preview = buildCalendarSyncPreview();
    assert.equal(preview.mode, "preview-only");
    assert.equal(preview.externalWritesEnabled, false);
    assert.equal(preview.writeBackSupported, false);
    assert.equal(preview.summary.readOnlyItems, 2);
    assert.equal(preview.summary.externalReadItems, 0);
    assert.equal(preview.summary.externalReadErrors, 0);
    assert.equal(preview.summary.syncConflicts, 0);
    assert.equal(preview.syncPlan.pullExternal, 0);
    assert.equal(preview.syncPlan.pushLocal, 0);
    assert.equal(preview.syncPlan.reviewConflicts, 0);
    assert.equal(preview.syncPlan.canProceedAfterConsent, false);
    assert.equal(preview.summary.providersReadyForRead, 1);
    assert.equal(preview.summary.providersReadyForWrite, 0);
    assert.equal(preview.providers.find((provider) => provider.id === "ics-local")?.status, "ready-readonly");
    assert.equal(preview.providers.find((provider) => provider.id === "apple-calendar")?.writeSupported, false);
    assert.equal(preview.operations.every((operation) => operation.writesExternalSystem === false), true);
    assert.equal(preview.operations.filter((operation) => operation.action === "read-only-import").length, 2);
    assert.match(JSON.stringify(preview), /Strategy review/);
    assert.match(JSON.stringify(preview), /Renew contract/);
    assert.doesNotMatch(JSON.stringify(preview), /Completed task should stay out/);
    assert.doesNotMatch(JSON.stringify(preview), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("macOS connector can read external calendar and reminder previews without enabling writes", async () => {
  await withCalendarPreview("macos-read-preview", {}, async ({ buildCalendarSyncPreview }) => {
    const preview = buildCalendarSyncPreview();
    assert.equal(preview.mode, "preview-only");
    assert.equal(preview.externalWritesEnabled, false);
    assert.equal(preview.writeBackSupported, false);
    assert.equal(preview.summary.externalReadItems, 2);
    assert.equal(preview.summary.externalReadErrors, 0);
    assert.equal(preview.syncPlan.pullExternal, 2);
    assert.equal(preview.syncPlan.pushLocal, 0);
    assert.equal(preview.syncPlan.reviewConflicts, 0);
    assert.equal(preview.syncPlan.items.every((item) => item.direction === "pull-external"), true);
    assert.equal(preview.summary.providersReadyForRead, 2);
    assert.equal(preview.summary.providersReadyForWrite, 0);
    assert.equal(preview.operations.filter((operation) => operation.action === "read-only-import").length, 2);
    assert.equal(preview.operations.every((operation) => operation.writesExternalSystem === false), true);
    assert.equal(preview.operations.some((operation) => operation.providerId === "apple-calendar" && operation.source.startsWith("macos:apple-calendar:")), true);
    assert.equal(preview.operations.some((operation) => operation.providerId === "system-reminders" && operation.source.startsWith("macos:system-reminders:")), true);
  }, {
    LIFEOS_MACOS_CALENDAR_CONNECTOR_MOCK: "1",
    LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR: "1",
  });
});

test("calendar sync preview blocks proposed external writes until connectors are shipped", async () => {
  await withCalendarPreview("blocked-writes", {}, async ({ buildCalendarSyncPreview }) => {
    const preview = buildCalendarSyncPreview({
      proposedItems: [
        {
          providerId: "google-calendar",
          kind: "event",
          action: "create",
          title: "Client follow-up",
          startsAt: "2026-07-03T09:00:00.000Z",
          source: "studio-generated-plan",
        },
        {
          providerId: "system-reminders",
          kind: "task",
          action: "complete",
          title: "Pay invoice",
          dueAt: "2026-07-04T12:00:00.000Z",
        },
      ],
    });
    assert.equal(preview.summary.blockedWrites, 2);
    assert.equal(preview.syncPlan.blocked, 2);
    assert.equal(preview.syncPlan.reviewConflicts, 0);
    assert.equal(preview.syncPlan.canProceedAfterConsent, false);
    assert.equal(preview.operations.filter((operation) => operation.status === "blocked").length, 2);
    assert.equal(preview.operations.some((operation) => operation.providerId === "google-calendar" && operation.action === "create"), true);
    assert.equal(preview.operations.some((operation) => operation.providerId === "system-reminders" && operation.risk === "high"), true);
    assert.equal(preview.safety.requiresExplicitConsentBeforeWrite, true);
    assert.equal(preview.safety.requiresAuditLogBeforeWrite, true);
    assert.match(preview.recommendations.join("\n"), /Do not advertise full two-way calendar\/task sync/);
  });
});

test("macOS calendar connector requires opt-in and explicit confirmation before writes", async () => {
  await withCalendarPreview("macos-connector", {}, async ({ buildCalendarSyncPreview, executeCalendarSyncOperation }) => {
    const preview = buildCalendarSyncPreview({
      proposedItems: [
        {
          providerId: "apple-calendar",
          kind: "event",
          action: "create",
          title: "Doctor appointment",
          startsAt: "2026-07-05T09:00:00.000Z",
        },
        {
          providerId: "system-reminders",
          kind: "task",
          action: "create",
          title: "Submit reimbursement",
          dueAt: "2026-07-06T12:00:00.000Z",
        },
      ],
    });
    assert.equal(preview.mode, "connector-ready");
    assert.equal(preview.externalWritesEnabled, true);
    assert.equal(preview.writeBackSupported, true);
    assert.equal(preview.summary.providersReadyForWrite, 2);
    assert.equal(preview.providers.find((provider) => provider.id === "apple-calendar")?.status, "ready-write-gated");
    assert.equal(preview.operations.filter((operation) => operation.status === "needs-review").length, 2);
    assert.equal(preview.operations.some((operation) => operation.writesExternalSystem === true), true);

    assert.throws(() => executeCalendarSyncOperation({
      providerId: "apple-calendar",
      kind: "event",
      action: "create",
      title: "Doctor appointment",
      startsAt: "2026-07-05T09:00:00.000Z",
      explicitConsent: true,
      confirmationText: "wrong confirmation",
    }), /Explicit confirmation is required/);

    assert.throws(() => executeCalendarSyncOperation({
      providerId: "apple-calendar",
      kind: "event",
      action: "update",
      title: "Doctor appointment moved",
      startsAt: "2026-07-05T10:00:00.000Z",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    }), /externalId is required/);

    assert.throws(() => executeCalendarSyncOperation({
      providerId: "apple-calendar",
      kind: "event",
      action: "complete",
      title: "Doctor appointment",
      externalId: "mock-apple-event-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    }), /cannot use the complete action/);

    const result = executeCalendarSyncOperation({
      providerId: "apple-calendar",
      kind: "event",
      action: "create",
      title: "Doctor appointment",
      startsAt: "2026-07-05T09:00:00.000Z",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
      source: "admin-test",
    });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, false);
    assert.equal(result.auditSummary.connector, "macos-automation");
    assert.match(result.externalId, /^mock-apple-calendar-create-/);
    assert.equal(result.rollbackPlan.available, true);
    assert.equal(result.rollbackPlan.requiresManualReview, false);
    assert.match(result.rollbackPlan.hint, /delete Apple Calendar item/);

    const updateResult = executeCalendarSyncOperation({
      providerId: "apple-calendar",
      kind: "event",
      action: "update",
      title: "Doctor appointment moved",
      startsAt: "2026-07-05T10:00:00.000Z",
      externalId: "mock-apple-event-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
      source: "admin-test",
    });
    assert.equal(updateResult.ok, true);
    assert.equal(updateResult.action, "update");
    assert.match(updateResult.externalId, /^mock-apple-calendar-update-/);
    assert.equal(updateResult.rollbackPlan.available, true);
    assert.equal(updateResult.rollbackPlan.requiresManualReview, true);
    assert.match(updateResult.rollbackPlan.hint, /captured previous state/);
    assert.equal(updateResult.rollbackPlan.previousState.title, "Previous Doctor appointment moved");

    const deleteResult = executeCalendarSyncOperation({
      providerId: "system-reminders",
      kind: "task",
      action: "delete",
      title: "Submit reimbursement",
      externalId: "mock-reminder-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
      source: "admin-test",
    });
    assert.equal(deleteResult.ok, true);
    assert.equal(deleteResult.action, "delete");
    assert.match(deleteResult.externalId, /^mock-system-reminders-delete-/);
    assert.equal(deleteResult.rollbackPlan.available, true);
    assert.equal(deleteResult.rollbackPlan.requiresManualReview, true);
    assert.match(deleteResult.rollbackPlan.hint, /cannot be undone automatically/);
    assert.equal(deleteResult.rollbackPlan.previousState.title, "Previous Submit reimbursement");
  }, {
    LIFEOS_MACOS_CALENDAR_CONNECTOR_MOCK: "1",
    LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR: "1",
    LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES: "1",
  });
});

test("Google Calendar connector reads events through OAuth without enabling writes", async () => {
  await withCalendarPreview("google-oauth-read-preview", {}, async ({ buildCalendarSyncPreviewAsync }) => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "google-access-token-for-test" };
          },
        };
      }
      assert.match(JSON.stringify(init.headers), /Bearer google-access-token-for-test/);
      if (String(url).includes("tasks.googleapis.com/tasks/v1")) {
        assert.match(String(url), /tasks\/v1\/lists\/%40default\/tasks/);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              items: [
                {
                  id: "google-task-1",
                  title: "Google task follow-up",
                  due: "2026-07-10T12:00:00.000Z",
                  status: "needsAction",
                },
              ],
            };
          },
        };
      }
      assert.match(String(url), /googleapis\.com\/calendar\/v3\/calendars\/primary\/events/);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            items: [
              {
                id: "google-event-1",
                summary: "Google strategy review",
                start: { dateTime: "2026-07-10T09:00:00.000Z" },
              },
            ],
          };
        },
      };
    };
    const preview = await buildCalendarSyncPreviewAsync({}, { fetchImpl });
    assert.equal(preview.mode, "preview-only");
    assert.equal(preview.externalWritesEnabled, false);
    assert.equal(preview.writeBackSupported, false);
    assert.equal(preview.summary.externalReadItems, 2);
    assert.equal(preview.providers.find((provider) => provider.id === "google-calendar")?.readSupported, true);
    assert.equal(preview.providers.find((provider) => provider.id === "google-calendar")?.writeSupported, false);
    assert.equal(preview.operations.some((operation) => operation.providerId === "google-calendar" && operation.title === "Google strategy review"), true);
    assert.equal(preview.operations.some((operation) => operation.providerId === "google-calendar" && operation.kind === "task" && operation.title === "Google task follow-up"), true);
    assert.equal(calls.length, 4);
  }, {
    LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR: "1",
    LIFEOS_GOOGLE_CALENDAR_CLIENT_ID: "client-id",
    LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
    LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh-token",
  });
});

test("Google Calendar and Tasks connector supports consented event and task writes", async () => {
  await withCalendarPreview("google-write-preview", {}, async ({ buildCalendarSyncPreviewAsync, executeCalendarSyncOperationAsync }) => {
    const preview = await buildCalendarSyncPreviewAsync({
      proposedItems: [
        {
          providerId: "google-calendar",
          kind: "event",
          action: "create",
          title: "Launch planning",
          startsAt: "2026-07-11T09:00:00.000Z",
        },
        {
          providerId: "google-calendar",
          kind: "task",
          action: "complete",
          title: "Google task",
          dueAt: "2026-07-11T12:00:00.000Z",
          externalId: "mock-google-task-1",
        },
        {
          providerId: "google-calendar",
          kind: "event",
          action: "create",
          title: "Mock Google Calendar planning review",
          startsAt: "2026-07-09T09:00:00.000Z",
        },
      ],
    });
    assert.equal(preview.mode, "connector-ready");
    assert.equal(preview.externalWritesEnabled, true);
    assert.equal(preview.writeBackSupported, true);
    assert.equal(preview.providers.find((provider) => provider.id === "google-calendar")?.writeSupported, true);
    assert.equal(preview.operations.some((operation) => operation.providerId === "google-calendar" && operation.action === "create" && operation.status === "needs-review"), true);
    assert.equal(preview.operations.some((operation) => operation.providerId === "google-calendar" && operation.kind === "task" && operation.status === "needs-review"), true);
    assert.equal(preview.summary.syncConflicts, 1);
    assert.equal(preview.syncPlan.pushLocal, 2);
    assert.equal(preview.syncPlan.reviewConflicts, 1);
    assert.equal(preview.syncPlan.blocked, 0);
    assert.equal(preview.syncPlan.canProceedAfterConsent, false);
    assert.equal(preview.syncPlan.items.some((item) => item.direction === "review-conflict" && item.externalSource === "google-calendar:mock-google-event-1"), true);
    assert.equal(preview.syncPlan.items.some((item) => item.direction === "push-local" && item.externalSource === "google-tasks:mock-google-task-1"), true);

    await assert.rejects(() => executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "event",
      action: "create",
      title: "Launch planning",
      startsAt: "2026-07-11T09:00:00.000Z",
      explicitConsent: true,
      confirmationText: "wrong confirmation",
    }), /Explicit confirmation is required/);

    await assert.rejects(() => executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "event",
      action: "complete",
      title: "Unsupported Google event completion",
      externalId: "google-task-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    }), /Google Calendar events cannot use the complete action/);

    const createResult = await executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "event",
      action: "create",
      title: "Launch planning",
      startsAt: "2026-07-11T09:00:00.000Z",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    });
    assert.equal(createResult.ok, true);
    assert.equal(createResult.auditSummary.connector, "google-calendar-api");
    assert.match(createResult.externalId, /^mock-google-calendar-create-/);
    assert.equal(createResult.rollbackPlan.available, true);
    assert.match(createResult.rollbackPlan.hint, /delete Google Calendar item/);

    const updateResult = await executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "event",
      action: "update",
      title: "Launch planning moved",
      startsAt: "2026-07-11T10:00:00.000Z",
      externalId: "mock-google-event-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    });
    assert.equal(updateResult.ok, true);
    assert.equal(updateResult.action, "update");
    assert.equal(updateResult.rollbackPlan.available, true);
    assert.equal(updateResult.rollbackPlan.previousState.title, "Previous Launch planning moved");

    const taskCompleteResult = await executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "task",
      action: "complete",
      title: "Google task",
      externalId: "mock-google-task-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    });
    assert.equal(taskCompleteResult.ok, true);
    assert.equal(taskCompleteResult.kind, "task");
    assert.equal(taskCompleteResult.action, "complete");
    assert.equal(taskCompleteResult.auditSummary.connector, "google-tasks-api");
    assert.match(taskCompleteResult.externalId, /^mock-google-task-complete-/);
    assert.equal(taskCompleteResult.rollbackPlan.available, true);
    assert.equal(taskCompleteResult.rollbackPlan.requiresManualReview, false);
    assert.equal(taskCompleteResult.rollbackPlan.previousState.title, "Previous Google task");
    assert.match(taskCompleteResult.rollbackPlan.hint, /guarded update|completion status/);
  }, {
    LIFEOS_GOOGLE_CALENDAR_CONNECTOR_MOCK: "1",
    LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR: "1",
    LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES: "1",
  });
});

test("Google Tasks connector can reopen a completed task through guarded update", async () => {
  await withCalendarPreview("google-task-reopen-write", {}, async ({ executeCalendarSyncOperationAsync }) => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "google-access-token-for-test" };
          },
        };
      }
      assert.match(JSON.stringify(init.headers), /Bearer google-access-token-for-test/);
      if (String(url).includes("/tasks/v1/lists/%40default/tasks/google-task-1") && !init.method) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: "google-task-1",
              title: "Old task",
              notes: "Old notes",
              due: "2026-07-11T12:00:00.000Z",
              status: "completed",
            };
          },
        };
      }
      if (String(url).includes("/tasks/v1/lists/%40default/tasks/google-task-1") && init.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        assert.equal(body.status, "needsAction");
        assert.equal(body.completed, undefined);
        assert.equal(body.title, "Old task");
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: "google-task-1", title: body.title, status: "needsAction" };
          },
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const result = await executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "task",
      action: "update",
      title: "Old task",
      dueAt: "2026-07-11T12:00:00.000Z",
      notes: "Old notes",
      completed: false,
      externalId: "google-task-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    }, { fetchImpl });

    assert.equal(result.ok, true);
    assert.equal(result.action, "update");
    assert.equal(result.kind, "task");
    assert.equal(result.auditSummary.connector, "google-tasks-api");
    assert.equal(calls.filter((call) => String(call.url).includes("oauth2.googleapis.com/token")).length, 2);
    assert.equal(calls.some((call) => call.init.method === "PATCH"), true);
  }, {
    LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR: "1",
    LIFEOS_GOOGLE_CALENDAR_CLIENT_ID: "client-id",
    LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
    LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh-token",
    LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES: "1",
  });
});

test("calendar sync history persists guarded writes and automatic rollback evidence", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-calendar-history-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const script = `
    import assert from "node:assert/strict";
    process.env.LIFEOS_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.LIFEOS_GOOGLE_CALENDAR_CONNECTOR_MOCK = "1";
    process.env.LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR = "1";
    process.env.LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES = "1";

    const { runMigrations } = await import("./server/migrations.ts");
    runMigrations();
    const { executeCalendarSyncOperationAsync } = await import("./server/calendarSyncPreview.ts");
    const { saveCalendarSyncOperation, listCalendarSyncOperations, rollbackCalendarSyncOperation } = await import("./server/calendarSyncHistory.ts");

    const result = await executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "event",
      action: "create",
      title: "History rollback event",
      startsAt: "2026-07-12T09:00:00.000Z",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
      source: "history-test",
    });
    const record = saveCalendarSyncOperation({ source: "history-test" }, result);
    assert.equal(record.status, "executed");
    assert.equal(record.rollback.canAutoRollback, true);
    assert.equal(record.rollback.available, true);
    assert.equal(listCalendarSyncOperations()[0].id, record.id);

    await assert.rejects(() => rollbackCalendarSyncOperation(record.id, {
      explicitConsent: true,
      confirmationText: "wrong",
    }), /Explicit confirmation is required/);

    const rollback = await rollbackCalendarSyncOperation(record.id, {
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    });
    assert.equal(rollback.record.status, "rolled_back");
    assert.equal(rollback.record.rollback.canAutoRollback, false);
    assert.equal(rollback.result.action, "delete");
    assert.equal(rollback.result.auditSummary.connector, "google-calendar-api");
    assert.equal(listCalendarSyncOperations()[0].rolledBackAt > 0, true);

    const completeResult = await executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "task",
      action: "complete",
      title: "History task complete",
      externalId: "mock-google-task-1",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
      source: "history-test",
    });
    const completeRecord = saveCalendarSyncOperation({ source: "history-test" }, completeResult);
    assert.equal(completeRecord.rollback.canAutoRollback, true);
    assert.equal(completeRecord.rollback.requiresManualReview, false);

    const completeRollback = await rollbackCalendarSyncOperation(completeRecord.id, {
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    });
    assert.equal(completeRollback.record.status, "rolled_back");
    assert.equal(completeRollback.result.action, "update");
    assert.equal(completeRollback.result.kind, "task");
    assert.equal(completeRollback.result.auditSummary.connector, "google-tasks-api");
  `;

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, output);
});

test("calendar sync run evidence persists conflicts and next steps without leaking local paths", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-calendar-runs-"));
  const calendarDir = path.join(dataDir, "calendar");
  await mkdir(calendarDir, { recursive: true });
  await writeFile(path.join(calendarDir, "private.ics"), [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "DTSTART:20260713T090000Z",
    "SUMMARY:Private planning",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const script = `
    import assert from "node:assert/strict";
    process.env.LIFEOS_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.LIFEOS_VAULT_DIR = ${JSON.stringify(dataDir)};
    process.env.LIFEOS_CALENDAR_ICS_DIR = ${JSON.stringify(calendarDir)};
    process.env.LIFEOS_GOOGLE_CALENDAR_CONNECTOR_MOCK = "1";
    process.env.LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR = "1";
    process.env.LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES = "1";

    const { runMigrations } = await import("./server/migrations.ts");
    runMigrations();
    const { buildCalendarSyncPreviewAsync } = await import("./server/calendarSyncPreview.ts");
    const { createCalendarSyncRun, listCalendarSyncRuns } = await import("./server/calendarSyncRuns.ts");

    const preview = await buildCalendarSyncPreviewAsync({
      proposedItems: [
        {
          providerId: "google-calendar",
          kind: "event",
          action: "create",
          title: "Mock Google Calendar planning review",
          startsAt: "2026-07-09T09:00:00.000Z",
          source: "/Users/secret/calendar-source",
        },
      ],
    });
    assert.equal(preview.summary.syncConflicts, 1);
    const record = createCalendarSyncRun({
      preview,
      recentHistory: [],
      createdByType: "admin",
      createdById: "admin-session",
    });
    assert.equal(record.status, "needs-review");
    assert.equal(record.provider, "mixed");
    assert.equal(record.summary.plan.reviewConflicts, 1);
    assert.equal(record.summary.twoWayEvidence.acceptanceReady, false);
    assert.deepEqual(record.summary.twoWayEvidence.missing, ["external-write-history", "rollback-evidence", "conflict-review-clear"]);
    assert.equal(record.conflicts.some((conflict) => conflict.kind === "duplicate"), true);
    assert.equal(record.nextSteps.some((step) => step.includes("duplicate") || step.includes("Review")), true);
    assert.equal(record.nextSteps.some((step) => step.includes("Two-way acceptance evidence is incomplete")), true);
    assert.equal(JSON.stringify(record).includes("/Users/secret"), false);

    const saved = listCalendarSyncRuns();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, record.id);
    assert.equal(saved[0].conflicts[0].title, "Mock Google Calendar planning review");
    assert.equal(JSON.stringify(saved[0]).includes(${JSON.stringify(dataDir)}), false);
  `;

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, output);
});

test("calendar sync acceptance run completes only with read, write, rollback, connector, and conflict evidence", async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-calendar-acceptance-run-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const script = `
    import assert from "node:assert/strict";
    process.env.LIFEOS_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.LIFEOS_GOOGLE_CALENDAR_CONNECTOR_MOCK = "1";
    process.env.LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR = "1";
    process.env.LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES = "1";

    const { runMigrations } = await import("./server/migrations.ts");
    runMigrations();
    const { buildCalendarSyncPreviewAsync, executeCalendarSyncOperationAsync } = await import("./server/calendarSyncPreview.ts");
    const { saveCalendarSyncOperation, rollbackCalendarSyncOperation, listCalendarSyncOperations } = await import("./server/calendarSyncHistory.ts");
    const { createCalendarSyncRun, listCalendarSyncRuns } = await import("./server/calendarSyncRuns.ts");

    const readOnlyPreview = await buildCalendarSyncPreviewAsync();
    const missingEvidenceRun = createCalendarSyncRun({
      preview: readOnlyPreview,
      recentHistory: [],
      mode: "acceptance",
      createdByType: "admin",
      createdById: "acceptance-test",
    });
    assert.equal(missingEvidenceRun.status, "ready");
    assert.equal(missingEvidenceRun.summary.twoWayEvidence.externalReadVerified, true);
    assert.equal(missingEvidenceRun.summary.twoWayEvidence.externalWriteVerified, false);
    assert.equal(missingEvidenceRun.summary.twoWayEvidence.rollbackEvidenceReady, false);
    assert.equal(missingEvidenceRun.summary.twoWayEvidence.connectorReadWriteReady, true);
    assert.equal(missingEvidenceRun.summary.twoWayEvidence.acceptanceReady, false);

    const writeResult = await executeCalendarSyncOperationAsync({
      providerId: "google-calendar",
      kind: "event",
      action: "create",
      title: "Two-way acceptance proof",
      startsAt: "2026-07-14T09:00:00.000Z",
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
      source: "acceptance-test",
    });
    const historyRecord = saveCalendarSyncOperation({ source: "acceptance-test" }, writeResult);
    await rollbackCalendarSyncOperation(historyRecord.id, {
      explicitConsent: true,
      confirmationText: "WRITE TO EXTERNAL CALENDAR",
    });

    const cleanPreview = await buildCalendarSyncPreviewAsync();
    const completeRun = createCalendarSyncRun({
      preview: cleanPreview,
      recentHistory: listCalendarSyncOperations(),
      mode: "acceptance",
      createdByType: "admin",
      createdById: "acceptance-test",
    });
    assert.equal(completeRun.status, "completed");
    assert.equal(completeRun.summary.twoWayEvidence.externalReadVerified, true);
    assert.equal(completeRun.summary.twoWayEvidence.externalWriteVerified, true);
    assert.equal(completeRun.summary.twoWayEvidence.rollbackEvidenceReady, true);
    assert.equal(completeRun.summary.twoWayEvidence.conflictReviewClear, true);
    assert.equal(completeRun.summary.twoWayEvidence.connectorReadWriteReady, true);
    assert.equal(completeRun.summary.twoWayEvidence.acceptanceReady, true);
    assert.deepEqual(completeRun.summary.twoWayEvidence.missing, []);

    const saved = listCalendarSyncRuns();
    assert.equal(saved[0].id, completeRun.id);
    assert.equal(saved[0].status, "completed");
    assert.equal(saved[0].summary.twoWayEvidence.acceptanceReady, true);
  `;

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, output);
});
