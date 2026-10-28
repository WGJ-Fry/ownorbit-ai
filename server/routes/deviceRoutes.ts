import crypto from "crypto";
import type express from "express";
import { insertAuditLog, redactAuditString } from "../audit";
import { requireAdmin } from "../auth";
import { getRequestActor } from "../auth";
import { noteCloudKitLocalChange } from "../cloudKitAutoSyncSchedule";
import { BindingSession, DeviceRecord, confirmBindingSessionWithDevice, getBindingSessionById, getBindingSessionByToken, getDevice, getDevices, getLatestDeviceConnectivityReport, getLatestDeviceIcloudHandoffEvent, getOpenBindingSessionByToken, getOpenDeviceMigrationVoucherByToken, insertBindingSession, insertDeviceConnectivityReport, insertDeviceIcloudHandoffEvent, insertDeviceMigrationVoucher, markDeviceMigrationVoucherUsed, migrateDeviceCredential, pruneExpiredBindingSessions, pruneExpiredDeviceMigrationVouchers, revokeDeviceRecord, rotateDeviceToken } from "../devices";
import { rateLimit } from "../httpSecurity";
import { maybeRefreshIcloudHandoff } from "../networkDiagnostics";
import { getDeviceEndpointsSnapshot } from "../deviceEndpoints";
import { pairingBaseUrlNeedsLanBinding } from "../phoneReachability";
import { normalizePublicBaseUrl } from "../publicBaseUrl";
import { broadcastRealtime, closeDeviceConnection, isDeviceOnline, sendRealtimeToDevice } from "../realtime";
import { createSecret, tokenHash } from "../security";

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

// Re-exported so existing imports/tests keep one canonical path.
export { pairingBaseUrlNeedsLanBinding };

function sanitizeDevice(device: DeviceRecord) {
  const { accessTokenHash, ...safeDevice } = device;
  return safeDevice;
}

function sanitizeDeviceWithConnectivity(device: DeviceRecord) {
  return {
    ...sanitizeDevice(device),
    connectivityReport: getLatestDeviceConnectivityReport(device.id) || null,
    icloudHandoffEvent: getLatestDeviceIcloudHandoffEvent(device.id) || null,
  };
}

function normalizeP256PublicKey(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("publicKey must be a base64url P-256 SPKI key");
  const encoded = value.trim();
  if (!encoded || encoded.length > 256 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("publicKey must be a base64url P-256 SPKI key");
  }

  try {
    const der = Buffer.from(encoded, "base64url");
    if (!der.length || der.toString("base64url") !== encoded) {
      throw new Error("non-canonical key");
    }
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (key.asymmetricKeyType !== "ec" || !["prime256v1", "P-256"].includes(String(curve || ""))) {
      throw new Error("unsupported curve");
    }
    const canonical = key.export({ type: "spki", format: "der" }).toString("base64url");
    if (canonical !== encoded) throw new Error("non-canonical key");
    return canonical;
  } catch {
    throw new Error("publicKey must be a canonical P-256 SPKI key");
  }
}

