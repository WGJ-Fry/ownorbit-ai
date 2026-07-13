const fs = require("fs");
const path = require("path");

const CLOUDKIT_HELPER_BUNDLE_SCHEMA = "lifeos-cloudkit-helper-bundle.v1";
const CLOUDKIT_HELPER_MANIFEST_NAME = "cloudkit-helper.json";
const MAX_MANIFEST_BYTES = 32 * 1024;

function validContainerId(value) {
  return /^iCloud\.[A-Za-z0-9.-]{3,150}$/.test(String(value || ""));
}

function validIdentifier(value, limit = 180) {
  const input = String(value || "");
  return input.length <= limit && /^[A-Za-z0-9][A-Za-z0-9.-]{2,180}$/.test(input);
}

function executable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeChildPath(root, relativePath) {
  const relative = String(relativePath || "");
  if (!relative || path.isAbsolute(relative) || relative.includes("..") || relative.includes("\\")) return "";
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  return resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : "";
}

function readBundleManifest(root) {
  const manifestPath = path.join(root, CLOUDKIT_HELPER_MANIFEST_NAME);
  try {
    const stat = fs.statSync(manifestPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest && typeof manifest === "object" ? manifest : null;
  } catch {
    return null;
  }
}

function publicCloudKitHelperRuntimeStatus(result) {
  return {
    available: Boolean(result?.available),
    source: ["explicit", "bundled", "none"].includes(result?.source) ? result.source : "none",
    reason: String(result?.reason || "not-configured").slice(0, 80),
    bundled: result?.source === "bundled",
    manifestVerified: Boolean(result?.manifestVerified),
    containerConfigured: Boolean(result?.containerId),
    identityConfigured: Boolean(result?.bundleId && result?.teamId),
    entitlementsConfigured: Boolean(result?.entitlementsPath),
    helperPathReturned: false,
    entitlementsPathReturned: false,
  };
}

function resolveCloudKitHelperRuntime(options = {}) {
  const environment = options.environment || process.env;
  const explicitPath = String(environment.LIFEOS_CLOUDKIT_HELPER_BIN || "").trim();
  if (explicitPath) {
    const helperPath = path.resolve(explicitPath);
    return {
      available: executable(helperPath),
      source: "explicit",
      reason: executable(helperPath) ? "explicit-helper" : "explicit-helper-missing",
      helperPath,
      entitlementsPath: String(environment.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH || "").trim(),
      containerId: String(environment.LIFEOS_CLOUDKIT_CONTAINER_ID || "").trim(),
      bundleId: String(environment.LIFEOS_CLOUDKIT_BUNDLE_ID || "").trim(),
      teamId: String(environment.LIFEOS_CLOUDKIT_TEAM_ID || environment.APPLE_TEAM_ID || "").trim(),
      manifestVerified: false,
    };
  }

  const configuredResourcesPath = String(options.resourcesPath || "").trim();
  const root = configuredResourcesPath ? path.join(path.resolve(configuredResourcesPath), "lifeos-resources") : "";
  const manifest = root ? readBundleManifest(root) : null;
  if (!manifest) return { available: false, source: "none", reason: "bundle-manifest-missing", manifestVerified: false };
  if (manifest.schema !== CLOUDKIT_HELPER_BUNDLE_SCHEMA) return { available: false, source: "none", reason: "bundle-manifest-invalid", manifestVerified: false };
  if (!manifest.included) return { available: false, source: "none", reason: String(manifest.reason || "signed-helper-not-included").slice(0, 80), manifestVerified: false };
  const helperPath = safeChildPath(root, manifest.helperRelativePath);
  const entitlementsPath = safeChildPath(root, manifest.entitlementsRelativePath);
  const metadataValid = manifest.verified === true
    && validContainerId(manifest.containerId)
    && validIdentifier(manifest.bundleId)
    && validIdentifier(manifest.teamId, 40)
    && ["Development", "Production"].includes(manifest.environment)
    && manifest.rawSecretsIncluded === false
    && manifest.localSourcePathIncluded === false;
  const available = metadataValid && executable(helperPath) && Boolean(entitlementsPath && fs.statSync(entitlementsPath, { throwIfNoEntry: false })?.isFile());
  return {
    available,
    source: available ? "bundled" : "none",
    reason: available ? "bundled-helper" : "bundled-helper-invalid",
    helperPath,
    entitlementsPath,
    containerId: metadataValid ? manifest.containerId : "",
    bundleId: metadataValid ? manifest.bundleId : "",
    teamId: metadataValid ? manifest.teamId : "",
    environment: metadataValid ? manifest.environment : "",
    manifestVerified: available,
  };
}

function applyCloudKitHelperRuntimeEnvironment(result, environment = process.env) {
  if (!result?.available) return publicCloudKitHelperRuntimeStatus(result);
  environment.LIFEOS_CLOUDKIT_HELPER_BIN ||= result.helperPath;
  environment.LIFEOS_CLOUDKIT_ENTITLEMENTS_PATH ||= result.entitlementsPath;
  environment.LIFEOS_CLOUDKIT_CONTAINER_ID ||= result.containerId;
  environment.LIFEOS_CLOUDKIT_BUNDLE_ID ||= result.bundleId;
  environment.LIFEOS_CLOUDKIT_TEAM_ID ||= result.teamId;
  environment.LIFEOS_CLOUDKIT_ENVIRONMENT ||= result.environment;
  return publicCloudKitHelperRuntimeStatus(result);
}

module.exports = {
  CLOUDKIT_HELPER_BUNDLE_SCHEMA,
  applyCloudKitHelperRuntimeEnvironment,
  publicCloudKitHelperRuntimeStatus,
  readBundleManifest,
  resolveCloudKitHelperRuntime,
};
