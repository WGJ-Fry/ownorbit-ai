import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const rootDir = process.cwd();
const releaseDir = process.env.LIFEOS_RELEASE_DIR || path.join(rootDir, "release");
const strict = process.env.LIFEOS_RELEASE_STRICT === "1";
const distribution = process.env.LIFEOS_DISTRIBUTION || "";
const skipReleaseArtifacts = process.env.LIFEOS_RELEASE_SKIP_ARTIFACTS === "1";
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const translationsSource = exists("src/i18n/translations.ts") ? fs.readFileSync(path.join(rootDir, "src/i18n/translations.ts"), "utf8") : "";
const require = createRequire(import.meta.url);
const results = [];

function pass(message) {
  results.push({ level: "PASS", message });
}

function warn(message) {
  results.push({ level: "WARN", message });
}

function fail(message) {
  results.push({ level: "FAIL", message });
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function hasScript(name) {
  return typeof packageJson.scripts?.[name] === "string";
}

function hasBuildFile(pattern) {
  return packageJson.build?.files?.some((entry) => entry.includes(pattern));
}

function countLines(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8").split(/\r?\n/).length;
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

function checkDependencySecurityPins() {
  const allDeps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  if (versionAtLeast(allDeps.vite, "8.0.0")) pass("Vite dependency is pinned to the esbuild-safe major line");
  else fail("Vite must stay on 8.x or newer so release builds do not rely on vulnerable esbuild 0.25.x");

  if (versionAtLeast(allDeps["@vitejs/plugin-react"], "6.0.0")) pass("React Vite plugin is compatible with Vite 8");
  else fail("@vitejs/plugin-react must stay on 6.x or newer for Vite 8 compatibility");

  if (versionAtLeast(allDeps.esbuild, "0.28.1")) pass("direct esbuild dependency is at the audited safe version");
  else fail("direct esbuild dependency must be 0.28.1 or newer");

  if (packageJson.overrides?.esbuild === "$esbuild") pass("package overrides force transitive esbuild to the audited safe version");
  else fail('package.json must keep overrides.esbuild="$esbuild" so tsx/Vite cannot install a vulnerable esbuild copy');

  if (exists("package-lock.json")) {
    const lock = JSON.parse(fs.readFileSync(path.join(rootDir, "package-lock.json"), "utf8"));
    const esbuildVersions = Object.entries(lock.packages || {})
      .map(([entryPath, entry]) => entryPath.endsWith("node_modules/esbuild") ? entry?.version : null)
      .filter(Boolean);
    const unsafeEsbuild = esbuildVersions.filter((version) => !versionAtLeast(version, "0.28.1"));
    if (esbuildVersions.length && unsafeEsbuild.length === 0) pass("package-lock keeps all esbuild copies on the audited safe version");
    else fail(`package-lock contains unsafe esbuild versions: ${unsafeEsbuild.join(", ") || "none found"}`);
  } else {
    fail("package-lock.json is required for reproducible audited installs");
  }
}

function checkTypeScriptConfig() {
  if (!exists("tsconfig.json")) {
    fail("tsconfig.json is required for lint/typecheck stability");
    return;
  }

  const tsconfig = JSON.parse(fs.readFileSync(path.join(rootDir, "tsconfig.json"), "utf8"));
  const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
  const exclude = Array.isArray(tsconfig.exclude) ? tsconfig.exclude : [];
  const requiredIncludes = ["src", "server", "server.ts", "desktop", "tests", "scripts"];
  const missingIncludes = requiredIncludes.filter((entry) => !include.includes(entry));
  if (missingIncludes.length === 0) pass("TypeScript config has an explicit source include list");
  else fail(`tsconfig include is missing source entries: ${missingIncludes.join(", ")}`);

  const requiredExcludes = ["dist", "release", "test-results", "node_modules", ".playwright-data"];
  const missingExcludes = requiredExcludes.filter((entry) => !exclude.includes(entry));
  if (missingExcludes.length === 0) pass("TypeScript config excludes generated build and test artifacts");
  else fail(`tsconfig exclude is missing generated artifact entries: ${missingExcludes.join(", ")}`);
}

function checkSourceSizeBudgets() {
  const budgets = [
    { path: "src/App.tsx", maxLines: 700, label: "App shell" },
    { path: "src/services/chatMessageStorage.ts", maxLines: 100, label: "Chat message storage service" },
    { path: "src/services/systemActionStorage.ts", maxLines: 120, label: "System action storage service" },
    { path: "src/components/apps/StudioApp.tsx", maxLines: 700, label: "Studio shell" },
    { path: "src/pages/admin/settings/BackupRestorePanel.tsx", maxLines: 560, label: "Backup restore panel" },
    { path: "src/pages/admin/settings/BackupList.tsx", maxLines: 120, label: "Backup list" },
    { path: "src/pages/admin/settings/BackupPreviewCard.tsx", maxLines: 120, label: "Backup preview card" },
    { path: "src/pages/mobile/MobileDevicePage.tsx", maxLines: 520, label: "Mobile device page" },
    { path: "src/pages/mobile/MobileOfflineQueuePanel.tsx", maxLines: 180, label: "Mobile offline queue panel" },
    { path: "src/pages/admin/ConnectionGuide.tsx", maxLines: 480, label: "Connection guide" },
    { path: "src/pages/admin/ConnectionRecommendedEntryCard.tsx", maxLines: 160, label: "Connection recommended entry card" },
    { path: "src/pages/admin/settings/AiKeyPanel.tsx", maxLines: 340, label: "AI key panel" },
    { path: "src/pages/admin/AdminDashboardPage.tsx", maxLines: 430, label: "Admin dashboard" },
  ];

  for (const budget of budgets) {
    if (!exists(budget.path)) {
      fail(`${budget.label} source file is missing: ${budget.path}`);
      continue;
    }
    const lineCount = countLines(budget.path);
    if (lineCount <= budget.maxLines) {
      pass(`${budget.label} stays under ${budget.maxLines} lines (${lineCount})`);
    } else {
      fail(`${budget.label} has grown to ${lineCount} lines; keep it under ${budget.maxLines} by moving state, API, or panels into modules`);
    }
  }
}

function checkScripts() {
  for (const script of ["build", "desktop", "desktop:pack", "desktop:pack:unsigned", "desktop:zip:unsigned", "desktop:dist", "desktop:dist:mac", "desktop:dist:win", "desktop:dist:linux", "desktop:artifact:smoke", "desktop:artifact:smoke:launch", "desktop:release:smoke", "remote:smoke", "remote:acceptance", "remote:mock-smoke", "test", "test:e2e", "test:desktop", "quality:gate", "release:check", "release:check:unsigned", "release:artifacts:check", "release:artifacts:fix", "release:feed", "check:cold-launch"]) {
    if (hasScript(script)) pass(`package script exists: ${script}`);
    else fail(`missing package script: ${script}`);
  }

  if (exists("scripts/check-cold-launch-readiness.mjs")) {
    const coldLaunchCheck = spawnSync(process.execPath, ["scripts/check-cold-launch-readiness.mjs"], {
      cwd: rootDir,
      env: { ...process.env, LIFEOS_CHECK_GHCR: "" },
      encoding: "utf8",
    });
    if (coldLaunchCheck.status === 0 && coldLaunchCheck.stdout.includes("Cold launch readiness passed")) {
      pass("cold launch readiness verifies README, Compose, release tag, and GHCR image references");
    } else {
      fail(`cold launch readiness check failed: ${(coldLaunchCheck.stderr || coldLaunchCheck.stdout || "").trim()}`);
    }
  } else {
    fail("missing cold launch readiness checker: scripts/check-cold-launch-readiness.mjs");
  }

  if (exists("scripts/check-release-artifact-versions.mjs")) {
    const artifactVersionCheck = fs.readFileSync(path.join(rootDir, "scripts/check-release-artifact-versions.mjs"), "utf8");
    if (
      artifactVersionCheck.includes("Release artifacts do not match package version") &&
      artifactVersionCheck.includes("process.argv.includes(\"--fix\")") &&
      artifactVersionCheck.includes("fs.rmSync")
    ) pass("release artifact version checker can block and explicitly clean stale installers");
    else fail("release artifact version checker is missing stale-version detection or explicit cleanup mode");
  } else {
    fail("missing stale release artifact version checker: scripts/check-release-artifact-versions.mjs");
  }

  const qualityGate = packageJson.scripts?.["quality:gate"] || "";
  const requiredQualitySteps = ["npm run lint", "npm test", "npm run test:e2e", "npm run test:desktop", "npm run release:check:unsigned"];
  const missingQualitySteps = requiredQualitySteps.filter((step) => !qualityGate.includes(step));
  if (missingQualitySteps.length === 0) pass("quality gate script runs lint, tests, e2e, desktop, and release checks");
  else fail(`quality:gate is missing required steps: ${missingQualitySteps.join(", ")}`);

  const testScriptForTsRuntime = packageJson.scripts?.test || "";
  if (!/&& node --test --test-concurrency=1/.test(testScriptForTsRuntime) && (testScriptForTsRuntime.match(/node --import tsx --test/g) || []).length >= 2) {
    pass("npm test loads tsx for all TypeScript-importing test batches");
  } else {
    fail("npm test must use node --import tsx for every batch that imports TypeScript server modules");
  }

  if (exists("scripts/desktop-release-smoke.mjs")) pass("desktop release smoke script exists");
  else fail("missing desktop release smoke script: scripts/desktop-release-smoke.mjs");

  if (exists("scripts/remote-connection-smoke.mjs")) {
    const remoteSmoke = fs.readFileSync(path.join(rootDir, "scripts/remote-connection-smoke.mjs"), "utf8");
    const remoteSmokeTest = exists("tests/remote-connection-smoke.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/remote-connection-smoke.test.mjs"), "utf8") : "";
    const testScript = packageJson.scripts?.test || "";
    if (
      packageJson.scripts?.["remote:smoke"]?.includes("remote-connection-smoke.mjs") &&
      remoteSmoke.includes("/api/v1/health") &&
      remoteSmoke.includes("/mobile/chat") &&
      remoteSmoke.includes("/api/v1/ws") &&
      remoteSmoke.includes("LIFEOS_REMOTE_BASE_URL") &&
      remoteSmoke.includes("desktop-runtime-config.json") &&
      remoteSmoke.includes("resolveRemoteBaseUrl") &&
      remoteSmoke.includes("classifyRemoteEntry") &&
      remoteSmoke.includes("evaluateHttpsStatus") &&
      remoteSmoke.includes("httpsStatus") &&
      remoteSmoke.includes("longTermCandidate") &&
      remoteSmoke.includes("temporary-cloudflare") &&
      remoteSmoke.includes("tailscale-https") &&
      remoteSmoke.includes("query parameters or fragments") &&
      remoteSmokeTest.includes("remote connection smoke classifies long-term and temporary entries") &&
      remoteSmokeTest.includes("result.httpsStatus.ok") &&
      remoteSmokeTest.includes("automatedChecks.httpsStatus") &&
      remoteSmokeTest.includes("query parameters or fragments") &&
      testScript.includes("tests/remote-connection-smoke.test.mjs")
    ) pass("remote connection smoke verifies health, mobile shell, websocket, saved desktop config, and long-term entry classification");
    else fail("remote connection smoke must cover health, mobile shell, websocket, env/config URL, unsafe URL rejection, long-term entry classification, and tests");
  } else {
    fail("missing remote connection smoke script: scripts/remote-connection-smoke.mjs");
  }

  if (exists("scripts/remote-connection-mock-smoke.mjs")) {
    const remoteMockSmoke = fs.readFileSync(path.join(rootDir, "scripts/remote-connection-mock-smoke.mjs"), "utf8");
    const qualityWorkflow = fs.readFileSync(path.join(rootDir, ".github", "workflows", "quality.yml"), "utf8");
    if (
      packageJson.scripts?.["remote:mock-smoke"]?.includes("remote-connection-mock-smoke.mjs") &&
      remoteMockSmoke.includes("runRemoteConnectionSmoke") &&
      remoteMockSmoke.includes("/api/v1/health") &&
      remoteMockSmoke.includes("/mobile/chat") &&
      remoteMockSmoke.includes("/api/v1/ws") &&
      qualityWorkflow.includes("npm run remote:mock-smoke")
    ) pass("GitHub Actions remote mock smoke covers health, mobile shell, and websocket");
    else fail("remote mock smoke must be wired into package scripts and GitHub Actions with health/mobile/websocket coverage");

    if (
      qualityWorkflow.includes("npx playwright install --with-deps chromium") &&
      qualityWorkflow.includes("npm run test:e2e") &&
      qualityWorkflow.includes("npm run test:desktop") &&
      qualityWorkflow.match(/NODE_OPTIONS:\s*--experimental-sqlite/g)?.length >= 4
    ) pass("GitHub Actions quality gate runs Playwright E2E, desktop smoke, SQLite-enabled tests, and remote smoke");
    else fail("GitHub Actions quality gate must run Playwright E2E, desktop smoke, SQLite-enabled tests, and remote smoke");

    const desktopSmokeTest = exists("tests/desktop-smoke.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests", "desktop-smoke.test.mjs"), "utf8") : "";
    if (
      qualityWorkflow.includes("ELECTRON_DISABLE_SANDBOX") &&
      qualityWorkflow.includes("xvfb-run -a npm run test:desktop") &&
      desktopSmokeTest.includes("electronLaunchArgs") &&
      desktopSmokeTest.includes("--no-sandbox")
    ) pass("GitHub Actions quality gate runs Linux desktop smoke under Xvfb with Electron sandbox disabled");
    else fail("Linux CI desktop smoke must run under Xvfb and disable the Electron sandbox or configure chrome-sandbox/display permissions");
  } else {
    fail("missing remote mock smoke script: scripts/remote-connection-mock-smoke.mjs");
  }

  if (exists("scripts/remote-acceptance-runbook.mjs")) {
    const remoteAcceptance = fs.readFileSync(path.join(rootDir, "scripts/remote-acceptance-runbook.mjs"), "utf8");
    const remoteSmokeTest = exists("tests/remote-connection-smoke.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/remote-connection-smoke.test.mjs"), "utf8") : "";
    if (
      packageJson.scripts?.["remote:acceptance"]?.includes("remote-acceptance-runbook.mjs") &&
      remoteAcceptance.includes("runRemoteConnectionSmoke") &&
      remoteAcceptance.includes("temporary-cloudflare") &&
      remoteAcceptance.includes("cellular-mobile-chat") &&
      remoteAcceptance.includes("restart-restore") &&
      remoteAcceptance.includes("network-interruption") &&
      remoteAcceptance.includes("diagnostic-export") &&
      remoteAcceptance.includes("LIFEOS_REMOTE_ACCEPTANCE_OUT") &&
      remoteSmokeTest.includes("remote acceptance runbook writes long-term evidence")
    ) pass("remote acceptance runbook generates evidence for long-term manual validation");
    else fail("remote acceptance runbook must cover smoke, temporary tunnel status, cellular/restart manual checks, evidence output, and tests");
  } else {
    fail("missing remote acceptance runbook script: scripts/remote-acceptance-runbook.mjs");
  }

  if (exists("scripts/desktop-release-smoke.mjs")) {
    const smoke = fs.readFileSync(path.join(rootDir, "scripts/desktop-release-smoke.mjs"), "utf8");
    if (smoke.includes("desktop:zip:unsigned")) pass("desktop release smoke builds unsigned macOS zip");
    else fail("desktop release smoke should build unsigned macOS zip on macOS");
    if (smoke.includes("desktop:dist:win") && smoke.includes("CSC_IDENTITY_AUTO_DISCOVERY")) pass("desktop release smoke builds unsigned Windows NSIS artifact");
    else fail("desktop release smoke should build unsigned Windows NSIS artifact");
    if (smoke.includes("desktop:dist:linux")) pass("desktop release smoke builds Linux AppImage artifact");
    else fail("desktop release smoke should build Linux AppImage artifact");
    if (smoke.match(/release:feed/g)?.length >= 2) pass("desktop release smoke regenerates update feed after Windows/Linux builds");
    else fail("desktop release smoke should regenerate update feed after Windows/Linux builds");
    if (smoke.includes("release:artifacts:check")) pass("desktop release smoke blocks stale installer artifacts before verification");
    else fail("desktop release smoke should run release:artifacts:check before packaged artifact verification");
    if (smoke.includes("desktop:artifact:smoke")) pass("desktop release smoke verifies packaged artifacts after building");
    else fail("desktop release smoke should run desktop:artifact:smoke after packaging");
    if (smoke.includes("LIFEOS_RELEASE_SMOKE_LAUNCH") && smoke.includes("desktop:artifact:smoke:launch")) {
      pass("desktop release smoke can launch the packaged macOS app when requested");
    } else {
      fail("desktop release smoke should support LIFEOS_RELEASE_SMOKE_LAUNCH=1 for packaged macOS launch smoke");
    }
  }

  const desktopArtifactsWorkflowPath = path.join(rootDir, ".github", "workflows", "desktop-artifacts.yml");
  if (fs.existsSync(desktopArtifactsWorkflowPath)) {
    const artifactsWorkflow = fs.readFileSync(desktopArtifactsWorkflowPath, "utf8");
    const draftAssemblerPath = path.join(rootDir, "scripts", "assemble-release-draft-assets.mjs");
    const draftAssembler = fs.existsSync(draftAssemblerPath) ? fs.readFileSync(draftAssemblerPath, "utf8") : "";
    const releaseFeedTestPath = path.join(rootDir, "tests", "release-feed.test.mjs");
    const releaseFeedTests = fs.existsSync(releaseFeedTestPath) ? fs.readFileSync(releaseFeedTestPath, "utf8") : "";
    if (
      artifactsWorkflow.includes("actions/upload-artifact@v4") &&
      artifactsWorkflow.includes("actions/download-artifact@v4") &&
      artifactsWorkflow.includes("softprops/action-gh-release@v2") &&
      artifactsWorkflow.includes("publish-draft:") &&
      artifactsWorkflow.includes("needs: package") &&
      artifactsWorkflow.includes("node scripts/assemble-release-draft-assets.mjs") &&
      artifactsWorkflow.includes("contents: write") &&
      artifactsWorkflow.includes("draft: true") &&
      artifactsWorkflow.includes("prerelease:") &&
      artifactsWorkflow.includes("generate_release_notes: true") &&
      artifactsWorkflow.includes("startsWith(github.ref, 'refs/tags/')") &&
      artifactsWorkflow.includes("npm run desktop:release:smoke") &&
      artifactsWorkflow.includes("macos-latest") &&
      artifactsWorkflow.includes("windows-latest") &&
      artifactsWorkflow.includes("ubuntu-latest") &&
      artifactsWorkflow.includes("release/*.dmg") &&
      artifactsWorkflow.includes("release/*.zip") &&
      artifactsWorkflow.includes("release/*.exe") &&
      artifactsWorkflow.includes("release/*.AppImage") &&
      artifactsWorkflow.includes("release/SHA256SUMS") &&
      artifactsWorkflow.includes("release/update-feed/latest*.yml") &&
      artifactsWorkflow.includes("release/update-feed/release-manifest.json") &&
      artifactsWorkflow.includes("release-draft/*.dmg") &&
      artifactsWorkflow.includes("release-draft/*.zip") &&
      artifactsWorkflow.includes("release-draft/*.exe") &&
      artifactsWorkflow.includes("release-draft/*.AppImage") &&
      artifactsWorkflow.includes("release-draft/SHA256SUMS") &&
      artifactsWorkflow.includes("release-draft/latest*.yml") &&
      artifactsWorkflow.includes("release-draft/release-manifest.json") &&
      draftAssembler.includes("requiredPlatforms = [\"mac\", \"windows\", \"linux\"]") &&
      draftAssembler.includes("Release draft is missing platform artifact(s)") &&
      draftAssembler.includes("Release draft is missing feed file") &&
      draftAssembler.includes("Release draft SHA256SUMS is missing artifact") &&
      releaseFeedTests.includes("release draft assembler rejects incomplete platform artifact sets")
    ) pass("desktop package artifact workflow aggregates macOS, Windows, Linux packages into one draft GitHub Release");
    else fail("desktop package artifact workflow must build, verify, aggregate, and attach all platform package artifacts plus update metadata to one draft GitHub Release");
  } else {
    fail("missing desktop package artifact workflow: .github/workflows/desktop-artifacts.yml");
  }

  if (exists("scripts/desktop-artifact-smoke.mjs")) {
    const artifactSmoke = fs.readFileSync(path.join(rootDir, "scripts/desktop-artifact-smoke.mjs"), "utf8");
    const launchSmokeScript = packageJson.scripts?.["desktop:artifact:smoke:launch"] || "";
    if (launchSmokeScript.includes("LIFEOS_ARTIFACT_SMOKE_LAUNCH=1") && launchSmokeScript.includes("desktop-artifact-smoke.mjs")) {
      pass("desktop artifact launch smoke script starts the packaged app");
    } else {
      fail("desktop:artifact:smoke:launch should set LIFEOS_ARTIFACT_SMOKE_LAUNCH=1 and run desktop-artifact-smoke.mjs");
    }
    if (artifactSmoke.includes("release-manifest.json") && artifactSmoke.includes("app.asar") && artifactSmoke.includes("LIFEOS_ARTIFACT_SMOKE_LAUNCH")) {
      pass("desktop artifact smoke verifies update feed, packaged asar, and optional launch");
    } else {
      fail("desktop artifact smoke should verify update feed, packaged asar, and optional launch");
    }
    if (artifactSmoke.includes("codesign") && artifactSmoke.includes("valid ad-hoc signature")) pass("desktop artifact smoke verifies unsigned macOS ad-hoc signature");
    else fail("desktop artifact smoke should verify unsigned macOS ad-hoc signature");
    if (
      artifactSmoke.includes("checkPackagedPackageMetadata") &&
      artifactSmoke.includes("packagedPackage.overrides?.esbuild") &&
      artifactSmoke.includes("no unsafe Vite/esbuild build tooling")
    ) pass("desktop artifact smoke verifies packaged dependency safety metadata");
    else fail("desktop artifact smoke should verify packaged dependency safety metadata");
    if (
      artifactSmoke.includes("checkPackagedMacEntitlements") &&
      artifactSmoke.includes("com.apple.security.cs.allow-jit") &&
      artifactSmoke.includes("com.apple.security.cs.allow-unsigned-executable-memory") &&
      artifactSmoke.includes("com.apple.security.cs.disable-library-validation")
    ) pass("desktop artifact smoke verifies Electron runtime entitlements");
    else fail("desktop artifact smoke should verify Electron runtime entitlements");
    if (
      artifactSmoke.includes("/mobile/pair?token=") &&
      artifactSmoke.includes("/manifest.webmanifest?pairingToken=") &&
      artifactSmoke.includes("/mobile/install/") &&
      artifactSmoke.includes("packaged macOS app preserves mobile pairing token through install manifest")
    ) pass("desktop artifact smoke verifies packaged mobile pairing install manifest");
    else fail("desktop artifact smoke should verify packaged mobile pairing install manifest");
  } else {
    fail("missing desktop artifact smoke script: scripts/desktop-artifact-smoke.mjs");
  }

  if (exists("scripts/package-unsigned-mac.mjs")) {
    const packageUnsignedMac = fs.readFileSync(path.join(rootDir, "scripts/package-unsigned-mac.mjs"), "utf8");
    const packageJsonSource = fs.readFileSync(path.join(rootDir, "package.json"), "utf8");
    const entitlementsSource = exists("build/entitlements.mac.plist") ? fs.readFileSync(path.join(rootDir, "build/entitlements.mac.plist"), "utf8") : "";
    if (
      packageJsonSource.includes("-c.mac.identity=-") &&
      packageJsonSource.includes("build/entitlements.mac.plist") &&
      packageUnsignedMac.includes("codesign") &&
      packageUnsignedMac.includes("ad-hoc signature verified") &&
      entitlementsSource.includes("com.apple.security.cs.allow-jit") &&
      entitlementsSource.includes("com.apple.security.cs.allow-unsigned-executable-memory") &&
      entitlementsSource.includes("com.apple.security.cs.disable-library-validation")
    ) pass("unsigned macOS zip packaging uses electron-builder ad-hoc signing and verifies before zipping");
    else fail("unsigned macOS zip packaging should use electron-builder ad-hoc signing and verify before zipping");
  } else {
    fail("missing unsigned macOS package script: scripts/package-unsigned-mac.mjs");
  }
}

