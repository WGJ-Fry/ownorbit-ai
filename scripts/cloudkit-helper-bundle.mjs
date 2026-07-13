import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLOUDKIT_HELPER_BUNDLE_SCHEMA = "lifeos-cloudkit-helper-bundle.v1";
export const CLOUDKIT_HELPER_APP_NAME = "LifeOSCloudKitHelper.app";
export const CLOUDKIT_HELPER_EXECUTABLE_RELATIVE_PATH = "native/LifeOSCloudKitHelper.app/Contents/MacOS/LifeOSCloudKitHelper";
export const CLOUDKIT_HELPER_ENTITLEMENTS_RELATIVE_PATH = "native/LifeOSCloudKitHelper.entitlements.plist";
export const CLOUDKIT_HELPER_MANIFEST_NAME = "cloudkit-helper.json";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(moduleDir, "..");

function compact(value, limit = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function validContainerId(value) {
  return /^iCloud\.[A-Za-z0-9.-]{3,150}$/.test(String(value || ""));
}

function validIdentifier(value) {
  return /^[A-Za-z0-9][A-Za-z0-9.-]{2,180}$/.test(String(value || ""));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function extractXml(value) {
  const text = String(value || "");
  const start = text.indexOf("<?xml");
  const end = text.lastIndexOf("</plist>");
  return start >= 0 && end > start ? text.slice(start, end + "</plist>".length) : "";
}

function plistValue(plistPath, key) {
  const result = run("plutil", ["-extract", key, "raw", "-o", "-", plistPath]);
  return result.ok ? result.stdout.trim() : "";
}

function plistJson(xml) {
  const result = run("plutil", ["-convert", "json", "-o", "-", "--", "-"], { input: xml });
  if (!result.ok) throw new Error("The helper entitlements could not be parsed.");
  return JSON.parse(result.stdout || "{}");
}

export function inspectSignedCloudKitHelperApp(sourceApp) {
  if (process.platform !== "darwin") throw new Error("A signed CloudKit helper can only be inspected on macOS.");
  const resolved = path.resolve(String(sourceApp || ""));
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || path.extname(resolved) !== ".app") throw new Error("The CloudKit helper source must be a macOS .app bundle.");
  const infoPlist = path.join(resolved, "Contents", "Info.plist");
  const executableName = plistValue(infoPlist, "CFBundleExecutable");
  const bundleId = plistValue(infoPlist, "CFBundleIdentifier");
  if (!validIdentifier(executableName) || !validIdentifier(bundleId)) throw new Error("The CloudKit helper Info.plist is incomplete.");
  const executablePath = path.join(resolved, "Contents", "MacOS", executableName);
  if (!fs.statSync(executablePath, { throwIfNoEntry: false })?.isFile()) throw new Error("The CloudKit helper executable is missing.");

  const signature = run("codesign", ["--verify", "--strict", "--deep", resolved]);
  if (!signature.ok) throw new Error("The CloudKit helper app does not have a valid code signature.");
  const displayed = run("codesign", ["-d", "--entitlements", ":-", executablePath]);
  const entitlementsXml = extractXml(`${displayed.stdout}\n${displayed.stderr}`);
  if (!displayed.ok || !entitlementsXml) throw new Error("The CloudKit helper signature does not expose readable entitlements.");
  const entitlements = plistJson(entitlementsXml);
  const containers = Array.isArray(entitlements["com.apple.developer.icloud-container-identifiers"])
    ? entitlements["com.apple.developer.icloud-container-identifiers"].map(String)
    : [];
  const cloudServices = Array.isArray(entitlements["com.apple.developer.icloud-services"])
    ? entitlements["com.apple.developer.icloud-services"].map(String)
    : [];
  const containerId = containers.find(validContainerId) || "";
  const teamId = compact(entitlements["com.apple.developer.team-identifier"], 40);
  const apsEnvironment = compact(entitlements["com.apple.developer.aps-environment"], 20).toLowerCase();
  if (!containerId || !cloudServices.includes("CloudKit") || !teamId || !["development", "production"].includes(apsEnvironment)) {
    throw new Error("The CloudKit helper is missing its container, CloudKit service, team, or APNs entitlement.");
  }
  return {
    sourceApp: resolved,
    executableName,
    bundleId,
    containerId,
    teamId,
    environment: apsEnvironment === "production" ? "Production" : "Development",
    entitlementsXml,
  };
}

function absentManifest(reason) {
  return {
    schema: CLOUDKIT_HELPER_BUNDLE_SCHEMA,
    included: false,
    verified: false,
    reason: compact(reason, 80) || "not-configured",
    helperRelativePath: "",
    entitlementsRelativePath: "",
    containerId: "",
    bundleId: "",
    teamId: "",
    environment: "",
    rawSecretsIncluded: false,
    localSourcePathIncluded: false,
  };
}

function writeManifest(outputDir, manifest) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, CLOUDKIT_HELPER_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

export function stageCloudKitHelper(options = {}) {
  const rootDir = path.resolve(options.rootDir || defaultRootDir);
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, "build", "desktop-resources"));
  const configuredSource = String(options.sourceApp || process.env.LIFEOS_CLOUDKIT_HELPER_APP || "").trim();
  const hasExplicitSource = Boolean(configuredSource);
  const sourceApp = path.resolve(configuredSource || path.join(rootDir, "build", "native", "cloudkit-helper-xcode", "DerivedData", "Build", "Products", "Release", CLOUDKIT_HELPER_APP_NAME));
  const required = options.required ?? process.env.LIFEOS_REQUIRE_BUNDLED_CLOUDKIT_HELPER === "1";
  const inspect = options.inspect || inspectSignedCloudKitHelperApp;

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(sourceApp)) {
    if (required || hasExplicitSource) {
      throw new Error(hasExplicitSource
        ? "LIFEOS_CLOUDKIT_HELPER_APP was configured, but the signed helper app was not found."
        : "A bundled CloudKit helper was required, but no signed helper app was found.");
    }
    const manifest = absentManifest("signed-helper-not-found");
    writeManifest(outputDir, manifest);
    return { outputDir, manifest };
  }

  let inspected;
  try {
    inspected = inspect(sourceApp);
  } catch (error) {
    if (required || configuredSource) throw error;
    const manifest = absentManifest("signed-helper-invalid");
    writeManifest(outputDir, manifest);
    return { outputDir, manifest };
  }
  const configuredContainer = compact(options.containerId || process.env.LIFEOS_CLOUDKIT_CONTAINER_ID, 160);
  if (configuredContainer && configuredContainer !== inspected.containerId) {
    throw new Error("The signed helper CloudKit container does not match LIFEOS_CLOUDKIT_CONTAINER_ID.");
  }
  const destinationApp = path.join(outputDir, "native", CLOUDKIT_HELPER_APP_NAME);
  fs.mkdirSync(path.dirname(destinationApp), { recursive: true });
  fs.cpSync(inspected.sourceApp || sourceApp, destinationApp, { recursive: true, preserveTimestamps: true });
  const entitlementsPath = path.join(outputDir, CLOUDKIT_HELPER_ENTITLEMENTS_RELATIVE_PATH);
  fs.writeFileSync(entitlementsPath, inspected.entitlementsXml, { mode: 0o600 });
  const manifest = {
    schema: CLOUDKIT_HELPER_BUNDLE_SCHEMA,
    included: true,
    verified: true,
    reason: "signed-helper-staged",
    helperRelativePath: CLOUDKIT_HELPER_EXECUTABLE_RELATIVE_PATH,
    entitlementsRelativePath: CLOUDKIT_HELPER_ENTITLEMENTS_RELATIVE_PATH,
    containerId: inspected.containerId,
    bundleId: inspected.bundleId,
    teamId: inspected.teamId,
    environment: inspected.environment,
    rawSecretsIncluded: false,
    localSourcePathIncluded: false,
  };
  writeManifest(outputDir, manifest);
  return { outputDir, manifest };
}
