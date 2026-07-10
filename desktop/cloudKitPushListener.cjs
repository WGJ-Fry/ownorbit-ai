const fs = require("fs");
const path = require("path");
const { spawn: defaultSpawn } = require("child_process");

const CLOUDKIT_PUSH_EVENT_SCHEMA = "lifeos-cloudkit-listener-event.v1";
const CLOUDKIT_PUSH_EVENT_PROTOCOL_VERSION = 1;
const MAX_EVENT_LINE_BYTES = 16 * 1024;
const MAX_BUFFER_BYTES = 64 * 1024;
const allowedEvents = new Set([
  "listener-starting",
  "listener-ready",
  "registration-failed",
  "subscription-failed",
  "remote-change",
  "notification-ignored",
]);
const allowedReasons = new Set([
  "starting",
  "ready",
  "apns-registration-failed",
  "subscription-save-failed",
  "database-change",
  "subscription-mismatch",
  "unsupported-notification",
]);
const eventReasons = new Map([
  ["listener-starting", new Set(["starting"])],
  ["listener-ready", new Set(["ready"])],
  ["registration-failed", new Set(["apns-registration-failed"])],
  ["subscription-failed", new Set(["subscription-save-failed"])],
  ["remote-change", new Set(["database-change"])],
  ["notification-ignored", new Set(["subscription-mismatch", "unsupported-notification"])],
]);

function compact(value, limit = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function redactLogText(value) {
  return compact(value, 600)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/(client_secret|refresh_token|access_token|token|key|secret|password)=\S+/gi, "$1=[redacted]");
}

function parseCloudKitPushEventLine(value) {
  const line = String(value || "").trim();
  if (!line || Buffer.byteLength(line, "utf8") > MAX_EVENT_LINE_BYTES) return null;
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.schema !== CLOUDKIT_PUSH_EVENT_SCHEMA || payload.protocolVersion !== CLOUDKIT_PUSH_EVENT_PROTOCOL_VERSION) return null;
  const event = compact(payload.event, 40);
  const reason = compact(payload.reason, 60);
  const emittedAt = String(payload.emittedAt || "");
  if (!allowedEvents.has(event) || !allowedReasons.has(reason)) return null;
  if (!eventReasons.get(event)?.has(reason)) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(emittedAt)) return null;
  if (payload.payloadIncluded !== false || payload.deviceTokenIncluded !== false || payload.changeTokenIncluded !== false) return null;
  return {
    protocolVersion: CLOUDKIT_PUSH_EVENT_PROTOCOL_VERSION,
    schema: CLOUDKIT_PUSH_EVENT_SCHEMA,
    event,
    reason,
    emittedAt: emittedAt.slice(0, 40),
    subscriptionMatched: Boolean(payload.subscriptionMatched),
    payloadIncluded: false,
    deviceTokenIncluded: false,
    changeTokenIncluded: false,
  };
}

function minimalListenerEnvironment(source = process.env) {
  const env = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER"]) {
    if (source[key]) env[key] = source[key];
  }
  env.LIFEOS_CLOUDKIT_LISTENER_PROTOCOL = `json-lines-v${CLOUDKIT_PUSH_EVENT_PROTOCOL_VERSION}`;
  return env;
}

function validContainerId(value) {
  return /^iCloud\.[A-Za-z0-9.-]{3,150}$/.test(String(value || ""));
}