function checkBuildConfig() {
  if (packageJson.main === "desktop/main.cjs") pass("Electron main points to desktop/main.cjs");
  else fail("package main should point to desktop/main.cjs");

  if (packageJson.build?.appId && packageJson.build?.productName) pass("Electron appId and productName are configured");
  else fail("Electron appId/productName are missing");

  if (packageJson.build?.electronDist === "node_modules/electron/dist") pass("electron-builder uses the local Electron binary");
  else warn("build.electronDist is not pinned to node_modules/electron/dist");

  for (const pattern of ["dist", "desktop", "package.json"]) {
    if (hasBuildFile(pattern)) pass(`Electron files include ${pattern}`);
    else fail(`Electron files should include ${pattern}`);
  }

  const configuredIcons = [packageJson.build?.mac?.icon, packageJson.build?.win?.icon, packageJson.build?.linux?.icon].filter(Boolean);
  const missingIcons = configuredIcons.filter((iconPath) => !exists(iconPath));
  if (configuredIcons.length > 0 && missingIcons.length === 0) {
    pass(`platform icon configuration is present: ${configuredIcons.join(", ")}`);
  } else if (configuredIcons.length > 0) {
    fail(`configured platform icon files are missing: ${missingIcons.join(", ")}`);
  } else {
    warn("platform installer icons are not configured yet");
  }

  const macTargets = packageJson.build?.mac?.target || [];
  const winTargets = packageJson.build?.win?.target || [];
  const linuxTargets = packageJson.build?.linux?.target || [];
  if (macTargets.includes("dmg")) pass("macOS DMG target is configured");
  else warn("macOS DMG target is not configured");
  if (winTargets.includes("nsis")) pass("Windows NSIS target is configured");
  else warn("Windows NSIS target is not configured");
  if (linuxTargets.includes("AppImage")) pass("Linux AppImage target is configured");
  else warn("Linux AppImage target is not configured");
}

