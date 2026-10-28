import fs from "fs";
import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { getDesktopRuntimeConfig, saveDesktopRuntimeConfig } from "./desktopRuntimeConfig.ts";
import { dataDir } from "./db.ts";
import { normalizePublicBaseUrl } from "./publicBaseUrl.ts";

type ManagedTunnel = {
  process: ChildProcessWithoutNullStreams | null;
  url: string;
  pid: number | null;
  startedAt: number | null;
  lastOutput: string;
  lastError: string;
  command: string;
  kind: "quick" | "named" | "";
  phase: "stopped" | "starting" | "ready" | "stopping";
  stopping: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  lastReconnectAt: number | null;
  reconnectScheduledAt: number | null;
  reconnectReason: string;
};

// A quick tunnel that a named tunnel just replaced. Phones still on its origin
// need it alive long enough to learn the new hostname (endpoints.changed) and
// pass the cross-origin probe the migration card runs before switching.
type QuickTunnelHandoff = {
  process: ChildProcessWithoutNullStreams | null;
  url: string;
  pid: number | null;
  command: string;
  startedAt: number | null;
  handoffStartedAt: number | null;
  expiresAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
};

type CloudflareReconnectHandler = (status: ReturnType<typeof getManagedCloudflareTunnelStatus>) => void | Promise<void>;
type QuickTunnelHandoffRetiredHandler = (event: { url: string; reason: "expired" | "exited" }) => void | Promise<void>;

const DEFAULT_QUICK_TUNNEL_HANDOFF_MS = 10 * 60 * 1000;

const managedTunnel: ManagedTunnel = {
  process: null,
  url: "",
  pid: null,
  startedAt: null,
  lastOutput: "",
  lastError: "",
  command: "",
  kind: "",
  phase: "stopped",
  stopping: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  lastReconnectAt: null,
  reconnectScheduledAt: null,
  reconnectReason: "",
};

const quickTunnelHandoff: QuickTunnelHandoff = {
  process: null,
  url: "",
  pid: null,
  command: "",
  startedAt: null,
  handoffStartedAt: null,
  expiresAt: null,
  timer: null,
};

let reconnectHandler: CloudflareReconnectHandler | null = null;
let handoffRetiredHandler: QuickTunnelHandoffRetiredHandler | null = null;
// Set once quit cleanup has signalled the tunnels. HTTP is still served while
// the graceful wait runs, so a Start that lands then must not spawn a child
// that nothing will stop.
let shutdownStarted = false;

const namedTunnelConfigPath = path.join(dataDir, "cloudflared-named-tunnel.yml");
const namedTunnelSettingsPath = path.join(dataDir, "cloudflared-named-tunnel.json");

export function extractCloudflareTunnelUrls(output: string) {
  const matches = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/gi) || [];
  return Array.from(new Set(matches.map((url) => url.replace(/\/$/, ""))));
}

function appendOutput(value: string) {
  const next = `${managedTunnel.lastOutput}\n${value}`.trim();
  managedTunnel.lastOutput = next.slice(-8000);
  const detected = extractCloudflareTunnelUrls(managedTunnel.lastOutput);
  if (detected[0]) managedTunnel.url = detected[0];
}

function childIsRunning(child = managedTunnel.process) {
  return Boolean(child && child.exitCode === null);
}

function terminateChild(child: ChildProcessWithoutNullStreams | null, graceMs = 1500) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let finished = false;
    let forceTimer: ReturnType<typeof setTimeout>;
    let finalTimer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (forceTimer) clearTimeout(forceTimer);
      if (finalTimer) clearTimeout(finalTimer);
      resolve();
    };
    child.once("exit", finish);
    try { child.kill("SIGTERM"); } catch { finish(); return; }
    forceTimer = setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill("SIGKILL"); } catch {}
      }
    }, graceMs);
    finalTimer = setTimeout(finish, graceMs + 750);
    forceTimer.unref();
    finalTimer.unref();
  });
}

