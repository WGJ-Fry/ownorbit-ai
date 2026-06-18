const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

let mainWindow;
let tray;
let trayRefreshTimer;
let serverPort = 3000;
let desktopLogPath = "";
let desktopShellStatus = {
  core: "starting",
  coreLabel: "Local core starting",
  adminLabel: "Admin status unknown",
  aiLabel: "AI status unknown",
  deviceLabel: "Device status unknown",
  url: "",
  updatedAt: null,
};
let shutdownRequested = false;
const chromiumUnsafePorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

if (process.env.LIFEOS_DESKTOP_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.LIFEOS_DESKTOP_USER_DATA_DIR));
}

function writeDesktopLog(message, details) {
  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${details}` : ""}\n`;
  if (!desktopLogPath) {
    console.log(line.trim());
    return;
  }
  fs.mkdirSync(path.dirname(desktopLogPath), { recursive: true });
  fs.appendFileSync(desktopLogPath, line);
}

function localUrl(pathname = "/admin/login") {
  return `http://127.0.0.1:${serverPort}${pathname}`;
}

async function loadDesktopWindow(targetWindow, pathname, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await waitForEndpoint(localUrl(pathname), {
        attempts: 8,
        description: `LifeOS page ${pathname} did not become available in time.`,
        validate: (res, body) => res.statusCode === 200 && /LifeOS AI/i.test(body || ""),
      });
      await targetWindow.loadURL(localUrl(pathname));
      return;
    } catch (error) {
      lastError = error;
      writeDesktopLog("Failed to load desktop window", `path=${pathname} attempt=${attempt} error=${error?.message || String(error)}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  }
  throw lastError || new Error(`Failed to load ${pathname}`);
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findOpenPort(startPort) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      if (chromiumUnsafePorts.has(port)) {
        tryPort(port + 1);
        return;
      }
      const tester = net.createServer();
      tester.once("error", () => tryPort(port + 1));
      tester.once("listening", () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, "127.0.0.1");
    };
    tryPort(startPort);
  });
}

function normalizeDesktopRuntimeConfig(config) {
  if (!config || typeof config !== "object") return null;
  const mode = String(config.mode || "");
  if (!["configured", "cloudflare", "tailscale", "lan", "local"].includes(mode)) return null;
  const host = config.host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = Number.parseInt(String(config.port || ""), 10);
  const publicBaseUrl = String(config.publicBaseUrl || "").trim();
  return {
    mode,
    host,
    port: Number.isFinite(port) && port >= 1024 && port <= 65535 ? port : 3000,
    publicBaseUrl: /^https?:\/\//i.test(publicBaseUrl) ? publicBaseUrl : "",
    allowPublic: Boolean(config.allowPublic),
  };
}

function applyDesktopRuntimeConfig() {
  const configPath = path.join(app.getPath("userData"), "data", "desktop-runtime-config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = normalizeDesktopRuntimeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
    if (!config) return null;
    process.env.LIFEOS_HOST = process.env.LIFEOS_HOST || config.host;
    process.env.LIFEOS_PORT = process.env.LIFEOS_PORT || String(config.port);
    if (config.publicBaseUrl && !process.env.PUBLIC_BASE_URL && !process.env.APP_URL) {
      process.env.PUBLIC_BASE_URL = config.publicBaseUrl;
    }
    if (config.allowPublic && !process.env.LIFEOS_ALLOW_PUBLIC) {
      process.env.LIFEOS_ALLOW_PUBLIC = "1";
    }
    writeDesktopLog("Loaded desktop runtime config", `mode=${config.mode} host=${process.env.LIFEOS_HOST} port=${process.env.LIFEOS_PORT || ""} publicBaseUrlConfigured=${Boolean(process.env.PUBLIC_BASE_URL || process.env.APP_URL)}`);
    return config;
  } catch (error) {
    writeDesktopLog("Failed to load desktop runtime config", error?.message || String(error));
    return null;
  }
}

function waitForHealth(port, attempts = 60) {
  return waitForEndpoint(`http://127.0.0.1:${port}/api/v1/health`, {
    attempts,
    description: "LifeOS local server did not start in time.",
    validate: (res, body) => {
      if (res.statusCode !== 200) return false;
      try {
        const payload = JSON.parse(body || "{}");
        return payload?.ok === true && payload?.service === "lifeos-local-core";
      } catch {
        return false;
      }
    },
  });
}

