import { execFileSync } from "child_process";
import os from "os";
import { WebSocket } from "ws";
import { extractCloudflareTunnelUrls, getManagedCloudflareTunnelStatus } from "./cloudflareTunnel.ts";
import { DesktopRuntimeConfig, getDesktopRuntimeConfig, saveDesktopRuntimeConfig } from "./desktopRuntimeConfig.ts";
import { getConfiguredPublicBaseUrl } from "./publicBaseUrl";

type CommandResult = {
  ok: boolean;
  output: string;
};

type ConnectionProbeStep = {
  id: "health" | "mobile-shell" | "websocket";
  ok: boolean;
  status: number;
  url: string;
  latencyMs: number;
  error?: string;
};

type ConnectionRepairHintId =
  | "desktop-service-unreachable"
  | "wrong-lifeos-target"
  | "mobile-shell-missing"
  | "websocket-upgrade-blocked"
  | "localhost-phone-unreachable"
  | "https-required"
  | "public-mode-risk";

type ConnectionRepairHint = {
  id: ConnectionRepairHintId;
  stepId?: ConnectionProbeStep["id"];
  severity: "warning" | "danger";
};

type ConnectionCandidate = ReturnType<typeof connectionCandidate>;
type RemoteReadinessItemId =
  | "noRemoteEntry"
  | "localOnly"
  | "lanOnly"
  | "needsHttps"
  | "needsPublicOptIn"
  | "needsRestart"
  | "temporaryTunnel"
  | "ready";

function runCommand(command: string, args: string[] = []): CommandResult {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2500,
    });
    return { ok: true, output: output.trim() };
  } catch (error: any) {
    const output = `${error?.stdout || ""}${error?.stderr || ""}`.trim();
    return { ok: false, output };
  }
}

function runManagedCommand(command: string, args: string[] = []): CommandResult {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
      env: process.env,
    });
    return { ok: true, output: output.trim() };
  } catch (error: any) {
    const output = `${error?.stdout || ""}${error?.stderr || ""}`.trim();
    return { ok: false, output: output || error?.message || "Command failed" };
  }
}

function cloudflaredCommand() {
  return process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared";
}

function tailscaleCommand() {
  return process.env.LIFEOS_TAILSCALE_BIN || "tailscale";
}