function clearManagedProcess(child: ChildProcessWithoutNullStreams | null) {
  if (child && managedTunnel.process !== child) return;
  managedTunnel.process = null;
  managedTunnel.pid = null;
  if (managedTunnel.phase !== "stopping") managedTunnel.phase = "stopped";
}

function clearReconnectTimer() {
  if (managedTunnel.reconnectTimer) {
    clearTimeout(managedTunnel.reconnectTimer);
    managedTunnel.reconnectTimer = null;
  }
  managedTunnel.reconnectScheduledAt = null;
}

function reconnectDelayMs() {
  const value = Number.parseInt(String(process.env.LIFEOS_CLOUDFLARE_RECONNECT_DELAY_MS || ""), 10);
  if (Number.isFinite(value) && value >= 100) return value;
  return 5000;
}

function currentRuntimePort() {
  return String(process.env.LIFEOS_PORT || process.env.PORT || "3000");
}

function scheduleNamedTunnelReconnect(reason: string) {
  if (isAutostartDisabled() || managedTunnel.stopping || managedTunnel.kind !== "named" || managedTunnel.reconnectTimer) return;
  const status = getCloudflareNamedTunnelStatus();
  if (!status.ready) return;
  const delay = reconnectDelayMs();
  managedTunnel.reconnectReason = reason;
  managedTunnel.reconnectScheduledAt = Date.now() + delay;
  managedTunnel.reconnectTimer = setTimeout(() => {
    managedTunnel.reconnectTimer = null;
    managedTunnel.reconnectScheduledAt = null;
    if (managedTunnel.stopping || isAutostartDisabled()) return;
    // The admin started something else (a quick tunnel) since the named
    // tunnel dropped; reconnecting would hand it off or kill it.
    if (childIsRunning() && managedTunnel.kind !== "named") return;
    managedTunnel.reconnectAttempts += 1;
    managedTunnel.lastReconnectAt = Date.now();
    startConfiguredCloudflareNamedTunnel(15000, currentRuntimePort())
      .then((status) => notifyReconnect(status))
      .catch((error: any) => {
        managedTunnel.lastError = String(error?.message || error || "Cloudflare Named Tunnel reconnect failed").slice(0, 500);
        scheduleNamedTunnelReconnect("reconnect_failed");
      });
  }, delay);
  managedTunnel.reconnectTimer.unref();
}

function notifyReconnect(status: ReturnType<typeof getManagedCloudflareTunnelStatus>) {
  if (!reconnectHandler) return;
  Promise.resolve()
    .then(() => reconnectHandler?.(status))
    .catch((error: any) => {
      managedTunnel.lastError = String(error?.message || error || "Cloudflare Named Tunnel reconnect health refresh failed").slice(0, 500);
    });
}

export function setCloudflareTunnelReconnectHandler(handler: CloudflareReconnectHandler | null) {
  reconnectHandler = handler;
}

export function setCloudflareQuickTunnelHandoffRetiredHandler(handler: QuickTunnelHandoffRetiredHandler | null) {
  handoffRetiredHandler = handler;
}

function quickTunnelHandoffMs() {
  const value = Number.parseInt(String(process.env.LIFEOS_QUICK_TUNNEL_HANDOFF_MS || ""), 10);
  if (Number.isFinite(value) && value >= 100) return value;
  return DEFAULT_QUICK_TUNNEL_HANDOFF_MS;
}

function clearQuickTunnelHandoffTimer() {
  if (quickTunnelHandoff.timer) {
    clearTimeout(quickTunnelHandoff.timer);
    quickTunnelHandoff.timer = null;
  }
  quickTunnelHandoff.expiresAt = null;
}

function resetQuickTunnelHandoff() {
  clearQuickTunnelHandoffTimer();
  quickTunnelHandoff.process = null;
  quickTunnelHandoff.url = "";
  quickTunnelHandoff.pid = null;
  quickTunnelHandoff.command = "";
  quickTunnelHandoff.startedAt = null;
  quickTunnelHandoff.handoffStartedAt = null;
}