function waitForAdminShell(port, attempts = 60) {
  return waitForEndpoint(`http://127.0.0.1:${port}/admin/login`, {
    attempts,
    description: "LifeOS admin console did not become available in time.",
    validate: (res, body) => res.statusCode === 200 && /LifeOS AI/i.test(body || "") && /<script/i.test(body || ""),
  });
}

function waitForEndpoint(url, options = {}) {
  const attempts = Number.isFinite(Number(options.attempts)) ? Number(options.attempts) : 60;
  const description = options.description || "Endpoint did not respond in time.";
  const validate = typeof options.validate === "function" ? options.validate : ((res) => res.statusCode === 200);
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const req = http.get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 200_000) req.destroy(new Error("response too large"));
        });
        res.on("end", () => {
          if (validate(res, body)) {
            resolve(true);
            return;
          }
          retry(remaining);
        });
      });
      req.setTimeout(1500, () => req.destroy(new Error("timeout")));
      req.on("error", () => retry(remaining));
    };

    const retry = (remaining) => {
      if (remaining <= 0) {
        reject(new Error(description));
        return;
      }
      setTimeout(() => check(remaining - 1), 250);
    };

    check(attempts);
  });
}

async function startLocalCore() {
  desktopLogPath = path.join(app.getPath("logs"), "lifeos-desktop.log");
  process.env.LIFEOS_DATA_DIR = path.join(app.getPath("userData"), "data");
  applyDesktopRuntimeConfig();
  serverPort = await findOpenPort(Number(process.env.LIFEOS_PORT || 3000));
  process.env.NODE_ENV = "production";
  process.env.LIFEOS_PORT = String(serverPort);
  process.env.LIFEOS_DEVICE_NAME = process.env.LIFEOS_DEVICE_NAME || `${app.getName()} Desktop`;

  const appPath = app.isPackaged ? app.getAppPath() : process.cwd();
  const runtimeCwd = app.isPackaged ? path.dirname(appPath) : appPath;
  process.chdir(runtimeCwd);
  writeDesktopLog("Starting LifeOS local core", `port=${serverPort} dataDirConfigured=${Boolean(process.env.LIFEOS_DATA_DIR)} packaged=${app.isPackaged}`);
  if (process.env.LIFEOS_DESKTOP_FORCE_CORE_FAILURE === "1") {
    throw new Error("Forced desktop startup failure for smoke testing.");
  }
  require(path.join(appPath, "dist", "server.cjs"));
  await waitForHealth(serverPort);
  await waitForAdminShell(serverPort);
  writeDesktopLog("LifeOS local core is healthy", localUrl("/api/v1/health"));
  writeDesktopLog("LifeOS admin console shell is ready", localUrl("/admin/login"));
}

function showMainWindow(pathname = "/admin/login") {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(pathname).catch((error) => writeDesktopLog("Failed to create desktop window", error?.message || String(error)));
    return;
  }
  loadDesktopWindow(mainWindow, pathname).catch((error) => writeDesktopLog("Failed to reload desktop window", error?.message || String(error)));
  mainWindow.show();
  mainWindow.focus();
}

async function resolvePreferredAdminPath(fallbackPath = "/admin/login") {
  const adminStatusResult = await fetchLocalJson("/api/v1/admin/status");
  if (!adminStatusResult.ok || !adminStatusResult.body) return fallbackPath;
  const status = publicAdminStatusSnapshot(adminStatusResult.body);
  if (!status?.configured) return "/admin/login";
  if (status.authenticated && status.nextPath) return status.nextPath;
  if (status.onboardingRequired && status.nextPath) return status.nextPath;
  if (fallbackPath === "/admin/dashboard") return status.nextPath || "/admin/dashboard";
  return fallbackPath;
}

async function showPreferredAdminWindow(fallbackPath = "/admin/login") {
  const pathname = await resolvePreferredAdminPath(fallbackPath).catch(() => fallbackPath);
  showMainWindow(pathname);
}