function tailscaleCommandPrefixArgs() {
  try {
    const parsed = JSON.parse(process.env.LIFEOS_TAILSCALE_BIN_ARGS || "[]");
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function runTailscaleCommand(args: string[] = []): CommandResult {
  return runCommand(tailscaleCommand(), [...tailscaleCommandPrefixArgs(), ...args]);
}

function runManagedTailscaleCommand(args: string[] = []): CommandResult {
  return runManagedCommand(tailscaleCommand(), [...tailscaleCommandPrefixArgs(), ...args]);
}

function getProcessOutput(name: string) {
  const command = process.platform === "win32" ? "tasklist" : "pgrep";
  const args = process.platform === "win32" ? [] : ["-fl", name];
  return runCommand(command, args);
}

function isProcessRunning(name: string) {
  const result = getProcessOutput(name);
  return result.ok && result.output.toLowerCase().includes(name.toLowerCase());
}

function getLanUrls(port: string) {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}`);
}

function connectionCandidate(input: {
  id: string;
  label: string;
  baseUrl: string;
  mode: "configured" | "cloudflare" | "tailscale" | "lan" | "local";
  priority: number;
  requiresRestart: boolean;
  stability: "stable" | "temporary" | "local";
  notes: string[];
}) {
  const secure = input.baseUrl.startsWith("https://") || input.mode === "local";
  const normalizedBaseUrl = input.baseUrl.replace(/\/$/, "");
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  const host = input.mode === "local" || (input.mode === "tailscale" && parsedBaseUrl.protocol === "https:") ? "127.0.0.1" : "0.0.0.0";
  const envTemplate = input.mode === "local"
    ? `LIFEOS_HOST=127.0.0.1 LIFEOS_PORT=${parsedBaseUrl.port || "3000"} npm run start`
    : `LIFEOS_HOST=${host} LIFEOS_ALLOW_PUBLIC=1 PUBLIC_BASE_URL=${normalizedBaseUrl} npm run start`;
  return {
    ...input,
    baseUrl: normalizedBaseUrl,
    secure,
    stability: input.stability,
    envTemplate,
    restartInstruction: input.requiresRestart
      ? "Copy the startup environment, quit LifeOS AI, then restart with it so this address is used for QR codes and mobile entry."
      : "This address is already active. You can copy the pairing entry or test connectivity.",
    mobilePairUrl: `${normalizedBaseUrl}/mobile/pair`,
    mobileChatUrl: `${normalizedBaseUrl}/mobile/chat`,
  };
}

function buildConnectionCandidates(input: {
  port: string;
  publicBaseUrl: string;
  lanUrls: string[];
  desktopRuntimeConfig: DesktopRuntimeConfig | null;
  cloudflare: ReturnType<typeof getCloudflareTunnelStatus>;
  tailscale: ReturnType<typeof getTailscaleStatus>;
}) {
  const candidates: ReturnType<typeof connectionCandidate>[] = [];
  if (input.desktopRuntimeConfig) {
    const savedBaseUrl = input.desktopRuntimeConfig.publicBaseUrl || input.desktopRuntimeConfig.baseUrl;
    const savedStability = savedBaseUrl.includes(".trycloudflare.com")
      ? "temporary"
      : input.desktopRuntimeConfig.mode === "local"
      ? "local"
      : input.desktopRuntimeConfig.mode === "lan"
      ? "temporary"
      : "stable";
    candidates.push(connectionCandidate({
      id: "saved-desktop-config",
      label: input.desktopRuntimeConfig.label || "Saved desktop startup config",
      baseUrl: savedBaseUrl,
      mode: input.desktopRuntimeConfig.mode,
      priority: savedStability === "stable" ? 97 : savedStability === "temporary" ? 74 : 12,
      requiresRestart: input.publicBaseUrl !== input.desktopRuntimeConfig.publicBaseUrl,
      stability: savedStability,
      notes: [
        input.desktopRuntimeConfig.publicBaseUrl
          ? "Saved desktop startup config. Quit and reopen LifeOS AI to make this address authoritative for pairing QR codes."
          : "Saved local/LAN startup config. Use only on the same trusted network.",
      ],
    }));
  }
  if (input.publicBaseUrl) {
    candidates.push(connectionCandidate({
      id: "configured-public",
      label: "Current PUBLIC_BASE_URL",
      baseUrl: input.publicBaseUrl,
      mode: "configured",
      priority: input.publicBaseUrl.startsWith("https://") ? 100 : 70,
      requiresRestart: false,
      stability: input.publicBaseUrl.includes(".trycloudflare.com") ? "temporary" : "stable",
      notes: input.publicBaseUrl.startsWith("https://")
        ? ["An HTTPS public/tunnel address is configured, so pairing QR codes will prefer it."]
        : ["The current PUBLIC_BASE_URL is not HTTPS. Use it only with Tailscale or a trusted private network."],
    }));
  }
  for (const [index, url] of input.cloudflare.detectedUrls.entries()) {
    candidates.push(connectionCandidate({
      id: `cloudflare-${index}`,
      label: index === 0 ? "Cloudflare Tunnel" : `Cloudflare Tunnel ${index + 1}`,
      baseUrl: url,
      mode: "cloudflare",
      priority: 84 - index,
      requiresRestart: input.publicBaseUrl !== url,
      stability: "temporary",
      notes: ["Good for quick HTTPS remote access, but trycloudflare.com quick tunnels are temporary and may change after restart."],
    }));
  }
  if (input.tailscale.httpsServeUrl) {
    candidates.push(connectionCandidate({
      id: "tailscale-serve-https",
      label: "Tailscale HTTPS Serve",
      baseUrl: input.tailscale.httpsServeUrl,
      mode: "tailscale",
      priority: input.tailscale.serveRunning ? 98 : 93,
      requiresRestart: input.publicBaseUrl !== input.tailscale.httpsServeUrl,
      stability: "stable",
      notes: [
        input.tailscale.serveRunning
          ? "Best for long-term remote phone access on your own Tailnet. HTTPS Serve is already active."
          : `Best for long-term remote phone access on your own Tailnet. Run: ${input.tailscale.serveCommand}`,
      ],
    }));
  }
  for (const [index, url] of input.tailscale.magicDnsUrls.entries()) {
    candidates.push(connectionCandidate({
      id: `tailscale-magicdns-${index}`,
      label: index === 0 ? "Tailscale MagicDNS" : `Tailscale MagicDNS ${index + 1}`,
      baseUrl: url,
      mode: "tailscale",
      priority: 64 - index,
      requiresRestart: input.publicBaseUrl !== url,
      stability: "temporary",
      notes: ["Tailscale MagicDNS over HTTP can help diagnose Tailnet reachability, but it is not a long-term phone/PWA entry. Start Tailscale HTTPS Serve and re-pair with the HTTPS address."],
    }));
  }
  for (const [index, url] of input.tailscale.urls.entries()) {
    candidates.push(connectionCandidate({
      id: `tailscale-ip-${index}`,
      label: index === 0 ? "Tailscale IP" : `Tailscale IP ${index + 1}`,
      baseUrl: url,
      mode: "tailscale",
      priority: 60 - index,
      requiresRestart: input.publicBaseUrl !== url,
      stability: "temporary",
      notes: ["Tailscale IP over HTTP is only a fallback for checking VPN reachability. Long-term remote use requires Tailscale HTTPS Serve so PWA, WebCrypto, and WebSocket behavior stay reliable."],
    }));
  }
  for (const [index, url] of input.lanUrls.entries()) {
    candidates.push(connectionCandidate({
      id: `lan-${index}`,
      label: index === 0 ? "LAN Wi-Fi" : `LAN address ${index + 1}`,
      baseUrl: url,
      mode: "lan",
      priority: 50 - index,
      requiresRestart: true,
      stability: "temporary",
      notes: ["Good for the same Wi-Fi network. It usually stops working after leaving this network."],
    }));
  }
  candidates.push(connectionCandidate({
    id: "local",
    label: "Local management",
    baseUrl: `http://127.0.0.1:${input.port}`,
    mode: "local",
    priority: 10,
    requiresRestart: false,
    stability: "local",
    notes: ["Only suitable for desktop-local management. Phones cannot access this QR code."],
  }));
  return candidates
    .filter((candidate, index, all) => all.findIndex((item) => item.baseUrl === candidate.baseUrl) === index)
    .sort((left, right) => right.priority - left.priority);
}