function notifyQuickTunnelHandoffRetired(event: { url: string; reason: "expired" | "exited" }) {
  if (!handoffRetiredHandler || !event.url) return;
  Promise.resolve()
    .then(() => handoffRetiredHandler?.(event))
    .catch(() => {});
}

// Stop and forget the handoff child. Only an expired window is announced from
// here; a Stop, quit cleanup or newer handoff is announced by its caller.
function retireQuickTunnelHandoff(reason: "expired" | "replaced" | "stopped") {
  const child = quickTunnelHandoff.process;
  const url = quickTunnelHandoff.url;
  resetQuickTunnelHandoff();
  if (reason === "expired") notifyQuickTunnelHandoffRetired({ url, reason });
  return terminateChild(child);
}

function releaseExitedQuickTunnelHandoff(child: ChildProcessWithoutNullStreams) {
  if (quickTunnelHandoff.process !== child) return;
  const url = quickTunnelHandoff.url;
  resetQuickTunnelHandoff();
  if (!managedTunnel.stopping) notifyQuickTunnelHandoffRetired({ url, reason: "exited" });
}

// The managed slot is about to hold a named tunnel. A ready quick tunnel moves
// to the handoff slot instead of running on untracked; anything else still in
// the slot has no connected phone to hand off and is stopped.
function handOffRunningQuickTunnel() {
  const child = managedTunnel.process;
  if (!child || !childIsRunning(child)) return null;
  if (managedTunnel.kind !== "quick" || managedTunnel.phase !== "ready" || !managedTunnel.url) {
    void terminateChild(child);
    return null;
  }
  void retireQuickTunnelHandoff("replaced");
  quickTunnelHandoff.process = child;
  quickTunnelHandoff.url = managedTunnel.url;
  quickTunnelHandoff.pid = managedTunnel.pid;
  quickTunnelHandoff.command = managedTunnel.command;
  quickTunnelHandoff.startedAt = managedTunnel.startedAt;
  quickTunnelHandoff.handoffStartedAt = Date.now();
  const delay = quickTunnelHandoffMs();
  quickTunnelHandoff.expiresAt = Date.now() + delay;
  quickTunnelHandoff.timer = setTimeout(() => {
    quickTunnelHandoff.timer = null;
    if (quickTunnelHandoff.process !== child) return;
    void retireQuickTunnelHandoff("expired");
  }, delay);
  quickTunnelHandoff.timer.unref();
  return child;
}

// The named tunnel never came up, so the quick tunnel is still the phone's
// only Cloudflare path: give it the managed slot back instead of letting the
// handoff window retire it.
function restoreQuickTunnelFromHandoff(child: ChildProcessWithoutNullStreams | null) {
  if (!child || quickTunnelHandoff.process !== child || !childIsRunning(child)) return false;
  if (managedTunnel.stopping || childIsRunning()) return false;
  managedTunnel.process = child;
  managedTunnel.pid = quickTunnelHandoff.pid;
  managedTunnel.url = quickTunnelHandoff.url;
  managedTunnel.command = quickTunnelHandoff.command;
  managedTunnel.startedAt = quickTunnelHandoff.startedAt;
  managedTunnel.kind = "quick";
  managedTunnel.phase = "ready";
  resetQuickTunnelHandoff();
  return true;
}

function getQuickTunnelHandoffStatus() {
  const running = childIsRunning(quickTunnelHandoff.process);
  return {
    running,
    url: running ? quickTunnelHandoff.url : "",
    pid: running ? quickTunnelHandoff.pid : null,
    handoffStartedAt: running ? quickTunnelHandoff.handoffStartedAt : null,
    expiresAt: running ? quickTunnelHandoff.expiresAt : null,
  };
}

function commandForPort(port: string) {
  const command = process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared";
  return `${command} tunnel --url http://127.0.0.1:${port}`;
}

