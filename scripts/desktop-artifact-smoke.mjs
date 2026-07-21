import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const releaseDir = process.env.LIFEOS_RELEASE_DIR ? path.resolve(process.env.LIFEOS_RELEASE_DIR) : path.join(rootDir, "release");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const productName = packageJson.build?.productName || "OwnOrbit AI";

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function parseVersion(version) {
  const match = String(version || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(version, minimum) {
  const actual = parseVersion(version);
  const required = parseVersion(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function sha512(file) {
  return crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function findMacAsar() {
  const matches = walk(releaseDir).filter((file) => file.endsWith(`${productName}.app/Contents/Resources/app.asar`));
  return matches[0] || "";
}

function findMacAppBinary() {
  const matches = walk(releaseDir).filter((file) => file.endsWith(`${productName}.app/Contents/MacOS/${productName}`));
  return matches[0] || "";
}

function findMacRendererHelper() {
  const matches = walk(releaseDir).filter((file) => file.endsWith(`${productName}.app/Contents/Frameworks/${productName} Helper (Renderer).app/Contents/MacOS/${productName} Helper (Renderer)`));
  return matches[0] || "";
}

function findWindowsUnpackedBinary() {
  const expected = path.join(releaseDir, "win-unpacked", `${productName}.exe`);
  if (fs.existsSync(expected)) return expected;
  const matches = walk(releaseDir).filter((file) => {
    const parts = path.relative(releaseDir, file).split(path.sep);
    return parts.includes("win-unpacked") && path.basename(file) === `${productName}.exe`;
  });
  return matches[0] || "";
}

function findLinuxUnpackedBinary() {
  const expected = path.join(releaseDir, "linux-unpacked", packageJson.name);
  if (fs.existsSync(expected)) return expected;
  const matches = walk(releaseDir).filter((file) => {
    const parts = path.relative(releaseDir, file).split(path.sep);
    return parts.includes("linux-unpacked") && [packageJson.name, productName].includes(path.basename(file));
  });
  return matches[0] || "";
}

function findSignedMacDmg() {
  const arch = process.env.npm_config_arch || process.arch;
  const expected = path.join(releaseDir, `${productName}-${packageJson.version}-${arch}.dmg`);
  if (fs.existsSync(expected)) return expected;
  const matches = walk(releaseDir).filter((file) => file.endsWith(`/${productName}-${packageJson.version}-${arch}.dmg`) || file.endsWith(`/${productName}-${packageJson.version}.dmg`));
  return matches[0] || "";
}

function findUnsignedMacZip() {
  const arch = process.env.npm_config_arch || process.arch;
  const expected = path.join(releaseDir, `${productName}-${packageJson.version}-${arch}-unsigned.zip`);
  if (fs.existsSync(expected)) return expected;
  const matches = walk(releaseDir).filter((file) => file.endsWith(`/${productName}-${packageJson.version}-${arch}-unsigned.zip`) || file.endsWith(`/${productName}-${packageJson.version}-unsigned.zip`));
  return matches[0] || "";
}

function extractUnsignedMacApp() {
  const zipPath = findUnsignedMacZip();
  if (!zipPath) return null;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-unsigned-app-"));
  const result = spawnSync("ditto", ["-x", "-k", zipPath, tempRoot], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    fail(`failed to extract unsigned macOS zip for verification\n${result.stdout || ""}${result.stderr || ""}`);
  }
  const appPath = path.join(tempRoot, `${productName}.app`);
  if (!fs.existsSync(appPath)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    fail("unsigned macOS zip did not contain the app bundle");
  }
  return { appPath, tempRoot };
}

function detachMountedImage(imagePath) {
  const result = spawnSync("hdiutil", ["info"], { cwd: rootDir, encoding: "utf8" });
  if (result.status !== 0) return;
  const normalized = path.resolve(imagePath);
  const sections = String(result.stdout || "").split("================================================");
  for (const section of sections) {
    if (!section.includes(`image-path      : ${normalized}`)) continue;
    const deviceMatch = section.match(/(\/dev\/disk\d+)\s+GUID_partition_scheme/);
    if (!deviceMatch?.[1]) continue;
    spawnSync("hdiutil", ["detach", deviceMatch[1], "-force"], { cwd: rootDir, stdio: "ignore" });
  }
}

function setLaunchctlEnv(key, value) {
  spawnSync("launchctl", ["setenv", key, value], { cwd: rootDir, stdio: "ignore" });
}

function unsetLaunchctlEnv(key) {
  spawnSync("launchctl", ["unsetenv", key], { cwd: rootDir, stdio: "ignore" });
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function stopPackagedApp(appPath) {
  spawnSync("pkill", ["-TERM", "-f", appPath], { cwd: rootDir, stdio: "ignore" });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const running = spawnSync("pgrep", ["-f", appPath], { cwd: rootDir, stdio: "ignore" });
    if (running.status !== 0) return;
    sleepSync(100);
  }
  spawnSync("pkill", ["-KILL", "-f", appPath], { cwd: rootDir, stdio: "ignore" });
  sleepSync(100);
}

function macAppPathFromBinary(binary) {
  return binary.slice(0, binary.lastIndexOf(".app/Contents/MacOS/") + 4);
}

function macAppBinaryFromAppPath(appPath) {
  return path.join(appPath, "Contents", "MacOS", productName);
}

function macRendererHelperFromAppPath(appPath) {
  return path.join(appPath, "Contents", "Frameworks", `${productName} Helper (Renderer).app`, "Contents", "MacOS", `${productName} Helper (Renderer)`);
}

function detectInterruptedMacBundle(appPath) {
  const result = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  const interrupted = result.status !== 0 && combined.includes("code has no resources but signature indicates they must be present");
  return { interrupted, combined };
}

function checkInstallGuide() {
  const guidePath = path.join(releaseDir, "INSTALL-unsigned-mac.md");
  if (!fs.existsSync(guidePath)) {
    if (process.platform === "darwin") fail("missing unsigned macOS install guide");
    console.log("[SKIP] unsigned macOS install guide check is macOS-only when the guide is not present");
  } else {
    const guide = fs.readFileSync(guidePath, "utf8");
    for (const pattern of [/Move .*\.app.*Applications/i, /Open Anyway|unidentified developer|Gatekeeper/i, /admin password/i, /AI provider/i, /backup/i, /bind the mobile PWA/i, /Export Diagnostics/i]) {
      if (!pattern.test(guide)) fail(`install guide is missing expected guidance: ${pattern}`);
    }
    pass("unsigned macOS install guide covers install, Gatekeeper, first launch, backup, binding, and diagnostics");
  }

  const userGuidePath = path.join(releaseDir, "USER-INSTALL.md");
  if (!fs.existsSync(userGuidePath)) {
    console.log("[SKIP] release user install guide is not present in this platform-specific smoke output");
  } else {
    const userGuide = fs.readFileSync(userGuidePath, "utf8");
    for (const pattern of [/macOS Unsigned Zip/i, /Windows NSIS Installer/i, /Linux AppImage/i, /First Launch/i, /Bind The Phone PWA/i, /Use It Away From Home/i, /Backups/i, /Troubleshooting/i, /SmartScreen/i, /chmod \+x/i, /shasum -a 256 "LifeOS\.AI-/i, /filename mismatch/i, /Get-FileHash/i, /Open Local Console In Browser/i, /Copy Local Address/i, /Do not add the unbound QR page to the home screen/i, /delete the old home-screen icon/i]) {
      if (!pattern.test(userGuide)) fail(`release user install guide is missing expected guidance: ${pattern}`);
    }
    pass("release directory includes user install guide for non-developer setup");
  }
}

function checkUpdateFeed() {
  const manifestPath = path.join(releaseDir, "update-feed", "release-manifest.json");
  if (!fs.existsSync(manifestPath)) fail("missing update-feed/release-manifest.json");
  const checksumPath = path.join(releaseDir, "SHA256SUMS");
  if (!fs.existsSync(checksumPath)) fail("missing release/SHA256SUMS");
  const checksums = fs.readFileSync(checksumPath, "utf8");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.version !== packageJson.version) fail(`release manifest version ${manifest.version} does not match package ${packageJson.version}`);
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) fail("release manifest has no artifacts");
  for (const artifact of manifest.artifacts) {
    const artifactPath = path.join(releaseDir, "update-feed", artifact.fileName || "");
    const rootArtifactPath = path.join(releaseDir, artifact.fileName || "");
    const feedPath = path.join(releaseDir, "update-feed", artifact.feedFile || "");
    if (!fs.existsSync(artifactPath)) fail(`manifest artifact missing from update-feed: ${artifact.fileName}`);
    if (fs.statSync(artifactPath).size !== artifact.size) fail(`manifest size mismatch: ${artifact.fileName}`);
    if (sha512(artifactPath) !== artifact.sha512) fail(`manifest sha512 mismatch: ${artifact.fileName}`);
    if (!fs.existsSync(rootArtifactPath)) fail(`root artifact missing for SHA256SUMS: ${artifact.fileName}`);
    const artifactSha256 = sha256(rootArtifactPath);
    if (artifact.sha256 !== artifactSha256) fail(`manifest sha256 mismatch: ${artifact.fileName}`);
    if (!checksums.includes(`${artifactSha256}  ${artifact.fileName}`)) fail(`SHA256SUMS does not include ${artifact.fileName}`);
    if (!fs.existsSync(feedPath)) fail(`manifest feed file missing: ${artifact.feedFile}`);
    const feed = fs.readFileSync(feedPath, "utf8");
    if (!feed.includes(artifact.fileName) || !feed.includes(artifact.sha512)) fail(`feed does not reference artifact and hash: ${artifact.feedFile}`);
  }
  pass(`update feed manifest verifies ${manifest.artifacts.length} artifact(s)`);
  pass("release SHA256SUMS verifies downloadable artifacts");
}

function checkUnsignedZip() {
  if (process.platform !== "darwin") {
    console.log("[SKIP] unsigned macOS zip check is macOS-only");
    return;
  }
  const zipPath = path.join(releaseDir, `${productName}-${packageJson.version}-${process.env.npm_config_arch || process.arch}-unsigned.zip`);
  if (!fs.existsSync(zipPath)) fail(`missing unsigned macOS zip: ${path.relative(rootDir, zipPath)}`);
  if (fs.statSync(zipPath).size < 1024 * 1024) fail("unsigned macOS zip is unexpectedly small");
  pass(`unsigned macOS zip exists: ${path.relative(rootDir, zipPath)}`);
}

function checkPackagedAsar() {
  if (process.platform !== "darwin") {
    console.log("[SKIP] packaged macOS asar check is macOS-only");
    return;
  }
  const asarPath = findMacAsar();
  if (!asarPath) fail("packaged macOS app.asar was not found");
  const entries = new Set(asar.listPackage(asarPath));
  const requiredEntries = [
    "/desktop/main.cjs",
    "/dist/server.cjs",
    "/dist/index.html",
    "/package.json",
  ];
  const missing = requiredEntries.filter((entry) => !entries.has(entry));
  if (missing.length) fail(`packaged app.asar is missing: ${missing.join(", ")}`);
  const desktopMain = asar.extractFile(asarPath, "desktop/main.cjs").toString("utf8");
  if (!desktopMain.includes("showStartupFailureWindow") || !desktopMain.includes("exportDesktopDiagnosticBundle")) {
    fail("packaged desktop shell is missing startup failure or diagnostics support");
  }
  pass("packaged macOS app.asar contains desktop shell, local core, web UI, and diagnostics support");
}

function checkPackagedPackageMetadata() {
  if (process.platform !== "darwin") {
    console.log("[SKIP] packaged package metadata check is macOS-only");
    return;
  }
  const asarPath = findMacAsar();
  if (!asarPath) fail("packaged macOS app.asar was not found");
  const packagedPackage = JSON.parse(asar.extractFile(asarPath, "package.json").toString("utf8"));
  const allDeps = { ...(packagedPackage.dependencies || {}), ...(packagedPackage.devDependencies || {}) };
  if (allDeps.vite && !versionAtLeast(allDeps.vite, "8.0.0")) fail("packaged package metadata contains an unsafe Vite version");
  if (allDeps["@vitejs/plugin-react"] && !versionAtLeast(allDeps["@vitejs/plugin-react"], "6.0.0")) fail("packaged package metadata contains a Vite-incompatible React plugin version");
  if (allDeps.esbuild && !versionAtLeast(allDeps.esbuild, "0.28.1")) fail("packaged package metadata contains an unsafe esbuild version");
  if (packagedPackage.overrides?.esbuild && packagedPackage.overrides.esbuild !== "$esbuild") fail("packaged package metadata contains an unsafe transitive esbuild override");
  pass("packaged macOS app package metadata contains no unsafe Vite/esbuild build tooling");
}

function packagedCloudKitHelperManifests() {
  return walk(releaseDir).filter((file) => {
    const normalized = file.split(path.sep).join("/").toLowerCase();
    return normalized.endsWith("/resources/lifeos-resources/cloudkit-helper.json");
  });
}

function safePackagedResourcePath(root, relativePath) {
  const relative = String(relativePath || "");
  if (!relative || path.isAbsolute(relative) || relative.includes("..") || relative.includes("\\")) return "";
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  return resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : "";
}

function plistXml(value) {
  const source = String(value || "");
  const start = source.indexOf("<?xml");
  const end = source.lastIndexOf("</plist>");
  return start >= 0 && end > start ? source.slice(start, end + "</plist>".length) : "";
}

function parsePlistXml(value, label) {
  const xml = plistXml(value);
  if (!xml) fail(`${label} did not contain a readable plist`);
  const result = spawnSync("plutil", ["-convert", "json", "-o", "-", "--", "-"], {
    cwd: rootDir,
    encoding: "utf8",
    input: xml,
  });
  if (result.status !== 0) fail(`${label} could not be parsed`);
  return JSON.parse(result.stdout || "{}");
}

function verifyPackagedCloudKitHelperSignature(helperPath, entitlementsPath, manifest) {
  if (process.platform !== "darwin") return;
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = helperPath.indexOf(marker);
  if (markerIndex < 0) fail("packaged CloudKit helper executable is not inside a macOS app bundle");
  const helperApp = helperPath.slice(0, markerIndex);
  const signature = spawnSync("codesign", ["--verify", "--strict", "--deep", helperApp], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (signature.status !== 0) fail(`packaged CloudKit helper signature is invalid\n${signature.stdout || ""}${signature.stderr || ""}`);
  const signatureDetailsResult = spawnSync("codesign", ["-dv", "--verbose=4", helperApp], {
    cwd: rootDir,
    encoding: "utf8",
  });
  const signatureDetails = `${signatureDetailsResult.stdout || ""}\n${signatureDetailsResult.stderr || ""}`;
  const displayed = spawnSync("codesign", ["-d", "--entitlements", ":-", helperPath], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (displayed.status !== 0) fail("packaged CloudKit helper signed entitlements are unreadable");
  const signedEntitlements = parsePlistXml(`${displayed.stdout || ""}\n${displayed.stderr || ""}`, "packaged CloudKit helper signed entitlements");
  const stagedEntitlements = parsePlistXml(fs.readFileSync(entitlementsPath, "utf8"), "packaged CloudKit helper staged entitlements");
  const signedContainers = Array.isArray(signedEntitlements["com.apple.developer.icloud-container-identifiers"])
    ? signedEntitlements["com.apple.developer.icloud-container-identifiers"].map(String)
    : [];
  const signedServices = Array.isArray(signedEntitlements["com.apple.developer.icloud-services"])
    ? signedEntitlements["com.apple.developer.icloud-services"].map(String)
    : [];
  const signedEnvironment = String(signedEntitlements["com.apple.developer.aps-environment"] || "").toLowerCase();
  const expectedEnvironment = String(manifest.environment || "").toLowerCase();
  if (!signedContainers.includes(manifest.containerId) || !signedServices.includes("CloudKit")) fail("packaged CloudKit helper lost its signed CloudKit entitlement");
  if (String(signedEntitlements["com.apple.developer.team-identifier"] || "") !== manifest.teamId) fail("packaged CloudKit helper signed team does not match its manifest");
  if (signedEnvironment !== expectedEnvironment) fail("packaged CloudKit helper signed APNs environment does not match its manifest");
  for (const key of ["com.apple.developer.icloud-container-identifiers", "com.apple.developer.icloud-services", "com.apple.developer.team-identifier", "com.apple.developer.aps-environment"]) {
    if (JSON.stringify(stagedEntitlements[key]) !== JSON.stringify(signedEntitlements[key])) fail(`packaged CloudKit helper staged entitlement drifted from the signed value: ${key}`);
  }
  const bundleId = spawnSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(helperApp, "Contents", "Info.plist")], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (bundleId.status !== 0 || bundleId.stdout.trim() !== manifest.bundleId) fail("packaged CloudKit helper bundle id does not match its manifest");
  if (manifest.distribution === "developer-id") {
    const profile = spawnSync("security", ["cms", "-D", "-i", path.join(helperApp, "Contents", "embedded.provisionprofile")], {
      cwd: rootDir,
      encoding: "utf8",
    });
    const profileXml = String(profile.stdout || "");
    const isDeviceIndependent = /<key>ProvisionsAllDevices<\/key>\s*<true\s*\/>/.test(profileXml)
      && !profileXml.includes("<key>ProvisionedDevices</key>");
    if (
      signatureDetailsResult.status !== 0
      || !signatureDetails.includes("Authority=Developer ID Application:")
      || !signatureDetails.includes("runtime")
      || signedEnvironment !== "production"
      || signedEntitlements["com.apple.security.get-task-allow"] === true
      || profile.status !== 0
      || !isDeviceIndependent
    ) {
      fail("packaged CloudKit helper is not a device-independent Developer ID Production build");
    }
    const assessment = spawnSync("spctl", ["--assess", "--type", "execute", "--verbose=4", helperApp], {
      cwd: rootDir,
      encoding: "utf8",
    });
    const assessmentDetails = `${assessment.stdout || ""}\n${assessment.stderr || ""}`;
    const assessedNotarized = assessment.status === 0 && assessmentDetails.includes("Notarized Developer ID");
    if (manifest.notarized !== assessedNotarized) fail("packaged CloudKit helper notarization metadata does not match Gatekeeper assessment");
    if (assessedNotarized) {
      const staple = spawnSync("xcrun", ["stapler", "validate", helperApp], { cwd: rootDir, encoding: "utf8" });
      if (staple.status !== 0) fail("packaged CloudKit helper notarization ticket is not stapled or valid");
    }
  }
}

function checkCloudKitHelperResourceManifest() {
  const manifests = packagedCloudKitHelperManifests();
  if (manifests.length === 0) fail("packaged app is missing the CloudKit helper resource manifest");
  for (const manifestPath of manifests) {
    const source = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(source);
    if (manifest.schema !== "lifeos-cloudkit-helper-bundle.v1") fail("packaged CloudKit helper manifest has an unknown schema");
    if (manifest.rawSecretsIncluded !== false || manifest.localSourcePathIncluded !== false) {
      fail("packaged CloudKit helper manifest does not prove secret and local-path redaction");
    }
    if (manifest.sourceApp || manifest.sourcePath || source.includes("/Users/") || /[A-Za-z]:\\\\Users\\/.test(source)) {
      fail("packaged CloudKit helper manifest contains a local source path");
    }
    const resourceRoot = path.dirname(manifestPath);
    if (!manifest.included) {
      if (manifest.verified !== false || manifest.helperRelativePath || manifest.entitlementsRelativePath) {
        fail("packaged CloudKit helper fallback manifest claims or references an unavailable helper");
      }
      continue;
    }
    if (manifest.verified !== true) fail("packaged CloudKit helper is included without verified metadata");
    if (!/^iCloud\.[A-Za-z0-9.-]{3,150}$/.test(String(manifest.containerId || ""))) fail("packaged CloudKit helper container metadata is invalid");
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{2,180}$/.test(String(manifest.bundleId || ""))) fail("packaged CloudKit helper bundle metadata is invalid");
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{2,40}$/.test(String(manifest.teamId || ""))) fail("packaged CloudKit helper team metadata is invalid");
    if (!["Development", "Production"].includes(manifest.environment)) fail("packaged CloudKit helper APNs environment is invalid");
    if (!["development", "developer-id"].includes(manifest.distribution)) fail("packaged CloudKit helper distribution metadata is invalid");
    if (typeof manifest.notarized !== "boolean") fail("packaged CloudKit helper notarization metadata is invalid");
    if (process.env.LIFEOS_REQUIRE_DISTRIBUTABLE_CLOUDKIT_HELPER === "1" && manifest.distribution !== "developer-id") {
      fail("packaged CloudKit helper is not a distributable Developer ID build");
    }
    if (process.env.LIFEOS_REQUIRE_NOTARIZED_CLOUDKIT_HELPER === "1" && manifest.notarized !== true) {
      fail("packaged CloudKit helper is not Apple-notarized and stapled");
    }
    const helperPath = safePackagedResourcePath(resourceRoot, manifest.helperRelativePath);
    const entitlementsPath = safePackagedResourcePath(resourceRoot, manifest.entitlementsRelativePath);
    if (!helperPath || !fs.statSync(helperPath, { throwIfNoEntry: false })?.isFile()) fail("packaged CloudKit helper executable is missing or outside its resource root");
    if (!entitlementsPath || !fs.statSync(entitlementsPath, { throwIfNoEntry: false })?.isFile()) fail("packaged CloudKit helper entitlements are missing or outside their resource root");
    verifyPackagedCloudKitHelperSignature(helperPath, entitlementsPath, manifest);
  }
  pass(`packaged CloudKit helper resource manifest verifies ${manifests.length} app bundle(s) without local paths or secrets`);
}

function checkPackagedMacSignature() {
  if (process.platform !== "darwin") {
    console.log("[SKIP] packaged macOS signature check is macOS-only");
    return;
  }
  const binary = findMacAppBinary();
  if (!binary) fail("packaged macOS app binary was not found");
  const appPath = macAppPathFromBinary(binary);
  const interrupted = detectInterruptedMacBundle(appPath);
  let verificationAppPath = appPath;
  let tempRoot = "";
  if (interrupted.interrupted) {
    const extracted = extractUnsignedMacApp();
    if (extracted) {
      verificationAppPath = extracted.appPath;
      tempRoot = extracted.tempRoot;
      console.log("[WARN] release/mac-arm64 contains an interrupted app bundle; verifying the app inside the unsigned release zip instead");
    }
  }
  const result = spawn("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  result.stdout.on("data", (chunk) => output.push(chunk.toString()));
  result.stderr.on("data", (chunk) => output.push(chunk.toString()));
  return new Promise((resolve) => {
    result.on("exit", (code) => {
      if (code !== 0) {
        const combined = output.join("");
        const signedDmgExists = Boolean(findSignedMacDmg());
        const interruptedBundle = combined.includes("code has no resources but signature indicates they must be present");
        if (process.env.LIFEOS_ARTIFACT_SMOKE_LAUNCH === "1" && signedDmgExists && interruptedBundle) {
          console.log("[WARN] release/mac-arm64 contains an interrupted app bundle; skipping direct signature verification and relying on the signed DMG launch smoke");
          if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          resolve();
          return;
        }
        if (verificationAppPath !== appPath && interruptedBundle) {
          const fallback = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", verificationAppPath], {
            cwd: rootDir,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
          if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          if (fallback.status === 0) {
            pass("packaged macOS app has a valid ad-hoc signature in the unsigned release zip");
            resolve();
            return;
          }
          fail(`packaged macOS app signature is invalid in release/mac-arm64 and unsigned zip\n${combined}${fallback.stdout || ""}${fallback.stderr || ""}`);
        }
        if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        fail(`packaged macOS app signature is invalid\n${combined}`);
      }
      if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      pass("packaged macOS app has a valid ad-hoc signature");
      resolve();
    });
  });
}

function checkPackagedMacEntitlements() {
  if (process.platform !== "darwin") {
    console.log("[SKIP] packaged macOS entitlement check is macOS-only");
    return;
  }
  const binary = findMacAppBinary();
  const rendererHelper = findMacRendererHelper();
  if (!binary) fail("packaged macOS app binary was not found");
  if (!rendererHelper) fail("packaged macOS renderer helper was not found");
  const appPath = macAppPathFromBinary(binary);
  const signedDmgExists = Boolean(findSignedMacDmg());
  const interruptedBundle = detectInterruptedMacBundle(appPath).interrupted;
  if (process.env.LIFEOS_ARTIFACT_SMOKE_LAUNCH === "1" && signedDmgExists && interruptedBundle) {
    console.log("[WARN] release/mac-arm64 contains an interrupted app bundle; skipping direct entitlement verification and relying on the signed DMG launch smoke");
    return;
  }
  let entitlementAppPath = appPath;
  let entitlementRendererHelper = rendererHelper;
  let tempRoot = "";
  if (interruptedBundle) {
    const extracted = extractUnsignedMacApp();
    if (extracted) {
      entitlementAppPath = extracted.appPath;
      entitlementRendererHelper = macRendererHelperFromAppPath(extracted.appPath);
      tempRoot = extracted.tempRoot;
      console.log("[WARN] release/mac-arm64 contains an interrupted app bundle; verifying entitlements inside the unsigned release zip instead");
    }
  }
  const requiredEntitlements = [
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
  ];
  return Promise.all([
    readEntitlements(entitlementAppPath),
    readEntitlements(macAppPathFromBinary(entitlementRendererHelper)),
  ]).then(([appEntitlements, rendererEntitlements]) => {
    for (const entitlement of requiredEntitlements) {
      if (!appEntitlements.includes(entitlement)) fail(`packaged macOS app is missing entitlement: ${entitlement}`);
      if (!rendererEntitlements.includes(entitlement)) fail(`packaged macOS renderer helper is missing entitlement: ${entitlement}`);
    }
    pass("packaged macOS app and renderer helper include Electron runtime entitlements");
  }).finally(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
}

function readEntitlements(targetPath) {
  const result = spawn("codesign", ["-d", "--entitlements", ":-", targetPath], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  result.stdout.on("data", (chunk) => output.push(chunk.toString()));
  result.stderr.on("data", (chunk) => output.push(chunk.toString()));
  return new Promise((resolve) => {
    result.on("exit", (code) => {
      if (code !== 0) fail(`failed to read packaged macOS entitlements: ${targetPath}\n${output.join("")}`);
      resolve(output.join(""));
    });
  });
}

function outputReportedPort(output) {
  const text = output.join("");
  const match = text.match(/Server running on http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
  return match ? Number(match[1]) : 0;
}

function candidateHealthPorts(port, output) {
  const reported = outputReportedPort(output);
  return [...new Set([
    reported,
    ...Array.from({ length: 16 }, (_, index) => port + index),
  ].filter((candidate) => Number.isInteger(candidate) && candidate > 0))];
}

function waitForHealth(port, child, output, options = {}) {
  const allowEarlyExit = Boolean(options.allowEarlyExit);
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (!allowEarlyExit && child.exitCode !== null) {
        reject(new Error(`packaged app exited early with code ${child.exitCode}\n${output.join("")}`));
        return;
      }
      probeHealthPorts(candidateHealthPorts(port, output)).then(resolve).catch(retry);
    };
    const retry = () => {
      if (Date.now() - startedAt > 20_000) {
        reject(new Error(`packaged app did not expose health in time\n${output.join("")}`));
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

function probeHealthPorts(ports) {
  return new Promise((resolve, reject) => {
    let index = 0;
    const probeNext = () => {
      const port = ports[index++];
      if (!port) {
        reject(new Error("health unavailable"));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/api/v1/health`, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          probeNext();
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.service === "lifeos-local-core") {
              resolve({ health: parsed, port });
              return;
            }
          } catch {}
          probeNext();
        });
      });
      req.setTimeout(1000, () => req.destroy(new Error("timeout")));
      req.on("error", probeNext);
    };
    probeNext();
  });
}

function fetchText(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${pathname}`, options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    req.setTimeout(5000, () => req.destroy(new Error(`timeout requesting ${pathname}`)));
    req.on("error", reject);
  });
}

async function launchPackagedMacApp() {
  if (process.platform !== "darwin") {
    console.log("[SKIP] packaged app launch smoke is macOS-only");
    return;
  }
  if (process.env.LIFEOS_ARTIFACT_SMOKE_LAUNCH !== "1") {
    console.log("[SKIP] set LIFEOS_ARTIFACT_SMOKE_LAUNCH=1 to launch the packaged macOS app");
    return;
  }
  const dmgPath = findSignedMacDmg();
  const extractedUnsigned = dmgPath ? null : extractUnsignedMacApp();
  if (!dmgPath && !extractedUnsigned) fail("signed macOS DMG or unsigned macOS zip was not found");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-artifact-smoke-"));
  const mountDir = path.join(tempRoot, "mount");
  const installRoot = path.join(os.homedir(), "Applications");
  const installedAppPath = path.join(installRoot, `${productName} Smoke.app`);
  const port = 7810 + Math.floor(Math.random() * 1000);
  fs.mkdirSync(mountDir, { recursive: true });
  fs.mkdirSync(installRoot, { recursive: true });
  fs.rmSync(installedAppPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const output = [];
  let sourceAppPath = "";
  if (dmgPath) {
    detachMountedImage(dmgPath);
    const attach = spawn("hdiutil", ["attach", dmgPath, "-mountpoint", mountDir, "-nobrowse", "-readonly"], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    attach.stdout.on("data", (chunk) => output.push(chunk.toString()));
    attach.stderr.on("data", (chunk) => output.push(chunk.toString()));
    await new Promise((resolve, reject) => {
      attach.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`failed to mount signed macOS DMG\n${output.join("")}`));
          return;
        }
        resolve();
      });
    });
    sourceAppPath = path.join(mountDir, `${productName}.app`);
    if (!fs.existsSync(sourceAppPath)) fail("signed macOS DMG did not contain the app bundle");
  } else {
    sourceAppPath = extractedUnsigned.appPath;
    console.log("[WARN] signed macOS DMG was not found; launching the app extracted from the unsigned release zip");
  }
  const installCopy = spawn("ditto", [sourceAppPath, installedAppPath], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  installCopy.stdout.on("data", (chunk) => output.push(chunk.toString()));
  installCopy.stderr.on("data", (chunk) => output.push(chunk.toString()));
  await new Promise((resolve, reject) => {
    installCopy.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`failed to copy signed macOS app with ditto\n${output.join("")}`));
        return;
      }
      resolve();
    });
  });
  spawnSync("xattr", ["-dr", "com.apple.provenance", installedAppPath], { cwd: rootDir, stdio: "ignore" });
  setLaunchctlEnv("LIFEOS_PORT", String(port));
  setLaunchctlEnv("LIFEOS_HOST", "127.0.0.1");
  setLaunchctlEnv("PUBLIC_BASE_URL", "");
  setLaunchctlEnv("APP_URL", "");
  setLaunchctlEnv("LIFEOS_ADMIN_PASSWORD", "");
  setLaunchctlEnv("LIFEOS_STARTUP_CONNECTIVITY_DELAY_MS", "30000");
  setLaunchctlEnv("LIFEOS_DESKTOP_USER_DATA_DIR", path.join(tempRoot, "userData"));
  const child = spawn("open", ["-na", installedAppPath], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  try {
    const { health, port: actualPort } = await waitForHealth(port, child, output, { allowEarlyExit: true }).catch((error) => {
      if (/packaged app did not expose health in time/.test(String(error?.message || error))) {
        try {
          const logs = spawn("log", ["show", "--last", "2m", "--predicate", `eventMessage CONTAINS[c] "${productName}" OR eventMessage CONTAINS[c] "ai.lifeos.desktop" OR process == "syspolicyd"`, "--style", "compact"], {
            cwd: rootDir,
            stdio: ["ignore", "pipe", "pipe"],
          });
          const systemLog = [];
          logs.stdout.on("data", (chunk) => systemLog.push(chunk.toString()));
          logs.stderr.on("data", (chunk) => systemLog.push(chunk.toString()));
          return new Promise((resolve, reject) => {
            logs.on("exit", () => {
              const combined = systemLog.join("");
              if (combined.includes("Security policy would not allow process")) {
                reject(new Error(`signed macOS app launch was blocked by AppleSystemPolicy; install should use Finder drag into Applications or ditto copy from the notarized DMG\n${combined}`));
                return;
              }
              reject(error);
            });
          });
        } catch {}
      }
      throw error;
    });
    if (health.networkMode !== "local") fail("packaged app launch smoke did not start in local mode");
    pass("packaged macOS app launches and exposes local core health");
    const pairingToken = "bind_artifact_launch_smoke_123";
    const pairPage = await fetchText(actualPort, `/mobile/pair?token=${pairingToken}`);
    if (pairPage.status !== 200) fail(`packaged app mobile pair page returned ${pairPage.status}`);
    if (!String(pairPage.headers["cache-control"] || "").includes("no-store")) fail("packaged app mobile pair page should be no-store");
    if (!String(pairPage.headers["set-cookie"] || "").includes(`lifeos_pairing_intent=${pairingToken}`)) {
      fail("packaged app mobile pair page does not set the 24-hour pairing intent cookie");
    }
    if (!pairPage.body.includes(`/manifest.webmanifest?pairingToken=${pairingToken}`)) {
      fail("packaged app mobile pair page does not inject pairing token into manifest link");
    }
    const manifest = await fetchText(actualPort, `/manifest.webmanifest?pairingToken=${pairingToken}`);
    if (manifest.status !== 200) fail(`packaged app pairing manifest returned ${manifest.status}`);
    if (!manifest.body.includes(`/mobile/install/${pairingToken}`)) {
      fail("packaged app pairing manifest does not preserve token in start_url");
    }
    const installPathPage = await fetchText(actualPort, `/mobile/install/${pairingToken}`);
    if (installPathPage.status !== 200) fail(`packaged app mobile install path returned ${installPathPage.status}`);
    if (!String(installPathPage.headers["set-cookie"] || "").includes(`lifeos_pairing_intent=${pairingToken}`)) {
      fail("packaged app mobile install path does not set the 24-hour pairing intent cookie");
    }
    if (!installPathPage.body.includes(`/manifest.webmanifest?pairingToken=${pairingToken}`)) {
      fail("packaged app mobile install path does not inject pairing token into manifest link");
    }
    const installIntent = await fetchText(actualPort, "/api/v1/mobile/pairing-intent", {
      headers: { Cookie: `lifeos_pairing_intent=${pairingToken}` },
    });
    if (installIntent.status !== 200 || !installIntent.body.includes(pairingToken)) {
      fail("packaged app mobile chat launch cannot recover the 24-hour pairing intent cookie");
    }
    pass("packaged macOS app preserves mobile pairing token through install manifest");
  } finally {
    stopPackagedApp(installedAppPath);
    unsetLaunchctlEnv("LIFEOS_PORT");
    unsetLaunchctlEnv("LIFEOS_HOST");
    unsetLaunchctlEnv("PUBLIC_BASE_URL");
    unsetLaunchctlEnv("APP_URL");
    unsetLaunchctlEnv("LIFEOS_ADMIN_PASSWORD");
    unsetLaunchctlEnv("LIFEOS_STARTUP_CONNECTIVITY_DELAY_MS");
    unsetLaunchctlEnv("LIFEOS_DESKTOP_USER_DATA_DIR");
    try {
      spawnSync("hdiutil", ["detach", mountDir], { cwd: rootDir, stdio: "ignore" });
    } catch {}
    try {
      fs.rmSync(installedAppPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
    try {
      if (extractedUnsigned?.tempRoot) fs.rmSync(extractedUnsigned.tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

async function launchPackagedWindowsApp() {
  if (process.platform !== "win32") {
    console.log("[SKIP] packaged Windows app launch smoke is Windows-only");
    return;
  }
  if (process.env.LIFEOS_ARTIFACT_SMOKE_LAUNCH !== "1") {
    console.log("[SKIP] set LIFEOS_ARTIFACT_SMOKE_LAUNCH=1 to launch the packaged Windows app");
    return;
  }
  const binary = findWindowsUnpackedBinary();
  if (!binary) fail("packaged Windows app binary was not found");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-artifact-smoke-win-"));
  const port = 7810 + Math.floor(Math.random() * 1000);
  const output = [];
  const child = spawn(binary, [], {
    cwd: path.dirname(binary),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      LIFEOS_PORT: String(port),
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ADMIN_PASSWORD: "",
      LIFEOS_DESKTOP_USER_DATA_DIR: path.join(tempRoot, "userData"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  try {
    const { health, port: actualPort } = await waitForHealth(port, child, output, { allowEarlyExit: true });
    if (health.networkMode !== "local") fail("packaged Windows app launch smoke did not start in local mode");
    const loginPage = await fetchText(actualPort, "/admin/login");
    if (loginPage.status !== 200 || !loginPage.body.includes("OwnOrbit")) fail("packaged Windows app did not expose the admin login shell");
    pass("packaged Windows app launches and exposes local core health");
  } finally {
    child.kill("SIGTERM");
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

async function launchPackagedLinuxApp() {
  if (process.platform !== "linux") {
    console.log("[SKIP] packaged Linux app launch smoke is Linux-only");
    return;
  }
  if (process.env.LIFEOS_ARTIFACT_SMOKE_LAUNCH !== "1") {
    console.log("[SKIP] set LIFEOS_ARTIFACT_SMOKE_LAUNCH=1 to launch the packaged Linux app");
    return;
  }
  const binary = findLinuxUnpackedBinary();
  if (!binary) fail("packaged Linux app binary was not found");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lifeos-artifact-smoke-linux-"));
  const port = 7810 + Math.floor(Math.random() * 1000);
  fs.chmodSync(binary, 0o755);
  const output = [];
  const child = spawn(binary, [], {
    cwd: path.dirname(binary),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      LIFEOS_PORT: String(port),
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ADMIN_PASSWORD: "",
      LIFEOS_DESKTOP_USER_DATA_DIR: path.join(tempRoot, "userData"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  try {
    const { health, port: actualPort } = await waitForHealth(port, child, output, { allowEarlyExit: true });
    if (health.networkMode !== "local") fail("packaged Linux app launch smoke did not start in local mode");
    const loginPage = await fetchText(actualPort, "/admin/login");
    if (loginPage.status !== 200 || !loginPage.body.includes("OwnOrbit")) fail("packaged Linux app did not expose the admin login shell");
    pass("packaged Linux app launches and exposes local core health");
  } finally {
    child.kill("SIGTERM");
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
}

checkInstallGuide();
checkUpdateFeed();
checkUnsignedZip();
checkPackagedAsar();
checkPackagedPackageMetadata();
checkCloudKitHelperResourceManifest();
await checkPackagedMacSignature();
await checkPackagedMacEntitlements();
await launchPackagedMacApp();
await launchPackagedWindowsApp();
await launchPackagedLinuxApp();
