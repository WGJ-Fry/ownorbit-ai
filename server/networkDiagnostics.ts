import { execFileSync, spawnSync } from "child_process";
import crypto from "crypto";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { WebSocket } from "ws";
import { extractCloudflareTunnelUrls, getManagedCloudflareTunnelStatus } from "./cloudflareTunnel.ts";
import { DesktopRuntimeConfig, getDesktopRuntimeConfig, saveDesktopRuntimeConfig } from "./desktopRuntimeConfig.ts";
import { getLatestBindingSession, getLatestIcloudHandoffEventByTypes } from "./devices.ts";
import { buildIcloudPhoneConfirmationStatus } from "./icloudPhoneConfirmation.ts";
import { buildIcloudPairingSessionStatus } from "./icloudPairingSession.ts";
import { getLatestIcloudRepairImportRecord } from "./icloudRepairImports.ts";
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
const ICLOUD_HANDOFF_EXPIRED_CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const ICLOUD_HANDOFF_ENTRY_RETENTION_LIMIT = 12;
const ICLOUD_SYNC_STUCK_AFTER_MS = 10 * 60 * 1000;
const ICLOUD_MDLS_ATTRIBUTES = [
  "kMDItemUbiquitousItemIsDownloaded",
  "kMDItemUbiquitousItemIsDownloading",
  "kMDItemUbiquitousItemIsUploaded",
  "kMDItemUbiquitousItemIsUploading",
  "kMDItemUbiquitousItemDownloadingStatus",
  "kMDItemUbiquitousItemUploadingStatus",
];

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
    desktopId: packet.desktopId,
    desktopName: packet.desktopName,
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
    fallbackCandidates: packet.fallbackCandidates,
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
    url.searchParams.set("entryDesktopId", String(packet.desktopId || ""));
    url.searchParams.set("entryDesktopName", String(packet.desktopName || ""));
    url.searchParams.set("entryDesktopSlug", String(packet.desktopSlug || ""));
    url.searchParams.set("entryChecksumSha256", String(packet.entryChecksumSha256 || ""));
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

function safeIcloudSlug(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "desktop";
}