function firstConfiguredValue(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function loadNamedTunnelSettings() {
  if (!fs.existsSync(namedTunnelSettingsPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(namedTunnelSettingsPath, "utf8"));
    return {
      name: String(parsed?.name || "").trim(),
      hostname: String(parsed?.hostname || "").trim().toLowerCase(),
      credentialsFile: String(parsed?.credentialsFile || "").trim(),
      port: String(parsed?.port || "").trim(),
    };
  } catch {
    return null;
  }
}

function saveNamedTunnelSettings(input: { name: string; hostname: string; credentialsFile: string; port: string }) {
  fs.mkdirSync(path.dirname(namedTunnelSettingsPath), { recursive: true });
  fs.writeFileSync(namedTunnelSettingsPath, `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600 });
}

function namedTunnelInput(input: { name?: unknown; hostname?: unknown; credentialsFile?: unknown; port?: unknown }) {
  const saved = loadNamedTunnelSettings();
  const name = firstConfiguredValue(input.name, process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME, saved?.name);
  const hostname = firstConfiguredValue(input.hostname, process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME, saved?.hostname).toLowerCase();
  const credentialsFile = firstConfiguredValue(input.credentialsFile, process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS, saved?.credentialsFile);
  const port = firstConfiguredValue(input.port, process.env.LIFEOS_PORT, process.env.PORT, saved?.port, "3000");
  const baseUrl = normalizePublicBaseUrl(hostname ? `https://${hostname}` : "");
  if (!name || !/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name)) throw new Error("Named Tunnel requires a valid tunnel name.");
  if (!baseUrl) throw new Error("Named Tunnel requires a valid HTTPS hostname.");
  if (!credentialsFile) throw new Error("Named Tunnel requires a credentials JSON file path.");
  return { name, hostname, credentialsFile, port, baseUrl };
}

function credentialsFileExists(credentialsFile = "") {
  try {
    return Boolean(credentialsFile && fs.existsSync(credentialsFile) && fs.statSync(credentialsFile).isFile());
  } catch {
    return false;
  }
}

export function getCloudflareNamedTunnelStatus() {
  const saved = loadNamedTunnelSettings();
  const configured = Boolean(
    (process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME && process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME && process.env.LIFEOS_CLOUDFLARE_TUNNEL_CREDENTIALS)
      || (saved?.name && saved?.hostname && saved?.credentialsFile),
  );
  const configExists = fs.existsSync(namedTunnelConfigPath);
  let parsed: ReturnType<typeof namedTunnelInput> | null = null;
  let configPreview = "";
  try {
    parsed = namedTunnelInput({});
    configPreview = buildNamedTunnelConfig(parsed);
  } catch {}
  const credentialsFileReady = credentialsFileExists(parsed?.credentialsFile);
  const command = parsed ? `${process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared"} tunnel --config [lifeos-data]/cloudflared-named-tunnel.yml run ${parsed.name}` : "";
  const safeConfigPreview = configPreview
    ? configPreview.replace(/^credentials-file:.*$/m, "credentials-file: [configured]")
    : "";
  return {
    configured,
    ready: Boolean(parsed && configExists && credentialsFileReady),
    configPath: "[lifeos-data]/cloudflared-named-tunnel.yml",
    settingsPath: "[lifeos-data]/cloudflared-named-tunnel.json",
    settingsSaved: Boolean(saved?.name && saved?.hostname && saved?.credentialsFile),
    configExists,
    credentialsFileExists: credentialsFileReady,
    name: parsed?.name || String(process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME || ""),
    hostname: parsed?.hostname || String(process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME || ""),
    credentialsFile: parsed ? "[configured]" : "",
    baseUrl: parsed?.baseUrl || "",
    command,
    configPreview: safeConfigPreview,
    notes: parsed
      ? [
        configExists ? "Named Tunnel config exists and can be started automatically." : "Generate the Named Tunnel config before starting it.",
        credentialsFileReady ? "Named Tunnel credentials file is present." : "Named Tunnel credentials JSON file is missing; restore it before starting.",
        "Named Tunnel is the recommended Cloudflare mode for long-term remote access with your own domain.",
      ]
      : [
        "Set a tunnel name, hostname, and credentials file to use a stable Cloudflare Named Tunnel.",
        "Quick trycloudflare.com tunnels are temporary and should only be used for testing.",
      ],
  };
}

function buildNamedTunnelConfig(input: { name: string; hostname: string; credentialsFile: string; port: string }) {
  return [
    `tunnel: ${input.name}`,
    `credentials-file: ${input.credentialsFile}`,
    "",
    "ingress:",
    `  - hostname: ${input.hostname}`,
    `    service: http://127.0.0.1:${input.port}`,
    "  - service: http_status:404",
    "",
  ].join("\n");
}

export function generateCloudflareNamedTunnelConfig(input: { name?: unknown; hostname?: unknown; credentialsFile?: unknown; port?: unknown }) {
  const parsed = namedTunnelInput(input);
  if (!credentialsFileExists(parsed.credentialsFile)) throw new Error("Named Tunnel credentials JSON file does not exist.");
  const config = buildNamedTunnelConfig(parsed);
  fs.mkdirSync(path.dirname(namedTunnelConfigPath), { recursive: true });
  fs.writeFileSync(namedTunnelConfigPath, config, { mode: 0o600 });
  saveNamedTunnelSettings({
    name: parsed.name,
    hostname: parsed.hostname,
    credentialsFile: parsed.credentialsFile,
    port: parsed.port,
  });
  const desktopConfig = saveDesktopRuntimeConfig({
    mode: "cloudflare",
    label: "Cloudflare Named Tunnel",
    baseUrl: parsed.baseUrl,
  });
  return { ...getCloudflareNamedTunnelStatus(), config, desktopConfig };
}

export function refreshCloudflareNamedTunnelConfigForPort(port: string) {
  let parsed: ReturnType<typeof namedTunnelInput>;
  try {
    parsed = namedTunnelInput({ port });
  } catch (error: any) {
    return {
      refreshed: false,
      ready: false,
      reason: "cloudflare_named_tunnel_not_configured",
      error: String(error?.message || error || "Named Tunnel is not configured").slice(0, 240),
      status: getCloudflareNamedTunnelStatus(),
    };
  }
  if (!credentialsFileExists(parsed.credentialsFile)) {
    return {
      refreshed: false,
      ready: false,
      reason: "cloudflare_named_credentials_missing",
      status: getCloudflareNamedTunnelStatus(),
    };
  }
  const config = buildNamedTunnelConfig(parsed);
  const current = fs.existsSync(namedTunnelConfigPath) ? fs.readFileSync(namedTunnelConfigPath, "utf8") : "";
  const refreshed = current !== config;
  if (refreshed) {
    fs.mkdirSync(path.dirname(namedTunnelConfigPath), { recursive: true });
    fs.writeFileSync(namedTunnelConfigPath, config, { mode: 0o600 });
    saveNamedTunnelSettings({
      name: parsed.name,
      hostname: parsed.hostname,
      credentialsFile: parsed.credentialsFile,
      port: parsed.port,
    });
  }
  return {
    refreshed,
    ready: true,
    reason: refreshed ? "cloudflare_named_config_refreshed" : "cloudflare_named_config_current",
    status: getCloudflareNamedTunnelStatus(),
  };
}

function rejectStartDuringShutdown() {
  return Promise.reject(new Error("OwnOrbit is quitting; Cloudflare Tunnel was not started."));
}

export function startConfiguredCloudflareNamedTunnel(timeoutMs = 15000, port = "") {
  if (shutdownStarted) return rejectStartDuringShutdown();
  if (port) refreshCloudflareNamedTunnelConfigForPort(port);
  const status = getCloudflareNamedTunnelStatus();
  if (!status.ready || !status.name) throw new Error("Cloudflare Named Tunnel is not ready. Generate the config first.");
  if (childIsRunning() && managedTunnel.kind === "named" && managedTunnel.url === status.baseUrl) {
    return managedTunnel.phase === "ready"
      ? Promise.resolve(getManagedCloudflareTunnelStatus())
      : waitForManagedTunnelReady(timeoutMs);
  }

  clearReconnectTimer();
  const handoffChild = handOffRunningQuickTunnel();
  managedTunnel.stopping = false;
  managedTunnel.lastOutput = "";
  managedTunnel.lastError = "";
  managedTunnel.url = status.baseUrl;
  managedTunnel.command = status.command;
  managedTunnel.startedAt = Date.now();
  managedTunnel.kind = "named";
  managedTunnel.phase = "starting";

  return new Promise<ReturnType<typeof getManagedCloudflareTunnelStatus>>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const fail = (message: string) => {
      restoreQuickTunnelFromHandoff(handoffChild);
      reject(new Error(message));
    };
    try {
      const child = spawn(process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared", ["tunnel", "--config", namedTunnelConfigPath, "run", status.name], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      managedTunnel.process = child;
      managedTunnel.pid = child.pid || null;
      // Once another start has taken the slot, this child's events must not
      // touch the managed state; its pipes are still drained.
      const ownsSlot = () => managedTunnel.process === child;
      const handleOutput = (chunk: Buffer) => {
        if (!ownsSlot()) return;
        appendOutput(chunk.toString("utf8"));
        if (/registered tunnel connection|connection registered|started tunnel/i.test(managedTunnel.lastOutput)) {
          managedTunnel.phase = "ready";
          finish(() => resolve(getManagedCloudflareTunnelStatus()));
        }
      };
      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);
      child.on("error", (error) => {
        if (!ownsSlot()) {
          finish(() => reject(new Error(error.message || "Failed to start Cloudflare Named Tunnel")));
          return;
        }
        managedTunnel.lastError = error.message || "Failed to start Cloudflare Named Tunnel";
        managedTunnel.phase = "stopped";
        clearManagedProcess(child);
        finish(() => fail(managedTunnel.lastError));
      });
      child.on("exit", (code, signal) => {
        if (!ownsSlot()) {
          finish(() => reject(new Error("Cloudflare Named Tunnel was replaced before it became ready.")));
          return;
        }
        const wasReady = managedTunnel.phase === "ready";
        clearManagedProcess(child);
        if (!settled) {
          managedTunnel.lastError = `cloudflared named tunnel exited before becoming ready (${signal || (code ?? "unknown")}).`;
          finish(() => fail(managedTunnel.lastError));
        } else if (wasReady && !managedTunnel.stopping) {
          managedTunnel.lastError = `cloudflared named tunnel exited after startup (${signal || (code ?? "unknown")}); reconnect scheduled.`;
          scheduleNamedTunnelReconnect("process_exit");
        }
      });
      timer = setTimeout(() => {
        const message = "Timed out waiting for Cloudflare Named Tunnel to register a connection.";
        if (ownsSlot()) managedTunnel.lastError = message;
        finish(() => {
          void terminateChild(child).finally(() => {
            clearManagedProcess(child);
            fail(message);
          });
        });
      }, timeoutMs);
    } catch (error: any) {
      managedTunnel.lastError = error?.message || "Failed to start Cloudflare Named Tunnel";
      managedTunnel.process = null;
      finish(() => fail(managedTunnel.lastError));
    }
  });
}

