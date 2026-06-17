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
};

const managedTunnel: ManagedTunnel = {
  process: null,
  url: "",
  pid: null,
  startedAt: null,
  lastOutput: "",
  lastError: "",
  command: "",
};

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
  const command = parsed ? `${process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared"} tunnel --config [lifeos-data]/cloudflared-named-tunnel.yml run ${parsed.name}` : "";
  const safeConfigPreview = configPreview
    ? configPreview.replace(/^credentials-file:.*$/m, "credentials-file: [configured]")
    : "";
  return {
    configured,
    ready: Boolean(parsed && configExists),
    configPath: "[lifeos-data]/cloudflared-named-tunnel.yml",
    settingsPath: "[lifeos-data]/cloudflared-named-tunnel.json",
    settingsSaved: Boolean(saved?.name && saved?.hostname && saved?.credentialsFile),
    configExists,
    name: parsed?.name || String(process.env.LIFEOS_CLOUDFLARE_TUNNEL_NAME || ""),
    hostname: parsed?.hostname || String(process.env.LIFEOS_CLOUDFLARE_TUNNEL_HOSTNAME || ""),
    credentialsFile: parsed ? "[configured]" : "",
    baseUrl: parsed?.baseUrl || "",
    command,
    configPreview: safeConfigPreview,
    notes: parsed
      ? [
        configExists ? "Named Tunnel config exists and can be started automatically." : "Generate the Named Tunnel config before starting it.",
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

export function startConfiguredCloudflareNamedTunnel(timeoutMs = 15000) {
  const status = getCloudflareNamedTunnelStatus();
  if (!status.ready || !status.name) throw new Error("Cloudflare Named Tunnel is not ready. Generate the config first.");
  if (managedTunnel.process && !managedTunnel.process.killed && managedTunnel.url === status.baseUrl) return Promise.resolve(getManagedCloudflareTunnelStatus());

  managedTunnel.lastOutput = "";
  managedTunnel.lastError = "";
  managedTunnel.url = status.baseUrl;
  managedTunnel.command = status.command;
  managedTunnel.startedAt = Date.now();

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
      const child = spawn(process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared", ["tunnel", "--config", namedTunnelConfigPath, "run", status.name], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      managedTunnel.process = child;
      managedTunnel.pid = child.pid || null;
      const handleOutput = (chunk: Buffer) => {
        appendOutput(chunk.toString("utf8"));
        if (/registered tunnel connection|connection registered|started tunnel/i.test(managedTunnel.lastOutput)) {
          finish(() => resolve(getManagedCloudflareTunnelStatus()));
        }
      };
      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);
      child.on("error", (error) => {
        managedTunnel.lastError = error.message || "Failed to start Cloudflare Named Tunnel";
        managedTunnel.process = null;
        finish(() => reject(new Error(managedTunnel.lastError)));
      });
      child.on("exit", (code, signal) => {
        managedTunnel.process = null;
        managedTunnel.pid = null;
        if (!settled) {
          managedTunnel.lastError = `cloudflared named tunnel exited before becoming ready (${signal || (code ?? "unknown")}).`;
          finish(() => reject(new Error(managedTunnel.lastError)));
        }
      });
      timer = setTimeout(() => finish(() => resolve(getManagedCloudflareTunnelStatus())), timeoutMs);
    } catch (error: any) {
      managedTunnel.lastError = error?.message || "Failed to start Cloudflare Named Tunnel";
      managedTunnel.process = null;
      finish(() => reject(new Error(managedTunnel.lastError)));
    }
  });
}

export function getManagedCloudflareTunnelStatus() {
  const running = Boolean(managedTunnel.process && !managedTunnel.process.killed);
  return {
    running,
    starting: running && !managedTunnel.url,
    url: managedTunnel.url,
    pid: running ? managedTunnel.pid : null,
    startedAt: running ? managedTunnel.startedAt : null,
    command: managedTunnel.command,
    lastOutput: managedTunnel.lastOutput,
    lastError: managedTunnel.lastError,
  };
}