async function createWindow(pathname = "/admin/login") {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "LifeOS AI",
    backgroundColor: "#060a10",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.isPackaged ? app.getAppPath() : process.cwd(), "desktop", "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  await loadDesktopWindow(mainWindow, pathname);
  return mainWindow;
}

function openLogsFolder() {
  shell.openPath(path.dirname(desktopLogPath)).catch((error) => {
    writeDesktopLog("Failed to open logs folder", error?.message || String(error));
  });
}

function openLocalConsoleInBrowser(pathname = "/admin/login") {
  const target = localUrl(pathname);
  shell.openExternal(target).catch((error) => {
    writeDesktopLog("Failed to open local console in browser", error?.message || String(error));
  });
  return target;
}

function copyLogsPath() {
  const logsDir = desktopLogPath ? path.dirname(desktopLogPath) : app.getPath("logs");
  clipboard.writeText(logsDir);
  return logsDir;
}

function redactDiagnosticText(value) {
  return String(value)
    .replace(/(lifeos_admin_session|lifeos_csrf|authorization|cookie|token|api[-_]?key|password|secret)=?[^\s,;"]*/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/dataDir=[^\s,;"]+/gi, "dataDir=[redacted]")
    .replace(/\/Users\/[^\s,;"]+/g, "[local-path]")
    .replace(/[A-Za-z]:\\[^\s,;"]+/g, "[local-path]");
}

function readLogTail(maxLines = 80) {
  if (!desktopLogPath || !fs.existsSync(desktopLogPath)) return [];
  return fs.readFileSync(desktopLogPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines)
    .map(redactDiagnosticText);
}

function fetchLocalJson(pathname) {
  return new Promise((resolve) => {
    const req = http.get(localUrl(pathname), (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 200_000) req.destroy(new Error("response too large"));
      });
      res.on("end", () => {
        try {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            body: body ? JSON.parse(body) : null,
          });
        } catch (error) {
          resolve({ ok: false, status: res.statusCode || 0, error: "invalid json" });
        }
      });
    });
    req.setTimeout(1500, () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ ok: false, status: 0, error: error?.message || "request failed" }));
  });
}

function publicHealthSnapshot(health) {
  if (!health || typeof health !== "object") return null;
  return {
    ok: Boolean(health.ok),
    service: health.service || "",
    version: health.version || "",
    deviceCount: Number.isFinite(Number(health.deviceCount)) ? Number(health.deviceCount) : 0,
    onlineDeviceCount: Number.isFinite(Number(health.onlineDeviceCount)) ? Number(health.onlineDeviceCount) : 0,
    aiConfigured: Boolean(health.aiConfigured),
    adminConfigured: Boolean(health.adminConfigured),
    host: health.host || "",
    networkMode: health.networkMode || "",
    publicBaseUrlConfigured: Boolean(health.publicBaseUrl),
    publicAccessWarning: Boolean(health.publicAccessWarning),
    publicAccessAllowed: Boolean(health.publicAccessAllowed),
    publicSetupRisk: Boolean(health.publicSetupRisk),
    timestamp: health.timestamp || null,
  };
}

function publicAdminStatusSnapshot(status) {
  if (!status || typeof status !== "object") return null;
  return {
    configured: Boolean(status.configured),
    authenticated: Boolean(status.authenticated),
    envManaged: Boolean(status.envManaged),
    onboardingRequired: status.onboardingRequired === null || status.onboardingRequired === undefined ? null : Boolean(status.onboardingRequired),
    nextPath: typeof status.nextPath === "string" ? status.nextPath : null,
  };
}

function summarizeDesktopShellStatus(health, adminStatus) {
  const deviceCount = Number.isFinite(Number(health?.deviceCount)) ? Number(health.deviceCount) : 0;
  const onlineDeviceCount = Number.isFinite(Number(health?.onlineDeviceCount)) ? Number(health.onlineDeviceCount) : 0;
  const adminLabel = adminStatus?.configured
    ? adminStatus.onboardingRequired
      ? "First-run guide pending"
      : "Admin configured"
    : "Admin not configured";
  return {
    core: health?.ok ? "healthy" : "unreachable",
    coreLabel: health?.ok ? `Local core healthy · ${health.networkMode === "lan" ? "LAN" : "Local"}` : "Local core unreachable",
    adminLabel,
    aiLabel: health?.aiConfigured ? "AI configured" : "AI not configured",
    deviceLabel: `Devices ${onlineDeviceCount}/${deviceCount} online`,
    url: localUrl("/admin/login"),
    updatedAt: Date.now(),
  };
}

