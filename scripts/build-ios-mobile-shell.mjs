#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(rootDir, "native", "apple", "mobile-shell");
const buildDir = path.resolve(process.env.LIFEOS_IOS_NATIVE_BUILD_DIR || path.join(rootDir, "build", "native", "mobile-shell"));
const derivedDataDir = path.join(buildDir, "DerivedData");
const projectPath = path.join(buildDir, "LifeOSMobile.xcodeproj");
const deviceBuild = process.argv.includes("--device");
const deviceCompile = process.argv.includes("--device-compile");
const deviceTarget = deviceBuild || deviceCompile;
const productFolder = deviceTarget ? "Debug-iphoneos" : "Debug-iphonesimulator";
const appPath = path.join(derivedDataDir, "Build", "Products", productFolder, "LifeOSMobile.app");
const cloudKitContainerId = String(process.env.LIFEOS_CLOUDKIT_CONTAINER_ID || "iCloud.ai.lifeos.desktop").trim();
const cloudKitEnvironment = String(process.env.LIFEOS_CLOUDKIT_ENVIRONMENT || "Development").trim();
if (!new Set(["Development", "Production"]).has(cloudKitEnvironment)) {
  console.error("LIFEOS_CLOUDKIT_ENVIRONMENT must be Development or Production.");
  process.exit(2);
}
const apsEnvironment = cloudKitEnvironment === "Production" ? "production" : "development";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (options.print !== false) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status || 1);
  }
  return result;
}

function selectSimulator() {
  const requested = String(process.env.LIFEOS_IOS_SIMULATOR_UDID || "").trim();
  const listed = run("xcrun", ["simctl", "list", "devices", "available", "--json"], { print: false });
  const parsed = JSON.parse(listed.stdout || "{}");
  const devices = Object.entries(parsed.devices || {})
    .flatMap(([runtime, values]) => (values || []).map((device) => ({ ...device, runtime })))
    .filter((device) => device.isAvailable && /iPhone/i.test(device.name || ""));
  if (requested) {
    const device = devices.find((candidate) => candidate.udid === requested);
    if (!device) throw new Error(`Requested iOS simulator is unavailable: ${requested}`);
    return device;
  }
  return devices.find((device) => device.state === "Booted") || devices.sort((left, right) => String(right.runtime).localeCompare(String(left.runtime)))[0];
}

if (process.platform !== "darwin") {
  console.error("The native iOS shell build requires macOS and Xcode.");
  process.exit(2);
}
if (!existsSync(sourceDir)) {
  console.error(`Missing native iOS shell source: ${sourceDir}`);
  process.exit(2);
}
if (run("xcodegen", ["--version"], { print: false, allowFailure: true }).status !== 0) {
  console.error("XcodeGen is required. Install it with: brew install xcodegen");
  process.exit(2);
}

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });
cpSync(sourceDir, buildDir, { recursive: true });
run("xcodegen", ["--spec", path.join(buildDir, "project.yml"), "--project", buildDir, "--project-root", buildDir]);

const commonArgs = [
  "-project", projectPath,
  "-scheme", "LifeOSMobile",
  "-configuration", "Debug",
  "-derivedDataPath", derivedDataDir,
  `LIFEOS_CLOUDKIT_CONTAINER_ID=${cloudKitContainerId}`,
  `LIFEOS_CLOUDKIT_ENVIRONMENT=${cloudKitEnvironment}`,
  `LIFEOS_APS_ENVIRONMENT=${apsEnvironment}`,
];

if (deviceBuild) {
  const teamId = String(process.env.LIFEOS_CLOUDKIT_TEAM_ID || process.env.APPLE_TEAM_ID || "").trim();
  const bundleId = String(process.env.LIFEOS_CLOUDKIT_MOBILE_BUNDLE_ID || "ai.lifeos.mobile").trim();
  if (!teamId || !cloudKitContainerId.startsWith("iCloud.")) {
    console.error("A signed iPhone build requires LIFEOS_CLOUDKIT_TEAM_ID (or APPLE_TEAM_ID) and LIFEOS_CLOUDKIT_CONTAINER_ID.");
    process.exit(2);
  }
  const allowProvisioningUpdates = process.env.LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES === "1";
  const deviceResult = run("xcodebuild", [
    ...commonArgs,
    "-destination", "generic/platform=iOS",
    `DEVELOPMENT_TEAM=${teamId}`,
    `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`,
    "CODE_SIGN_STYLE=Automatic",
    ...(allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
    "build",
  ], { allowFailure: true });
  if (deviceResult.status !== 0) {
    const output = `${deviceResult.stdout || ""}\n${deviceResult.stderr || ""}`;
    if (/PLA Update available|Program License Agreement/i.test(output)) {
      console.error("The Apple Developer Program License Agreement must be accepted by the account holder before Xcode can provision LifeOS Mobile.");
    } else if (/No profiles for|provisioning profiles matching/i.test(output)) {
      console.error("No matching iPhone provisioning profile is installed. After reviewing the App ID and iCloud Container, set LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES=1 and rerun.");
    }
    process.exit(deviceResult.status || 1);
  }
} else if (deviceCompile) {
  run("xcodebuild", [
    ...commonArgs,
    "-destination", "generic/platform=iOS",
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    "build",
  ]);
} else if (process.env.LIFEOS_IOS_NATIVE_RUN_TESTS === "1") {
  const device = selectSimulator();
  if (!device) {
    console.error("No available iPhone simulator was found.");
    process.exit(2);
  }
  if (device.state !== "Booted") {
    run("xcrun", ["simctl", "boot", device.udid], { allowFailure: true });
  }
  run("xcrun", ["simctl", "bootstatus", device.udid, "-b"]);
  run("xcodebuild", [...commonArgs, "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "-destination", `platform=iOS Simulator,id=${device.udid}`, "test"]);
} else {
  run("xcodebuild", [...commonArgs, "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "-destination", "generic/platform=iOS Simulator", "build"]);
}

if (!existsSync(appPath)) {
  console.error(`Xcode did not create the expected simulator app: ${appPath}`);
  process.exit(1);
}

const buildKind = deviceBuild ? "signed device" : deviceCompile ? "unsigned device compile" : "simulator";
console.log(`Built LifeOS native iOS shell (${buildKind}): ${appPath}`);