function checkAssets() {
  const viteConfigSource = exists("vite.config.ts") ? fs.readFileSync(path.join(rootDir, "vite.config.ts"), "utf8") : "";
  const indexHtmlSource = exists("index.html") ? fs.readFileSync(path.join(rootDir, "index.html"), "utf8") : "";
  const mobileInstallSource = exists("server/mobileInstall.ts") ? fs.readFileSync(path.join(rootDir, "server/mobileInstall.ts"), "utf8") : "";

  if (
    viteConfigSource.includes("base: './'") &&
    indexHtmlSource.includes('href="manifest.webmanifest"') &&
    indexHtmlSource.includes('href="icons/icon-192.png"')
  ) pass("frontend build assets are relative for reverse-proxy subpaths");
  else fail("frontend build assets or PWA links are not relative for reverse-proxy subpaths");

  if (exists("public/icon.svg")) pass("PWA icon exists: public/icon.svg");
  else fail("missing PWA icon: public/icon.svg");
  if (exists("public/icons/icon-192.png") && exists("public/icons/icon-512.png")) pass("PWA install PNG icons exist for Android/iOS launch surfaces");
  else fail("missing PWA PNG install icons: public/icons/icon-192.png and public/icons/icon-512.png");

  if (exists("public/manifest.webmanifest")) {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "public/manifest.webmanifest"), "utf8"));
    const iconSources = (manifest.icons || []).map((icon) => icon.src);
    if (
      manifest.start_url === "/mobile/chat" &&
      manifest.display === "standalone" &&
      iconSources.includes("/icons/icon-192.png") &&
      iconSources.includes("/icons/icon-512.png")
    ) pass("PWA manifest targets the mobile app shell");
    else fail("PWA manifest should start at /mobile/chat with standalone display and icons");
    if (manifest.screenshots?.length >= 2 && manifest.screenshots.every((screenshot) => screenshot.src && screenshot.form_factor === "narrow")) pass("PWA manifest includes mobile install screenshots");
    else warn("PWA manifest does not include mobile install screenshots");
  } else {
    fail("missing PWA manifest: public/manifest.webmanifest");
  }

  if (exists("public/offline.html")) {
    const offlineHtml = fs.readFileSync(path.join(rootDir, "public/offline.html"), "utf8");
    if (
      offlineHtml.includes("offline-queue-status") &&
      offlineHtml.includes("lifeos-offline-queue") &&
      offlineHtml.includes("lifeos_offline_message_queue") &&
      offlineHtml.includes("Queue source") &&
      offlineHtml.includes("IndexedDB") &&
      offlineHtml.includes("failed")
    ) pass("PWA offline fallback page shows persisted queue status");
    else fail("PWA offline fallback should show persisted offline queue status");
  } else fail("missing PWA offline fallback: public/offline.html");

  if (exists("public/sw.js")) {
    const sw = fs.readFileSync(path.join(rootDir, "public/sw.js"), "utf8");
    if (sw.includes("BASE_PATH") && sw.includes("withBasePath") && sw.includes("OFFLINE_FALLBACK") && sw.includes("/mobile/chat") && sw.includes("/mobile/device") && sw.includes("/mobile/actions")) pass("PWA service worker caches mobile shell routes");
    else fail("PWA service worker should cache offline fallback and mobile routes");
    if (sw.includes("/icons/icon-192.png") && sw.includes("/icons/icon-512.png")) pass("PWA service worker caches install icons for offline startup");
    else warn("PWA service worker does not cache install icons");
    if (sw.includes("extractBuildAssets") && sw.includes("cacheBuildAssets") && sw.includes("cache.addAll(buildAssets)")) pass("PWA service worker pre-caches production build assets");
    else fail("PWA service worker should pre-cache Vite build assets for offline startup");
    if (sw.includes("lifeos-offline-queue") && sw.includes("LIFEOS_SYNC_OFFLINE_QUEUE")) pass("PWA service worker supports background offline queue sync");
    else warn("PWA service worker does not expose offline queue sync hooks");
    if (/lifeos-ai-shell-v\d+/.test(sw) && sw.includes("LIFEOS_SKIP_WAITING")) pass("PWA service worker supports immediate update activation");
    else warn("PWA service worker does not support immediate update activation");
  } else {
    fail("missing PWA service worker: public/sw.js");
  }

  const mainSource = exists("src/main.tsx") ? fs.readFileSync(path.join(rootDir, "src/main.tsx"), "utf8") : "";
  if (
    mainSource.includes("basename={lifeosBasePath || undefined}") &&
    mainSource.includes("navigator.serviceWorker.register(`${lifeosBasePath}/sw.js`")
  ) pass("PWA router and service worker registration preserve reverse-proxy base paths");
  else fail("PWA router or service worker registration does not preserve reverse-proxy base paths");
  if (mainSource.includes("controllerchange") && mainSource.includes("window.location.reload()") && mainSource.includes("registration.update()")) pass("PWA client reloads after service worker updates");
  else warn("PWA client does not reload after service worker updates");

  if (
    mobileInstallSource.includes("getConfiguredPublicBasePath") &&
    mobileInstallSource.includes("withBasePath") &&
    mobileInstallSource.includes("htmlWithPublicBaseHref") &&
    mobileInstallSource.includes("publicBaseHref") &&
    mobileInstallSource.includes("manifestHref = `${withBasePath") &&
    mobileInstallSource.includes("id: withBasePath") &&
    mobileInstallSource.includes("scope: withBasePath")
  ) pass("PWA manifest, install HTML, and SPA base href support public base paths");
  else fail("PWA manifest or install HTML does not preserve public base paths");

  const adminRoutesSource = exists("server/routes/adminRoutes.ts") ? fs.readFileSync(path.join(rootDir, "server/routes/adminRoutes.ts"), "utf8") : "";
  const onboardingSource = exists("server/onboarding.ts") ? fs.readFileSync(path.join(rootDir, "server/onboarding.ts"), "utf8") : "";
  const adminLoginSource = exists("src/pages/admin/AdminLoginPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/AdminLoginPage.tsx"), "utf8") : "";
  const adminOnboardingSource = exists("src/pages/admin/AdminOnboardingPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/AdminOnboardingPage.tsx"), "utf8") : "";
  const onboardingMobileSource = exists("src/pages/admin/OnboardingMobileCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/OnboardingMobileCard.tsx"), "utf8") : "";
  const onboardingRecoverySource = exists("src/pages/admin/OnboardingRecoveryCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/OnboardingRecoveryCard.tsx"), "utf8") : "";
  const translationsSource = exists("src/i18n/translations.ts") ? fs.readFileSync(path.join(rootDir, "src/i18n/translations.ts"), "utf8") : "";
  if (
    adminRoutesSource.includes("/api/v1/admin/onboarding") &&
    adminRoutesSource.includes("admin_onboarding_completed") &&
    onboardingSource.includes("getOnboardingStatus") &&
    onboardingSource.includes("markOnboardingComplete") &&
    adminLoginSource.includes("onboardingRequired") &&
    adminOnboardingSource.includes("completeOnboarding") &&
    adminOnboardingSource.includes("getBackupSchedule") &&
    adminOnboardingSource.includes("updateBackupSchedule") &&
    adminOnboardingSource.includes("updateActiveAiProvider") &&
    adminOnboardingSource.includes("onboarding.enableDailyBackup") &&
    adminOnboardingSource.includes("onboarding.longTermBackupReminderTitle") &&
    adminOnboardingSource.includes("backupSchedule?.nextRunAt") &&
    adminOnboardingSource.includes("onboarding.defaultProvider") &&
    adminOnboardingSource.includes("onboarding.setDefault") &&
    adminOnboardingSource.includes("incompleteStepLabels") &&
    adminOnboardingSource.includes("onboarding.finishBlocked") &&
    adminOnboardingSource.includes("onboarding.finishReady") &&
    adminOnboardingSource.includes("OnboardingMobileCard") &&
    adminOnboardingSource.includes("OnboardingRecoveryCard") &&
    adminOnboardingSource.includes("desktop.copyLocalAddress") &&
    onboardingMobileSource.includes("/admin/settings#mobile-connect") &&
    onboardingMobileSource.includes("remoteReadiness") &&
    onboardingMobileSource.includes("onboarding.remoteReadinessTitle") &&
    onboardingRecoverySource.includes("onboarding.copyLocalAddress") &&
    onboardingRecoverySource.includes("onboarding.openLogsFolder") &&
    onboardingRecoverySource.includes("onboarding.exportDiagnostics") &&
    translationsSource.includes("onboarding.enableDailyBackup") &&
    translationsSource.includes("onboarding.longTermBackupReminderBody") &&
    translationsSource.includes("onboarding.remoteReadinessTitle") &&
    translationsSource.includes("onboarding.localAddressCopied") &&
    translationsSource.includes("onboarding.finishBlocked") &&
    translationsSource.includes("onboarding.finishReady") &&
    translationsSource.includes("Set as Default Chat Provider")
  ) pass("first-launch onboarding has authoritative status, completion, audit, and login routing");
  else warn("first-launch onboarding is missing status, completion, audit, or login routing");

  const networkDiagnosticsSource = exists("server/networkDiagnostics.ts") ? fs.readFileSync(path.join(rootDir, "server/networkDiagnostics.ts"), "utf8") : "";
  const desktopRuntimeConfigSource = exists("server/desktopRuntimeConfig.ts") ? fs.readFileSync(path.join(rootDir, "server/desktopRuntimeConfig.ts"), "utf8") : "";
  const connectionGuideSource = exists("src/pages/admin/ConnectionGuide.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/ConnectionGuide.tsx"), "utf8") : "";
  const connectionRecommendedEntrySource = exists("src/pages/admin/ConnectionRecommendedEntryCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/ConnectionRecommendedEntryCard.tsx"), "utf8") : "";
  const connectionMobileEntryPanelSource = exists("src/pages/admin/ConnectionMobileEntryPanel.tsx")
    ? fs.readFileSync(path.join(rootDir, "src/pages/admin/ConnectionMobileEntryPanel.tsx"), "utf8")
    : "";
  const noPhoneReachableNoticeSource = exists("src/pages/admin/NoPhoneReachableNotice.tsx")
    ? fs.readFileSync(path.join(rootDir, "src/pages/admin/NoPhoneReachableNotice.tsx"), "utf8")
    : "";
  const connectionGuideCombinedSource = `${connectionGuideSource}\n${connectionRecommendedEntrySource}\n${connectionMobileEntryPanelSource}\n${noPhoneReachableNoticeSource}`;
  const remoteStabilitySectionSource = exists("src/pages/admin/RemoteStabilitySection.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/RemoteStabilitySection.tsx"), "utf8") : "";
  const remoteHealthSummaryCardSource = exists("src/pages/admin/RemoteHealthSummaryCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/RemoteHealthSummaryCard.tsx"), "utf8") : "";
  const remoteAcceptanceChecklistSource = exists("src/pages/admin/RemoteAcceptanceChecklistCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/RemoteAcceptanceChecklistCard.tsx"), "utf8") : "";
  const remoteAcceptanceSource = exists("server/remoteAcceptance.ts") ? fs.readFileSync(path.join(rootDir, "server/remoteAcceptance.ts"), "utf8") : "";
  const remoteValidationReportSource = exists("server/remoteValidationReport.ts") ? fs.readFileSync(path.join(rootDir, "server/remoteValidationReport.ts"), "utf8") : "";
  const remoteValidationReportTestSource = exists("tests/remote-validation-report.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/remote-validation-report.test.mjs"), "utf8") : "";
  const remoteHealthMonitorSource = exists("server/remoteHealthMonitor.ts") ? fs.readFileSync(path.join(rootDir, "server/remoteHealthMonitor.ts"), "utf8") : "";
  const connectionToolStatusSource = exists("src/pages/admin/ConnectionToolStatus.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/ConnectionToolStatus.tsx"), "utf8") : "";
  const cloudflareTunnelActionsSource = exists("src/pages/admin/CloudflareTunnelActions.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/CloudflareTunnelActions.tsx"), "utf8") : "";
  const customRemoteEntrySource = exists("src/pages/admin/CustomRemoteEntryCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/CustomRemoteEntryCard.tsx"), "utf8") : "";
  const devicePairSource = exists("src/pages/admin/DevicePairPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/DevicePairPage.tsx"), "utf8") : "";
  const devicePairConnectionTestSource = exists("src/pages/admin/DevicePairConnectionTestResult.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/DevicePairConnectionTestResult.tsx"), "utf8") : "";
  const mobileChatPageSource = exists("src/pages/mobile/MobileChatPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileChatPage.tsx"), "utf8") : "";
  const devicesSource = exists("server/devices.ts") ? fs.readFileSync(path.join(rootDir, "server/devices.ts"), "utf8") : "";
  const deviceRoutesSource = exists("server/routes/deviceRoutes.ts") ? fs.readFileSync(path.join(rootDir, "server/routes/deviceRoutes.ts"), "utf8") : "";
  const networkDiagnosticsTestSource = exists("tests/network-diagnostics.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/network-diagnostics.test.mjs"), "utf8") : "";
  const cloudflareTunnelSource = exists("server/cloudflareTunnel.ts") ? fs.readFileSync(path.join(rootDir, "server/cloudflareTunnel.ts"), "utf8") : "";
  const cloudflareTunnelTestSource = exists("tests/cloudflare-tunnel.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/cloudflare-tunnel.test.mjs"), "utf8") : "";
  const clientRoutingTestSource = exists("tests/client-routing.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/client-routing.test.mjs"), "utf8") : "";
  const lifeosApiSourceForRouting = exists("src/services/lifeosApi.ts") ? fs.readFileSync(path.join(rootDir, "src/services/lifeosApi.ts"), "utf8") : "";
  const realtimeHookSource = exists("src/hooks/useLifeOSRealtime.ts") ? fs.readFileSync(path.join(rootDir, "src/hooks/useLifeOSRealtime.ts"), "utf8") : "";
  const publicBaseUrlSource = exists("server/publicBaseUrl.ts") ? fs.readFileSync(path.join(rootDir, "server/publicBaseUrl.ts"), "utf8") : "";
  const serverEntrySource = exists("server.ts") ? fs.readFileSync(path.join(rootDir, "server.ts"), "utf8") : "";
  const realtimeServerSource = exists("server/realtime.ts") ? fs.readFileSync(path.join(rootDir, "server/realtime.ts"), "utf8") : "";
  const apiAuthTestSourceForRouting = exists("tests/api-auth.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/api-auth.test.mjs"), "utf8") : "";
  const desktopRuntimeConfigSmokeTestSource = exists("tests/desktop-smoke.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/desktop-smoke.test.mjs"), "utf8") : "";
  const desktopMainSourceForRuntimeConfig = exists("desktop/main.cjs") ? fs.readFileSync(path.join(rootDir, "desktop/main.cjs"), "utf8") : "";
  if (
    networkDiagnosticsSource.includes("connectionCandidates") &&
    networkDiagnosticsSource.includes("mobilePairUrl") &&
    networkDiagnosticsSource.includes("envTemplate") &&
    networkDiagnosticsSource.includes("restartInstruction") &&
    networkDiagnosticsSource.includes("desktopRuntimeConfig") &&
    networkDiagnosticsSource.includes("saved-desktop-config") &&
    networkDiagnosticsTestSource.includes("recommends saved desktop remote config before local-only entries") &&
    networkDiagnosticsTestSource.includes("LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=https://lifeos-mac.tailnet.example.ts.net") &&
    networkDiagnosticsTestSource.includes('tailscaleHttpCandidate.envTemplate.includes("LIFEOS_TRUST_PROXY=1"), false') &&
    desktopRuntimeConfigSource.includes("desktop-runtime-config.json") &&
    desktopRuntimeConfigSource.includes("normalizeDesktopRuntimeConfig") &&
    desktopRuntimeConfigSource.includes("allowPublic") &&
    desktopRuntimeConfigSource.includes("isTailscaleHttpsServe") &&
    desktopMainSourceForRuntimeConfig.includes("applyDesktopRuntimeConfig") &&
    desktopMainSourceForRuntimeConfig.includes("desktop-runtime-config.json") &&
    networkDiagnosticsSource.includes("tailscale.magicDnsUrls") &&
    networkDiagnosticsSource.includes("magicDnsEnabled") &&
    networkDiagnosticsSource.includes("loginCommand") &&
    networkDiagnosticsSource.includes("httpsServeReady") &&
    networkDiagnosticsSource.includes("httpsServeUrl") &&
    networkDiagnosticsSource.includes("getTailscaleStatus(portOverride =") &&
    networkDiagnosticsSource.includes("tailscale serve --bg https:443") &&
    networkDiagnosticsSource.includes("LIFEOS_TRUST_PROXY=1") &&
    networkDiagnosticsSource.includes("startTailscaleHttpsServe") &&
    networkDiagnosticsSource.includes("stopTailscaleHttpsServe") &&
    networkDiagnosticsSource.includes("maybeStartConfiguredTailscaleServe") &&
    !networkDiagnosticsSource.includes('input.mode === "tailscale" || input.mode === "local"') &&
    networkDiagnosticsSource.includes("saveDesktopRuntimeConfig") &&
    networkDiagnosticsSource.includes("buildRemoteReadiness") &&
    networkDiagnosticsSource.includes("remoteReadiness") &&
    serverEntrySource.includes("maybeStartConfiguredTailscaleServe") &&
    serverEntrySource.includes("RUNNING_BUNDLED_SERVER") &&
    serverEntrySource.includes('process.env.NODE_ENV !== "production" && !RUNNING_BUNDLED_SERVER') &&
    adminRoutesSource.includes("/api/v1/admin/tailscale-serve/start") &&
    adminRoutesSource.includes("/api/v1/admin/tailscale-serve/stop") &&
    networkDiagnosticsSource.includes("tailscale-serve-https") &&
    connectionGuideSource.includes("ConnectionRecommendedEntryCard") &&
    connectionRecommendedEntrySource.includes("connection.recommendedAddress") &&
    connectionRecommendedEntrySource.includes("connection.temporaryRecommendedDescription") &&
    connectionGuideSource.includes("tailscale.loginCommand") &&
    connectionGuideSource.includes("connection.notDetected") &&
    connectionRecommendedEntrySource.includes("connection.recommendedEnv") &&
    connectionRecommendedEntrySource.includes("recommended-env") &&
    connectionRecommendedEntrySource.includes("connection.copyRecommendedEnv") &&
    connectionRecommendedEntrySource.includes("connection.copyMobileEntry") &&
    connectionRecommendedEntrySource.includes("/admin/devices/pair") &&
    connectionRecommendedEntrySource.includes("connection.openPairingQr") &&
    connectionGuideCombinedSource.includes("connection.mobileEntry") &&
    connectionGuideCombinedSource.includes("connection.pairingQrHint") &&
    !connectionGuideCombinedSource.includes('copyText("recommended-pair"') &&
    !connectionGuideCombinedSource.includes("copyText(candidate.id, candidate.mobilePairUrl)") &&
    connectionGuideSource.includes("connectionCandidates") &&
    connectionGuideSource.includes("candidate.envTemplate") &&
    connectionGuideSource.includes("connection.copyEnv") &&
    connectionGuideSource.includes("installCopy") &&
    connectionRecommendedEntrySource.includes("connection.testSavedRemote") &&
    connectionRecommendedEntrySource.includes("saved-desktop-config") &&
    connectionGuideSource.includes("remoteValidationReport") &&
    connectionGuideSource.includes("RemoteStabilitySection") &&
    remoteStabilitySectionSource.includes("RemoteHealthSummaryCard") &&
    remoteStabilitySectionSource.includes("RemoteAcceptanceChecklistCard") &&
    remoteStabilitySectionSource.includes("remoteHealthSummary") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.title") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.smokeTitle") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.copySmokeCommand") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.commandTitle") &&
    remoteAcceptanceChecklistSource.includes("navigator.clipboard.writeText") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.copyCommand") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.runNow") &&
    remoteAcceptanceChecklistSource.includes("onRunAcceptance") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.importTitle") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.latestEvidence") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.summaryReady") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.nextActions") &&
    remoteAcceptanceChecklistSource.includes("summary.blockingItems") &&
    remoteAcceptanceChecklistSource.includes("summary.hasLongTermEntry") &&
    remoteAcceptanceChecklistSource.includes("summary.hasRealWorldEvidence") &&
    remoteAcceptanceChecklistSource.includes("runbooks.latest") &&
    remoteAcceptanceChecklistSource.includes("completionStatus") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.manualStillRequired") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.validUntil") &&
    remoteAcceptanceChecklistSource.includes("item.expiresAt") &&
    remoteAcceptanceChecklistSource.includes("onImportReport") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.markDone") &&
    remoteAcceptanceChecklistSource.includes("onAccept") &&
    remoteAcceptanceChecklistSource.includes("cellular-mobile-chat") &&
    remoteAcceptanceChecklistSource.includes("network-interruption") &&
    remoteAcceptanceChecklistSource.includes("diagnostic-export") &&
    remoteAcceptanceChecklistSource.includes("ci-remote-mock") &&
    remoteStabilitySectionSource.includes("acceptanceEvidence") &&
    remoteStabilitySectionSource.includes("Phone Wi-Fi disabled") &&
    remoteStabilitySectionSource.includes("LIFEOS_REMOTE_ACCEPTANCE_OUT") &&
    remoteStabilitySectionSource.includes("LIFEOS_REMOTE_BASE_URL") &&
    remoteStabilitySectionSource.includes("npm run remote:smoke") &&
    remoteStabilitySectionSource.includes("npm run remote:acceptance") &&
    remoteStabilitySectionSource.includes("importRemoteAcceptanceReport") &&
    remoteStabilitySectionSource.includes("runRemoteAcceptance") &&
    remoteStabilitySectionSource.includes("remoteAcceptanceRunbooks") &&
    remoteStabilitySectionSource.includes("remoteRecoveryReport") &&
    remoteStabilitySectionSource.includes("remoteHealthMonitor") &&
    remoteStabilitySectionSource.includes("JSON.parse") &&
    remoteHealthSummaryCardSource.includes("entryKindKey") &&
    remoteHealthSummaryCardSource.includes("qr-warning") &&
    remoteHealthSummaryCardSource.includes("summary.entryKind") &&
    remoteHealthSummaryCardSource.includes("checkDetailText") &&
    remoteHealthSummaryCardSource.includes("connection.health.qrExpired") &&
    remoteHealthSummaryCardSource.includes("connection.monitor.title") &&
    remoteHealthSummaryCardSource.includes("monitor.nextRunAt") &&
    remoteHealthSummaryCardSource.includes("monitor.lastRunAt") &&
    remoteHealthSummaryCardSource.includes("restoredBaseUrl") &&
    remoteHealthSummaryCardSource.includes("connection.recovery.title") &&
    remoteHealthSummaryCardSource.includes("connection.recovery.summary") &&
    remoteHealthSummaryCardSource.includes("connection.recovery.health") &&
    remoteHealthSummaryCardSource.includes("recoveryActionKey") &&
    remoteHealthSummaryCardSource.includes('recovery?.recoveryAction ?? "none"') &&
    remoteHealthSummaryCardSource.includes("healthOkBefore") &&
    remoteHealthSummaryCardSource.includes("healthOkAfter") &&
    remoteAcceptanceSource.includes("buildRemoteAcceptanceChecklist") &&
    remoteAcceptanceSource.includes("saveRemoteAcceptanceRecord") &&
    remoteAcceptanceSource.includes("saveRemoteAcceptanceRunbookReport") &&
    remoteAcceptanceSource.includes("saveRemoteAcceptanceRunbookFromConnectionTest") &&
    remoteAcceptanceSource.includes("safeRequirements") &&
    remoteAcceptanceSource.includes("redactAuditString") &&
    remoteAcceptanceSource.includes("derivedEntryKind = entryKind(baseUrl)") &&
    remoteAcceptanceSource.includes("longTermReason(derivedEntryKind, readinessOk)") &&
    remoteAcceptanceSource.includes("evidence") &&
    remoteAcceptanceSource.includes("realWorldAcceptanceRequired") &&
    remoteAcceptanceSource.includes("automated-ready-manual-required") &&
    remoteAcceptanceSource.includes("safeHttpsStatus") &&
    remoteAcceptanceSource.includes("httpsStatus.ok") &&
    remoteAcceptanceSource.includes("getRemoteAcceptanceRunbookRecords") &&
    remoteAcceptanceSource.includes("getRemoteAcceptanceRecords") &&
    remoteAcceptanceSource.includes("summarizeRemoteAcceptanceChecklist") &&
    remoteAcceptanceSource.includes("blockingItems") &&
    remoteAcceptanceSource.includes("hasRealWorldEvidence") &&
    remoteAcceptanceSource.includes("MANUAL_ACCEPTANCE_MAX_AGE_MS") &&
    remoteAcceptanceSource.includes("latestManualRecord") &&
    remoteAcceptanceSource.includes("expiresAt") &&
    remoteAcceptanceSource.includes("older than 7 days") &&
    remoteAcceptanceSource.includes("Remote acceptance URL must not contain username, password, token, query, or fragment") &&
    remoteAcceptanceSource.includes("Remote acceptance report URLs must not contain username, password, token, query, or fragment") &&
    desktopRuntimeConfigSource.includes("Desktop connection baseUrl must not contain username, password, token, query, or fragment") &&
    apiAuthTestSourceForRouting.includes("unsafeRemoteDesktopConnectionConfig.status, 400") &&
    deviceRoutesSource.includes("getDesktopRuntimeConfig()?.publicBaseUrl") &&
    deviceRoutesSource.includes("baseUrl must not contain username, password, token, query, or fragment") &&
    apiAuthTestSourceForRouting.includes("defaultRemoteBinding.baseUrl") &&
    apiAuthTestSourceForRouting.includes("tokenizedPairingBaseUrl.status, 400") &&
    remoteAcceptanceSource.includes("manual-required") &&
    remoteAcceptanceSource.includes("LIFEOS_REMOTE_BASE_URL=https://your-stable-entry npm run remote:smoke") &&
    remoteValidationReportSource.includes("entryKind") &&
    remoteValidationReportSource.includes("classifyEntryKind") &&
    remoteValidationReportSource.includes("redactAuditString") &&
    networkDiagnosticsSource.includes("httpsStatus") &&
    remoteValidationReportSource.includes("safeHttpsStatus") &&
    remoteValidationReportSource.includes("httpsStatus?.error") &&
    remoteValidationReportSource.includes("pairingEntryMismatch") &&
    remoteValidationReportSource.includes("qr-warning") &&
    remoteValidationReportTestSource.includes('result.expiredQr.status, "qr-warning"') &&
    remoteValidationReportTestSource.includes("tlsBlocked.status") &&
    remoteValidationReportTestSource.includes('check.id === "https"') &&
    remoteValidationReportTestSource.includes('result.forged.entryKind, "temporary-cloudflare"') &&
    remoteValidationReportTestSource.includes("Forged long-term ready") &&
    remoteValidationReportTestSource.includes("automatedChecks.httpsStatus") &&
    remoteValidationReportTestSource.includes("tlsBlocked") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.httpsStatus") &&
    translationsSource.includes("connection.acceptance.httpsStatus") &&
    remoteValidationReportTestSource.includes("remote acceptance checklist expires stale real-world manual evidence") &&
    remoteValidationReportTestSource.includes("freshItem.expiresAt") &&
    remoteValidationReportTestSource.includes("older than 7 days") &&
    remoteValidationReportTestSource.includes("github_pat_remoteSecret") &&
    remoteValidationReportTestSource.includes("github_pat_acceptSecret") &&
    remoteHealthMonitorSource.includes("restoredBaseUrl") &&
    remoteHealthMonitorSource.includes("recoveryAction") &&
    remoteHealthMonitorSource.includes("check-tailscale") &&
    remoteHealthMonitorSource.includes("getConfiguredPublicBaseUrl") &&
    remoteHealthMonitorSource.includes("configuredRemoteBaseUrl") &&
    remoteHealthMonitorSource.includes("baseUrl: checkBaseUrl") &&
    remoteHealthMonitorSource.includes("getRemoteHealthMonitorStatus") &&
    remoteHealthMonitorSource.includes("setCloudflareTunnelReconnectHandler") &&
    remoteHealthMonitorSource.includes("cloudflare-reconnect") &&
    remoteHealthMonitorSource.includes("nextRunAt") &&
    remoteValidationReportTestSource.includes("remote health monitor checks configured PUBLIC_BASE_URL without a saved runtime entry") &&
    adminRoutesSource.includes("remoteHealthMonitor") &&
    lifeosApiSourceForRouting.includes("entryKind") &&
    lifeosApiSourceForRouting.includes("qr-warning") &&
    lifeosApiSourceForRouting.includes("restoredBaseUrl") &&
    lifeosApiSourceForRouting.includes("recordRemoteAcceptance") &&
    lifeosApiSourceForRouting.includes("importRemoteAcceptanceReport") &&
    lifeosApiSourceForRouting.includes("runRemoteAcceptance") &&
    remoteStabilitySectionSource.includes("handleRecordAcceptance") &&
    connectionGuideSource.includes("connection.remoteValidationOk") &&
    connectionGuideSource.includes("connection.remoteValidationFail") &&
    adminRoutesSource.includes("summarizeRemoteHealth") &&
    adminRoutesSource.includes("latestBindingSession.baseUrl") &&
    adminRoutesSource.includes("getRemoteRecoveryReport") &&
    adminRoutesSource.includes("buildRemoteAcceptanceChecklist") &&
    adminRoutesSource.includes("remoteAcceptanceSummary") &&
    adminRoutesSource.includes("summarizeRemoteAcceptanceChecklist") &&
    adminRoutesSource.includes("remoteAcceptanceRunbooks") &&
    adminRoutesSource.includes("/api/v1/admin/network-diagnostics/acceptance-report") &&
    adminRoutesSource.includes("/api/v1/admin/network-diagnostics/acceptance-run") &&
    adminRoutesSource.includes("remote_acceptance_report_imported") &&
    adminRoutesSource.includes("completionStatus") &&
    adminRoutesSource.includes("realWorldAcceptanceRequired") &&
    devicesSource.includes("base_url") &&
    exists("server/migrations/005_binding_session_base_url.sql") &&
    adminRoutesSource.includes("remote_acceptance_run_completed") &&
    adminRoutesSource.includes("latestBindingSession") &&
    adminRoutesSource.includes("saveRemoteValidationReport") &&
    adminRoutesSource.includes("persist") &&
    connectionToolStatusSource.includes("connection.copyInstallAria") &&
    connectionToolStatusSource.includes("connection.openInstallGuide") &&
    translationsSource.includes("connection.copyInstallCommand") &&
    translationsSource.includes("connection.testSavedRemote") &&
    translationsSource.includes("connection.remoteValidationOk") &&
    connectionGuideSource.includes("saveDesktopConnectionConfig") &&
    connectionGuideSource.includes("connection.saveDesktopConfig") &&
    connectionGuideCombinedSource.includes("connection.openPairingQr") &&
    connectionGuideCombinedSource.includes('href="/admin/devices/pair"') &&
    connectionGuideSource.includes("TailscaleServeActions") &&
    connectionGuideSource.includes("startTailscaleHttpsServe") &&
    connectionRecommendedEntrySource.includes("connection.packageRestartHint") &&
    connectionGuideSource.includes("CustomRemoteEntryCard") &&
    connectionGuideSource.includes("RemoteReadinessCard") &&
    customRemoteEntrySource.includes("connection.customTitle") &&
    customRemoteEntrySource.includes("testConnectionUrl") &&
    customRemoteEntrySource.includes("saveDesktopConnectionConfig") &&
    customRemoteEntrySource.includes('mode: "configured"') &&
    customRemoteEntrySource.includes("customRemoteEntryError") &&
    customRemoteEntrySource.includes("parsed.username || parsed.password || parsed.search || parsed.hash") &&
    customRemoteEntrySource.includes("connection.customUnsafeUrl") &&
    customRemoteEntrySource.includes("disabled={!canUseEntry || busy !== null}") &&
    desktopRuntimeConfigSource.includes('mode === "configured" || mode === "cloudflare"') &&
    desktopRuntimeConfigSource.includes("Public remote connection modes require an HTTPS baseUrl") &&
    translationsSource.includes("connection.recommendedAddress") &&
    translationsSource.includes("connection.temporaryRecommendedDescription") &&
    translationsSource.includes("connection.recommendedEnv") &&
    translationsSource.includes("connection.copyRecommendedEnv") &&
    translationsSource.includes("connection.saveDesktopConfig") &&
    translationsSource.includes("connection.openPairingQr") &&
    translationsSource.includes("绑定手机端”二维码都会自动使用这个入口") &&
    translationsSource.includes("Pair Phone QR code will automatically use this entry") &&
    translationsSource.includes("connection.customTitle") &&
    translationsSource.includes("connection.customUnsafeUrl") &&
    translationsSource.includes("connection.readiness.status.ready") &&
    translationsSource.includes("connection.readiness.item.needsPublicOptIn") &&
    translationsSource.includes("connection.acceptance.title") &&
    translationsSource.includes("connection.acceptance.commandTitle") &&
    translationsSource.includes("connection.recovery.title") &&
    translationsSource.includes("connection.recovery.restoredBaseUrl") &&
    translationsSource.includes("connection.recovery.health") &&
    translationsSource.includes("connection.recovery.action.checkTailscale") &&
    translationsSource.includes("connection.monitor.title") &&
    translationsSource.includes("Background Remote Health Monitor") &&
    translationsSource.includes("connection.health.entry.tailscale") &&
    translationsSource.includes("connection.health.entry.temporaryCloudflare") &&
    translationsSource.includes("connection.acceptance.runNow") &&
    translationsSource.includes("connection.acceptance.importTitle") &&
    translationsSource.includes("connection.acceptance.latestEvidence") &&
    translationsSource.includes("connection.acceptance.markDone") &&
    translationsSource.includes("connection.acceptance.summaryNotReady") &&
    translationsSource.includes("connection.acceptance.nextActions") &&
    translationsSource.includes("Long-term remote acceptance is incomplete") &&
    translationsSource.includes("Remote Acceptance Command") &&
    translationsSource.includes("Latest Auto-Recovery") &&
    translationsSource.includes("Run Automated Acceptance") &&
    translationsSource.includes("Import Real Acceptance Evidence") &&
    translationsSource.includes("Latest Imported Real Acceptance") &&
    translationsSource.includes("Long-Term Remote Acceptance Checklist") &&
    translationsSource.includes("/mobile/install/<token>") &&
    lifeosApiSourceForRouting.includes("getLifeOSBasePath") &&
    lifeosApiSourceForRouting.includes("apiUrl(url)") &&
    lifeosApiSourceForRouting.includes("realtimeWebSocketUrl") &&
    realtimeHookSource.includes("realtimeWebSocketUrl()") &&
    realtimeHookSource.includes("reconnectTimerRef") &&
    realtimeHookSource.includes("clearReconnectTimer") &&
    realtimeHookSource.includes("nextReconnectAt") &&
    realtimeHookSource.includes("retryAttempt") &&
    realtimeHookSource.includes("lastError") &&
    realtimeHookSource.includes("realtimeReconnectDelay") &&
    mobileChatPageSource.includes("mobile.realtimeNextRetry") &&
    translationsSource.includes("mobile.realtimeNextRetry") &&
    clientRoutingTestSource.includes("mobile realtime reconnect delay uses capped exponential backoff") &&
    realtimeHookSource.includes('window.addEventListener("online", handleOnline)') &&
    realtimeHookSource.includes('document.addEventListener("visibilitychange", handleVisibilityChange)') &&
    clientRoutingTestSource.includes("/lifeos/mobile/chat") &&
    clientRoutingTestSource.includes("wss://remote.example.test/lifeos/api/v1/ws") &&
    publicBaseUrlSource.includes("getConfiguredPublicBasePath") &&
    publicBaseUrlSource.includes("stripConfiguredPublicBasePath") &&
    serverEntrySource.includes("getConfiguredPublicBasePath") &&
    serverEntrySource.includes("req.url = req.url.slice(basePath.length)") &&
    realtimeServerSource.includes("stripConfiguredPublicBasePath(url.pathname)") &&
    apiAuthTestSourceForRouting.includes("public base path serves API, mobile shell, and realtime websocket") &&
    apiAuthTestSourceForRouting.includes("/lifeos/api/v1/health") &&
    apiAuthTestSourceForRouting.includes("/lifeos/api/v1/ws") &&
    packageJson.scripts.test.includes("tests/client-routing.test.mjs") &&
    desktopRuntimeConfigSmokeTestSource.includes("loads saved connection config before starting local core") &&
    desktopRuntimeConfigSmokeTestSource.includes("autostarts saved Tailscale HTTPS Serve config") &&
    devicePairSource.includes("networkDiagnostics.recommendedBaseUrl") &&
    devicePairSource.includes('candidate.mode !== "local"') &&
    connectionGuideCombinedSource.includes('candidate.mode !== "local"') &&
    connectionGuideCombinedSource.includes("NoPhoneReachableNotice") &&
    connectionGuideCombinedSource.includes("ConnectionMobileEntryPanel") &&
    translationsSource.includes("connection.noPhoneReachableShort")
  ) pass("connection guide ranks usable URLs for pairing QR and tunnel setup");
  else warn("connection guide does not rank usable pairing URLs from diagnostics");
  if (
    devicePairSource.includes("connectionCandidates") &&
    devicePairSource.includes("testConnectionUrl") &&
    devicePairSource.includes("devicePair.testCurrent") &&
    devicePairSource.includes("connection.secureRecommended") &&
    devicePairSource.includes("connection.trustedNetworkOnly") &&
    devicePairSource.includes("connection.restartBadge") &&
    devicePairSource.includes("activeCandidate.envTemplate") &&
    devicePairSource.includes("activeCandidate.restartInstruction") &&
    devicePairSource.includes("copiedEnv") &&
    devicePairSource.includes("devicePair.copyEnv") &&
    devicePairSource.includes("devicePair.restartTitle") &&
    devicePairSource.includes("DevicePairConnectionTestResult") &&
    devicePairConnectionTestSource.includes("devicePair.testStep.health") &&
    devicePairConnectionTestSource.includes("devicePair.testStep.mobileShell") &&
    devicePairConnectionTestSource.includes("devicePair.testStep.websocket") &&
    devicePairConnectionTestSource.includes("devicePair.testHttpsWarning") &&
    devicePairConnectionTestSource.includes("devicePair.testFix.health") &&
    devicePairConnectionTestSource.includes("devicePair.testFix.mobileShell") &&
    devicePairConnectionTestSource.includes("devicePair.testFix.websocket") &&
    devicePairConnectionTestSource.includes("devicePair.testFix.https") &&
    devicePairConnectionTestSource.includes("devicePair.testFix.generic") &&
    devicePairConnectionTestSource.includes("repairHintKey") &&
    devicePairConnectionTestSource.includes("devicePair.repair.title") &&
    devicePairConnectionTestSource.includes("devicePair.repair.websocketUpgradeBlocked") &&
    devicePairConnectionTestSource.includes("devicePair.repair.localhostPhoneUnreachable") &&
    translationsSource.includes("devicePair.testCurrent") &&
    translationsSource.includes("connection.secureRecommended") &&
    translationsSource.includes("connection.trustedNetworkOnly") &&
    translationsSource.includes("devicePair.copyEnv") &&
    translationsSource.includes("devicePair.repair.desktopServiceUnreachable") &&
    translationsSource.includes("devicePair.repair.publicModeRisk")
  ) pass("device pairing QR page exposes recommended URL safety, reachability test, and repair guidance");
  else warn("device pairing QR page does not expose recommended URL safety, reachability test, or repair guidance");
  if (
    networkDiagnosticsSource.includes("cloudflared tunnel --url") &&
    networkDiagnosticsSource.includes("tailscale") &&
    networkDiagnosticsSource.includes("tailscale serve --bg https:443") &&
    networkDiagnosticsSource.includes("magicDnsEnabled") &&
    networkDiagnosticsSource.includes("loginCommand") &&
    networkDiagnosticsSource.includes("httpsServeReady") &&
    networkDiagnosticsSource.includes("parsed.username = \"\"") &&
    networkDiagnosticsSource.includes("new URL(`${basePath}/api/v1/health`, parsed.origin)") &&
    networkDiagnosticsSource.includes("new URL(`${basePath}/mobile/chat`, parsed.origin)") &&
    networkDiagnosticsSource.includes("probeWebSocketStep") &&
    networkDiagnosticsSource.includes("buildConnectionRepairHints") &&
    networkDiagnosticsSource.includes("websocket-upgrade-blocked") &&
    networkDiagnosticsSource.includes("localhost-phone-unreachable") &&
    networkDiagnosticsSource.includes("publicAccessWarning = Boolean") &&
    networkDiagnosticsTestSource.includes("network diagnostics detects mocked Cloudflare and Tailscale CLIs") &&
    networkDiagnosticsTestSource.includes("tailscale-serve-https") &&
    networkDiagnosticsTestSource.includes("remoteReadiness.status") &&
    networkDiagnosticsTestSource.includes("needsPublicOptIn") &&
    networkDiagnosticsTestSource.includes("Tailscale HTTPS Serve helpers run controlled start and stop commands") &&
    networkDiagnosticsTestSource.includes("configured Tailscale HTTPS Serve autostart refreshes the saved stable URL") &&
    networkDiagnosticsTestSource.includes("configured Tailscale HTTPS Serve autostart uses the runtime port instead of the environment default") &&
    networkDiagnosticsTestSource.includes("Tailscale HTTP fallback is not accepted as a long-term remote entry") &&
    cloudflareTunnelActionsSource.includes("const canStart = cloudflare.installed") &&
    cloudflareTunnelActionsSource.includes('disabled={!canStart || tunnelBusy === "start"}') &&
    cloudflareTunnelActionsSource.includes("connection.cloudflareInstallRequired") &&
    cloudflareTunnelActionsSource.includes("cloudflare.installCommand") &&
    translationsSource.includes("connection.cloudflareInstallRequired") &&
    cloudflareTunnelSource.includes("cloudflared-named-tunnel.json") &&
    cloudflareTunnelSource.includes("loadNamedTunnelSettings") &&
    cloudflareTunnelSource.includes("saveNamedTunnelSettings") &&
    cloudflareTunnelSource.includes("settingsSaved") &&
    cloudflareTunnelSource.includes("credentialsFileExists") &&
    cloudflareTunnelSource.includes("refreshCloudflareNamedTunnelConfigForPort") &&
    cloudflareTunnelSource.includes("startConfiguredCloudflareNamedTunnel(timeoutMs = 15000, port =") &&
    cloudflareTunnelSource.includes("startConfiguredCloudflareNamedTunnel(15000, currentRuntimePort())") &&
    cloudflareTunnelSource.includes("cloudflare_named_config_refreshed") &&
    cloudflareTunnelSource.includes("scheduleNamedTunnelReconnect") &&
    cloudflareTunnelSource.includes("temporary_quick_tunnel_not_restored") &&
    cloudflareTunnelSource.includes("cloudflare_named_tunnel_not_ready") &&
    cloudflareTunnelSource.includes("reconnectAttempts") &&
    cloudflareTunnelSource.includes("reconnectScheduledAt") &&
    cloudflareTunnelSource.includes("setCloudflareTunnelReconnectHandler") &&
    cloudflareTunnelSource.includes("notifyReconnect") &&
    cloudflareTunnelTestSource.includes("settingsSaved") &&
    cloudflareTunnelTestSource.includes("credentialsFileExists, false") &&
    cloudflareTunnelTestSource.includes("configured quick Cloudflare Tunnel is not treated as restart-stable") &&
    cloudflareTunnelTestSource.includes("cloudflare_named_tunnel_not_ready") &&
    cloudflareTunnelTestSource.includes("cloudflare_named_config_refreshed") &&
    cloudflareTunnelTestSource.includes("Cloudflare Named Tunnel config refreshes when desktop restart chooses a new local port") &&
    cloudflareTunnelTestSource.includes("startConfiguredCloudflareNamedTunnel(1000, \"6789\")") &&
    cloudflareTunnelTestSource.includes("5678") &&
    cloudflareTunnelTestSource.includes("6789") &&
    cloudflareTunnelTestSource.includes("https://lifeos.example.com") &&
    cloudflareTunnelTestSource.includes("reconnects automatically after an unexpected disconnect") &&
    cloudflareTunnelTestSource.includes("7890") &&
    cloudflareTunnelTestSource.includes("setCloudflareTunnelReconnectHandler") &&
    packageJson.scripts.test.includes("tests/cloudflare-tunnel.test.mjs") &&
    cloudflareTunnelTestSource.includes("delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME") &&
    adminRoutesSource.includes("refreshCloudflareNamedTunnelConfigForPort(port)") &&
    adminRoutesSource.includes("configRefreshReason") &&
    lifeosApiSourceForRouting.includes("refresh: { refreshed: boolean; ready: boolean; reason: string }") &&
    networkDiagnosticsTestSource.includes("connection URL tests strip credentials, query secrets, and fragments") &&
    networkDiagnosticsTestSource.includes("connection URL tests health, mobile shell, and websocket under a remote base path") &&
    networkDiagnosticsTestSource.includes("connection URL returns structured repair hints for blocked websocket and unsafe phone entry")
  ) pass("connection diagnostics have Cloudflare/Tailscale mock coverage, Named Tunnel reconnect, sanitize test URLs, and repair hints");
  else warn("connection diagnostics lack Cloudflare/Tailscale mock coverage, Named Tunnel reconnect, URL sanitization checks, or repair hints");

  const pairingIntentSource = exists("src/services/mobilePairingIntent.ts") ? fs.readFileSync(path.join(rootDir, "src/services/mobilePairingIntent.ts"), "utf8") : "";
  const mobilePairingIntentTestSource = exists("tests/mobile-pairing-intent.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/mobile-pairing-intent.test.mjs"), "utf8") : "";
  const mobileChatSource = exists("src/pages/mobile/MobileChatPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileChatPage.tsx"), "utf8") : "";
  if (
    pairingIntentSource.includes("savePendingPairingToken") &&
    pairingIntentSource.includes("consumePendingPairingToken") &&
    pairingIntentSource.includes("peekPendingPairingToken") &&
    pairingIntentSource.includes("24 * 60 * 60 * 1000") &&
    mobileChatSource.includes("consumePendingPairingToken") &&
    mobileChatSource.includes("recoveringPairingIntent")
  ) pass("PWA preserves pending pairing token across iOS add-to-home-screen");
  else warn("PWA does not preserve pending pairing token across add-to-home-screen");
  if (
    pairingIntentSource.includes("safeDecodeURIComponent") &&
    pairingIntentSource.includes("bind_[A-Za-z0-9_-]{8,180}") &&
    mobilePairingIntentTestSource.includes("mobile pairing intent rejects malformed or unsafe install tokens") &&
    mobilePairingIntentTestSource.includes("bind_<script>alert(1)</script>") &&
    mobilePairingIntentTestSource.includes("/mobile/install/%E0%A4%A")
  ) pass("PWA pairing intent rejects malformed and unsafe tokens");
  else warn("PWA pairing intent malformed-token hardening lacks source or test coverage");
  const coreRoutesSource = exists("server/routes/coreRoutes.ts") ? fs.readFileSync(path.join(rootDir, "server/routes/coreRoutes.ts"), "utf8") : "";
  const adminDashboardSource = exists("src/pages/admin/AdminDashboardPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/AdminDashboardPage.tsx"), "utf8") : "";
  const adminPasswordPanelSource = exists("src/pages/admin/settings/AdminPasswordPanel.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/AdminPasswordPanel.tsx"), "utf8") : "";
  const securityDiagnosticsSource = exists("server/securityDiagnostics.ts") ? fs.readFileSync(path.join(rootDir, "server/securityDiagnostics.ts"), "utf8") : "";
  const publicModeTestSource = exists("tests/public-mode.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/public-mode.test.mjs"), "utf8") : "";
  if (
    coreRoutesSource.includes("publicRiskItems") &&
    coreRoutesSource.includes("publicRisk") &&
    coreRoutesSource.includes("securityDiagnostics.overall !== \"ok\"") &&
    coreRoutesSource.includes("desktopRuntimeConfig?.publicBaseUrl") &&
    coreRoutesSource.includes("remoteEntryMode") &&
    securityDiagnosticsSource.includes('id: "backupSchedule"') &&
    securityDiagnosticsSource.includes("getBackupSchedule") &&
    securityDiagnosticsSource.includes("inspectConfiguredPublicBaseUrlInput") &&
    securityDiagnosticsSource.includes('id: "publicBaseUrlInput"') &&
    securityDiagnosticsSource.includes('id: "trustedProxy"') &&
    securityDiagnosticsSource.includes('id: "sessionCookies"') &&
    securityDiagnosticsSource.includes("LIFEOS_COOKIE_SECURE") &&
    securityDiagnosticsSource.includes("secureSessionCookies") &&
    securityDiagnosticsSource.includes("LIFEOS_TRUST_PROXY") &&
    securityDiagnosticsSource.includes("usesLikelyTrustedPublicProxy") &&
    securityDiagnosticsSource.includes("hasLongRepeatedRun") &&
    securityDiagnosticsSource.includes("hasSequentialRun") &&
    securityDiagnosticsSource.includes("noLongRepeats") &&
    securityDiagnosticsSource.includes("noSequentialPattern") &&
    adminDashboardSource.includes("dashboard.publicRiskTitle") &&
    adminDashboardSource.includes("health.publicRisk.items.map") &&
    adminDashboardSource.includes("dashboard.createBackupNow") &&
    adminDashboardSource.includes("dashboard.enableAutoBackup") &&
    adminDashboardSource.includes("/admin/settings#backup-schedule") &&
    adminPasswordPanelSource.includes("newPassword.length >= 12") &&
    adminPasswordPanelSource.includes("newPassword.length < 12") &&
    translationsSource.includes("dashboard.publicRiskTitle") &&
    translationsSource.includes("至少需要 12 位") &&
    !translationsSource.includes("新密码至少需要 8 位") &&
    publicModeTestSource.includes("backupSchedule") &&
    publicModeTestSource.includes("health exposes saved desktop remote entry mode for mobile recovery") &&
    publicModeTestSource.includes("public mode security diagnostics flag unsafe raw PUBLIC_BASE_URL input") &&
    publicModeTestSource.includes("public mode diagnostics accept trusted proxy headers when explicitly enabled") &&
    publicModeTestSource.includes('item.id === "trustedProxy"') &&
    publicModeTestSource.includes('item.id === "sessionCookies"') &&
    publicModeTestSource.includes("public-secret") &&
    publicModeTestSource.includes("aaaaaaaaaaaa1!") &&
    publicModeTestSource.includes("abcdef123456!") &&
    publicModeTestSource.includes('health.remoteEntryMode, "cloudflare"') &&
    publicModeTestSource.includes("configuredHealth.publicSetupRisk, true") &&
    publicModeTestSource.includes("improvedHealth.publicRisk.items")
  ) pass("public mode health and dashboard expose actionable security risk items");
  else warn("public mode health or dashboard lacks actionable security risk items");
  const mobilePairSource = exists("src/pages/mobile/MobilePairPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobilePairPage.tsx"), "utf8") : "";
  const serverSource = exists("server.ts") ? fs.readFileSync(path.join(rootDir, "server.ts"), "utf8") : "";
  const serverMobileInstallSource = exists("server/mobileInstall.ts") ? fs.readFileSync(path.join(rootDir, "server/mobileInstall.ts"), "utf8") : "";
  const serverMobileInstallTestSource = exists("tests/server-mobile-install.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/server-mobile-install.test.mjs"), "utf8") : "";
  if (
    coreRoutesSource.includes('app.get("/manifest.webmanifest"') &&
    coreRoutesSource.includes("pairingToken") &&
    coreRoutesSource.includes("mobileManifest") &&
    coreRoutesSource.includes("no-store") &&
    pairingIntentSource.includes("setPairingManifestToken") &&
    pairingIntentSource.includes("pairingInstallPath") &&
    pairingIntentSource.includes("/mobile/install/") &&
    mobilePairSource.includes("setPairingManifestToken") &&
    mobilePairSource.includes("consumePendingPairingToken") &&
    mobilePairSource.includes("history.replaceState") &&
    mobilePairSource.includes("testMobileRemoteConnectivity") &&
    mobilePairSource.includes("reportMobileConnectivity") &&
    mobilePairSource.includes("MobileConnectivityCard") &&
    mobilePairSource.includes("mobilePair.connectivityTest") &&
    mobileChatSource.includes("launchPairingToken") &&
    mobileChatSource.includes("setPairingManifestToken") &&
    mobileChatSource.includes("getMobilePairingIntent") &&
    mobileChatSource.includes("pairingInstallPath(token)") &&
    serverSource.includes("htmlWithInstallPairingManifest") &&
    serverMobileInstallSource.includes("lifeos_pairing_intent") &&
    serverMobileInstallSource.includes("MANIFEST_LINK_PATTERN") &&
    serverMobileInstallSource.includes("pairingInstallPath(pairingToken)") &&
    serverMobileInstallSource.includes("mobileManifest") &&
    serverMobileInstallTestSource.includes("server mobile manifest preserves pairing token") &&
    serverMobileInstallTestSource.includes("server install html injects dynamic manifest href") &&
    serverMobileInstallSource.includes("safeDecodeURIComponent") &&
    serverMobileInstallTestSource.includes("server mobile install helpers ignore malformed or unsafe pairing tokens") &&
    serverMobileInstallTestSource.includes("/mobile/install/%E0%A4%A") &&
    coreRoutesSource.includes("/api/v1/mobile/pairing-intent") &&
    serverMobileInstallSource.includes('req.path === "/mobile/pair"') &&
    serverMobileInstallSource.includes("req.query.pairingToken") &&
    serverSource.includes("/mobile/install/:installToken") &&
    serverSource.includes("setInstallPairingIntentCookie")
  ) pass("PWA install path carries pairing token through iOS add-to-home-screen");
  else warn("PWA install path does not carry pairing token through iOS add-to-home-screen");

  if (
    serverMobileInstallSource.includes("safeDecodeURIComponent") &&
    serverMobileInstallTestSource.includes("server mobile install helpers ignore malformed or unsafe pairing tokens") &&
    serverMobileInstallTestSource.includes("/mobile/install/%E0%A4%A") &&
    serverMobileInstallTestSource.includes("bind_<script>alert(1)</script>")
  ) pass("PWA install path rejects malformed and unsafe pairing tokens");
  else warn("PWA install path malformed-token hardening lacks source or test coverage");

  const mobileDeviceSource = exists("src/pages/mobile/MobileDevicePage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileDevicePage.tsx"), "utf8") : "";
  const mobileDeviceStatusCardsSource = exists("src/pages/mobile/MobileDeviceStatusCards.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileDeviceStatusCards.tsx"), "utf8") : "";
  if (
    mobileDeviceStatusCardsSource.includes("mobileDevice.pastePairingLink") &&
    mobileDeviceSource.includes("mobileDevice.rebindButton") &&
    mobileDeviceSource.includes("pairingInstallPath") &&
    !mobileDeviceSource.includes('href="/mobile/pair"') &&
    !mobileDeviceSource.includes("window.location.href = `/mobile/pair?token=")
  ) pass("mobile device page supports token paste rebinding without naked pair links");
  else warn("mobile device page rebinding flow can still open a tokenless pair page");
  const lifeosApiSource = exists("src/services/lifeosApi.ts") ? fs.readFileSync(path.join(rootDir, "src/services/lifeosApi.ts"), "utf8") : "";
  const apiAuthTestSource = exists("tests/api-auth.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/api-auth.test.mjs"), "utf8") : "";
  if (
    deviceRoutesSource.includes("pairingInstallUrl") &&
    deviceRoutesSource.includes("/mobile/install/") &&
    deviceRoutesSource.includes("pairingUrl: pairingInstallUrl(baseUrl, token)") &&
    apiAuthTestSource.includes("/mobile/install/")
  ) pass("device binding QR uses install path so iOS home-screen keeps the pairing token");
  else warn("device binding QR may still use a query token that iOS can drop during home-screen install");
  if (
    deviceRoutesSource.includes('app.delete("/api/v1/devices/me"') &&
    deviceRoutesSource.includes("device_self_revoked") &&
    deviceRoutesSource.includes("latestConnectivity") &&
    deviceRoutesSource.includes("connectivityAuditSummary") &&
    lifeosApiSource.includes("revokeCurrentDeviceBinding") &&
    mobileDeviceSource.includes("mobileDevice.forgetBinding") &&
    apiAuthTestSource.includes("Self Revoke Phone") &&
    apiAuthTestSource.includes("device_self_revoked") &&
    apiAuthTestSource.includes("revokedAudit.metadata.latestConnectivity")
  ) pass("mobile device page can revoke its own server-side binding with audit coverage");
  else warn("mobile device self-revoke flow is incomplete across API, UI, or tests");
  const deviceCredentialStoreSource = exists("src/services/deviceCredentialStore.ts") ? fs.readFileSync(path.join(rootDir, "src/services/deviceCredentialStore.ts"), "utf8") : "";
  if (
    deviceCredentialStoreSource.includes("getDeviceCredentialStorageStatus") &&
    deviceCredentialStoreSource.includes("LEGACY_LOCAL_STORAGE_KEY") &&
    deviceCredentialStoreSource.includes("localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)") &&
    !deviceCredentialStoreSource.includes("localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY") &&
    mobileDeviceStatusCardsSource.includes("mobileDevice.storageTitle") &&
    mobileDeviceStatusCardsSource.includes("mobileDevice.legacyCredential") &&
    translationsSource.includes("mobileDevice.storageTitle") &&
    translationsSource.includes("mobileDevice.legacyCredential")
  ) pass("mobile device credentials migrate away from localStorage and expose storage status");
  else warn("mobile device credential storage can regress to localStorage or lacks storage status UI");

  const sensitiveLocalStorageSource = exists("src/services/sensitiveLocalStorage.ts") ? fs.readFileSync(path.join(rootDir, "src/services/sensitiveLocalStorage.ts"), "utf8") : "";
  const sensitiveLocalStorageTestSource = exists("tests/sensitive-local-storage.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/sensitive-local-storage.test.mjs"), "utf8") : "";
  const syncedClientStateSource = exists("src/hooks/useSyncedClientState.ts") ? fs.readFileSync(path.join(rootDir, "src/hooks/useSyncedClientState.ts"), "utf8") : "";
  const studioConnectionSource = exists("src/components/apps/studio/useStudioConnectionSettings.ts") ? fs.readFileSync(path.join(rootDir, "src/components/apps/studio/useStudioConnectionSettings.ts"), "utf8") : "";
  const sensitiveMainSource = exists("src/main.tsx") ? fs.readFileSync(path.join(rootDir, "src/main.tsx"), "utf8") : "";
  const appSource = exists("src/App.tsx") ? fs.readFileSync(path.join(rootDir, "src/App.tsx"), "utf8") : "";
  const chatPersistenceSource = exists("src/hooks/useChatPersistence.ts") ? fs.readFileSync(path.join(rootDir, "src/hooks/useChatPersistence.ts"), "utf8") : "";
  const chatSessionStorageSource = exists("src/services/chatSessionStorage.ts") ? fs.readFileSync(path.join(rootDir, "src/services/chatSessionStorage.ts"), "utf8") : "";
  const chatSessionStorageTestSource = exists("tests/chat-session-storage.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/chat-session-storage.test.mjs"), "utf8") : "";
  const chatMessageStorageSource = exists("src/services/chatMessageStorage.ts") ? fs.readFileSync(path.join(rootDir, "src/services/chatMessageStorage.ts"), "utf8") : "";
  const chatMessageStorageTestSource = exists("tests/chat-message-storage.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/chat-message-storage.test.mjs"), "utf8") : "";
  if (
    sensitiveLocalStorageSource.includes("lifeos_byok_key") &&
    sensitiveLocalStorageSource.includes("lifeos_proxy_url") &&
    sensitiveLocalStorageSource.includes("lifeos_pending_pairing_intent") &&
    sensitiveLocalStorageSource.includes("lifeos_device_credential") &&
    sensitiveLocalStorageSource.includes("failedKeys") &&
    sensitiveLocalStorageSource.includes("Some browser modes expose localStorage") &&
    sensitiveLocalStorageTestSource.includes("without breaking pairing or credential migration") &&
    sensitiveLocalStorageTestSource.includes("reports failed removals without crashing startup") &&
    sensitiveLocalStorageTestSource.includes("blocked key enumeration") &&
    syncedClientStateSource.includes("isSensitiveLocalStorageKey") &&
    syncedClientStateSource.includes("localStorage.removeItem(key)") &&
    syncedClientStateSource.includes("export function readLocalState") &&
    syncedClientStateSource.includes("export function writeLocalState") &&
    syncedClientStateSource.includes('typeof localStorage === "undefined"') &&
    syncedClientStateSource.includes("Local cache is best-effort") &&
    studioConnectionSource.includes("summarizeProxySubscriptionUrl") &&
    !studioConnectionSource.includes('useSyncedClientState("lifeos_proxy_url"') &&
    sensitiveMainSource.includes("clearSensitiveLocalStorageResidue") &&
    packageJson.scripts.test.includes("tests/synced-client-state.test.mjs")
  ) pass("frontend clears sensitive localStorage residue without breaking pairing or credential migration");
  else warn("frontend may keep sensitive localStorage residue or lacks regression coverage");
  if (
    appSource.includes("loadStoredChatMessages") &&
    appSource.includes("persistStoredChatMessages") &&
    !appSource.includes('localStorage.getItem("lifeos_messages"') &&
    !appSource.includes('localStorage.setItem("lifeos_messages"') &&
    chatMessageStorageSource.includes("parseStoredChatMessages") &&
    chatMessageStorageSource.includes("try {") &&
    chatMessageStorageSource.includes("defaultChatMessages") &&
    chatMessageStorageTestSource.includes("local cache is missing or corrupted") &&
    chatMessageStorageTestSource.includes("browser storage read and write failures") &&
    packageJson.scripts.test.includes("tests/chat-message-storage.test.mjs")
  ) pass("chat message local cache is parsed safely and covered by tests");
  else warn("chat message local cache can still crash the app or lacks regression coverage");
  if (
    chatPersistenceSource.includes("loadActiveChatSessionId") &&
    chatPersistenceSource.includes("saveActiveChatSessionId") &&
    !chatPersistenceSource.includes('localStorage.getItem("lifeos_active_chat_session_id"') &&
    !chatPersistenceSource.includes('localStorage.setItem("lifeos_active_chat_session_id"') &&
    lifeosApiSource.includes("clearActiveChatSessionId") &&
    !lifeosApiSource.includes('localStorage.removeItem("lifeos_active_chat_session_id"') &&
    chatSessionStorageSource.includes("ACTIVE_CHAT_SESSION_STORAGE_KEY") &&
    chatSessionStorageSource.includes("try {") &&
    chatSessionStorageSource.includes("catch") &&
    chatSessionStorageTestSource.includes("unavailable browser storage") &&
    packageJson.scripts.test.includes("tests/chat-session-storage.test.mjs")
  ) pass("active chat session cache is best-effort and covered by tests");
  else warn("active chat session cache can still crash when browser storage is unavailable");

  const offlineQueueSource = exists("src/services/offlineMessageQueue.ts") ? fs.readFileSync(path.join(rootDir, "src/services/offlineMessageQueue.ts"), "utf8") : "";
  const offlineQueueBannerSource = exists("src/components/chat/OfflineQueueBanner.tsx") ? fs.readFileSync(path.join(rootDir, "src/components/chat/OfflineQueueBanner.tsx"), "utf8") : "";
  const mobileOfflineQueueCardsSource = exists("src/pages/mobile/MobileOfflineQueueCards.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileOfflineQueueCards.tsx"), "utf8") : "";
  const mobileOfflineQueuePanelSource = exists("src/pages/mobile/MobileOfflineQueuePanel.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileOfflineQueuePanel.tsx"), "utf8") : "";
  const offlineQueueSyncHookSource = exists("src/hooks/useOfflineQueueSync.ts") ? fs.readFileSync(path.join(rootDir, "src/hooks/useOfflineQueueSync.ts"), "utf8") : "";
  const offlineQueueTestSource = exists("tests/offline-queue.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/offline-queue.test.mjs"), "utf8") : "";
  const pwaCapabilitiesSource = exists("src/services/pwaCapabilities.ts") ? fs.readFileSync(path.join(rootDir, "src/services/pwaCapabilities.ts"), "utf8") : "";
  const pwaCapabilitiesTestSource = exists("tests/pwa-capabilities.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/pwa-capabilities.test.mjs"), "utf8") : "";
  const mobileConnectivityCardSource = exists("src/pages/mobile/MobileConnectivityCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileConnectivityCard.tsx"), "utf8") : "";
  const deviceConnectivityStatusSource = exists("src/pages/admin/DeviceConnectivityStatus.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/DeviceConnectivityStatus.tsx"), "utf8") : "";
  const frontendSmokeTestSource = exists("tests/frontend-smoke.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/frontend-smoke.test.mjs"), "utf8") : "";
  const dbSourceForConnectivity = exists("server/db.ts") ? fs.readFileSync(path.join(rootDir, "server/db.ts"), "utf8") : "";
  if (
    pwaCapabilitiesSource.includes("getPwaCapabilityStatus") &&
    pwaCapabilitiesSource.includes("getRemoteEntryStatus") &&
    pwaCapabilitiesSource.includes("getRemoteEntryGuidance") &&
    pwaCapabilitiesSource.includes("getMobileRecoveryHints") &&
    pwaCapabilitiesSource.includes("getMobileConnectivityIssue") &&
    pwaCapabilitiesSource.includes("testMobileRemoteConnectivity") &&
    pwaCapabilitiesSource.includes("/api/v1/health") &&
    pwaCapabilitiesSource.includes("/mobile/chat") &&
    pwaCapabilitiesSource.includes("mobile-shell") &&
    pwaCapabilitiesSource.includes("/api/v1/ws") &&
    pwaCapabilitiesSource.includes("temporary-cloudflare") &&
    pwaCapabilitiesSource.includes("cloudflare-named") &&
    pwaCapabilitiesSource.includes("configuredMode") &&
    pwaCapabilitiesSource.includes("configured-mismatch") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceHealth") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceCloudflareNamed") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceTailscaleHttp") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceOfflineQueue") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceFailedQueue") &&
    pwaCapabilitiesSource.includes("connectivityIssueTemporaryExpired") &&
    pwaCapabilitiesSource.includes("connectivityIssueTailscaleOffline") &&
    pwaCapabilitiesSource.includes("connectivityIssueCloudflareNamedOffline") &&
    pwaCapabilitiesSource.includes("connectivityIssueWebSocket") &&
    pwaCapabilitiesSource.includes("serviceWorkerControlled") &&
    pwaCapabilitiesSource.includes("backgroundSyncSupported") &&
    pwaCapabilitiesSource.includes("indexedDbSupported") &&
    mobileDeviceSource.includes("mobileDevice.pwaTitle") &&
    mobileDeviceSource.includes("mobileDevice.remoteVerdict") &&
    mobileDeviceSource.includes("health?.remoteEntryMode") &&
    lifeosApiSourceForRouting.includes("remoteEntryMode") &&
    mobileDeviceSource.includes("currentEntryGuidance") &&
    mobileDeviceSource.includes("mobileDevice.entryGuidanceTitle") &&
    mobileDeviceSource.includes("mobileDevice.connectivityTest") &&
    mobileDeviceSource.includes("testMobileRemoteConnectivity") &&
    mobileDeviceSource.includes("reportMobileConnectivity") &&
    mobileDeviceSource.includes("connectivityReportStale") &&
    mobileDeviceSource.includes("mobileDevice.staleConnectivityReport") &&
    mobileDeviceSource.includes("onRetry={handleConnectivityTest}") &&
    mobileDeviceSource.includes("queueSummary={queueSummary}") &&
    mobileConnectivityCardSource.includes("getMobileRecoveryHints") &&
    mobileConnectivityCardSource.includes("getMobileConnectivityIssue") &&
    mobileConnectivityCardSource.includes("primaryIssue") &&
    mobileConnectivityCardSource.includes("queueBlocked") &&
    mobileConnectivityCardSource.includes("showRecovery") &&
    mobileConnectivityCardSource.includes("isHttpRemoteBase") &&
    mobileConnectivityCardSource.includes("queueSummary") &&
    mobileConnectivityCardSource.includes("tailscale://") &&
    mobileConnectivityCardSource.includes("mobileDevice.openTailscale") &&
    mobileConnectivityCardSource.includes("mobileDevice.rebindRemoteEntry") &&
    mobileConnectivityCardSource.includes("mobileDevice.retryRealtime") &&
    mobileConnectivityCardSource.includes("mobileDevice.connectivityTestedAt") &&
    mobileConnectivityCardSource.includes("copyRepairPacket") &&
    mobileConnectivityCardSource.includes("navigator.clipboard.writeText") &&
    mobileConnectivityCardSource.includes("mobileDevice.copyRepairPacket") &&
    mobileConnectivityCardSource.includes("mobileDevice.repairPacketCopied") &&
    mobileConnectivityCardSource.includes("mobileDevice.connectivitySteps") &&
    translationsSource.includes("mobileDevice.connectivityTestedAt") &&
    translationsSource.includes("mobileDevice.copyRepairPacket") &&
    translationsSource.includes("mobileDevice.repairPacketCopied") &&
    translationsSource.includes("mobileDevice.connectivitySteps") &&
    mobileDeviceSource.includes("pwaCapabilities.recommendations") &&
    mobileDeviceSource.includes("pwaRecommendationKey") &&
    mobileDeviceSource.includes("mobileDevice.pwaRecommendation.addToHome") &&
    mobileDeviceSource.includes("mobileDevice.pwaRecommendation.indexedDbUnavailable") &&
    adminDashboardSource.includes("connectivityReport") &&
    adminDashboardSource.includes("DeviceConnectivityStatus") &&
    deviceConnectivityStatusSource.includes("mobileShellOk") &&
    deviceConnectivityStatusSource.includes("dashboard.mobileConnectivityChecks") &&
    deviceConnectivityStatusSource.includes("dashboard.mobileConnectivityOk") &&
    deviceRoutesSource.includes("/api/v1/devices/me/connectivity-report") &&
    deviceRoutesSource.includes("insertDeviceConnectivityReport") &&
    deviceRoutesSource.includes('step?.id === "mobile-shell"') &&
    deviceRoutesSource.includes("device_connectivity_reported") &&
    exists("server/migrations/004_device_connectivity_reports.sql") &&
    exists("server/migrations/006_device_connectivity_mobile_shell.sql") &&
    dbSourceForConnectivity.includes("device_connectivity_reports") &&
    dbSourceForConnectivity.includes("mobile_shell_ok") &&
    pwaCapabilitiesTestSource.includes("remote entry status detects configured public base mismatches") &&
    pwaCapabilitiesTestSource.includes("tailscaleMatch.kind, \"tailscale\"") &&
    pwaCapabilitiesTestSource.includes("temporaryMatch.kind, \"temporary-cloudflare\"") &&
    pwaCapabilitiesTestSource.includes("cloudflareNamed.kind, \"cloudflare-named\"") &&
    pwaCapabilitiesTestSource.includes("connectivityGuidanceCloudflareNamed") &&
    pwaCapabilitiesTestSource.includes("mobile remote connectivity probes health, mobile chat shell, and websocket") &&
    pwaCapabilitiesTestSource.includes("mobile remote connectivity reports websocket failures") &&
    pwaCapabilitiesTestSource.includes("mobile recovery hints combine entry type") &&
    pwaCapabilitiesTestSource.includes("connectivityIssueTemporaryExpired") &&
    pwaCapabilitiesTestSource.includes("connectivityIssueTailscaleOffline") &&
    pwaCapabilitiesTestSource.includes("connectivityIssueCloudflareNamedOffline") &&
    pwaCapabilitiesTestSource.includes("connectivityIssueWebSocket") &&
    pwaCapabilitiesTestSource.includes("connectivityIssueQueueBlocked") &&
    pwaCapabilitiesTestSource.includes("connectedButQueueFailed") &&
    pwaCapabilitiesTestSource.includes("remote entry guidance is visible before manual connectivity tests") &&
    pwaCapabilitiesTestSource.includes("stored mobile connectivity reports restore actionable recovery diagnostics") &&
    pwaCapabilitiesTestSource.includes("degraded offline sync support") &&
    frontendSmokeTestSource.includes("mobileDevice\\.pwaTitle") &&
    frontendSmokeTestSource.includes("getRemoteEntryGuidance") &&
    frontendSmokeTestSource.includes("mobileConnectivityResultFromReport") &&
    frontendSmokeTestSource.includes("lastConnectivityIssue") &&
    frontendSmokeTestSource.includes("connectivityReportStale") &&
    frontendSmokeTestSource.includes("queueSummary=\\{queueSummary\\}") &&
    frontendSmokeTestSource.includes("getMobileRecoveryHints") &&
    frontendSmokeTestSource.includes("getMobileConnectivityIssue") &&
    pwaCapabilitiesSource.includes("mobileConnectivityResultFromReport") &&
    pwaCapabilitiesSource.includes("StoredMobileConnectivityReport") &&
    translationsSource.includes("connectivityGuidanceHealth") &&
    translationsSource.includes("connectivityGuidanceCloudflareNamed") &&
    translationsSource.includes("connectivityGuidanceTailscaleHttp") &&
    translationsSource.includes("connectivityGuidanceOfflineQueue") &&
    translationsSource.includes("connectivityGuidanceFailedQueue") &&
    translationsSource.includes("connectivityIssueTemporaryExpired") &&
    translationsSource.includes("connectivityIssueTailscaleOffline") &&
    translationsSource.includes("connectivityIssueCloudflareNamedOffline") &&
    translationsSource.includes("connectivityIssueWebSocket") &&
    translationsSource.includes("connectivityMobileShell") &&
    translationsSource.includes("mobileDevice.pwaTitle") &&
    translationsSource.includes("mobileDevice.lastConnectivityFixTitle") &&
    translationsSource.includes("mobileDevice.staleConnectivityReport") &&
    translationsSource.includes("mobileDevice.pwaRecommendation.addToHome") &&
    translationsSource.includes("mobileDevice.pwaRecommendation.offlineQueue")
  ) pass("mobile device page surfaces PWA install, background sync, and remote recovery guidance");
  else warn("mobile device page lacks PWA install/background sync/remote recovery guidance or coverage");
  if (
    offlineQueueSource.includes("getOfflineMessageStatusLabel") &&
    offlineQueueSource.includes("getOfflineMessageRetryLabel") &&
    offlineQueueSource.includes("Ready to retry") &&
    offlineQueueBannerSource.includes("getOfflineMessageNextRetryAt") &&
    offlineQueueBannerSource.includes("offlineQueue.status.pending") &&
    offlineQueueBannerSource.includes("offlineQueue.status.syncing") &&
    offlineQueueBannerSource.includes("offlineQueue.status.failed") &&
    offlineQueueBannerSource.includes("offlineQueue.readyToRetry") &&
    offlineQueueBannerSource.includes("networkLabel") &&
    offlineQueueBannerSource.includes("network.labelKey") &&
    !/network\.label(?!Key)/.test(offlineQueueBannerSource) &&
    appSource.includes("clearConfirmMessage: (summary)") &&
    appSource.includes("mobileDevice.confirmClearQueueDetailed") &&
    appSource.includes("pending: summary.pending") &&
    appSource.includes("failed: summary.failed") &&
    offlineQueueSyncHookSource.includes("options.clearConfirmMessage") &&
    offlineQueueSyncHookSource.includes("getOfflineMessageQueueSummary()") &&
    !offlineQueueSyncHookSource.includes("Clear all unsynced offline messages") &&
    mobileDeviceSource.includes("getOfflineMessageQueueStorageStatus") &&
    mobileDeviceSource.includes("mobileDevice.confirmClearQueueDetailed") &&
    mobileDeviceSource.includes("MobileOfflineQueuePanel") &&
    mobileDeviceSource.includes("requestOfflineMessageQueuePersistentStorage") &&
    mobileDeviceSource.includes("persistentStorageGranted") &&
    mobileDeviceSource.includes('window.addEventListener("focus", refreshRecoverableState)') &&
    mobileDeviceSource.includes('document.addEventListener("visibilitychange", handleVisibilityChange)') &&
    mobileOfflineQueuePanelSource.includes("offlineQueue.remoteEntryTitle") &&
    mobileOfflineQueuePanelSource.includes("offlineQueue.waitingSinceTitle") &&
    mobileOfflineQueuePanelSource.includes("queueSummary.oldestQueuedAt") &&
    mobileOfflineQueuePanelSource.includes("showAllQueueItems") &&
    mobileOfflineQueuePanelSource.includes("offlineQueue.showAll") &&
    mobileOfflineQueuePanelSource.includes("currentEntryGuidance.map") &&
    mobileOfflineQueuePanelSource.includes("onRequestPersistentStorage") &&
    mobileOfflineQueuePanelSource.includes("network.labelKey") &&
    !/network\.label(?!Key)/.test(mobileOfflineQueuePanelSource) &&
    mobileOfflineQueueCardsSource.includes("getOfflineMessageNextRetryAt") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.status.pending") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.status.syncing") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.status.failed") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.readyToRetry") &&
    mobileOfflineQueueCardsSource.includes("getOfflineMessageQueueStorageLabel") &&
    mobileOfflineQueueCardsSource.includes("getOfflineMessageQueueUsageLabel") &&
    mobileOfflineQueueCardsSource.includes("storage.nearByteLimit") &&
    mobileOfflineQueueCardsSource.includes("storage.maxBytes") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.storageTitle") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.legacyMirror") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.persistentStorage") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.requestPersistentStorage") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.failureReason") &&
    mobileOfflineQueueCardsSource.includes("recommendationKey") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.recommendation.browserStorage") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.recommendation.persistentStorage") &&
    translationsSource.includes("offlineQueue.storageTitle") &&
    translationsSource.includes("offlineQueue.legacyMirror") &&
    translationsSource.includes("offlineQueue.persistentStorage") &&
    translationsSource.includes("offlineQueue.requestPersistentStorage") &&
    translationsSource.includes("offlineQueue.failureReason") &&
    translationsSource.includes("offlineQueue.remoteEntryTitle") &&
    translationsSource.includes("offlineQueue.waitingSinceTitle") &&
    translationsSource.includes("offlineQueue.waitingSinceBody") &&
    translationsSource.includes("offlineQueue.showAll") &&
    translationsSource.includes("offlineQueue.showRecentOnly") &&
    translationsSource.includes("offlineQueue.status.pending") &&
    translationsSource.includes("offlineQueue.readyToRetry") &&
    translationsSource.includes("offlineQueue.recommendation.browserStorage") &&
    translationsSource.includes("offlineQueue.recommendation.empty") &&
    translationsSource.includes("network.offline") &&
    translationsSource.includes("network.weak") &&
    offlineQueueTestSource.includes("getOfflineMessageStatusLabel") &&
    offlineQueueTestSource.includes("getOfflineMessageRetryLabel") &&
    offlineQueueTestSource.includes("formatOfflineMessageQueueBytes") &&
    offlineQueueTestSource.includes("getOfflineMessageQueueStorageLabel") &&
    offlineQueueTestSource.includes("getOfflineMessageQueueUsageLabel") &&
    offlineQueueTestSource.includes("getOfflineMessageQueueStorageStatus") &&
    offlineQueueTestSource.includes("summary.oldestQueuedAt") &&
    offlineQueueSource.includes("oldestQueuedAt") &&
    offlineQueueSource.includes("newestQueuedAt") &&
    offlineQueueTestSource.includes("can request persistent browser storage") &&
    offlineQueueSource.includes("requestOfflineMessageQueuePersistentStorage") &&
    offlineQueueSource.includes("storageManager.persist") &&
    offlineQueueSource.includes("clearSyncMeta") &&
    offlineQueueSource.includes("localStorage.removeItem(QUEUE_SYNC_META_KEY)") &&
    offlineQueueTestSource.includes("clears it with the queue") &&
    offlineQueueTestSource.includes('storage.has("lifeos_offline_message_queue_sync_meta"), false') &&
    offlineQueueTestSource.includes("migrates legacy localStorage into IndexedDB primary storage") &&
    offlineQueueTestSource.includes("compacts oversized messages and reports byte budget") &&
    offlineQueueTestSource.includes("trims oldest items when storage budget is exceeded") &&
    offlineQueueSource.includes("IndexedDB primary storage") &&
    offlineQueueSource.includes("hydrateOfflineMessageQueue") &&
    offlineQueueSource.includes("writeIndexedQueue") &&
    offlineQueueSource.includes("MAX_QUEUE_BYTES") &&
    offlineQueueSource.includes("MAX_QUEUE_ITEM_BYTES") &&
    offlineQueueSource.includes("trimQueueToBudget") &&
    offlineQueueSource.includes("msg_${(hash >>> 0).toString(36)}") &&
    offlineQueueSource.includes("Browser storage is near its limit")
  ) pass("offline queue UI uses localized status, retry timing, and storage budget protection");
  else warn("offline queue UI lacks localized item status, retry timing, storage budget protection, or tests");

  const systemActionsSource = exists("src/components/apps/SystemActionsApp.tsx") ? fs.readFileSync(path.join(rootDir, "src/components/apps/SystemActionsApp.tsx"), "utf8") : "";
  const systemActionsServiceSource = exists("src/services/systemActions.ts") ? fs.readFileSync(path.join(rootDir, "src/services/systemActions.ts"), "utf8") : "";
  const systemActionStorageSource = exists("src/services/systemActionStorage.ts") ? fs.readFileSync(path.join(rootDir, "src/services/systemActionStorage.ts"), "utf8") : "";
  const systemActionsTestSource = exists("tests/system-actions.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/system-actions.test.mjs"), "utf8") : "";
  if (
    systemActionsSource.includes("actions.permissionCenter") &&
    systemActionsSource.includes("actionLogSummary") &&
    systemActionsSource.includes("ActionMetric") &&
    systemActionsSource.includes("actions.clearLogs") &&
    systemActionsSource.includes("actions.latestRecord") &&
    systemActionsSource.includes("actions.logLineTwo") &&
    systemActionsSource.includes("actions.launcherRiskLine") &&
    systemActionsSource.includes("summarizeActionParams(action.url)") &&
    systemActionsSource.includes("riskLabel(latestActionLog.risk, t)") &&
    translationsSource.includes("actions.permissionCenter") &&
    translationsSource.includes("actions.clearLogs") &&
    translationsSource.includes("actions.launcherRiskLine") &&
    systemActionsSource.includes("loadAllowedUrlSchemes") &&
    systemActionsSource.includes("writeSystemActionStorage") &&
    !systemActionsSource.includes('localStorage.getItem("lifeos_allowed_url_schemes"') &&
    !systemActionsSource.includes('localStorage.setItem("lifeos_system_actions"') &&
    !systemActionsSource.includes('localStorage.setItem("lifeos_system_action_logs"') &&
    systemActionStorageSource.includes("loadSavedSystemActions") &&
    systemActionStorageSource.includes("loadSystemActionLogs") &&
    systemActionStorageSource.includes("normalizeSystemActionLog") &&
    systemActionsTestSource.includes("system action storage loads safe defaults") &&
    systemActionsTestSource.includes("system action storage normalizes whitelist") &&
    frontendSmokeTestSource.includes("actionLogSummary") &&
    frontendSmokeTestSource.includes("actions\\.launcherRiskLine") &&
    frontendSmokeTestSource.includes("actions\\.clearLogs")
  ) pass("mobile action permission center summarizes, clears, and audits local app launches");
  else warn("mobile action permission center lacks summary, clear action, launch audit details, or tests");
  if (
    systemActionsServiceSource.includes("BLOCKED_URL_SCHEMES") &&
    systemActionsServiceSource.includes("normalizeAllowedUrlSchemes") &&
    systemActionsServiceSource.includes("javascript") &&
    systemActionsServiceSource.includes("view-source") &&
    systemActionsServiceSource.includes("redactActionUrl") &&
    systemActionsServiceSource.includes("redactActionTarget") &&
    systemActionStorageSource.includes("redactActionTarget(log.target || log.url, log.scheme)") &&
    systemActionsSource.includes("../../services/systemActions") &&
    packageJson.scripts.test.includes("tests/system-actions.test.mjs") &&
    systemActionsTestSource.includes("../src/services/systemActions.ts") &&
    systemActionsTestSource.includes("system action scheme whitelist removes blocked and malformed schemes") &&
    systemActionsTestSource.includes("system action URL logs redact sensitive targets and query values") &&
    systemActionsTestSource.includes("system action helpers classify risk and summarize params") &&
    systemActionsTestSource.includes("system action shortcut URL builder encodes name and optional text") &&
    systemActionsTestSource.includes("javascript") &&
    systemActionsTestSource.includes("data") &&
    systemActionsTestSource.includes("file") &&
    systemActionsTestSource.includes("sms:[redacted]?body=[redacted]") &&
    systemActionsTestSource.includes("[redacted phone]") &&
    systemActionsTestSource.includes("[redacted email]") &&
    systemActionsTestSource.includes("shortcuts://run-shortcut?name=[redacted]&text=[redacted]")
  ) pass("mobile action URL scheme whitelist rejects blocked and malformed schemes");
  else warn("mobile action URL scheme whitelist lacks blocked-scheme hardening or tests");

  const dataLifecycleSource = exists("server/dataLifecycle.ts") ? fs.readFileSync(path.join(rootDir, "server/dataLifecycle.ts"), "utf8") : "";
  const dataExportRedactionTestSource = exists("tests/data-export-redaction.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/data-export-redaction.test.mjs"), "utf8") : "";
  if (
    dataLifecycleSource.includes("redactDataExportValue") &&
    dataLifecycleSource.includes("redactAuditMetadata") &&
    dataLifecycleSource.includes("api[-_]?key") &&
    dataLifecycleSource.includes("authorization") &&
    dataLifecycleSource.includes("auth[-_]?tag") &&
    dataLifecycleSource.includes("(^|[-_])iv([-_]|$)") &&
    dataLifecycleSource.includes("getDataExportVersion") &&
    dataLifecycleSource.includes('path.join(process.cwd(), "package.json")') &&
    !dataLifecycleSource.includes('version: "0.1.0"') &&
    dataExportRedactionTestSource.includes("should not leak in data export redaction") &&
    dataExportRedactionTestSource.includes("Basic Z2l0aHViOnNlY3JldA==") &&
    dataExportRedactionTestSource.includes("github_pat_exportSecret") &&
    dataExportRedactionTestSource.includes("C:\\\\Users\\\\example") &&
    apiAuthTestSource.includes("dataExport.version, packageJson.version") &&
    apiAuthTestSource.includes("scopedDataExport.version, packageJson.version") &&
    String(packageJson.scripts?.test || "").includes("tests/data-export-redaction.test.mjs")
  ) pass("data export redaction covers AI keys, tokens, auth headers, crypto fields, URLs, and local paths");
  else warn("data export redaction does not cover the full sensitive field set");
  const diagnosticBundleSource = exists("server/diagnosticBundle.ts") ? fs.readFileSync(path.join(rootDir, "server/diagnosticBundle.ts"), "utf8") : "";
  const diagnosticBundleTestSource = exists("tests/diagnostic-bundle-redaction.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/diagnostic-bundle-redaction.test.mjs"), "utf8") : "";
  if (
    diagnosticBundleSource.includes("getReleaseDiagnostics") &&
    diagnosticBundleSource.includes("getDiagnosticBundleVersion") &&
    diagnosticBundleSource.includes('path.join(process.cwd(), "package.json")') &&
    !diagnosticBundleSource.includes('version: "0.1.0"') &&
    diagnosticBundleSource.includes("publicReleaseArtifactSummary") &&
    diagnosticBundleSource.includes("release: getReleaseDiagnostics()") &&
    diagnosticBundleSource.includes("remote: {") &&
    diagnosticBundleSource.includes("recoveryReport") &&
    diagnosticBundleSource.includes("acceptanceChecklist") &&
    diagnosticBundleSource.includes("acceptanceSummary") &&
    diagnosticBundleSource.includes("summarizeRemoteAcceptanceChecklist") &&
    diagnosticBundleSource.includes("acceptanceRecords") &&
    diagnosticBundleSource.includes("acceptanceRunbooks") &&
    diagnosticBundleTestSource.includes("bundle.release.manifestAvailable") &&
    diagnosticBundleTestSource.includes("Basic Z2l0aHViOmRpYWdub3N0aWM=") &&
    diagnosticBundleTestSource.includes("github_pat_diagnosticSecret") &&
    diagnosticBundleTestSource.includes("bundle.service.version, packageJson.version") &&
    diagnosticBundleTestSource.includes("bundle.release.version, packageJson.version") &&
    diagnosticBundleTestSource.includes("bundle.remote.healthSummary.status") &&
    diagnosticBundleTestSource.includes("bundle.remote.acceptanceSummary.ready") &&
    apiAuthTestSource.includes("diagnosticBundle.remote.recoveryReport") &&
    diagnosticBundleTestSource.includes("bundle.remote.acceptanceRecords.total") &&
    diagnosticBundleTestSource.includes("evidence.requirements") &&
    diagnosticBundleTestSource.includes("bundle.remote.acceptanceRunbooks.total") &&
    apiAuthTestSource.includes("diagnosticBundle.release.artifactCount") &&
    adminRoutesSource.includes("releaseArtifactCount") &&
    adminRoutesSource.includes("remoteAcceptanceReady")
  ) pass("admin diagnostic bundle includes redacted release, remote health, and acceptance evidence");
  else warn("admin diagnostic bundle lacks release/remote acceptance metadata or coverage");
  const configDiagnosticsPanelSource = exists("src/pages/admin/settings/ConfigDiagnosticsPanel.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/ConfigDiagnosticsPanel.tsx"), "utf8") : "";
  if (
    adminRoutesSource.includes("release:") &&
    adminRoutesSource.includes("getReleaseDiagnostics()") &&
    configDiagnosticsPanelSource.includes("diagnostics.releasePackage") &&
    configDiagnosticsPanelSource.includes("diagnostics.release.manifestAvailable") &&
    configDiagnosticsPanelSource.includes("diagnostics.release.checksumAvailable") &&
    configDiagnosticsPanelSource.includes("backupSchedule.enabled") &&
    configDiagnosticsPanelSource.includes("diagnostics.autoBackup") &&
    translationsSource.includes("diagnostics.releasePackage") &&
    translationsSource.includes("diagnostics.autoBackup") &&
    frontendSmokeTestSource.includes("diagnostics\\.release\\.manifestAvailable")
  ) pass("admin settings diagnostics surfaces release manifest and checksum status");
  else warn("admin settings diagnostics does not surface release manifest/checksum status");
  const clientStateSource = exists("server/clientState.ts") ? fs.readFileSync(path.join(rootDir, "server/clientState.ts"), "utf8") : "";
  const stateRoutesSource = exists("server/routes/stateRoutes.ts") ? fs.readFileSync(path.join(rootDir, "server/routes/stateRoutes.ts"), "utf8") : "";
  const auditSource = exists("server/audit.ts") ? fs.readFileSync(path.join(rootDir, "server/audit.ts"), "utf8") : "";
  const httpSecuritySource = exists("server/httpSecurity.ts") ? fs.readFileSync(path.join(rootDir, "server/httpSecurity.ts"), "utf8") : "";
  const httpSecurityTestSource = exists("tests/http-security.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/http-security.test.mjs"), "utf8") : "";
  if (
    clientStateSource.includes("publicClientState") &&
    clientStateSource.includes("SENSITIVE_CLIENT_STATE_KEY") &&
    clientStateSource.includes("redactClientStateString") &&
    clientStateSource.includes("SENSITIVE_CLIENT_QUERY_KEY") &&
    clientStateSource.includes("Basic\\s+") &&
    clientStateSource.includes("github_pat_") &&
    stateRoutesSource.includes("publicClientState(state)") &&
    stateRoutesSource.includes("state: publicState") &&
    auditSource.includes("AIzaSy") &&
    auditSource.includes("(?:bind|device)_") &&
    apiAuthTestSource.includes("lifeos_byok_key") &&
    apiAuthTestSource.includes("state-secret-token") &&
    apiAuthTestSource.includes("github_pat_stateSecret")
  ) pass("client state API responses and realtime broadcasts redact sensitive values");
  else warn("client state API responses or realtime broadcasts may expose sensitive values");
  if (
    apiAuthTestSource.includes("collectUnexpectedSensitiveStrings") &&
    apiAuthTestSource.includes("credentialed or fragment URL") &&
    apiAuthTestSource.includes("URL query secret") &&
    apiAuthTestSource.includes("secret-like token") &&
    apiAuthTestSource.includes("local path") &&
    apiAuthTestSource.includes("returned sensitive strings")
  ) pass("API response audit rejects sensitive URL, path, and token-shaped strings");
  else warn("API response audit may miss sensitive URL, local path, or token-shaped strings");
  if (
    httpSecuritySource.includes("redactApiErrorPayload") &&
    httpSecuritySource.includes("redactApiErrorResponses") &&
    httpSecuritySource.includes("API_ERROR_TEXT_KEY") &&
    httpSecuritySource.includes("redactAuditString(value)") &&
    serverEntrySource.includes("redactApiErrorResponses") &&
    serverEntrySource.includes("app.use(redactApiErrorResponses)") &&
    httpSecurityTestSource.includes("API error response redaction removes secrets without changing business tokens") &&
    httpSecurityTestSource.includes("github_pat_errorSecret") &&
    httpSecurityTestSource.includes("bind_business_token_must_remain_available") &&
    String(packageJson.scripts?.test || "").includes("tests/http-security.test.mjs")
  ) pass("API error responses redact sensitive text without stripping business tokens");
  else warn("API error response redaction middleware or tests are incomplete");
  if (
    clientStateSource.includes("normalizeClientStateValue") &&
    clientStateSource.includes("normalizeAllowedUrlSchemes") &&
    clientStateSource.includes("Array.from(new Set") &&
    clientStateSource.includes("scheme.trim().toLowerCase()") &&
    apiAuthTestSource.includes("normalizedAllowedSchemes") &&
    apiAuthTestSource.includes("rawAllowedSchemes") &&
    apiAuthTestSource.includes('["https", "shortcuts", "weixin"]')
  ) pass("client state stores normalized URL scheme allowlists in SQLite");
  else warn("client state URL scheme allowlists may not be normalized before SQLite storage");

  const appSecretsSource = exists("server/appSecrets.ts") ? fs.readFileSync(path.join(rootDir, "server/appSecrets.ts"), "utf8") : "";
  const aiKeyPanelSource = exists("src/pages/admin/settings/AiKeyPanel.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/AiKeyPanel.tsx"), "utf8") : "";
  const chatRuntimeSettingsSource = exists("src/services/chatRuntimeSettings.ts") ? fs.readFileSync(path.join(rootDir, "src/services/chatRuntimeSettings.ts"), "utf8") : "";
  const chatRuntimeSettingsTestSource = exists("tests/chat-runtime-settings.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/chat-runtime-settings.test.mjs"), "utf8") : "";
  if (
    appSecretsSource.includes("gemini") &&
    appSecretsSource.includes("openai") &&
    appSecretsSource.includes("openrouter") &&
    appSecretsSource.includes("local") &&
    appSecretsSource.includes("normalizeProviderCredential") &&
    appSecretsSource.includes("getActiveAiProviderId") &&
    appSecretsSource.includes("saveActiveAiProvider") &&
    appSecretsSource.includes("syncLegacyAiRuntimeState") &&
    appSecretsSource.includes("lifeos_byok_provider") &&
    appSecretsSource.includes("lifeos_model_engine") &&
    appSecretsSource.includes("Local model endpoint must not contain credentials, query strings, or fragments") &&
    chatRuntimeSettingsSource.includes("lifeos_active_ai_provider") &&
    chatRuntimeSettingsSource.includes("providerId") &&
    chatRuntimeSettingsSource.includes("readLocalRuntimeValue") &&
    chatRuntimeSettingsSource.includes("isSensitiveLocalStorageKey") &&
    chatRuntimeSettingsSource.includes("lifeos_proxy_nodes") &&
    !chatRuntimeSettingsSource.includes('getClientState("lifeos_model_engine", localStorage.getItem') &&
    chatRuntimeSettingsTestSource.includes("runtime settings refuse sensitive local fallback keys") &&
    chatRuntimeSettingsTestSource.includes("lifeos_byok_key") &&
    chatRuntimeSettingsTestSource.includes("lifeos_proxy_url") &&
    aiKeyPanelSource.includes("listAiProviders") &&
    aiKeyPanelSource.includes("saveAiProviderKey") &&
    aiKeyPanelSource.includes("updateActiveAiProvider") &&
    aiKeyPanelSource.includes("updateAiProviderModel") &&
    aiKeyPanelSource.includes("testAiProvider") &&
    aiKeyPanelSource.includes('selectedProvider === "local" ? "live" : "configuration"') &&
    aiKeyPanelSource.includes("aiKey.testConfigOk") &&
    aiKeyPanelSource.includes("aiKey.testConfigOnly") &&
    aiKeyPanelSource.includes("aiKey.testLiveOk") &&
    aiKeyPanelSource.includes("aiKey.enabledHint") &&
    aiKeyPanelSource.includes("aiKey.defaultProviderTitle") &&
    aiKeyPanelSource.includes("aiKey.setDefault") &&
    translationsSource.includes("aiKey.defaultProviderTitle") &&
    translationsSource.includes("aiKey.setDefault") &&
    translationsSource.includes("聊天路由已启用") &&
    !translationsSource.includes("聊天路由暂未启用") &&
    adminRoutesSource.includes("ai_provider_default_updated") &&
    adminRoutesSource.includes("previousActiveProvider") &&
    adminRoutesSource.includes("previousModel") &&
    adminRoutesSource.includes("aiStatusAuditMetadata(status)") &&
    adminRoutesSource.includes("Live API call was not run") &&
    adminRoutesSource.includes("/models") &&
    adminRoutesSource.includes("models_endpoint_ok") &&
    adminRoutesSource.includes("live_ready") &&
    adminRoutesSource.includes("liveSupported") &&
    adminRoutesSource.includes("getAiProviderTestSummary") &&
    adminRoutesSource.includes("missing_local_endpoint") &&
    adminRoutesSource.includes("missing_provider_key") &&
    adminRoutesSource.includes("credentialKind") &&
    apiAuthTestSource.includes("file:///tmp/ollama.sock") &&
    apiAuthTestSource.includes("endpoint-secret") &&
    apiAuthTestSource.includes("ai_provider_default_updated") &&
    apiAuthTestSource.includes("testedMissingLocalProvider.reason") &&
    apiAuthTestSource.includes("testedLocalLive.result") &&
    apiAuthTestSource.includes("localLiveTestAudit.metadata.modelCount") &&
    apiAuthTestSource.includes("openAiDefaultAudit.metadata.previousActiveProvider") &&
    apiAuthTestSource.includes("openAiModelAudit.metadata.previousModel") &&
    apiAuthTestSource.includes("localTestAudit.metadata.reason") &&
    apiAuthTestSource.includes("openAiTestAudit.metadata.credentialKind") &&
    apiAuthTestSource.includes("legacyByokProviderState") &&
    apiAuthTestSource.includes("legacyModelEngineState") &&
    apiAuthTestSource.includes("testedOpenAi.mode") &&
    exists("tests/ai-provider-runtime.test.mjs") &&
    fs.readFileSync(path.join(rootDir, "tests/ai-provider-runtime.test.mjs"), "utf8").includes("AI provider changes sync legacy Studio runtime state") &&
    fs.readFileSync(path.join(rootDir, "tests/ai-provider-runtime.test.mjs"), "utf8").includes("AI runtime routes OpenAI-compatible providers with safe headers and selected models") &&
    fs.readFileSync(path.join(rootDir, "tests/ai-provider-runtime.test.mjs"), "utf8").includes("openrouter.providerId") &&
    fs.readFileSync(path.join(rootDir, "tests/ai-provider-runtime.test.mjs"), "utf8").includes("local.providerId") &&
    packageJson.scripts.test.includes("tests/chat-runtime-settings.test.mjs")
  ) pass("AI multi-provider UI and local endpoint validation are covered");
  else warn("AI multi-provider UI or local endpoint validation lacks release coverage");
  if (
    appSecretsSource.includes("getElectronSafeStorage") &&
    appSecretsSource.includes("safeStorage.encryptString") &&
    appSecretsSource.includes("safeStorage.decryptString") &&
    appSecretsSource.includes("macOS Keychain") &&
    appSecretsSource.includes("migrationRecommended") &&
    aiKeyPanelSource.includes("aiKey.currentLocation") &&
    aiKeyPanelSource.includes("aiKey.migrateHint") &&
    translationsSource.includes("aiKey.currentLocation") &&
    translationsSource.includes("aiKey.migrateHint") &&
    apiAuthTestSource.includes("secureStorage.fallbackActive")
  ) pass("AI key storage reports system secure store, fallback, and migration state");
  else warn("AI key storage lacks system secure store status, fallback visibility, or tests");

  const backupRoutesSourceForAudit = exists("server/routes/backupRoutes.ts") ? fs.readFileSync(path.join(rootDir, "server/routes/backupRoutes.ts"), "utf8") : "";
  if (
    adminRoutesSource.includes("aiStatusAuditMetadata") &&
    adminRoutesSource.includes("aiCredentialAuditMetadata") &&
    adminRoutesSource.includes("credentialLengthBucket") &&
    adminRoutesSource.includes("endpointHostKind") &&
    adminRoutesSource.includes("migrationRecommended") &&
    adminRoutesSource.includes("fallbackActive") &&
    deviceRoutesSource.includes("previousCredentialExpiresAt") &&
    deviceRoutesSource.includes("rotatedAt") &&
    backupRoutesSourceForAudit.includes("backupPreviewAuditSummary") &&
    backupRoutesSourceForAudit.includes("tableCount") &&
    backupRoutesSourceForAudit.includes("rowTotal") &&
    backupRoutesSourceForAudit.includes("encryption") &&
    backupRoutesSourceForAudit.includes("summarizeDataExport") &&
    dataLifecycleSource.includes("redactionPolicy") &&
    adminRoutesSource.includes("diagnostic_bundle_exported") &&
    adminRoutesSource.includes("databaseRowTotal") &&
    adminRoutesSource.includes("securityCriticalCount") &&
    adminRoutesSource.includes("remoteAcceptanceManualRequired") &&
    apiAuthTestSource.includes("previousCredentialExpiresAt") &&
    apiAuthTestSource.includes("secureStorage.label") &&
    apiAuthTestSource.includes("credentialLengthBucket") &&
    apiAuthTestSource.includes("encryptedExportAudit.metadata.encryption") &&
    apiAuthTestSource.includes("fullExportAudit.metadata.counts.auditLogs") &&
    apiAuthTestSource.includes("scopedExportAudit.metadata.counts.auditLogs") &&
    apiAuthTestSource.includes("diagnosticExportAudit.metadata.databaseRowTotal") &&
    apiAuthTestSource.includes("diagnosticExportAudit.metadata.securityCriticalCount")
  ) pass("high-risk AI key, device, backup, data export, and diagnostic exports include detailed redacted audit metadata");
  else warn("high-risk AI key, device, backup, data export, or diagnostic export audit metadata is too shallow or lacks tests");

  if (exists("dist/server.cjs") && exists("dist/index.html")) pass("build output exists in dist/");
  else warn("dist/ is missing or stale; run npm run build before packaging");
}

