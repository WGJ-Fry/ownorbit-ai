import type { CalendarSyncExecuteInput, CalendarSyncItemKind, CalendarSyncOperationAction, CalendarSyncPreviousState } from "./calendarSyncPreview";
import { isGoogleCalendarConnectorConfigured, refreshGoogleAccessToken } from "./googleCalendarConnector";

const GOOGLE_TASKS_API_BASE = process.env.LIFEOS_GOOGLE_TASKS_API_BASE || "https://tasks.googleapis.com/tasks/v1";
const GOOGLE_TASKS_TIMEOUT_MS = Number(process.env.LIFEOS_GOOGLE_TASKS_TIMEOUT_MS || process.env.LIFEOS_GOOGLE_CALENDAR_TIMEOUT_MS || 8000);
const GOOGLE_TASKS_MAX_READ_ITEMS = Number(process.env.LIFEOS_GOOGLE_TASKS_READ_MAX_ITEMS || process.env.LIFEOS_GOOGLE_CALENDAR_READ_MAX_ITEMS || 10);

export type GoogleTaskReadItem = {
  providerId: "google-calendar";
  kind: CalendarSyncItemKind;
  title: string;
  scheduledAt?: string;
  externalId?: string;
  source: string;
};

export type GoogleTaskOperationExecution = {
  externalId: string;
  previousState?: CalendarSyncPreviousState;
};

type GoogleTask = {
  id?: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: "needsAction" | "completed";
  completed?: string;
};

