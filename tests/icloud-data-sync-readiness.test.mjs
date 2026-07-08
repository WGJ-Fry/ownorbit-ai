import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const envKeys = [
  "LIFEOS_ICLOUD_DATA_SYNC",
  "LIFEOS_CLOUDKIT_CONTAINER_ID",
  "LIFEOS_CLOUDKIT_TEAM_ID",
  "APPLE_TEAM_ID",
  "LIFEOS_CLOUDKIT_BUNDLE_ID",
  "LIFEOS_APP_BUNDLE_ID",
  "LIFEOS_CLOUDKIT_HELPER_BIN",
  "LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH",
  "LIFEOS_CLOUDKIT_SYNC_TYPES",
];

function snapshotEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of envKeys) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

test("CloudKit data sync readiness stays handoff-only until explicitly enabled", async () => {
  const env = snapshotEnv();
  try {
    for (const key of envKeys) delete process.env[key];
    const { getIcloudDataSyncReadiness } = await import(`../server/icloudDataSyncReadiness.ts?case=disabled-${Date.now()}`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    assert.equal(readiness.enabled, false);
    assert.equal(readiness.mode, "handoff-only");
    assert.equal(readiness.status, "not-enabled");
    assert.equal(readiness.dataSyncScope, "entry-file-only");
    assert.equal(readiness.ready, false);
    assert.equal(readiness.notSyncedDataTypes.includes("ai-keys"), true);
  } finally {
    restoreEnv(env);
  }
});

test("CloudKit data sync readiness blocks unsafe types and requires native helper plus entitlements", async () => {
  const env = snapshotEnv();
  const dir = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-readiness-"));
  try {
    const helper = path.join(dir, "lifeos-cloudkit-helper");
    const entitlements = path.join(dir, "LifeOS.entitlements");
    await writeFile(helper, "#!/bin/sh\nexit 0\n");
    await chmod(helper, 0o755);
    await writeFile(entitlements, [
      "<plist>",
      "<key>com.apple.developer.icloud-container-identifiers</key>",
      "<array><string>iCloud.ai.lifeos.desktop</string></array>",
      "</plist>",
    ].join("\n"));

    process.env.LIFEOS_ICLOUD_DATA_SYNC = "1";
    process.env.LIFEOS_CLOUDKIT_CONTAINER_ID = "iCloud.ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_TEAM_ID = "TEAM123456";
    process.env.LIFEOS_CLOUDKIT_BUNDLE_ID = "ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_HELPER_BIN = helper;
    process.env.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH = entitlements;
    process.env.LIFEOS_CLOUDKIT_SYNC_TYPES = "chat-history,memory,ai-keys,device-credentials";

    const { getIcloudDataSyncReadiness } = await import(`../server/icloudDataSyncReadiness.ts?case=ready-${Date.now()}`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    assert.equal(readiness.enabled, true);
    assert.equal(readiness.status, "ready-to-test");
    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.selectedDataTypes, ["chat-history", "memory"]);
    assert.deepEqual(readiness.blockedDataTypes, ["ai-keys", "device-credentials"]);
    assert.equal(readiness.nativeHelper.executable, true);
    assert.equal(readiness.entitlements.mentionsContainer, true);
    assert.equal(readiness.blockedDataTypePolicy.includes("Never sync AI keys"), true);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("CloudKit data sync readiness reports the first missing native prerequisite", async () => {
  const env = snapshotEnv();
  try {
    for (const key of envKeys) delete process.env[key];
    process.env.LIFEOS_ICLOUD_DATA_SYNC = "1";
    process.env.LIFEOS_CLOUDKIT_CONTAINER_ID = "iCloud.ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_TEAM_ID = "TEAM123456";
    process.env.LIFEOS_CLOUDKIT_BUNDLE_ID = "ai.lifeos.desktop";
    process.env.LIFEOS_CLOUDKIT_SYNC_TYPES = "tasks";

    const { getIcloudDataSyncReadiness } = await import(`../server/icloudDataSyncReadiness.ts?case=missing-helper-${Date.now()}`);
    const readiness = getIcloudDataSyncReadiness({ platformSupported: true });
    assert.equal(readiness.status, "missing-native-helper");
    assert.equal(readiness.ready, false);
    assert.equal(readiness.nextAction.includes("native CloudKit helper"), true);
  } finally {
    restoreEnv(env);
  }
});