export function getManagedCloudflareTunnelStatus() {
  const running = childIsRunning();
  return {
    running,
    ready: running && managedTunnel.phase === "ready",
    starting: running && managedTunnel.phase === "starting",
    phase: managedTunnel.phase,
    url: managedTunnel.url,
    pid: running ? managedTunnel.pid : null,
    startedAt: running ? managedTunnel.startedAt : null,
    command: managedTunnel.command,
    lastOutput: managedTunnel.lastOutput,
    lastError: managedTunnel.lastError,
    kind: managedTunnel.kind,
    reconnectAttempts: managedTunnel.reconnectAttempts,
    lastReconnectAt: managedTunnel.lastReconnectAt,
    reconnectScheduledAt: managedTunnel.reconnectScheduledAt,
    reconnectReason: managedTunnel.reconnectReason,
    handoff: getQuickTunnelHandoffStatus(),
  };
}

// Quit cleanup also runs from process "exit", where nothing awaited ever
// resumes, so every cloudflared child this core owns gets SIGTERM right here.
// stopManagedCloudflareTunnel() can follow to wait for them gracefully.
// Safe to call again: it re-signals whatever the slots hold now.
export function signalManagedCloudflareTunnelsForShutdown() {
  shutdownStarted = true;
  managedTunnel.stopping = true;
  clearReconnectTimer();
  clearQuickTunnelHandoffTimer();
  let signalled = 0;
  for (const child of [managedTunnel.process, quickTunnelHandoff.process]) {
    if (!child || child.exitCode !== null) continue;
    try {
      child.kill("SIGTERM");
      signalled += 1;
    } catch {}
  }
  return signalled;
}