function checkElectronBinary() {
  const electronDist = path.join(rootDir, "node_modules", "electron", "dist");
  const macBinary = path.join(electronDist, "Electron.app");
  const unixBinary = path.join(electronDist, "electron");
  const windowsBinary = path.join(electronDist, "electron.exe");
  if (fs.existsSync(macBinary) || fs.existsSync(unixBinary) || fs.existsSync(windowsBinary)) {
    pass(`Electron binary is installed at ${path.relative(rootDir, electronDist)}`);
  } else {
    fail("Electron binary is missing; run npm run electron:install");
  }
}

function checkSecurityConfig() {
  if (exists("server/httpSecurity.ts")) pass("HTTP security middleware exists");
  else fail("HTTP security middleware is missing");

  const migrationDir = path.join(rootDir, "server", "migrations");
  const migrations = fs.existsSync(migrationDir)
    ? fs.readdirSync(migrationDir).filter((file) => /^\d+_.+\.sql$/.test(file))
    : [];
  if (migrations.length >= 2 && migrations.includes("002_app_secrets.sql")) pass(`SQLite migration files exist (${migrations.length})`);
  else warn("migration files are sparse; keep new schema changes in server/migrations/");

  if (packageJson.dependencies?.["electron-updater"]) pass("electron-updater dependency is installed");
  else warn("electron-updater is not installed");

  const dbSource = exists("server/db.ts") ? fs.readFileSync(path.join(rootDir, "server/db.ts"), "utf8") : "";
  const backupRoutesSource = exists("server/routes/backupRoutes.ts") ? fs.readFileSync(path.join(rootDir, "server/routes/backupRoutes.ts"), "utf8") : "";
  const dataLifecycleSourceForBackup = exists("server/dataLifecycle.ts") ? fs.readFileSync(path.join(rootDir, "server/dataLifecycle.ts"), "utf8") : "";
  const lifeosApiSource = exists("src/services/lifeosApi.ts") ? fs.readFileSync(path.join(rootDir, "src/services/lifeosApi.ts"), "utf8") : "";
  const backupRestorePanelSource = exists("src/pages/admin/settings/BackupRestorePanel.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/BackupRestorePanel.tsx"), "utf8") : "";
  const backupScheduleCardSource = exists("src/pages/admin/settings/BackupScheduleCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/BackupScheduleCard.tsx"), "utf8") : "";
  const backupListSource = exists("src/pages/admin/settings/BackupList.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/BackupList.tsx"), "utf8") : "";
  const backupPreviewCardSource = exists("src/pages/admin/settings/BackupPreviewCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/BackupPreviewCard.tsx"), "utf8") : "";
  const backupRestoreUiSource = exists("src/services/backupRestoreUi.ts") ? fs.readFileSync(path.join(rootDir, "src/services/backupRestoreUi.ts"), "utf8") : "";
  const backupRestoreUiTestSource = exists("tests/backup-restore-ui.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/backup-restore-ui.test.mjs"), "utf8") : "";
  const backupScheduleSource = exists("server/backupSchedule.ts") ? fs.readFileSync(path.join(rootDir, "server/backupSchedule.ts"), "utf8") : "";
  const backupScheduleTestSource = exists("tests/backup-schedule.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/backup-schedule.test.mjs"), "utf8") : "";
  const adminDashboardSource = exists("src/pages/admin/AdminDashboardPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/AdminDashboardPage.tsx"), "utf8") : "";
  const backupRestoreTestSource = exists("tests/backup-restore.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/backup-restore.test.mjs"), "utf8") : "";
  const apiAuthTestSource = exists("tests/api-auth.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/api-auth.test.mjs"), "utf8") : "";
  const desktopSmokeTestSource = exists("tests/desktop-smoke.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/desktop-smoke.test.mjs"), "utf8") : "";
  if (
    dbSource.includes("cancelPendingRestore") &&
    dbSource.includes("restore-pending.db") &&
    dbSource.includes("restore-pending.json") &&
    backupRoutesSource.includes('app.delete("/api/v1/backups/pending-restore"') &&
    backupRoutesSource.includes("database_restore_cancelled") &&
    lifeosApiSource.includes("cancelPendingRestore") &&
    backupRestorePanelSource.includes("backup.cancelRestore") &&
    translationsSource.includes("backup.cancelRestore") &&
    backupRestoreTestSource.includes("scheduled restore can be cancelled before restart") &&
    backupRestoreTestSource.includes("restore-pending.db") &&
    backupRestoreTestSource.includes("restore-pending.json")
  ) pass("pending restore cancellation is implemented across DB, API, UI, audit, and tests");
  else warn("pending restore cancellation is incomplete across DB, API, UI, audit, or tests");
  if (
    backupRoutesSource.includes("function publicRestoreRecord") &&
    backupRoutesSource.includes("restoredFrom: restore.restoredFrom") &&
    backupRoutesSource.includes("scheduledAt: restore.scheduledAt") &&
    backupRoutesSource.includes("scheduledForNextStart: restore.scheduledForNextStart") &&
    backupRoutesSource.includes("restartRequired: restore.restartRequired") &&
    !backupRoutesSource.includes("...restore,") &&
    backupRestoreTestSource.includes("Object.keys(scheduled.restore).sort()") &&
    backupRestoreTestSource.includes("scheduled.restore.sourcePath")
  ) pass("backup restore API exposes only whitelisted restore metadata");
  else warn("backup restore API may expose non-whitelisted restore metadata");
  if (
    backupRestorePanelSource.includes("BackupPreviewCard") &&
    backupRestorePanelSource.includes("BackupList") &&
    backupPreviewCardSource.includes("backupPreview.risks") &&
    backupPreviewCardSource.includes("preview.tables") &&
    backupPreviewCardSource.includes("backupPreview.secretsExcluded") &&
    backupListSource.includes("backupDownloadUrl(backup.file)") &&
    backupListSource.includes("onPreview(backup)") &&
    backupListSource.includes("onRestore(backup)") &&
    adminDashboardSource.includes("previewBackup") &&
    adminDashboardSource.includes("dashboard.preRestorePreview") &&
    adminDashboardSource.includes("dashboard.restoreRisk") &&
    backupRestoreUiSource.includes("Backup preview:") &&
    backupRestorePanelSource.includes("buildRestoreConfirmMessage") &&
    adminDashboardSource.includes("buildRestoreConfirmMessage")
  ) pass("backup restore previews are shown before restore in settings and dashboard");
  else warn("backup restore previews are not enforced across settings and dashboard restore entrypoints");
  if (
    backupRestoreUiSource.includes("buildRestoreConfirmMessage") &&
    backupRestoreUiSource.includes("formatBackupTableSummary") &&
    backupRestoreUiSource.includes("buildCleanupConfirmMessage") &&
    backupRestoreUiSource.includes("formatCleanupSummary") &&
    backupRestoreUiSource.includes("buildCleanupPolicyOptions") &&
    backupRestorePanelSource.includes("buildRestoreConfirmMessage") &&
    backupRestorePanelSource.includes("buildCleanupConfirmMessage") &&
    backupRestorePanelSource.includes("buildCleanupPolicyOptions") &&
    adminDashboardSource.includes("buildRestoreConfirmMessage") &&
    packageJson.scripts.test.includes("tests/backup-restore-ui.test.mjs") &&
    backupRestoreUiTestSource.includes("backup restore UI formats restore previews consistently") &&
    backupRestoreUiTestSource.includes("backup restore UI formats cleanup previews and confirmations consistently") &&
    backupRestoreUiTestSource.includes("backup restore UI validates cleanup policy before API calls")
  ) pass("backup restore UI confirmation copy is shared and tested");
  else warn("backup restore UI confirmation copy is duplicated or lacks focused tests");
  if (
    dbSource.includes("sanitizeBackupFile") &&
    dbSource.includes("DELETE FROM app_secrets") &&
    dbSource.includes("sensitiveClientStateKey") &&
    dbSource.includes("DELETE FROM admin_sessions") &&
    backupRoutesSource.includes("ordinaryBackupExcludesSecrets") &&
    lifeosApiSource.includes("sensitiveData") &&
    backupPreviewCardSource.includes("backupPreview.secretsExcluded") &&
    adminDashboardSource.includes("dashboard.ordinaryBackupSafe") &&
    translationsSource.includes("backupPreview.secretsExcluded") &&
    apiAuthTestSource.includes("sanitizedSecretCount") &&
    apiAuthTestSource.includes("ordinaryBackupExcludesSecrets")
  ) pass("ordinary SQLite backups exclude AI keys and sensitive client state by default");
  else warn("ordinary SQLite backups may still include AI keys or sensitive client state");
  if (
    backupScheduleSource.includes("runBackupScheduleNow") &&
    backupScheduleSource.includes("scheduled_backup_run_now") &&
    backupRoutesSource.includes('app.post("/api/v1/backups/schedule/run-now"') &&
    lifeosApiSource.includes("runBackupScheduleNow") &&
    backupRestorePanelSource.includes("runBackupScheduleNow") &&
    backupScheduleCardSource.includes("backup.runScheduleNow") &&
    backupRestorePanelSource.includes("backup.scheduleRunNowDone") &&
    translationsSource.includes("backup.runScheduleNow") &&
    backupScheduleTestSource.includes("can be run immediately by an admin") &&
    apiAuthTestSource.includes("/api/v1/backups/schedule/run-now") &&
    apiAuthTestSource.includes("scheduled_backup_run_now")
  ) pass("automatic backup schedule can be manually verified through API, UI, audit, and tests");
  else warn("automatic backup schedule lacks manual run verification across API, UI, audit, or tests");
  if (
    backupRoutesSource.includes('app.post("/api/v1/data/cleanup/preview"') &&
    backupRoutesSource.includes("data_cleanup_previewed") &&
    backupRoutesSource.includes("protectionBackupCreated") &&
    dataLifecycleSourceForBackup.includes("protectionBackup") &&
    dataLifecycleSourceForBackup.includes("createDatabaseBackup") &&
    lifeosApiSource.includes("previewDataCleanup") &&
    backupRestorePanelSource.includes("previewDataCleanup") &&
    backupRestorePanelSource.includes("backup.previewCleanup") &&
    backupRestorePanelSource.includes("backup.cleanupDoneWithProtection") &&
    translationsSource.includes("backup.previewCleanup") &&
    translationsSource.includes("backup.cleanupDoneWithProtection") &&
    backupRestorePanelSource.includes("cleanupPreview") &&
    backupRestoreUiSource.includes("formatCleanupSummary") &&
    backupRestoreUiSource.includes("Estimated cleanup") &&
    backupRestorePanelSource.includes("buildCleanupConfirmMessage") &&
    backupRestoreTestSource.includes("/api/v1/data/cleanup/preview") &&
    backupRestoreTestSource.includes("protectionBackup") &&
    apiAuthTestSource.includes("data_cleanup_previewed") &&
    apiAuthTestSource.includes("protectionBackupCreated")
  ) pass("data cleanup has dry-run preview, protection backup, UI, audit, and tests");
  else warn("data cleanup lacks dry-run preview, protection backup, UI, audit, or tests");

  const desktopMain = exists("desktop/main.cjs") ? fs.readFileSync(path.join(rootDir, "desktop/main.cjs"), "utf8") : "";
  if (desktopMain.includes("showStartupFailureWindow")) pass("desktop startup failure window is implemented");
  else warn("desktop startup failure window is not implemented");
  if (desktopMain.includes("exportDesktopDiagnosticBundle")) pass("desktop diagnostic export is implemented");
  else warn("desktop diagnostic export is not implemented");
  if (desktopMain.includes("mainWindow: mainWindow")) pass("desktop diagnostic includes main window state");
  else warn("desktop diagnostic does not include main window state");
  if (desktopMain.includes("openLogsFolder") && desktopMain.includes("Open Logs Folder")) pass("desktop logs folder menu action is implemented");
  else warn("desktop logs folder menu action is not implemented");
  if (desktopMain.includes("lifeos-desktop.log") && desktopMain.includes("tail: readLogTail()")) pass("desktop diagnostic includes redacted log tail");
  else warn("desktop diagnostic does not include a redacted log tail");
  if (desktopMain.includes("directoryLabel") && desktopMain.includes("System log directory is configured")) pass("desktop diagnostic exposes a safe logs directory label");
  else warn("desktop diagnostic does not expose a safe logs directory label");
  if (desktopMain.includes("fetchLocalJson") && desktopMain.includes("health: healthResult.ok") && desktopMain.includes("adminStatus: adminStatusResult.ok")) pass("desktop diagnostic includes local core health and admin status snapshots");
  else warn("desktop diagnostic does not include local core health/admin status snapshots");
  if (desktopMain.includes("readReleaseSnapshot") && desktopMain.includes("release: readReleaseSnapshot()") && desktopSmokeTestSource.includes("diagnostics.release.manifestAvailable")) pass("desktop diagnostic includes release manifest and checksum metadata");
  else warn("desktop diagnostic does not include release manifest/checksum metadata");
  if (
    desktopMain.includes("validateDesktopUpdateUrl") &&
    desktopMain.includes("url_contains_credentials_or_tokens") &&
    desktopMain.includes("url_points_to_artifact") &&
    desktopMain.includes("desktopUpdateStatus.enabled") &&
    desktopSmokeTestSource.includes("diagnostics.updates.enabled") &&
    desktopSmokeTestSource.includes("url_contains_credentials_or_tokens")
  ) pass("desktop runtime disables unsafe auto-update URLs");
  else warn("desktop runtime may accept unsafe auto-update URLs");
  if (desktopMain.includes("onboardingRequired") && desktopMain.includes("nextPath") && desktopMain.includes("First-run guide pending")) pass("desktop diagnostic captures first-launch onboarding routing state");
  else warn("desktop diagnostic does not capture first-launch onboarding routing state");
  if (
    desktopSmokeTestSource.includes("/api/v1/admin/setup") &&
    desktopSmokeTestSource.includes("authenticatedStatus.onboardingRequired") &&
    desktopSmokeTestSource.includes('"/admin/onboarding"')
  ) pass("desktop smoke verifies first-launch setup routes into onboarding");
  else warn("desktop smoke does not verify setup-to-onboarding routing");
  if (desktopMain.includes("refreshDesktopShellStatus") && desktopMain.includes("desktopShell: publicDesktopShellStatus()") && desktopMain.includes("Refresh Status") && desktopMain.includes("First Launch Guide")) pass("desktop tray exposes refreshed health/admin/AI/device status and first-launch entry");
  else warn("desktop tray does not expose refreshed health/admin/AI/device status");
  if (desktopMain.includes("showStartupFailureWindow") && desktopMain.includes("lifeos-desktop.log")) pass("desktop startup failure page points users to logs");
  else warn("desktop startup failure page does not point users to logs");
  if (desktopMain.includes("LifeOS startup failed") && desktopMain.includes("Export Desktop Diagnostics") && desktopMain.includes("Open Logs Folder")) pass("desktop startup failure menu exposes diagnostics and logs");
  else warn("desktop startup failure menu does not expose diagnostics and logs");
}