function publicDesktopShellStatus() {
  return {
    trayAvailable: Boolean(tray),
    core: desktopShellStatus.core,
    coreLabel: desktopShellStatus.coreLabel,
    adminLabel: desktopShellStatus.adminLabel,
    aiLabel: desktopShellStatus.aiLabel,
    deviceLabel: desktopShellStatus.deviceLabel,
    url: desktopShellStatus.url || localUrl("/admin/login"),
    updatedAt: desktopShellStatus.updatedAt,
  };
}

function releaseDirCandidates() {
  return Array.from(new Set([
    process.env.LIFEOS_RELEASE_DIR ? path.resolve(process.env.LIFEOS_RELEASE_DIR) : "",
    path.join(process.cwd(), "release"),
    path.join(process.cwd(), "..", "release"),
  ].filter(Boolean)));
}

function publicReleaseArtifactSummary(artifact) {
  return {
    platform: typeof artifact?.platform === "string" ? artifact.platform : "",
    fileName: artifact?.fileName ? path.basename(String(artifact.fileName)) : "",
    feedFile: artifact?.feedFile ? path.basename(String(artifact.feedFile)) : "",
    size: Number.isFinite(Number(artifact?.size)) ? Number(artifact.size) : 0,
    sha512Present: typeof artifact?.sha512 === "string" && artifact.sha512.length > 0,
    sha256: typeof artifact?.sha256 === "string" ? artifact.sha256 : "",
    releaseDate: typeof artifact?.releaseDate === "string" ? artifact.releaseDate : "",
  };
}

function readReleaseSnapshot() {
  for (const releaseDir of releaseDirCandidates()) {
    const manifestPath = path.join(releaseDir, "update-feed", "release-manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const checksumPath = path.join(releaseDir, "SHA256SUMS");
      const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts.map(publicReleaseArtifactSummary) : [];
      return {
        manifestAvailable: true,
        checksumAvailable: fs.existsSync(checksumPath),
        version: typeof manifest.version === "string" ? manifest.version : "",
        generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : "",
        artifactCount: artifacts.length,
        artifacts,
      };
    } catch (error) {
      return {
        manifestAvailable: false,
        checksumAvailable: false,
        version: "",
        generatedAt: "",
        artifactCount: 0,
        artifacts: [],
        error: "release manifest is unreadable",
      };
    }
  }
  return {
    manifestAvailable: false,
    checksumAvailable: false,
    version: app.getVersion(),
    generatedAt: "",
    artifactCount: 0,
    artifacts: [],
  };
}

async function createDesktopDiagnosticBundle() {
  const logStat = desktopLogPath && fs.existsSync(desktopLogPath) ? fs.statSync(desktopLogPath) : null;
  const [healthResult, adminStatusResult] = await Promise.all([
    fetchLocalJson("/api/v1/health"),
    fetchLocalJson("/api/v1/admin/status"),
  ]);
  if (healthResult.ok) {
    desktopShellStatus = summarizeDesktopShellStatus(healthResult.body, adminStatusResult.ok ? adminStatusResult.body : null);
  }
  return {
    generatedAt: new Date().toISOString(),
    desktop: {
      appName: app.getName(),
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
    },
    desktopShell: publicDesktopShellStatus(),
    mainWindow: mainWindow && !mainWindow.isDestroyed() ? {
      url: mainWindow.webContents.getURL(),
      visible: mainWindow.isVisible(),
      title: mainWindow.getTitle(),
    } : null,
    localCore: {
      port: serverPort,
      url: localUrl("/admin/login"),
      dataDirConfigured: Boolean(process.env.LIFEOS_DATA_DIR),
      publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL || process.env.APP_URL),
      publicAccessAllowed: process.env.LIFEOS_ALLOW_PUBLIC === "1",
      health: healthResult.ok ? publicHealthSnapshot(healthResult.body) : null,
      healthStatus: healthResult.status,
      healthError: healthResult.ok ? "" : healthResult.error || "",
      adminStatus: adminStatusResult.ok ? publicAdminStatusSnapshot(adminStatusResult.body) : null,
      adminStatusCode: adminStatusResult.status,
      adminStatusError: adminStatusResult.ok ? "" : adminStatusResult.error || "",
    },
    updates: {
      configured: Boolean(process.env.LIFEOS_UPDATE_URL),
      updateUrlHost: process.env.LIFEOS_UPDATE_URL ? (() => {
        try {
          return new URL(process.env.LIFEOS_UPDATE_URL).host;
        } catch {
          return "invalid-url";
        }
      })() : "",
    },
    release: readReleaseSnapshot(),
    logs: {
      fileName: desktopLogPath ? path.basename(desktopLogPath) : "",
      directoryAvailable: Boolean(desktopLogPath),
      directoryLabel: desktopLogPath ? "System log directory is configured and can be opened from the desktop menu" : "System log directory is not initialized",
      size: logStat?.size || 0,
      modifiedAt: logStat?.mtimeMs || null,
      tail: readLogTail(),
    },
  };
}

