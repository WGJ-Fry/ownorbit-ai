import crypto from "crypto";
import type express from "express";
import { insertAuditLog, redactAuditString } from "../audit";
import { requireAdmin } from "../auth";
import { getRequestActor } from "../auth";
import { BindingSession, DeviceRecord, confirmBindingSession, getBindingSessionById, getDevice, getDevices, getLatestDeviceConnectivityReport, getOpenBindingSessionByToken, insertBindingSession, insertDevice, insertDeviceConnectivityReport, pruneExpiredBindingSessions, revokeDeviceRecord, rotateDeviceToken } from "../devices";
import { getDesktopRuntimeConfig } from "../desktopRuntimeConfig";
import { rateLimit } from "../httpSecurity";
import { getConfiguredPublicBaseUrl, normalizePublicBaseUrl } from "../publicBaseUrl";
import { broadcastRealtime, closeDeviceConnection, isDeviceOnline, sendRealtimeToDevice } from "../realtime";
import { createSecret, tokenHash } from "../security";

function publicBaseUrl(req: express.Request) {
  return getConfiguredPublicBaseUrl() || getDesktopRuntimeConfig()?.publicBaseUrl || `${req.protocol}://${req.get("host")}`;
}

function normalizePairingBaseUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 240) throw new Error("baseUrl is too long");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("baseUrl is invalid");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("baseUrl must not contain username, password, token, query, or fragment");
  }
  const normalized = normalizePublicBaseUrl(raw);
  if (!normalized) throw new Error("Only HTTP/HTTPS baseUrl is allowed");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isUnreachableFromPhone = host === "localhost"
    || host === "0.0.0.0"
    || host === "::"
    || host === "::1"
    || host.startsWith("127.")
    || host.startsWith("169.254.");
  if (isUnreachableFromPhone) {
    throw new Error("baseUrl must be reachable from the phone. Use a LAN IP, Tailscale HTTPS Serve, Cloudflare Tunnel, or another trusted HTTPS address.");
  }
  return normalized;
}

function sanitizeDevice(device: DeviceRecord) {
  const { accessTokenHash, ...safeDevice } = device;
  return safeDevice;
}

function sanitizeDeviceWithConnectivity(device: DeviceRecord) {
  return {
    ...sanitizeDevice(device),
    connectivityReport: getLatestDeviceConnectivityReport(device.id) || null,
  };
}

function normalizeConnectivityReportPayload(body: any) {
  const steps = Array.isArray(body?.steps) ? body.steps.slice(0, 4) : [];
  const health = steps.find((step) => step?.id === "health");
  const mobileShell = steps.find((step) => step?.id === "mobile-shell");
  const websocket = steps.find((step) => step?.id === "websocket");
  const currentBaseUrl = String(body?.currentBase || "").trim();
  if (!currentBaseUrl || currentBaseUrl.length > 240) throw new Error("currentBase is required");
  const parsed = new URL(currentBaseUrl);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("currentBase must be a clean HTTP/HTTPS base URL");
  }
  return {
    ok: Boolean(body?.ok),
    currentBaseUrl,
    healthOk: Boolean(health?.ok),
    mobileShellOk: Boolean(mobileShell?.ok),
    websocketOk: Boolean(websocket?.ok),
    latencyMs: Math.max(0, Math.min(Number(body?.latencyMs) || 0, 120000)),
    error: body?.error ? redactAuditString(String(body.error)).slice(0, 300) : undefined,
  };
}

