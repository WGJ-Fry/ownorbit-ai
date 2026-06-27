import type { CalendarSyncExecuteInput, CalendarSyncItemKind, CalendarSyncOperationAction, CalendarSyncPreviousState } from "./calendarSyncPreview";

const GOOGLE_TOKEN_URL = process.env.LIFEOS_GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_BASE = process.env.LIFEOS_GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com/calendar/v3";
const GOOGLE_CONNECTOR_TIMEOUT_MS = Number(process.env.LIFEOS_GOOGLE_CALENDAR_TIMEOUT_MS || 8000);
const GOOGLE_MAX_READ_ITEMS = Number(process.env.LIFEOS_GOOGLE_CALENDAR_READ_MAX_ITEMS || 10);

export type GoogleCalendarReadItem = {
  providerId: "google-calendar";
  kind: CalendarSyncItemKind;
  title: string;
  scheduledAt?: string;
  externalId?: string;
  source: string;
};

export type GoogleCalendarOperationExecution = {
  externalId: string;
  previousState?: CalendarSyncPreviousState;
};

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function compact(value: unknown, fallback = "") {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function calendarId() {
  return process.env.LIFEOS_GOOGLE_CALENDAR_ID || "primary";
}

function isGoogleCalendarOAuthConfigured() {
  return Boolean(
    process.env.LIFEOS_GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN,
  );
}

function isGoogleCalendarConnectorEnabled() {
  return process.env.LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR === "1";
}

function isGoogleCalendarConnectorMock() {
  return process.env.LIFEOS_GOOGLE_CALENDAR_CONNECTOR_MOCK === "1";
}

export function isGoogleCalendarConnectorConfigured() {
  return isGoogleCalendarConnectorMock() || (isGoogleCalendarConnectorEnabled() && isGoogleCalendarOAuthConfigured());
}

export function googleCalendarRecommendation() {
  if (!isGoogleCalendarConnectorEnabled() && !isGoogleCalendarConnectorMock()) {
    return "Set LIFEOS_ENABLE_GOOGLE_CALENDAR_CONNECTOR=1 and provide Google OAuth client id, client secret, refresh token, and calendar id before enabling Google Calendar preview.";
  }
  if (!isGoogleCalendarOAuthConfigured() && !isGoogleCalendarConnectorMock()) {
    return "Google Calendar connector is enabled but OAuth credentials are incomplete. Provide LIFEOS_GOOGLE_CALENDAR_CLIENT_ID, LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET, and LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN.";
  }
  return "Google Calendar connector can read events and execute explicitly confirmed create/update/delete operations. Complete/Tasks are not supported by Google Calendar yet.";
}

function withTimeoutSignal() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GOOGLE_CONNECTOR_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function refreshAccessToken(fetchImpl: typeof fetch) {
  const { signal, clear } = withTimeoutSignal();
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: String(process.env.LIFEOS_GOOGLE_CALENDAR_CLIENT_ID || ""),
      client_secret: String(process.env.LIFEOS_GOOGLE_CALENDAR_CLIENT_SECRET || ""),
      refresh_token: String(process.env.LIFEOS_GOOGLE_CALENDAR_REFRESH_TOKEN || ""),
    });
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    if (!response.ok) throw new Error(`google_oauth_http_${response.status}`);
    const payload = await response.json() as { access_token?: string };
    if (!payload.access_token) throw new Error("google_oauth_missing_access_token");
    return payload.access_token;
  } finally {
    clear();
  }
}

async function googleCalendarRequest<T>(path: string, options: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const accessToken = await refreshAccessToken(fetchImpl);
  const { signal, clear } = withTimeoutSignal();
  try {
    const response = await fetchImpl(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal,
    });
    if (!response.ok) throw new Error(`google_calendar_http_${response.status}`);
    if (response.status === 204) return {} as T;
    return await response.json() as T;
  } finally {
    clear();
  }
}

function eventToReadItem(event: GoogleCalendarEvent, index: number): GoogleCalendarReadItem {
  const scheduledAt = compact(event.start?.dateTime || event.start?.date || "");
  const externalId = compact(event.id || "");
  return {
    providerId: "google-calendar",
    kind: "event",
    title: compact(event.summary, "Untitled Google Calendar event"),
    scheduledAt: scheduledAt || undefined,
    externalId: externalId || undefined,
    source: `google-calendar:${externalId || index + 1}`,
  };
}