function buildRemoteReadiness(input: {
  host: string;
  publicBaseUrl: string;
  publicAccessAllowed: boolean;
  recommended: ConnectionCandidate | undefined;
}) {
  const candidate = input.recommended;
  const blockers: Array<{ id: RemoteReadinessItemId; detail?: string }> = [];
  const actions: Array<{ id: RemoteReadinessItemId; detail?: string }> = [];

  if (!candidate) {
    blockers.push({ id: "noRemoteEntry" });
    actions.push({ id: "noRemoteEntry" });
    return { status: "blocked", severity: "danger", candidateId: "", baseUrl: "", blockers, actions };
  }

  if (candidate.mode === "local") {
    blockers.push({ id: "localOnly", detail: candidate.baseUrl });
    actions.push({ id: "noRemoteEntry" });
    return { status: "local-only", severity: "danger", candidateId: candidate.id, baseUrl: candidate.baseUrl, blockers, actions };
  }

  if (candidate.mode === "lan") {
    blockers.push({ id: "lanOnly", detail: candidate.baseUrl });
    actions.push({ id: "noRemoteEntry" });
    return { status: "lan-only", severity: "warning", candidateId: candidate.id, baseUrl: candidate.baseUrl, blockers, actions };
  }

  if (!candidate.secure) {
    blockers.push({ id: "needsHttps", detail: candidate.baseUrl });
    actions.push({ id: "needsHttps" });
  }

  if ((input.host === "0.0.0.0" || input.publicBaseUrl || candidate.mode === "configured" || candidate.mode === "cloudflare") && !input.publicAccessAllowed) {
    blockers.push({ id: "needsPublicOptIn" });
    actions.push({ id: "needsPublicOptIn" });
  }

  if (candidate.requiresRestart) {
    actions.push({ id: "needsRestart", detail: candidate.baseUrl });
  }

  if (candidate.stability === "temporary") {
    actions.push({ id: "temporaryTunnel", detail: candidate.baseUrl });
  }

  if (blockers.length) {
    return { status: "blocked", severity: "danger", candidateId: candidate.id, baseUrl: candidate.baseUrl, blockers, actions };
  }
  if (candidate.requiresRestart) {
    return { status: "needs-restart", severity: "warning", candidateId: candidate.id, baseUrl: candidate.baseUrl, blockers, actions };
  }
  if (candidate.stability === "temporary") {
    return { status: "temporary", severity: "warning", candidateId: candidate.id, baseUrl: candidate.baseUrl, blockers, actions };
  }

  actions.push({ id: "ready", detail: candidate.baseUrl });
  return { status: "ready", severity: "ok", candidateId: candidate.id, baseUrl: candidate.baseUrl, blockers, actions };
}

