#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CONFIRMATION_TEXT = "WRITE TO EXTERNAL CALENDAR";
const DEFAULT_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const result = { out: "", json: false, write: false, provider: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") result.json = true;
    else if (value === "--write") result.write = true;
    else if (value === "--out") result.out = argv[++index] || "";
    else if (value === "--provider") result.provider = argv[++index] || "";
  }
  return result;
}

function compact(value, fallback = "") {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function redact(value) {
  return compact(value)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\/(?:Users|home|tmp|private\/tmp|var\/folders|Volumes)\/[^\s]+/g, "/[redacted-path]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(client_secret|refresh_token|access_token|token|secret|password)=\S+/gi, "$1=[redacted]");
}

function redactedId(value) {
  const raw = compact(value);
  if (!raw) return "";
  return `sha256:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
}

function requiredConfig(env) {
  return [
    "LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR",
    "LIFEOS_GOOGLE_CALENDAR_CLIENT_ID",
    "LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET",
    "LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN",
  ].filter((key) => key === "LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR" ? env[key] !== "1" : !env[key]);
}

function writeGateFailures(env, writeRequested) {
  if (!writeRequested) return [];
  const failures = [];
  if (env.LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES !== "1") failures.push("LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES");
  if (env.LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION !== CONFIRMATION_TEXT) failures.push("LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION");
  return failures;
}

function macosConfigFailures(env) {
  const failures = [];
  if (env.LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR !== "1") failures.push("LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR");
  if (process.platform !== "darwin" && env.LIFEOS_MACOS_CALENDAR_CONNECTOR_MOCK !== "1") failures.push("macOS platform or LIFEOS_MACOS_CALENDAR_CONNECTOR_MOCK");
  return failures;
}

async function withTemporaryEnv(env, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(env || {})) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function refreshAccessToken(env, fetchImpl, timeoutMs) {
  const tokenUrl = env.LIFEOS_GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: String(env.LIFEOS_GOOGLE_CALENDAR_CLIENT_ID || ""),
      client_secret: String(env.LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET || ""),
      refresh_token: String(env.LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN || ""),
    });
    const response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    if (!response.ok) throw new Error(`google_oauth_http_${response.status}`);
    const payload = await response.json();
    if (!payload?.access_token) throw new Error("google_oauth_missing_access_token");
    return String(payload.access_token);
  } finally {
    clear();
  }
}

async function googleRequest({ env, fetchImpl, accessToken, baseUrl, requestPath, method = "GET", body, timeoutMs }) {
  const { signal, clear } = withTimeout(timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${requestPath}`, {
      method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!response.ok) throw new Error(`google_http_${response.status}`);
    if (response.status === 204) return {};
    return await response.json();
  } finally {
    clear();
  }
}

async function runStep(report, id, title, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    report.steps.push({
      id,
      title,
      ok: true,
      latencyMs: Date.now() - startedAt,
      ...result,
    });
    return result;
  } catch (error) {
    report.steps.push({
      id,
      title,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: redact(error?.message || error),
    });
    return null;
  }
}