function getIcloudDesktopIdentity() {
  const name = String(process.env.LIFEOS_DEVICE_NAME || os.hostname() || "LifeOS Desktop").trim().slice(0, 80) || "LifeOS Desktop";
  const rawId = String(process.env.LIFEOS_DESKTOP_ID || "").trim();
  const id = rawId || crypto
    .createHash("sha256")
    .update([os.hostname(), process.env.LIFEOS_DATA_DIR || process.cwd()].join("|"))
    .digest("hex")
    .slice(0, 12);
  const slug = safeIcloudSlug(`${name}-${id}`);
  return {
    id,
    name,
    slug,
    htmlFileName: `lifeos-mobile-entry-${slug}.html`,
    packetFileName: `lifeos-mobile-entry-${slug}.json`,
  };
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

function readIcloudHandoffHtmlMeta(handoffFilePath: string) {
  if (!handoffFilePath || !existsSync(handoffFilePath)) {
    return { exists: false, checksumSha256: "", generatedAt: 0 };
  }
  try {
    const html = readFileSync(handoffFilePath, "utf8");
    const checksumSha256 = html.match(/<meta\s+name="lifeos-entry-checksum"\s+content="([a-f0-9]{64})"\s*\/?>/i)?.[1] || "";
    const generatedAt = Number(html.match(/<meta\s+name="lifeos-entry-generated-at"\s+content="(\d+)"\s*\/?>/i)?.[1] || 0);
    return { exists: true, checksumSha256, generatedAt: Number.isFinite(generatedAt) ? generatedAt : 0 };
  } catch {
    return { exists: true, checksumSha256: "", generatedAt: 0 };
  }
}

function buildIcloudHtmlConsistency(input: {
  handoffFilePath: string;
  packet: Record<string, unknown> | null;
}) {
  const html = readIcloudHandoffHtmlMeta(input.handoffFilePath);
  const packetChecksum = String(input.packet?.entryChecksumSha256 || "").trim();
  const packetGeneratedAt = Number(input.packet?.generatedAt || 0);
  if (!input.packet) return { status: "missing" as const, ok: false, ...html, reason: "No JSON packet is available." };
  if (!html.exists) return { status: "missing" as const, ok: false, ...html, reason: "The iCloud HTML entry file is missing." };
  if (!html.checksumSha256 || !html.generatedAt) return { status: "legacy" as const, ok: false, ...html, reason: "The iCloud HTML entry was created by an older LifeOS version." };
  if (html.checksumSha256 !== packetChecksum || html.generatedAt !== packetGeneratedAt) {
    return { status: "mismatch" as const, ok: false, ...html, reason: "The iCloud HTML entry does not match the JSON packet." };
  }
  return { status: "matching" as const, ok: true, ...html, reason: "The iCloud HTML entry matches the JSON packet." };
}

function buildIcloudHandoffHealth(input: {
  packetFilePath: string;
  handoffFilePath: string;
  candidate: ConnectionCandidate | null;
  candidates?: ConnectionCandidate[];
  now?: number;
}) {
  const now = input.now || Date.now();
  const packet = readIcloudHandoffPacket(input.packetFilePath);
  const generatedAt = Number(packet?.generatedAt || 0);
  const exportedBaseUrl = String(packet?.baseUrl || "");
  const exportedFallbackCandidates = Array.isArray(packet?.fallbackCandidates) ? packet.fallbackCandidates : [];
  const currentFallbackCandidates = summarizeIcloudFallbackCandidates(input.candidates || (input.candidate ? [input.candidate] : []));
  const fallbackCandidatesChanged = Boolean(
    packet &&
    JSON.stringify(exportedFallbackCandidates) !== JSON.stringify(currentFallbackCandidates)
  );
  const expiresAt = Number(packet?.expiresAt || (generatedAt ? generatedAt + ICLOUD_HANDOFF_EXPIRES_AFTER_MS : 0));
  const refreshAfter = Number(packet?.refreshAfter || (generatedAt ? generatedAt + ICLOUD_HANDOFF_REFRESH_AFTER_MS : 0));
  const exportedChecksum = String(packet?.entryChecksumSha256 || "").trim();
  const expectedChecksum = packet ? buildIcloudEntryChecksum(packet) : "";
  const checksumOk = packet ? (exportedChecksum ? exportedChecksum === expectedChecksum : null) : null;
  const htmlConsistency = buildIcloudHtmlConsistency({ handoffFilePath: input.handoffFilePath, packet });
  let status: "missing" | "fresh" | "stale" | "address-changed" | "expired" | "invalid" | "legacy" | "html-mismatch" = "missing";
  let reason = "No iCloud mobile entry has been exported yet.";

  if (packet && generatedAt > 0) {
    if (checksumOk === false) {
      status = "invalid";
      reason = "The iCloud mobile entry checksum does not match. The file may be partially synced or modified.";
    } else if (expiresAt > 0 && now >= expiresAt) {
      status = "expired";
      reason = "The iCloud mobile entry is older than the recommended recovery window.";
    } else if (input.candidate?.baseUrl && exportedBaseUrl && input.candidate.baseUrl !== exportedBaseUrl) {
      status = "address-changed";
      reason = "The best phone entry changed after the last iCloud export.";
    } else if (!exportedChecksum) {
      status = "legacy";
      reason = "The iCloud mobile entry was created by an older LifeOS version and should be refreshed.";
    } else if (fallbackCandidatesChanged) {
      status = "address-changed";
      reason = "The phone fallback entry list changed after the last iCloud export.";
    } else if (!htmlConsistency.ok) {
      status = "html-mismatch";
      reason = htmlConsistency.reason;
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
    checksumOk,
    entryChecksumSha256: exportedChecksum,
    expectedChecksumSha256: expectedChecksum,
    htmlConsistency,
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

function classifyIcloudCandidateFamily(input: { candidateId?: string; mode?: string; baseUrl?: string }) {
  const candidateId = String(input.candidateId || "").toLowerCase();
  const mode = String(input.mode || "").toLowerCase();
  const baseUrl = String(input.baseUrl || "").toLowerCase();
  if (candidateId === "configured-public") return "configured-public";
  if (candidateId.startsWith("cloudflare-") || mode === "cloudflare" || baseUrl.includes(".trycloudflare.com")) return "cloudflare";
  if (candidateId.startsWith("tailscale-") || mode === "tailscale" || baseUrl.includes(".ts.net") || baseUrl.includes(".tailscale")) return "tailscale";
  if (candidateId.startsWith("lan-") || mode === "lan" || /^http:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(baseUrl)) return "lan";
  return "other";
}

function classifyIcloudHandoffChangeType(input: {
  previousBaseUrl: string;
  nextBaseUrl: string;
  previousCandidateId: string;
  nextCandidateId: string;
  previousMode: string;
  nextMode: string;
  previousFallbackCandidates: unknown[];
  nextFallbackCandidates: unknown[];
}) {
  if (!input.previousBaseUrl) return "first-export";
  if (input.previousBaseUrl !== input.nextBaseUrl) {
    const nextFamily = classifyIcloudCandidateFamily({ candidateId: input.nextCandidateId, mode: input.nextMode, baseUrl: input.nextBaseUrl });
    const previousFamily = classifyIcloudCandidateFamily({ candidateId: input.previousCandidateId, mode: input.previousMode, baseUrl: input.previousBaseUrl });
    const family = nextFamily !== "other" ? nextFamily : previousFamily;
    if (family === "configured-public") return "public-base-url-changed";
    if (family === "cloudflare") return "cloudflare-address-changed";
    if (family === "tailscale") return "tailscale-address-changed";
    if (family === "lan") return "lan-address-changed";
    return "address-changed";
  }
  return JSON.stringify(input.previousFallbackCandidates) !== JSON.stringify(input.nextFallbackCandidates)
    ? "fallback-candidates-changed"
    : "refreshed-same-address";
}

function summarizeIcloudEntryPacket(packet: Record<string, unknown>, fileName: string) {
  const generatedAt = Number(packet.generatedAt || 0);
  const baseUrl = String(packet.baseUrl || "").trim();
  if (!generatedAt || !baseUrl) return null;
  return {
    desktopId: String(packet.desktopId || "legacy"),
    desktopName: String(packet.desktopName || packet.label || "LifeOS Desktop").slice(0, 80),
    desktopSlug: String(packet.desktopSlug || "").slice(0, 80),
    fileName,
    htmlFileName: String(packet.htmlFileName || fileName.replace(/\.json$/, ".html")),
    packetFileName: fileName,
    label: String(packet.label || "").slice(0, 120),
    baseUrl,
    mode: String(packet.mode || ""),
    stability: String(packet.stability || ""),
    secure: packet.secure === true,
    generatedAt,
    refreshAfter: Number(packet.refreshAfter || 0),
    expiresAt: Number(packet.expiresAt || 0),
    entryChecksumSha256: String(packet.entryChecksumSha256 || ""),
  };
}

function readIcloudEntrySummaries(appFolderPath: string) {
  if (!appFolderPath || !existsSync(appFolderPath)) return [];
  try {
    return readdirSync(appFolderPath)
      .filter((file) => /^lifeos-mobile-entry(?:-[a-z0-9._-]+)?\.json$/i.test(file))
      .map((file) => {
        try {
          const packet = JSON.parse(readFileSync(path.join(appFolderPath, file), "utf8"));
          return packet && typeof packet === "object" ? summarizeIcloudEntryPacket(packet, file) : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is NonNullable<ReturnType<typeof summarizeIcloudEntryPacket>> => Boolean(entry))
      .sort((left, right) => right.generatedAt - left.generatedAt)
      .slice(0, ICLOUD_HANDOFF_ENTRY_RETENTION_LIMIT);
  } catch {
    return [];
  }
}

function icloudDesktopNameKey(value: string) {
  return String(value || "LifeOS Desktop").trim().toLowerCase() || "lifeos desktop";
}

function getIcloudDesktopShortId(entry: {
  desktopSlug?: string;
  desktopId?: string;
  packetFileName?: string;
  htmlFileName?: string;
  fileName?: string;
}) {
  const source = [
    entry.desktopSlug,
    entry.desktopId,
    entry.packetFileName,
    entry.htmlFileName,
    entry.fileName,
  ].find((value) => String(value || "").trim());
  const normalized = String(source || "")
    .replace(/^lifeos-mobile-entry-?/i, "")
    .replace(/\.(json|html)$/i, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
  return normalized.slice(0, 8) || "entry";
}

function getDuplicateIcloudDesktopNames(entries: ReturnType<typeof readIcloudEntrySummaries>) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = icloudDesktopNameKey(entry.desktopName);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function formatIcloudDesktopDisplayName(
  entry: NonNullable<ReturnType<typeof summarizeIcloudEntryPacket>>,
  duplicateNames: Set<string>,
) {
  const baseName = entry.desktopName || "LifeOS Desktop";
  return duplicateNames.has(icloudDesktopNameKey(baseName))
    ? `${baseName} · ${getIcloudDesktopShortId(entry)}`
    : baseName;
}

function isPrivateNetworkHost(hostname: string) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function isIcloudEntrySameWifiOnly(entry: Pick<NonNullable<ReturnType<typeof summarizeIcloudEntryPacket>>, "mode" | "stability" | "baseUrl">) {
  const mode = String(entry.mode || "").toLowerCase();
  const stability = String(entry.stability || "").toLowerCase();
  if (mode === "lan" || mode === "local" || stability === "local") return true;
  try {
    const url = new URL(entry.baseUrl);
    return url.protocol === "http:" && isPrivateNetworkHost(url.hostname);
  } catch {
    return /^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(String(entry.baseUrl || ""));
  }
}

function buildIcloudIndexChecksum(input: {
  generatedAt: number;
  entries: ReturnType<typeof readIcloudEntrySummaries>;
}) {
  const latestEntryGeneratedAt = Math.max(0, ...input.entries.map((entry) => entry.generatedAt || 0));
  const checksumPayload = {
    version: 1,
    generatedAt: input.generatedAt,
    latestEntryGeneratedAt,
    entries: input.entries.map((entry) => ({
      desktopId: entry.desktopId,
      desktopName: entry.desktopName,
      htmlFileName: entry.htmlFileName,
      packetFileName: entry.packetFileName,
      baseUrl: entry.baseUrl,
      generatedAt: entry.generatedAt,
      refreshAfter: entry.refreshAfter,
      expiresAt: entry.expiresAt,
      entryChecksumSha256: entry.entryChecksumSha256,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(checksumPayload)).digest("hex");
}

function readIcloudHandoffIndexHtmlMeta(indexFilePath: string) {
  if (!indexFilePath || !existsSync(indexFilePath)) {
    return { exists: false, checksumSha256: "", generatedAt: 0, latestEntryGeneratedAt: 0, entryCount: 0, writerDesktopId: "" };
  }
  try {
    const html = readFileSync(indexFilePath, "utf8");
    const checksumSha256 = html.match(/<meta\s+name="lifeos-entry-index-checksum"\s+content="([a-f0-9]{64})"\s*\/?>/i)?.[1] || "";
    const generatedAt = Number(html.match(/<meta\s+name="lifeos-entry-index-generated-at"\s+content="(\d+)"\s*\/?>/i)?.[1] || 0);
    const latestEntryGeneratedAt = Number(html.match(/<meta\s+name="lifeos-entry-index-latest-entry-generated-at"\s+content="(\d+)"\s*\/?>/i)?.[1] || 0);
    const entryCount = Number(html.match(/<meta\s+name="lifeos-entry-index-entry-count"\s+content="(\d+)"\s*\/?>/i)?.[1] || 0);
    const writerDesktopId = html.match(/<meta\s+name="lifeos-entry-index-writer-desktop-id"\s+content="([^"]*)"\s*\/?>/i)?.[1] || "";
    return {
      exists: true,
      checksumSha256,
      generatedAt: Number.isFinite(generatedAt) ? generatedAt : 0,
      latestEntryGeneratedAt: Number.isFinite(latestEntryGeneratedAt) ? latestEntryGeneratedAt : 0,
      entryCount: Number.isFinite(entryCount) ? entryCount : 0,
      writerDesktopId,
    };
  } catch {
    return { exists: true, checksumSha256: "", generatedAt: 0, latestEntryGeneratedAt: 0, entryCount: 0, writerDesktopId: "" };
  }
}

function buildIcloudIndexConsistency(input: {
  indexFilePath: string;
  entries: ReturnType<typeof readIcloudEntrySummaries>;
}) {
  const index = readIcloudHandoffIndexHtmlMeta(input.indexFilePath);
  const latestEntryGeneratedAt = Math.max(0, ...input.entries.map((entry) => entry.generatedAt || 0));
  const expectedChecksum = index.generatedAt ? buildIcloudIndexChecksum({ generatedAt: index.generatedAt, entries: input.entries }) : "";
  if (!index.exists) {
    return {
      status: "missing" as const,
      ok: false,
      ...index,
      expectedChecksumSha256: expectedChecksum,
      expectedEntryCount: input.entries.length,
      expectedLatestEntryGeneratedAt: latestEntryGeneratedAt,
      reason: "The iCloud desktop chooser file is missing.",
    };
  }
  if (!index.checksumSha256 || !index.generatedAt) {
    return {
      status: "legacy" as const,
      ok: false,
      ...index,
      expectedChecksumSha256: expectedChecksum,
      expectedEntryCount: input.entries.length,
      expectedLatestEntryGeneratedAt: latestEntryGeneratedAt,
      reason: "The iCloud desktop chooser was created by an older LifeOS version.",
    };
  }
  if (
    index.checksumSha256 !== expectedChecksum ||
    index.entryCount !== input.entries.length ||
    index.latestEntryGeneratedAt !== latestEntryGeneratedAt
  ) {
    return {
      status: "mismatch" as const,
      ok: false,
      ...index,
      expectedChecksumSha256: expectedChecksum,
      expectedEntryCount: input.entries.length,
      expectedLatestEntryGeneratedAt: latestEntryGeneratedAt,
      reason: "The iCloud desktop chooser does not match the current entry list.",
    };
  }
  return {
    status: "matching" as const,
    ok: true,
    ...index,
    expectedChecksumSha256: expectedChecksum,
    expectedEntryCount: input.entries.length,
    expectedLatestEntryGeneratedAt: latestEntryGeneratedAt,
    reason: "The iCloud desktop chooser matches the current entry list.",
  };
}

function readAllIcloudEntrySummaries(appFolderPath: string) {
  if (!appFolderPath || !existsSync(appFolderPath)) return [];
  try {
    return readdirSync(appFolderPath)
      .filter((file) => /^lifeos-mobile-entry(?:-[a-z0-9._-]+)?\.json$/i.test(file))
      .map((file) => {
        try {
          const packet = JSON.parse(readFileSync(path.join(appFolderPath, file), "utf8"));
          return packet && typeof packet === "object" ? summarizeIcloudEntryPacket(packet, file) : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is NonNullable<ReturnType<typeof summarizeIcloudEntryPacket>> => Boolean(entry))
      .sort((left, right) => right.generatedAt - left.generatedAt);
  } catch {
    return [];
  }
}

function getIcloudExpiredCleanupGraceMs() {
  const configured = Number.parseInt(String(process.env.LIFEOS_ICLOUD_EXPIRED_CLEANUP_GRACE_MS || ""), 10);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return ICLOUD_HANDOFF_EXPIRED_CLEANUP_GRACE_MS;
}

function getIcloudSyncStuckAfterMs() {
  const configured = Number.parseInt(String(process.env.LIFEOS_ICLOUD_SYNC_STUCK_AFTER_MS || ""), 10);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return ICLOUD_SYNC_STUCK_AFTER_MS;
}

function listIcloudOrphanedEntryFiles(appFolderPath: string, entries = readAllIcloudEntrySummaries(appFolderPath)) {
  if (!appFolderPath || !existsSync(appFolderPath)) return [];
  const referencedFiles = new Set(entries.flatMap((entry) => [entry.htmlFileName, entry.packetFileName]).filter(Boolean));
  try {
    return readdirSync(appFolderPath)
      .filter((file) => /^lifeos-mobile-entry-[a-z0-9._-]+\.(html|json)$/i.test(file) && !referencedFiles.has(file))
      .sort();
  } catch {
    return [];
  }
}

function getIcloudHandoffLifecycleStatus(appFolderPath: string, currentDesktopId: string, now = Date.now()) {
  const entries = readAllIcloudEntrySummaries(appFolderPath);
  const expiredGraceMs = getIcloudExpiredCleanupGraceMs();
  const prunableEntries = entries.filter((entry) => (
    entry.desktopId !== currentDesktopId &&
    entry.expiresAt > 0 &&
    now >= entry.expiresAt + expiredGraceMs
  ));
  const orphanedFiles = listIcloudOrphanedEntryFiles(appFolderPath, entries);
  return {
    retentionLimit: ICLOUD_HANDOFF_ENTRY_RETENTION_LIMIT,
    expiredGraceMs,
    entryCount: entries.length,
    expiredEntryCount: entries.filter((entry) => entry.expiresAt > 0 && now >= entry.expiresAt).length,
    prunableEntryCount: prunableEntries.length,
    orphanedFileCount: orphanedFiles.length,
  };
}

function removeIcloudFile(appFolderPath: string, fileName: string, removedFiles: string[], errors: string[]) {
  if (!/^[a-z0-9._-]+\.(html|json)$/i.test(fileName)) return;
  const targetPath = path.join(appFolderPath, fileName);
  try {
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
      removedFiles.push(fileName);
    }
  } catch (error: any) {
    errors.push(`${fileName}: ${String(error?.message || error || "remove failed").slice(0, 160)}`);
  }
}

function cleanupExpiredIcloudHandoffEntries(appFolderPath: string, currentDesktopId: string, now = Date.now()) {
  const entries = readAllIcloudEntrySummaries(appFolderPath);
  const expiredGraceMs = getIcloudExpiredCleanupGraceMs();
  const expiredEntries = entries.filter((entry) => (
    entry.desktopId !== currentDesktopId &&
    entry.expiresAt > 0 &&
    now >= entry.expiresAt + expiredGraceMs
  ));
  const removedFiles: string[] = [];
  const errors: string[] = [];
  for (const entry of expiredEntries) {
    removeIcloudFile(appFolderPath, entry.packetFileName, removedFiles, errors);
    removeIcloudFile(appFolderPath, entry.htmlFileName, removedFiles, errors);
  }
  const orphanedFiles = listIcloudOrphanedEntryFiles(appFolderPath, entries);
  for (const file of orphanedFiles) {
    removeIcloudFile(appFolderPath, file, removedFiles, errors);
  }
  return {
    removedEntryCount: expiredEntries.length,
    removedOrphanedFileCount: orphanedFiles.length,
    removedFiles: removedFiles.slice(0, 24),
    errorCount: errors.length,
    errors: errors.slice(0, 6),
    expiredGraceMs,
  };
}

function readIcloudHandoffHistory(historyFilePath: string) {
  if (!historyFilePath || !existsSync(historyFilePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(historyFilePath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        desktopId: String(item.desktopId || "legacy").slice(0, 80),
        desktopName: String(item.desktopName || "LifeOS Desktop").slice(0, 80),
        reason: String(item.reason || "manual").slice(0, 120),
        changeType: String(item.changeType || "unknown").slice(0, 80),
        previousBaseUrl: String(item.previousBaseUrl || ""),
        previousCandidateId: String(item.previousCandidateId || ""),
        previousMode: String(item.previousMode || ""),
        previousStability: String(item.previousStability || ""),
        previousGeneratedAt: Number(item.previousGeneratedAt || 0),
        previousEntryChecksumSha256: String(item.previousEntryChecksumSha256 || ""),
        previousFallbackCandidateCount: Number(item.previousFallbackCandidateCount || 0),
        baseUrl: String(item.baseUrl || ""),
        candidateId: String(item.candidateId || ""),
        mode: String(item.mode || ""),
        stability: String(item.stability || ""),
        fallbackCandidateCount: Number(item.fallbackCandidateCount || 0),
        generatedAt: Number(item.generatedAt || 0),
        entryChecksumSha256: String(item.entryChecksumSha256 || ""),
        htmlFileName: String(item.htmlFileName || ""),
        packetFileName: String(item.packetFileName || ""),
      }))
      .filter((item) => item.generatedAt && item.baseUrl)
      .sort((left, right) => right.generatedAt - left.generatedAt)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function writeIcloudHandoffHistory(historyFilePath: string, record: Record<string, unknown>) {
  const previous = readIcloudHandoffHistory(historyFilePath);
  const next = [
    {
      desktopId: String(record.desktopId || "legacy"),
      desktopName: String(record.desktopName || "LifeOS Desktop"),
      reason: String(record.reason || "manual"),
      changeType: String(record.changeType || "unknown"),
      previousBaseUrl: String(record.previousBaseUrl || ""),
      previousCandidateId: String(record.previousCandidateId || ""),
      previousMode: String(record.previousMode || ""),
      previousStability: String(record.previousStability || ""),
      previousGeneratedAt: Number(record.previousGeneratedAt || 0),
      previousEntryChecksumSha256: String(record.previousEntryChecksumSha256 || ""),
      previousFallbackCandidateCount: Number(record.previousFallbackCandidateCount || 0),
      baseUrl: String(record.baseUrl || ""),
      candidateId: String(record.candidateId || ""),
      mode: String(record.mode || ""),
      stability: String(record.stability || ""),
      fallbackCandidateCount: Number(record.fallbackCandidateCount || 0),
      generatedAt: Number(record.generatedAt || Date.now()),
      entryChecksumSha256: String(record.entryChecksumSha256 || ""),
      htmlFileName: String(record.htmlFileName || ""),
      packetFileName: String(record.packetFileName || ""),
    },
    ...previous,
  ]
    .filter((item, index, all) => all.findIndex((candidate) => (
      candidate.desktopId === item.desktopId &&
      candidate.generatedAt === item.generatedAt &&
      candidate.entryChecksumSha256 === item.entryChecksumSha256
    )) === index)
    .sort((left, right) => right.generatedAt - left.generatedAt)
    .slice(0, 12);
  writePrivateFileAtomic(historyFilePath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function icloudEntryPhoneScore(
  entry: NonNullable<ReturnType<typeof summarizeIcloudEntryPacket>>,
  now: number,
  currentDesktopId: string,
) {
  const expired = Boolean(entry.expiresAt && now >= entry.expiresAt);
  const stale = Boolean(!expired && entry.refreshAfter && now >= entry.refreshAfter);
  const freshnessScore = expired ? -100 : stale ? 20 : 60;
  const currentDesktopScore = entry.desktopId === currentDesktopId ? 45 : 0;
  const secureScore = entry.secure ? 12 : 0;
  const stabilityScore = entry.stability === "stable" ? 14 : entry.stability === "temporary" ? 4 : 0;
  const modeScore = entry.mode === "tailscale" || entry.mode === "configured" ? 12 : entry.mode === "cloudflare" ? 8 : entry.mode === "lan" ? 2 : 0;
  const recencyScore = Math.min(10, Math.max(0, Math.floor((entry.generatedAt || 0) / 1_000_000_000_000)));
  return freshnessScore + currentDesktopScore + secureScore + stabilityScore + modeScore + recencyScore;
}

function chooseIcloudRecommendedIndexEntry(input: {
  generatedAt: number;
  currentDesktopId: string;
  entries: ReturnType<typeof readIcloudEntrySummaries>;
}) {
  const currentFreshEntry = input.entries.find((entry) => (
    entry.desktopId === input.currentDesktopId &&
    (!entry.expiresAt || input.generatedAt < entry.expiresAt)
  ));
  if (currentFreshEntry) return currentFreshEntry;
  return [...input.entries]
    .sort((left, right) => {
      const scoreDelta = icloudEntryPhoneScore(right, input.generatedAt, input.currentDesktopId) - icloudEntryPhoneScore(left, input.generatedAt, input.currentDesktopId);
      return scoreDelta || (right.generatedAt || 0) - (left.generatedAt || 0);
    })
    .find((entry) => !entry.expiresAt || input.generatedAt < entry.expiresAt) || input.entries[0] || null;
}

function buildIcloudHandoffIndexHtml(input: {
  generatedAt: number;
  currentDesktopId: string;
  entries: ReturnType<typeof readIcloudEntrySummaries>;
}) {
  const latestEntryGeneratedAt = Math.max(0, ...input.entries.map((entry) => entry.generatedAt || 0));
  const indexChecksumSha256 = buildIcloudIndexChecksum({ generatedAt: input.generatedAt, entries: input.entries });
  const recommendedEntry = chooseIcloudRecommendedIndexEntry(input);
  const recommendedKey = recommendedEntry ? `${recommendedEntry.desktopId}:${recommendedEntry.generatedAt}:${recommendedEntry.htmlFileName}` : "";
  const otherEntries = recommendedKey
    ? input.entries.filter((entry) => `${entry.desktopId}:${entry.generatedAt}:${entry.htmlFileName}` !== recommendedKey)
    : input.entries;
  const duplicateDesktopNames = getDuplicateIcloudDesktopNames(input.entries);
  const recommendedSameWifiOnly = Boolean(recommendedEntry && isIcloudEntrySameWifiOnly(recommendedEntry));
  const renderEntry = (entry: NonNullable<typeof recommendedEntry>, options: { primary?: boolean } = {}) => {
    const isCurrent = entry.desktopId === input.currentDesktopId;
    const shortId = getIcloudDesktopShortId(entry);
    const displayName = formatIcloudDesktopDisplayName(entry, duplicateDesktopNames);
    const sameWifiOnly = isIcloudEntrySameWifiOnly(entry);
    const reachability = sameWifiOnly ? "同一 Wi-Fi / Same Wi-Fi only" : "异地可用入口 / Off-LAN entry";
    const status = entry.expiresAt && input.generatedAt >= entry.expiresAt
      ? "已过期 / Expired"
      : entry.refreshAfter && input.generatedAt >= entry.refreshAfter
      ? "建议刷新 / Refresh suggested"
      : "可用 / Usable";
    return `<a class="entry${options.primary ? " primary" : ""}${sameWifiOnly ? " same-wifi" : ""}" href="${htmlEscape(entry.htmlFileName)}" data-lifeos-desktop-short-id="${htmlEscape(shortId)}" data-lifeos-desktop-display-name="${htmlEscape(displayName)}" data-lifeos-entry-same-wifi-only="${sameWifiOnly ? "1" : "0"}">
      <strong>${htmlEscape(displayName)}${isCurrent ? " · 当前电脑 / This Mac" : ""}</strong>
      <span>${htmlEscape(entry.baseUrl)}</span>
      <small>${htmlEscape(status)} · ${htmlEscape(reachability)} · ID ${htmlEscape(shortId)} · ${htmlEscape(new Date(entry.generatedAt).toLocaleString())}</small>
      ${options.primary ? `<em>打开这个入口 / Open this entry</em>` : ""}
    </a>`;
  };
  const rows = recommendedEntry
    ? `${renderEntry(recommendedEntry, { primary: true })}
      ${otherEntries.length ? `<details class="advanced">
        <summary>其他电脑入口 / Other desktop entries (${otherEntries.length})</summary>
        ${otherEntries.map((entry) => renderEntry(entry)).join("\n")}
      </details>` : ""}`
    : `<div class="empty">还没有可用入口 / No entries yet</div>`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="lifeos-entry-index-generated-at" content="${htmlEscape(input.generatedAt)}" />
    <meta name="lifeos-entry-index-checksum" content="${htmlEscape(indexChecksumSha256)}" />
    <meta name="lifeos-entry-index-entry-count" content="${htmlEscape(input.entries.length)}" />
    <meta name="lifeos-entry-index-latest-entry-generated-at" content="${htmlEscape(latestEntryGeneratedAt)}" />
    <meta name="lifeos-entry-index-writer-desktop-id" content="${htmlEscape(input.currentDesktopId)}" />
    <meta name="lifeos-entry-index-recommended-desktop-id" content="${htmlEscape(recommendedEntry?.desktopId || "")}" />
    <meta name="lifeos-entry-index-recommended-html-file" content="${htmlEscape(recommendedEntry?.htmlFileName || "")}" />
    <title>LifeOS AI Mobile Entries</title>
    <style>
      body { margin: 0; min-height: 100vh; background: #060a10; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid; place-items: center; padding: 20px; }
      main { width: min(620px, 100%); border: 1px solid rgba(255,255,255,.1); background: #101722; border-radius: 28px; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
      h1 { margin: 0; font-size: 26px; letter-spacing: 0; }
      p { color: #a1a1aa; line-height: 1.65; }
      .hint { margin-top: 12px; border-radius: 14px; border: 1px solid rgba(34,211,238,.22); background: rgba(8,145,178,.12); color: #bae6fd; padding: 10px 12px; font-size: 12px; }
      .hint.warning { border-color: rgba(245,158,11,.32); background: rgba(245,158,11,.12); color: #fef3c7; }
      .entry { display: block; margin-top: 12px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09); color: #f4f4f5; text-decoration: none; }
      .entry.primary { border-color: rgba(34,211,238,.45); background: rgba(8,145,178,.18); box-shadow: 0 16px 48px rgba(8,145,178,.2); }
      .entry.same-wifi { border-color: rgba(245,158,11,.35); }
      .entry strong, .entry span, .entry small { display: block; }
      .entry span { margin-top: 6px; color: #a5b4fc; word-break: break-all; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
      .entry small { margin-top: 8px; color: #94a3b8; }
      .entry em { display: inline-block; margin-top: 12px; border-radius: 999px; background: #22d3ee; color: #031018; padding: 8px 12px; font-style: normal; font-weight: 800; }
      details.advanced { margin-top: 14px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 12px; }
      details.advanced summary { cursor: pointer; color: #cbd5e1; font-weight: 800; }
      .empty { margin-top: 16px; padding: 14px; border-radius: 16px; color: #fde68a; background: rgba(245,158,11,.12); }
      .warn { margin-top: 16px; color: #fef3c7; font-size: 12px; line-height: 1.65; }
    </style>
  </head>
  <body>
    <main>
      <h1>打开推荐入口 / Open the Recommended Entry</h1>
      <p>通常只点第一个入口即可。其他电脑入口已经放到高级区，避免误连旧电脑。</p>
      <p>Usually open the first entry only. Other desktop entries are tucked into Advanced so stale desktops are harder to pick by mistake.</p>
      ${duplicateDesktopNames.size ? `<div class="hint">如果两台电脑名字一样，请看短 ID 和更新时间。/ If two desktops share a name, use the short ID and update time.</div>` : ""}
      ${recommendedSameWifiOnly ? `<div class="hint warning">这个入口只适合同一 Wi-Fi。离家使用请先在电脑端切换 Tailscale 或 Cloudflare。/ This entry only works on the same Wi-Fi. Away from home, switch to Tailscale or Cloudflare on the desktop first.</div>` : ""}
      ${rows}
      <div class="warn">iCloud 只同步入口文件，不是实时网络隧道；异地实时聊天仍需要 Tailscale、Cloudflare Tunnel 或可信 HTTPS 入口。</div>
    </main>
  </body>
</html>`;
}

function parseIcloudRepairPacket(text: unknown) {
  const raw = String(text || "").slice(0, 6000);
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (/^[a-zA-Z][a-zA-Z0-9]+$/.test(key)) fields[key] = value.slice(0, 500);
  }
  const valid = lines[0] === "LifeOS iCloud Mobile Entry Recovery" || Boolean(fields.entryBaseUrl || fields.currentBaseUrl);
  return { rawLength: raw.length, valid, fields };
}

function normalizeRepairBaseUrl(value?: string) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname === "/" ? "" : pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function parseRepairTime(value?: string) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return 0;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function parseRepairBool(value?: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function modeFromBaseUrl(baseUrl: string) {
  if (!baseUrl) return "unknown";
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.endsWith(".trycloudflare.com")) return "cloudflare";
    if (host.endsWith(".ts.net")) return "tailscale";
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return "lan";
    if (host === "localhost" || host.startsWith("127.")) return "local";
    return "public";
  } catch {
    return "unknown";
  }
}

function canAccess(filePath: string, mode: number) {
  try {
    accessSync(filePath, mode);
    return true;
  } catch {
    return false;
  }
}

function fileUpdatedAt(filePath: string) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function isSyncStuck(updatedAt: number, now: number, stuckAfterMs: number) {
  return Boolean(stuckAfterMs > 0 && updatedAt > 0 && now - updatedAt >= stuckAfterMs);
}

function getIcloudPlaceholderSamples(appFolderPath: string, now = Date.now(), stuckAfterMs = getIcloudSyncStuckAfterMs()) {
  if (!existsSync(appFolderPath)) return [];
  try {
    return readdirSync(appFolderPath)
      .filter((name) => name.endsWith(".icloud"))
      .slice(0, 5)
      .map((name) => {
        const updatedAt = fileUpdatedAt(path.join(appFolderPath, name));
        return {
          name,
          updatedAt,
          ageMs: updatedAt ? Math.max(0, now - updatedAt) : 0,
          syncStuck: isSyncStuck(updatedAt, now, stuckAfterMs),
        };
      });
  } catch {
    return [];
  }
}

function getIcloudSyncServiceStatus(platformSupported: boolean) {
  const override = String(process.env.LIFEOS_ICLOUD_SYNC_SERVICE_STATUS || "").trim().toLowerCase();
  if (override) {
    const running = ["running", "ok", "ready"].includes(override);
    return {
      checked: true,
      running,
      processNames: override === "running" ? ["override"] : [],
      error: running ? "" : override === "unknown" ? "iCloud sync service status is unknown." : "iCloud Drive sync service was not detected.",
    };
  }
  if (!platformSupported) {
    return { checked: false, running: false, processNames: [] as string[], error: "" };
  }
  if (process.platform !== "darwin") {
    return { checked: false, running: true, processNames: [] as string[], error: "" };
  }

  const pgrepBin = process.env.LIFEOS_PGREP_BIN || "/usr/bin/pgrep";
  const processNames = ["bird", "cloudd"].filter((name) => runCommand(pgrepBin, ["-x", name]).ok);
  return {
    checked: true,
    running: processNames.length > 0,
    processNames,
    error: processNames.length ? "" : "iCloud Drive sync service was not detected.",
  };
}

function getIcloudAccountStatus(platformSupported: boolean, drivePathDetected: boolean) {
  type AccountStatus = "unchecked" | "ready" | "signed-out" | "drive-disabled" | "unknown";
  const build = (input: {
    checked: boolean;
    status: AccountStatus;
    signedIn: boolean | null;
    driveEnabled: boolean | null;
    source: "unsupported" | "override" | "defaults" | "unavailable";
    error?: string;
  }) => ({
    checked: input.checked,
    status: input.status,
    signedIn: input.signedIn,
    driveEnabled: input.driveEnabled,
    source: input.source,
    error: String(input.error || "").slice(0, 180),
  });
  const override = String(process.env.LIFEOS_ICLOUD_ACCOUNT_STATUS || "").trim().toLowerCase();
  if (override) {
    if (["ready", "enabled", "signed-in", "active", "ok"].includes(override)) {
      return build({ checked: true, status: "ready", signedIn: true, driveEnabled: true, source: "override" });
    }
    if (["signed-out", "not-signed-in", "no-account", "missing"].includes(override)) {
      return build({ checked: true, status: "signed-out", signedIn: false, driveEnabled: false, source: "override" });
    }
    if (["drive-disabled", "icloud-drive-disabled", "disabled"].includes(override)) {
      return build({ checked: true, status: "drive-disabled", signedIn: true, driveEnabled: false, source: "override" });
    }
    return build({ checked: true, status: "unknown", signedIn: null, driveEnabled: null, source: "override", error: "iCloud account status override is unknown." });
  }
  if (!platformSupported) return build({ checked: false, status: "unchecked", signedIn: null, driveEnabled: null, source: "unsupported" });
  if (process.platform !== "darwin") return build({ checked: false, status: "unchecked", signedIn: null, driveEnabled: null, source: "unavailable" });

  const defaultsBin = process.env.LIFEOS_DEFAULTS_BIN || "/usr/bin/defaults";
  const result = runCommand(defaultsBin, ["read", "MobileMeAccounts", "Accounts"]);
  if (!result.ok) {
    const looksSignedOut = /does not exist|not exist|not found|domain .* not found/i.test(result.output);
    if (looksSignedOut && !drivePathDetected) {
      return build({ checked: true, status: "signed-out", signedIn: false, driveEnabled: false, source: "defaults" });
    }
    return build({ checked: true, status: "unknown", signedIn: null, driveEnabled: drivePathDetected ? true : null, source: "defaults", error: "Unable to verify iCloud account state." });
  }
  const output = result.output;
  const signedIn = /AccountID|AccountDSID|DisplayName|FullName|LoggedIn|Services/i.test(output);
  const driveEnabled = drivePathDetected || /MOBILE_DOCUMENTS|CloudDocs|com~apple~CloudDocs|Ubiquit/i.test(output);
  if (!signedIn) return build({ checked: true, status: "signed-out", signedIn: false, driveEnabled: false, source: "defaults" });
  return build({
    checked: true,
    status: driveEnabled ? "ready" : "drive-disabled",
    signedIn: true,
    driveEnabled,
    source: "defaults",
  });
}

function parseMdlsBool(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return null;
}

function cleanMdlsValue(value: string | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "(null)") return "";
  return normalized.replace(/^"|"$/g, "");
}

function getIcloudMetadata(filePath: string) {
  const unavailable = {
    available: false,
    downloaded: null as boolean | null,
    downloading: null as boolean | null,
    uploaded: null as boolean | null,
    uploading: null as boolean | null,
    downloadingStatus: "",
    uploadingStatus: "",
    syncState: "unknown" as const,
    error: "",
  };
  const mdlsBin = process.env.LIFEOS_MDLS_BIN || "/usr/bin/mdls";
  if (!existsSync(filePath) || (process.platform !== "darwin" && !process.env.LIFEOS_MDLS_BIN)) return unavailable;
  const result = runCommand(mdlsBin, [
    "-raw",
    ...ICLOUD_MDLS_ATTRIBUTES.flatMap((attribute) => ["-name", attribute]),
    filePath,
  ]);
  if (!result.ok) return { ...unavailable, error: result.output.slice(0, 240) };
  const lines = result.output.split(/\r?\n/);
  const downloaded = parseMdlsBool(lines[0]);
  const downloading = parseMdlsBool(lines[1]);
  const uploaded = parseMdlsBool(lines[2]);
  const uploading = parseMdlsBool(lines[3]);
  const downloadingStatus = cleanMdlsValue(lines[4]);
  const uploadingStatus = cleanMdlsValue(lines[5]);
  let syncState: "unknown" | "synced" | "syncing" | "not-downloaded" | "not-uploaded" = "unknown";
  const statusText = `${downloadingStatus} ${uploadingStatus}`;
  const hasRelevantStatus = /download|upload|waiting|pending|current/i.test(statusText);
  const hasPendingStatus = /not|waiting|pending|downloading|uploading/i.test(statusText);
  if (downloading || uploading || (hasRelevantStatus && hasPendingStatus)) {
    syncState = "syncing";
  } else if (downloaded === false || /not downloaded/i.test(downloadingStatus)) {
    syncState = "not-downloaded";
  } else if (uploaded === false || /not uploaded/i.test(uploadingStatus)) {
    syncState = "not-uploaded";
  } else if ((downloaded === true || downloaded === null) && (uploaded === true || uploaded === null)) {
    syncState = "synced";
  }
  return {
    available: true,
    downloaded,
    downloading,
    uploaded,
    uploading,
    downloadingStatus,
    uploadingStatus,
    syncState,
    error: "",
  };
}

function getIcloudFileState(filePath: string, now = Date.now(), stuckAfterMs = getIcloudSyncStuckAfterMs()) {
  const placeholderCandidates = [
    `${filePath}.icloud`,
    path.join(path.dirname(filePath), `.${path.basename(filePath)}.icloud`),
  ];
  const placeholderPath = placeholderCandidates.find((candidate) => existsSync(candidate)) || "";
  const placeholderUpdatedAt = placeholderPath ? fileUpdatedAt(placeholderPath) : 0;
  const exists = existsSync(filePath);
  const readable = exists ? canAccess(filePath, constants.R_OK) : false;
  let size = 0;
  let updatedAt = 0;
  if (exists) {
    try {
      const stat = statSync(filePath);
      size = stat.size;
      updatedAt = stat.mtimeMs;
    } catch {
      size = 0;
    }
  }
  const metadata = getIcloudMetadata(filePath);
  const metadataPending = ["syncing", "not-downloaded", "not-uploaded"].includes(metadata.syncState);
  const syncStuck = (Boolean(placeholderPath) || metadataPending) && isSyncStuck(placeholderUpdatedAt || updatedAt, now, stuckAfterMs);
  return {
    exists,
    readable,
    placeholder: Boolean(placeholderPath),
    placeholderPath: placeholderPath ? path.basename(placeholderPath) : "",
    size,
    updatedAt,
    placeholderUpdatedAt,
    syncStuck,
    metadata,
    state: placeholderPath ? "placeholder" as const : exists && readable ? "ready" as const : exists ? "unreadable" as const : "missing" as const,
  };
}

function getIcloudAvailabilityStatus(input: {
  platformSupported: boolean;
  drivePath: string;
  appFolderPath: string;
  handoffFilePath: string;
  packetFilePath: string;
  indexFilePath: string;
}) {
  const now = Date.now();
  const syncStuckAfterMs = getIcloudSyncStuckAfterMs();
  const drivePathDetected = input.platformSupported && existsSync(input.drivePath);
  const appFolderExists = drivePathDetected && existsSync(input.appFolderPath);
  const driveWritable = drivePathDetected ? canAccess(input.drivePath, constants.W_OK) : false;
  const appFolderWritable = appFolderExists ? canAccess(input.appFolderPath, constants.W_OK) : driveWritable;
  const account = getIcloudAccountStatus(input.platformSupported, drivePathDetected);
  const handoffFile = getIcloudFileState(input.handoffFilePath, now, syncStuckAfterMs);
  const packetFile = getIcloudFileState(input.packetFilePath, now, syncStuckAfterMs);
  const indexFile = getIcloudFileState(input.indexFilePath, now, syncStuckAfterMs);
  const syncService = getIcloudSyncServiceStatus(input.platformSupported && drivePathDetected);
  const placeholderSampleStates = appFolderExists ? getIcloudPlaceholderSamples(input.appFolderPath, now, syncStuckAfterMs) : [];
  const placeholderSamples = placeholderSampleStates.map((sample) => sample.name);
  const placeholderCount = placeholderSamples.length + [handoffFile, packetFile, indexFile].filter((file) => file.placeholder).length;
  const metadataPendingCount = [handoffFile, packetFile, indexFile].filter((file) => ["syncing", "not-downloaded", "not-uploaded"].includes(file.metadata.syncState)).length;
  const pendingCount = placeholderCount + metadataPendingCount;
  const placeholderStuckCount = placeholderSampleStates.filter((file) => file.syncStuck).length + [handoffFile, packetFile, indexFile].filter((file) => file.placeholder && file.syncStuck).length;
  const metadataStuckCount = [handoffFile, packetFile, indexFile].filter((file) => ["syncing", "not-downloaded", "not-uploaded"].includes(file.metadata.syncState) && file.syncStuck).length;
  const syncStuckCount = placeholderStuckCount + metadataStuckCount;
  let status: "unsupported" | "account-unavailable" | "missing" | "read-only" | "sync-service-unavailable" | "sync-stuck" | "sync-pending" | "ready" = "ready";
  let severity: "ok" | "warning" | "danger" = "ok";
  if (!input.platformSupported) {
    status = "unsupported";
    severity = "warning";
  } else if (account.status === "signed-out" || account.status === "drive-disabled") {
    status = "account-unavailable";
    severity = "danger";
  } else if (!drivePathDetected) {
    status = "missing";
    severity = "danger";
  } else if (!driveWritable || !appFolderWritable) {
    status = "read-only";
    severity = "danger";
  } else if (syncService.checked && !syncService.running) {
    status = "sync-service-unavailable";
    severity = "warning";
  } else if (syncStuckCount > 0) {
    status = "sync-stuck";
    severity = "warning";
  } else if (pendingCount > 0) {
    status = "sync-pending";
    severity = "warning";
  }
  return {
    status,
    severity,
    drivePathDetected,
    appFolderExists,
    driveWritable,
    appFolderWritable,
    placeholderCount,
    metadataPendingCount,
    pendingCount,
    placeholderStuckCount,
    metadataStuckCount,
    syncStuckCount,
    syncStuckAfterMs,
    placeholderSamples,
    account,
    syncService,
    handoffFile,
    packetFile,
    indexFile,
  };
}

function buildIcloudSyncReadiness(input: {
  availability: ReturnType<typeof getIcloudAvailabilityStatus>;
  handoffHealth: ReturnType<typeof buildIcloudHandoffHealth>;
  indexConsistency: ReturnType<typeof buildIcloudIndexConsistency>;
}) {
  const { availability, handoffHealth, indexConsistency } = input;
  const trackedFiles = [
    { id: "html" as const, state: availability.handoffFile },
    { id: "packet" as const, state: availability.packetFile },
    { id: "index" as const, state: availability.indexFile },
  ];
  const pendingFiles = trackedFiles
    .filter((file) => file.state.placeholder || ["syncing", "not-downloaded", "not-uploaded"].includes(file.state.metadata.syncState))
    .map((file) => file.id);
  const missingFiles = trackedFiles
    .filter((file) => !file.state.exists && file.id !== "index")
    .map((file) => file.id);
  let status:
    | "unsupported"
    | "missing-drive"
    | "read-only"
    | "no-entry"
    | "needs-refresh"
    | "sync-stuck"
    | "syncing"
    | "ready" = "ready";
  let severity: "ok" | "warning" | "danger" = "ok";
  let action:
    | "use-apple-device"
    | "enable-icloud-drive"
    | "fix-permissions"
    | "export-entry"
    | "refresh-entry"
    | "fix-icloud-sync"
    | "wait-for-sync"
    | "open-files-app" = "open-files-app";

  if (availability.status === "unsupported") {
    status = "unsupported";
    severity = "warning";
    action = "use-apple-device";
  } else if (availability.status === "account-unavailable" || availability.status === "missing") {
    status = "missing-drive";
    severity = "danger";
    action = "enable-icloud-drive";
  } else if (availability.status === "read-only") {
    status = "read-only";
    severity = "danger";
    action = "fix-permissions";
  } else if (availability.status === "sync-service-unavailable") {
    status = "syncing";
    severity = "warning";
    action = "wait-for-sync";
  } else if (availability.status === "sync-stuck") {
    status = "sync-stuck";
    severity = "warning";
    action = "fix-icloud-sync";
  } else if (availability.status === "sync-pending" || pendingFiles.length > 0) {
    status = "syncing";
    severity = "warning";
    action = "wait-for-sync";
  } else if (handoffHealth.status === "missing" || missingFiles.length > 0) {
    status = "no-entry";
    severity = "warning";
    action = "export-entry";
  } else if (!indexConsistency.ok) {
    status = "needs-refresh";
    severity = indexConsistency.status === "mismatch" ? "danger" : "warning";
    action = "refresh-entry";
  } else if (handoffHealth.needsRefresh) {
    status = "needs-refresh";
    severity = handoffHealth.status === "expired" || handoffHealth.status === "invalid" || handoffHealth.status === "html-mismatch" ? "danger" : "warning";
    action = "refresh-entry";
  }

  const userStep = buildIcloudSyncUserStep({ action, severity, pendingCount: availability.pendingCount });
  return {
    status,
    severity,
    canOpenOnPhone: status === "ready",
    action,
    userStep,
    pendingCount: availability.pendingCount,
    pendingFiles,
    missingFiles,
    htmlFileState: availability.handoffFile.state,
    packetFileState: availability.packetFile.state,
    indexFileState: availability.indexFile.state,
  };
}

function buildIcloudSyncUserStep(input: {
  action:
    | "use-apple-device"
    | "enable-icloud-drive"
    | "fix-permissions"
    | "export-entry"
    | "refresh-entry"
    | "fix-icloud-sync"
    | "wait-for-sync"
    | "open-files-app";
  severity: "ok" | "warning" | "danger";
  pendingCount: number;
}) {
  const stepByAction = {
    "use-apple-device": {
      id: "use-apple-device",
      primaryAction: "use-qr-or-tunnel",
      titleKey: "onboarding.appleRemoteIcloudNextStepUnsupportedTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepUnsupportedBody",
    },
    "enable-icloud-drive": {
      id: "enable-icloud-drive",
      primaryAction: "open-icloud-settings",
      titleKey: "onboarding.appleRemoteIcloudNextStepEnableTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepEnableBody",
    },
    "fix-permissions": {
      id: "fix-permissions",
      primaryAction: "open-icloud-settings",
      titleKey: "onboarding.appleRemoteIcloudNextStepPermissionsTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepPermissionsBody",
    },
    "export-entry": {
      id: "create-phone-entry",
      primaryAction: "export-icloud-entry",
      titleKey: "onboarding.appleRemoteIcloudNextStepExportTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepExportBody",
    },
    "refresh-entry": {
      id: "refresh-phone-entry",
      primaryAction: "refresh-icloud-entry",
      titleKey: "onboarding.appleRemoteIcloudNextStepRefreshTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepRefreshBody",
    },
    "fix-icloud-sync": {
      id: "repair-icloud-sync",
      primaryAction: "open-icloud-settings",
      titleKey: "onboarding.appleRemoteIcloudNextStepFixSyncTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepFixSyncBody",
    },
    "wait-for-sync": {
      id: "waiting-for-icloud-sync",
      primaryAction: "wait",
      titleKey: "onboarding.appleRemoteIcloudNextStepWaitTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepWaitBody",
    },
    "open-files-app": {
      id: "open-phone-files-app",
      primaryAction: "open-files-app",
      titleKey: "onboarding.appleRemoteIcloudNextStepPhoneTitle",
      bodyKey: "onboarding.appleRemoteIcloudNextStepPhoneBody",
    },
  } as const;
  return {
    ...stepByAction[input.action],
    severity: input.severity,
    pendingCount: input.pendingCount,
  };
}

type IcloudRepairRecommendationId =
  | "refresh-icloud"
  | "open-latest-entry"
  | "regenerate-qr"
  | "start-tailscale"
  | "start-cloudflare"
  | "save-stable-entry"
  | "test-phone-entry"
  | "ready";

type IcloudRepairRecommendation = {
  id: IcloudRepairRecommendationId;
  severity: "ok" | "warning" | "danger";
  detail: string;
};

const ICLOUD_REPAIR_NEXT_ACTION_PRIORITY: IcloudRepairRecommendationId[] = [
  "refresh-icloud",
  "regenerate-qr",
  "start-tailscale",
  "start-cloudflare",
  "save-stable-entry",
  "open-latest-entry",
  "test-phone-entry",
  "ready",
];

function chooseIcloudRepairNextAction(recommendations: IcloudRepairRecommendation[]): IcloudRepairRecommendation {
  for (const id of ICLOUD_REPAIR_NEXT_ACTION_PRIORITY) {
    const recommendation = recommendations.find((item) => item.id === id);
    if (recommendation) return recommendation;
  }
  return recommendations[0] || { id: "ready", severity: "ok", detail: "The phone repair info matches the current desktop entry." };
}

export function analyzeIcloudHandoffRepairPacket(text: unknown) {
  const parsed = parseIcloudRepairPacket(text);
  if (!parsed.valid) {
    throw new Error("Paste the iCloud repair info copied from the phone.");
  }
  const diagnostics = getNetworkDiagnostics();
  const phoneEntryBaseUrl = normalizeRepairBaseUrl(parsed.fields.entryBaseUrl);
  const phoneCurrentBaseUrl = normalizeRepairBaseUrl(parsed.fields.currentBaseUrl);
  const desktopRecommendedBaseUrl = diagnostics.icloud.recommendedBaseUrl || diagnostics.recommendedBaseUrl || "";
  const desktopExportedBaseUrl = diagnostics.icloud.handoffHealth.lastExportedBaseUrl || "";
  const phoneStatus = String(parsed.fields.status || "unknown").slice(0, 80);
  const phoneAction = String(parsed.fields.action || "").slice(0, 120);
  const lastConnectivityOk = parseRepairBool(parsed.fields.lastConnectivityOk);
  const generatedAt = parseRepairTime(parsed.fields.generatedAt);
  const expiresAt = parseRepairTime(parsed.fields.expiresAt);
  const now = Date.now();
  const recommendations: IcloudRepairRecommendation[] = [];
  const seenRecommendations = new Set<string>();
  const addRecommendation = (id: typeof recommendations[number]["id"], severity: typeof recommendations[number]["severity"], detail: string) => {
    if (seenRecommendations.has(id)) return;
    seenRecommendations.add(id);
    recommendations.push({ id, severity, detail });
  };

  let reason:
    | "ready"
    | "invalid-packet"
    | "phone-entry-expired"
    | "phone-entry-stale"
    | "phone-entry-legacy"
    | "phone-entry-mismatch"
    | "desktop-entry-changed"
    | "phone-connectivity-failed"
    | "desktop-local-or-lan"
    | "temporary-entry" = "ready";

  if (!phoneEntryBaseUrl) {
    reason = "invalid-packet";
    addRecommendation("open-latest-entry", "danger", "The repair packet does not include a clean phone entry URL.");
  }
  if (expiresAt && now >= expiresAt) {
    reason = "phone-entry-expired";
    addRecommendation("refresh-icloud", "danger", "The phone opened an expired iCloud entry.");
    addRecommendation("open-latest-entry", "warning", "Open the latest iCloud file on the phone after refreshing.");
  } else if (phoneStatus === "stale") {
    reason = "phone-entry-stale";
    addRecommendation("refresh-icloud", "warning", "The phone entry is older than the refresh window.");
  } else if (phoneStatus === "legacy") {
    reason = "phone-entry-legacy";
    addRecommendation("refresh-icloud", "warning", "The phone entry was generated by an older LifeOS version.");
  } else if (phoneStatus === "address-mismatch" || phoneAction.includes("Mismatch")) {
    reason = "phone-entry-mismatch";
    addRecommendation("open-latest-entry", "warning", "The phone is not using the same base URL as the iCloud entry.");
  }

  if (phoneEntryBaseUrl && desktopRecommendedBaseUrl && phoneEntryBaseUrl !== desktopRecommendedBaseUrl) {
    reason = "desktop-entry-changed";
    addRecommendation("refresh-icloud", "danger", "The desktop currently recommends a different phone entry.");
    addRecommendation("regenerate-qr", "warning", "Regenerate the pairing QR code after refreshing iCloud.");
  }
  if (phoneEntryBaseUrl && desktopExportedBaseUrl && phoneEntryBaseUrl !== desktopExportedBaseUrl) {
    addRecommendation("open-latest-entry", "warning", "The phone opened a URL that differs from the last exported desktop packet.");
  }
  if (lastConnectivityOk === false) {
    reason = reason === "ready" ? "phone-connectivity-failed" : reason;
    addRecommendation("test-phone-entry", "warning", "The phone reported that the last connectivity check failed.");
  }

  const entryMode = modeFromBaseUrl(desktopRecommendedBaseUrl);
  if (diagnostics.remoteReadiness.status === "local-only" || diagnostics.remoteReadiness.status === "lan-only" || entryMode === "local" || entryMode === "lan") {
    reason = reason === "ready" ? "desktop-local-or-lan" : reason;
    addRecommendation("start-tailscale", "warning", "The current entry is local/LAN only. Use Tailscale HTTPS Serve for stable off-LAN access.");
    addRecommendation("start-cloudflare", "warning", "Use Cloudflare Tunnel when a temporary HTTPS public entry is acceptable.");
  } else if (entryMode === "cloudflare" && diagnostics.icloud.recommendedStability === "temporary") {
    reason = reason === "ready" ? "temporary-entry" : reason;
    addRecommendation("save-stable-entry", "warning", "The current Cloudflare quick tunnel is temporary and may change after restart.");
  }

  if (!recommendations.length) {
    addRecommendation("ready", "ok", "The phone repair info matches the current desktop entry.");
  }

  const nextAction = chooseIcloudRepairNextAction(recommendations);

  return {
    ok: true,
    reason,
    severity: recommendations.some((item) => item.severity === "danger") ? "danger" as const : recommendations.some((item) => item.severity === "warning") ? "warning" as const : "ok" as const,
    parsed: {
      status: phoneStatus,
      action: phoneAction,
      entryBaseUrl: phoneEntryBaseUrl,
      currentBaseUrl: phoneCurrentBaseUrl,
      mode: String(parsed.fields.mode || ""),
      stability: String(parsed.fields.stability || ""),
      label: String(parsed.fields.label || ""),
      generatedAt,
      expiresAt,
      lastConnectivityOk,
      lastConnectivityError: String(parsed.fields.lastConnectivityError || "").slice(0, 240),
      rawLength: parsed.rawLength,
    },
    desktop: {
      desktopId: diagnostics.icloud.desktopId,
      desktopName: diagnostics.icloud.desktopName,
      recommendedBaseUrl: desktopRecommendedBaseUrl,
      lastExportedBaseUrl: desktopExportedBaseUrl,
      handoffStatus: diagnostics.icloud.handoffHealth.status,
      handoffNeedsRefresh: diagnostics.icloud.handoffHealth.needsRefresh,
      remoteReadiness: diagnostics.remoteReadiness.status,
      recommendedMode: diagnostics.icloud.recommendedMode,
      recommendedStability: diagnostics.icloud.recommendedStability,
    },
    recommendations,
    nextAction,
  };
}

function getIcloudHandoffStatus(candidates: ConnectionCandidate[]) {
  const platformSupported = isApplePlatform();
  const drivePath = iCloudDrivePath();
  const available = platformSupported && existsSync(drivePath);
  const appFolderPath = path.join(drivePath, "LifeOS AI");
  const desktop = getIcloudDesktopIdentity();
  const handoffFilePath = path.join(appFolderPath, desktop.htmlFileName);
  const packetFilePath = path.join(appFolderPath, desktop.packetFileName);
  const indexFilePath = path.join(appFolderPath, "lifeos-mobile-entry.html");
  const historyFilePath = path.join(appFolderPath, "lifeos-mobile-entry-history.json");
  const legacyHandoffFilePath = path.join(appFolderPath, "lifeos-mobile-entry.html");
  const legacyPacketFilePath = path.join(appFolderPath, "lifeos-mobile-entry.json");
  const healthHandoffFilePath = existsSync(handoffFilePath) ? handoffFilePath : legacyHandoffFilePath;
  const healthPacketFilePath = existsSync(packetFilePath) ? packetFilePath : legacyPacketFilePath;
  const candidate = preferredHandoffCandidate(candidates);
  const hasPhoneEntry = Boolean(candidate);
  const handoffHealth = buildIcloudHandoffHealth({ packetFilePath: healthPacketFilePath, handoffFilePath: healthHandoffFilePath, candidate, candidates });
  const availableEntries = available ? readIcloudEntrySummaries(appFolderPath) : [];
  const entryHistory = available ? readIcloudHandoffHistory(historyFilePath) : [];
  const lifecycle = available ? getIcloudHandoffLifecycleStatus(appFolderPath, desktop.id) : {
    retentionLimit: ICLOUD_HANDOFF_ENTRY_RETENTION_LIMIT,
    expiredGraceMs: getIcloudExpiredCleanupGraceMs(),
    entryCount: 0,
    expiredEntryCount: 0,
    prunableEntryCount: 0,
    orphanedFileCount: 0,
  };
  const availability = getIcloudAvailabilityStatus({
    platformSupported,
    drivePath,
    appFolderPath,
    handoffFilePath,
    packetFilePath,
    indexFilePath,
  });
  const indexConsistency = buildIcloudIndexConsistency({ indexFilePath, entries: availableEntries });
  const syncReadiness = buildIcloudSyncReadiness({ availability, handoffHealth, indexConsistency });
  const latestRepairImport = getLatestIcloudRepairImportRecord();
  const canExport = available && hasPhoneEntry && availability.status !== "account-unavailable" && availability.status !== "read-only";
  return {
    platform: process.platform,
    platformSupported,
    available,
    canExport,
    desktopId: desktop.id,
    desktopName: desktop.name,
    desktopSlug: desktop.slug,
    drivePath: available ? drivePath : "",
    appFolderPath: available ? appFolderPath : "",
    handoffFilePath: available ? handoffFilePath : "",
    packetFilePath: available ? packetFilePath : "",
    indexFilePath: available ? indexFilePath : "",
    historyFilePath: available ? historyFilePath : "",
    availableEntries,
    entryHistory,
    lifecycle,
    recommendedBaseUrl: candidate?.baseUrl || "",
    recommendedLabel: candidate?.label || "",
    recommendedMode: candidate?.mode || "",
    recommendedStability: candidate?.stability || "",
    handoffHealth,
    indexConsistency,
    availability,
    syncReadiness,
    latestRepairImport,
    realtimeTransport: false,
    transport: "handoff-only" as const,
    openInstruction: available
      ? `Open Files on iPhone or iPad, go to iCloud Drive > LifeOS AI, then open lifeos-mobile-entry.html and choose ${desktop.name}.`
      : "Enable iCloud Drive on this Mac, then retry the LifeOS iCloud handoff export.",
    notes: [
      "iCloud Handoff syncs the current mobile entry file between Apple devices.",
      `This desktop writes its own entry file: ${desktop.htmlFileName}.`,
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
    `desktopId=${input.packet.desktopId || "-"}`,
    `desktopName=${input.packet.desktopName || "-"}`,
    `desktopSlug=${input.packet.desktopSlug || "-"}`,
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
    <meta name="lifeos-entry-generated-at" content="${htmlEscape(input.generatedAt)}" />
    <meta name="lifeos-entry-checksum" content="${htmlEscape(input.packet.entryChecksumSha256 || "")}" />
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
      .next-action { margin-top: 14px; border-radius: 18px; padding: 14px; background: rgba(34,211,238,.12); border: 1px solid rgba(34,211,238,.24); color: #cffafe; line-height: 1.65; }
      .next-action strong, .next-action span { display: block; }
      .next-action strong { font-size: 13px; }
      .next-action span { margin-top: 4px; color: #a5f3fc; font-size: 12px; }
      details.recovery { margin-top: 18px; padding: 14px; border-radius: 16px; background: rgba(255,255,255,.04); color: #cbd5e1; font-size: 12px; line-height: 1.6; }
      details.recovery summary { cursor: pointer; font-weight: 800; color: #e4e4e7; }
      textarea { box-sizing: border-box; width: 100%; min-height: 150px; margin-top: 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 14px; background: rgba(0,0,0,.18); color: #cbd5e1; padding: 12px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.55; }
      .copied { display: none; margin-top: 8px; color: #bbf7d0; font-size: 12px; font-weight: 800; }
    </style>
  </head>
  <body>
    <main>
      <h1>LifeOS AI</h1>
      <div class="pill">${htmlEscape(String(input.packet.desktopName || "LifeOS Desktop"))}</div>
      <p>这是通过 iCloud Drive 同步到这台 Apple 设备的 LifeOS 手机入口。先点“绑定这台设备”；已经绑定过时，可以直接打开手机聊天。</p>
      <p class="en">This LifeOS mobile entry was synced through iCloud Drive. Pair this device first, or open mobile chat if it is already paired.</p>
      <div class="pill">${remoteReady ? "适合长期异地使用 / Ready for long-term remote use" : "可先打开，换网后请刷新 / Refresh after network changes"}</div>
      <div class="age age-ok" id="entry-age-status">正在确认这个入口是否可用 / Checking whether this entry is usable...</div>
      <div class="next-action" id="lifeos-next-action">
        <strong>下一步只做这一步 / Do this one thing next</strong>
        <span id="lifeos-next-action-text">点“绑定这台设备”。已经绑定过就点“打开手机聊天”。 / Tap Pair This Device. If already paired, tap Open Mobile Chat.</span>
      </div>
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
      <details class="recovery">
        <summary>高级排障 / Advanced recovery</summary>
        <h2>排障摘要 / Recovery Summary</h2>
        <div>如果手机打不开，把下面这段信息复制给电脑端或开发者排查。它不包含绑定 token 或密码。</div>
        <textarea id="lifeos-recovery" readonly>${htmlEscape(recoverySummary)}</textarea>
        <button class="secondary" type="button" id="copy-recovery">复制修复信息 / Copy Recovery Info</button>
        <div class="copied" id="copy-status">已复制 / Copied</div>
      </details>
      <script type="application/json" id="lifeos-entry">${scriptJson(input.packet)}</script>
      <script>
        (() => {
          const status = document.getElementById("entry-age-status");
          const nextAction = document.getElementById("lifeos-next-action-text");
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
              status.textContent = "这个入口旧了。请回电脑端重新生成入口。 / This entry is old. Create a fresh entry from the desktop.";
              if (nextAction) nextAction.textContent = "现在只做这一步：回电脑端点“重新导出 iCloud 手机入口”，再从 iPhone 文件 App 打开最新入口。 / Do this now: export a fresh iCloud mobile entry on the desktop, then open the latest entry from the iPhone Files app.";
            } else if (refreshAfter && now >= refreshAfter) {
              status.classList.add("age-warn");
              status.textContent = "这个入口可能不是最新。能打开就继续，打不开就回电脑端重新生成。 / This entry may not be the latest. Continue if it opens; otherwise create a fresh one on the desktop.";
              if (nextAction) nextAction.textContent = "现在只做这一步：先点“绑定这台设备”。如果打不开，再回电脑端重新导出入口。 / Do this now: tap Pair This Device first. If it does not open, export a fresh entry on the desktop.";
            } else {
              status.classList.add("age-ok");
              status.textContent = "这个入口可用。可以继续绑定或打开聊天。 / This entry is usable. You can pair or open chat.";
              if (nextAction) nextAction.textContent = "现在只做这一步：点“绑定这台设备”。已经绑定过就点“打开手机聊天”。 / Do this now: tap Pair This Device. If already paired, tap Open Mobile Chat.";
            }
          } catch {
            status.classList.add("age-warn");
            status.textContent = "无法确认这个入口。打不开时，请回电脑端重新生成。 / This entry cannot be checked. Create a fresh one on the desktop if it does not open.";
            if (nextAction) nextAction.textContent = "现在只做这一步：先点“绑定这台设备”。如果失败，再回电脑端重新导出入口。 / Do this now: try Pair This Device first. If it fails, export a fresh entry on the desktop.";
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

export function exportIcloudHandoff(reason = "manual") {
  const diagnostics = getNetworkDiagnostics();
  const status = diagnostics.icloud;
  if (!status.platformSupported) {
    throw new Error("iCloud Handoff is available only on Apple platforms.");
  }
  if (!status.available) {
    throw new Error("iCloud Drive was not detected on this Mac. Enable iCloud Drive, then try again.");
  }
  if (status.availability.status === "account-unavailable") {
    throw new Error("iCloud account or iCloud Drive is not enabled on this Mac. Sign in to Apple ID, enable iCloud Drive, then try again.");
  }
  if (status.availability.status === "read-only") {
    throw new Error("LifeOS cannot write to iCloud Drive. Check iCloud Drive permissions, then try again.");
  }
  const candidate = preferredHandoffCandidate(diagnostics.connectionCandidates);
  if (!candidate) {
    throw new Error("No phone-reachable LifeOS entry is available yet. Use same Wi-Fi, Cloudflare, Tailscale, or another trusted HTTPS entry first.");
  }

  mkdirSync(status.appFolderPath, { recursive: true });
  const generatedAt = Date.now();
  const previousPacket = readIcloudHandoffPacket(status.packetFilePath);
  const previousBaseUrl = String(previousPacket?.baseUrl || "");
  const fallbackCandidates = summarizeIcloudFallbackCandidates(diagnostics.connectionCandidates);
  const previousFallbackCandidates = Array.isArray(previousPacket?.fallbackCandidates) ? previousPacket.fallbackCandidates : [];
  const previousCandidateId = String(previousPacket?.candidateId || "");
  const previousMode = String(previousPacket?.mode || "");
  const previousStability = String(previousPacket?.stability || "");
  const previousGeneratedAt = Number(previousPacket?.generatedAt || 0);
  const previousEntryChecksumSha256 = String(previousPacket?.entryChecksumSha256 || "");
  const changeType = classifyIcloudHandoffChangeType({
    previousBaseUrl,
    nextBaseUrl: candidate.baseUrl,
    previousCandidateId,
    nextCandidateId: candidate.id,
    previousMode,
    nextMode: candidate.mode,
    previousFallbackCandidates,
    nextFallbackCandidates: fallbackCandidates,
  });
  const packet = {
    kind: "lifeos-mobile-entry",
    version: 3,
    desktopId: status.desktopId,
    desktopName: status.desktopName,
    desktopSlug: status.desktopSlug,
    htmlFileName: path.basename(status.handoffFilePath),
    packetFileName: path.basename(status.packetFilePath),
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
    exportReason: reason,
    changeType,
    previousBaseUrl,
    previousCandidateId,
    previousMode,
    previousStability,
    previousGeneratedAt,
    previousEntryChecksumSha256,
    previousFallbackCandidateCount: previousFallbackCandidates.length,
    fallbackCandidateCount: fallbackCandidates.length,
    notes: candidate.notes,
    fallbackCandidates,
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
  const cleanup = cleanupExpiredIcloudHandoffEntries(status.appFolderPath, status.desktopId, generatedAt);
  const entries = readIcloudEntrySummaries(status.appFolderPath);
  writePrivateFileAtomic(status.indexFilePath, buildIcloudHandoffIndexHtml({ generatedAt, currentDesktopId: status.desktopId, entries }));
  writeIcloudHandoffHistory(status.historyFilePath, {
    desktopId: status.desktopId,
    desktopName: status.desktopName,
    reason,
    changeType,
    previousBaseUrl,
    previousCandidateId,
    previousMode,
    previousStability,
    previousGeneratedAt,
    previousEntryChecksumSha256,
    previousFallbackCandidateCount: previousFallbackCandidates.length,
    baseUrl: candidate.baseUrl,
    candidateId: candidate.id,
    mode: candidate.mode,
    stability: candidate.stability,
    fallbackCandidateCount: fallbackCandidates.length,
    generatedAt,
    entryChecksumSha256: packet.entryChecksumSha256,
    htmlFileName: packet.htmlFileName,
    packetFileName: packet.packetFileName,
  });
  return {
    ok: true,
    generatedAt,
    changeType,
    previousBaseUrl,
    cleanup,
    ...getIcloudHandoffStatus(diagnostics.connectionCandidates),
  };
}

export function cleanupIcloudHandoffEntries(reason = "manual-cleanup") {
  const diagnostics = getNetworkDiagnostics();
  const status = diagnostics.icloud;
  if (!status.platformSupported) {
    throw new Error("iCloud Handoff cleanup is available only on Apple platforms.");
  }
  if (!status.available || !status.appFolderPath) {
    throw new Error("iCloud Drive was not detected on this Mac. Enable iCloud Drive, then try again.");
  }
  const cleanedAt = Date.now();
  const cleanup = cleanupExpiredIcloudHandoffEntries(status.appFolderPath, status.desktopId, cleanedAt);
  const entries = readIcloudEntrySummaries(status.appFolderPath);
  writePrivateFileAtomic(status.indexFilePath, buildIcloudHandoffIndexHtml({ generatedAt: cleanedAt, currentDesktopId: status.desktopId, entries }));
  return {
    ok: true,
    reason,
    cleanedAt,
    cleanup,
    ...getIcloudHandoffStatus(diagnostics.connectionCandidates),
  };
}

export function maybeRefreshIcloudHandoff(reason = "auto") {
  const diagnostics = getNetworkDiagnostics();
  const status = diagnostics.icloud;
  const indexConsistencyNeedsRefresh = !status.indexConsistency.ok || status.syncReadiness.action === "refresh-entry";
  const phoneConfirmation = buildIcloudPhoneConfirmationStatus({
    handoffHealth: status.handoffHealth,
    recommendedBaseUrl: status.recommendedBaseUrl,
    latestEntryOpenEvent: getLatestIcloudHandoffEventByTypes(["opened-current-entry"]) || null,
    latestIgnoredEntryEvent: getLatestIcloudHandoffEventByTypes(["ignored-superseded-entry"]) || null,
    latestEntryIssueEvent: getLatestIcloudHandoffEventByTypes([
      "opened-stale-entry",
      "opened-expired-entry",
      "opened-legacy-entry",
      "opened-address-mismatch-entry",
    ]) || null,
  });
  const pairingSession = buildIcloudPairingSessionStatus({
    session: getLatestBindingSession() || null,
    recommendedBaseUrl: status.recommendedBaseUrl,
  });
  const pairingSessionNeedsRefresh = pairingSession.status === "expired" || pairingSession.status === "address-changed";
  if (!status.platformSupported) return { refreshed: false, reason: "unsupported-platform", requestedReason: reason, status: status.handoffHealth.status };
  if (!status.available) return { refreshed: false, reason: "icloud-unavailable", requestedReason: reason, status: status.handoffHealth.status };
  if (status.availability.status === "account-unavailable") return { refreshed: false, reason: "icloud-account-unavailable", requestedReason: reason, status: status.handoffHealth.status };
  if (status.availability.status === "read-only") return { refreshed: false, reason: "icloud-read-only", requestedReason: reason, status: status.handoffHealth.status };
  if (!status.canExport) return { refreshed: false, reason: "no-phone-entry", requestedReason: reason, status: status.handoffHealth.status };
  if (!status.handoffHealth.needsRefresh && !indexConsistencyNeedsRefresh && phoneConfirmation.action !== "refresh-entry" && !pairingSessionNeedsRefresh) {
    return {
      refreshed: false,
      reason: "fresh",
      requestedReason: reason,
      status: status.handoffHealth.status,
      indexConsistencyStatus: status.indexConsistency.status,
      syncReadinessStatus: status.syncReadiness.status,
      syncReadinessAction: status.syncReadiness.action,
      phoneConfirmationStatus: phoneConfirmation.status,
      phoneConfirmationAction: phoneConfirmation.action,
      pairingSessionStatus: pairingSession.status,
      pairingSessionAction: pairingSession.action,
    };
  }
  const handoff = exportIcloudHandoff(reason);
  const refreshReason = status.handoffHealth.needsRefresh
    ? "refreshed"
    : indexConsistencyNeedsRefresh
    ? "index-consistency-refresh"
    : phoneConfirmation.action === "refresh-entry"
    ? "phone-confirmation-refresh"
    : "pairing-session-refresh";
  return {
    refreshed: true,
    reason: refreshReason,
    requestedReason: reason,
    previousStatus: status.handoffHealth.status,
    previousIndexConsistencyStatus: status.indexConsistency.status,
    indexConsistencyStatus: handoff.indexConsistency.status,
    syncReadinessStatus: handoff.syncReadiness.status,
    syncReadinessAction: handoff.syncReadiness.action,
    previousPhoneConfirmationStatus: phoneConfirmation.status,
    phoneConfirmationAction: phoneConfirmation.action,
    previousPairingSessionStatus: pairingSession.status,
    pairingSessionAction: pairingSession.action,
    generatedAt: handoff.generatedAt,
    recommendedBaseUrl: handoff.recommendedBaseUrl,
    changeType: handoff.changeType,
    previousBaseUrl: handoff.previousBaseUrl,
    handoff,
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
