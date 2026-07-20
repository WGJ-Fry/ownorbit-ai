import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const currentVersion = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8")).version;
const releaseState = JSON.parse(await readFile(path.join(rootDir, "docs", "release-state.json"), "utf8"));
const publicPackageVersion = String(releaseState.publicPackageVersion || "");
const currentVersionPattern = currentVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const currentPublicTag = String(releaseState.publicTag || "");
const currentDockerImage = `${String(releaseState.publicDockerRepository || "")}:${currentPublicTag}`;
const currentMacZipName = `OwnOrbit AI-${currentVersion}-arm64-unsigned.zip`;
const currentWinInstallerName = `OwnOrbit AI Setup ${currentVersion}.exe`;
const currentLinuxAppImageName = `OwnOrbit AI-${currentVersion}.AppImage`;
const publicMacZipName = String(releaseState.publicArtifacts?.mac || "");
const publicWinInstallerName = String(releaseState.publicArtifacts?.windows || "");
const publicLinuxAppImageName = String(releaseState.publicArtifacts?.linux || "");
const packagedDesktopMain = [
  "function fetchLocalJson() {}",
  "const bundle = {",
  "  localCore: {",
  "    health: healthResult.ok ? {} : null,",
  "    adminStatus: adminStatusResult.ok ? {} : null,",
  "  },",
  "  release: readReleaseSnapshot(),",
  "};",
  "function readReleaseSnapshot() { return {}; }",
].join("\n");

function runReleaseCheck(env = {}) {
  return spawnSync(process.execPath, ["scripts/release-check.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      CSC_LINK: "",
      CSC_KEY_PASSWORD: "",
      APPLE_ID: "",
      APPLE_APP_SPECIFIC_PASSWORD: "",
      APPLE_TEAM_ID: "",
      LIFEOS_UPDATE_URL: "",
      LIFEOS_RELEASE_SKIP_AUDIT: "1",
      ...env,
    },
    encoding: "utf8",
  });
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function createPackagedMacApp(releaseDir, entries) {
  const sourceDir = path.join(releaseDir, "asar-source");
  const resourcesDir = path.join(releaseDir, "mac-arm64", "OwnOrbit AI.app", "Contents", "Resources");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });
  const zipName = currentMacZipName;
  const zipContent = "fake unsigned zip";
  const zipHash = crypto.createHash("sha512").update(zipContent).digest("base64");
  const zipSha256 = crypto.createHash("sha256").update(zipContent).digest("hex");
  await writeFile(path.join(releaseDir, zipName), zipContent);
  await writeFile(path.join(releaseDir, "SHA256SUMS"), `${zipSha256}  ${zipName}\n`);
  await writeFile(path.join(releaseDir, "INSTALL-unsigned-mac.md"), [
    "# OwnOrbit AI unsigned macOS install",
    "If macOS Gatekeeper reports an unidentified developer, open System Settings > Privacy & Security and choose Open Anyway.",
    "On first launch, set the admin password, configure AI, create a backup, enable daily automatic backups, and bind the mobile PWA.",
    "Use Export Diagnostics from the app menu if startup fails.",
    "",
  ].join("\n"));
  await writeFile(path.join(releaseDir, "USER-INSTALL.md"), [
    "# User Install Guide",
    "## 先看这里：当前公开版本状态",
    "只写已经存在并能被干净机器下载的资产",
    "## Read This First: Current Public Release Status",
    `Docker Compose alpha uses ${currentDockerImage}.`,
    `Verify with docker pull ${currentDockerImage} before promotion.`,
    "Only claim assets that already exist and can be downloaded from a clean machine.",
    `Windows desktop package uploads ${publicWinInstallerName}.`,
    `Linux desktop package uploads ${publicLinuxAppImageName}.`,
    "## macOS Unsigned Zip",
    "Use Open Anyway if macOS blocks the unsigned app.",
    "## Windows NSIS Installer",
    "SmartScreen may warn about an unknown publisher.",
    "Run the installer and only continue past SmartScreen after verifying SHA256SUMS.",
    "## Linux AppImage",
    "Mark it executable and verify it with `SHA256SUMS`.",
    "Run chmod +x before starting the AppImage.",
    "## First Launch",
    "Set the admin password and configure an AI provider.",
    "## Bind The Phone PWA",
    "Scan the QR code and bind the phone before adding it to the home screen.",
    "Wait until the phone shows the bound chat or device page.",
    "Do not add the unbound QR page to the home screen.",
    "If the phone later opens unbound, delete the old home-screen icon and bind again.",
    "## Backups",
    "Create a backup before updating, and keep daily automatic backups enabled.",
    "## Updates",
    "Verify SHA256SUMS before opening the download.",
    `Run shasum -a 256 "${publicMacZipName}" or shasum -a 256 "${publicLinuxAppImageName}" on macOS or Linux.`,
    "If SHA256SUMS uses a different builder filename, compare the SHA256 value directly.",
    "Run Get-FileHash on Windows and compare it with SHA256SUMS.",
    "## Troubleshooting",
    "Open Local Console In Browser from the desktop failure page if the local core is already running.",
    "Copy Local Address from the desktop failure page if the desktop window fails.",
    "Export a diagnostic bundle if startup or phone binding fails.",
    "",
  ].join("\n"));
  await mkdir(path.join(releaseDir, "update-feed"), { recursive: true });
  await writeFile(path.join(releaseDir, "update-feed", zipName), zipContent);
  await writeFile(path.join(releaseDir, "update-feed", "latest-mac.yml"), [
    `version: "${currentVersion}"`,
    "files:",
    `  - url: "${zipName}"`,
    `    sha512: "${zipHash}"`,
    `    size: ${Buffer.byteLength(zipContent)}`,
    `path: "${zipName}"`,
    `sha512: "${zipHash}"`,
    `releaseDate: "${new Date(0).toISOString()}"`,
    "",
  ].join("\n"));
  await writeFile(path.join(releaseDir, "update-feed", "release-manifest.json"), `${JSON.stringify({
    version: currentVersion,
    generatedAt: new Date(0).toISOString(),
    artifacts: [{
      platform: "mac",
      feedFile: "latest-mac.yml",
      fileName: zipName,
      size: Buffer.byteLength(zipContent),
      sha512: zipHash,
      sha256: zipSha256,
      releaseDate: new Date(0).toISOString(),
    }],
  }, null, 2)}\n`);

  for (const [entry, content] of Object.entries(entries)) {
    const outputPath = path.join(sourceDir, entry);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }

  await asar.createPackage(sourceDir, path.join(resourcesDir, "app.asar"));
}

