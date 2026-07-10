#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { spawnSync } from "child_process";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const source = resolve(rootDir, "native/apple/cloudkit-helper/LifeOSCloudKitHelper.swift");
const output = resolve(process.env.LIFEOS_CLOUDKIT_HELPER_OUT || resolve(rootDir, "build/native/LifeOSCloudKitHelper"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: options.stdio || "pipe",
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function xmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requiredEnv(name, fallback = "") {
  const value = String(process.env[name] || fallback).trim();
  if (!value) {
    console.error(`${name} is required when LIFEOS_CLOUDKIT_SIGN_HELPER=1.`);
    process.exit(2);
  }
  return value;
}

function generatedEntitlements({ containerId, teamId, bundleId, environment }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>application-identifier</key>
  <string>${xmlEscape(`${teamId}.${bundleId}`)}</string>
  <key>com.apple.developer.icloud-container-environment</key>
  <string>${xmlEscape(environment)}</string>
  <key>com.apple.developer.icloud-container-identifiers</key>
  <array>
    <string>${xmlEscape(containerId)}</string>
  </array>
  <key>com.apple.developer.icloud-services</key>
  <array>
    <string>CloudKit</string>
  </array>
  <key>com.apple.developer.aps-environment</key>
  <string>${xmlEscape(environment.toLowerCase())}</string>
  <key>com.apple.developer.team-identifier</key>
  <string>${xmlEscape(teamId)}</string>
  <key>com.apple.security.app-sandbox</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
`;
}

function detectCloudKitSigningIdentity(teamId) {
  const identities = run("security", ["find-identity", "-v", "-p", "codesigning"]);
  if (!identities.ok) return "";
  const escapedTeamId = teamId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const teamPattern = new RegExp(`"([^"]*\\(${escapedTeamId}\\))"`, "g");
  const matchingIdentities = Array.from(identities.stdout.matchAll(teamPattern), (match) => match[1]);
  return matchingIdentities.find((identity) => identity.startsWith("Apple Development:"))
    || matchingIdentities.find((identity) => identity.startsWith("Developer ID Application:"))
    || "";
}

function signCloudKitHelper() {
  const signRequested = process.env.LIFEOS_CLOUDKIT_SIGN_HELPER === "1" || Boolean(process.env.LIFEOS_CLOUDKIT_SIGN_IDENTITY);
  if (!signRequested) return null;

  const containerId = requiredEnv("LIFEOS_CLOUDKIT_CONTAINER_ID");
  const teamId = requiredEnv("LIFEOS_CLOUDKIT_TEAM_ID", process.env.APPLE_TEAM_ID);
  const bundleId = requiredEnv("LIFEOS_CLOUDKIT_BUNDLE_ID", "ai.lifeos.cloudkit-helper");
  const environment = String(process.env.LIFEOS_CLOUDKIT_ENVIRONMENT || "Development").trim();
  if (environment !== "Development" && environment !== "Production") {
    console.error("LIFEOS_CLOUDKIT_ENVIRONMENT must be Development or Production.");
    process.exit(2);
  }

  const configuredEntitlementsPath = String(process.env.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH || "").trim();
  const entitlementsPath = resolve(configuredEntitlementsPath || `${output}.entitlements.plist`);
  if (configuredEntitlementsPath) {
    if (!existsSync(entitlementsPath)) {
      console.error(`CloudKit entitlements file does not exist: ${entitlementsPath}`);
      process.exit(2);
    }
  } else {
    writeFileSync(entitlementsPath, generatedEntitlements({ containerId, teamId, bundleId, environment }), { mode: 0o600 });
  }

  const identity = String(process.env.LIFEOS_CLOUDKIT_SIGN_IDENTITY || "").trim() || detectCloudKitSigningIdentity(teamId);
  if (!identity) {
    console.error("No Apple Development or Developer ID Application identity matches LIFEOS_CLOUDKIT_TEAM_ID. Set LIFEOS_CLOUDKIT_SIGN_IDENTITY explicitly.");
    process.exit(2);
  }

  const signed = run("codesign", [
    "--force",
    "--sign",
    identity,
    "--entitlements",
    entitlementsPath,
    "--timestamp=none",
    output,
  ]);
  if (!signed.ok) {
    if (signed.stdout) process.stdout.write(signed.stdout);
    if (signed.stderr) process.stderr.write(signed.stderr);
    process.exit(signed.status || 1);
  }

  const verified = run("codesign", ["--verify", "--strict", output]);
  if (!verified.ok) {
    if (verified.stdout) process.stdout.write(verified.stdout);
    if (verified.stderr) process.stderr.write(verified.stderr);
    process.exit(verified.status || 1);
  }
  const inspected = run("codesign", ["-d", "--entitlements", ":-", output]);
  const inspectedEntitlements = `${inspected.stdout}\n${inspected.stderr}`;
  if (!inspected.ok || !inspectedEntitlements.includes(containerId) || !inspectedEntitlements.includes("CloudKit") || !inspectedEntitlements.includes("com.apple.developer.aps-environment")) {
    console.error("The signed helper does not expose the requested CloudKit container and macOS push entitlements.");
    process.exit(inspected.status || 1);
  }
  const launchCheck = run(output, []);
  const launchCheckPassed = launchCheck.status === 2
    && launchCheck.stdout.includes("lifeos-cloudkit-helper-response.v1")
    && launchCheck.stdout.includes("Missing --lifeos-cloudkit-json");
  if (!launchCheckPassed) {
    console.error("The signed helper cannot launch with its CloudKit entitlement. Create and install a matching Apple provisioning profile for the helper bundle and iCloud Container.");
    if (launchCheck.stderr) process.stderr.write(launchCheck.stderr);
    process.exit(3);
  }

  return { entitlementsPath, containerId, teamId, bundleId, environment };
}

if (process.platform !== "darwin") {
  console.error("CloudKit helper build requires macOS because it links Apple CloudKit.framework.");
  process.exit(2);
}

const swiftCommand = run("xcrun", ["--find", "swiftc"]).ok ? "xcrun" : "swiftc";
const swiftArgsPrefix = swiftCommand === "xcrun" ? ["swiftc"] : [];

mkdirSync(dirname(output), { recursive: true });

const build = run(swiftCommand, [
  ...swiftArgsPrefix,
  "-O",
  "-parse-as-library",
  "-framework",
  "CloudKit",
  "-framework",
  "AppKit",
  source,
  "-o",
  output,
]);

if (!build.ok) {
  if (build.stdout) process.stdout.write(build.stdout);
  if (build.stderr) process.stderr.write(build.stderr);
  process.exit(build.status || 1);
}

const signature = signCloudKitHelper();

console.log(`Built LifeOS CloudKit helper: ${output}`);
if (signature) {
  console.log(`Signed CloudKit helper for ${signature.environment} with container ${signature.containerId}.`);
  console.log(`Use entitlements: LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH="${signature.entitlementsPath}"`);
}
console.log(`Use with: LIFEOS_CLOUDKIT_HELPER_BIN="${output}" npm run icloud:helper:smoke -- --probe`);