function getCloudflareTunnelStatus(port: string) {
  const version = runCommand(cloudflaredCommand(), ["--version"]);
  const installed = version.ok;
  const processOutput = installed ? getProcessOutput("cloudflared") : { ok: false, output: "" };
  const managed = getManagedCloudflareTunnelStatus();
  const processRunning = installed && processOutput.ok && processOutput.output.toLowerCase().includes("cloudflared");
  const running = processRunning || managed.running;
  const detectedUrls = Array.from(new Set([
    ...extractCloudflareTunnelUrls(processOutput.output),
    ...(managed.url ? [managed.url] : []),
  ]));
  return {
    installed,
    running,
    managed,
    version: installed ? version.output.split("\n")[0] : "",
    detectedUrls,
    suggestedCommand: `cloudflared tunnel --url http://127.0.0.1:${port}`,
    installCommand: process.platform === "darwin" ? "brew install cloudflared" : "Download and install cloudflared, then confirm the command is available",
    installUrl: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    envTemplate: `LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 PUBLIC_BASE_URL=${detectedUrls[0] || "https://<your-tunnel>.trycloudflare.com"} npm run start`,
    notes: installed
      ? [
        running ? "A running cloudflared process was detected." : "cloudflared is installed. Run the command below to create a temporary HTTPS tunnel.",
        detectedUrls[0] ? `Temporary tunnel detected: ${detectedUrls[0]}` : "The temporary tunnel will output a trycloudflare.com address. Put it into PUBLIC_BASE_URL and restart LifeOS AI.",
      ]
      : [
        "cloudflared CLI was not detected. Install it to create a temporary HTTPS tunnel.",
        "Install with brew install cloudflared on macOS, or download it from Cloudflare releases.",
      ],
  };
}

