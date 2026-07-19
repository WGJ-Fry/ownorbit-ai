#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const sourceDir = resolve(rootDir, "native/apple/cloudkit-helper");
const buildDir = resolve(process.env.LIFEOS_CLOUDKIT_XCODE_BUILD_DIR || resolve(rootDir, "build/native/cloudkit-helper-xcode"));
const derivedDataDir = resolve(buildDir, "DerivedData");
const projectPath = resolve(buildDir, "LifeOSCloudKitHelper.xcodeproj");
const appPath = resolve(derivedDataDir, "Build/Products/Release/LifeOSCloudKitHelper.app");
const executablePath = resolve(appPath, "Contents/MacOS/LifeOSCloudKitHelper");
const entitlementsPath = resolve(buildDir, "LifeOSCloudKitHelper.entitlements");
const compileOnly = process.argv.includes("--compile-only") || process.env.LIFEOS_CLOUDKIT_XCODE_COMPILE_ONLY === "1";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function requiredEnv(name, fallback = "") {
  const value = String(process.env[name] || fallback).trim();
  if (!value) {
    console.error(`${name} is required for the Xcode CloudKit helper build.`);
    process.exit(2);
  }
  return value;
}

function yamlString(value) {
  return JSON.stringify(String(value || ""));
}

function projectSpec({ teamId, bundleId, containerId, environment }) {
  return `name: LifeOSCloudKitHelper
options:
  createIntermediateGroups: true
settings:
  base:
    MACOSX_DEPLOYMENT_TARGET: "13.0"
targets:
  LifeOSCloudKitHelper:
    type: application
    platform: macOS
    sources:
      - path: LifeOSCloudKitHelper.swift
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${yamlString(bundleId)}
        PRODUCT_NAME: LifeOSCloudKitHelper
        SWIFT_VERSION: "5.9"
        CODE_SIGN_STYLE: Automatic
        DEVELOPMENT_TEAM: ${yamlString(teamId)}
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_CFBundleDisplayName: OwnOrbit CloudKit Helper
        INFOPLIST_KEY_LSBackgroundOnly: YES
        CODE_SIGN_ENTITLEMENTS: LifeOSCloudKitHelper.entitlements
    entitlements:
      path: LifeOSCloudKitHelper.entitlements
      properties:
        com.apple.developer.icloud-container-environment: ${yamlString(environment)}
        com.apple.developer.icloud-container-identifiers:
          - ${yamlString(containerId)}
        com.apple.developer.icloud-services:
          - CloudKit
        com.apple.developer.aps-environment: ${yamlString(environment.toLowerCase())}
        com.apple.security.app-sandbox: true
        com.apple.security.network.client: true
schemes:
  LifeOSCloudKitHelper:
    build:
      targets:
        LifeOSCloudKitHelper: all
    run:
      config: Release
`;
}

if (process.platform !== "darwin") {
  console.error("The Xcode CloudKit helper build requires macOS.");
  process.exit(2);
}

const xcodegen = run("xcodegen", ["--help"]);
if (!xcodegen.ok) {
  console.error("XcodeGen is required. Install it with: brew install xcodegen");
  process.exit(2);
}

const containerId = requiredEnv("LIFEOS_CLOUDKIT_CONTAINER_ID", compileOnly ? "iCloud.ai.lifeos.desktop" : "");
const teamId = compileOnly
  ? String(process.env.LIFEOS_CLOUDKIT_TEAM_ID || process.env.APPLE_TEAM_ID || "UNSIGNED").trim()
  : requiredEnv("LIFEOS_CLOUDKIT_TEAM_ID", process.env.APPLE_TEAM_ID);
const bundleId = requiredEnv("LIFEOS_CLOUDKIT_BUNDLE_ID", "ai.lifeos.cloudkit-helper");
const environment = String(process.env.LIFEOS_CLOUDKIT_ENVIRONMENT || "Development").trim();
if (environment !== "Development" && environment !== "Production") {
  console.error("LIFEOS_CLOUDKIT_ENVIRONMENT must be Development or Production.");
  process.exit(2);
}

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
copyFileSync(resolve(sourceDir, "LifeOSCloudKitHelper.swift"), resolve(buildDir, "LifeOSCloudKitHelper.swift"));
const specPath = resolve(buildDir, "project.yml");
writeFileSync(specPath, projectSpec({ teamId, bundleId, containerId, environment }), { mode: 0o600 });