async function runGoogleCalendarAcceptance(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(env.LIFEOS_CALENDAR_ACCEPTANCE_TIMEOUT_MS || env.LIFEOS_GOOGLE_CALENDAR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const writeRequested = Boolean(options.write || env.LIFEOS_CALENDAR_ACCEPTANCE_WRITE === "1");
  const calendarId = env.LIFEOS_GOOGLE_CALENDAR_ID || "primary";
  const taskListId = env.LIFEOS_GOOGLE_TASKS_LIST_ID || "@default";
  const calendarBase = env.LIFEOS_GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com/calendar/v3";
  const tasksBase = env.LIFEOS_GOOGLE_TASKS_API_BASE || "https://tasks.googleapis.com/tasks/v1";

  const missingConfig = requiredConfig(env);
  const missingWriteGates = writeGateFailures(env, writeRequested);
  const report = {
    generatedAt: new Date().toISOString(),
    ok: false,
    status: "not-run",
    connector: "google-calendar-and-tasks",
    calendarId: calendarId === "primary" ? "primary" : redactedId(calendarId),
    taskListId: taskListId === "@default" ? "@default" : redactedId(taskListId),
    writeRequested,
    writeEvidenceReady: false,
    missingConfig,
    missingWriteGates,
    steps: [],
    recommendations: [],
  };

  if (missingConfig.length) {
    report.status = "missing-config";
    report.recommendations.push("Enable LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR=1 and provide Google OAuth client id, client secret, and refresh token before claiming Google Calendar/Tasks sync.");
    return report;
  }

  if (missingWriteGates.length) {
    report.status = "write-gate-missing";
    report.recommendations.push(`For write acceptance, set LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 and LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="${CONFIRMATION_TEXT}".`);
    return report;
  }

  let rawAccessToken = "";
  const accessToken = await runStep(report, "oauth-refresh", "Refresh Google OAuth access token", async () => {
    rawAccessToken = await refreshAccessToken(env, fetchImpl, timeoutMs);
    return { token: redactedId(rawAccessToken) };
  });
  if (!accessToken?.token || !rawAccessToken) {
    report.status = "oauth-failed";
    report.recommendations.push("Repair Google OAuth credentials before running real account calendar acceptance.");
    return report;
  }

  await runStep(report, "calendar-read", "Read upcoming Google Calendar events", async () => {
    const query = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      maxResults: "3",
    });
    const payload = await googleRequest({
      env,
      fetchImpl,
      accessToken: rawAccessToken,
      baseUrl: calendarBase,
      requestPath: `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
      timeoutMs,
    });
    return { count: Array.isArray(payload.items) ? payload.items.length : 0 };
  });

  await runStep(report, "tasks-read", "Read open Google Tasks", async () => {
    const query = new URLSearchParams({ showCompleted: "false", maxResults: "3" });
    const payload = await googleRequest({
      env,
      fetchImpl,
      accessToken: rawAccessToken,
      baseUrl: tasksBase,
      requestPath: `/lists/${encodeURIComponent(taskListId)}/tasks?${query}`,
      timeoutMs,
    });
    return { count: Array.isArray(payload.items) ? payload.items.length : 0 };
  });

  if (writeRequested) {
    const stamp = new Date().toISOString();
    let createdEventId = "";
    await runStep(report, "calendar-create", "Create disposable Google Calendar acceptance event", async () => {
      const payload = await googleRequest({
        env,
        fetchImpl,
        accessToken: rawAccessToken,
        baseUrl: calendarBase,
        requestPath: `/calendars/${encodeURIComponent(calendarId)}/events`,
        method: "POST",
        body: {
          summary: `LifeOS acceptance ${stamp}`,
          description: "Created and removed by LifeOS calendar acceptance runbook after explicit maintainer confirmation.",
          start: { dateTime: stamp },
          end: { dateTime: new Date(Date.now() + 15 * 60 * 1000).toISOString() },
        },
        timeoutMs,
      });
      createdEventId = compact(payload.id || "");
      if (!createdEventId) throw new Error("google_calendar_create_missing_id");
      return { externalId: redactedId(createdEventId) };
    });
    if (createdEventId) {
      await runStep(report, "calendar-delete", "Delete disposable Google Calendar acceptance event", async () => {
        await googleRequest({
          env,
          fetchImpl,
          accessToken: rawAccessToken,
          baseUrl: calendarBase,
          requestPath: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(createdEventId)}`,
          method: "DELETE",
          timeoutMs,
        });
        return { externalId: redactedId(createdEventId) };
      });
    }

    let createdTaskId = "";
    await runStep(report, "tasks-create", "Create disposable Google Tasks acceptance item", async () => {
      const payload = await googleRequest({
        env,
        fetchImpl,
        accessToken: rawAccessToken,
        baseUrl: tasksBase,
        requestPath: `/lists/${encodeURIComponent(taskListId)}/tasks`,
        method: "POST",
        body: {
          title: `LifeOS acceptance ${stamp}`,
          notes: "Created and removed by LifeOS calendar acceptance runbook after explicit maintainer confirmation.",
        },
        timeoutMs,
      });
      createdTaskId = compact(payload.id || "");
      if (!createdTaskId) throw new Error("google_tasks_create_missing_id");
      return { externalId: redactedId(createdTaskId) };
    });
    if (createdTaskId) {
      await runStep(report, "tasks-complete", "Complete disposable Google Tasks acceptance item", async () => {
        await googleRequest({
          env,
          fetchImpl,
          accessToken: rawAccessToken,
          baseUrl: tasksBase,
          requestPath: `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(createdTaskId)}`,
          method: "PATCH",
          body: { status: "completed", completed: new Date().toISOString() },
          timeoutMs,
        });
        return { externalId: redactedId(createdTaskId) };
      });
      await runStep(report, "tasks-delete", "Delete disposable Google Tasks acceptance item", async () => {
        await googleRequest({
          env,
          fetchImpl,
          accessToken: rawAccessToken,
          baseUrl: tasksBase,
          requestPath: `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(createdTaskId)}`,
          method: "DELETE",
          timeoutMs,
        });
        return { externalId: redactedId(createdTaskId) };
      });
    }
  }

  const failed = report.steps.filter((step) => !step.ok);
  report.writeEvidenceReady = writeRequested && failed.length === 0 && report.steps.some((step) => step.id === "calendar-delete") && report.steps.some((step) => step.id === "tasks-delete");
  report.ok = failed.length === 0 && (!writeRequested || report.writeEvidenceReady);
  report.status = report.ok ? writeRequested ? "read-write-evidence-ready" : "read-evidence-ready" : "failed";
  if (!writeRequested) report.recommendations.push(`Run again with --write, LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1, and LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="${CONFIRMATION_TEXT}" before claiming real Google Calendar/Tasks write-back.`);
  if (failed.length) report.recommendations.push("Fix failed Google connector checks before publishing calendar/task sync claims.");
  return report;
}

