import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const UNIX_SOCKET_PATH_LIMIT = 96;

function runtimeSocketDir(dataDir: string) {
  return path.join(dataDir, "runtime", "tailscale");
}

function fallbackSocketPath(dataDir: string) {
  const userId = typeof process.getuid === "function" ? String(process.getuid()) : "user";
  const digest = crypto.createHash("sha256").update(dataDir).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `ownorbit-${userId}-${digest}`, "core.sock");
}

function pathIsInside(candidate: string, parent: string) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function allowedSocketRoots(dataDir: string) {
  return [runtimeSocketDir(dataDir), path.dirname(fallbackSocketPath(dataDir))].map((value) => path.resolve(value));
}

function assertSafeSocketPath(socketPath: string, dataDir: string) {
  const resolved = path.resolve(socketPath);
  if (!allowedSocketRoots(dataDir).some((root) => pathIsInside(resolved, root))) {
    throw new Error("OwnOrbit Tailscale socket path must stay inside its private runtime directory.");
  }
  return resolved;
}

function assertOwnedFile(stat: fs.Stats, label: string) {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`${label} is owned by another user.`);
  }
}

function ensurePrivateSocketDirectory(socketDir: string) {
  if (fs.existsSync(socketDir)) {
    const stat = fs.lstatSync(socketDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("OwnOrbit Tailscale runtime path is not a private directory.");
    }
    assertOwnedFile(stat, "OwnOrbit Tailscale runtime directory");
  } else {
    fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(socketDir, 0o700);
}

function assertRemovableSocket(socketPath: string) {
  const stat = fs.lstatSync(socketPath);
  if (stat.isSymbolicLink() || !stat.isSocket()) {
    throw new Error("OwnOrbit refused to replace a non-socket file at the Tailscale runtime path.");
  }
  assertOwnedFile(stat, "OwnOrbit Tailscale socket");
}

export function resolveTailscaleSocketPath(platform: NodeJS.Platform = process.platform) {
  // The sandboxed macOS Tailscale app cannot proxy Unix sockets inside another
  // app's private data directory. Keep macOS on the loopback-only core instead.
  if (platform === "win32" || platform === "darwin") return "";
  const dataDir = path.resolve(process.env.LIFEOS_DATA_DIR || path.join(process.cwd(), "data"));
  const configured = String(process.env.LIFEOS_TAILSCALE_SOCKET_PATH || "").trim();
  if (configured) return assertSafeSocketPath(configured, dataDir);
  const preferred = path.join(runtimeSocketDir(dataDir), "core.sock");
  return Buffer.byteLength(preferred) <= UNIX_SOCKET_PATH_LIMIT ? preferred : fallbackSocketPath(dataDir);
}

export function prepareTailscaleSocketPath() {
  const socketPath = resolveTailscaleSocketPath();
  if (!socketPath) return "";
  const socketDir = path.dirname(socketPath);
  ensurePrivateSocketDirectory(socketDir);
  if (fs.existsSync(socketPath)) {
    assertRemovableSocket(socketPath);
    fs.unlinkSync(socketPath);
  }
  process.env.LIFEOS_TAILSCALE_SOCKET_PATH = socketPath;
  return socketPath;
}

export function protectTailscaleSocket(socketPath: string) {
  if (!socketPath || !fs.existsSync(socketPath)) return;
  assertRemovableSocket(socketPath);
  fs.chmodSync(socketPath, 0o600);
}

export function cleanupTailscaleSocket(socketPath = resolveTailscaleSocketPath()) {
  if (!socketPath || !fs.existsSync(socketPath)) return false;
  try {
    const dataDir = path.resolve(process.env.LIFEOS_DATA_DIR || path.join(process.cwd(), "data"));
    assertSafeSocketPath(socketPath, dataDir);
    assertRemovableSocket(socketPath);
    fs.unlinkSync(socketPath);
    return true;
  } catch {
    return false;
  }
}

export function tailscaleServeTarget(
  port: string,
  options: { platform?: NodeJS.Platform; windowsRelayPort?: string } = {},
) {
  const platform = options.platform || process.platform;
  const socketPath = String(process.env.LIFEOS_TAILSCALE_SOCKET_PATH || "").trim();
  if (platform !== "win32" && platform !== "darwin" && socketPath) return `unix:${socketPath}`;
  if (platform === "win32") {
    const relayPort = Number.parseInt(String(options.windowsRelayPort ?? process.env.LIFEOS_TAILSCALE_LOOPBACK_PORT ?? ""), 10);
    return Number.isSafeInteger(relayPort) && relayPort >= 1024 && relayPort <= 65535
      ? `http://127.0.0.1:${relayPort}`
      : "";
  }
  return `http://127.0.0.1:${port}`;
}