export async function stopManagedCloudflareTunnel() {
  managedTunnel.stopping = true;
  managedTunnel.phase = "stopping";
  clearReconnectTimer();
  const child = managedTunnel.process;
  // The handoff slot is emptied right here, before anything is awaited.
  await Promise.all([terminateChild(child), retireQuickTunnelHandoff("stopped")]);
  // A Start that landed during the graceful wait owns the slot now; blanking
  // it would leave that child running untracked, past Stop and quit.
  if (managedTunnel.process && managedTunnel.process !== child) return getManagedCloudflareTunnelStatus();
  managedTunnel.process = null;
  managedTunnel.pid = null;
  managedTunnel.startedAt = null;
  managedTunnel.url = "";
  managedTunnel.command = "";
  managedTunnel.kind = "";
  managedTunnel.phase = "stopped";
  managedTunnel.stopping = shutdownStarted;
  managedTunnel.reconnectReason = "";
  return getManagedCloudflareTunnelStatus();
}

function isAutostartDisabled() {
  return process.env.LIFEOS_DISABLE_CLOUDFLARE_AUTOSTART === "1"
    || process.env.LIFEOS_CLOUDFLARE_AUTOSTART === "0";
}

function isTemporaryCloudflareUrl(value = "") {
  try {
    return new URL(value).hostname.toLowerCase().endsWith(".trycloudflare.com");
  } catch {
    return value.toLowerCase().includes(".trycloudflare.com");
  }
}