const generated = run("xcodegen", ["--spec", specPath, "--project", buildDir, "--project-root", buildDir]);
if (!generated.ok) {
  if (generated.stdout) process.stdout.write(generated.stdout);
  if (generated.stderr) process.stderr.write(generated.stderr);
  process.exit(generated.status || 1);
}

const allowProvisioningUpdates = process.env.LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES === "1";
const xcodeArgs = [
  "-project",
  projectPath,
  "-scheme",
  "LifeOSCloudKitHelper",
  "-configuration",
  "Release",
  "-destination",
  "platform=macOS",
  "-derivedDataPath",
  derivedDataDir,
  `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
  ...(compileOnly
    ? ["CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO"]
    : [
        `DEVELOPMENT_TEAM=${teamId}`,
        "CODE_SIGN_STYLE=Automatic",
        ...(allowProvisioningUpdates
          ? ["-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration"]
          : []),
      ]),
  "build",
];
const build = run("xcodebuild", xcodeArgs);
if (!build.ok) {
  const buildOutput = `${build.stdout}\n${build.stderr}`;
  const agreementBlocked = !compileOnly && (buildOutput.includes("PLA Update available") || buildOutput.includes("Program License Agreement"));
  const profileMissing = !compileOnly && /No profiles for|provisioning profiles matching/i.test(buildOutput);
  if (agreementBlocked) {
    console.error("Apple Developer Program License Agreement must be accepted by the account holder before Xcode can create the OwnOrbit provisioning profile.");
    console.error("Open https://developer.apple.com/account/, accept the current agreement, then rerun this command.");
  } else if (profileMissing && !allowProvisioningUpdates) {
    console.error("Xcode could not find a matching local profile. After reviewing the App ID and iCloud Container, rerun with LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES=1.");
  } else {
    if (build.stdout) process.stdout.write(build.stdout);
    if (build.stderr) process.stderr.write(build.stderr);
  }
  process.exit(build.status || 1);
}

if (!existsSync(executablePath)) {
  console.error(`Xcode completed without the expected helper executable: ${executablePath}`);
  process.exit(1);
}
if (!compileOnly) {
  const verified = run("codesign", ["--verify", "--strict", "--deep", appPath]);
  if (!verified.ok) {
    if (verified.stdout) process.stdout.write(verified.stdout);
    if (verified.stderr) process.stderr.write(verified.stderr);
    process.exit(verified.status || 1);
  }
  const inspected = run("codesign", ["-d", "--entitlements", ":-", executablePath]);
  const inspectedEntitlements = `${inspected.stdout}\n${inspected.stderr}`;
  if (!inspected.ok || !inspectedEntitlements.includes(containerId) || !inspectedEntitlements.includes("CloudKit") || !inspectedEntitlements.includes("com.apple.developer.aps-environment")) {
    console.error("The Xcode-built helper does not expose the requested CloudKit container and macOS push entitlements.");
    process.exit(inspected.status || 1);
  }
}
const launchCheck = run(executablePath, []);
if (launchCheck.status !== 2 || !launchCheck.stdout.includes("lifeos-cloudkit-helper-response.v1")) {
  console.error("The Xcode-built CloudKit helper was signed but could not launch.");
  if (launchCheck.stderr) process.stderr.write(launchCheck.stderr);
  process.exit(3);
}

console.log(`Built launchable Xcode CloudKit helper: ${appPath}`);
console.log(`Build mode: ${compileOnly ? "unsigned compile-only" : "signed CloudKit + APNs"}`);
console.log(`Use helper: LIFEOS_CLOUDKIT_HELPER_BIN="${executablePath}"`);
console.log(`Use entitlements: LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH="${entitlementsPath}"`);
if (!compileOnly) console.log(`Provisioning updates allowed: ${allowProvisioningUpdates ? "yes" : "no"}`);