function getTailscaleStatus(portOverride = String(process.env.LIFEOS_PORT || process.env.PORT || "3000")) {
  const version = runTailscaleCommand(["version", "--short"]);
  const installed = version.ok;
  const port = String(portOverride || process.env.LIFEOS_PORT || process.env.PORT || "3000");
  let online = false;
  let deviceName = "";
  let tailnetName = "";
  let urls: string[] = [];
  let magicDnsUrls: string[] = [];
  let httpsServeUrl = "";
  let serveRunning = false;
  let serveStatus = "";

  if (installed) {
    const status = runTailscaleCommand(["status", "--json"]);
    if (status.ok) {
      try {
        const parsed = JSON.parse(status.output);
        online = Boolean(parsed?.Self?.Online);
        deviceName = parsed?.Self?.HostName || "";
        tailnetName = parsed?.MagicDNSSuffix || "";
        urls = (parsed?.Self?.TailscaleIPs || []).map((ip: string) => `http://${ip}:${port}`);
        if (deviceName && tailnetName) {
          magicDnsUrls = [`http://${deviceName}.${tailnetName}:${port}`];
          httpsServeUrl = `https://${deviceName}.${tailnetName}`;
        }
      } catch {
        online = status.output.toLowerCase().includes("logged in");
      }
    }
    const serve = runTailscaleCommand(["serve", "status", "--json"]);
    serveStatus = serve.output;
    if (serve.ok) {
      serveRunning = Boolean(
        serve.output.includes(`127.0.0.1:${port}`)
          || serve.output.includes(`:${port}`),
      );
    } else {
      serveRunning = serve.output.toLowerCase().includes("https") && serve.output.includes(String(port));
    }
  }

  const mobileUrls = Array.from(new Set([...(httpsServeUrl ? [httpsServeUrl] : []), ...magicDnsUrls, ...urls]));
  const serveCommand = httpsServeUrl ? `tailscale serve --bg https:443 http://127.0.0.1:${port}` : "";
  const magicDnsEnabled = Boolean(deviceName && tailnetName);
  const httpsServeReady = Boolean(online && magicDnsEnabled && httpsServeUrl);
  const loginCommand = "tailscale up";

  return {
    installed,
    online,
    loginCommand,
    version: installed ? version.output.split("\n")[0] : "",
    deviceName,
    tailnetName,
    magicDnsEnabled,
    urls,
    magicDnsUrls,
    httpsServeUrl,
    httpsServeReady,
    serveRunning,
    serveCommand,
    serveStatus,
    mobileUrls,
    installCommand: process.platform === "darwin" ? "brew install --cask tailscale" : "Install the Tailscale client and sign in to the same Tailnet",
    installUrl: "https://tailscale.com/download",
    envTemplate: mobileUrls[0]
      ? `${httpsServeUrl ? "LIFEOS_HOST=127.0.0.1" : "LIFEOS_HOST=0.0.0.0"} LIFEOS_ALLOW_PUBLIC=1 PUBLIC_BASE_URL=${mobileUrls[0]} npm run start`
      : `LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start`,
    notes: installed
      ? [
        online ? "Tailscale is signed in and online. Prefer HTTPS Serve for phone PWA/WebCrypto support." : `Tailscale is installed, but no online status was detected. Run: ${loginCommand}`,
        !magicDnsEnabled
          ? "MagicDNS suffix was not detected. Enable MagicDNS in Tailscale admin so LifeOS can create a stable HTTPS Serve hostname."
          : httpsServeUrl
          ? serveRunning
            ? `HTTPS Serve appears active at ${httpsServeUrl}.`
            : `For the most reliable phone entry, run: ${serveCommand}`
          : "Enable HTTPS certificates in Tailscale to get a stable HTTPS Serve hostname.",
        "Tailscale is suitable for remote access between your own devices and usually avoids public internet exposure.",
      ]
      : [
        "Tailscale CLI was not detected. Install it, sign in, and join the phone and computer to the same Tailnet.",
      ],
  };
}

export function startTailscaleHttpsServe(port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000")) {
  const before = getTailscaleStatus(port);
  if (!before.installed) throw new Error("Tailscale CLI was not detected. Install Tailscale and sign in first.");
  if (!before.online) throw new Error("Tailscale is installed but not online. Sign in and connect this computer to your Tailnet first.");
  if (!before.httpsServeUrl) throw new Error("Tailscale MagicDNS/HTTPS name was not detected. Enable MagicDNS and HTTPS certificates in Tailscale first.");

  const command = before.serveCommand || `tailscale serve --bg https:443 http://127.0.0.1:${port}`;
  const result = runManagedTailscaleCommand(["serve", "--bg", "https:443", `http://127.0.0.1:${port}`]);
  if (!result.ok) throw new Error(result.output || "Failed to start Tailscale HTTPS Serve");

  const after = getTailscaleStatus(port);
  return {
    ok: true,
    command,
    output: result.output,
    url: after.httpsServeUrl || before.httpsServeUrl,
    status: after,
  };
}

export function stopTailscaleHttpsServe() {
  const before = getTailscaleStatus();
  if (!before.installed) throw new Error("Tailscale CLI was not detected.");
  const result = runManagedTailscaleCommand(["serve", "--https=443", "off"]);
  if (!result.ok) throw new Error(result.output || "Failed to stop Tailscale HTTPS Serve");
  const after = getTailscaleStatus();
  return {
    ok: true,
    command: "tailscale serve --https=443 off",
    output: result.output,
    url: before.httpsServeUrl,
    status: after,
  };
}

function isTailscaleServeAutostartDisabled() {
  return process.env.LIFEOS_DISABLE_TAILSCALE_SERVE_AUTOSTART === "1"
    || process.env.LIFEOS_TAILSCALE_SERVE_AUTOSTART === "0";
}

