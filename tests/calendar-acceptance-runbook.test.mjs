import assert from "node:assert/strict";
import test from "node:test";
import { runCalendarAcceptance } from "../scripts/calendar-acceptance-runbook.mjs";

const configuredEnv = {
  LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR: "1",
  LIFEOS_GOOGLE_CALENDAR_CLIENT_ID: "client-id",
  LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret-secret",
  LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh-token-secret",
};

function googleFetchMock(calls) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { access_token: "access-token-secret" };
        },
      };
    }
    assert.match(JSON.stringify(init.headers), /Bearer access-token-secret/);
    if (target.includes("/calendar/v3/calendars/primary/events") && init.method === "POST") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: "created-google-event-secret" };
        },
      };
    }
    if (target.includes("/calendar/v3/calendars/primary/events/created-google-event-secret") && init.method === "DELETE") {
      return { ok: true, status: 204, async json() { return {}; } };
    }
    if (target.includes("/calendar/v3/calendars/primary/events")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { items: [{ id: "event-1", summary: "Planning" }] };
        },
      };
    }
    if (target.includes("/tasks/v1/lists/%40default/tasks") && init.method === "POST") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: "created-google-task-secret" };
        },
      };
    }
    if (target.includes("/tasks/v1/lists/%40default/tasks/created-google-task-secret") && init.method === "PATCH") {
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: "created-google-task-secret", status: "completed" };
        },
      };
    }
    if (target.includes("/tasks/v1/lists/%40default/tasks/created-google-task-secret") && init.method === "DELETE") {
      return { ok: true, status: 204, async json() { return {}; } };
    }
    if (target.includes("/tasks/v1/lists/%40default/tasks")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { items: [{ id: "task-1", title: "Follow up" }] };
        },
      };
    }
    throw new Error(`Unexpected URL ${target}`);
  };
}

test("Google Calendar/Tasks acceptance reports missing config without leaking secrets", async () => {
  const report = await runCalendarAcceptance({ env: {}, fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.equal(report.ok, false);
  assert.equal(report.status, "missing-config");
  assert.ok(report.missingConfig.includes("LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR"));
  assert.ok(report.missingConfig.includes("LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN"));
  assert.doesNotMatch(JSON.stringify(report), /refresh-token|access-token|client-secret/);
});

test("Google Calendar/Tasks acceptance records read evidence without write side effects", async () => {
  const calls = [];
  const report = await runCalendarAcceptance({
    env: configuredEnv,
    fetchImpl: googleFetchMock(calls),
  });
  assert.equal(report.ok, true);
  assert.equal(report.status, "read-evidence-ready");
  assert.equal(report.writeEvidenceReady, false);
  assert.equal(report.steps.some((step) => step.id === "calendar-read" && step.ok && step.count === 1), true);
  assert.equal(report.steps.some((step) => step.id === "tasks-read" && step.ok && step.count === 1), true);
  assert.equal(calls.some((call) => call.init.method === "POST" && String(call.url).includes("/calendar/v3/")), false);
  assert.match(report.recommendations.join("\n"), /Run again with --write/);
  assert.doesNotMatch(JSON.stringify(report), /refresh-token-secret|access-token-secret|client-secret-secret/);
});

test("Google Calendar/Tasks acceptance blocks write evidence without explicit gates", async () => {
  const report = await runCalendarAcceptance({
    env: configuredEnv,
    write: true,
    fetchImpl: async () => { throw new Error("should not fetch"); },
  });
  assert.equal(report.ok, false);
  assert.equal(report.status, "write-gate-missing");
  assert.deepEqual(report.missingWriteGates, ["LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES", "LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION"]);
});

test("Google Calendar/Tasks acceptance can create, complete, and clean disposable write evidence", async () => {
  const calls = [];
  const report = await runCalendarAcceptance({
    env: {
      ...configuredEnv,
      LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES: "1",
      LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION: "WRITE TO EXTERNAL CALENDAR",
    },
    write: true,
    fetchImpl: googleFetchMock(calls),
  });
  assert.equal(report.ok, true);
  assert.equal(report.status, "read-write-evidence-ready");
  assert.equal(report.writeEvidenceReady, true);
  for (const id of ["calendar-create", "calendar-delete", "tasks-create", "tasks-complete", "tasks-delete"]) {
    assert.equal(report.steps.some((step) => step.id === id && step.ok), true, `${id} should pass`);
  }
  assert.equal(calls.some((call) => call.init.method === "DELETE" && String(call.url).includes("created-google-event-secret")), true);
  assert.equal(calls.some((call) => call.init.method === "DELETE" && String(call.url).includes("created-google-task-secret")), true);
  assert.match(JSON.stringify(report), /sha256:/);
  assert.doesNotMatch(JSON.stringify(report), /created-google-event-secret|created-google-task-secret|refresh-token-secret|access-token-secret/);
});

test("macOS Calendar/Reminders acceptance reports missing config", async () => {
  const report = await runCalendarAcceptance({
    provider: "macos",
    env: {},
  });
  assert.equal(report.ok, false);
  assert.equal(report.connector, "macos-calendar-and-reminders");
  assert.equal(report.status, "missing-config");
  assert.ok(report.missingConfig.includes("LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR"));
});

test("macOS Calendar/Reminders acceptance blocks writes without explicit gates", async () => {
  const report = await runCalendarAcceptance({
    provider: "macos",
    env: {
      LIFEOS_MACOS_CALENDAR_CONNECTOR_MOCK: "1",
      LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR: "1",
    },
    write: true,
  });
  assert.equal(report.ok, false);
  assert.equal(report.status, "write-gate-missing");
  assert.deepEqual(report.missingWriteGates, ["LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES", "LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION"]);
});

test("macOS Calendar/Reminders acceptance can create, complete, and clean disposable write evidence", async () => {
  const report = await runCalendarAcceptance({
    provider: "macos",
    env: {
      LIFEOS_MACOS_CALENDAR_CONNECTOR_MOCK: "1",
      LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR: "1",
      LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES: "1",
      LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION: "WRITE TO EXTERNAL CALENDAR",
      LIFEOS_MACOS_ACCEPTANCE_CALENDAR_NAME: "Personal calendar secret@example.com",
      LIFEOS_MACOS_ACCEPTANCE_REMINDER_LIST_NAME: "Private reminders secret@example.com",
    },
    write: true,
  });
  assert.equal(report.ok, true);
  assert.equal(report.connector, "macos-calendar-and-reminders");
  assert.equal(report.status, "read-write-evidence-ready");
  assert.equal(report.writeEvidenceReady, true);
  assert.equal(report.steps.some((step) => step.id === "macos-read-preview" && step.ok), true);
  for (const id of ["apple-calendar-create", "apple-calendar-delete", "reminders-create", "reminders-complete", "reminders-delete"]) {
    assert.equal(report.steps.some((step) => step.id === id && step.ok), true, `${id} should pass`);
  }
  assert.match(JSON.stringify(report), /sha256:/);
  assert.doesNotMatch(JSON.stringify(report), /secret@example\.com|Personal calendar secret|Private reminders secret/);
});
