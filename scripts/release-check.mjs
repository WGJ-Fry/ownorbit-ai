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
    { path: "src/pages/admin/ConnectionGuide.tsx", maxLines: 480, label: "Connection guide" },
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
  for (const script of ["build", "desktop", "desktop:pack", "desktop:pack:unsigned", "desktop:zip:unsigned", "desktop:dist", "desktop:dist:mac", "desktop:dist:win", "desktop:dist:linux", "desktop:artifact:smoke", "desktop:artifact:smoke:launch", "desktop:release:smoke", "remote:smoke", "remote:acceptance", "remote:mock-smoke", "test", "test:e2e", "test:desktop", "quality:gate", "release:check", "release:check:unsigned", "release:feed"]) {
    if (hasScript(script)) pass(`package script exists: ${script}`);
    else fail(`missing package script: ${script}`);
  }

  const qualityGate = packageJson.scripts?.["quality:gate"] || "";
  const requiredQualitySteps = ["npm run lint", "npm test", "npm run test:e2e", "npm run test:desktop", "npm run release:check:unsigned"];
  const missingQualitySteps = requiredQualitySteps.filter((step) => !qualityGate.includes(step));
  if (missingQualitySteps.length === 0) pass("quality gate script runs lint, tests, e2e, desktop, and release checks");
  else fail(`quality:gate is missing required steps: ${missingQualitySteps.join(", ")}`);

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
      remoteSmoke.includes("query parameters or fragments") &&
      remoteSmokeTest.includes("query parameters or fragments") &&
      testScript.includes("tests/remote-connection-smoke.test.mjs")
    ) pass("remote connection smoke verifies health, mobile shell, websocket, and saved desktop config");
    else fail("remote connection smoke must cover health, mobile shell, websocket, env/config URL, unsafe URL rejection, and tests");
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
    if (smoke.includes("desktop:artifact:smoke")) pass("desktop release smoke verifies packaged artifacts after building");
    else fail("desktop release smoke should run desktop:artifact:smoke after packaging");
    if (smoke.includes("LIFEOS_RELEASE_SMOKE_LAUNCH") && smoke.includes("desktop:artifact:smoke:launch")) {
      pass("desktop release smoke can launch the packaged macOS app when requested");
    } else {
      fail("desktop release smoke should support LIFEOS_RELEASE_SMOKE_LAUNCH=1 for packaged macOS launch smoke");
    }
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
    adminOnboardingSource.includes("backupSchedule?.nextRunAt") &&
    adminOnboardingSource.includes("onboarding.defaultProvider") &&
    adminOnboardingSource.includes("onboarding.setDefault") &&
    adminOnboardingSource.includes("/admin/settings#mobile-connect") &&
    translationsSource.includes("onboarding.enableDailyBackup") &&
    translationsSource.includes("Set as Default Chat Provider")
  ) pass("first-launch onboarding has authoritative status, completion, audit, and login routing");
  else warn("first-launch onboarding is missing status, completion, audit, or login routing");

  const networkDiagnosticsSource = exists("server/networkDiagnostics.ts") ? fs.readFileSync(path.join(rootDir, "server/networkDiagnostics.ts"), "utf8") : "";
  const desktopRuntimeConfigSource = exists("server/desktopRuntimeConfig.ts") ? fs.readFileSync(path.join(rootDir, "server/desktopRuntimeConfig.ts"), "utf8") : "";
  const connectionGuideSource = exists("src/pages/admin/ConnectionGuide.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/ConnectionGuide.tsx"), "utf8") : "";
  const remoteStabilitySectionSource = exists("src/pages/admin/RemoteStabilitySection.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/RemoteStabilitySection.tsx"), "utf8") : "";
  const remoteHealthSummaryCardSource = exists("src/pages/admin/RemoteHealthSummaryCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/RemoteHealthSummaryCard.tsx"), "utf8") : "";
  const remoteAcceptanceChecklistSource = exists("src/pages/admin/RemoteAcceptanceChecklistCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/RemoteAcceptanceChecklistCard.tsx"), "utf8") : "";
  const remoteAcceptanceSource = exists("server/remoteAcceptance.ts") ? fs.readFileSync(path.join(rootDir, "server/remoteAcceptance.ts"), "utf8") : "";
  const remoteValidationReportSource = exists("server/remoteValidationReport.ts") ? fs.readFileSync(path.join(rootDir, "server/remoteValidationReport.ts"), "utf8") : "";
  const remoteHealthMonitorSource = exists("server/remoteHealthMonitor.ts") ? fs.readFileSync(path.join(rootDir, "server/remoteHealthMonitor.ts"), "utf8") : "";
  const connectionToolStatusSource = exists("src/pages/admin/ConnectionToolStatus.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/ConnectionToolStatus.tsx"), "utf8") : "";
  const customRemoteEntrySource = exists("src/pages/admin/CustomRemoteEntryCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/CustomRemoteEntryCard.tsx"), "utf8") : "";
  const devicePairSource = exists("src/pages/admin/DevicePairPage.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/DevicePairPage.tsx"), "utf8") : "";
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
    desktopRuntimeConfigSource.includes("desktop-runtime-config.json") &&
    desktopRuntimeConfigSource.includes("normalizeDesktopRuntimeConfig") &&
    desktopRuntimeConfigSource.includes("allowPublic") &&
    desktopRuntimeConfigSource.includes("isTailscaleHttpsServe") &&
    desktopMainSourceForRuntimeConfig.includes("applyDesktopRuntimeConfig") &&
    desktopMainSourceForRuntimeConfig.includes("desktop-runtime-config.json") &&
    networkDiagnosticsSource.includes("tailscale.magicDnsUrls") &&
    networkDiagnosticsSource.includes("httpsServeUrl") &&
    networkDiagnosticsSource.includes("tailscale serve --bg https:443") &&
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
    connectionGuideSource.includes("connection.recommendedAddress") &&
    connectionGuideSource.includes("connection.recommendedEnv") &&
    connectionGuideSource.includes("recommended-env") &&
    connectionGuideSource.includes("connection.copyRecommendedEnv") &&
    connectionGuideSource.includes("connection.copyMobileEntry") &&
    connectionGuideSource.includes("connection.mobileEntry") &&
    connectionGuideSource.includes("connection.pairingQrHint") &&
    !connectionGuideSource.includes('copyText("recommended-pair"') &&
    !connectionGuideSource.includes("copyText(candidate.id, candidate.mobilePairUrl)") &&
    connectionGuideSource.includes("connectionCandidates") &&
    connectionGuideSource.includes("candidate.envTemplate") &&
    connectionGuideSource.includes("connection.copyEnv") &&
    connectionGuideSource.includes("installCopy") &&
    connectionGuideSource.includes("connection.testSavedRemote") &&
    connectionGuideSource.includes("saved-desktop-config") &&
    connectionGuideSource.includes("remoteValidationReport") &&
    connectionGuideSource.includes("RemoteStabilitySection") &&
    remoteStabilitySectionSource.includes("RemoteHealthSummaryCard") &&
    remoteStabilitySectionSource.includes("RemoteAcceptanceChecklistCard") &&
    remoteStabilitySectionSource.includes("remoteHealthSummary") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.title") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.commandTitle") &&
    remoteAcceptanceChecklistSource.includes("navigator.clipboard.writeText") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.copyCommand") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.runNow") &&
    remoteAcceptanceChecklistSource.includes("onRunAcceptance") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.importTitle") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.latestEvidence") &&
    remoteAcceptanceChecklistSource.includes("runbooks.latest") &&
    remoteAcceptanceChecklistSource.includes("onImportReport") &&
    remoteAcceptanceChecklistSource.includes("connection.acceptance.markDone") &&
    remoteAcceptanceChecklistSource.includes("onAccept") &&
    remoteAcceptanceChecklistSource.includes("cellular-mobile-chat") &&
    remoteAcceptanceChecklistSource.includes("network-interruption") &&
    remoteAcceptanceChecklistSource.includes("diagnostic-export") &&
    remoteAcceptanceChecklistSource.includes("ci-remote-mock") &&
    remoteStabilitySectionSource.includes("LIFEOS_REMOTE_ACCEPTANCE_OUT") &&
    remoteStabilitySectionSource.includes("LIFEOS_REMOTE_BASE_URL") &&
    remoteStabilitySectionSource.includes("npm run remote:acceptance") &&
    remoteStabilitySectionSource.includes("importRemoteAcceptanceReport") &&
    remoteStabilitySectionSource.includes("runRemoteAcceptance") &&
    remoteStabilitySectionSource.includes("remoteAcceptanceRunbooks") &&
    remoteStabilitySectionSource.includes("remoteRecoveryReport") &&
    remoteStabilitySectionSource.includes("JSON.parse") &&
    remoteHealthSummaryCardSource.includes("entryKindKey") &&
    remoteHealthSummaryCardSource.includes("summary.entryKind") &&
    remoteHealthSummaryCardSource.includes("restoredBaseUrl") &&
    remoteHealthSummaryCardSource.includes("connection.recovery.title") &&
    remoteHealthSummaryCardSource.includes("connection.recovery.summary") &&
    remoteAcceptanceSource.includes("buildRemoteAcceptanceChecklist") &&
    remoteAcceptanceSource.includes("saveRemoteAcceptanceRecord") &&
    remoteAcceptanceSource.includes("saveRemoteAcceptanceRunbookReport") &&
    remoteAcceptanceSource.includes("saveRemoteAcceptanceRunbookFromConnectionTest") &&
    remoteAcceptanceSource.includes("getRemoteAcceptanceRunbookRecords") &&
    remoteAcceptanceSource.includes("getRemoteAcceptanceRecords") &&
    remoteAcceptanceSource.includes("Remote acceptance URL must not contain username, password, token, query, or fragment") &&
    remoteAcceptanceSource.includes("Remote acceptance report URLs must not contain username, password, token, query, or fragment") &&
    desktopRuntimeConfigSource.includes("Desktop connection baseUrl must not contain username, password, token, query, or fragment") &&
    apiAuthTestSourceForRouting.includes("unsafeRemoteDesktopConnectionConfig.status, 400") &&
    remoteAcceptanceSource.includes("manual-required") &&
    remoteAcceptanceSource.includes("LIFEOS_REMOTE_BASE_URL=https://your-stable-entry npm run remote:smoke") &&
    remoteValidationReportSource.includes("entryKind") &&
    remoteValidationReportSource.includes("classifyEntryKind") &&
    remoteHealthMonitorSource.includes("restoredBaseUrl") &&
    remoteHealthMonitorSource.includes("checkBaseUrl = remoteBaseUrl() || baseUrl") &&
    remoteHealthMonitorSource.includes("baseUrl: checkBaseUrl") &&
    lifeosApiSourceForRouting.includes("entryKind") &&
    lifeosApiSourceForRouting.includes("restoredBaseUrl") &&
    lifeosApiSourceForRouting.includes("recordRemoteAcceptance") &&
    lifeosApiSourceForRouting.includes("importRemoteAcceptanceReport") &&
    lifeosApiSourceForRouting.includes("runRemoteAcceptance") &&
    remoteStabilitySectionSource.includes("handleRecordAcceptance") &&
    connectionGuideSource.includes("connection.remoteValidationOk") &&
    connectionGuideSource.includes("connection.remoteValidationFail") &&
    adminRoutesSource.includes("summarizeRemoteHealth") &&
    adminRoutesSource.includes("getRemoteRecoveryReport") &&
    adminRoutesSource.includes("buildRemoteAcceptanceChecklist") &&
    adminRoutesSource.includes("remoteAcceptanceRunbooks") &&
    adminRoutesSource.includes("/api/v1/admin/network-diagnostics/acceptance-report") &&
    adminRoutesSource.includes("/api/v1/admin/network-diagnostics/acceptance-run") &&
    adminRoutesSource.includes("remote_acceptance_report_imported") &&
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
    connectionGuideSource.includes("TailscaleServeActions") &&
    connectionGuideSource.includes("startTailscaleHttpsServe") &&
    connectionGuideSource.includes("connection.packageRestartHint") &&
    connectionGuideSource.includes("CustomRemoteEntryCard") &&
    connectionGuideSource.includes("RemoteReadinessCard") &&
    customRemoteEntrySource.includes("connection.customTitle") &&
    customRemoteEntrySource.includes("testConnectionUrl") &&
    customRemoteEntrySource.includes("saveDesktopConnectionConfig") &&
    customRemoteEntrySource.includes('mode: "configured"') &&
    customRemoteEntrySource.includes('normalizedUrl.startsWith("https://")') &&
    desktopRuntimeConfigSource.includes('mode === "configured" || mode === "cloudflare"') &&
    desktopRuntimeConfigSource.includes("Public remote connection modes require an HTTPS baseUrl") &&
    translationsSource.includes("connection.recommendedAddress") &&
    translationsSource.includes("connection.recommendedEnv") &&
    translationsSource.includes("connection.copyRecommendedEnv") &&
    translationsSource.includes("connection.saveDesktopConfig") &&
    translationsSource.includes("connection.customTitle") &&
    translationsSource.includes("connection.readiness.status.ready") &&
    translationsSource.includes("connection.readiness.item.needsPublicOptIn") &&
    translationsSource.includes("connection.acceptance.title") &&
    translationsSource.includes("connection.acceptance.commandTitle") &&
    translationsSource.includes("connection.recovery.title") &&
    translationsSource.includes("connection.recovery.restoredBaseUrl") &&
    translationsSource.includes("connection.health.entry.tailscale") &&
    translationsSource.includes("connection.health.entry.temporaryCloudflare") &&
    translationsSource.includes("connection.acceptance.runNow") &&
    translationsSource.includes("connection.acceptance.importTitle") &&
    translationsSource.includes("connection.acceptance.latestEvidence") &&
    translationsSource.includes("connection.acceptance.markDone") &&
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
    (devicePairSource.includes("diagnostics.recommendedBaseUrl") || devicePairSource.includes("networkDiagnostics.recommendedBaseUrl"))
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
    translationsSource.includes("devicePair.testCurrent") &&
    translationsSource.includes("connection.secureRecommended") &&
    translationsSource.includes("connection.trustedNetworkOnly") &&
    translationsSource.includes("devicePair.copyEnv")
  ) pass("device pairing QR page exposes recommended URL safety and reachability test");
  else warn("device pairing QR page does not expose recommended URL safety or reachability test");
  if (
    networkDiagnosticsSource.includes("cloudflared tunnel --url") &&
    networkDiagnosticsSource.includes("tailscale") &&
    networkDiagnosticsSource.includes("tailscale serve --bg https:443") &&
    networkDiagnosticsSource.includes("parsed.username = \"\"") &&
    networkDiagnosticsSource.includes("new URL(`${basePath}/api/v1/health`, parsed.origin)") &&
    networkDiagnosticsSource.includes("new URL(`${basePath}/mobile/chat`, parsed.origin)") &&
    networkDiagnosticsSource.includes("probeWebSocketStep") &&
    networkDiagnosticsSource.includes("publicAccessWarning = Boolean") &&
    networkDiagnosticsTestSource.includes("network diagnostics detects mocked Cloudflare and Tailscale CLIs") &&
    networkDiagnosticsTestSource.includes("tailscale-serve-https") &&
    networkDiagnosticsTestSource.includes("remoteReadiness.status") &&
    networkDiagnosticsTestSource.includes("needsPublicOptIn") &&
    networkDiagnosticsTestSource.includes("Tailscale HTTPS Serve helpers run controlled start and stop commands") &&
    networkDiagnosticsTestSource.includes("configured Tailscale HTTPS Serve autostart refreshes the saved stable URL") &&
    networkDiagnosticsTestSource.includes("Tailscale HTTP fallback is not accepted as a long-term remote entry") &&
    cloudflareTunnelSource.includes("cloudflared-named-tunnel.json") &&
    cloudflareTunnelSource.includes("loadNamedTunnelSettings") &&
    cloudflareTunnelSource.includes("saveNamedTunnelSettings") &&
    cloudflareTunnelSource.includes("settingsSaved") &&
    cloudflareTunnelSource.includes("scheduleNamedTunnelReconnect") &&
    cloudflareTunnelSource.includes("reconnectAttempts") &&
    cloudflareTunnelSource.includes("reconnectScheduledAt") &&
    cloudflareTunnelTestSource.includes("settingsSaved") &&
    cloudflareTunnelTestSource.includes("reconnects automatically after an unexpected disconnect") &&
    packageJson.scripts.test.includes("tests/cloudflare-tunnel.test.mjs") &&
    cloudflareTunnelTestSource.includes("delete process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME") &&
    networkDiagnosticsTestSource.includes("connection URL tests strip credentials, query secrets, and fragments") &&
    networkDiagnosticsTestSource.includes("connection URL tests health, mobile shell, and websocket under a remote base path")
  ) pass("connection diagnostics have Cloudflare/Tailscale mock coverage, Named Tunnel reconnect, and sanitize test URLs");
  else warn("connection diagnostics lack Cloudflare/Tailscale mock coverage, Named Tunnel reconnect, or URL sanitization checks");

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
  const securityDiagnosticsSource = exists("server/securityDiagnostics.ts") ? fs.readFileSync(path.join(rootDir, "server/securityDiagnostics.ts"), "utf8") : "";
  const publicModeTestSource = exists("tests/public-mode.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/public-mode.test.mjs"), "utf8") : "";
  if (
    coreRoutesSource.includes("publicRiskItems") &&
    coreRoutesSource.includes("publicRisk") &&
    coreRoutesSource.includes("securityDiagnostics.overall !== \"ok\"") &&
    securityDiagnosticsSource.includes('id: "backupSchedule"') &&
    securityDiagnosticsSource.includes("getBackupSchedule") &&
    adminDashboardSource.includes("dashboard.publicRiskTitle") &&
    adminDashboardSource.includes("health.publicRisk.items.map") &&
    adminDashboardSource.includes("dashboard.createBackupNow") &&
    adminDashboardSource.includes("dashboard.enableAutoBackup") &&
    adminDashboardSource.includes("/admin/settings#backup-schedule") &&
    translationsSource.includes("dashboard.publicRiskTitle") &&
    publicModeTestSource.includes("backupSchedule") &&
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
  if (
    mobileDeviceSource.includes("mobileDevice.pastePairingLink") &&
    mobileDeviceSource.includes("mobileDevice.rebindButton") &&
    mobileDeviceSource.includes("pairingInstallPath") &&
    !mobileDeviceSource.includes('href="/mobile/pair"') &&
    !mobileDeviceSource.includes("window.location.href = `/mobile/pair?token=")
  ) pass("mobile device page supports token paste rebinding without naked pair links");
  else warn("mobile device page rebinding flow can still open a tokenless pair page");
  const deviceRoutesSource = exists("server/routes/deviceRoutes.ts") ? fs.readFileSync(path.join(rootDir, "server/routes/deviceRoutes.ts"), "utf8") : "";
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
    lifeosApiSource.includes("revokeCurrentDeviceBinding") &&
    mobileDeviceSource.includes("mobileDevice.forgetBinding") &&
    apiAuthTestSource.includes("Self Revoke Phone") &&
    apiAuthTestSource.includes("device_self_revoked")
  ) pass("mobile device page can revoke its own server-side binding with audit coverage");
  else warn("mobile device self-revoke flow is incomplete across API, UI, or tests");
  const deviceCredentialStoreSource = exists("src/services/deviceCredentialStore.ts") ? fs.readFileSync(path.join(rootDir, "src/services/deviceCredentialStore.ts"), "utf8") : "";
  if (
    deviceCredentialStoreSource.includes("getDeviceCredentialStorageStatus") &&
    deviceCredentialStoreSource.includes("LEGACY_LOCAL_STORAGE_KEY") &&
    deviceCredentialStoreSource.includes("localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)") &&
    !deviceCredentialStoreSource.includes("localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY") &&
    mobileDeviceSource.includes("mobileDevice.storageTitle") &&
    mobileDeviceSource.includes("mobileDevice.legacyCredential") &&
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
  const offlineQueueTestSource = exists("tests/offline-queue.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/offline-queue.test.mjs"), "utf8") : "";
  const pwaCapabilitiesSource = exists("src/services/pwaCapabilities.ts") ? fs.readFileSync(path.join(rootDir, "src/services/pwaCapabilities.ts"), "utf8") : "";
  const pwaCapabilitiesTestSource = exists("tests/pwa-capabilities.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/pwa-capabilities.test.mjs"), "utf8") : "";
  const mobileConnectivityCardSource = exists("src/pages/mobile/MobileConnectivityCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/mobile/MobileConnectivityCard.tsx"), "utf8") : "";
  const frontendSmokeTestSource = exists("tests/frontend-smoke.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/frontend-smoke.test.mjs"), "utf8") : "";
  const dbSourceForConnectivity = exists("server/db.ts") ? fs.readFileSync(path.join(rootDir, "server/db.ts"), "utf8") : "";
  if (
    pwaCapabilitiesSource.includes("getPwaCapabilityStatus") &&
    pwaCapabilitiesSource.includes("getRemoteEntryStatus") &&
    pwaCapabilitiesSource.includes("getMobileRecoveryHints") &&
    pwaCapabilitiesSource.includes("testMobileRemoteConnectivity") &&
    pwaCapabilitiesSource.includes("/api/v1/health") &&
    pwaCapabilitiesSource.includes("/api/v1/ws") &&
    pwaCapabilitiesSource.includes("temporary-cloudflare") &&
    pwaCapabilitiesSource.includes("configured-mismatch") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceHealth") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceTailscaleHttp") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceOfflineQueue") &&
    pwaCapabilitiesSource.includes("connectivityGuidanceFailedQueue") &&
    pwaCapabilitiesSource.includes("serviceWorkerControlled") &&
    pwaCapabilitiesSource.includes("backgroundSyncSupported") &&
    pwaCapabilitiesSource.includes("indexedDbSupported") &&
    mobileDeviceSource.includes("mobileDevice.pwaTitle") &&
    mobileDeviceSource.includes("mobileDevice.remoteVerdict") &&
    mobileDeviceSource.includes("mobileDevice.connectivityTest") &&
    mobileDeviceSource.includes("testMobileRemoteConnectivity") &&
    mobileDeviceSource.includes("reportMobileConnectivity") &&
    mobileDeviceSource.includes("onRetry={handleConnectivityTest}") &&
    mobileDeviceSource.includes("queueSummary={queueSummary}") &&
    mobileConnectivityCardSource.includes("getMobileRecoveryHints") &&
    mobileConnectivityCardSource.includes("isHttpRemoteBase") &&
    mobileConnectivityCardSource.includes("queueSummary") &&
    mobileConnectivityCardSource.includes("tailscale://") &&
    mobileConnectivityCardSource.includes("mobileDevice.openTailscale") &&
    mobileConnectivityCardSource.includes("mobileDevice.rebindRemoteEntry") &&
    mobileConnectivityCardSource.includes("mobileDevice.retryRealtime") &&
    mobileDeviceSource.includes("pwaCapabilities.recommendations") &&
    adminDashboardSource.includes("connectivityReport") &&
    adminDashboardSource.includes("dashboard.mobileConnectivityOk") &&
    deviceRoutesSource.includes("/api/v1/devices/me/connectivity-report") &&
    deviceRoutesSource.includes("insertDeviceConnectivityReport") &&
    deviceRoutesSource.includes("device_connectivity_reported") &&
    exists("server/migrations/004_device_connectivity_reports.sql") &&
    dbSourceForConnectivity.includes("device_connectivity_reports") &&
    pwaCapabilitiesTestSource.includes("remote entry status detects configured public base mismatches") &&
    pwaCapabilitiesTestSource.includes("mobile remote connectivity probes health and websocket") &&
    pwaCapabilitiesTestSource.includes("mobile remote connectivity reports websocket failures") &&
    pwaCapabilitiesTestSource.includes("mobile recovery hints combine entry type") &&
    pwaCapabilitiesTestSource.includes("degraded offline sync support") &&
    frontendSmokeTestSource.includes("mobileDevice\\.pwaTitle") &&
    frontendSmokeTestSource.includes("queueSummary=\\{queueSummary\\}") &&
    frontendSmokeTestSource.includes("getMobileRecoveryHints") &&
    translationsSource.includes("connectivityGuidanceHealth") &&
    translationsSource.includes("connectivityGuidanceTailscaleHttp") &&
    translationsSource.includes("connectivityGuidanceOfflineQueue") &&
    translationsSource.includes("connectivityGuidanceFailedQueue") &&
    translationsSource.includes("mobileDevice.pwaTitle")
  ) pass("mobile device page surfaces PWA install, background sync, and remote recovery guidance");
  else warn("mobile device page lacks PWA install/background sync/remote recovery guidance or coverage");
  if (
    offlineQueueSource.includes("getOfflineMessageStatusLabel") &&
    offlineQueueSource.includes("getOfflineMessageRetryLabel") &&
    offlineQueueSource.includes("Ready to retry") &&
    offlineQueueBannerSource.includes("getOfflineMessageStatusLabel") &&
    offlineQueueBannerSource.includes("getOfflineMessageRetryLabel") &&
    mobileDeviceSource.includes("getOfflineMessageQueueStorageStatus") &&
    mobileDeviceSource.includes("MobileOfflineQueueCards") &&
    mobileOfflineQueueCardsSource.includes("getOfflineMessageStatusLabel") &&
    mobileOfflineQueueCardsSource.includes("getOfflineMessageRetryLabel") &&
    mobileOfflineQueueCardsSource.includes("getOfflineMessageQueueStorageLabel") &&
    mobileOfflineQueueCardsSource.includes("getOfflineMessageQueueUsageLabel") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.storageTitle") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.legacyMirror") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.persistentStorage") &&
    mobileOfflineQueueCardsSource.includes("offlineQueue.failureReason") &&
    translationsSource.includes("offlineQueue.storageTitle") &&
    translationsSource.includes("offlineQueue.legacyMirror") &&
    translationsSource.includes("offlineQueue.persistentStorage") &&
    translationsSource.includes("offlineQueue.failureReason") &&
    offlineQueueTestSource.includes("getOfflineMessageStatusLabel") &&
    offlineQueueTestSource.includes("getOfflineMessageRetryLabel") &&
    offlineQueueTestSource.includes("formatOfflineMessageQueueBytes") &&
    offlineQueueTestSource.includes("getOfflineMessageQueueStorageLabel") &&
    offlineQueueTestSource.includes("getOfflineMessageQueueUsageLabel") &&
    offlineQueueTestSource.includes("getOfflineMessageQueueStorageStatus") &&
    offlineQueueTestSource.includes("migrates legacy localStorage into IndexedDB primary storage") &&
    offlineQueueSource.includes("IndexedDB primary storage") &&
    offlineQueueSource.includes("hydrateOfflineMessageQueue") &&
    offlineQueueSource.includes("writeIndexedQueue") &&
    offlineQueueSource.includes("Browser storage is near its limit")
  ) pass("offline queue UI uses localized status and item retry timing");
  else warn("offline queue UI lacks localized item status, retry timing, or tests");

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
    systemActionsSource.includes("riskLabel(latestActionLog.risk, t)") &&
    translationsSource.includes("actions.permissionCenter") &&
    translationsSource.includes("actions.clearLogs") &&
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
    frontendSmokeTestSource.includes("actions\\.clearLogs")
  ) pass("mobile action permission center summarizes, clears, and audits local app launches");
  else warn("mobile action permission center lacks summary, clear action, launch audit details, or tests");
  if (
    systemActionsServiceSource.includes("BLOCKED_URL_SCHEMES") &&
    systemActionsServiceSource.includes("normalizeAllowedUrlSchemes") &&
    systemActionsServiceSource.includes("javascript") &&
    systemActionsServiceSource.includes("view-source") &&
    systemActionsServiceSource.includes("redactActionUrl") &&
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
    dataExportRedactionTestSource.includes("should not leak in data export redaction") &&
    dataExportRedactionTestSource.includes("C:\\\\Users\\\\example") &&
    String(packageJson.scripts?.test || "").includes("tests/data-export-redaction.test.mjs")
  ) pass("data export redaction covers AI keys, tokens, auth headers, crypto fields, URLs, and local paths");
  else warn("data export redaction does not cover the full sensitive field set");
  const diagnosticBundleSource = exists("server/diagnosticBundle.ts") ? fs.readFileSync(path.join(rootDir, "server/diagnosticBundle.ts"), "utf8") : "";
  const diagnosticBundleTestSource = exists("tests/diagnostic-bundle-redaction.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/diagnostic-bundle-redaction.test.mjs"), "utf8") : "";
  if (
    diagnosticBundleSource.includes("getReleaseDiagnostics") &&
    diagnosticBundleSource.includes("publicReleaseArtifactSummary") &&
    diagnosticBundleSource.includes("release: getReleaseDiagnostics()") &&
    diagnosticBundleSource.includes("remote: {") &&
    diagnosticBundleSource.includes("recoveryReport") &&
    diagnosticBundleSource.includes("acceptanceChecklist") &&
    diagnosticBundleSource.includes("acceptanceRecords") &&
    diagnosticBundleSource.includes("acceptanceRunbooks") &&
    diagnosticBundleTestSource.includes("bundle.release.manifestAvailable") &&
    diagnosticBundleTestSource.includes("bundle.remote.healthSummary.status") &&
    apiAuthTestSource.includes("diagnosticBundle.remote.recoveryReport") &&
    diagnosticBundleTestSource.includes("bundle.remote.acceptanceRecords.total") &&
    diagnosticBundleTestSource.includes("bundle.remote.acceptanceRunbooks.total") &&
    apiAuthTestSource.includes("diagnosticBundle.release.artifactCount") &&
    adminRoutesSource.includes("releaseArtifactCount")
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
  if (
    clientStateSource.includes("publicClientState") &&
    clientStateSource.includes("SENSITIVE_CLIENT_STATE_KEY") &&
    clientStateSource.includes("redactClientStateString") &&
    clientStateSource.includes("SENSITIVE_CLIENT_QUERY_KEY") &&
    stateRoutesSource.includes("publicClientState(state)") &&
    stateRoutesSource.includes("state: publicState") &&
    auditSource.includes("AIzaSy") &&
    auditSource.includes("(?:bind|device)_") &&
    apiAuthTestSource.includes("lifeos_byok_key") &&
    apiAuthTestSource.includes("state-secret-token")
  ) pass("client state API responses and realtime broadcasts redact sensitive values");
  else warn("client state API responses or realtime broadcasts may expose sensitive values");
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
  if (
    appSecretsSource.includes("gemini") &&
    appSecretsSource.includes("openai") &&
    appSecretsSource.includes("openrouter") &&
    appSecretsSource.includes("local") &&
    appSecretsSource.includes("normalizeProviderCredential") &&
    appSecretsSource.includes("getActiveAiProviderId") &&
    appSecretsSource.includes("saveActiveAiProvider") &&
    appSecretsSource.includes("Local model endpoint must not contain credentials, query strings, or fragments") &&
    chatRuntimeSettingsSource.includes("lifeos_active_ai_provider") &&
    chatRuntimeSettingsSource.includes("providerId") &&
    chatRuntimeSettingsSource.includes("readLocalRuntimeValue") &&
    chatRuntimeSettingsSource.includes("lifeos_proxy_nodes") &&
    !chatRuntimeSettingsSource.includes('getClientState("lifeos_model_engine", localStorage.getItem') &&
    aiKeyPanelSource.includes("listAiProviders") &&
    aiKeyPanelSource.includes("saveAiProviderKey") &&
    aiKeyPanelSource.includes("updateActiveAiProvider") &&
    aiKeyPanelSource.includes("updateAiProviderModel") &&
    aiKeyPanelSource.includes("testAiProvider") &&
    aiKeyPanelSource.includes("aiKey.defaultProviderTitle") &&
    aiKeyPanelSource.includes("aiKey.setDefault") &&
    translationsSource.includes("aiKey.defaultProviderTitle") &&
    translationsSource.includes("aiKey.setDefault") &&
    adminRoutesSource.includes("ai_provider_default_updated") &&
    apiAuthTestSource.includes("file:///tmp/ollama.sock") &&
    apiAuthTestSource.includes("endpoint-secret") &&
    apiAuthTestSource.includes("ai_provider_default_updated") &&
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
    adminRoutesSource.includes("migrationRecommended") &&
    adminRoutesSource.includes("fallbackActive") &&
    deviceRoutesSource.includes("previousCredentialExpiresAt") &&
    deviceRoutesSource.includes("rotatedAt") &&
    backupRoutesSourceForAudit.includes("backupPreviewAuditSummary") &&
    backupRoutesSourceForAudit.includes("tableCount") &&
    backupRoutesSourceForAudit.includes("rowTotal") &&
    backupRoutesSourceForAudit.includes("encryption") &&
    apiAuthTestSource.includes("previousCredentialExpiresAt") &&
    apiAuthTestSource.includes("secureStorage.label") &&
    apiAuthTestSource.includes("encryptedExportAudit.metadata.encryption")
  ) pass("high-risk AI key, device, and backup actions include detailed redacted audit metadata");
  else warn("high-risk AI key, device, or backup audit metadata is too shallow or lacks tests");

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
  const lifeosApiSource = exists("src/services/lifeosApi.ts") ? fs.readFileSync(path.join(rootDir, "src/services/lifeosApi.ts"), "utf8") : "";
  const backupRestorePanelSource = exists("src/pages/admin/settings/BackupRestorePanel.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/BackupRestorePanel.tsx"), "utf8") : "";
  const backupListSource = exists("src/pages/admin/settings/BackupList.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/BackupList.tsx"), "utf8") : "";
  const backupPreviewCardSource = exists("src/pages/admin/settings/BackupPreviewCard.tsx") ? fs.readFileSync(path.join(rootDir, "src/pages/admin/settings/BackupPreviewCard.tsx"), "utf8") : "";
  const backupRestoreUiSource = exists("src/services/backupRestoreUi.ts") ? fs.readFileSync(path.join(rootDir, "src/services/backupRestoreUi.ts"), "utf8") : "";
  const backupRestoreUiTestSource = exists("tests/backup-restore-ui.test.mjs") ? fs.readFileSync(path.join(rootDir, "tests/backup-restore-ui.test.mjs"), "utf8") : "";
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
    backupRoutesSource.includes('app.post("/api/v1/data/cleanup/preview"') &&
    backupRoutesSource.includes("data_cleanup_previewed") &&
    lifeosApiSource.includes("previewDataCleanup") &&
    backupRestorePanelSource.includes("previewDataCleanup") &&
    backupRestorePanelSource.includes("backup.previewCleanup") &&
    translationsSource.includes("backup.previewCleanup") &&
    backupRestorePanelSource.includes("cleanupPreview") &&
    backupRestoreUiSource.includes("formatCleanupSummary") &&
    backupRestoreUiSource.includes("Estimated cleanup") &&
    backupRestorePanelSource.includes("buildCleanupConfirmMessage") &&
    backupRestoreTestSource.includes("/api/v1/data/cleanup/preview") &&
    apiAuthTestSource.includes("data_cleanup_previewed")
  ) pass("data cleanup has dry-run preview across API, UI, audit, and tests");
  else warn("data cleanup lacks dry-run preview coverage across API, UI, audit, or tests");

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
  if (desktopMain.includes("onboardingRequired") && desktopMain.includes("nextPath") && desktopMain.includes("First-run guide pending")) pass("desktop diagnostic captures first-launch onboarding routing state");
  else warn("desktop diagnostic does not capture first-launch onboarding routing state");
  if (
    desktopSmokeTestSource.includes("/api/v1/admin/setup") &&
    desktopSmokeTestSource.includes("authenticatedStatus.onboardingRequired") &&
    desktopSmokeTestSource.includes('"/admin/onboarding"')
  ) pass("desktop smoke verifies first-launch setup routes into onboarding");
  else warn("desktop smoke does not verify setup-to-onboarding routing");
  if (desktopMain.includes("refreshDesktopShellStatus") && desktopMain.includes("desktopShell: publicDesktopShellStatus()") && desktopMain.includes("Refresh Status")) pass("desktop tray exposes refreshed health/admin/AI/device status");
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

  if (exists("docs/release-checklist.md")) {
    const checklist = fs.readFileSync(path.join(rootDir, "docs/release-checklist.md"), "utf8");
    const requiredChecklistMarkers = [
      "unsigned",
      "signed",
      "npm run desktop:release:smoke",
      "LIFEOS_UPDATE_URL",
      "release/update-feed/",
      "latest*.yml",
      "release-manifest.json",
      "CSC_LINK",
      "CSC_KEY_PASSWORD",
      "APPLE_ID",
      "APPLE_TEAM_ID",
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