export function maybeStartConfiguredTailscaleServe(port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000")) {
  const config = getDesktopRuntimeConfig();
  if (!config || config.mode !== "tailscale" || !config.publicBaseUrl.startsWith("https://") || isTailscaleServeAutostartDisabled()) {
    return { started: false, reason: "not_configured", serve: null, config };
  }

  const status = getTailscaleStatus(port);
  if (status.serveRunning && status.httpsServeUrl) {
    process.env.PUBLIC_BASE_URL = status.httpsServeUrl;
    const updatedConfig = saveDesktopRuntimeConfig({
      mode: "tailscale",
      label: config.label || "Tailscale HTTPS Serve",
      baseUrl: status.httpsServeUrl,
    });
    return {
      started: false,
      reason: "already_running",
      serve: { ok: true, command: status.serveCommand, output: status.serveStatus, url: status.httpsServeUrl, status },
      config: updatedConfig,
    };
  }

  const serve = startTailscaleHttpsServe(port);
  process.env.PUBLIC_BASE_URL = serve.url;
  const updatedConfig = saveDesktopRuntimeConfig({
    mode: "tailscale",
    label: config.label || "Tailscale HTTPS Serve",
    baseUrl: serve.url,
  });
  return {
    started: true,
    reason: "tailscale_configured",
    serve,
    config: updatedConfig,
  };
}

export function getNetworkDiagnostics() {
  const port = process.env.LIFEOS_PORT || process.env.PORT || "3000";
  const host = process.env.LIFEOS_HOST || "127.0.0.1";
  const publicBaseUrl = getConfiguredPublicBaseUrl();
  const desktopRuntimeConfig = getDesktopRuntimeConfig();
  const lanUrls = getLanUrls(port);
  const cloudflare = getCloudflareTunnelStatus(port);
  const tailscale = getTailscaleStatus(port);
  const connectionCandidates = buildConnectionCandidates({ port, publicBaseUrl, lanUrls, desktopRuntimeConfig, cloudflare, tailscale });
  const recommendedBaseUrl = connectionCandidates[0]?.baseUrl || `http://127.0.0.1:${port}`;
  const remoteReadiness = buildRemoteReadiness({
    host,
    publicBaseUrl,
    publicAccessAllowed: process.env.LIFEOS_ALLOW_PUBLIC === "1",
    recommended: connectionCandidates[0],
  });

  return {
    host,
    port,
    publicBaseUrl,
    publicAccessAllowed: process.env.LIFEOS_ALLOW_PUBLIC === "1",
    lanUrls,
    lanEnvTemplate: `LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 npm run start`,
    recommendedBaseUrl,
    remoteReadiness,
    connectionCandidates,
    desktopRuntimeConfig,
    cloudflare,
    tailscale,
    safety: {
      publicModeRequired: host === "0.0.0.0" || Boolean(publicBaseUrl),
      requiresHttpsForInternet: Boolean(publicBaseUrl) && !publicBaseUrl.startsWith("https://"),
      notes: [
        "Prefer Tailscale or Cloudflare Tunnel for remote access.",
        "Public internet access requires LIFEOS_ALLOW_PUBLIC=1 and a trusted HTTPS tunnel or reverse proxy in front.",
      ],
    },
  };
}

async function probeFetchStep(id: ConnectionProbeStep["id"], url: URL, validate: (response: Response, body: string) => boolean, signal: AbortSignal): Promise<ConnectionProbeStep> {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { signal });
    const body = await response.text().catch(() => "");
    return {
      id,
      ok: response.ok && validate(response, body),
      status: response.status,
      url: url.toString(),
      latencyMs: Date.now() - startedAt,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error: any) {
    return {
      id,
      ok: false,
      status: 0,
      url: url.toString(),
      latencyMs: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "Connection test timed out" : error?.message || "Connection test failed",
    };
  }
}

async function probeWebSocketOnce(url: URL, timeoutMs: number): Promise<ConnectionProbeStep> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (step: ConnectionProbeStep) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(step);
    };
    const timer = setTimeout(() => {
      done({ id: "websocket", ok: false, status: 0, url: url.toString(), latencyMs: Date.now() - startedAt, error: "WebSocket test timed out" });
    }, timeoutMs);
    const ws = new WebSocket(url);
    ws.once("open", () => {
      done({ id: "websocket", ok: true, status: 101, url: url.toString(), latencyMs: Date.now() - startedAt });
    });
    ws.once("error", (error: any) => {
      done({ id: "websocket", ok: false, status: 0, url: url.toString(), latencyMs: Date.now() - startedAt, error: error?.message || "WebSocket connection failed" });
    });
  });
}