function executableFile(value) {
  const candidate = String(value || "").trim();
  if (!candidate || !path.isAbsolute(candidate)) return false;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function appBundleExecutable(value) {
  const candidate = String(value || "").trim();
  return /\.app\/Contents\/MacOS\/[^/]+$/.test(candidate);
}

function createCloudKitPushListenerController(options = {}) {
  const spawnProcess = options.spawnProcess || defaultSpawn;
  const isExecutable = options.isExecutable || executableFile;
  const isListenerCapablePath = options.isListenerCapablePath || appBundleExecutable;
  const platform = options.platform || process.platform;
  const now = options.now || (() => Date.now());
  const scheduleTimer = options.setTimeout || setTimeout;
  const cancelTimer = options.clearTimeout || clearTimeout;
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : () => {};
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  let child = null;
  let restartTimer = null;
  let desired = false;
  let configKey = "";
  let stdoutBuffer = "";
  let restartAttempt = 0;
  let state = {
    configured: false,
    running: false,
    ready: false,
    status: "not-configured",
    reason: "not-configured",
    lastReadyAt: null,
    lastEventAt: null,
    lastRemoteChangeAt: null,
    receivedRemoteChanges: 0,
    restartCount: 0,
    rawPayloadReturned: false,
    deviceTokenReturned: false,
    changeTokenReturned: false,
  };

  function publicStatus() {
    return { ...state };
  }

  function updateState(patch) {
    state = { ...state, ...patch };
    onStatus(publicStatus());
  }

  function clearRestart() {
    if (restartTimer) cancelTimer(restartTimer);
    restartTimer = null;
  }

  function stopChild() {
    const active = child;
    child = null;
    stdoutBuffer = "";
    if (!active) return;
    try {
      active.kill("SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }

  function scheduleRestart(start) {
    if (!desired || restartTimer) return;
    const delay = Math.min(5 * 60 * 1000, 5_000 * (2 ** Math.min(restartAttempt, 6)));
    restartAttempt += 1;
    updateState({ status: "restart-wait", reason: "listener-exited", restartCount: state.restartCount + 1 });
    restartTimer = scheduleTimer(() => {
      restartTimer = null;
      if (desired) start();
    }, delay);
    restartTimer.unref?.();
  }

  function handleEvent(event) {
    const timestamp = now();
    const patch = { lastEventAt: timestamp };
    if (event.event === "listener-ready") {
      restartAttempt = 0;
      Object.assign(patch, { ready: true, status: "ready", reason: "ready", lastReadyAt: timestamp });
    } else if (event.event === "remote-change") {
      Object.assign(patch, {
        ready: true,
        status: "remote-change",
        reason: event.reason,
        lastRemoteChangeAt: timestamp,
        receivedRemoteChanges: Math.min(Number.MAX_SAFE_INTEGER, state.receivedRemoteChanges + 1),
      });
    } else if (event.event === "registration-failed" || event.event === "subscription-failed") {
      Object.assign(patch, { ready: false, status: event.event, reason: event.reason });
    }
    updateState(patch);
    Promise.resolve(onEvent(event)).catch((error) => onLog("CloudKit push event handling failed", redactLogText(error?.message || error)));
  }

  function consumeStdout(chunk) {
    stdoutBuffer += String(chunk || "");
    if (Buffer.byteLength(stdoutBuffer, "utf8") > MAX_BUFFER_BYTES) {
      stdoutBuffer = "";
      onLog("CloudKit push listener output rejected", "buffer-limit");
      return;
    }
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      const event = parseCloudKitPushEventLine(line);
      if (event) handleEvent(event);
      else if (line.trim()) onLog("CloudKit push listener event rejected", "invalid-contract");
    }
  }

  function start() {
    if (!desired || child) return publicStatus();
    const [helperPath, containerId] = configKey.split("\n");
    let active;
    try {
      active = spawnProcess(helperPath, ["--lifeos-cloudkit-listener", "--container-id", containerId], {
        stdio: ["ignore", "pipe", "pipe"],
        env: minimalListenerEnvironment(options.environment || process.env),
      });
    } catch (error) {
      updateState({ running: false, ready: false, status: "start-failed", reason: "spawn-failed" });
      onLog("CloudKit push listener could not start", redactLogText(error?.message || error));
      scheduleRestart(start);
      return publicStatus();
    }
    child = active;
    stdoutBuffer = "";
    updateState({ configured: true, running: true, ready: false, status: "starting", reason: "starting" });
    active.stdout?.on("data", consumeStdout);
    active.stderr?.on("data", (chunk) => {
      const text = redactLogText(chunk);
      if (text) onLog("CloudKit push listener stderr", text);
    });
    active.on("error", (error) => onLog("CloudKit push listener process error", redactLogText(error?.message || error)));
    active.on("close", (code, signal) => {
      if (child !== active) return;
      child = null;
      stdoutBuffer = "";
      updateState({ running: false, ready: false, status: desired ? "exited" : "stopped", reason: desired ? "listener-exited" : "stopped" });
      if (desired) {
        onLog("CloudKit push listener exited", `code=${Number.isInteger(code) ? code : "none"} signal=${compact(signal, 20) || "none"}`);
        scheduleRestart(start);
      }
    });
    return publicStatus();
  }

  function configure(config = {}) {
    const enabled = Boolean(config.enabled);
    const helperPath = String(config.helperPath || "").trim();
    const containerId = String(config.containerId || "").trim();
    const nextKey = `${helperPath}\n${containerId}`;
    if (!enabled || platform !== "darwin") {
      desired = false;
      configKey = "";
      clearRestart();
      stopChild();
      updateState({ configured: false, running: false, ready: false, status: platform === "darwin" ? "disabled" : "unsupported-platform", reason: platform === "darwin" ? "disabled" : "unsupported-platform" });
      return publicStatus();
    }
    if (!validContainerId(containerId) || !isExecutable(helperPath) || !isListenerCapablePath(helperPath)) {
      desired = false;
      configKey = "";
      clearRestart();
      stopChild();
      const reason = !validContainerId(containerId)
        ? "missing-container"
        : !isExecutable(helperPath)
          ? "missing-helper"
          : "app-bundle-required";
      updateState({ configured: false, running: false, ready: false, status: "missing-helper", reason });
      return publicStatus();
    }
    if (desired && configKey === nextKey && child) return publicStatus();
    desired = false;
    clearRestart();
    stopChild();
    desired = true;
    configKey = nextKey;
    restartAttempt = 0;
    updateState({ configured: true, running: false, ready: false, status: "starting", reason: "starting" });
    return start();
  }

  function stop(reason = "stopped") {
    desired = false;
    configKey = "";
    clearRestart();
    stopChild();
    updateState({ configured: false, running: false, ready: false, status: "stopped", reason: compact(reason, 40) || "stopped" });
    return publicStatus();
  }

  return { configure, publicStatus, stop };
}

module.exports = {
  CLOUDKIT_PUSH_EVENT_PROTOCOL_VERSION,
  CLOUDKIT_PUSH_EVENT_SCHEMA,
  appBundleExecutable,
  createCloudKitPushListenerController,
  minimalListenerEnvironment,
  parseCloudKitPushEventLine,
};