export async function maybeStartConfiguredCloudflareTunnel(port: string, timeoutMs = 15000) {
  const config = getDesktopRuntimeConfig();
  // A quick tunnel is only ever started by the admin, usually because the
  // saved Named Tunnel is down. Starting the saved one from a background
  // restore (the startup autostart, the health monitor) would hand the quick
  // tunnel off and stop it, or kill it outright while it is still starting.
  const current = getManagedCloudflareTunnelStatus();
  if (current.running && current.kind === "quick") {
    return { started: false, reason: "quick_tunnel_running", tunnel: current, config };
  }
  let namedStatus = getCloudflareNamedTunnelStatus();
  let refreshResult: ReturnType<typeof refreshCloudflareNamedTunnelConfigForPort> | null = null;
  if (config?.mode === "cloudflare" && !isAutostartDisabled() && !isTemporaryCloudflareUrl(config.publicBaseUrl)) {
    refreshResult = refreshCloudflareNamedTunnelConfigForPort(port);
    namedStatus = refreshResult.status;
  }
  if (config?.mode === "cloudflare" && namedStatus.ready && config.publicBaseUrl === namedStatus.baseUrl && !isAutostartDisabled()) {
    const tunnel = await startConfiguredCloudflareNamedTunnel(timeoutMs);
    process.env.PUBLIC_BASE_URL = namedStatus.baseUrl;
    return {
      started: true,
      reason: "cloudflare_named_configured",
      tunnel,
      config,
      refresh: refreshResult,
    };
  }
  if (!config || config.mode !== "cloudflare" || isAutostartDisabled()) {
    return { started: false, reason: "not_configured", tunnel: getManagedCloudflareTunnelStatus(), config };
  }
  if (isTemporaryCloudflareUrl(config.publicBaseUrl)) {
    return {
      started: false,
      reason: "temporary_quick_tunnel_not_restored",
      tunnel: getManagedCloudflareTunnelStatus(),
      config,
    };
  }
  return {
    started: false,
    reason: "cloudflare_named_tunnel_not_ready",
    tunnel: getManagedCloudflareTunnelStatus(),
    config,
  };
}