export function stopManagedCloudflareTunnel() {
  if (managedTunnel.process && !managedTunnel.process.killed) {
    managedTunnel.process.kill("SIGTERM");
  }
  managedTunnel.process = null;
  managedTunnel.pid = null;
  managedTunnel.startedAt = null;
  managedTunnel.url = "";
  managedTunnel.command = "";
  return getManagedCloudflareTunnelStatus();
}

function isAutostartDisabled() {
  return process.env.LIFEOS_DISABLE_CLOUDFLARE_AUTOSTART === "1"
    || process.env.LIFEOS_CLOUDFLARE_AUTOSTART === "0";
}

export async function maybeStartConfiguredCloudflareTunnel(port: string, timeoutMs = 15000) {
  const config = getDesktopRuntimeConfig();
  const namedStatus = getCloudflareNamedTunnelStatus();
  if (config?.mode === "cloudflare" && namedStatus.ready && config.publicBaseUrl === namedStatus.baseUrl && !isAutostartDisabled()) {
    const tunnel = await startConfiguredCloudflareNamedTunnel(timeoutMs);
    process.env.PUBLIC_BASE_URL = namedStatus.baseUrl;
    return {
      started: true,
      reason: "cloudflare_named_configured",
      tunnel,
      config,
    };
  }
  if (!config || config.mode !== "cloudflare" || isAutostartDisabled()) {
    return { started: false, reason: "not_configured", tunnel: getManagedCloudflareTunnelStatus(), config };
  }

  const tunnel = await startManagedCloudflareTunnel(port, timeoutMs);
  if (!tunnel.url) throw new Error("Cloudflare Tunnel did not return a public URL");

  process.env.PUBLIC_BASE_URL = tunnel.url;
  const updatedConfig = saveDesktopRuntimeConfig({
    mode: "cloudflare",
    label: "Cloudflare Tunnel",
    baseUrl: tunnel.url,
  });

  return {
    started: true,
    reason: "cloudflare_configured",
    tunnel: getManagedCloudflareTunnelStatus(),
    config: updatedConfig,
  };
}

export function startManagedCloudflareTunnel(port: string, timeoutMs = 15000) {
  const current = getManagedCloudflareTunnelStatus();
  if (current.running && current.url) return Promise.resolve(current);
  if (current.running && current.starting) return waitForManagedTunnelUrl(timeoutMs);

  managedTunnel.lastOutput = "";
  managedTunnel.lastError = "";
  managedTunnel.url = "";
  managedTunnel.command = commandForPort(port);
  managedTunnel.startedAt = Date.now();

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

      const handleOutput = (chunk: Buffer) => {
        appendOutput(chunk.toString("utf8"));
        if (managedTunnel.url) {
          finish(() => resolve(getManagedCloudflareTunnelStatus()));
        }
      };

      child.stdout.on("data", handleOutput);
      child.stderr.on("data", handleOutput);
      child.on("error", (error) => {
        managedTunnel.lastError = error.message || "Failed to start cloudflared";
        managedTunnel.process = null;
        finish(() => reject(new Error(managedTunnel.lastError)));
      });
      child.on("exit", (code, signal) => {
        const expectedStop = settled && managedTunnel.url;
        managedTunnel.process = null;
        managedTunnel.pid = null;
        if (!expectedStop) {
          managedTunnel.lastError = `cloudflared exited before creating a tunnel (${signal || (code ?? "unknown")}).`;
          finish(() => reject(new Error(managedTunnel.lastError)));
        }
      });

      timer = setTimeout(() => {
        const message = managedTunnel.lastOutput
          ? "cloudflared started but no trycloudflare.com URL was detected yet."
          : "Timed out waiting for cloudflared to create a tunnel URL.";
        managedTunnel.lastError = message;
        finish(() => reject(new Error(message)));
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
      if (status.url) {
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
