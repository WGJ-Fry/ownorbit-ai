#!/usr/bin/env node
import crypto from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultAppPath = path.join(
  rootDir,
  "build",
  "native",
  "mobile-shell",
  "DerivedData",
  "Build",
  "Products",
  "Debug-iphoneos",
  "LifeOSMobile.app",
);

function run(command, args) {
  return spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function safeError(value) {
  return String(value || "")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/\b[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}\b/gi, "[redacted-device]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

export function deviceIdHash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12)}`;
}

export function isInstallableAppleDevice(device) {
  const tunnelState = device?.connectionProperties?.tunnelState;
  return device?.hardwareProperties?.platform === "iOS"
    && device?.connectionProperties?.pairingState === "paired"
    && (tunnelState === "connected" || tunnelState === "available");
}

export function selectInstallDevice(devices, requestedIdentifier = "") {
  const allDevices = Array.isArray(devices) ? devices : [];
  const requested = String(requestedIdentifier || "").trim();
  if (requested) {
    const match = allDevices.find((device) => device?.identifier === requested);
    if (!match) throw new Error("The requested Apple device is not known to Xcode.");
    if (!isInstallableAppleDevice(match)) {
      throw new Error("The requested Apple device is paired but unavailable. Unlock it and connect it by USB or trusted Wi-Fi.");
    }
    return match;
  }

  const available = allDevices.filter(isInstallableAppleDevice);
  const preferred = available.find((device) => String(device?.hardwareProperties?.productType || "").startsWith("iPhone"));
  if (preferred) return preferred;
  if (available[0]) return available[0];
  throw new Error("No available paired iPhone or iPad was found. Unlock the device and connect it by USB or trusted Wi-Fi.");
}

function requireResult(result, message, options = {}) {
  if (result.status === 0) return result;
  if (options.includeDetail === false) throw new Error(message);
  const detail = safeError(`${result.stdout || ""} ${result.stderr || ""}`);
  throw new Error(detail ? `${message}: ${detail}` : message);
}

function readBundleIdentifier(appPath) {
  const result = requireResult(run("plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    path.join(appPath, "Info.plist"),
  ]), "Could not read the iOS app bundle identifier");
  return String(result.stdout || "").trim();
}

function verifySignedCloudKitApp(appPath, bundleId, containerId) {
  requireResult(
    run("codesign", ["--verify", "--strict", "--deep", appPath]),
    "The iOS app is not signed correctly",
  );
  const inspected = requireResult(
    run("codesign", ["-d", "--entitlements", ":-", appPath]),
    "Could not inspect the iOS app entitlements",
  );
  const entitlements = `${inspected.stdout || ""}\n${inspected.stderr || ""}`;
  if (!entitlements.includes(containerId) || !entitlements.includes("aps-environment")) {
    throw new Error("The signed iOS app is missing the requested CloudKit container or APNs entitlement.");
  }
  const actualBundleId = readBundleIdentifier(appPath);
  if (actualBundleId !== bundleId) {
    throw new Error("The signed iOS app bundle identifier does not match the configured OwnOrbit identifier.");
  }
}

export function buildDeviceInstallEvidence({ device, bundleId, containerId, now = new Date() }) {
  return {
    schema: "ownorbit-ios-device-install-evidence.v1",
    generatedAt: now.toISOString(),
    ok: true,
    app: {
      bundleId,
      cloudKitContainerIdHash: deviceIdHash(containerId),
      signed: true,
      cloudKitEntitlementsVerified: true,
      pathReturned: false,
    },
    device: {
      identifierHash: deviceIdHash(device?.identifier),
      identifierReturned: false,
      platform: device?.hardwareProperties?.platform || "iOS",
      productType: device?.hardwareProperties?.productType || "unknown",
      paired: device?.connectionProperties?.pairingState === "paired",
      available: isInstallableAppleDevice(device),
    },
    install: { completed: true },
    launch: { completed: true },
    claimBoundary: "Installation and launch do not prove CloudKit exchange, background delivery, cellular recovery, or conflict-safe two-device sync.",
  };
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("Installing the OwnOrbit native shell requires macOS and Xcode.");
  }

  const appPath = path.resolve(process.env.LIFEOS_IOS_NATIVE_APP_PATH || defaultAppPath);
  const bundleId = String(process.env.LIFEOS_CLOUDKIT_MOBILE_BUNDLE_ID || "com.wgjfry.ownorbit.mobile").trim();
  const containerId = String(process.env.LIFEOS_CLOUDKIT_CONTAINER_ID || "iCloud.ai.lifeos.desktop").trim();
  const requestedDevice = String(process.env.LIFEOS_IOS_DEVICE_ID || "").trim();
  const evidencePath = path.resolve(
    process.env.LIFEOS_IOS_DEVICE_EVIDENCE_OUT
      || path.join(rootDir, "build", "native", "mobile-shell", "device-install-evidence.json"),
  );
  if (!existsSync(appPath)) {
    throw new Error("The signed iOS app is missing. Run npm run mobile:native:device:build first.");
  }

  verifySignedCloudKitApp(appPath, bundleId, containerId);
  const temporaryDir = mkdtempSync(path.join(os.tmpdir(), "ownorbit-ios-install-"));
  try {
    const devicesPath = path.join(temporaryDir, "devices.json");
    requireResult(
      run("xcrun", ["devicectl", "list", "devices", "--json-output", devicesPath, "--quiet"]),
      "Xcode could not list paired Apple devices",
      { includeDetail: false },
    );
    const payload = JSON.parse(readFileSync(devicesPath, "utf8"));
    const device = selectInstallDevice(payload?.result?.devices, requestedDevice);

    requireResult(
      run("xcrun", [
        "devicectl",
        "device",
        "install",
        "app",
        "--device",
        device.identifier,
        "--timeout",
        "120",
        "--quiet",
        appPath,
      ]),
      "Xcode could not install OwnOrbit Mobile",
      { includeDetail: false },
    );
    requireResult(
      run("xcrun", [
        "devicectl",
        "device",
        "process",
        "launch",
        "--device",
        device.identifier,
        "--terminate-existing",
        "--quiet",
        bundleId,
      ]),
      "OwnOrbit Mobile was installed but could not be launched",
      { includeDetail: false },
    );

    const evidence = buildDeviceInstallEvidence({ device, bundleId, containerId });
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    console.log(`[PASS] Signed OwnOrbit Mobile installed and launched on ${evidence.device.productType}.`);
    console.log(`[PASS] Redacted evidence: ${path.relative(rootDir, evidencePath)}`);
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[FAIL] ${safeError(error?.message || error)}`);
    process.exitCode = 1;
  }
}