async function runMacosCalendarAcceptance(options = {}) {
  const env = options.env || process.env;
  const writeRequested = Boolean(options.write || env.LIFEOS_CALENDAR_ACCEPTANCE_WRITE === "1");
  const missingConfig = macosConfigFailures(env);
  const missingWriteGates = writeGateFailures(env, writeRequested);
  const report = {
    generatedAt: new Date().toISOString(),
    ok: false,
    status: "not-run",
    connector: "macos-calendar-and-reminders",
    calendarName: env.LIFEOS_MACOS_ACCEPTANCE_CALENDAR_NAME ? redactedId(env.LIFEOS_MACOS_ACCEPTANCE_CALENDAR_NAME) : "default",
    reminderListName: env.LIFEOS_MACOS_ACCEPTANCE_REMINDER_LIST_NAME ? redactedId(env.LIFEOS_MACOS_ACCEPTANCE_REMINDER_LIST_NAME) : "default",
    writeRequested,
    writeEvidenceReady: false,
    missingConfig,
    missingWriteGates,
    steps: [],
    recommendations: [],
  };

  if (missingConfig.length) {
    report.status = "missing-config";
    report.recommendations.push("Set LIFEOS_ENABLE_MACOS_CALENDAR_CONNECTOR=1 on macOS before claiming Apple Calendar/System Reminders sync evidence.");
    return report;
  }

  if (missingWriteGates.length) {
    report.status = "write-gate-missing";
    report.recommendations.push(`For write acceptance, set LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1 and LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="${CONFIRMATION_TEXT}".`);
    return report;
  }

  const module = await withTemporaryEnv(env, async () => import(`../server/calendarSyncPreview.ts?calendarAcceptance=${Date.now()}-${Math.random()}`));
  const preview = await runStep(report, "macos-read-preview", "Read Apple Calendar and system Reminders preview", async () => {
    const result = await withTemporaryEnv(env, () => module.buildCalendarSyncPreviewAsync());
    const appleItems = result.operations.filter((operation) => operation.providerId === "apple-calendar" && operation.action === "read-only-import");
    const reminderItems = result.operations.filter((operation) => operation.providerId === "system-reminders" && operation.action === "read-only-import");
    return {
      appleCalendarCount: appleItems.length,
      remindersCount: reminderItems.length,
      providersReadyForRead: result.summary.providersReadyForRead,
      providersReadyForWrite: result.summary.providersReadyForWrite,
      warnings: result.summary.warnings.map(redact).slice(0, 5),
    };
  });

  if (!preview) {
    report.status = "read-failed";
    report.recommendations.push("Repair macOS Calendar/Reminders permissions before running write acceptance.");
    return report;
  }

  if (writeRequested) {
    const stamp = new Date().toISOString();
    const common = {
      explicitConsent: true,
      confirmationText: CONFIRMATION_TEXT,
      source: "calendar-acceptance-runbook",
    };
    let createdEventId = "";
    const createdEvent = await runStep(report, "apple-calendar-create", "Create disposable Apple Calendar acceptance event", async () => {
      const result = await withTemporaryEnv(env, () => module.executeCalendarSyncOperationAsync({
        ...common,
        providerId: "apple-calendar",
        kind: "event",
        action: "create",
        title: `LifeOS acceptance ${stamp}`,
        startsAt: stamp,
        notes: "Created and removed by LifeOS calendar acceptance runbook after explicit maintainer confirmation.",
        calendarName: env.LIFEOS_MACOS_ACCEPTANCE_CALENDAR_NAME || undefined,
      }));
      createdEventId = result.externalId || "";
      return { externalId: redactedId(result.externalId), rollbackAvailable: Boolean(result.rollbackPlan?.available) };
    });
    if (createdEvent?.externalId && createdEventId) {
      await runStep(report, "apple-calendar-delete", "Delete disposable Apple Calendar acceptance event", async () => {
        const result = await withTemporaryEnv(env, () => module.executeCalendarSyncOperationAsync({
          ...common,
          providerId: "apple-calendar",
          kind: "event",
          action: "delete",
          title: `LifeOS acceptance ${stamp}`,
          externalId: createdEventId,
        }));
        return { externalId: redactedId(result.externalId), rollbackAvailable: Boolean(result.rollbackPlan?.available) };
      });
    }

    let createdReminderId = "";
    const createdReminder = await runStep(report, "reminders-create", "Create disposable system Reminders acceptance item", async () => {
      const result = await withTemporaryEnv(env, () => module.executeCalendarSyncOperationAsync({
        ...common,
        providerId: "system-reminders",
        kind: "task",
        action: "create",
        title: `LifeOS acceptance ${stamp}`,
        dueAt: stamp,
        notes: "Created and removed by LifeOS calendar acceptance runbook after explicit maintainer confirmation.",
        reminderListName: env.LIFEOS_MACOS_ACCEPTANCE_REMINDER_LIST_NAME || undefined,
      }));
      createdReminderId = result.externalId || "";
      return { externalId: redactedId(result.externalId), rollbackAvailable: Boolean(result.rollbackPlan?.available) };
    });
    if (createdReminder?.externalId && createdReminderId) {
      await runStep(report, "reminders-complete", "Complete disposable system Reminders acceptance item", async () => {
        const result = await withTemporaryEnv(env, () => module.executeCalendarSyncOperationAsync({
          ...common,
          providerId: "system-reminders",
          kind: "task",
          action: "complete",
          title: `LifeOS acceptance ${stamp}`,
          externalId: createdReminderId,
        }));
        return { externalId: redactedId(result.externalId), rollbackAvailable: Boolean(result.rollbackPlan?.available) };
      });
      await runStep(report, "reminders-delete", "Delete disposable system Reminders acceptance item", async () => {
        const result = await withTemporaryEnv(env, () => module.executeCalendarSyncOperationAsync({
          ...common,
          providerId: "system-reminders",
          kind: "task",
          action: "delete",
          title: `LifeOS acceptance ${stamp}`,
          externalId: createdReminderId,
        }));
        return { externalId: redactedId(result.externalId), rollbackAvailable: Boolean(result.rollbackPlan?.available) };
      });
    }
  }

  const failed = report.steps.filter((step) => !step.ok);
  report.writeEvidenceReady = writeRequested && failed.length === 0 && report.steps.some((step) => step.id === "apple-calendar-delete") && report.steps.some((step) => step.id === "reminders-delete");
  report.ok = failed.length === 0 && (!writeRequested || report.writeEvidenceReady);
  report.status = report.ok ? writeRequested ? "read-write-evidence-ready" : "read-evidence-ready" : "failed";
  if (!writeRequested) report.recommendations.push(`Run again with --provider macos --write, LIFEOS_ENABLE_EXTERNAL_CALENDAR_WRITES=1, and LIFEOS_CALENDAR_ACCEPTANCE_CONFIRMATION="${CONFIRMATION_TEXT}" before claiming real Apple Calendar/System Reminders write-back.`);
  if (failed.length) report.recommendations.push("Fix failed macOS connector checks before publishing Apple Calendar/System Reminders sync claims.");
  return report;
}

