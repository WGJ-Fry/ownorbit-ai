import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  CLOUDKIT_PUSH_EVENT_SCHEMA,
  appBundleExecutable,
  createCloudKitPushListenerController,
  minimalListenerEnvironment,
  parseCloudKitPushEventLine,
} = require("../desktop/cloudKitPushListener.cjs");

function eventLine(event, reason, extra = {}) {
  return JSON.stringify({
    protocolVersion: 1,
    schema: CLOUDKIT_PUSH_EVENT_SCHEMA,
    event,
    reason,
    emittedAt: "2026-07-11T08:00:00Z",
    subscriptionMatched: event === "remote-change",
    payloadIncluded: false,
    deviceTokenIncluded: false,
    changeTokenIncluded: false,
    ...extra,
  });
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killedWith = "";
  }

  kill(signal) {
    this.killedWith = signal;
    this.emit("close", 0, signal);
    return true;
  }
}

test("CloudKit push listener accepts only redacted fixed-schema events", () => {
  const parsed = parseCloudKitPushEventLine(eventLine("remote-change", "database-change"));
  assert.deepEqual(parsed, {
    protocolVersion: 1,
    schema: CLOUDKIT_PUSH_EVENT_SCHEMA,
    event: "remote-change",
    reason: "database-change",
    emittedAt: "2026-07-11T08:00:00Z",
    subscriptionMatched: true,
    payloadIncluded: false,
    deviceTokenIncluded: false,
    changeTokenIncluded: false,
  });
  assert.equal(parseCloudKitPushEventLine("not-json"), null);
  assert.equal(parseCloudKitPushEventLine(eventLine("remote-change", "database-change", { payloadIncluded: true, payload: { secret: "no" } })), null);
  assert.equal(parseCloudKitPushEventLine(eventLine("remote-change", "unknown-reason")), null);
  assert.equal(parseCloudKitPushEventLine(eventLine("remote-change", "ready")), null);
  assert.equal(parseCloudKitPushEventLine(eventLine("remote-change", "database-change", { emittedAt: "not-a-date" })), null);
});

test("CloudKit push listener child environment excludes OwnOrbit credentials", () => {
  const env = minimalListenerEnvironment({
    HOME: "/Users/test",
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    LIFEOS_ADMIN_PASSWORD: "must-not-cross-process-boundary",
    GEMINI_API_KEY: "must-not-cross-process-boundary",
    LIFEOS_DESKTOP_INTERNAL_TOKEN: "must-not-cross-process-boundary",
  });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "LIFEOS_CLOUDKIT_LISTENER_PROTOCOL", "PATH"]);
  assert.equal(env.LIFEOS_ADMIN_PASSWORD, undefined);
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.LIFEOS_DESKTOP_INTERNAL_TOKEN, undefined);
});

test("CloudKit push listener requires a macOS app-bundle executable", () => {
  assert.equal(appBundleExecutable("/Applications/LifeOSCloudKitHelper.app/Contents/MacOS/LifeOSCloudKitHelper"), true);
  assert.equal(appBundleExecutable("/tmp/LifeOSCloudKitHelper"), false);
});

test("Electron CloudKit push controller keeps a listener alive and emits safe remote-change events", async () => {
  const children = [];
  const spawnCalls = [];
  const received = [];
  let currentTime = 1000;
  const controller = createCloudKitPushListenerController({
    platform: "darwin",
    isExecutable: () => true,
    now: () => currentTime,
    environment: { HOME: "/Users/test", PATH: "/usr/bin", LIFEOS_ADMIN_PASSWORD: "blocked" },
    spawnProcess(command, args, options) {
      const child = new FakeChild();
      children.push(child);
      spawnCalls.push({ command, args, options });
      return child;
    },
    onEvent: (event) => received.push(event),
  });

  const starting = controller.configure({
    enabled: true,
    helperPath: "/Applications/LifeOSCloudKitHelper.app/Contents/MacOS/LifeOSCloudKitHelper",
    containerId: "iCloud.ai.lifeos.desktop",
  });
  assert.equal(starting.running, true);
  assert.equal(starting.ready, false);
  assert.deepEqual(spawnCalls[0].args, ["--lifeos-cloudkit-listener", "--container-id", "iCloud.ai.lifeos.desktop"]);
  assert.equal(spawnCalls[0].options.env.LIFEOS_ADMIN_PASSWORD, undefined);

  children[0].stdout.write(`${eventLine("listener-ready", "ready", { subscriptionMatched: true })}\n`);
  currentTime = 2000;
  children[0].stdout.write(`${eventLine("remote-change", "database-change")}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  const status = controller.publicStatus();
  assert.equal(status.ready, true);
  assert.equal(status.receivedRemoteChanges, 1);
  assert.equal(status.lastRemoteChangeAt, 2000);
  assert.deepEqual(received.map((event) => event.event), ["listener-ready", "remote-change"]);
  const serializedEvents = JSON.stringify(received);
  assert.equal(serializedEvents.includes("payloadJson"), false);
  assert.equal(serializedEvents.includes('"deviceToken":'), false);
  assert.equal(serializedEvents.includes('"changeToken":'), false);
  assert.equal(serializedEvents.includes("must-not-cross-process-boundary"), false);
  controller.stop("test-complete");
  assert.equal(children[0].killedWith, "SIGTERM");
});

test("Electron CloudKit push controller restarts after an unexpected exit and stops cleanly", () => {
  const children = [];
  const timers = [];
  const controller = createCloudKitPushListenerController({
    platform: "darwin",
    isExecutable: () => true,
    isListenerCapablePath: () => true,
    spawnProcess() {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout() {},
  });
  controller.configure({ enabled: true, helperPath: "/tmp/LifeOSCloudKitHelper", containerId: "iCloud.ai.lifeos.desktop" });
  children[0].emit("close", 1, null);
  assert.equal(controller.publicStatus().status, "restart-wait");
  assert.equal(timers[0].delay, 5000);
  timers[0].callback();
  assert.equal(children.length, 2);
  assert.equal(controller.publicStatus().running, true);
  controller.stop("test-complete");
  assert.equal(controller.publicStatus().running, false);
});