async function exportDesktopDiagnosticBundle(targetPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let outputPath = targetPath;
  if (!outputPath) {
    const result = await dialog.showSaveDialog({
      title: "Export LifeOS AI Desktop Diagnostic Bundle",
      defaultPath: `lifeos-desktop-diagnostics-${stamp}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    outputPath = result.filePath;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(await createDesktopDiagnosticBundle(), null, 2));
  writeDesktopLog("Desktop diagnostic bundle exported", path.basename(outputPath));
  return outputPath;
}

function showStartupFailureWindow(error) {
  const logsDir = desktopLogPath ? path.dirname(desktopLogPath) : app.getPath("logs");
  const message = error?.stack || error?.message || String(error);
  const failureWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    title: "LifeOS AI Startup Failed",
    backgroundColor: "#060a10",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.isPackaged ? app.getAppPath() : process.cwd(), "desktop", "preload.cjs"),
      sandbox: true,
    },
  });
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>LifeOS AI Startup Failed</title>
    <style>
      body { margin: 0; min-height: 100vh; background: #060a10; color: #e4e4e7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid; place-items: center; }
      main { width: min(640px, calc(100vw - 48px)); border: 1px solid rgba(255,255,255,.08); background: #101722; border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
      h1 { margin: 0; font-size: 24px; }
      p { color: #a1a1aa; line-height: 1.7; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      .path { margin-top: 16px; padding: 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 14px; background: rgba(255,255,255,.04); word-break: break-all; color: #67e8f9; }
      pre { max-height: 180px; overflow: auto; padding: 12px; border-radius: 14px; background: #060a10; border: 1px solid rgba(248,113,113,.2); color: #fecaca; white-space: pre-wrap; }
      .hint { margin-top: 16px; color: #d4d4d8; }
      .actions { margin-top: 18px; display: flex; flex-wrap: wrap; gap: 12px; }
      button { border: 0; border-radius: 14px; padding: 12px 16px; font: inherit; font-weight: 700; cursor: pointer; }
      .primary { background: #f4f4f5; color: #111827; }
      .secondary { background: rgba(255,255,255,.06); color: #e4e4e7; border: 1px solid rgba(255,255,255,.1); }
      .status { margin-top: 14px; min-height: 20px; color: #cbd5e1; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <h1>LifeOS AI local core failed to start</h1>
      <p>The desktop shell opened, but the local service did not start successfully. Open the log directory and inspect <code>lifeos-desktop.log</code>, then restart LifeOS AI after fixing the issue.</p>
      <div class="path">${htmlEscape(logsDir)}</div>
      <p class="hint">Common causes: port already in use, data directory permissions, missing packaged files, or incomplete security environment variables.</p>
      <div class="actions">
        <button class="primary" id="retry">Retry LifeOS AI</button>
        <button class="secondary" id="browser">Open Local Console In Browser</button>
        <button class="secondary" id="copyAddress">Copy Local Address</button>
        <button class="secondary" id="logs">Open Logs Folder</button>
        <button class="secondary" id="copy">Copy Logs Path</button>
        <button class="secondary" id="diagnostics">Export Desktop Diagnostics</button>
      </div>
      <div class="status" id="status">Use the buttons above to recover without leaving this window.</div>
      <pre>${htmlEscape(message)}</pre>
      <script>
        const status = document.getElementById("status");
        const api = window.lifeosDesktopFailure;
        const setStatus = (value) => { status.textContent = value; };
        document.getElementById("retry").addEventListener("click", async () => {
          setStatus("Relaunching LifeOS AI...");
          await api.retryStartup();
        });
        document.getElementById("browser").addEventListener("click", async () => {
          const target = await api.openLocalConsole();
          setStatus("Opened local console: " + target);
        });
        document.getElementById("copyAddress").addEventListener("click", async () => {
          const value = await api.copyLocalAddress();
          setStatus("Copied local address: " + value);
        });
        document.getElementById("logs").addEventListener("click", async () => {
          await api.openLogsFolder();
          setStatus("Opened the logs folder.");
        });
        document.getElementById("copy").addEventListener("click", async () => {
          const value = await api.copyLogsPath();
          setStatus("Copied logs path: " + value);
        });
        document.getElementById("diagnostics").addEventListener("click", async () => {
          const outputPath = await api.exportDiagnostics();
          setStatus(outputPath ? ("Saved desktop diagnostics to " + outputPath) : "Diagnostic export cancelled.");
        });
      </script>
    </main>
  </body>
</html>`;
  failureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return failureWindow;
}

function copyLocalAddress() {
  clipboard.writeText(localUrl("/admin/login"));
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "LifeOS AI", enabled: false },
    { label: desktopShellStatus.coreLabel, enabled: false },
    { label: desktopShellStatus.adminLabel, enabled: false },
    { label: desktopShellStatus.aiLabel, enabled: false },
    { label: desktopShellStatus.deviceLabel, enabled: false },
    { label: `Local port ${serverPort}`, enabled: false },
    { type: "separator" },
    { label: "Open Console", click: () => showPreferredAdminWindow("/admin/dashboard") },
    { label: "Pair Phone", click: () => showMainWindow("/admin/devices/pair") },
    { label: "System Settings", click: () => showMainWindow("/admin/settings") },
    { type: "separator" },
    { label: "Refresh Status", click: () => refreshDesktopShellStatus().catch((error) => writeDesktopLog("Failed to refresh tray status", error?.message || String(error))) },
    { label: "Copy Local Address", click: copyLocalAddress },
    { label: "Export Desktop Diagnostics", click: () => exportDesktopDiagnosticBundle().catch((error) => writeDesktopLog("Failed to export desktop diagnostics", error?.message || String(error))) },
    { label: "Open Logs Folder", click: openLogsFolder },
    { type: "separator" },
    { role: "quit", label: "Quit" },
  ]);
}