export function startManagedCloudflareTunnel(port: string, timeoutMs = 15000) {
  if (shutdownStarted) return rejectStartDuringShutdown();
  const current = getManagedCloudflareTunnelStatus();
  if (current.running && current.ready && current.url) return Promise.resolve(current);
  if (current.running && current.starting) return waitForManagedTunnelUrl(timeoutMs);

  // A Named Tunnel that dropped may still have a reconnect pending; firing
  // now it would hand this quick tunnel off, or kill it before it is ready.
  clearReconnectTimer();
  managedTunnel.lastOutput = "";
  managedTunnel.lastError = "";
  managedTunnel.url = "";
  managedTunnel.command = commandForPort(port);
  managedTunnel.startedAt = Date.now();
  managedTunnel.kind = "quick";
  managedTunnel.stopping = false;
  managedTunnel.phase = "starting";

  return new Promise<ReturnType<typeof getManagedCloudflareTunnelStatus>>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    try {
      const child = spawn(process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared", ["tunnel", "--url", `http://127.0.0.1:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      managedTunnel.process = child;
      managedTunnel.pid = child.pid || null;
      // After a named tunnel takes the slot this child is either in the
      // handoff slot or being stopped; its events must not touch the managed
      // state, and its pipes are still drained.
      const ownsSlot = () => managedTunnel.process === child;

      const handleOutput = (chunk: Buffer) => {
        if (!ownsSlot()) return;
        appendOutput(chunk.toString("utf8"));
        if (managedTunnel.url) {
          managedTunnel.phase = "ready";
          finish(() => resolve(getManagedCloudflareTunnelStatus()));
        }
      };

      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);
      child.on("error", (error) => {
        if (!ownsSlot()) {
          releaseExitedQuickTunnelHandoff(child);
          finish(() => reject(new Error(error.message || "Failed to start cloudflared")));
          return;
        }
        managedTunnel.lastError = error.message || "Failed to start cloudflared";
        managedTunnel.phase = "stopped";
        clearManagedProcess(child);
        finish(() => reject(new Error(managedTunnel.lastError)));
      });
      child.on("exit", (code, signal) => {
        if (!ownsSlot()) {
          releaseExitedQuickTunnelHandoff(child);
          finish(() => reject(new Error("cloudflared quick tunnel was replaced before it created a tunnel.")));
          return;
        }
        const expectedStop = managedTunnel.stopping;
        clearManagedProcess(child);
        if (!expectedStop) {
          managedTunnel.lastError = `cloudflared exited before creating a tunnel (${signal || (code ?? "unknown")}).`;
          finish(() => reject(new Error(managedTunnel.lastError)));
        }
      });

      timer = setTimeout(() => {
        const message = managedTunnel.lastOutput
          ? "cloudflared started but no trycloudflare.com URL was detected yet."
          : "Timed out waiting for cloudflared to create a tunnel URL.";
        if (ownsSlot()) managedTunnel.lastError = message;
        finish(() => {
          void terminateChild(child).finally(() => {
            clearManagedProcess(child);
            reject(new Error(message));
          });
        });
      }, timeoutMs);
    } catch (error: any) {
      managedTunnel.lastError = error?.message || "Failed to start cloudflared";
      managedTunnel.process = null;
      finish(() => reject(new Error(managedTunnel.lastError)));
    }
  });
}

export function waitForManagedTunnelUrl(timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise<ReturnType<typeof getManagedCloudflareTunnelStatus>>((resolve, reject) => {
    const poll = () => {
      const status = getManagedCloudflareTunnelStatus();
      if (status.ready && status.url) {
        resolve(status);
        return;
      }
      if (!status.running) {
        reject(new Error(status.lastError || "cloudflared is not running"));
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out waiting for cloudflared tunnel URL"));
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

function waitForManagedTunnelReady(timeoutMs = 15000) {
  return waitForManagedTunnelUrl(timeoutMs);
}