function checkSigningAndUpdates() {
  if (distribution && !["unsigned", "signed"].includes(distribution)) {
    fail("LIFEOS_DISTRIBUTION must be either unsigned or signed when set");
    return;
  }

  if (distribution === "unsigned") {
    pass("unsigned distribution strategy selected; code signing is optional");
    pass("unsigned distribution strategy selected; Apple notarization is optional");
  } else {
    if (process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD) pass("code signing certificate environment is configured");
    else warn("code signing certificate env is missing: CSC_LINK and CSC_KEY_PASSWORD");

    if (process.platform === "darwin") {
      if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) {
        pass("Apple notarization environment is configured");
      } else {
        warn("Apple notarization env is missing: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID");
      }
    }

    if (distribution === "signed" && (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD)) {
      fail("signed distribution requires CSC_LINK and CSC_KEY_PASSWORD");
    }
    if (distribution === "signed" && process.platform === "darwin" && (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID)) {
      fail("signed macOS distribution requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID");
    }
  }

  if (process.env.LIFEOS_UPDATE_URL) {
    try {
      const updateUrl = new URL(process.env.LIFEOS_UPDATE_URL);
      if (updateUrl.protocol === "https:") pass("desktop update URL is configured with HTTPS");
      else warn("LIFEOS_UPDATE_URL is configured but should use HTTPS for distribution");

      if (updateUrl.username || updateUrl.password || updateUrl.search || updateUrl.hash) {
        fail("LIFEOS_UPDATE_URL must not include credentials, query strings, or fragments");
      } else {
        pass("desktop update URL does not contain embedded credentials or tokens");
      }

      if (/\.(dmg|zip|exe|AppImage|yml|json)$/i.test(updateUrl.pathname)) {
        fail("LIFEOS_UPDATE_URL must point to the release directory, not a single artifact or metadata file");
      } else {
        pass("desktop update URL points to a release directory");
      }
    } catch {
      fail("LIFEOS_UPDATE_URL is not a valid URL");
    }
  } else {
    if (distribution === "unsigned") {
      pass("unsigned distribution strategy selected; auto-update URL is optional");
    } else {
      warn("LIFEOS_UPDATE_URL is not set; packaged app will skip update checks");
    }
  }
}

