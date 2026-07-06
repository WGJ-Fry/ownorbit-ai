import { execFileSync, spawnSync } from "child_process";
import crypto from "crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { WebSocket } from "ws";
import { extractCloudflareTunnelUrls, getManagedCloudflareTunnelStatus } from "./cloudflareTunnel.ts";
import { DesktopRuntimeConfig, getDesktopRuntimeConfig, saveDesktopRuntimeConfig } from "./desktopRuntimeConfig.ts";
import { getConfiguredPublicBaseUrl, isTemporaryTryCloudflareUrl } from "./publicBaseUrl";

type CommandResult = {
  ok: boolean;
  output: string;
};

const macBrewCandidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
const macTailscaleCandidates = [
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/tailscale",
];

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

const ICLOUD_HANDOFF_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const ICLOUD_HANDOFF_EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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

function runManagedCommand(command: string, args: string[] = [], timeoutMs = 15000): CommandResult {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
      env: process.env,
    });
    return { ok: true, output: output.trim() };
  } catch (error: any) {
    const output = `${error?.stdout || ""}${error?.stderr || ""}`.trim();
    return { ok: false, output: output || error?.message || "Command failed" };
  }
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function openTerminalWithCommand(command: string): CommandResult {
  if (process.platform !== "darwin") return { ok: false, output: "Terminal launch is only supported on macOS." };
  if (process.env.LIFEOS_DISABLE_TAILSCALE_TERMINAL_OPEN === "1") {
    return { ok: false, output: "Terminal launch disabled by LIFEOS_DISABLE_TAILSCALE_TERMINAL_OPEN." };
  }
  const script = [
    'tell application "Terminal"',
    "activate",
    `do script ${JSON.stringify(command)}`,
    "end tell",
  ].join("\n");
  const result = spawnSync("osascript", ["-e", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function isExecutableFile(filePath: string) {
  try {
    return existsSync(filePath) && (accessSync(filePath, constants.X_OK), true);
  } catch {
    return false;
  }
}

function shellDetectedCommand(command: string) {
  if (!/^[a-z0-9._-]+$/i.test(command)) return "";
  const result = runCommand("/bin/zsh", ["-lc", `command -v ${command}`]);
  if (!result.ok) return "";
  const detected = result.output.split("\n")[0]?.trim() || "";
  return detected.startsWith("/") && isExecutableFile(detected) ? detected : "";
}

function resolveExecutable(command: string, candidates: string[], checkArgs: string[]) {
  const candidate = candidates.find((filePath) => isExecutableFile(filePath) && runCommand(filePath, checkArgs).ok);
  if (candidate) return candidate;
  if (runCommand(command, checkArgs).ok) return command;
  return shellDetectedCommand(command) || command;
}

function cloudflaredCommand() {
  return process.env.LIFEOS_CLOUDFLARED_BIN || "cloudflared";
}

function brewCommand() {
  return process.env.LIFEOS_BREW_BIN || resolveExecutable("brew", process.platform === "darwin" ? macBrewCandidates : [], ["--version"]);
}

function tailscaleCommand() {
  return process.env.LIFEOS_TAILSCALE_BIN || resolveExecutable("tailscale", process.platform === "darwin" ? macTailscaleCandidates : [], ["version", "--short"]);
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

function isUsableLanIPv4(address: string) {
  if (/^10\./.test(address)) return true;
  if (/^192\.168\./.test(address)) return true;
  const match = address.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function getLanUrls(port: string) {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries || [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal && isUsableLanIPv4(entry.address))
    .map((entry) => `http://${entry.address}:${port}`);
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scriptJson(value: unknown) {
  return String(JSON.stringify(value) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function writePrivateFileAtomic(targetPath: string, body: string) {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmpPath, body, { mode: 0o600 });
    renameSync(tmpPath, targetPath);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {}
    throw error;
  }
}

function buildIcloudEntryChecksum(packet: Record<string, unknown>) {
  const checksumPayload = {
    version: packet.version,
    generatedAt: packet.generatedAt,
    refreshAfter: packet.refreshAfter,
    expiresAt: packet.expiresAt,
    candidateId: packet.candidateId,
    baseUrl: packet.baseUrl,
    mobilePairUrl: packet.mobilePairUrl,
    mobileChatUrl: packet.mobileChatUrl,
    mode: packet.mode,
    secure: packet.secure,
    stability: packet.stability,
    requiresRestart: packet.requiresRestart,
    transport: packet.transport,
    realtimeTransport: packet.realtimeTransport,
  };
  return crypto.createHash("sha256").update(JSON.stringify(checksumPayload)).digest("hex");
}

function appendIcloudHandoffParams(entryUrl: string, packet: Record<string, unknown>) {
  try {
    const url = new URL(entryUrl);
    url.searchParams.set("lifeosEntry", "icloud");
    url.searchParams.set("entryGeneratedAt", String(packet.generatedAt || ""));
    url.searchParams.set("entryRefreshAfter", String(packet.refreshAfter || ""));
    url.searchParams.set("entryExpiresAt", String(packet.expiresAt || ""));
    url.searchParams.set("entryBaseUrl", String(packet.baseUrl || ""));
    url.searchParams.set("entryMode", String(packet.mode || ""));
    url.searchParams.set("entryStability", String(packet.stability || ""));
    url.searchParams.set("entryLabel", String(packet.label || ""));
    return url.toString();
  } catch {
    return entryUrl;
  }
}

function isApplePlatform() {
  return process.platform === "darwin" || process.env.LIFEOS_FORCE_ICLOUD_HANDOFF === "1";
}

function iCloudDrivePath() {
  const override = String(process.env.LIFEOS_ICLOUD_DRIVE_DIR || "").trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs");
}

function preferredHandoffCandidate(candidates: ConnectionCandidate[]) {
  return (
    candidates.find((candidate) => candidate.mode !== "local" && candidate.secure && candidate.stability === "stable") ||
    candidates.find((candidate) => candidate.mode !== "local" && candidate.secure) ||
    candidates.find((candidate) => candidate.mode !== "local") ||
    null
  );
}

function readIcloudHandoffPacket(packetFilePath: string) {
  if (!packetFilePath || !existsSync(packetFilePath)) return null;
  try {
    const packet = JSON.parse(readFileSync(packetFilePath, "utf8"));
    return packet && typeof packet === "object" ? packet as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function buildIcloudHandoffHealth(input: {
  packetFilePath: string;
  candidate: ConnectionCandidate | null;
  now?: number;
}) {
  const now = input.now || Date.now();
  const packet = readIcloudHandoffPacket(input.packetFilePath);
  const generatedAt = Number(packet?.generatedAt || 0);
  const exportedBaseUrl = String(packet?.baseUrl || "");
  const expiresAt = Number(packet?.expiresAt || (generatedAt ? generatedAt + ICLOUD_HANDOFF_EXPIRES_AFTER_MS : 0));
  const refreshAfter = Number(packet?.refreshAfter || (generatedAt ? generatedAt + ICLOUD_HANDOFF_REFRESH_AFTER_MS : 0));
  let status: "missing" | "fresh" | "stale" | "address-changed" | "expired" = "missing";
  let reason = "No iCloud mobile entry has been exported yet.";

  if (packet && generatedAt > 0) {
    if (expiresAt > 0 && now >= expiresAt) {
      status = "expired";
      reason = "The iCloud mobile entry is older than the recommended recovery window.";
    } else if (input.candidate?.baseUrl && exportedBaseUrl && input.candidate.baseUrl !== exportedBaseUrl) {
      status = "address-changed";
      reason = "The best phone entry changed after the last iCloud export.";
    } else if (refreshAfter > 0 && now >= refreshAfter) {
      status = "stale";
      reason = "The iCloud mobile entry should be refreshed after a day or after any network change.";
    } else {
      status = "fresh";
      reason = "The iCloud mobile entry is fresh.";
    }
  }

  return {
    status,
    needsRefresh: status !== "fresh",
    lastExportedAt: generatedAt || 0,
    lastExportedBaseUrl: exportedBaseUrl,
    refreshAfter: refreshAfter || 0,
    expiresAt: expiresAt || 0,
    refreshAfterMs: ICLOUD_HANDOFF_REFRESH_AFTER_MS,
    expiresAfterMs: ICLOUD_HANDOFF_EXPIRES_AFTER_MS,
    reason,
  };
}

function summarizeIcloudFallbackCandidates(candidates: ConnectionCandidate[]) {
  return candidates
    .filter((candidate) => candidate.mode !== "local")
    .slice(0, 5)
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      mode: candidate.mode,
      baseUrl: candidate.baseUrl,
      mobilePairUrl: candidate.mobilePairUrl,
      mobileChatUrl: candidate.mobileChatUrl,
      secure: candidate.secure,
      stability: candidate.stability,
      requiresRestart: candidate.requiresRestart,
      notes: candidate.notes.slice(0, 3),
    }));
}

function getIcloudHandoffStatus(candidates: ConnectionCandidate[]) {
  const platformSupported = isApplePlatform();
  const drivePath = iCloudDrivePath();
  const available = platformSupported && existsSync(drivePath);
  const appFolderPath = path.join(drivePath, "LifeOS AI");
  const handoffFilePath = path.join(appFolderPath, "lifeos-mobile-entry.html");
  const packetFilePath = path.join(appFolderPath, "lifeos-mobile-entry.json");
  const candidate = preferredHandoffCandidate(candidates);
  const hasPhoneEntry = Boolean(candidate);
  const handoffHealth = buildIcloudHandoffHealth({ packetFilePath, candidate });
  return {
    platform: process.platform,
    platformSupported,
    available,
    canExport: available && hasPhoneEntry,
    drivePath: available ? drivePath : "",
    appFolderPath: available ? appFolderPath : "",
    handoffFilePath: available ? handoffFilePath : "",
    packetFilePath: available ? packetFilePath : "",
    recommendedBaseUrl: candidate?.baseUrl || "",
    recommendedLabel: candidate?.label || "",
    recommendedMode: candidate?.mode || "",
    recommendedStability: candidate?.stability || "",
    handoffHealth,
    realtimeTransport: false,
    transport: "handoff-only" as const,
    openInstruction: available
      ? "Open Files on iPhone or iPad, go to iCloud Drive > LifeOS AI, then open lifeos-mobile-entry.html."
      : "Enable iCloud Drive on this Mac, then retry the LifeOS iCloud handoff export.",
    notes: [
      "iCloud Handoff syncs the current mobile entry file between Apple devices.",
      "iCloud Handoff does not create a live network tunnel. The mobile entry still needs LAN, Cloudflare, Tailscale, or another reachable HTTPS/LAN address.",
      candidate?.baseUrl
        ? `Current handoff entry: ${candidate.label} (${candidate.baseUrl}).`
        : "No phone-reachable entry is available yet; use same Wi-Fi or configure an HTTPS remote entry first.",
      handoffHealth.reason,
    ],
  };
}

function buildIcloudHandoffHtml(input: { generatedAt: number; candidate: ConnectionCandidate; packet: Record<string, unknown> }) {
  const title = "LifeOS AI Mobile Entry";
  const generatedAt = new Date(input.generatedAt).toLocaleString();
  const refreshAfter = typeof input.packet.refreshAfter === "number" ? new Date(input.packet.refreshAfter).toLocaleString() : "-";
  const expiresAt = typeof input.packet.expiresAt === "number" ? new Date(input.packet.expiresAt).toLocaleString() : "-";
  const remoteReady = input.candidate.secure && input.candidate.stability === "stable" && !input.candidate.requiresRestart;
  const fallbackCount = Array.isArray(input.packet.fallbackCandidates) ? input.packet.fallbackCandidates.length : 0;
  const mobilePairUrl = appendIcloudHandoffParams(input.candidate.mobilePairUrl, input.packet);
  const mobileChatUrl = appendIcloudHandoffParams(input.candidate.mobileChatUrl, input.packet);
  const recoverySummary = [
    "LifeOS iCloud Mobile Entry Recovery",
    `status=${remoteReady ? "ready" : "needs-refresh-after-network-change"}`,
    `entryBaseUrl=${input.candidate.baseUrl}`,
    `mode=${input.candidate.mode}`,
    `stability=${input.candidate.stability}`,
    `requiresRestart=${input.candidate.requiresRestart}`,
    `generatedAt=${new Date(input.generatedAt).toISOString()}`,
    `refreshAfter=${typeof input.packet.refreshAfter === "number" ? new Date(input.packet.refreshAfter).toISOString() : "-"}`,
    `expiresAt=${typeof input.packet.expiresAt === "number" ? new Date(input.packet.expiresAt).toISOString() : "-"}`,
    `entryChecksumSha256=${input.packet.entryChecksumSha256 || "-"}`,
    `warning=${input.packet.warning || "iCloud syncs the entry file; it is not a live tunnel."}`,
  ].join("\n");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin: 0; min-height: 100vh; background: #060a10; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid; place-items: center; padding: 20px; }
      main { width: min(560px, 100%); border: 1px solid rgba(255,255,255,.1); background: #101722; border-radius: 28px; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
      h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
      h2 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
      p { color: #a1a1aa; line-height: 1.65; }
      a, button { display: flex; align-items: center; justify-content: center; box-sizing: border-box; min-height: 48px; width: 100%; margin-top: 14px; border-radius: 16px; border: 0; background: #22d3ee; color: #061016; text-decoration: none; font: inherit; font-weight: 800; }
      .secondary { background: rgba(255,255,255,.06); color: #e4e4e7; border: 1px solid rgba(255,255,255,.1); }
      .pill { display: inline-flex; align-items: center; margin-top: 14px; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 800; background: ${remoteReady ? "rgba(16,185,129,.16)" : "rgba(245,158,11,.16)"}; color: ${remoteReady ? "#bbf7d0" : "#fde68a"}; }
      .meta, .panel { margin-top: 18px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.04); color: #cbd5e1; font-size: 12px; line-height: 1.6; word-break: break-all; }
      .warn { margin-top: 14px; color: #fef3c7; font-size: 12px; line-height: 1.65; }
      .steps { margin: 14px 0 0; padding-left: 18px; color: #cbd5e1; font-size: 12px; line-height: 1.7; }
      .en { margin-top: 10px; color: #94a3b8; font-size: 12px; line-height: 1.6; }
      .age { margin-top: 14px; border-radius: 16px; padding: 12px; font-size: 12px; line-height: 1.65; border: 1px solid rgba(255,255,255,.1); }
      .age-ok { background: rgba(16,185,129,.14); color: #bbf7d0; }
      .age-warn { background: rgba(245,158,11,.15); color: #fde68a; }
      .age-danger { background: rgba(239,68,68,.15); color: #fecaca; }
      textarea { box-sizing: border-box; width: 100%; min-height: 150px; margin-top: 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(0,0,0,.18); color: #cbd5e1; padding: 12px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.55; }
      .copied { display: none; margin-top: 8px; color: #bbf7d0; font-size: 12px; font-weight: 800; }
    </style>
  </head>
  <body>
    <main>
      <h1>LifeOS AI</h1>
      <p>这是通过 iCloud Drive 同步到这台 Apple 设备的 LifeOS 手机入口。先点“绑定这台设备”；已经绑定过时，可以直接打开手机聊天。</p>
      <p class="en">This LifeOS mobile entry was synced through iCloud Drive. Pair this device first, or open mobile chat if it is already paired.</p>
      <div class="pill">${remoteReady ? "适合长期异地使用 / Ready for long-term remote use" : "可先打开，换网后请刷新 / Refresh after network changes"}</div>
      <div class="age age-ok" id="entry-age-status">正在检查入口是否过期 / Checking entry freshness...</div>
      <a href="${htmlEscape(mobilePairUrl)}">绑定这台设备 / Pair This Device</a>
      <a class="secondary" href="${htmlEscape(mobileChatUrl)}">打开手机聊天 / Open Mobile Chat</a>
      <div class="meta">
        <strong>${htmlEscape(input.candidate.label)}</strong><br />
        ${htmlEscape(input.candidate.baseUrl)}<br />
        生成时间 / Generated: ${htmlEscape(generatedAt)}<br />
        建议刷新 / Refresh after: ${htmlEscape(refreshAfter)}<br />
        过期时间 / Expires: ${htmlEscape(expiresAt)}<br />
        备用入口 / Fallback entries: ${htmlEscape(fallbackCount)}
      </div>
      <ol class="steps">
        <li>如果绑定失败，回到电脑端 LifeOS，重新导出 iCloud 手机入口。</li>
        <li>如果同一 Wi-Fi 能打开、离家后打不开，请在电脑端启用 Tailscale HTTPS Serve 或 Cloudflare Tunnel。</li>
        <li>如果旧二维码过期或打开了错误地址，请从电脑端重新生成二维码。</li>
      </ol>
      <div class="warn">iCloud 只同步这个入口文件，不会创建实时网络隧道。如果这里的地址只能在同一 Wi-Fi 使用，异地聊天仍需要一个可访问的 HTTPS 入口。</div>
      <div class="panel">
        <h2>排障摘要 / Recovery Summary</h2>
        <div>如果手机打不开，把下面这段信息复制给电脑端或开发者排查。它不包含绑定 token 或密码。</div>
        <textarea id="lifeos-recovery" readonly>${htmlEscape(recoverySummary)}</textarea>
        <button class="secondary" type="button" id="copy-recovery">复制修复信息 / Copy Recovery Info</button>
        <div class="copied" id="copy-status">已复制 / Copied</div>
      </div>
      <script type="application/json" id="lifeos-entry">${scriptJson(input.packet)}</script>
      <script>
        (() => {
          const status = document.getElementById("entry-age-status");
          const packetNode = document.getElementById("lifeos-entry");
          if (!status || !packetNode) return;
          try {
            const packet = JSON.parse(packetNode.textContent || "{}");
            const now = Date.now();
            const refreshAfter = Number(packet.refreshAfter || 0);
            const expiresAt = Number(packet.expiresAt || 0);
            status.classList.remove("age-ok", "age-warn", "age-danger");
            if (expiresAt && now >= expiresAt) {
              status.classList.add("age-danger");
              status.textContent = "入口已过期：请回电脑端重新导出 iCloud 手机入口，再重新打开。 / Entry expired: export a fresh iCloud mobile entry from the desktop, then reopen it.";
            } else if (refreshAfter && now >= refreshAfter) {
              status.classList.add("age-warn");
              status.textContent = "建议刷新：换 Wi-Fi、重启电脑或重启隧道后，请回电脑端重新导出。 / Refresh suggested after Wi-Fi, desktop, or tunnel changes.";
            } else {
              status.classList.add("age-ok");
              status.textContent = "入口仍然新鲜：可以继续绑定或打开聊天。 / Entry is fresh. You can pair or open chat.";
            }
          } catch {
            status.classList.add("age-warn");
            status.textContent = "无法读取入口状态：如果打不开，请回电脑端重新导出。 / Could not read entry status; export again if it does not open.";
          }
        })();
        document.getElementById("copy-recovery")?.addEventListener("click", async () => {
          const textarea = document.getElementById("lifeos-recovery");
          const status = document.getElementById("copy-status");
          try {
            await navigator.clipboard.writeText(textarea.value);
          } catch {
            textarea.focus();
            textarea.select();
            document.execCommand("copy");
          }
          if (status) {
            status.style.display = "block";
            window.setTimeout(() => { status.style.display = "none"; }, 1400);
          }
        });
      </script>
    </main>
  </body>
</html>`;
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
  const trustProxy = secure && input.mode !== "local" && input.mode !== "lan" ? " LIFEOS_TRUST_PROXY=1" : "";
  const envTemplate = input.mode === "local"
    ? `LIFEOS_HOST=127.0.0.1 LIFEOS_PORT=${parsedBaseUrl.port || "3000"} npm run start`
    : `LIFEOS_HOST=${host} LIFEOS_ALLOW_PUBLIC=1${trustProxy} PUBLIC_BASE_URL=${normalizedBaseUrl} npm run start`;
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
  const isActiveTemporaryCloudflareUrl = (baseUrl: string) => (
    isTemporaryTryCloudflareUrl(baseUrl) && input.cloudflare.detectedUrls.includes(baseUrl)
  );
  if (input.desktopRuntimeConfig) {
    const savedBaseUrl = input.desktopRuntimeConfig.publicBaseUrl || input.desktopRuntimeConfig.baseUrl;
    const savedIsTemporaryCloudflare = isTemporaryTryCloudflareUrl(savedBaseUrl);
    const savedTemporaryIsActive = isActiveTemporaryCloudflareUrl(savedBaseUrl) || input.publicBaseUrl === savedBaseUrl;
    const shouldIncludeSavedConfig = Boolean(savedBaseUrl && (!savedIsTemporaryCloudflare || savedTemporaryIsActive));
    const savedStability = savedIsTemporaryCloudflare
      ? "temporary"
      : input.desktopRuntimeConfig.mode === "local"
      ? "local"
      : input.desktopRuntimeConfig.mode === "lan"
      ? "temporary"
      : "stable";
    if (shouldIncludeSavedConfig) {
      candidates.push(connectionCandidate({
        id: "saved-desktop-config",
        label: input.desktopRuntimeConfig.label || "Saved desktop startup config",
        baseUrl: savedBaseUrl,
        mode: input.desktopRuntimeConfig.mode,
        priority: savedStability === "stable" ? 97 : savedStability === "temporary" ? 74 : 12,
        requiresRestart: input.publicBaseUrl !== input.desktopRuntimeConfig.publicBaseUrl,
        stability: savedStability,
        notes: [
          savedIsTemporaryCloudflare
            ? "Saved temporary Cloudflare Tunnel is currently running and detected. If it stops resolving, restart the Tunnel and generate a fresh entry."
            : input.desktopRuntimeConfig.publicBaseUrl
            ? "Saved desktop startup config. Quit and reopen LifeOS AI to make this address authoritative for pairing QR codes."
            : "Saved local/LAN startup config. Use only on the same trusted network.",
        ],
      }));
    }
  }
  const publicIsTemporaryCloudflare = isTemporaryTryCloudflareUrl(input.publicBaseUrl);
  if (input.publicBaseUrl && (!publicIsTemporaryCloudflare || isActiveTemporaryCloudflareUrl(input.publicBaseUrl))) {
    candidates.push(connectionCandidate({
      id: "configured-public",
      label: "Current PUBLIC_BASE_URL",
      baseUrl: input.publicBaseUrl,
      mode: "configured",
      priority: input.publicBaseUrl.startsWith("https://") ? 100 : 70,
      requiresRestart: false,
      stability: publicIsTemporaryCloudflare ? "temporary" : "stable",
      notes: publicIsTemporaryCloudflare
        ? ["The current temporary Cloudflare Tunnel is running and detected. Generate a fresh entry if the phone reports DNS or connectivity errors."]
        : input.publicBaseUrl.startsWith("https://")
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

function isStaleTemporaryDesktopRuntimeConfig(input: {
  config: DesktopRuntimeConfig | null;
  publicBaseUrl: string;
  cloudflare: ReturnType<typeof getCloudflareTunnelStatus>;
}) {
  const savedBaseUrl = input.config?.publicBaseUrl || input.config?.baseUrl || "";
  if (!isTemporaryTryCloudflareUrl(savedBaseUrl)) return false;
  return input.publicBaseUrl !== savedBaseUrl && !input.cloudflare.detectedUrls.includes(savedBaseUrl);
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
    envTemplate: `LIFEOS_HOST=0.0.0.0 LIFEOS_ALLOW_PUBLIC=1 LIFEOS_TRUST_PROXY=1 PUBLIC_BASE_URL=${detectedUrls[0] || "https://<your-tunnel>.trycloudflare.com"} npm run start`,
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
  const brew = process.platform === "darwin" ? runCommand(brewCommand(), ["--version"]) : { ok: false, output: "" };
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
    installCommand: process.platform === "darwin" ? "brew install --cask tailscale-app" : "Install the Tailscale client and sign in to the same Tailnet",
    installUrl: "https://tailscale.com/download",
    autoInstall: {
      available: process.platform === "darwin" && brew.ok,
      method: process.platform === "darwin" ? "homebrew-cask" : "manual",
      command: "brew install --cask tailscale-app",
      reason: installed
        ? "already-installed"
        : process.platform !== "darwin"
        ? "unsupported-platform"
        : brew.ok
        ? "terminal-password-required"
        : "homebrew-missing",
    },
    envTemplate: mobileUrls[0]
      ? `${httpsServeUrl ? "LIFEOS_HOST=127.0.0.1" : "LIFEOS_HOST=0.0.0.0"} LIFEOS_ALLOW_PUBLIC=1${httpsServeUrl ? " LIFEOS_TRUST_PROXY=1" : ""} PUBLIC_BASE_URL=${mobileUrls[0]} npm run start`
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

export function installTailscaleClient(confirm: unknown, port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000")) {
  if (confirm !== "install-tailscale") {
    throw new Error("Tailscale install requires explicit confirmation.");
  }
  const before = getTailscaleStatus(port);
  if (before.installed) {
    return {
      ok: true,
      alreadyInstalled: true,
      command: "",
      output: "",
      status: before,
      message: "Tailscale is already installed. Open Tailscale, sign in, then start HTTPS Serve.",
    };
  }
  if (process.platform !== "darwin") {
    throw new Error("Automatic Tailscale install is only supported on macOS with Homebrew. Open the Tailscale download page for this platform.");
  }
  const brewBin = brewCommand();
  const brew = runCommand(brewBin, ["--version"]);
  if (!brew.ok) {
    throw new Error("Homebrew was not detected. Install Tailscale from the download page, or install Homebrew first and retry.");
  }

  const command = "brew install --cask tailscale-app";
  const terminalCommand = [
    `${shellQuote(brewBin)} install --cask tailscale-app`,
    "open -a Tailscale",
    "echo ''",
    "echo 'Tailscale install finished. Return to LifeOS AI and click refresh, then sign in to Tailscale.'",
  ].join(" && ");
  const terminal = openTerminalWithCommand(terminalCommand);
  return {
    ok: false,
    alreadyInstalled: false,
    needsUserAction: true,
    terminalOpened: terminal.ok,
    action: terminal.ok ? "terminal-opened" : "copy-command",
    command,
    terminalCommand,
    output: terminal.output.slice(-4000),
    status: before,
    message: terminal.ok
      ? "A Terminal window was opened with the Tailscale installer command. Enter your Mac password there, then return to LifeOS AI."
      : "Tailscale requires a Mac password in Terminal. Copy the command and run it in Terminal.",
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
  const rawDesktopRuntimeConfig = getDesktopRuntimeConfig();
  const lanUrls = getLanUrls(port);
  const cloudflare = getCloudflareTunnelStatus(port);
  const desktopRuntimeConfig = isStaleTemporaryDesktopRuntimeConfig({ config: rawDesktopRuntimeConfig, publicBaseUrl, cloudflare })
    ? null
    : rawDesktopRuntimeConfig;
  const tailscale = getTailscaleStatus(port);
  const connectionCandidates = buildConnectionCandidates({ port, publicBaseUrl, lanUrls, desktopRuntimeConfig, cloudflare, tailscale });
  const icloud = getIcloudHandoffStatus(connectionCandidates);
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
    icloud,
    cloudflare,
    tailscale,
    safety: {
      publicModeRequired: host === "0.0.0.0" || Boolean(publicBaseUrl),
      requiresHttpsForInternet: Boolean(publicBaseUrl) && !publicBaseUrl.startsWith("https://"),
      notes: [
        "Apple users can use iCloud Handoff first to sync the current mobile entry file between Apple devices.",
        "Prefer Tailscale or Cloudflare Tunnel when the phone needs a live off-LAN connection.",
        "Public internet access requires LIFEOS_ALLOW_PUBLIC=1 and a trusted HTTPS tunnel or reverse proxy in front.",
      ],
    },
  };
}

export function exportIcloudHandoff() {
  const diagnostics = getNetworkDiagnostics();
  const status = diagnostics.icloud;
  if (!status.platformSupported) {
    throw new Error("iCloud Handoff is available only on Apple platforms.");
  }
  if (!status.available) {
    throw new Error("iCloud Drive was not detected on this Mac. Enable iCloud Drive, then try again.");
  }
  const candidate = preferredHandoffCandidate(diagnostics.connectionCandidates);
  if (!candidate) {
    throw new Error("No phone-reachable LifeOS entry is available yet. Use same Wi-Fi, Cloudflare, Tailscale, or another trusted HTTPS entry first.");
  }

  mkdirSync(status.appFolderPath, { recursive: true });
  const generatedAt = Date.now();
  const packet = {
    kind: "lifeos-mobile-entry",
    version: 2,
    generatedAt,
    refreshAfter: generatedAt + ICLOUD_HANDOFF_REFRESH_AFTER_MS,
    expiresAt: generatedAt + ICLOUD_HANDOFF_EXPIRES_AFTER_MS,
    candidateId: candidate.id,
    label: candidate.label,
    baseUrl: candidate.baseUrl,
    mobilePairUrl: candidate.mobilePairUrl,
    mobileChatUrl: candidate.mobileChatUrl,
    mode: candidate.mode,
    secure: candidate.secure,
    stability: candidate.stability,
    requiresRestart: candidate.requiresRestart,
    notes: candidate.notes,
    fallbackCandidates: summarizeIcloudFallbackCandidates(diagnostics.connectionCandidates),
    remoteReadiness: diagnostics.remoteReadiness,
    recoveryActions: [
      "Refresh this iCloud entry after changing Wi-Fi, restarting a tunnel, or changing PUBLIC_BASE_URL.",
      "Regenerate the phone pairing QR code when an old QR code expires or opens the wrong address.",
      "Use Tailscale HTTPS Serve or Cloudflare Tunnel for live off-LAN chat; iCloud only syncs the entry file.",
    ],
    transport: "icloud-handoff",
    realtimeTransport: false,
    entryChecksumSha256: "",
    warning: "iCloud syncs this entry file; it does not create a realtime tunnel.",
  };
  packet.entryChecksumSha256 = buildIcloudEntryChecksum(packet);
  writePrivateFileAtomic(status.packetFilePath, `${JSON.stringify(packet, null, 2)}\n`);
  writePrivateFileAtomic(status.handoffFilePath, buildIcloudHandoffHtml({ generatedAt, candidate, packet }));
  return {
    ok: true,
    generatedAt,
    ...getIcloudHandoffStatus(diagnostics.connectionCandidates),
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