function connectivityAuditSummary(deviceId: string) {
  const report = getLatestDeviceConnectivityReport(deviceId);
  if (!report) return null;
  return {
    ok: report.ok,
    currentBaseUrl: report.currentBaseUrl,
    healthOk: report.healthOk,
    mobileShellOk: report.mobileShellOk,
    websocketOk: report.websocketOk,
    latencyMs: report.latencyMs,
    error: report.error || null,
    createdAt: report.createdAt,
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

function normalizeCleanHttpBaseUrl(value: unknown, fieldName: string) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error(`${fieldName} is required`);
  if (raw.length > 240) throw new Error(`${fieldName} is too long`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${fieldName} is invalid`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${fieldName} must be a clean HTTP/HTTPS base URL`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname === "/" ? "" : pathname}`.replace(/\/$/, "");
}

function normalizeOptionalTimestamp(value: unknown) {
  const next = Number(value || 0);
  return Number.isFinite(next) && next > 0 ? Math.floor(next) : undefined;
}

function normalizeIcloudHandoffEventPayload(body: any) {
  const eventType = String(body?.eventType || "").trim();
  const supportedEventTypes = [
    "opened-current-entry",
    "ignored-superseded-entry",
    "opened-stale-entry",
    "opened-expired-entry",
    "opened-legacy-entry",
    "opened-address-mismatch-entry",
  ] as const;
  if (!supportedEventTypes.includes(eventType as typeof supportedEventTypes[number])) throw new Error("Unsupported iCloud handoff event");
  const normalizedEventType = eventType as typeof supportedEventTypes[number];
  const checksum = String(body?.checksumSha256 || "").trim().toLowerCase();
  if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) throw new Error("checksumSha256 is invalid");
  const now = Date.now();
  const ignoredAt = normalizeOptionalTimestamp(body?.ignoredAt) || now;
  return {
    eventType: normalizedEventType,
    entryBaseUrl: normalizeCleanHttpBaseUrl(body?.entryBaseUrl, "entryBaseUrl"),
    currentBaseUrl: normalizeCleanHttpBaseUrl(body?.currentBaseUrl, "currentBaseUrl"),
    storedBaseUrl: normalizeCleanHttpBaseUrl(body?.storedBaseUrl, "storedBaseUrl"),
    entryGeneratedAt: normalizeOptionalTimestamp(body?.entryGeneratedAt),
    storedGeneratedAt: normalizeOptionalTimestamp(body?.storedGeneratedAt),
    checksumSha256: checksum || undefined,
    ignoredAt: Math.min(ignoredAt, now + 5 * 60 * 1000),
  } as const;
}

function deviceTokenExpiresAt(now = Date.now()) {
  return now + Number(process.env.LIFEOS_DEVICE_TOKEN_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;
}

function pairingInstallUrl(baseUrl: string, token: string) {
  return `${baseUrl}/mobile/install/${encodeURIComponent(token)}`;
}

function safeRefreshIcloudForBinding(reason: string) {
  try {
    return maybeRefreshIcloudHandoff(reason);
  } catch (error: any) {
    return {
      refreshed: false,
      reason: "error",
      requestedReason: reason,
      status: "unknown",
      error: String(error?.message || error || "iCloud Handoff refresh failed").slice(0, 240),
    };
  }
}

function revokeDevice(device: DeviceRecord, actor: { type: string; id: string }, reason: "admin" | "self") {
  const revokedAt = Date.now();
  const wasOnline = isDeviceOnline(device.id);
  revokeDeviceRecord(device.id, revokedAt);
  closeDeviceConnection(device.id, "Device revoked");
  insertAuditLog(reason === "self" ? "device_self_revoked" : "device_revoked", "device", device.id, {
    revokeReason: reason,
    deviceName: device.name,
    deviceType: device.type,
    previousStatus: device.status,
    authMethod: device.publicKey ? "signature" : "token",
    publicKeyConfigured: Boolean(device.publicKey),
    credentialExpiresAt: device.accessTokenExpiresAt || null,
    lastSeenAt: device.lastSeenAt,
    latestConnectivity: connectivityAuditSummary(device.id),
    wasOnline,
    realtimeConnectionClosed: wasOnline,
    revokedAt,
  }, actor.type, actor.id);
  noteCloudKitLocalChange("device-trust", actor);

  broadcastRealtime({
    type: "device.revoked",
    deviceId: device.id,
    timestamp: Date.now(),
  });
}

export function registerDeviceRoutes(app: express.Express, bindHost = "127.0.0.1") {
  app.post("/api/v1/devices/bind/start", rateLimit({ keyPrefix: "bind-start", windowMs: 5 * 60 * 1000, max: 20 }), requireAdmin, (req, res) => {
    const now = Date.now();
    const token = createSecret("bind");
    let baseUrl = "";
    try {
      const requestedBaseUrl = String(req.body?.baseUrl || "").trim();
      baseUrl = requestedBaseUrl
        ? normalizePairingBaseUrl(requestedBaseUrl)
        : getDeviceEndpointsSnapshot(bindHost, { maxAgeMs: 0 }).candidates[0]?.baseUrl || "";
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Invalid baseUrl" });
    }
    if (!baseUrl) {
      insertAuditLog("binding_session_blocked", "binding_session", "unknown", {
        reason: "no_phone_reachable_entry",
        bindHost,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.status(409).json({
        code: "no_phone_reachable_entry",
        error: "No verified phone-reachable address is active yet. Start Tailscale HTTPS Serve, Cloudflare Tunnel, or trusted LAN access, then retry.",
        recovery: { action: "open-connection-guide" },
      });
    }
    if (pairingBaseUrlNeedsLanBinding(baseUrl, bindHost)) {
      insertAuditLog("binding_session_blocked", "binding_session", "unknown", {
        reason: "lan_pairing_requires_lan_binding",
        bindHost,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.status(409).json({
        code: "lan_pairing_requires_lan_binding",
        error: "This computer only listens on its own loopback address, so a LAN QR code cannot be reached from the phone. Turn on LAN access and restart OwnOrbit, or pair through Tailscale HTTPS Serve or Cloudflare Tunnel instead.",
        recovery: { action: "enable-lan-access-and-restart" },
      });
    }
    const session: BindingSession = {
      id: crypto.randomUUID(),
      tokenHash: tokenHash(token),
      baseUrl,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
    };

    try {
      pruneExpiredBindingSessions(now);
      insertBindingSession(session);
      const icloudRefresh = safeRefreshIcloudForBinding("binding-session-created");
      insertAuditLog("binding_session_created", "binding_session", session.id, {
        baseUrl,
        expiresAt: session.expiresAt,
        icloudRefresh,
      }, (req as any).actor?.type, (req as any).actor?.id);
      return res.json({
        id: session.id,
        token,
        expiresAt: session.expiresAt,
        baseUrl,
        pairingUrl: pairingInstallUrl(baseUrl, token),
        localName: process.env.LIFEOS_DEVICE_NAME || "OwnOrbit Local Core",
        icloudRefresh,
      });
    } catch (error: any) {
      console.error("Failed to create binding session:", error?.message || error);
      return res.status(500).json({
        code: "binding_session_create_failed",
        error: "Failed to generate the mobile pairing QR code. Restart OwnOrbit AI to finish the local data upgrade, then try again.",
      });
    }
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
    let normalizedPublicKey: string | undefined;
    try {
      normalizedPublicKey = normalizeP256PublicKey(publicKey);
    } catch (error: any) {
      return res.status(400).json({
        code: "invalid_device_public_key",
        error: error.message || "Device public key is invalid",
      });
    }

    const now = Date.now();
    const knownSession = getBindingSessionByToken(token);
    if (knownSession?.confirmedAt) {
      return res.status(409).json({
        code: "binding_already_used",
        error: "This pairing QR code has already been used. Generate a new QR code to bind another phone.",
      });
    }
    const session = getOpenBindingSessionByToken(token, now);
    if (!session) {
      const icloudRefresh = safeRefreshIcloudForBinding("binding-token-invalid-or-expired");
      insertAuditLog("binding_session_invalid_or_expired", "binding_session", "unknown", {
        deviceName: String(deviceName || "").slice(0, 80),
        deviceType: deviceType === "desktop" || deviceType === "browser" ? deviceType : "mobile",
        icloudRefresh,
        attemptedAt: now,
      }, "device", "unbound");
      broadcastRealtime({
        type: "pairing.invalid_or_expired",
        timestamp: now,
      });
      return res.status(400).json({
        code: "binding_token_invalid_or_expired",
        error: "Binding token is invalid or expired",
        recovery: {
          reason: "binding-token-invalid-or-expired",
          action: "generate-new-qr",
          icloudRefresh,
        },
      });
    }

    const authMethod = normalizedPublicKey ? "signature" : "token";
    const accessToken = createSecret("device");
    const device: DeviceRecord = {
      id: crypto.randomUUID(),
      name: String(deviceName).slice(0, 80),
      type: deviceType === "desktop" || deviceType === "browser" ? deviceType : "mobile",
      status: "offline",
      publicKey: normalizedPublicKey,
      accessTokenHash: tokenHash(accessToken),
      accessTokenExpiresAt: authMethod === "token" ? deviceTokenExpiresAt(now) : undefined,
      createdAt: now,
      lastSeenAt: now,
    };

    if (!confirmBindingSessionWithDevice(session.id, device, now)) {
      return res.status(409).json({
        code: "binding_already_used",
        error: "This pairing QR code has already been used. Generate a new QR code to bind another phone.",
      });
    }
    noteCloudKitLocalChange("device-trust", { type: "device", id: device.id });
    insertAuditLog("device_bound", "device", device.id, {
      bindingSessionId: session.id,
      name: device.name,
      type: device.type,
      authMethod,
      credentialExpiresAt: device.accessTokenExpiresAt || null,
    }, "device", device.id);

    broadcastRealtime({
      type: "pairing.confirmed",
      pairingId: session.id,
      device: sanitizeDevice(device),
      timestamp: now,
    });

    // Hand the phone every currently reachable address at pairing time so a
    // later failure of the pairing address is not a dead end. Never let a
    // diagnostics hiccup break binding itself.
    let endpoints: ReturnType<typeof getDeviceEndpointsSnapshot> | null = null;
    try {
      endpoints = getDeviceEndpointsSnapshot(bindHost);
    } catch {
      endpoints = null;
    }

    res.json({
      device: sanitizeDevice(device),
      authMethod,
      ...(authMethod === "token" ? { accessToken } : {}),
      ...(device.accessTokenExpiresAt ? { accessTokenExpiresAt: device.accessTokenExpiresAt } : {}),
      ...(endpoints ? { endpoints } : {}),
    });
  });

  app.post("/api/v1/devices/token/rotate", (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });

    const previousDevice = getDevice(actor.id);
    if (previousDevice?.publicKey) {
      return res.status(409).json({
        code: "signature_device_token_rotation_not_allowed",
        error: "This device uses a protected signing key and cannot switch to a transferable access token.",
      });
    }
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
    noteCloudKitLocalChange("device-trust", { type: "device", id: actor.id });
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

  // Issued over the OLD, still-working origin so the phone can carry its
  // binding to a new origin without a fresh QR. Short-lived and single-use;
  // only its hash is stored.
  app.post("/api/v1/devices/me/migrate-token", rateLimit({ keyPrefix: "device-migrate-token", windowMs: 5 * 60 * 1000, max: 10 }), (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });
    const device = getDevice(actor.id);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    // Pinning the voucher to the intended target origin means a token that
    // leaks toward the wrong host cannot rotate the credential there.
    let targetBaseUrl: string | undefined;
    const rawTarget = String(req.body?.targetBaseUrl || "").trim();
    if (rawTarget) {
      try {
        targetBaseUrl = new URL(rawTarget).origin.toLowerCase();
      } catch {
        return res.status(400).json({ error: "targetBaseUrl is invalid" });
      }
    }

    const now = Date.now();
    pruneExpiredDeviceMigrationVouchers(now);
    const token = createSecret("migrate");
    const voucher = {
      id: crypto.randomUUID(),
      deviceId: device.id,
      tokenHash: tokenHash(token),
      targetBaseUrl,
      createdAt: now,
      expiresAt: now + 5 * 60 * 1000,
    };
    insertDeviceMigrationVoucher(voucher);
    insertAuditLog("device_migration_voucher_created", "device", device.id, {
      voucherId: voucher.id,
      targetBaseUrl: targetBaseUrl || null,
      expiresAt: voucher.expiresAt,
    }, "device", device.id);
    res.json({ token, expiresAt: voucher.expiresAt });
  });

  // Redeemed on the NEW origin. The phone arrives with a fresh origin-scoped
  // keypair (or none, over plain HTTP) and the whole credential rotates onto
  // it — the old origin's credential stops working at this moment, keeping
  // exactly one active credential per device.
  app.post("/api/v1/devices/migrate/confirm", rateLimit({ keyPrefix: "device-migrate-confirm", windowMs: 5 * 60 * 1000, max: 20 }), (req, res) => {
    const { token, publicKey } = req.body || {};
    if (!token) return res.status(400).json({ error: "token is required" });

    let normalizedPublicKey: string | undefined;
    try {
      normalizedPublicKey = normalizeP256PublicKey(publicKey);
    } catch (error: any) {
      return res.status(400).json({
        code: "invalid_device_public_key",
        error: error.message || "Device public key is invalid",
      });
    }

    const now = Date.now();
    const voucher = getOpenDeviceMigrationVoucherByToken(String(token), now);
    const device = voucher ? getDevice(voucher.deviceId) : undefined;
    if (!voucher || !device || device.revokedAt) {
      insertAuditLog("device_migration_invalid_or_expired", "device", voucher?.deviceId || "unknown", {
        reason: !voucher ? "voucher-invalid-or-expired" : "device-revoked",
        attemptedAt: now,
      }, "device", "unbound");
      return res.status(400).json({
        code: "migration_token_invalid_or_expired",
        error: "Migration token is invalid or expired",
        recovery: { reason: "migration-token-invalid-or-expired", action: "generate-new-qr" },
      });
    }

    // The redeemer must state which origin it is redeeming at; a mismatch
    // against a pinned voucher burns it — a probing wrong host must not leave
    // the token alive for further tries.
    if (voucher.targetBaseUrl) {
      let redeemerOrigin = "";
      try {
        redeemerOrigin = new URL(String(req.body?.targetBaseUrl || "")).origin.toLowerCase();
      } catch {}
      if (redeemerOrigin !== voucher.targetBaseUrl) {
        markDeviceMigrationVoucherUsed(voucher.id, now);
        insertAuditLog("device_migration_target_mismatch", "device", device.id, {
          voucherId: voucher.id,
          attemptedAt: now,
        }, "device", "unbound");
        return res.status(400).json({
          code: "migration_token_invalid_or_expired",
          error: "Migration token is invalid or expired",
          recovery: { reason: "migration-target-mismatch", action: "generate-new-qr" },
        });
      }
    }

    // Same rule token/rotate enforces: a device bound to a protected signing
    // key must not turn into a transferable bearer-token device. Rejected
    // before burning — a missing key is a client capability gap (e.g. a
    // plain-HTTP origin without WebCrypto), not a leaked token, so the
    // voucher stays redeemable from a signature-capable origin.
    if (device.publicKey && !normalizedPublicKey) {
      insertAuditLog("device_migration_key_required", "device", device.id, {
        voucherId: voucher.id,
        attemptedAt: now,
      }, "device", "unbound");
      return res.status(409).json({
        code: "signature_device_token_migration_not_allowed",
        error: "This device uses a protected signing key. Migrate from a secure (HTTPS) address so the new origin can create its own signing key.",
      });
    }

    if (!markDeviceMigrationVoucherUsed(voucher.id, now)) {
      return res.status(400).json({
        code: "migration_token_invalid_or_expired",
        error: "Migration token is invalid or expired",
        recovery: { reason: "migration-token-invalid-or-expired", action: "generate-new-qr" },
      });
    }
    const authMethod = normalizedPublicKey ? "signature" : "token";
    const accessToken = createSecret("device");
    const migrated = migrateDeviceCredential(device.id, {
      publicKey: normalizedPublicKey,
      accessTokenHash: tokenHash(accessToken),
      accessTokenExpiresAt: authMethod === "token" ? deviceTokenExpiresAt(now) : undefined,
      migratedAt: now,
    });
    if (!migrated) {
      return res.status(400).json({
        code: "migration_token_invalid_or_expired",
        error: "Migration token is invalid or expired",
        recovery: { reason: "device-unavailable", action: "generate-new-qr" },
      });
    }

    insertAuditLog("device_migrated", "device", device.id, {
      voucherId: voucher.id,
      authMethod,
      credentialExpiresAt: migrated.accessTokenExpiresAt || null,
    }, "device", device.id);
    noteCloudKitLocalChange("device-trust", { type: "device", id: device.id });
    // The old origin's realtime session authenticated with the credential that
    // just died — close it like revoke does instead of letting it linger.
    closeDeviceConnection(device.id, "credential-migrated");
    broadcastRealtime({ type: "device.migrated", deviceId: device.id, timestamp: now });

    let endpoints: ReturnType<typeof getDeviceEndpointsSnapshot> | null = null;
    try {
      endpoints = getDeviceEndpointsSnapshot(bindHost);
    } catch {
      endpoints = null;
    }

    res.json({
      device: sanitizeDevice(migrated),
      authMethod,
      ...(authMethod === "token" ? { accessToken } : {}),
      ...(migrated.accessTokenExpiresAt ? { accessTokenExpiresAt: migrated.accessTokenExpiresAt } : {}),
      ...(endpoints ? { endpoints } : {}),
    });
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
    const icloudRefresh = report?.ok ? null : safeRefreshIcloudForBinding("device-connectivity-failed");
    insertAuditLog("device_connectivity_reported", "device", device.id, {
      ok: report?.ok || false,
      currentBaseUrl: report?.currentBaseUrl || normalized.currentBaseUrl,
      healthOk: report?.healthOk || false,
      mobileShellOk: report?.mobileShellOk || false,
      websocketOk: report?.websocketOk || false,
      latencyMs: report?.latencyMs || normalized.latencyMs,
      error: report?.error || null,
      icloudRefresh,
    }, "device", device.id);
    broadcastRealtime({
      type: "device.connectivity_reported",
      deviceId: device.id,
      report,
      icloudRefresh,
      timestamp: Date.now(),
    });
    res.json({ ok: true, report, icloudRefresh });
  });

  app.get("/api/v1/devices/me/connectivity-report", (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });
    const device = getDevice(actor.id);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    res.json({ report: getLatestDeviceConnectivityReport(device.id) || null });
  });

  // Behind a tunnel every phone shares one upstream IP, so the bucket must
  // hold several devices' worth of refreshes (clients also self-throttle).
  app.get("/api/v1/devices/me/endpoints", rateLimit({ keyPrefix: "device-endpoints", windowMs: 60 * 1000, max: 60 }), (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });
    const device = getDevice(actor.id);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    let snapshot: ReturnType<typeof getDeviceEndpointsSnapshot>;
    try {
      snapshot = getDeviceEndpointsSnapshot(bindHost);
    } catch {
      return res.status(503).json({ error: "Endpoint snapshot is temporarily unavailable" });
    }
    const knownVersion = String(req.query?.version || "");
    if (knownVersion && knownVersion === snapshot.version) {
      return res.json({ version: snapshot.version, generatedAt: snapshot.generatedAt, unchanged: true });
    }
    res.json({ ...snapshot, unchanged: false });
  });

  app.post("/api/v1/devices/me/icloud-handoff-event", (req, res) => {
    const actor = getRequestActor(req);
    if (!actor || actor.type !== "device") return res.status(401).json({ error: "Device authentication required" });
    const device = getDevice(actor.id);
    if (!device || device.revokedAt) return res.status(404).json({ error: "Device not found" });

    let normalized: ReturnType<typeof normalizeIcloudHandoffEventPayload>;
    try {
      normalized = normalizeIcloudHandoffEventPayload(req.body);
    } catch (error: any) {
      return res.status(400).json({ error: error.message || "Invalid iCloud handoff event" });
    }

    const event = insertDeviceIcloudHandoffEvent({
      id: crypto.randomUUID(),
      deviceId: device.id,
      createdAt: Date.now(),
      ...normalized,
    });
    const icloudRefresh = safeRefreshIcloudForBinding(`device-icloud-handoff-${normalized.eventType}`);
    insertAuditLog("device_icloud_handoff_event_reported", "device", device.id, {
      eventType: event?.eventType || normalized.eventType,
      entryBaseUrl: event?.entryBaseUrl || normalized.entryBaseUrl,
      currentBaseUrl: event?.currentBaseUrl || normalized.currentBaseUrl,
      storedBaseUrl: event?.storedBaseUrl || normalized.storedBaseUrl,
      entryGeneratedAt: event?.entryGeneratedAt || normalized.entryGeneratedAt || null,
      storedGeneratedAt: event?.storedGeneratedAt || normalized.storedGeneratedAt || null,
      checksumPresent: Boolean(event?.checksumSha256 || normalized.checksumSha256),
      ignoredAt: event?.ignoredAt || normalized.ignoredAt,
      icloudRefresh,
    }, "device", device.id);
    broadcastRealtime({
      type: "device.icloud_handoff_event_reported",
      deviceId: device.id,
      event,
      icloudRefresh,
      timestamp: Date.now(),
    });
    res.json({ ok: true, event, icloudRefresh });
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