function updateTrayPresentation() {
  if (!tray) return;
  tray.setToolTip(`LifeOS AI: ${desktopShellStatus.coreLabel} · ${desktopShellStatus.aiLabel} · ${localUrl("/admin/login")}`);
  tray.setContextMenu(buildTrayMenu());
}

async function refreshDesktopShellStatus() {
  const [healthResult, adminStatusResult] = await Promise.all([
    fetchLocalJson("/api/v1/health"),
    fetchLocalJson("/api/v1/admin/status"),
  ]);
  desktopShellStatus = summarizeDesktopShellStatus(
    healthResult.ok ? healthResult.body : null,
    adminStatusResult.ok ? adminStatusResult.body : null,
  );
  updateTrayPresentation();
  return desktopShellStatus;
}

function buildMenuTemplate() {
  return [
    {
      label: "LifeOS AI",
      submenu: [
        { label: "Open Console", click: () => showPreferredAdminWindow("/admin/dashboard") },
        { label: "Pair Phone", click: () => showMainWindow("/admin/devices/pair") },
        { label: "System Settings", click: () => showMainWindow("/admin/settings") },
        { type: "separator" },
        { label: "Copy Local Address", click: copyLocalAddress },
        { label: "Export Desktop Diagnostics", click: () => exportDesktopDiagnosticBundle().catch((error) => writeDesktopLog("Failed to export desktop diagnostics", error?.message || String(error))) },
        { label: "Open Logs Folder", click: openLogsFolder },
        { type: "separator" },
        { role: "quit", label: "Quit LifeOS AI" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", label: "Undo" },
        { role: "redo", label: "Redo" },
        { type: "separator" },
        { role: "cut", label: "Cut" },
        { role: "copy", label: "Copy" },
        { role: "paste", label: "Paste" },
        { role: "selectAll", label: "Select All" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "reload", label: "Reload" },
        { role: "toggleDevTools", label: "Developer Tools" },
        { type: "separator" },
        { role: "minimize", label: "Minimize" },
        { role: "close", label: "Close Window" },
      ],
    },
  ];
}

async function configureDesktopShell() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));

  const iconPath = path.join(app.isPackaged ? app.getAppPath() : process.cwd(), "desktop", "icon.icns");
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  updateTrayPresentation();
  await refreshDesktopShellStatus().catch((error) => writeDesktopLog("Failed to refresh tray status", error?.message || String(error)));
  trayRefreshTimer = setInterval(() => {
    refreshDesktopShellStatus().catch((error) => writeDesktopLog("Failed to refresh tray status", error?.message || String(error)));
  }, 60_000);
  trayRefreshTimer.unref?.();
  tray.on("click", () => showPreferredAdminWindow("/admin/dashboard"));
}