function checkUpdateFeed() {
  if (!exists("scripts/prepare-update-feed.mjs")) {
    fail("missing update feed generator: scripts/prepare-update-feed.mjs");
    return;
  }
  if (skipReleaseArtifacts) {
    pass("release artifact checks skipped by LIFEOS_RELEASE_SKIP_ARTIFACTS");
    return;
  }
  const feedDir = path.join(releaseDir, "update-feed");
  const checksumPath = path.join(releaseDir, "SHA256SUMS");
  if (!fs.existsSync(feedDir)) {
    warn("release/update-feed does not exist yet; run npm run desktop:dist && npm run release:feed when publishing updates");
    return;
  }
  const feedFiles = fs.readdirSync(feedDir).filter((file) => /^latest.*\.yml$/.test(file));
  if (feedFiles.length > 0) pass(`update feed metadata exists: ${feedFiles.join(", ")}`);
  else warn("release/update-feed exists but no latest*.yml metadata was found");

  const manifestPath = path.join(feedDir, "release-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    warn("release/update-feed/release-manifest.json is missing; run npm run release:feed to regenerate release metadata");
    return;
  }
  if (!fs.existsSync(checksumPath)) {
    fail("release/SHA256SUMS is missing; run npm run release:feed to regenerate downloadable checksums");
    return;
  }

  let manifest;
  const checksums = fs.readFileSync(checksumPath, "utf8");
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`release manifest is not valid JSON: ${error.message || String(error)}`);
    return;
  }

  if (manifest.version === packageJson.version) pass(`release manifest version matches package version ${packageJson.version}`);
  else fail(`release manifest version ${manifest.version || "(missing)"} does not match package version ${packageJson.version}`);

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length > 0) pass(`release manifest lists ${artifacts.length} artifact(s)`);
  else fail("release manifest does not list any artifacts");

  const unpackedReleaseDirs = fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /(?:^|-)unpacked$/i.test(entry.name))
    .map((entry) => entry.name);
  const unpackedArtifactRefs = artifacts
    .map((artifact) => String(artifact.fileName || ""))
    .filter((fileName) => /(?:^|\/)(?:[^/]+-)?unpacked(?:\/|$)/i.test(fileName) || /(?:^|\/)(?:LifeOS AI\.exe|lifeos-ai)$/i.test(fileName));
  const checksumUnpackedRefs = checksums
    .split(/\r?\n/)
    .filter((line) => /(?:^|\/)(?:[^/]+-)?unpacked(?:\/|$)/i.test(line) || /(?:^|\/)(?:LifeOS AI\.exe|lifeos-ai)$/i.test(line));
  if (unpackedArtifactRefs.length === 0 && checksumUnpackedRefs.length === 0) {
    pass(unpackedReleaseDirs.length > 0
      ? `release manifest/checksums exclude unpacked build directories: ${unpackedReleaseDirs.join(", ")}`
      : "release manifest/checksums do not reference unpacked build directories");
  } else {
    fail(`release manifest or SHA256SUMS references unpacked app internals: ${[...unpackedArtifactRefs, ...checksumUnpackedRefs].join(", ")}`);
  }

  for (const artifact of artifacts) {
    const artifactPath = path.join(feedDir, artifact.fileName || "");
    const rootArtifactPath = path.join(releaseDir, artifact.fileName || "");
    const feedPath = path.join(feedDir, artifact.feedFile || "");
    if (artifact.fileName && fs.existsSync(artifactPath)) {
      pass(`release manifest artifact exists: ${artifact.fileName}`);
      const actualSize = fs.statSync(artifactPath).size;
      if (actualSize === artifact.size) pass(`release manifest size matches: ${artifact.fileName}`);
      else fail(`release manifest size mismatch for ${artifact.fileName}: expected ${artifact.size}, got ${actualSize}`);

      const actualHash = crypto.createHash("sha512").update(fs.readFileSync(artifactPath)).digest("base64");
      if (artifact.sha512 && actualHash === artifact.sha512) pass(`release manifest sha512 matches: ${artifact.fileName}`);
      else fail(`release manifest sha512 mismatch for ${artifact.fileName}`);

      if (fs.existsSync(rootArtifactPath)) {
        const actualSha256 = crypto.createHash("sha256").update(fs.readFileSync(rootArtifactPath)).digest("hex");
        if (artifact.sha256 && artifact.sha256 === actualSha256) pass(`release manifest sha256 matches: ${artifact.fileName}`);
        else fail(`release manifest sha256 mismatch for ${artifact.fileName}`);
        if (checksums.includes(`${actualSha256}  ${artifact.fileName}`)) pass(`release SHA256SUMS includes artifact: ${artifact.fileName}`);
        else fail(`release SHA256SUMS checksum mismatch for ${artifact.fileName}`);
      } else {
        fail(`release root artifact is missing for checksum verification: ${artifact.fileName}`);
      }
    } else {
      fail(`release manifest artifact is missing: ${artifact.fileName || "(missing fileName)"}`);
    }

    if (artifact.feedFile && fs.existsSync(feedPath)) {
      const feed = fs.readFileSync(feedPath, "utf8");
      if (feed.includes(artifact.fileName) && feed.includes(artifact.sha512)) pass(`release feed references manifest artifact: ${artifact.feedFile}`);
      else fail(`release feed ${artifact.feedFile} does not reference manifest file/hash`);
    } else {
      fail(`release manifest feed file is missing: ${artifact.feedFile || "(missing feedFile)"}`);
    }
  }
}