export async function runCalendarAcceptance(options = {}) {
  const env = options.env || process.env;
  const provider = compact(options.provider || env.LIFEOS_CALENDAR_ACCEPTANCE_PROVIDER || "google").toLowerCase();
  if (["macos", "apple", "apple-calendar", "system-reminders", "reminders"].includes(provider)) {
    return runMacosCalendarAcceptance(options);
  }
  return runGoogleCalendarAcceptance(options);
}

function printHuman(report) {
  console.log(`[${report.ok ? "PASS" : "NOT READY"}] ${report.connector} acceptance`);
  console.log(`Status: ${report.status}`);
  console.log(`Write evidence: ${report.writeEvidenceReady ? "ready" : "not ready"}`);
  for (const step of report.steps) {
    console.log(`- ${step.ok ? "PASS" : "FAIL"} ${step.title}${step.error ? ` (${step.error})` : ""}`);
  }
  for (const recommendation of report.recommendations) console.log(`Next: ${recommendation}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  runCalendarAcceptance({ write: args.write, provider: args.provider })
    .then((report) => {
      const outPath = args.out || process.env.LIFEOS_CALENDAR_ACCEPTANCE_OUT || "";
      if (outPath) {
        fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      }
      if (args.json || process.env.LIFEOS_CALENDAR_ACCEPTANCE_JSON === "1") console.log(JSON.stringify(report, null, 2));
      else printHuman(report);
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`[FAIL] ${redact(error?.message || error)}`);
      process.exitCode = 1;
    });
}
