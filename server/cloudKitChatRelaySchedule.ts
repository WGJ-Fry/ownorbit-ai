import { insertAuditLog } from "./audit";
import { getClientState, setClientStateAt } from "./clientState";
import { runCloudKitChatRelayCycle, type CloudKitChatRelayCycleResult } from "./cloudKitChatRelayCycle";
import { getCloudKitChatRelayReadiness } from "./cloudKitChatRelayReadiness";

const STATE_KEY = "lifeos_cloudkit_chat_relay_schedule";
const SUCCESS_INTERVAL_MS = 20_000;
const CONTINUE_INTERVAL_MS = 2_000;
const NOT_READY_INTERVAL_MS = 5 * 60 * 1000;
const MIN_RETRY_MS = 30_000;
const MAX_RETRY_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;
const STARTUP_DELAY_MS = 2_000;

let schedulerTimer: NodeJS.Timeout | undefined;
let schedulerStartupTimer: NodeJS.Timeout | undefined;
let schedulerStarted = false;
let runInProgress = false;

export type CloudKitChatRelaySchedule = {
  nextRunAt: number;
  lastRunAt?: number;
  lastFinishedAt?: number;
  lastStatus?: string;
  lastOk?: boolean;
  consecutiveFailures: number;
  updatedAt: number;
  rawPayloadStored: false;
};

type Dependencies = {
  getReadiness?: typeof getCloudKitChatRelayReadiness;
  runCycle?: typeof runCloudKitChatRelayCycle;
  clock?: () => number;
};

function normalizeState(value: any, now = Date.now()): CloudKitChatRelaySchedule {
  const nextRunAt = Number(value?.nextRunAt);
  const consecutiveFailures = Number(value?.consecutiveFailures);
  return {
    nextRunAt: Number.isFinite(nextRunAt) && nextRunAt > 0 ? nextRunAt : now,
    lastRunAt: Number.isFinite(Number(value?.lastRunAt)) ? Number(value.lastRunAt) : undefined,
    lastFinishedAt: Number.isFinite(Number(value?.lastFinishedAt)) ? Number(value.lastFinishedAt) : undefined,
    lastStatus: typeof value?.lastStatus === "string" ? value.lastStatus.slice(0, 80) : undefined,
    lastOk: typeof value?.lastOk === "boolean" ? value.lastOk : undefined,
    consecutiveFailures: Number.isFinite(consecutiveFailures)
      ? Math.min(20, Math.max(0, Math.floor(consecutiveFailures)))
      : 0,
    updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : now,
    rawPayloadStored: false,
  };
}

function persistState(state: CloudKitChatRelaySchedule, now: number) {
  const normalized = normalizeState({ ...state, updatedAt: now }, now);
  setClientStateAt(STATE_KEY, normalized, now, { type: "system", id: "cloudkit-chat-relay-schedule" });
  return normalized;
}

function retryDelay(failures: number) {
  return Math.min(MAX_RETRY_MS, MIN_RETRY_MS * (2 ** Math.min(4, Math.max(0, failures - 1))));
}

export function getCloudKitChatRelaySchedule(now = Date.now()) {
  return normalizeState(getClientState(STATE_KEY)?.value, now);
}

export async function runDueCloudKitChatRelay(
  now = Date.now(),
  dependencies: Dependencies = {},
) {
  const state = getCloudKitChatRelaySchedule(now);
  if (state.nextRunAt > now) return null;
  if (runInProgress) return { skipped: true as const, reason: "already-running" as const, schedule: state };

  const getReadiness = dependencies.getReadiness || getCloudKitChatRelayReadiness;
  const runCycle = dependencies.runCycle || runCloudKitChatRelayCycle;
  const clock = dependencies.clock || Date.now;
  const readiness = getReadiness({ platformSupported: process.platform === "darwin" });
  runInProgress = true;
  try {
    if (!readiness.enabled || !readiness.ready) {
      const next = persistState({
        ...state,
        nextRunAt: now + NOT_READY_INTERVAL_MS,
        lastRunAt: now,
        lastFinishedAt: now,
        lastStatus: "needs-setup",
        lastOk: false,
        consecutiveFailures: 0,
        rawPayloadStored: false,
      }, now);
      return { skipped: true as const, reason: "needs-setup" as const, schedule: next };
    }

    const result = await runCycle({ readiness, now, clock });
    const finishedAt = clock();
    const transientContinuation = result.status === "pull-incomplete";
    const failures = result.ok ? 0 : state.consecutiveFailures + 1;
    const nextRunAt = finishedAt + (
      result.ok
        ? SUCCESS_INTERVAL_MS
        : transientContinuation
          ? CONTINUE_INTERVAL_MS
          : retryDelay(failures)
    );
    const next = persistState({
      ...state,
      nextRunAt,
      lastRunAt: now,
      lastFinishedAt: finishedAt,
      lastStatus: result.status,
      lastOk: result.ok,
      consecutiveFailures: failures,
      rawPayloadStored: false,
    }, finishedAt);
    insertAuditLog(
      result.ok ? "icloud_chat_relay_scheduled_run" : "icloud_chat_relay_scheduled_attention",
      "network",
      "cloudkit-chat-relay",
      {
        status: result.status,
        nextRunAt,
        consecutiveFailures: failures,
        rawPayloadStored: false,
      },
      "system",
      "cloudkit-chat-relay-schedule",
    );
    return { skipped: false as const, result, schedule: next };
  } catch (error) {
    const finishedAt = clock();
    const failures = state.consecutiveFailures + 1;
    const next = persistState({
      ...state,
      nextRunAt: finishedAt + retryDelay(failures),
      lastRunAt: now,
      lastFinishedAt: finishedAt,
      lastStatus: "failed",
      lastOk: false,
      consecutiveFailures: failures,
      rawPayloadStored: false,
    }, finishedAt);
    insertAuditLog("icloud_chat_relay_scheduled_failed", "network", "cloudkit-chat-relay", {
      error: error instanceof Error ? error.message.slice(0, 240) : "Unknown relay failure",
      nextRunAt: next.nextRunAt,
      consecutiveFailures: failures,
      rawPayloadStored: false,
    }, "system", "cloudkit-chat-relay-schedule");
    return { skipped: false as const, error: true as const, schedule: next };
  } finally {
    runInProgress = false;
  }
}

export function startCloudKitChatRelayScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerStartupTimer = setTimeout(() => {
    schedulerStartupTimer = undefined;
    runDueCloudKitChatRelay().catch(() => undefined);
  }, STARTUP_DELAY_MS);
  schedulerStartupTimer.unref?.();
  schedulerTimer = setInterval(() => {
    runDueCloudKitChatRelay().catch(() => undefined);
  }, POLL_INTERVAL_MS);
  schedulerTimer.unref?.();
}

export function stopCloudKitChatRelaySchedulerForTests() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (schedulerStartupTimer) clearTimeout(schedulerStartupTimer);
  schedulerTimer = undefined;
  schedulerStartupTimer = undefined;
  schedulerStarted = false;
  runInProgress = false;
}

export type CloudKitChatRelayScheduledResult = CloudKitChatRelayCycleResult;