test("release feed generator writes electron-updater metadata for packaged artifacts", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await writeFile(path.join(releaseDir, "OwnOrbit AI.dmg"), "fake dmg bytes for feed smoke");
  const result = spawnSync(process.execPath, ["scripts/prepare-update-feed.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const feed = await readFile(path.join(releaseDir, "update-feed", "latest-mac.yml"), "utf8");
  assert.match(feed, /version:/);
  assert.match(feed, /OwnOrbit AI\.dmg/);
  assert.match(feed, /sha512:/);
  assert.match(feed, /releaseDate:/);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake dmg bytes for feed smoke").digest("hex")}  OwnOrbit AI\\.dmg`));

  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.equal(manifest.version, currentVersion);
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].platform, "mac");
  assert.equal(manifest.artifacts[0].feedFile, "latest-mac.yml");
  assert.equal(manifest.artifacts[0].fileName, "OwnOrbit AI.dmg");
  assert.equal(manifest.artifacts[0].size, (await stat(path.join(releaseDir, "OwnOrbit AI.dmg"))).size);
  assert.equal(manifest.artifacts[0].sha256, crypto.createHash("sha256").update("fake dmg bytes for feed smoke").digest("hex"));
  assert.match(feed, new RegExp(manifest.artifacts[0].sha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("release feed generator accepts unsigned mac zip artifacts", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-zip-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await writeFile(path.join(releaseDir, currentMacZipName), "fake zip bytes for feed smoke");
  const result = spawnSync(process.execPath, ["scripts/prepare-update-feed.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const feed = await readFile(path.join(releaseDir, "update-feed", "latest-mac.yml"), "utf8");
  assert.match(feed, new RegExp(currentMacZipName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(feed, /sha512:/);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake zip bytes for feed smoke").digest("hex")}  ${currentMacZipName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.equal(manifest.artifacts[0].fileName, currentMacZipName);
  assert.equal(manifest.artifacts[0].feedFile, "latest-mac.yml");
  assert.equal(manifest.artifacts[0].sha256, crypto.createHash("sha256").update("fake zip bytes for feed smoke").digest("hex"));
});

test("release feed generator rejects stale versioned artifacts", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-stale-version-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await writeFile(path.join(releaseDir, "OwnOrbit AI-0.0.0-arm64.dmg"), "old dmg bytes");
  await writeFile(path.join(releaseDir, "OwnOrbit AI-0.0.0-arm64.dmg.blockmap"), "old blockmap bytes");
  await writeFile(path.join(releaseDir, currentWinInstallerName), "current nsis bytes");
  const result = spawnSync(process.execPath, ["scripts/prepare-update-feed.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, new RegExp(`Release artifacts do not match package version ${currentVersionPattern}`));
  assert.match(result.stderr, /OwnOrbit AI-0\.0\.0-arm64\.dmg contains 0\.0\.0/);
  assert.match(result.stderr, /OwnOrbit AI-0\.0\.0-arm64\.dmg\.blockmap contains 0\.0\.0/);
  assert.match(result.stderr, /Rebuild the desktop packages or remove stale release artifacts/);
  assert.equal(await fileExists(path.join(releaseDir, "update-feed", "release-manifest.json")), false);
  assert.equal(await fileExists(path.join(releaseDir, "SHA256SUMS")), false);
});

test("release feed generator ignores unpacked app internals", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-unpacked-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await mkdir(path.join(releaseDir, "win-unpacked"), { recursive: true });
  await writeFile(path.join(releaseDir, currentMacZipName), "fake mac zip bytes");
  await writeFile(path.join(releaseDir, "win-unpacked", "OwnOrbit AI.exe"), "unpacked executable should not be a release asset");

  const result = spawnSync(process.execPath, ["scripts/prepare-update-feed.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.fileName), [currentMacZipName]);
  assert.equal(await fileExists(path.join(releaseDir, "update-feed", "OwnOrbit AI.exe")), false);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.doesNotMatch(checksums, /OwnOrbit AI\.exe/);
});

test("release artifact version checker blocks and explicitly cleans stale installers", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-artifact-version-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  const staleDmg = path.join(releaseDir, "OwnOrbit AI-0.0.0-arm64.dmg");
  const staleBlockmap = path.join(releaseDir, "OwnOrbit AI-0.0.0-arm64.dmg.blockmap");
  const currentExe = path.join(releaseDir, currentWinInstallerName);
  const feedDir = path.join(releaseDir, "update-feed");
  const staleFeed = path.join(feedDir, "latest-mac.yml");
  const staleManifest = path.join(feedDir, "release-manifest.json");
  const staleChecksums = path.join(releaseDir, "SHA256SUMS");
  await writeFile(staleDmg, "old dmg bytes");
  await writeFile(staleBlockmap, "old blockmap bytes");
  await writeFile(currentExe, "current nsis bytes");
  await mkdir(feedDir, { recursive: true });
  await writeFile(staleFeed, [
    'version: "0.0.0"',
    'path: "OwnOrbit AI-0.0.0-arm64.dmg"',
    "",
  ].join("\n"));
  await writeFile(staleManifest, JSON.stringify({
    version: "0.0.0",
    artifacts: [{ fileName: "OwnOrbit AI-0.0.0-arm64.dmg", feedFile: "latest-mac.yml" }],
  }, null, 2));
  await writeFile(staleChecksums, `deadbeef  OwnOrbit AI-0.0.0-arm64.dmg\n`);

  const check = spawnSync(process.execPath, ["scripts/check-release-artifact-versions.mjs"], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_RELEASE_DIR: releaseDir },
    encoding: "utf8",
  });
  assert.notEqual(check.status, 0, `${check.stdout}\n${check.stderr}`);
  assert.match(check.stderr, new RegExp(`Release artifacts do not match package version ${currentVersionPattern}`));
  assert.match(check.stderr, /OwnOrbit AI-0\.0\.0-arm64\.dmg \(artifact\) contains 0\.0\.0/);
  assert.match(check.stderr, /OwnOrbit AI-0\.0\.0-arm64\.dmg\.blockmap \(artifact\) contains 0\.0\.0/);
  assert.match(check.stderr, /latest-mac\.yml \(metadata\) contains 0\.0\.0/);
  assert.match(check.stderr, /release-manifest\.json \(metadata\) contains 0\.0\.0/);
  assert.match(check.stderr, /SHA256SUMS \(metadata\) contains 0\.0\.0/);
  assert.equal(await fileExists(staleDmg), true);
  assert.equal(await fileExists(staleBlockmap), true);
  assert.equal(await fileExists(currentExe), true);
  assert.equal(await fileExists(staleFeed), true);
  assert.equal(await fileExists(staleManifest), true);
  assert.equal(await fileExists(staleChecksums), true);

  const fixed = spawnSync(process.execPath, ["scripts/check-release-artifact-versions.mjs", "--fix"], {
    cwd: rootDir,
    env: { ...process.env, LIFEOS_RELEASE_DIR: releaseDir },
    encoding: "utf8",
  });
  assert.equal(fixed.status, 0, `${fixed.stdout}\n${fixed.stderr}`);
  assert.match(fixed.stdout, /Deleted/);
  assert.equal(await fileExists(staleDmg), false);
  assert.equal(await fileExists(staleBlockmap), false);
  assert.equal(await fileExists(currentExe), true);
  assert.equal(await fileExists(staleFeed), false);
  assert.equal(await fileExists(staleManifest), false);
  assert.equal(await fileExists(staleChecksums), false);
});

test("release feed generator writes Windows and Linux updater metadata", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-cross-platform-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await writeFile(path.join(releaseDir, currentWinInstallerName), "fake nsis bytes for feed smoke");
  await writeFile(path.join(releaseDir, currentLinuxAppImageName), "fake appimage bytes for feed smoke");
  const result = spawnSync(process.execPath, ["scripts/prepare-update-feed.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const winFeed = await readFile(path.join(releaseDir, "update-feed", "latest.yml"), "utf8");
  const linuxFeed = await readFile(path.join(releaseDir, "update-feed", "latest-linux.yml"), "utf8");
  assert.match(winFeed, new RegExp(currentWinInstallerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(linuxFeed, new RegExp(currentLinuxAppImageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(winFeed, /sha512:/);
  assert.match(linuxFeed, /sha512:/);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake nsis bytes for feed smoke").digest("hex")}  ${currentWinInstallerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake appimage bytes for feed smoke").digest("hex")}  ${currentLinuxAppImageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.platform).sort(), ["linux", "windows"]);
  const windows = manifest.artifacts.find((artifact) => artifact.platform === "windows");
  const linux = manifest.artifacts.find((artifact) => artifact.platform === "linux");
  assert.equal(windows.feedFile, "latest.yml");
  assert.equal(windows.fileName, currentWinInstallerName);
  assert.equal(windows.size, (await stat(path.join(releaseDir, currentWinInstallerName))).size);
  assert.equal(windows.sha256, crypto.createHash("sha256").update("fake nsis bytes for feed smoke").digest("hex"));
  assert.match(winFeed, new RegExp(windows.sha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(linux.feedFile, "latest-linux.yml");
  assert.equal(linux.fileName, currentLinuxAppImageName);
  assert.equal(linux.size, (await stat(path.join(releaseDir, currentLinuxAppImageName))).size);
  assert.equal(linux.sha256, crypto.createHash("sha256").update("fake appimage bytes for feed smoke").digest("hex"));
  assert.match(linuxFeed, new RegExp(linux.sha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("release draft assembler merges platform artifacts into one payload", async (t) => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-draft-artifacts-"));
  const outputDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-draft-output-"));
  t.after(async () => {
    await rm(artifactsDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  async function writePlatformArtifact(platform, fileName, feedFile, bytes) {
    const dir = path.join(artifactsDir, `lifeos-ai-${platform}-1`);
    await mkdir(dir, { recursive: true });
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
    await writeFile(path.join(dir, fileName), bytes);
    await writeFile(path.join(dir, "SHA256SUMS"), `${sha256}  ${fileName}\n`);
    await writeFile(path.join(dir, feedFile), [
      `version: "${currentVersion}"`,
      `path: "${fileName}"`,
      `sha512: "${sha512}"`,
      "",
    ].join("\n"));
    await writeFile(path.join(dir, "release-manifest.json"), `${JSON.stringify({
      version: currentVersion,
      generatedAt: new Date(0).toISOString(),
      artifacts: [{
        platform,
        feedFile,
        fileName,
        size: Buffer.byteLength(bytes),
        sha512,
        sha256,
        releaseDate: new Date(0).toISOString(),
      }],
    }, null, 2)}\n`);
    if (platform === "mac") {
      await writeFile(path.join(dir, "USER-INSTALL.md"), "# install\n");
      await writeFile(path.join(dir, "INSTALL-unsigned-mac.md"), "# mac install\n");
    }
  }

  await writePlatformArtifact("mac", currentMacZipName, "latest-mac.yml", "mac zip bytes");
  await writePlatformArtifact("windows", currentWinInstallerName, "latest.yml", "windows exe bytes");
  await writePlatformArtifact("linux", currentLinuxAppImageName, "latest-linux.yml", "linux appimage bytes");

  const result = spawnSync(process.execPath, ["scripts/assemble-release-draft-assets.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_ARTIFACTS_DIR: artifactsDir,
      LIFEOS_RELEASE_DRAFT_DIR: outputDir,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Release draft assets assembled/);
  assert.equal(await fileExists(path.join(outputDir, currentMacZipName)), true);
  assert.equal(await fileExists(path.join(outputDir, currentWinInstallerName)), true);
  assert.equal(await fileExists(path.join(outputDir, currentLinuxAppImageName)), true);
  assert.equal(await fileExists(path.join(outputDir, "latest-mac.yml")), true);
  assert.equal(await fileExists(path.join(outputDir, "latest.yml")), true);
  assert.equal(await fileExists(path.join(outputDir, "latest-linux.yml")), true);
  assert.equal(await fileExists(path.join(outputDir, "USER-INSTALL.md")), true);
  assert.equal(await fileExists(path.join(outputDir, "INSTALL-unsigned-mac.md")), true);

  const checksums = await readFile(path.join(outputDir, "SHA256SUMS"), "utf8");
  assert.match(checksums, new RegExp(currentMacZipName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(checksums, new RegExp(currentWinInstallerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(checksums, new RegExp(currentLinuxAppImageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const manifest = JSON.parse(await readFile(path.join(outputDir, "release-manifest.json"), "utf8"));
  assert.equal(manifest.version, currentVersion);
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.platform).sort(), ["linux", "mac", "windows"]);
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.feedFile).sort(), ["latest-linux.yml", "latest-mac.yml", "latest.yml"]);
});

test("release draft assembler rejects incomplete platform artifact sets", async (t) => {
  const artifactsDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-draft-incomplete-"));
  const outputDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-draft-incomplete-output-"));
  t.after(async () => {
    await rm(artifactsDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  async function writePlatformArtifact(platform, fileName, feedFile, bytes) {
    const dir = path.join(artifactsDir, `lifeos-ai-${platform}-1`);
    await mkdir(dir, { recursive: true });
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
    await writeFile(path.join(dir, fileName), bytes);
    await writeFile(path.join(dir, "SHA256SUMS"), `${sha256}  ${fileName}\n`);
    await writeFile(path.join(dir, feedFile), [
      `version: "${currentVersion}"`,
      `path: "${fileName}"`,
      `sha512: "${sha512}"`,
      "",
    ].join("\n"));
    await writeFile(path.join(dir, "release-manifest.json"), `${JSON.stringify({
      version: currentVersion,
      generatedAt: new Date(0).toISOString(),
      artifacts: [{
        platform,
        feedFile,
        fileName,
        size: Buffer.byteLength(bytes),
        sha512,
        sha256,
        releaseDate: new Date(0).toISOString(),
      }],
    }, null, 2)}\n`);
  }

  await writePlatformArtifact("mac", currentMacZipName, "latest-mac.yml", "mac zip bytes");
  await writePlatformArtifact("windows", currentWinInstallerName, "latest.yml", "windows exe bytes");

  const result = spawnSync(process.execPath, ["scripts/assemble-release-draft-assets.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_ARTIFACTS_DIR: artifactsDir,
      LIFEOS_RELEASE_DRAFT_DIR: outputDir,
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Release draft is missing platform artifact\(s\): linux/);
});

test("release feed generator removes stale metadata before rewriting feeds", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-stale-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await writeFile(path.join(releaseDir, currentWinInstallerName), "fake nsis bytes for stale feed smoke");
  await writeFile(path.join(releaseDir, currentLinuxAppImageName), "fake appimage bytes for stale feed smoke");
  const first = spawnSync(process.execPath, ["scripts/prepare-update-feed.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.ok(await fileExists(path.join(releaseDir, "update-feed", "latest.yml")));
  assert.ok(await fileExists(path.join(releaseDir, "update-feed", "latest-linux.yml")));

  await rm(path.join(releaseDir, currentWinInstallerName), { force: true });
  await rm(path.join(releaseDir, currentLinuxAppImageName), { force: true });
  await writeFile(path.join(releaseDir, currentMacZipName), "fake mac zip bytes after stale feed");
  const second = spawnSync(process.execPath, ["scripts/prepare-update-feed.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      LIFEOS_RELEASE_DIR: releaseDir,
    },
    encoding: "utf8",
  });
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.ok(await fileExists(path.join(releaseDir, "update-feed", "latest-mac.yml")));
  assert.equal(await fileExists(path.join(releaseDir, "update-feed", "latest.yml")), false);
  assert.equal(await fileExists(path.join(releaseDir, "update-feed", "latest-linux.yml")), false);
  assert.equal(await fileExists(path.join(releaseDir, "update-feed", currentWinInstallerName)), false);
  assert.equal(await fileExists(path.join(releaseDir, "update-feed", currentLinuxAppImageName)), false);

  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.platform), ["mac"]);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.equal(checksums.includes(currentWinInstallerName), false);
  assert.equal(checksums.includes(currentLinuxAppImageName), false);
});

test("release check verifies packaged macOS app contains runtime entrypoints", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-check-app-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await createPackagedMacApp(releaseDir, {
    "desktop/main.cjs": packagedDesktopMain,
    "dist/server.cjs": "module.exports = {};",
    "dist/index.html": "<!doctype html>",
    "package.json": JSON.stringify({ name: "lifeos-ai", main: "desktop/main.cjs" }),
  });
  await mkdir(path.join(releaseDir, "win-unpacked"), { recursive: true });
  await writeFile(path.join(releaseDir, "win-unpacked", "OwnOrbit AI.exe"), "unpacked executable is not a release asset");

  const result = runReleaseCheck({
    LIFEOS_RELEASE_DIR: releaseDir,
    LIFEOS_DISTRIBUTION: "unsigned",
    LIFEOS_RELEASE_STRICT: "1",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /packaged macOS app contains desktop shell, local core, web UI, and package metadata/);
  assert.match(result.stdout, /packaged macOS app desktop diagnostic includes local core health\/admin snapshots/);
});

test("release check fails when packaged macOS app is missing the local core bundle", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-check-app-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await createPackagedMacApp(releaseDir, {
    "desktop/main.cjs": packagedDesktopMain,
    "dist/index.html": "<!doctype html>",
    "package.json": JSON.stringify({ name: "lifeos-ai", main: "desktop/main.cjs" }),
  });

  const result = runReleaseCheck({
    LIFEOS_RELEASE_DIR: releaseDir,
    LIFEOS_DISTRIBUTION: "unsigned",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /packaged macOS app is missing required files: \/dist\/server\.cjs/);
});

test("release check unsigned strategy passes strict mode without signing or update env", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-check-unsigned-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await createPackagedMacApp(releaseDir, {
    "desktop/main.cjs": packagedDesktopMain,
    "dist/server.cjs": "module.exports = {};",
    "dist/index.html": "<!doctype html>",
    "package.json": JSON.stringify({ name: "lifeos-ai", main: "desktop/main.cjs" }),
  });

  const result = runReleaseCheck({
    LIFEOS_RELEASE_DIR: releaseDir,
    LIFEOS_DISTRIBUTION: "unsigned",
    LIFEOS_RELEASE_STRICT: "1",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /unsigned distribution strategy selected; code signing is optional/);
  assert.match(result.stdout, /package script exists: desktop:release:smoke/);
  assert.match(result.stdout, /package script exists: desktop:artifact:smoke/);
  assert.match(result.stdout, /package script exists: desktop:artifact:smoke:launch/);
  assert.match(result.stdout, /package script exists: quality:gate/);
  assert.match(result.stdout, /package script exists: release:artifacts:check/);
  assert.match(result.stdout, /package script exists: check:cold-launch/);
  assert.match(result.stdout, /cold launch readiness verifies README, Compose, release tag, and GHCR image references/);
  assert.match(result.stdout, /release artifact version checker can block and explicitly clean stale installers/);
  assert.match(result.stdout, /quality gate script runs lint, tests, e2e, desktop, and release checks/);
  assert.match(result.stdout, /GitHub Actions quality gate runs Playwright E2E, desktop smoke, SQLite-enabled tests, and remote smoke/);
  assert.match(result.stdout, /iOS Simulator smoke can open the mobile handoff\/chat shell and records evidence without replacing real-device acceptance/);
  assert.match(result.stdout, /desktop release smoke builds unsigned macOS zip/);
  assert.match(result.stdout, /desktop release smoke builds unsigned Windows NSIS artifact/);
  assert.match(result.stdout, /desktop release smoke builds Linux AppImage artifact/);
  assert.match(result.stdout, /desktop release smoke regenerates update feed after Windows\/Linux builds/);
  assert.match(result.stdout, /desktop release smoke blocks stale installer artifacts before verification/);
  assert.match(result.stdout, /desktop release smoke verifies packaged artifacts after building/);
  assert.match(result.stdout, /desktop release smoke can launch the packaged macOS app when requested/);
  assert.match(result.stdout, /desktop package artifact workflow aggregates macOS, Windows, Linux packages into one draft GitHub Release/);
  assert.match(result.stdout, /desktop artifact launch smoke script starts the packaged app/);
  assert.match(result.stdout, /desktop artifact smoke verifies update feed, packaged asar, and optional launch/);
  assert.match(result.stdout, /desktop artifact smoke verifies unsigned macOS ad-hoc signature/);
  assert.match(result.stdout, /desktop artifact smoke verifies packaged dependency safety metadata/);
  assert.match(result.stdout, /desktop artifact smoke verifies Electron runtime entitlements/);
  assert.match(result.stdout, /Electron signing preserves the independently signed CloudKit helper entitlements/);
  assert.match(result.stdout, /unsigned macOS zip packaging uses electron-builder ad-hoc signing and verifies before zipping/);
  assert.match(result.stdout, /desktop artifact smoke verifies packaged mobile pairing install manifest/);
  assert.match(result.stdout, /desktop artifact smoke stops the packaged app before removing its working directory/);
  assert.match(result.stdout, new RegExp(`release SHA256SUMS includes artifact: ${currentMacZipName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(result.stdout, /release feed metadata matches manifest: latest-mac\.yml/);
  assert.match(result.stdout, /release feed avoids local absolute paths: latest-mac\.yml/);
  assert.match(result.stdout, /release manifest\/checksums (?:exclude unpacked build directories|do not reference unpacked build directories)/);
  assert.match(result.stdout, /desktop release smoke workflow covers macOS, Windows, and Linux/);
  assert.match(result.stdout, /desktop release smoke workflow runs the release smoke script/);
  assert.match(result.stdout, /desktop release smoke workflow launches the packaged macOS app/);
  assert.match(result.stdout, /desktop release smoke workflow launches packaged Windows and Linux apps/);
  assert.match(result.stdout, /desktop release smoke workflow disables opportunistic signing/);
  assert.match(result.stdout, /desktop release smoke workflow uses fast quality gate before platform packaging/);
  assert.match(result.stdout, /Vite dependency is pinned to the esbuild-safe major line/);
  assert.match(result.stdout, /React Vite plugin is compatible with Vite 8/);
  assert.match(result.stdout, /direct esbuild dependency is at the audited safe version/);
  assert.match(result.stdout, /App shell stays under 700 lines/);
  assert.match(result.stdout, /Studio shell stays under 700 lines/);
  assert.match(result.stdout, /Backup restore panel stays under 560 lines/);
  assert.match(result.stdout, /Mobile device page stays under 520 lines/);
  assert.match(result.stdout, /Connection guide stays under 480 lines/);
  assert.match(result.stdout, /AI key panel stays under 340 lines/);
  assert.match(result.stdout, /Admin dashboard stays under 430 lines/);
  assert.match(result.stdout, /package overrides force transitive esbuild to the audited safe version/);
  assert.match(result.stdout, /package-lock keeps all esbuild copies on the audited safe version/);
  assert.match(result.stdout, /TypeScript config has an explicit source include list/);
  assert.match(result.stdout, /TypeScript config excludes generated build and test artifacts/);
  assert.match(result.stdout, /PWA manifest targets the mobile app shell/);
  assert.match(result.stdout, /PWA install PNG icons exist for Android\/iOS launch surfaces/);
  assert.match(result.stdout, /PWA manifest includes mobile install screenshots/);
  assert.match(result.stdout, /PWA offline fallback page shows persisted queue status/);
  assert.match(result.stdout, /PWA service worker caches mobile shell routes/);
  assert.match(result.stdout, /PWA service worker caches install icons for offline startup/);
  assert.match(result.stdout, /PWA service worker pre-caches production build assets/);
  assert.match(result.stdout, /PWA service worker supports background offline queue sync/);
  assert.match(result.stdout, /PWA service worker supports immediate update activation/);
  assert.match(result.stdout, /PWA client reloads after service worker updates/);
  assert.match(result.stdout, /first-launch onboarding has authoritative status, completion, audit, and login routing/);
  assert.match(result.stdout, /connection guide ranks usable URLs for pairing QR and tunnel setup/);
  assert.match(result.stdout, /device pairing QR page exposes recommended URL safety, reachability test, and repair guidance/);
  assert.match(result.stdout, /connection diagnostics have Cloudflare\/Tailscale mock coverage, Named Tunnel reconnect, sanitize test URLs, and repair hints/);
  assert.match(result.stdout, /public mode health and dashboard expose actionable security risk items/);
  assert.match(result.stdout, /PWA preserves pending pairing token across iOS add-to-home-screen/);
  assert.match(result.stdout, /PWA pairing intent rejects malformed and unsafe tokens/);
  assert.match(result.stdout, /PWA install path carries pairing token through iOS add-to-home-screen/);
  assert.match(result.stdout, /PWA install path rejects malformed and unsafe pairing tokens/);
  assert.match(result.stdout, /mobile device page surfaces PWA install, background sync, and remote recovery guidance/);
  assert.match(result.stdout, /mobile device page supports token paste rebinding without naked pair links/);
  assert.match(result.stdout, /mobile device page can revoke its own server-side binding with audit coverage/);
  assert.match(result.stdout, /mobile device credentials migrate away from localStorage and expose storage status/);
  assert.match(result.stdout, /frontend clears sensitive localStorage residue without breaking pairing or credential migration/);
  assert.match(result.stdout, /offline queue UI uses localized status, retry timing, and storage budget protection/);
  assert.match(result.stdout, /mobile action permission center summarizes, clears, and audits local app launches/);
  assert.match(result.stdout, /mobile action URL scheme whitelist rejects blocked and malformed schemes/);
  assert.match(result.stdout, /data export redaction covers AI keys, tokens, auth headers, crypto fields, URLs, and local paths/);
  assert.match(result.stdout, /admin diagnostic bundle includes redacted release, remote health, and acceptance evidence/);
  assert.match(result.stdout, /admin settings diagnostics surfaces release manifest and checksum status/);
  assert.match(result.stdout, /client state API responses and realtime broadcasts redact sensitive values/);
  assert.match(result.stdout, /client state stores normalized URL scheme allowlists in SQLite/);
  assert.match(result.stdout, /AI multi-provider UI and local endpoint validation are covered/);
  assert.match(result.stdout, /AI key storage reports system secure store, fallback, and migration state/);
  assert.match(result.stdout, /high-risk AI key, device, backup, data export, and diagnostic exports include detailed redacted audit metadata/);
  assert.match(result.stdout, /pending restore cancellation is implemented across DB, API, UI, audit, and tests/);
  assert.match(result.stdout, /backup restore API exposes only whitelisted restore metadata/);
  assert.match(result.stdout, /backup restore previews are shown before restore in settings and dashboard/);
  assert.match(result.stdout, /backup restore UI confirmation copy is shared and tested/);
  assert.match(result.stdout, /ordinary SQLite backups exclude AI keys and sensitive client state by default/);
  assert.match(result.stdout, /data cleanup has dry-run preview, protection backup, UI, audit, and tests/);
  assert.match(result.stdout, /Docker quickstart chat route proves local memory context reaches the forced local model/);
  assert.match(result.stdout, /desktop logs folder menu action is implemented/);
  assert.match(result.stdout, /desktop diagnostic includes redacted log tail/);
  assert.match(result.stdout, /desktop diagnostic exposes a safe logs directory label/);
  assert.match(result.stdout, /desktop diagnostic includes local core health and admin status snapshots/);
  assert.match(result.stdout, /desktop diagnostic includes release manifest and checksum metadata/);
  assert.match(result.stdout, /desktop diagnostic captures first-launch onboarding routing state/);
  assert.match(result.stdout, /desktop smoke verifies first-launch setup routes into onboarding/);
  assert.match(result.stdout, /desktop tray exposes refreshed health\/admin\/AI\/device\/iCloud data sync status and first-launch entry/);
  assert.match(result.stdout, /desktop startup failure page points users to logs/);
  assert.match(result.stdout, /desktop startup failure menu exposes diagnostics and logs/);
  assert.match(result.stdout, /packaged macOS app desktop diagnostic includes local core health\/admin snapshots/);
  assert.match(result.stdout, /packaged macOS app desktop diagnostic includes release metadata snapshot/);
  assert.match(result.stdout, /unsigned macOS release includes user install and Gatekeeper guidance/);
  assert.match(result.stdout, /unsigned macOS release includes non-developer user install guide/);
  const releaseCheckSource = await readFile(path.join(rootDir, "scripts", "release-check.mjs"), "utf8");
  assert.match(releaseCheckSource, /docs\/promotion-kit\.md/);
  assert.match(releaseCheckSource, /docs\/faq\.md/);
  assert.match(releaseCheckSource, /macOS build is Developer ID signed and Apple notarized/);
  assert.match(releaseCheckSource, /当前已经有 macOS \/ Windows \/ Linux 安装包/);
  assert.match(result.stdout, /user install guide covers install, first launch, phone binding, backups, updates, and troubleshooting/);
  assert.doesNotMatch(result.stdout, /release USER-INSTALL\.md should explain first launch, browser fallback recovery, phone binding, add-to-home-screen recovery/);
  assert.match(result.stdout, /release checklist documents unsigned\/signed distribution, update feed, and signing inputs/);
  assert.match(result.stdout, /desktop release guide covers cross-platform packaging, update channel, and diagnostics/);
  assert.match(result.stdout, /Release check: .*0 warnings, 0 failures/);
});

test("release check rejects manifests that reference unpacked app internals", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-check-unpacked-ref-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await createPackagedMacApp(releaseDir, {
    "desktop/main.cjs": packagedDesktopMain,
    "dist/server.cjs": "module.exports = {};",
    "dist/index.html": "<!doctype html>",
    "package.json": JSON.stringify({ name: "lifeos-ai", main: "desktop/main.cjs" }),
  });
  await mkdir(path.join(releaseDir, "win-unpacked"), { recursive: true });
  await writeFile(path.join(releaseDir, "win-unpacked", "OwnOrbit AI.exe"), "unpacked executable is not a release asset");
  const manifestPath = path.join(releaseDir, "update-feed", "release-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.artifacts[0].fileName = "win-unpacked/OwnOrbit AI.exe";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(releaseDir, "SHA256SUMS"), "abc123  win-unpacked/OwnOrbit AI.exe\n");

  const result = runReleaseCheck({
    LIFEOS_RELEASE_DIR: releaseDir,
    LIFEOS_DISTRIBUTION: "unsigned",
    LIFEOS_RELEASE_STRICT: "1",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /release manifest or SHA256SUMS references unpacked app internals/);
});

test("release check rejects update feed metadata that drifts from the manifest", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-check-feed-drift-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await createPackagedMacApp(releaseDir, {
    "desktop/main.cjs": packagedDesktopMain,
    "dist/server.cjs": "module.exports = {};",
    "dist/index.html": "<!doctype html>",
    "package.json": JSON.stringify({ name: "lifeos-ai", main: "desktop/main.cjs" }),
  });

  await writeFile(path.join(releaseDir, "update-feed", "latest-mac.yml"), [
    `version: "${currentVersion}"`,
    "files:",
    `  - url: "OwnOrbit AI-${currentVersion}-stale.zip"`,
    `    sha512: "stale-hash"`,
    "    size: 1",
    `path: "OwnOrbit AI-${currentVersion}-stale.zip"`,
    `sha512: "stale-hash"`,
    `releaseDate: "${new Date(0).toISOString()}"`,
    "",
  ].join("\n"));

  const result = runReleaseCheck({
    LIFEOS_RELEASE_DIR: releaseDir,
    LIFEOS_DISTRIBUTION: "unsigned",
    LIFEOS_RELEASE_STRICT: "1",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /release feed latest-mac\.yml does not match manifest metadata/);
});

test("release check signed strategy fails strict mode without signing env", () => {
  const result = runReleaseCheck({
    LIFEOS_DISTRIBUTION: "signed",
    LIFEOS_RELEASE_STRICT: "1",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /signed distribution requires CSC_LINK and CSC_KEY_PASSWORD/);
});

test("release check rejects unknown distribution strategy", () => {
  const result = runReleaseCheck({
    LIFEOS_DISTRIBUTION: "sideways",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /LIFEOS_DISTRIBUTION must be either unsigned or signed/);
});

test("release check accepts an HTTPS update directory URL", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-check-update-url-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await createPackagedMacApp(releaseDir, {
    "desktop/main.cjs": packagedDesktopMain,
    "dist/server.cjs": "module.exports = {};",
    "dist/index.html": "<!doctype html>",
    "package.json": JSON.stringify({ name: "lifeos-ai", main: "desktop/main.cjs" }),
  });

  const result = runReleaseCheck({
    LIFEOS_RELEASE_DIR: releaseDir,
    LIFEOS_UPDATE_URL: "https://updates.example.com/lifeos-ai/v0.1.0",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /desktop update URL is configured with HTTPS/);
  assert.match(result.stdout, /desktop update URL does not contain embedded credentials or tokens/);
  assert.match(result.stdout, /desktop update URL points to a release directory/);
});

test("release check rejects update URLs that embed secrets", () => {
  const result = runReleaseCheck({
    LIFEOS_UPDATE_URL: "https://user:pass@updates.example.com/lifeos-ai?token=secret#latest",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /LIFEOS_UPDATE_URL must not include credentials, query strings, or fragments/);
});

test("release check rejects update URLs that point to a single artifact", () => {
  const result = runReleaseCheck({
    LIFEOS_UPDATE_URL: `https://updates.example.com/lifeos-ai/${encodeURIComponent(currentMacZipName)}`,
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /LIFEOS_UPDATE_URL must point to the release directory/);
});