function deviceTokenExpiresAt(now = Date.now()) {
  return now + Number(process.env.LIFEOS_DEVICE_TOKEN_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;
}

function pairingInstallUrl(baseUrl: string, token: string) {
  return `${baseUrl}/mobile/install/${encodeURIComponent(token)}`;
}

function revokeDevice(device: DeviceRecord, actor: { type: string; id: string }, reason: "admin" | "self") {
  const revokedAt = Date.now();
  const wasOnline = isDeviceOnline(device.id);
  revokeDeviceRecord(device.id, revokedAt);
  closeDeviceConnection(device.id, "Device revoked");
  insertAuditLog(reason === "self" ? "device_self_revoked" : "device_revoked", "device", device.id, {
    deviceName: device.name,
    deviceType: device.type,
    authMethod: device.publicKey ? "signature" : "token",
    publicKeyConfigured: Boolean(device.publicKey),
    credentialExpiresAt: device.accessTokenExpiresAt || null,
    lastSeenAt: device.lastSeenAt,
    wasOnline,
    revokedAt,
  }, actor.type, actor.id);

  broadcastRealtime({
    type: "device.revoked",
    deviceId: device.id,
    timestamp: Date.now(),
  });
}

export function registerDeviceRoutes(app: express.Express) {
  app.post("/api/v1/devices/bind/start", rateLimit({ keyPrefix: "bind-start", windowMs: 5 * 60 * 1000, max: 20 }), requireAdmin, (req, res) => {
    const now = Date.now();
    const token = createSecret("bind");
    let baseUrl = publicBaseUrl(req);
    try {
      baseUrl = normalizePairingBaseUrl(req.body?.baseUrl) || baseUrl;
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Invalid baseUrl" });
    }
    const session: BindingSession = {
      id: crypto.randomUUID(),
      tokenHash: tokenHash(token),
      baseUrl,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
    };

    pruneExpiredBindingSessions(now);
    insertBindingSession(session);
    insertAuditLog("binding_session_created", "binding_session", session.id, {
      baseUrl,
      expiresAt: session.expiresAt,
    }, (req as any).actor?.type, (req as any).actor?.id);

    res.json({
      id: session.id,
      token,
      expiresAt: session.expiresAt,
      baseUrl,
      pairingUrl: pairingInstallUrl(baseUrl, token),
      localName: process.env.LIFEOS_DEVICE_NAME || "LifeOS Local Core",
    });
  });

  app.get("/api/v1/devices/bind/:bindingId", requireAdmin, (req, res) => {
    const session = getBindingSessionById(req.params.bindingId);
    if (!session) return res.status(404).json({ error: "Binding session not found" });

    const device = session.confirmedDeviceId ? getDevice(session.confirmedDeviceId) : undefined;

    res.json({
      id: session.id,
      expiresAt: session.expiresAt,
      baseUrl: session.baseUrl,
      confirmedAt: session.confirmedAt,
      device: device ? sanitizeDevice(device) : null,
    });
  });

  app.post("/api/v1/devices/bind/confirm", rateLimit({ keyPrefix: "bind-confirm", windowMs: 5 * 60 * 1000, max: 20 }), (req, res) => {
    const { token, deviceName, deviceType, publicKey } = req.body || {};
    if (!token || !deviceName) {
      return res.status(400).json({ error: "token and deviceName are required" });
    }

    const now = Date.now();
    const session = getOpenBindingSessionByToken(token, now);
    if (!session) {
      return res.status(400).json({ error: "Binding token is invalid or expired" });
    }

    const accessToken = createSecret("device");
    const device: DeviceRecord = {
      id: crypto.randomUUID(),
      name: String(deviceName).slice(0, 80),
      type: deviceType === "desktop" || deviceType === "browser" ? deviceType : "mobile",
      status: "offline",
      publicKey: typeof publicKey === "string" ? publicKey : undefined,
      accessTokenHash: tokenHash(accessToken),
      accessTokenExpiresAt: deviceTokenExpiresAt(now),
      createdAt: now,
      lastSeenAt: now,
    };

    const authMethod = device.publicKey ? "signature" : "token";
    insertDevice(device);
    confirmBindingSession(session.id, device.id, now);
    insertAuditLog("device_bound", "device", device.id, {
      bindingSessionId: session.id,
      name: device.name,
      type: device.type,
      authMethod,
      credentialExpiresAt: device.accessTokenExpiresAt,
    }, "device", device.id);

    broadcastRealtime({
      type: "pairing.confirmed",
      pairingId: session.id,
      device: sanitizeDevice(device),
      timestamp: now,
    });

    res.json({
      device: sanitizeDevice(device),
      authMethod,
      ...(authMethod === "token" ? { accessToken } : {}),
      accessTokenExpiresAt: device.accessTokenExpiresAt,
    });
  });

  app.post("/api/v1/devices/token/rotate", (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });

    const previousDevice = getDevice(actor.id);
    const accessToken = createSecret("device");
    const accessTokenExpiresAt = deviceTokenExpiresAt();
    const device = rotateDeviceToken(actor.id, tokenHash(accessToken), accessTokenExpiresAt);
    if (!device) return res.status(404).json({ error: "Device not found" });

    insertAuditLog("device_token_rotated", "device", actor.id, {
      deviceName: device.name,
      deviceType: device.type,
      authMethod: device.publicKey ? "signature" : "token",
      previousCredentialExpiresAt: previousDevice?.accessTokenExpiresAt || null,
      credentialExpiresAt: accessTokenExpiresAt,
      rotatedAt: Date.now(),
    }, "device", actor.id);
    res.json({ device: sanitizeDevice(device), accessToken, accessTokenExpiresAt });
  });

  app.delete("/api/v1/devices/me", (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });
    const device = getDevice(actor.id);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    revokeDevice(device, actor, "self");
    res.json({ ok: true, device: sanitizeDevice({ ...device, status: "revoked", revokedAt: Date.now() }) });
  });

  app.post("/api/v1/devices/me/connectivity-report", (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });
    const device = getDevice(actor.id);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    let normalized: ReturnType<typeof normalizeConnectivityReportPayload>;
    try {
      normalized = normalizeConnectivityReportPayload(req.body);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Invalid connectivity report" });
    }

    const report = insertDeviceConnectivityReport({
      id: crypto.randomUUID(),
      deviceId: device.id,
      createdAt: Date.now(),
      ...normalized,
    });
    insertAuditLog("device_connectivity_reported", "device", device.id, {
      ok: report?.ok || false,
      currentBaseUrl: report?.currentBaseUrl || normalized.currentBaseUrl,
      healthOk: report?.healthOk || false,
      mobileShellOk: report?.mobileShellOk || false,
      websocketOk: report?.websocketOk || false,
      latencyMs: report?.latencyMs || normalized.latencyMs,
      error: report?.error || null,
    }, "device", device.id);
    broadcastRealtime({
      type: "device.connectivity_reported",
      deviceId: device.id,
      report,
      timestamp: Date.now(),
    });
    res.json({ ok: true, report });
  });

  app.get("/api/v1/devices/me/connectivity-report", (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });
    const device = getDevice(actor.id);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    res.json({ report: getLatestDeviceConnectivityReport(device.id) || null });
  });

  app.get("/api/v1/devices", requireAdmin, (_req, res) => {
    res.json({
      devices: getDevices().map((device) => ({
        ...sanitizeDeviceWithConnectivity(device),
        status: isDeviceOnline(device.id) ? "online" : device.status,
      })),
    });
  });

  app.post("/api/v1/devices/:deviceId/token/rotation-request", requireAdmin, (req, res) => {
    const device = getDevice(req.params.deviceId);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    const requestedAt = Date.now();
    const delivered = sendRealtimeToDevice(device.id, {
      type: "device.token.rotate_requested",
      deviceId: device.id,
      requestedAt,
      timestamp: requestedAt,
    });

    insertAuditLog("device_token_rotation_requested", "device", device.id, {
      delivered,
      deviceName: device.name,
      deviceType: device.type,
      requestedAt,
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json({ ok: true, delivered });
  });

  app.delete("/api/v1/devices/:deviceId", requireAdmin, (req, res) => {
    const device = getDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: "Device not found" });

    revokeDevice(device, (req as any).actor, "admin");
    res.json({ ok: true });
  });
}