function checkReleaseDocs() {
  if (!exists("CHANGELOG.md")) {
    warn("CHANGELOG.md is missing; releases should include user-visible changes");
  } else {
    const changelog = fs.readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8");
    if (changelog.includes(`## ${packageJson.version}`)) pass(`CHANGELOG.md includes version ${packageJson.version}`);
    else warn(`CHANGELOG.md does not mention current version ${packageJson.version}`);
  }

  if (exists("docs/rollback.md")) pass("rollback guide exists: docs/rollback.md");
  else warn("rollback guide is missing: docs/rollback.md");

  const dockerQuickstartFiles = {
    ".dockerignore": exists(".dockerignore") ? fs.readFileSync(path.join(rootDir, ".dockerignore"), "utf8") : "",
    Dockerfile: exists("Dockerfile") ? fs.readFileSync(path.join(rootDir, "Dockerfile"), "utf8") : "",
    "docker-compose.yml": exists("docker-compose.yml") ? fs.readFileSync(path.join(rootDir, "docker-compose.yml"), "utf8") : "",
    ".github/workflows/docker.yml": exists(".github/workflows/docker.yml") ? fs.readFileSync(path.join(rootDir, ".github/workflows/docker.yml"), "utf8") : "",
    "README.md": exists("README.md") ? fs.readFileSync(path.join(rootDir, "README.md"), "utf8") : "",
  };
  const missingDockerFiles = Object.entries(dockerQuickstartFiles)
    .filter(([, source]) => !source)
    .map(([relativePath]) => relativePath);
  const dockerCombined = Object.values(dockerQuickstartFiles).join("\n");
  const requiredDockerQuickstartMarkers = [
    "node:24-bookworm-slim",
    "npm ci",
    "npm run build",
    "ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha",
    "ollama/ollama:latest",
    "ollama pull llama3.2",
    "127.0.0.1:8080:3000",
    "LIFEOS_QUICKSTART=1",
    "LIFEOS_ADMIN_PASSWORD=lifeos-local-demo",
    "LOCAL_MODEL_BASE_URL=http://ollama:11434/v1",
    "LIFEOS_VAULT_DIR=/app/vault",
    'tags:\n      - "v*"',
    "packages: write",
    "docker/build-push-action@v6",
    "push: true",
    "docs/assets/real-demo-en.gif",
    "What am I forgetting?",
  ];
  const missingDockerMarkers = requiredDockerQuickstartMarkers.filter((marker) => !dockerCombined.includes(marker));
  if (missingDockerFiles.length === 0 && missingDockerMarkers.length === 0) {
    pass("Docker quickstart covers Ollama, local Markdown vault, quickstart login, GHCR image, and README proof path");
  } else {
    fail(`Docker quickstart is incomplete; missing files: ${missingDockerFiles.join(", ") || "none"}; missing markers: ${missingDockerMarkers.join(", ") || "none"}`);
  }

  const testScript = packageJson.scripts?.test || "";
  const chatVaultRouteTest = exists("tests/chat-vault-route.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/chat-vault-route.test.mjs"), "utf8") : "";
  if (
    testScript.includes("tests/chat-vault-route.test.mjs") &&
    chatVaultRouteTest.includes("chat route sends mounted Markdown vault context to the forced local quickstart model") &&
    chatVaultRouteTest.includes("LOCAL MARKDOWN VAULT CONTEXT - UNTRUSTED USER DATA") &&
    chatVaultRouteTest.includes("providerId: \"gemini\"") &&
    chatVaultRouteTest.includes("modelEngine: \"Gemini 2.0 Flash\"") &&
    chatVaultRouteTest.includes("llama3.2")
  ) {
    pass("Docker quickstart chat route proves local Markdown vault context reaches the forced local model");
  } else {
    fail("Docker quickstart chat route lacks coverage for mounted Markdown vault context, forced local provider, or llama3.2");
  }

  const readmeEn = dockerQuickstartFiles["README.md"];
  const readmeZh = exists("README.zh-CN.md") ? fs.readFileSync(path.join(rootDir, "README.zh-CN.md"), "utf8") : "";
  if (
    readmeEn.includes("docs/assets/real-demo-en.gif")
    && !readmeEn.includes("docs/assets/real-demo.gif")
    && readmeZh.includes("docs/assets/real-demo.gif")
  ) {
    pass("Bilingual README demo GIFs match their language");
  } else {
    fail("Bilingual README demo GIFs are mismatched; English must use docs/assets/real-demo-en.gif and Chinese must use docs/assets/real-demo.gif");
  }

  if (
    readmeEn.includes("## Choose Your Path") &&
    readmeEn.includes("Docker Compose alpha") &&
    readmeEn.includes("ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha") &&
    readmeEn.includes("LifeOS.AI-0.1.0-arm64-unsigned.zip") &&
    readmeEn.includes("public EXE/AppImage downloads are not uploaded yet") &&
    readmeZh.includes("## 选择你的体验路径") &&
    readmeZh.includes("Docker Compose alpha") &&
    readmeZh.includes("ghcr.io/wgj-fry/lifeos-ai:v0.1.1-alpha") &&
    readmeZh.includes("LifeOS.AI-0.1.0-arm64-unsigned.zip") &&
    readmeZh.includes("公开 EXE/AppImage 还没有上传")
  ) {
    pass("bilingual README clearly separates Docker alpha, macOS ZIP, and unavailable Windows/Linux downloads");
  } else {
    fail("bilingual README must clearly separate Docker alpha, macOS ZIP, and unavailable Windows/Linux downloads");
  }

  if (exists("docs/promotion-kit.md")) {
    const promotionKit = fs.readFileSync(path.join(rootDir, "docs/promotion-kit.md"), "utf8");
    if (
      promotionKit.includes("Cold launch release: `https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.1-alpha`")
      && promotionKit.includes("Desktop unsigned ZIP release: `https://github.com/WGJ-Fry/lifeos-ai/releases/tag/v0.1.0`")
    ) {
      pass("promotion kit separates the v0.1.1-alpha cold launch from the v0.1.0 desktop ZIP release");
    } else {
      fail("promotion kit must link the v0.1.1-alpha cold launch separately from the v0.1.0 desktop ZIP release");
    }
  } else {
    fail("promotion kit is missing: docs/promotion-kit.md");
  }

  const communityTemplatePaths = [
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/DISCUSSION_TEMPLATE/support.yml",
  ];
  const communityTemplateFindings = communityTemplatePaths
    .filter((relativePath) => exists(relativePath))
    .flatMap((relativePath) => {
      const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
      const findings = [];
      if (source.includes('placeholder: "0.1.0"')) findings.push(`${relativePath}: stale 0.1.0 placeholder`);
      if (!source.includes("0.1.1-alpha.0 / v0.1.1-alpha")) findings.push(`${relativePath}: missing current alpha version placeholder`);
      return findings;
    });
  if (communityTemplateFindings.length === 0 && communityTemplatePaths.every((relativePath) => exists(relativePath))) {
    pass("GitHub support templates ask for the current alpha version");
  } else {
    fail(`GitHub support templates need current version placeholders: ${communityTemplateFindings.join("; ") || "missing template"}`);
  }

  if (exists(".github/ISSUE_TEMPLATE/config.yml")) {
    const issueTemplateConfig = fs.readFileSync(path.join(rootDir, ".github/ISSUE_TEMPLATE/config.yml"), "utf8");
    if (
      issueTemplateConfig.includes("blank_issues_enabled: false")
      && issueTemplateConfig.includes("docs/user-install-guide.md")
      && issueTemplateConfig.includes("/discussions/categories/support")
      && issueTemplateConfig.includes("请勿粘贴密钥")
    ) {
      pass("GitHub issue template config routes support safely and disables blank issues");
    } else {
      fail("GitHub issue template config must disable blank issues and route users to docs/support without secrets");
    }
  } else {
    fail("GitHub issue template config is missing: .github/ISSUE_TEMPLATE/config.yml");
  }

  const publicReleaseDocPaths = [
    "README.md",
    "docs/release-assets.md",
    "docs/github-release.md",
    "docs/release-notes-v0.1.0.md",
    "docs/user-install-guide.md",
    "docs/promotion-kit.md",
    "docs/faq.md",
  ];
  const publicReleaseDocs = publicReleaseDocPaths
    .filter((relativePath) => exists(relativePath))
    .map((relativePath) => [relativePath, fs.readFileSync(path.join(rootDir, relativePath), "utf8")]);
  const staleCurrentReleaseMarkers = [
    "Download `LifeOS AI-0.1.0-arm64.dmg`",
    "下载 `LifeOS AI-0.1.0-arm64.dmg`",
    "macOS: open the DMG",
    "macOS：打开 DMG",
    "The current DMG is signed and notarized",
    "当前 DMG 已签名并公证",
    "macOS build is Developer ID signed and Apple notarized",
    "macOS 包已 Developer ID 签名和 Apple 公证",
    "The current release includes macOS / Windows / Linux desktop builds",
    "Current release includes:\n- macOS / Windows / Linux desktop builds",
    "现在已经有 macOS / Windows / Linux 安装包",
    "当前已经有 macOS / Windows / Linux 安装包",
    "a935ab398d8b88a1e47de9645bdf7f46372b3da14fd7b8ab09fbc00f83904b7a",
    "ebacb858194ae884c0770820536450e72514b8fee7fdd329933610d70c769022",
    "12b2c32148cff4a3bc3cd2247d4c4b17b1709624b77ea2853785b39a3cf0f279",
  ];
  const staleFindings = [];
  for (const [relativePath, source] of publicReleaseDocs) {
    for (const marker of staleCurrentReleaseMarkers) {
      if (source.includes(marker)) staleFindings.push(`${relativePath}: ${marker}`);
    }
  }
  if (staleFindings.length === 0) {
    pass("public release docs do not present unavailable DMG/EXE/AppImage assets as current downloads");
  } else {
    fail(`public release docs still contain stale current-download markers: ${staleFindings.join("; ")}`);
  }

  const publicReleaseCombined = publicReleaseDocs.map(([, source]) => source).join("\n");
  const requiredPublicReleaseMarkers = [
    "LifeOS.AI-0.1.0-arm64-unsigned.zip",
    "50570710de1732273d62233a44aa4441e76ec6200657a7f5a1c778274eae8f0e",
    "INSTALL-unsigned-mac.md",
    "Windows x64：准备中",
    "Linux x64：准备中",
    "Windows x64: preparing",
    "Linux x64: preparing",
  ];
  const missingPublicReleaseMarkers = requiredPublicReleaseMarkers.filter((marker) => !publicReleaseCombined.includes(marker));
  if (missingPublicReleaseMarkers.length === 0) {
    pass("public release docs describe the real v0.1.0 uploaded assets and platform gaps");
  } else {
    fail(`public release docs are missing current v0.1.0 asset markers: ${missingPublicReleaseMarkers.join(", ")}`);
  }

  if (exists("docs/user-install-guide.md")) {
    const userGuide = fs.readFileSync(path.join(rootDir, "docs/user-install-guide.md"), "utf8");
    const requiredUserGuideMarkers = [
      "macOS Unsigned Zip",
      "Windows NSIS Installer",
      "Linux AppImage",
      "First Launch",
      "Bind The Phone PWA",
      "Use It Away From Home",
      "Backups",
      "Updates",
      "Troubleshooting",
      "Open Anyway",
      "SmartScreen",
      "chmod +x",
      "LIFEOS_UPDATE_URL",
      "release-manifest.json",
      "SHA256SUMS",
      "shasum -a 256 -c SHA256SUMS",
      "Get-FileHash",
      "diagnostic bundle",
      "Open Local Console In Browser",
      "Copy Local Address",
      "desktop startup configuration",
      "Save to desktop startup configuration",
      "npm run remote:smoke",
      "LIFEOS_REMOTE_BASE_URL",
      "/api/v1/ws",
      "Wait until the phone shows the bound chat or device page",
      "Do not add the unbound QR page to the home screen",
      "delete the old home-screen icon",
    ];
    const missingMarkers = requiredUserGuideMarkers.filter((marker) => !userGuide.includes(marker));
    if (missingMarkers.length === 0) {
      pass("user install guide covers install, first launch, phone binding, backups, updates, and troubleshooting");
    } else {
      warn(`user install guide is missing install markers: ${missingMarkers.join(", ")}`);
    }
  } else {
    warn("user install guide is missing: docs/user-install-guide.md");
  }

  if (exists("CONTRIBUTING.md")) {
    const contributing = fs.readFileSync(path.join(rootDir, "CONTRIBUTING.md"), "utf8");
    if (
      contributing.includes("LifeOS AI 使用 MIT License")
      && contributing.includes("LifeOS AI is licensed under the MIT License")
      && !contributing.includes("UNLICENSED")
      && !contributing.includes("no open-source license")
    ) {
      pass("CONTRIBUTING.md matches the public MIT license");
    } else {
      fail("CONTRIBUTING.md must describe the MIT license and must not claim UNLICENSED/no open-source license");
    }
  } else {
    fail("CONTRIBUTING.md is missing");
  }

  if (exists("SECURITY.md")) {
    const securityPolicy = fs.readFileSync(path.join(rootDir, "SECURITY.md"), "utf8");
    const requiredSecurityMarkers = [
      "`v0.1.1-alpha` / `0.1.1-alpha.0`",
      "`v0.1.0` | 仅保留历史下载说明，建议升级",
      "GitHub 的私密漏洞报告功能",
      "不要附加原始数据库、未加密备份、未脱敏诊断包",
      "GitHub private vulnerability reporting",
      "Do not attach raw databases, unencrypted backups, unredacted diagnostic bundles",
    ];
    const missingSecurityMarkers = requiredSecurityMarkers.filter((marker) => !securityPolicy.includes(marker));
    if (missingSecurityMarkers.length === 0) {
      pass("SECURITY.md documents supported versions and private vulnerability reporting");
    } else {
      fail(`SECURITY.md is missing public security policy markers: ${missingSecurityMarkers.join(", ")}`);
    }
  } else {
    fail("SECURITY.md is missing");
  }

  if (exists("docs/release-checklist.md")) {
    const checklist = fs.readFileSync(path.join(rootDir, "docs/release-checklist.md"), "utf8");
    const requiredChecklistMarkers = [
      "unsigned",
      "signed",
      "npm run desktop:release:smoke",
      "npm run release:artifacts:check",
      "LIFEOS_UPDATE_URL",
      "release/update-feed/",
      "latest*.yml",
      "release-manifest.json",
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_ID",
      "APPLE_TEAM_ID",
      "Desktop Package Artifacts",
      "Release draft",
      "LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch",
    ];
    const missingMarkers = requiredChecklistMarkers.filter((marker) => !checklist.includes(marker));
    if (missingMarkers.length === 0) {
      pass("release checklist documents unsigned/signed distribution, update feed, and signing inputs");
    } else {
      warn(`release checklist is missing distribution markers: ${missingMarkers.join(", ")}`);
    }
  } else {
    warn("release checklist is missing: docs/release-checklist.md");
  }

  if (exists("docs/github-release.md")) {
    const githubReleaseGuide = fs.readFileSync(path.join(rootDir, "docs/github-release.md"), "utf8");
    const requiredGithubReleaseMarkers = [
      "Desktop Package Artifacts",
      "GitHub Release 草稿",
      "GitHub Release draft",
      "git tag v0.1.1-alpha",
      "LIFEOS_CHECK_GHCR=1 LIFEOS_CHECK_GITHUB_RELEASE=1 npm run check:cold-launch",
      "Manual workflow runs still produce Actions artifacts only",
      "只有 `v*` tag 触发时才会写入 GitHub Release 草稿",
    ];
    const missingMarkers = requiredGithubReleaseMarkers.filter((marker) => !githubReleaseGuide.includes(marker));
    if (missingMarkers.length === 0) {
      pass("GitHub release guide documents CI-generated draft releases");
    } else {
      warn(`GitHub release guide is missing CI draft release markers: ${missingMarkers.join(", ")}`);
    }
  } else {
    warn("GitHub release guide is missing: docs/github-release.md");
  }

  if (exists("docs/desktop-release.md")) {
    const desktopRelease = fs.readFileSync(path.join(rootDir, "docs/desktop-release.md"), "utf8");
    const requiredDesktopMarkers = [
      "desktop:dist:win",
      "desktop:dist:linux",
      "NSIS",
      "AppImage",
      "LIFEOS_UPDATE_URL",
      "latest-mac.yml",
      "latest.yml",
      "latest-linux.yml",
      "Desktop Diagnostics",
      "Startup Failure Experience",
    ];
    const missingMarkers = requiredDesktopMarkers.filter((marker) => !desktopRelease.includes(marker));
    if (missingMarkers.length === 0) {
      pass("desktop release guide covers cross-platform packaging, update channel, and diagnostics");
    } else {
      warn(`desktop release guide is missing packaging markers: ${missingMarkers.join(", ")}`);
    }
  } else {
    warn("desktop release guide is missing: docs/desktop-release.md");
  }
}

