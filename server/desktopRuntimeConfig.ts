import fs from "fs";
import path from "path";
import { normalizePublicBaseUrl } from "./publicBaseUrl.ts";

export type DesktopRuntimeMode = "configured" | "cloudflare" | "tailscale" | "lan" | "local";

export type DesktopRuntimeConfig = {
  mode: DesktopRuntimeMode;
  label: string;
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  publicBaseUrl: string;
  allowPublic: boolean;
  baseUrl: string;
  updatedAt: number;
};

export const desktopRuntimeConfigPath = path.join(process.env.LIFEOS_DATA_DIR || path.join(process.cwd(), "data"), "desktop-runtime-config.json");

const allowedModes = new Set<DesktopRuntimeMode>(["configured", "cloudflare", "tailscale", "lan", "local"]);

function normalizeMode(value: unknown): DesktopRuntimeMode {
  const mode = String(value || "").trim() as DesktopRuntimeMode;
  if (!allowedModes.has(mode)) throw new Error("Unsupported desktop connection mode");
  return mode;
}

function normalizeLabel(value: unknown, mode: DesktopRuntimeMode) {
  const label = String(value || "").trim().slice(0, 80);
  return label || mode;
}

function normalizePort(value: unknown, fallback: number) {
  const port = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(port)) return fallback;
  if (port < 1024 || port > 65535) throw new Error("Desktop connection port must be between 1024 and 65535");
  return port;
}

function rejectUnsafeSavedBaseUrl(value: unknown) {
  const raw = String(value || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Desktop connection baseUrl must not contain username, password, token, query, or fragment");
  }
}

export function normalizeDesktopRuntimeConfig(input: {
  mode?: unknown;
  label?: unknown;
  baseUrl?: unknown;
}) {
  const mode = normalizeMode(input.mode);
  const fallbackPort = normalizePort(process.env.LIFEOS_PORT || process.env.PORT || "3000", 3000);
  rejectUnsafeSavedBaseUrl(input.baseUrl);
  const normalizedBaseUrl = normalizePublicBaseUrl(input.baseUrl);
  if (!normalizedBaseUrl) throw new Error("Desktop connection baseUrl must be a valid HTTP/HTTPS URL");
  const parsed = new URL(normalizedBaseUrl);
  if ((mode === "configured" || mode === "cloudflare") && parsed.protocol !== "https:") {
    throw new Error("Public remote connection modes require an HTTPS baseUrl");
  }
  const port = normalizePort(parsed.port || fallbackPort, fallbackPort);
  const isLocal = mode === "local";
  const isLan = mode === "lan";
  const isTailscaleHttpsServe = mode === "tailscale" && parsed.protocol === "https:";
  const publicBaseUrl = isLocal || isLan ? "" : normalizedBaseUrl;
  return {
    mode,
    label: normalizeLabel(input.label, mode),
    host: isLocal || isTailscaleHttpsServe ? "127.0.0.1" as const : "0.0.0.0" as const,
    port,
    publicBaseUrl,
    allowPublic: !isLocal,
    baseUrl: normalizedBaseUrl,
    updatedAt: Date.now(),
  };
}

export function getDesktopRuntimeConfig(): DesktopRuntimeConfig | null {
  if (!fs.existsSync(desktopRuntimeConfigPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(desktopRuntimeConfigPath, "utf8"));
    return normalizeDesktopRuntimeConfig(parsed);
  } catch {
    return null;
  }
}

export function saveDesktopRuntimeConfig(input: { mode?: unknown; label?: unknown; baseUrl?: unknown }) {
  const config = normalizeDesktopRuntimeConfig(input);
  fs.mkdirSync(path.dirname(desktopRuntimeConfigPath), { recursive: true });
  fs.writeFileSync(desktopRuntimeConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}