function configureUpdates() {
  if (!app.isPackaged || !process.env.LIFEOS_UPDATE_URL) return;
  autoUpdater.autoDownload = false;
  autoUpdater.setFeedURL({ provider: "generic", url: process.env.LIFEOS_UPDATE_URL });
  autoUpdater.checkForUpdates().catch((error) => {
    console.warn("LifeOS update check failed:", error?.message || error);
  });
}

function requestDesktopShutdown(reason = "signal") {
  if (shutdownRequested) return;
  shutdownRequested = true;
  writeDesktopLog("Desktop shutdown requested", reason);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  } catch {}
  try {
    if (tray) {
      tray.destroy();
      tray = null;
    }
  } catch {}
  try {
    if (app.isReady()) {
      app.quit();
      setTimeout(() => app.exit(0), 1500).unref?.();
      return;
    }
  } catch {}
  app.exit(0);
}

app.whenReady().then(async () => {
  ipcMain.handle("lifeos:open-logs-folder", async () => {
    openLogsFolder();
    return true;
  });
  ipcMain.handle("lifeos:copy-logs-path", async () => copyLogsPath());
  ipcMain.handle("lifeos:open-local-console", async () => openLocalConsoleInBrowser());
  ipcMain.handle("lifeos:copy-local-address", async () => {
    copyLocalAddress();
    return localUrl("/admin/login");
  });
  ipcMain.handle("lifeos:export-desktop-diagnostics", async () => exportDesktopDiagnosticBundle());
  ipcMain.handle("lifeos:retry-startup", async () => {
    app.relaunch();
    app.exit(0);
    return true;
  });
  try {
    await startLocalCore();
    await configureDesktopShell();
    await createWindow(await resolvePreferredAdminPath("/admin/login"));
    if (process.env.LIFEOS_DESKTOP_EXPORT_DIAGNOSTIC_ON_START) {
      await exportDesktopDiagnosticBundle(process.env.LIFEOS_DESKTOP_EXPORT_DIAGNOSTIC_ON_START);
    }
    configureUpdates();
  } catch (error) {
    writeDesktopLog("LifeOS startup failed", error?.stack || error?.message || String(error));
    console.error("LifeOS startup failed:", error?.message || error);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: "LifeOS AI",
        submenu: [
          { label: "Export Desktop Diagnostics", click: () => exportDesktopDiagnosticBundle().catch((exportError) => writeDesktopLog("Failed to export desktop diagnostics", exportError?.message || String(exportError))) },
          { label: "Open Logs Folder", click: openLogsFolder },
          { role: "quit", label: "Quit LifeOS AI" },
        ],
      },
    ]));
    showStartupFailureWindow(error);
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      resolvePreferredAdminPath("/admin/login")
        .then((pathname) => createWindow(pathname))
        .catch(() => createWindow("/admin/login"));
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (trayRefreshTimer) clearInterval(trayRefreshTimer);
});

process.on("SIGTERM", () => requestDesktopShutdown("SIGTERM"));
process.on("SIGINT", () => requestDesktopShutdown("SIGINT"));
