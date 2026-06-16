import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function electronBinaryPath() {
  if (process.platform === "darwin") return path.join(rootDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
  if (process.platform === "win32") return path.join(rootDir, "node_modules", "electron", "dist", "electron.exe");
  return path.join(rootDir, "node_modules", "electron", "dist", "electron");
}

async function waitForHealth(port, child, output) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (child.exitCode !== null) throw new Error(`desktop exited early with code ${child.exitCode}\n${output.join("")}`);
    const outputText = output.join("");
    const reportedPort = Number(outputText.match(/Server running on http:\/\/127\.0\.0\.1:(\d+)/)?.[1]);
    const ports = Array.from(new Set([port, Number.isFinite(reportedPort) ? reportedPort : 0].filter(Boolean)));
    for (const candidatePort of ports) {
      try {
        const response = await fetch(`http://127.0.0.1:${candidatePort}/api/v1/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) return { health: await response.json(), port: candidatePort };
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`desktop did not expose health endpoint in time\n${output.join("")}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const fallback = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1500);
    child.once("exit", () => {
      clearTimeout(fallback);
      resolve();
    });
  });
}

async function cleanupDir(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

async function waitForFileMatch(file, pattern, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await readFile(file, "utf8");
      if (pattern.test(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${pattern} in ${file}`);
}

function cookieHeader(response) {
  const cookies = response.headers.getSetCookie?.() || [];
  return {
    Cookie: cookies.map((cookie) => cookie.split(";")[0]).join("; "),
  };
}

test("Electron desktop starts the local core and exposes admin health", async (t) => {
  const port = 6310 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-smoke-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-user-data-"));
  const child = spawn(electronBinaryPath(), ["desktop/main.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      LIFEOS_PORT: String(port),
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ADMIN_PASSWORD: "",
      LIFEOS_DESKTOP_USER_DATA_DIR: userDataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    await stop(child);
    await cleanupDir(dataDir);
    await cleanupDir(userDataDir);
  });

  const { health, port: actualPort } = await waitForHealth(port, child, output);
  assert.equal(health.ok, true);
  assert.equal(health.host, "127.0.0.1");
  assert.equal(health.networkMode, "local");

  const status = await fetch(`http://127.0.0.1:${actualPort}/api/v1/admin/status`).then((response) => response.json());
  assert.equal(status.configured, false);
  assert.equal(status.authenticated, false);
  assert.equal(status.onboardingRequired, null);
  assert.equal(status.nextPath, null);

  const loginPage = await fetch(`http://127.0.0.1:${actualPort}/admin/login`).then((response) => response.text());
  assert.match(loginPage, /LifeOS AI/);
  const mobilePairPageResponse = await fetch(`http://127.0.0.1:${actualPort}/mobile/pair?token=bind_desktop_install_smoke_123`);
  assert.equal(mobilePairPageResponse.status, 200);
  assert.match(mobilePairPageResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(mobilePairPageResponse.headers.get("set-cookie") || "", /lifeos_pairing_intent=bind_desktop_install_smoke_123/);
  const mobilePairPage = await mobilePairPageResponse.text();
  assert.match(mobilePairPage, /href="\/manifest\.webmanifest\?pairingToken=bind_desktop_install_smoke_123"/);
  const mobileInstallIntent = await fetch(`http://127.0.0.1:${actualPort}/api/v1/mobile/pairing-intent`, {
    headers: { Cookie: "lifeos_pairing_intent=bind_desktop_install_smoke_123" },
  }).then((response) => response.json());
  assert.deepEqual(mobileInstallIntent, { token: "bind_desktop_install_smoke_123" });
  const entryScript = loginPage.match(/<script[^>]+src="([^"]+)"/)?.[1];
  assert.ok(entryScript, "desktop login page should load the production app bundle");
  const shellBaseHref = loginPage.match(/<base\s+href="([^"]+)"/)?.[1] || "/";
  const shellBaseUrl = new URL(shellBaseHref, `http://127.0.0.1:${actualPort}/`).toString();
  const appBundleUrl = new URL(entryScript, shellBaseUrl).toString();
  const appBundle = await fetch(appBundleUrl).then((response) => response.text());
  const loginChunk = appBundle.match(/(?:\.\/)?AdminLoginPage-[A-Za-z0-9_-]+\.js/)?.[0];
  const onboardingChunk = appBundle.match(/(?:\.\/)?AdminOnboardingPage-[A-Za-z0-9_-]+\.js/)?.[0];
  assert.ok(loginChunk, "desktop app bundle should reference the admin login chunk");
  assert.ok(onboardingChunk, "desktop app bundle should reference the first-launch onboarding chunk");
  const loginBundle = await fetch(new URL(loginChunk, appBundleUrl)).then((response) => response.text());
  assert.match(loginBundle, /auth\.firstRunGuide/);
  assert.match(loginBundle, /auth\.firstRunStep1/);
  assert.match(loginBundle, /auth\.firstRunStep2/);
  assert.match(loginBundle, /auth\.firstRunStep3/);
  assert.match(loginBundle, /onboardingRequired/);
  const onboardingBundle = await fetch(new URL(onboardingChunk, appBundleUrl)).then((response) => response.text());
  assert.match(onboardingBundle, /onboarding\.title/);
  assert.match(onboardingBundle, /onboarding\.securityCheck/);
  assert.match(onboardingBundle, /onboarding\.defaultProvider/);
  assert.match(onboardingBundle, /onboarding\.setDefault/);
  assert.match(onboardingBundle, /onboarding\.backupTitle/);
  assert.match(onboardingBundle, /onboarding\.createBackup/);
  assert.match(onboardingBundle, /onboarding\.enableDailyBackup/);
  assert.match(onboardingBundle, /onboarding\.backupScheduleOn/);
  assert.match(onboardingBundle, /onboarding\.dailyBackupEnabled/);
  assert.match(onboardingBundle, /onboarding\.mobileTitle/);
  assert.match(onboardingBundle, /onboarding\.openConnectionGuide/);
  assert.match(onboardingBundle, /\/admin\/settings#mobile-connect/);
  assert.match(onboardingBundle, /onboarding\.finish/);
  assert.match(onboardingBundle, /onboarding\.doneStatus/);

  const setupResponse = await fetch(`http://127.0.0.1:${actualPort}/api/v1/admin/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "desktop-onboarding-secret" }),
  });
  assert.equal(setupResponse.status, 200);
  const setup = await setupResponse.json();
  assert.equal(setup.onboardingRequired, true);
  assert.equal(setup.nextPath, "/admin/onboarding");
  const authenticatedStatus = await fetch(`http://127.0.0.1:${actualPort}/api/v1/admin/status`, {
    headers: cookieHeader(setupResponse),
  }).then((response) => response.json());
  assert.equal(authenticatedStatus.configured, true);
  assert.equal(authenticatedStatus.authenticated, true);
  assert.equal(authenticatedStatus.onboardingRequired, true);
  assert.equal(authenticatedStatus.nextPath, "/admin/onboarding");
});

test("Electron desktop loads saved connection config before starting local core", async (t) => {
  const port = 7610 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-runtime-config-data-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-runtime-config-user-"));
  await mkdir(path.join(userDataDir, "data"), { recursive: true });
  await writeFile(path.join(userDataDir, "data", "desktop-runtime-config.json"), `${JSON.stringify({
    mode: "cloudflare",
    label: "Cloudflare Desktop Smoke",
    host: "0.0.0.0",
    port,
    publicBaseUrl: "https://desktop-smoke.example.com",
    allowPublic: true,
    baseUrl: "https://desktop-smoke.example.com",
    updatedAt: Date.now(),
  }, null, 2)}\n`);
  const child = spawn(electronBinaryPath(), ["desktop/main.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      LIFEOS_PORT: "",
      LIFEOS_HOST: "",
      LIFEOS_DATA_DIR: dataDir,
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ALLOW_PUBLIC: "",
      LIFEOS_ADMIN_PASSWORD: "",
      LIFEOS_DESKTOP_USER_DATA_DIR: userDataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    await stop(child);
    await cleanupDir(dataDir);
    await cleanupDir(userDataDir);
  });

  const { health, port: actualPort } = await waitForHealth(port, child, output);
  assert.equal(actualPort, port);
  assert.equal(health.host, "0.0.0.0");
  assert.equal(health.networkMode, "lan");
  assert.equal(health.publicBaseUrl, "https://desktop-smoke.example.com");
  assert.equal(health.publicAccessAllowed, true);
});

test("Electron desktop autostarts saved Tailscale HTTPS Serve config", async (t) => {
  const port = 7710 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-tailscale-data-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-tailscale-user-"));
  const binDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-tailscale-bin-"));
  const commandLog = path.join(binDir, "tailscale.log");
  await mkdir(path.join(userDataDir, "data"), { recursive: true });
  await writeFile(path.join(userDataDir, "data", "desktop-runtime-config.json"), `${JSON.stringify({
    mode: "tailscale",
    label: "Tailscale Desktop Smoke",
    host: "127.0.0.1",
    port,
    publicBaseUrl: "https://lifeos-mac.tailnet.example.ts.net",
    allowPublic: true,
    baseUrl: "https://lifeos-mac.tailnet.example.ts.net",
    updatedAt: Date.now(),
  }, null, 2)}\n`);
  const tailscalePath = path.join(binDir, "tailscale-mock.mjs");
  await writeFile(tailscalePath, `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(commandLog)}, args.join(" ") + "\\n");
if (args[0] === "version") {
  console.log("1.66.4");
  process.exit(0);
}
if (args[0] === "status") {
  console.log(JSON.stringify({ Self: { Online: true, HostName: "lifeos-mac", TailscaleIPs: ["100.64.0.10"] }, MagicDNSSuffix: "tailnet.example.ts.net" }));
  process.exit(0);
}
if (args[0] === "serve" && args[1] === "status") {
  console.log("{}");
  process.exit(0);
}
if (args[0] === "serve") {
  console.log("ok");
  process.exit(0);
}
process.exit(1);
`);

  const child = spawn(electronBinaryPath(), ["desktop/main.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      LIFEOS_PORT: "",
      LIFEOS_HOST: "",
      LIFEOS_DATA_DIR: dataDir,
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ALLOW_PUBLIC: "",
      LIFEOS_ADMIN_PASSWORD: "",
      LIFEOS_DESKTOP_USER_DATA_DIR: userDataDir,
      LIFEOS_TAILSCALE_BIN: process.execPath,
      LIFEOS_TAILSCALE_BIN_ARGS: JSON.stringify([tailscalePath]),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    await stop(child);
    await cleanupDir(dataDir);
    await cleanupDir(userDataDir);
    await cleanupDir(binDir);
  });

  const { health, port: actualPort } = await waitForHealth(port, child, output);
  assert.equal(actualPort, port);
  assert.equal(health.host, "127.0.0.1");
  assert.equal(health.publicBaseUrl, "https://lifeos-mac.tailnet.example.ts.net");
  assert.equal(health.publicAccessAllowed, true);
  const log = await waitForFileMatch(commandLog, /serve --bg https:443 http:\/\/127\.0\.0\.1:/);
  assert.match(log, new RegExp(`serve --bg https:443 http://127\\.0\\.0\\.1:${actualPort}`));
});

test("Electron desktop exports a redacted desktop diagnostic bundle", async (t) => {
  const port = 6810 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-diagnostic-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-user-data-"));
  const diagnosticPath = path.join(dataDir, "desktop-diagnostics.json");
  const releaseDir = path.join(dataDir, "release");
  const artifactSha256 = "a".repeat(64);
  await mkdir(path.join(releaseDir, "update-feed"), { recursive: true });
  await writeFile(path.join(releaseDir, "SHA256SUMS"), `${artifactSha256}  LifeOS AI-0.0.0-arm64-unsigned.zip\n`);
  await writeFile(path.join(releaseDir, "update-feed", "release-manifest.json"), `${JSON.stringify({
    version: "0.0.0",
    generatedAt: new Date(0).toISOString(),
    artifacts: [{
      platform: "mac",
      feedFile: "latest-mac.yml",
      fileName: "LifeOS AI-0.0.0-arm64-unsigned.zip",
      size: 123456,
      sha512: "fake-sha512",
      sha256: artifactSha256,
      releaseDate: new Date(0).toISOString(),
    }],
  }, null, 2)}\n`);
  const child = spawn(electronBinaryPath(), ["desktop/main.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      LIFEOS_PORT: String(port),
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_ADMIN_PASSWORD: "",
      LIFEOS_DESKTOP_USER_DATA_DIR: userDataDir,
      LIFEOS_UPDATE_URL: "https://updates.example.com/lifeos-ai?token=should-not-leak",
      LIFEOS_RELEASE_DIR: releaseDir,
      LIFEOS_DESKTOP_EXPORT_DIAGNOSTIC_ON_START: diagnosticPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    await stop(child);
    await cleanupDir(dataDir);
    await cleanupDir(userDataDir);
  });

  const { health, port: actualPort } = await waitForHealth(port, child, output);
  assert.equal(health.ok, true);

  const startedAt = Date.now();
  let diagnostics = null;
  while (Date.now() - startedAt < 10_000) {
    try {
      diagnostics = JSON.parse(await readFile(diagnosticPath, "utf8"));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!diagnostics) throw new Error(`desktop diagnostics were not exported\n${output.join("")}`);

  assert.equal(diagnostics.localCore.port, actualPort);
  assert.equal(diagnostics.localCore.health.ok, true);
  assert.equal(diagnostics.localCore.health.service, "lifeos-local-core");
  assert.equal(diagnostics.localCore.health.networkMode, "local");
  assert.equal(diagnostics.localCore.health.publicBaseUrlConfigured, false);
  assert.equal(diagnostics.localCore.health.adminConfigured, false);
  assert.equal(diagnostics.localCore.adminStatus.configured, false);
  assert.equal(diagnostics.localCore.adminStatus.authenticated, false);
  assert.equal(diagnostics.localCore.adminStatus.envManaged, false);
  assert.equal(diagnostics.localCore.adminStatus.onboardingRequired, null);
  assert.equal(diagnostics.localCore.adminStatus.nextPath, null);
  assert.equal(diagnostics.desktopShell.trayAvailable, true);
  assert.equal(diagnostics.desktopShell.core, "healthy");
  assert.match(diagnostics.desktopShell.coreLabel, /本地核心正常|Local core healthy/);
  assert.match(diagnostics.desktopShell.adminLabel, /管理员未设置|Admin not configured/);
  assert.match(diagnostics.desktopShell.aiLabel, /AI 未配置|AI not configured/);
  assert.match(diagnostics.desktopShell.deviceLabel, /^(设备|Devices) \d+\/\d+ (在线|online)$/);
  assert.match(diagnostics.desktopShell.url, new RegExp(`^http://127\\.0\\.0\\.1:${actualPort}/admin/login`));
  assert.ok(diagnostics.mainWindow);
  assert.match(diagnostics.mainWindow.url, new RegExp(`^http://127\\.0\\.0\\.1:${actualPort}/admin/login`));
  assert.equal(diagnostics.mainWindow.visible, true);
  assert.equal(diagnostics.updates.configured, true);
  assert.equal(diagnostics.updates.updateUrlHost, "updates.example.com");
  assert.equal(diagnostics.release.manifestAvailable, true);
  assert.equal(diagnostics.release.checksumAvailable, true);
  assert.equal(diagnostics.release.version, "0.0.0");
  assert.equal(diagnostics.release.artifactCount, 1);
  assert.deepEqual(diagnostics.release.artifacts[0], {
    platform: "mac",
    fileName: "LifeOS AI-0.0.0-arm64-unsigned.zip",
    feedFile: "latest-mac.yml",
    size: 123456,
    sha512Present: true,
    sha256: artifactSha256,
    releaseDate: new Date(0).toISOString(),
  });
  assert.equal(diagnostics.logs.fileName, "lifeos-desktop.log");
  assert.equal(diagnostics.logs.directoryAvailable, true);
  assert.match(diagnostics.logs.directoryLabel, /系统日志目录已配置，可从桌面菜单打开|System log directory is configured/);
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("should-not-leak"), false);
  assert.equal(serialized.includes("dataDir=/"), false);
  assert.equal(serialized.includes("/Users/"), false);
  assert.equal(serialized.includes(dataDir), false);
});

test("Electron desktop keeps a startup failure window open when local core fails", async (t) => {
  const port = 7310 + Math.floor(Math.random() * 1000);
  const dataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-failure-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "lifeos-desktop-user-data-"));
  const child = spawn(electronBinaryPath(), ["desktop/main.cjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      LIFEOS_PORT: String(port),
      LIFEOS_DATA_DIR: dataDir,
      LIFEOS_HOST: "127.0.0.1",
      PUBLIC_BASE_URL: "",
      APP_URL: "",
      LIFEOS_DESKTOP_USER_DATA_DIR: userDataDir,
      LIFEOS_DESKTOP_FORCE_CORE_FAILURE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  t.after(async () => {
    await stop(child);
    await cleanupDir(dataDir);
    await cleanupDir(userDataDir);
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(child.exitCode, null, `desktop should stay open with failure window\n${output.join("")}`);
  const desktopMain = await readFile(path.join(rootDir, "desktop", "main.cjs"), "utf8");
  assert.match(desktopMain, /Retry LifeOS AI/);
  assert.match(desktopMain, /Open Local Console In Browser/);
  assert.match(desktopMain, /Copy Local Address/);
  assert.match(desktopMain, /Export Desktop Diagnostics/);
  assert.match(desktopMain, /Open Logs Folder/);
  assert.match(desktopMain, /Copy Logs Path/);
});