async function probeWebSocketStep(url: URL, timeoutMs: number): Promise<ConnectionProbeStep> {
  const first = await probeWebSocketOnce(url, timeoutMs);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, 750));
  const second = await probeWebSocketOnce(url, timeoutMs);
  return {
    ...second,
    latencyMs: first.latencyMs + 750 + second.latencyMs,
    error: second.ok ? undefined : second.error || first.error,
  };
}

function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function buildConnectionRepairHints(input: {
  parsed: URL;
  steps: ConnectionProbeStep[];
  publicAccessWarning?: boolean;
}) {
  const hints: ConnectionRepairHint[] = [];
  const add = (hint: ConnectionRepairHint) => {
    if (!hints.some((item) => item.id === hint.id && item.stepId === hint.stepId)) hints.push(hint);
  };

  if (isLoopbackHost(input.parsed.hostname)) {
    add({ id: "localhost-phone-unreachable", severity: "warning" });
  }
  if (input.parsed.protocol !== "https:") {
    add({ id: "https-required", severity: "warning" });
  }
  if (input.publicAccessWarning) {
    add({ id: "public-mode-risk", severity: "danger" });
  }

  for (const step of input.steps) {
    if (step.ok) continue;
    if (step.id === "health") {
      add({
        id: step.status === 0 ? "desktop-service-unreachable" : "wrong-lifeos-target",
        stepId: step.id,
        severity: "danger",
      });
    }
    if (step.id === "mobile-shell") {
      add({ id: "mobile-shell-missing", stepId: step.id, severity: "warning" });
    }
    if (step.id === "websocket") {
      add({ id: "websocket-upgrade-blocked", stepId: step.id, severity: "warning" });
    }
  }

  return hints;
}

export async function testConnectionUrl(baseUrl: string, options: { includeWebSocket?: boolean } = {}) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP/HTTPS URLs can be tested");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const basePath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  const healthUrl = new URL(`${basePath}/api/v1/health`, parsed.origin);
  const mobileShellUrl = new URL(`${basePath}/mobile/chat`, parsed.origin);
  const wsUrl = new URL(`${basePath}/api/v1/ws`, parsed.origin);
  wsUrl.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const httpsProtocol = parsed.protocol.replace(":", "");
  const startedAt = Date.now();
  try {
    let publicAccessWarning = false;
    const health = await probeFetchStep("health", healthUrl, (_response, body) => {
      try {
        const parsedBody = JSON.parse(body);
        publicAccessWarning = Boolean(parsedBody?.publicAccessWarning);
        return parsedBody?.service === "lifeos-local-core";
      } catch {
        return false;
      }
    }, controller.signal);
    const mobileShell = await probeFetchStep("mobile-shell", mobileShellUrl, (_response, body) => body.includes("LifeOS AI") || body.includes("lifeos"), controller.signal);
    const steps = [health, mobileShell];
    if (options.includeWebSocket !== false) {
      steps.push(await probeWebSocketStep(wsUrl, 3000));
    }
    const ok = steps.every((step) => step.ok);
    const fixes = buildConnectionRepairHints({ parsed, steps, publicAccessWarning });
    return {
      ok,
      httpsStatus: {
        ok: parsed.protocol === "https:" && health.ok,
        protocol: httpsProtocol,
        requiredForLongTerm: true,
        trustedByRuntime: parsed.protocol === "https:" && health.ok,
        error: parsed.protocol === "https:" ? undefined : "Remote entry is not using HTTPS.",
      },
      status: health.status,
      url: healthUrl.toString(),
      latencyMs: Date.now() - startedAt,
      service: health.ok ? "lifeos-local-core" : "",
      publicAccessWarning,
      steps,
      fixes,
      error: ok ? undefined : steps.find((step) => !step.ok)?.error || "Remote entry check failed",
    };
  } catch (error: any) {
    const steps: ConnectionProbeStep[] = [];
    return {
      ok: false,
      httpsStatus: {
        ok: false,
        protocol: httpsProtocol,
        requiredForLongTerm: true,
        trustedByRuntime: false,
        error: error?.name === "AbortError" ? "Connection test timed out" : error?.message || "Connection test failed",
      },
      status: 0,
      url: healthUrl.toString(),
      latencyMs: Date.now() - startedAt,
      steps,
      fixes: buildConnectionRepairHints({ parsed, steps }),
      error: error?.name === "AbortError" ? "Connection test timed out" : error?.message || "Connection test failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