function checkCiWorkflow() {
  const workflowPath = path.join(rootDir, ".github", "workflows", "desktop-release-smoke.yml");
  if (!fs.existsSync(workflowPath)) {
    warn("desktop release smoke GitHub Actions workflow is missing");
    return;
  }
  const workflow = fs.readFileSync(workflowPath, "utf8");
  if (workflow.includes("macos-latest") && workflow.includes("windows-latest") && workflow.includes("ubuntu-latest")) {
    pass("desktop release smoke workflow covers macOS, Windows, and Linux");
  } else {
    warn("desktop release smoke workflow does not cover all desktop platforms");
  }
  if (workflow.includes("npm run desktop:release:smoke")) pass("desktop release smoke workflow runs the release smoke script");
  else warn("desktop release smoke workflow does not run npm run desktop:release:smoke");
  if (workflow.includes("runner.os == 'macOS'") && workflow.includes("npm run desktop:artifact:smoke:launch")) pass("desktop release smoke workflow launches the packaged macOS app");
  else warn("desktop release smoke workflow does not run packaged macOS app launch smoke");
  if (
    workflow.includes("runner.os == 'Windows'") &&
    workflow.includes("runner.os == 'Linux'") &&
    workflow.includes("LIFEOS_ARTIFACT_SMOKE_LAUNCH") &&
    workflow.includes("node scripts/desktop-artifact-smoke.mjs") &&
    workflow.includes("xvfb-run -a node scripts/desktop-artifact-smoke.mjs")
  ) {
    pass("desktop release smoke workflow launches packaged Windows and Linux apps");
  } else {
    warn("desktop release smoke workflow does not run packaged Windows/Linux app launch smoke");
  }
  if (workflow.includes("CSC_IDENTITY_AUTO_DISCOVERY") && workflow.includes("false")) pass("desktop release smoke workflow disables opportunistic signing");
  else warn("desktop release smoke workflow should disable opportunistic signing for unsigned smoke builds");
  if (workflow.includes("LIFEOS_RELEASE_SMOKE_FAST")) pass("desktop release smoke workflow uses fast quality gate before platform packaging");
  else warn("desktop release smoke workflow does not set LIFEOS_RELEASE_SMOKE_FAST");
}

function checkAudit() {
  if (process.env.LIFEOS_RELEASE_SKIP_AUDIT === "1") {
    pass("npm audit skipped by LIFEOS_RELEASE_SKIP_AUDIT");
    return;
  }

  const npmExecPath = process.env.npm_execpath || "";
  const auditCommand = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const auditArgsPrefix = npmExecPath ? [npmExecPath] : [];
  let lastAudit;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    lastAudit = spawnSync(auditCommand, [...auditArgsPrefix, "audit", "--audit-level=high"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (lastAudit.error) {
      fail(`npm audit could not start: ${lastAudit.error.message}`);
      return;
    }
    if (lastAudit.status === 0) {
      pass(attempt === 1 ? "npm audit found no high severity vulnerabilities" : `npm audit found no high severity vulnerabilities after ${attempt} attempts`);
      return;
    }
    const output = `${lastAudit.stdout}\n${lastAudit.stderr}`.trim();
    if (!/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|audit endpoint returned an error|socket hang up/i.test(output)) break;
  }
  const output = `${lastAudit?.stdout || ""}\n${lastAudit?.stderr || ""}`.trim();
  fail(`npm audit failed or found high severity vulnerabilities${output ? `\n${output}` : ""}`);
}

function checkUnsignedPackage() {
  if (skipReleaseArtifacts) {
    pass("unsigned package artifact checks skipped by LIFEOS_RELEASE_SKIP_ARTIFACTS");
    return;
  }
  if (!fs.existsSync(releaseDir)) {
    warn("release/ does not exist yet; run npm run desktop:pack:unsigned to verify local packaging");
    return;
  }
  const entries = fs.readdirSync(releaseDir, { recursive: true }).map(String);
  const hasUnsignedMacZip = entries.some((entry) => /LifeOS AI-.+-unsigned\.zip$/.test(entry));
  if (entries.some((entry) => entry.endsWith("LifeOS AI.app") || entry.endsWith(".dmg") || entry.endsWith(".zip") || entry.endsWith(".exe") || entry.endsWith(".AppImage"))) {
    pass("release/ contains a desktop package artifact");
  } else {
    warn("release/ exists but no desktop app/installer artifact was found");
  }
  if (hasUnsignedMacZip) {
    const installGuidePath = path.join(releaseDir, "INSTALL-unsigned-mac.md");
    const userInstallGuidePath = path.join(releaseDir, "USER-INSTALL.md");
    if (fs.existsSync(installGuidePath)) {
      const installGuide = fs.readFileSync(installGuidePath, "utf8");
      if (/Gatekeeper|unidentified developer|Open Anyway/i.test(installGuide) && /admin password/i.test(installGuide) && /daily automatic backups/i.test(installGuide) && /diagnostics?/i.test(installGuide)) {
        pass("unsigned macOS release includes user install and Gatekeeper guidance");
      } else {
        fail("unsigned macOS install guide should explain Gatekeeper, first launch, daily backups, and diagnostics");
      }
    } else {
      fail("unsigned macOS release is missing INSTALL-unsigned-mac.md");
    }
    if (fs.existsSync(userInstallGuidePath)) {
      const userInstallGuide = fs.readFileSync(userInstallGuidePath, "utf8");
      if (/First Launch/i.test(userInstallGuide) && /Bind The Phone PWA/i.test(userInstallGuide) && /daily automatic backups/i.test(userInstallGuide) && /Troubleshooting/i.test(userInstallGuide) && /Open Local Console In Browser/i.test(userInstallGuide) && /Copy Local Address/i.test(userInstallGuide) && /Do not add the unbound QR page to the home screen/i.test(userInstallGuide) && /delete the old home-screen icon/i.test(userInstallGuide)) {
        pass("unsigned macOS release includes non-developer user install guide");
      } else {
        fail("release USER-INSTALL.md should explain first launch, browser fallback recovery, phone binding, add-to-home-screen recovery, daily backups, and troubleshooting");
      }
    } else {
      fail("unsigned macOS release is missing USER-INSTALL.md");
    }
  }
}

function findPackagedMacApp() {
  if (!fs.existsSync(releaseDir)) return null;
  const entries = fs.readdirSync(releaseDir, { recursive: true }).map(String);
  const appEntry = entries.find((entry) => entry.endsWith("LifeOS AI.app/Contents/Resources/app.asar"));
  return appEntry ? path.join(releaseDir, appEntry) : null;
}

function checkPackagedAppContents() {
  const asarPath = findPackagedMacApp();
  if (!asarPath) return;

  let asar;
  try {
    asar = require("@electron/asar");
  } catch {
    fail("cannot inspect packaged app because @electron/asar is unavailable");
    return;
  }

  try {
    const entries = new Set(asar.listPackage(asarPath));
    const requiredEntries = ["/desktop/main.cjs", "/dist/server.cjs", "/dist/index.html", "/package.json"];
    const missing = requiredEntries.filter((entry) => !entries.has(entry));
    if (missing.length === 0) {
      pass("packaged macOS app contains desktop shell, local core, web UI, and package metadata");
    } else {
      fail(`packaged macOS app is missing required files: ${missing.join(", ")}`);
      return;
    }
    const desktopMain = asar.extractFile(asarPath, "desktop/main.cjs").toString("utf8");
    if (desktopMain.includes("fetchLocalJson") && desktopMain.includes("health: healthResult.ok") && desktopMain.includes("adminStatus: adminStatusResult.ok")) {
      pass("packaged macOS app desktop diagnostic includes local core health/admin snapshots");
    } else {
      fail("packaged macOS app desktop diagnostic is missing local core health/admin snapshots");
    }
    if (desktopMain.includes("readReleaseSnapshot") && desktopMain.includes("release: readReleaseSnapshot()")) {
      pass("packaged macOS app desktop diagnostic includes release metadata snapshot");
    } else {
      fail("packaged macOS app desktop diagnostic is missing release metadata snapshot");
    }
  } catch (error) {
    fail(`cannot inspect packaged app contents: ${error.message || String(error)}`);
  }
}

checkScripts();
checkDependencySecurityPins();
checkTypeScriptConfig();
checkSourceSizeBudgets();
checkBuildConfig();
checkAssets();
checkElectronBinary();
checkSecurityConfig();
checkSigningAndUpdates();
checkUpdateFeed();
checkUnsignedPackage();
checkPackagedAppContents();
checkReleaseDocs();
checkCiWorkflow();
checkAudit();

for (const result of results) {
  console.log(`[${result.level}] ${result.message}`);
}

const failures = results.filter((result) => result.level === "FAIL");
const warnings = results.filter((result) => result.level === "WARN");

console.log("");
console.log(`Release check: ${results.length - failures.length - warnings.length} passed, ${warnings.length} warnings, ${failures.length} failures.`);

if (failures.length > 0 || (strict && warnings.length > 0)) {
  process.exit(1);
}
