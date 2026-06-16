import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
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

async function createPackagedMacApp(releaseDir, entries) {
  const sourceDir = path.join(releaseDir, "asar-source");
  const resourcesDir = path.join(releaseDir, "mac-arm64", "LifeOS AI.app", "Contents", "Resources");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });
  const zipName = "LifeOS AI-0.0.0-arm64-unsigned.zip";
  const zipContent = "fake unsigned zip";
  const zipHash = crypto.createHash("sha512").update(zipContent).digest("base64");
  const zipSha256 = crypto.createHash("sha256").update(zipContent).digest("hex");
  await writeFile(path.join(releaseDir, zipName), zipContent);
  await writeFile(path.join(releaseDir, "SHA256SUMS"), `${zipSha256}  ${zipName}\n`);
  await writeFile(path.join(releaseDir, "INSTALL-unsigned-mac.md"), [
    "# LifeOS AI unsigned macOS install",
    "If macOS Gatekeeper reports an unidentified developer, open System Settings > Privacy & Security and choose Open Anyway.",
    "On first launch, set the admin password, configure AI, create a backup, enable daily automatic backups, and bind the mobile PWA.",
    "Use Export Diagnostics from the app menu if startup fails.",
    "",
  ].join("\n"));
  await writeFile(path.join(releaseDir, "USER-INSTALL.md"), [
    "# User Install Guide",
    "## macOS Unsigned Zip",
    "Use Open Anyway if macOS blocks the unsigned app.",
    "## Windows NSIS Installer",
    "Run the installer and only continue past SmartScreen after verifying SHA256SUMS.",
    "## Linux AppImage",
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
    "Run shasum -a 256 -c SHA256SUMS on macOS or Linux.",
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
    "version: \"0.0.0\"",
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
    version: "0.0.0",
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

  await writeFile(path.join(releaseDir, "LifeOS AI.dmg"), "fake dmg bytes for feed smoke");
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
  assert.match(feed, /LifeOS AI\.dmg/);
  assert.match(feed, /sha512:/);
  assert.match(feed, /releaseDate:/);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake dmg bytes for feed smoke").digest("hex")}  LifeOS AI\\.dmg`));

  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.0.0");
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].platform, "mac");
  assert.equal(manifest.artifacts[0].feedFile, "latest-mac.yml");
  assert.equal(manifest.artifacts[0].fileName, "LifeOS AI.dmg");
  assert.equal(manifest.artifacts[0].size, (await stat(path.join(releaseDir, "LifeOS AI.dmg"))).size);
  assert.equal(manifest.artifacts[0].sha256, crypto.createHash("sha256").update("fake dmg bytes for feed smoke").digest("hex"));
  assert.match(feed, new RegExp(manifest.artifacts[0].sha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("release feed generator accepts unsigned mac zip artifacts", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-zip-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await writeFile(path.join(releaseDir, "LifeOS AI-0.0.0-arm64-unsigned.zip"), "fake zip bytes for feed smoke");
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
  assert.match(feed, /LifeOS AI-0\.0\.0-arm64-unsigned\.zip/);
  assert.match(feed, /sha512:/);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake zip bytes for feed smoke").digest("hex")}  LifeOS AI-0\\.0\\.0-arm64-unsigned\\.zip`));

  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.equal(manifest.artifacts[0].fileName, "LifeOS AI-0.0.0-arm64-unsigned.zip");
  assert.equal(manifest.artifacts[0].feedFile, "latest-mac.yml");
  assert.equal(manifest.artifacts[0].sha256, crypto.createHash("sha256").update("fake zip bytes for feed smoke").digest("hex"));
});

test("release feed generator writes Windows and Linux updater metadata", async (t) => {
  const releaseDir = await mkdtemp(path.join(tmpdir(), "lifeos-release-feed-cross-platform-"));
  t.after(async () => {
    await rm(releaseDir, { recursive: true, force: true });
  });

  await writeFile(path.join(releaseDir, "LifeOS AI Setup 0.0.0.exe"), "fake nsis bytes for feed smoke");
  await writeFile(path.join(releaseDir, "LifeOS AI-0.0.0.AppImage"), "fake appimage bytes for feed smoke");
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
  assert.match(winFeed, /LifeOS AI Setup 0\.0\.0\.exe/);
  assert.match(linuxFeed, /LifeOS AI-0\.0\.0\.AppImage/);
  assert.match(winFeed, /sha512:/);
  assert.match(linuxFeed, /sha512:/);
  const checksums = await readFile(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake nsis bytes for feed smoke").digest("hex")}  LifeOS AI Setup 0\\.0\\.0\\.exe`));
  assert.match(checksums, new RegExp(`${crypto.createHash("sha256").update("fake appimage bytes for feed smoke").digest("hex")}  LifeOS AI-0\\.0\\.0\\.AppImage`));

  const manifest = JSON.parse(await readFile(path.join(releaseDir, "update-feed", "release-manifest.json"), "utf8"));
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.platform).sort(), ["linux", "windows"]);
  const windows = manifest.artifacts.find((artifact) => artifact.platform === "windows");
  const linux = manifest.artifacts.find((artifact) => artifact.platform === "linux");
  assert.equal(windows.feedFile, "latest.yml");
  assert.equal(windows.fileName, "LifeOS AI Setup 0.0.0.exe");
  assert.equal(windows.size, (await stat(path.join(releaseDir, "LifeOS AI Setup 0.0.0.exe"))).size);
  assert.equal(windows.sha256, crypto.createHash("sha256").update("fake nsis bytes for feed smoke").digest("hex"));
  assert.match(winFeed, new RegExp(windows.sha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(linux.feedFile, "latest-linux.yml");
  assert.equal(linux.fileName, "LifeOS AI-0.0.0.AppImage");
  assert.equal(linux.size, (await stat(path.join(releaseDir, "LifeOS AI-0.0.0.AppImage"))).size);
  assert.equal(linux.sha256, crypto.createHash("sha256").update("fake appimage bytes for feed smoke").digest("hex"));
  assert.match(linuxFeed, new RegExp(linux.sha512.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
  assert.match(result.stdout, /quality gate script runs lint, tests, e2e, desktop, and release checks/);
  assert.match(result.stdout, /desktop release smoke builds unsigned macOS zip/);
  assert.match(result.stdout, /desktop release smoke builds unsigned Windows NSIS artifact/);
  assert.match(result.stdout, /desktop release smoke builds Linux AppImage artifact/);
  assert.match(result.stdout, /desktop release smoke regenerates update feed after Windows\/Linux builds/);
  assert.match(result.stdout, /desktop release smoke verifies packaged artifacts after building/);
  assert.match(result.stdout, /desktop release smoke can launch the packaged macOS app when requested/);
  assert.match(result.stdout, /desktop artifact launch smoke script starts the packaged app/);
  assert.match(result.stdout, /desktop artifact smoke verifies update feed, packaged asar, and optional launch/);
  assert.match(result.stdout, /desktop artifact smoke verifies unsigned macOS ad-hoc signature/);
  assert.match(result.stdout, /desktop artifact smoke verifies packaged dependency safety metadata/);
  assert.match(result.stdout, /desktop artifact smoke verifies Electron runtime entitlements/);
  assert.match(result.stdout, /unsigned macOS zip packaging uses electron-builder ad-hoc signing and verifies before zipping/);
  assert.match(result.stdout, /desktop artifact smoke verifies packaged mobile pairing install manifest/);
  assert.match(result.stdout, /release SHA256SUMS includes artifact: LifeOS AI-0\.0\.0-arm64-unsigned\.zip/);
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
  assert.match(result.stdout, /device pairing QR page exposes recommended URL safety and reachability test/);
  assert.match(result.stdout, /connection diagnostics have Cloudflare\/Tailscale mock coverage and sanitize test URLs/);
  assert.match(result.stdout, /public mode health and dashboard expose actionable security risk items/);
  assert.match(result.stdout, /PWA preserves pending pairing token across iOS add-to-home-screen/);
  assert.match(result.stdout, /PWA pairing intent rejects malformed and unsafe tokens/);
  assert.match(result.stdout, /PWA install path carries pairing token through iOS add-to-home-screen/);
  assert.match(result.stdout, /PWA install path rejects malformed and unsafe pairing tokens/);
  assert.match(result.stdout, /mobile device page surfaces PWA install and background sync capability status/);
  assert.match(result.stdout, /mobile device page supports token paste rebinding without naked pair links/);
  assert.match(result.stdout, /mobile device page can revoke its own server-side binding with audit coverage/);
  assert.match(result.stdout, /mobile device credentials migrate away from localStorage and expose storage status/);
  assert.match(result.stdout, /frontend clears sensitive localStorage residue without breaking pairing or credential migration/);
  assert.match(result.stdout, /offline queue UI uses localized status and item retry timing/);
  assert.match(result.stdout, /mobile action permission center summarizes, clears, and audits local app launches/);
  assert.match(result.stdout, /mobile action URL scheme whitelist rejects blocked and malformed schemes/);
  assert.match(result.stdout, /data export redaction covers AI keys, tokens, auth headers, crypto fields, URLs, and local paths/);
  assert.match(result.stdout, /admin diagnostic bundle includes redacted release manifest and checksum metadata/);
  assert.match(result.stdout, /admin settings diagnostics surfaces release manifest and checksum status/);
  assert.match(result.stdout, /client state API responses and realtime broadcasts redact sensitive values/);
  assert.match(result.stdout, /client state stores normalized URL scheme allowlists in SQLite/);
  assert.match(result.stdout, /AI multi-provider UI and local endpoint validation are covered/);
  assert.match(result.stdout, /AI key storage reports system secure store, fallback, and migration state/);
  assert.match(result.stdout, /high-risk AI key, device, and backup actions include detailed redacted audit metadata/);
  assert.match(result.stdout, /pending restore cancellation is implemented across DB, API, UI, audit, and tests/);
  assert.match(result.stdout, /backup restore API exposes only whitelisted restore metadata/);
  assert.match(result.stdout, /backup restore previews are shown before restore in settings and dashboard/);
  assert.match(result.stdout, /backup restore UI confirmation copy is shared and tested/);
  assert.match(result.stdout, /ordinary SQLite backups exclude AI keys and sensitive client state by default/);
  assert.match(result.stdout, /data cleanup has dry-run preview across API, UI, audit, and tests/);
  assert.match(result.stdout, /desktop logs folder menu action is implemented/);
  assert.match(result.stdout, /desktop diagnostic includes redacted log tail/);
  assert.match(result.stdout, /desktop diagnostic exposes a safe logs directory label/);
  assert.match(result.stdout, /desktop diagnostic includes local core health and admin status snapshots/);
  assert.match(result.stdout, /desktop diagnostic includes release manifest and checksum metadata/);
  assert.match(result.stdout, /desktop diagnostic captures first-launch onboarding routing state/);
  assert.match(result.stdout, /desktop smoke verifies first-launch setup routes into onboarding/);
  assert.match(result.stdout, /desktop tray exposes refreshed health\/admin\/AI\/device status/);
  assert.match(result.stdout, /desktop startup failure page points users to logs/);
  assert.match(result.stdout, /desktop startup failure menu exposes diagnostics and logs/);
  assert.match(result.stdout, /packaged macOS app desktop diagnostic includes local core health\/admin snapshots/);
  assert.match(result.stdout, /packaged macOS app desktop diagnostic includes release metadata snapshot/);
  assert.match(result.stdout, /unsigned macOS release includes user install and Gatekeeper guidance/);
  assert.match(result.stdout, /unsigned macOS release includes non-developer user install guide/);
  assert.match(result.stdout, /user install guide covers install, first launch, phone binding, backups, updates, and troubleshooting/);
  assert.doesNotMatch(result.stdout, /release USER-INSTALL\.md should explain first launch, browser fallback recovery, phone binding, add-to-home-screen recovery/);
  assert.match(result.stdout, /release checklist documents unsigned\/signed distribution, update feed, and signing inputs/);
  assert.match(result.stdout, /desktop release guide covers cross-platform packaging, update channel, and diagnostics/);
  assert.match(result.stdout, /Release check: .*0 warnings, 0 failures/);
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
    LIFEOS_UPDATE_URL: "https://updates.example.com/lifeos-ai/v0.0.0",
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
    LIFEOS_UPDATE_URL: "https://updates.example.com/lifeos-ai/LifeOS%20AI-0.0.0-arm64-unsigned.zip",
  });
  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /LIFEOS_UPDATE_URL must point to the release directory/);
});
