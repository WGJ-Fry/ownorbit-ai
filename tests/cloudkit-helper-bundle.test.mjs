import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLOUDKIT_HELPER_BUNDLE_SCHEMA,
  CLOUDKIT_HELPER_EXECUTABLE_RELATIVE_PATH,
  CLOUDKIT_HELPER_MANIFEST_NAME,
  stageCloudKitHelper,
} from "../scripts/cloudkit-helper-bundle.mjs";

async function fakeApp(root) {
  const app = path.join(root, "LifeOSCloudKitHelper.app");
  const executable = path.join(app, "Contents", "MacOS", "LifeOSCloudKitHelper");
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  return app;
}

function inspected(sourceApp, containerId = "iCloud.ai.lifeos.desktop") {
  return {
    sourceApp,
    executableName: "LifeOSCloudKitHelper",
    bundleId: "ai.lifeos.cloudkit-helper",
    containerId,
    teamId: "TESTTEAM123",
    environment: "Development",
    distribution: "development",
    notarized: false,
    entitlementsXml: `<?xml version="1.0"?><plist><dict><key>com.apple.developer.icloud-container-identifiers</key><array><string>${containerId}</string></array><key>com.apple.developer.icloud-services</key><array><string>CloudKit</string></array><key>com.apple.developer.aps-environment</key><string>development</string></dict></plist>`,
  };
}

test("desktop resource preparation emits an absent manifest when no signed helper exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-bundle-absent-"));
  try {
    const outputDir = path.join(root, "resources");
    const result = stageCloudKitHelper({ rootDir: root, outputDir, inspect: () => assert.fail("inspect should not run") });
    assert.equal(result.manifest.schema, CLOUDKIT_HELPER_BUNDLE_SCHEMA);
    assert.equal(result.manifest.included, false);
    assert.equal(result.manifest.rawSecretsIncluded, false);
    assert.equal(result.manifest.localSourcePathIncluded, false);
    assert.equal(result.manifest.distribution, "");
    assert.equal(result.manifest.notarized, false);
    const written = JSON.parse(await readFile(path.join(outputDir, CLOUDKIT_HELPER_MANIFEST_NAME), "utf8"));
    assert.equal(written.reason, "signed-helper-not-found");
    assert.equal(JSON.stringify(written).includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop resource preparation copies only inspected signed helper metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-bundle-ready-"));
  try {
    const sourceApp = await fakeApp(root);
    const outputDir = path.join(root, "resources");
    const inspectedPaths = [];
    const result = stageCloudKitHelper({
      rootDir: root,
      outputDir,
      sourceApp,
      containerId: "iCloud.ai.lifeos.desktop",
      inspect: (candidate) => {
        inspectedPaths.push(candidate);
        return inspected(candidate);
      },
    });
    assert.equal(result.manifest.included, true);
    assert.equal(result.manifest.verified, true);
    assert.equal(result.manifest.helperRelativePath, CLOUDKIT_HELPER_EXECUTABLE_RELATIVE_PATH);
    assert.equal(result.manifest.rawSecretsIncluded, false);
    assert.equal(result.manifest.localSourcePathIncluded, false);
    assert.equal(result.manifest.distribution, "development");
    assert.equal(result.manifest.notarized, false);
    assert.equal(inspectedPaths.length, 2);
    assert.equal(inspectedPaths[0], sourceApp);
    assert.equal(inspectedPaths[1], path.join(outputDir, "native", "LifeOSCloudKitHelper.app"));
    await chmod(path.join(outputDir, result.manifest.helperRelativePath), 0o755);
    const serialized = JSON.stringify(result.manifest);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes("deviceToken"), false);
    assert.equal(serialized.includes("APPLE_APP_SPECIFIC_PASSWORD"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop resource preparation rejects a helper whose signature is lost while staging", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-bundle-copy-invalid-"));
  try {
    const sourceApp = await fakeApp(root);
    const outputDir = path.join(root, "resources");
    let inspections = 0;
    assert.throws(() => stageCloudKitHelper({
      rootDir: root,
      outputDir,
      sourceApp,
      inspect: (candidate) => {
        inspections += 1;
        if (inspections === 2) throw new Error(`invalid signature: ${candidate}`);
        return inspected(candidate);
      },
    }), /signature did not survive/);
    assert.equal(inspections, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop resource preparation blocks required, mismatched, or invalid helpers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lifeos-cloudkit-bundle-blocked-"));
  try {
    assert.throws(() => stageCloudKitHelper({ rootDir: root, required: true }), /required/);
    assert.throws(() => stageCloudKitHelper({ rootDir: root, sourceApp: path.join(root, "missing.app") }), /configured.*not found/);
    const sourceApp = await fakeApp(root);
    assert.throws(() => stageCloudKitHelper({
      rootDir: root,
      sourceApp,
      containerId: "iCloud.ai.lifeos.desktop",
      inspect: (candidate) => inspected(candidate, "iCloud.example.other"),
    }), /does not match/);
    assert.throws(() => stageCloudKitHelper({
      rootDir: root,
      sourceApp,
      distributableRequired: true,
      inspect: (candidate) => inspected(candidate),
    }), /device-independent Developer ID/);
    assert.throws(() => stageCloudKitHelper({
      rootDir: root,
      sourceApp,
      notarizedRequired: true,
      inspect: (candidate) => ({ ...inspected(candidate), distribution: "developer-id", notarized: false }),
    }), /Apple-notarized and stapled/);
    assert.throws(() => stageCloudKitHelper({
      rootDir: root,
      sourceApp,
      environment: "Production",
      inspect: (candidate) => inspected(candidate),
    }), /environment does not match/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