function eventToPreviousState(event: GoogleCalendarEvent): CalendarSyncPreviousState {
  return {
    title: compact(event.summary || "") || undefined,
    scheduledAt: compact(event.start?.dateTime || event.start?.date || "") || undefined,
    notes: compact(event.description || "") || undefined,
  };
}

function eventBody(input: CalendarSyncExecuteInput, title: string) {
  const startText = compact(input.startsAt || input.dueAt || new Date().toISOString());
  const start = new Date(startText);
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const end = new Date(safeStart.getTime() + 30 * 60 * 1000);
  return {
    summary: title,
    description: compact(input.notes, "Created by LifeOS AI after explicit admin confirmation."),
    start: { dateTime: safeStart.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

export async function readGoogleCalendarItems(options: { fetchImpl?: typeof fetch } = {}): Promise<{ items: GoogleCalendarReadItem[]; warning?: string }> {
  if (!isGoogleCalendarConnectorConfigured()) return { items: [] };
  if (isGoogleCalendarConnectorMock()) {
    return {
      items: [eventToReadItem({
        id: "mock-google-event-1",
        summary: "Mock Google Calendar planning review",
        start: { dateTime: "2026-07-09T09:00:00.000Z" },
      }, 0)],
    };
  }
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const query = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: now.toISOString(),
      timeMax: horizon.toISOString(),
      maxResults: String(GOOGLE_MAX_READ_ITEMS),
    });
    const result = await googleCalendarRequest<{ items?: GoogleCalendarEvent[] }>(
      `/calendars/${encodeURIComponent(calendarId())}/events?${query.toString()}`,
      {},
      options.fetchImpl || fetch,
    );
    return {
      items: (result.items || []).slice(0, GOOGLE_MAX_READ_ITEMS).map(eventToReadItem),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar read failed";
    return { items: [], warning: `Google Calendar read preview failed or needs OAuth repair: ${compact(message)}` };
  }
}

export function validateGoogleCalendarOperation(input: CalendarSyncExecuteInput) {
  const action: Exclude<CalendarSyncOperationAction, "read-only-import"> = input.action && ["create", "update", "delete"].includes(input.action) ? input.action : "create";
  if (input.kind === "task" || input.action === "complete") throw new Error("Google Calendar connector currently supports calendar events only; Google Tasks is not shipped yet");
  const title = compact(input.title, "Untitled Google Calendar event");
  const externalId = compact(input.externalId || "");
  if (!title) throw new Error("A title is required");
  if (["update", "delete"].includes(action) && !externalId) throw new Error("externalId is required for update and delete operations");
  if (!isGoogleCalendarConnectorConfigured()) throw new Error("Google Calendar connector is not configured");
  if (input.explicitConsent !== true || input.confirmationText !== "WRITE TO EXTERNAL CALENDAR") {
    throw new Error("Explicit confirmation is required before writing to Google Calendar");
  }
  return { providerId: "google-calendar" as const, kind: "event" as const, action, title, externalId };
}

export async function executeGoogleCalendarOperation(
  input: CalendarSyncExecuteInput,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<GoogleCalendarOperationExecution> {
  const normalized = validateGoogleCalendarOperation(input);
  if (isGoogleCalendarConnectorMock()) {
    return {
      externalId: `mock-google-calendar-${normalized.action}-${Date.now()}`,
      previousState: ["update", "delete"].includes(normalized.action) ? {
        title: input.title ? `Previous ${input.title}` : "Previous Google Calendar event",
        scheduledAt: input.startsAt || input.dueAt,
        notes: "Mock previous state captured before LifeOS wrote to Google Calendar.",
      } : undefined,
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const idPath = `/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(normalized.externalId)}`;
  if (normalized.action === "create") {
    const created = await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId())}/events`,
      { method: "POST", body: JSON.stringify(eventBody(input, normalized.title)) },
      fetchImpl,
    );
    return { externalId: compact(created.id || `google-calendar-${Date.now()}`) };
  }

  const previous = await googleCalendarRequest<GoogleCalendarEvent>(idPath, {}, fetchImpl);
  if (normalized.action === "delete") {
    await googleCalendarRequest<Record<string, never>>(idPath, { method: "DELETE" }, fetchImpl);
    return { externalId: normalized.externalId, previousState: eventToPreviousState(previous) };
  }

  const updated = await googleCalendarRequest<GoogleCalendarEvent>(
    idPath,
    { method: "PATCH", body: JSON.stringify(eventBody(input, normalized.title)) },
    fetchImpl,
  );
  return { externalId: compact(updated.id || normalized.externalId), previousState: eventToPreviousState(previous) };
}
