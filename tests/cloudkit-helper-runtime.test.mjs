import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  CLOUDKIT_HELPER_BUNDLE_SCHEMA,
  applyCloudKitHelperRuntimeEnvironment,
  resolveCloudKitHelperRuntime,
} = require("../desktop/cloudKitHelperRuntime.cjs");

async function bundledResources(root, manifestPatch = {}) {
  const resourcesRoot = path.join(root, "lifeos-resources");
  const helper = path.join(resourcesRoot, "native", "LifeOSCloudKitHelper.app", "Contents", "MacOS", "LifeOSCloudKitHelper");
  const entitlements = path.join(resourcesRoot, "native", "LifeOSCloudKitHelper.entitlements.plist");
  await mkdir(path.dirname(helper), { recursive: true });
  await writeFile(helper, "#!/bin/sh\nexit 0\n");
  await chmod(helper, 0o755);
  await writeFile(entitlements, "<plist><dict><key>CloudKit</key></dict></plist>");
  const manifest = {
    schema: CLOUDKIT_HELPER_BUNDLE_SCHEMA,
    included: true,
    verified: true,
    reason: "signed-helper-staged",
    helperRelativePath: "native/LifeOSCloudKitHelper.app/Contents/MacOS/LifeOSCloudKitHelper",
    entitlementsRelativePath: "native/LifeOSCloudKitHelper.entitlements.plist",
    containerId: "iCloud.ai.lifeos.desktop",
    bundleId: "ai.lifeos.cloudkit-helper",
    teamId: "TESTTEAM123",
    environment: "Development",
    rawSecretsIncluded: false,
    localSourcePathIncluded: false,
    ...manifestPatch,
  };
  await writeFile(path.join(resourcesRoot, "cloudkit-helper.json"), JSON.stringify(manifest));
  return { helper, entitlements };
}

test("desktop runtime discovers a verified bundled CloudKit helper without exposing paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-runtime-ready-"));
  try {
    const expected = await bundledResources(root);
    const result = resolveCloudKitHelperRuntime({ resourcesPath: root, environment: {} });
    assert.equal(result.available, true);
    assert.equal(result.source, "bundled");
    assert.equal(result.helperPath, expected.helper);
    const environment = {};
    const publicStatus = applyCloudKitHelperRuntimeEnvironment(result, environment);
    assert.equal(environment.LIFEOS_CLOUDKIT_HELPER_BIN, expected.helper);
    assert.equal(environment.LIFEOS_CLOUDKIT_CONTAINER_ID, "iCloud.ai.lifeos.desktop");
    assert.equal(environment.LIFEOS_CLOUDKIT_BUNDLE_ID, "ai.lifeos.cloudkit-helper");
    assert.equal(publicStatus.available, true);
    assert.equal(publicStatus.bundled, true);
    assert.equal(publicStatus.helperPathReturned, false);
    assert.equal(JSON.stringify(publicStatus).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop runtime rejects traversal, secret flags, and absent helper manifests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-runtime-blocked-"));
  try {
    await bundledResources(root, { helperRelativePath: "../outside", rawSecretsIncluded: true });
    const invalid = resolveCloudKitHelperRuntime({ resourcesPath: root, environment: {} });
    assert.equal(invalid.available, false);
    assert.equal(invalid.reason, "bundled-helper-invalid");
    const missing = resolveCloudKitHelperRuntime({ resourcesPath: path.join(root, "missing"), environment: {} });
    assert.equal(missing.available, false);
    assert.equal(missing.reason, "bundle-manifest-missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop runtime keeps an explicit helper configuration authoritative", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-runtime-explicit-"));
  try {
    const helper = path.join(root, "LifeOSCloudKitHelper");
    await writeFile(helper, "#!/bin/sh\nexit 0\n");
    await chmod(helper, 0o755);
    const result = resolveCloudKitHelperRuntime({
      resourcesPath: path.join(root, "unused"),
      environment: {
        LIFEOS_CLOUDKIT_HELPER_BIN: helper,
        LIFEOS_CLOUDKIT_CONTAINER_ID: "iCloud.example.explicit",
      },
    });
    assert.equal(result.available, true);
    assert.equal(result.source, "explicit");
    assert.equal(result.containerId, "iCloud.example.explicit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