function compact(value: unknown, fallback = "") {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function taskListId() {
  return process.env.LIFEOS_GOOGLE_TASKS_LIST_ID || "@default";
}

function isGoogleTasksConnectorMock() {
  return process.env.LIFEOS_GOOGLE_TASKS_CONNECTOR_MOCK === "1" || process.env.LIFEOS_GOOGLE_CALENDAR_CONNECTOR_MOCK === "1";
}

function withTimeoutSignal() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_TASKS_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function googleTasksRequest<T>(path: string, options: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const accessToken = await refreshGoogleAccessToken(fetchImpl, GOOGLE_TASKS_TIMEOUT_MS);
  const { signal, clear } = withTimeoutSignal();
  try {
    const response = await fetchImpl(`${GOOGLE_TASKS_API_BASE}${path}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal,
    });
    if (!response.ok) throw new Error(`google_tasks_http_${response.status}`);
    if (response.status === 204) return {} as T;
    return await response.json() as T;
  } finally {
    clear();
  }
}

function taskToReadItem(task: GoogleTask, index: number): GoogleTaskReadItem {
  const externalId = compact(task.id || "");
  return {
    providerId: "google-calendar",
    kind: "task",
    title: compact(task.title, "Untitled Google task"),
    scheduledAt: compact(task.due || "") || undefined,
    externalId: externalId || undefined,
    source: `google-tasks:${externalId || index + 1}`,
  };
}

function taskToPreviousState(task: GoogleTask): CalendarSyncPreviousState {
  return {
    title: compact(task.title || "") || undefined,
    scheduledAt: compact(task.due || "") || undefined,
    notes: compact(task.notes || "") || undefined,
    completed: task.status === "completed",
  };
}

function taskBody(input: CalendarSyncExecuteInput, title: string, completed?: boolean) {
  const dueText = compact(input.dueAt || input.startsAt || "");
  const body: GoogleTask = {
    title,
    notes: compact(input.notes, "Created by LifeOS AI after explicit admin confirmation."),
  };
  if (dueText) {
    const due = new Date(dueText);
    if (!Number.isNaN(due.getTime())) body.due = due.toISOString();
  }
  if (completed === true) {
    body.status = "completed";
    body.completed = new Date().toISOString();
  } else if (completed === false) {
    body.status = "needsAction";
  }
  return body;
}

export async function readGoogleTaskItems(options: { fetchImpl?: typeof fetch } = {}): Promise<{ items: GoogleTaskReadItem[]; warning?: string }> {
  if (!isGoogleCalendarConnectorConfigured()) return { items: [] };
  if (isGoogleTasksConnectorMock()) {
    return {
      items: [taskToReadItem({
        id: "mock-google-task-1",
        title: "Mock Google Task follow-up",
        due: "2026-07-10T12:00:00.000Z",
        status: "needsAction",
      }, 0)],
    };
  }
  try {
    const query = new URLSearchParams({
      showCompleted: "false",
      maxResults: String(GOOGLE_TASKS_MAX_READ_ITEMS),
    });
    const result = await googleTasksRequest<{ items?: GoogleTask[] }>(
      `/lists/${encodeURIComponent(taskListId())}/tasks?${query.toString()}`,
      {},
      options.fetchImpl || fetch,
    );
    return {
      items: (result.items || []).slice(0, GOOGLE_TASKS_MAX_READ_ITEMS).map(taskToReadItem),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Tasks read failed";
    return { items: [], warning: `Google Tasks read preview failed or needs OAuth repair: ${compact(message)}` };
  }
}

export function validateGoogleTaskOperation(input: CalendarSyncExecuteInput) {
  const action: Exclude<CalendarSyncOperationAction, "read-only-import"> = input.action && ["create", "update", "complete", "delete"].includes(input.action) ? input.action : "create";
  const title = compact(input.title, "Untitled Google task");
  const externalId = compact(input.externalId || "");
  if (!title) throw new Error("A title is required");
  if (["update", "complete", "delete"].includes(action) && !externalId) throw new Error("externalId is required for update, complete, and delete operations");
  if (!isGoogleCalendarConnectorConfigured()) throw new Error("Google Tasks connector is not configured");
  if (input.explicitConsent !== true || input.confirmationText !== "WRITE TO EXTERNAL CALENDAR") {
    throw new Error("Explicit confirmation is required before writing to Google Tasks");
  }
  return { providerId: "google-calendar" as const, kind: "task" as const, action, title, externalId };
}

export async function executeGoogleTaskOperation(
  input: CalendarSyncExecuteInput,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<GoogleTaskOperationExecution> {
  const normalized = validateGoogleTaskOperation(input);
  if (isGoogleTasksConnectorMock()) {
    return {
      externalId: `mock-google-task-${normalized.action}-${Date.now()}`,
      previousState: ["update", "complete", "delete"].includes(normalized.action) ? {
        title: input.title ? `Previous ${input.title}` : "Previous Google task",
        scheduledAt: input.dueAt || input.startsAt,
        notes: "Mock previous state captured before LifeOS wrote to Google Tasks.",
        completed: normalized.action === "complete" ? false : undefined,
      } : undefined,
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const listPath = `/lists/${encodeURIComponent(taskListId())}/tasks`;
  const idPath = `${listPath}/${encodeURIComponent(normalized.externalId)}`;
  if (normalized.action === "create") {
    const created = await googleTasksRequest<GoogleTask>(
      listPath,
      { method: "POST", body: JSON.stringify(taskBody(input, normalized.title)) },
      fetchImpl,
    );
    return { externalId: compact(created.id || `google-task-${Date.now()}`) };
  }

  const previous = await googleTasksRequest<GoogleTask>(idPath, {}, fetchImpl);
  if (normalized.action === "delete") {
    await googleTasksRequest<Record<string, never>>(idPath, { method: "DELETE" }, fetchImpl);
    return { externalId: normalized.externalId, previousState: taskToPreviousState(previous) };
  }
  if (normalized.action === "complete") {
    const completed = await googleTasksRequest<GoogleTask>(
      idPath,
      { method: "PATCH", body: JSON.stringify(taskBody(input, normalized.title, true)) },
      fetchImpl,
    );
    return { externalId: compact(completed.id || normalized.externalId), previousState: taskToPreviousState(previous) };
  }

  const updated = await googleTasksRequest<GoogleTask>(
    idPath,
    { method: "PATCH", body: JSON.stringify(taskBody(input, normalized.title, typeof input.completed === "boolean" ? input.completed : undefined)) },
    fetchImpl,
  );
  return { externalId: compact(updated.id || normalized.externalId), previousState: taskToPreviousState(previous) };
}
