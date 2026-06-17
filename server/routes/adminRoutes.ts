import type express from "express";
import { db } from "../db";
import { insertAuditLog, listAuditLogs } from "../audit";
import { aiProviders, deleteAiApiKey, getAiConfigStatus, getAiProviderStatus, listAiProviderStatuses, saveActiveAiProvider, saveAiApiKey, saveSelectedAiModel, type AiProviderId } from "../appSecrets";
import { createAdminCredential, createAdminSession, getAdminSessionByToken, getBearerToken, isAdminConfigured, requireAdmin, verifyAdminPassword } from "../auth";
import { createDiagnosticBundle, getReleaseDiagnostics } from "../diagnosticBundle";
import { clearHttpOnlyCookie, getClientIp, rateLimit, setClientCookie, setHttpOnlyCookie } from "../httpSecurity";
import { getNetworkDiagnostics, startTailscaleHttpsServe, stopTailscaleHttpsServe, testConnectionUrl } from "../networkDiagnostics";
import { generateCloudflareNamedTunnelConfig, getCloudflareNamedTunnelStatus, getManagedCloudflareTunnelStatus, startConfiguredCloudflareNamedTunnel, startManagedCloudflareTunnel, stopManagedCloudflareTunnel } from "../cloudflareTunnel";
import { saveDesktopRuntimeConfig } from "../desktopRuntimeConfig";
import { getConfiguredPublicBaseUrl } from "../publicBaseUrl";
import { getRemoteValidationReport, saveRemoteValidationReport, summarizeRemoteHealth } from "../remoteValidationReport";
import { runRemoteHealthCheck } from "../remoteHealthMonitor";
import { createSecret, tokenHash } from "../security";
import { setClientState } from "../clientState";
import { evaluatePasswordPolicy, getSecurityDiagnostics } from "../securityDiagnostics";
import { getOnboardingStatus, markOnboardingComplete } from "../onboarding";
import { getBackupSchedule } from "../backupSchedule";
import { getLatestBindingSession } from "../devices";

const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function loginKey(req: express.Request) {
  return getClientIp(req);
}

function getProviderId(value: string): AiProviderId | null {
  return aiProviders.some((provider) => provider.id === value) ? value as AiProviderId : null;
}

function aiStatusAuditMetadata(status: ReturnType<typeof getAiProviderStatus>) {
  return {
    provider: status.provider,
    configured: status.configured,
    enabled: status.enabled,
    source: status.source,
    selectedModel: status.selectedModel,
    secureStorage: {
      current: status.secureStorage?.current || null,
      preferred: status.secureStorage?.preferred,
      label: status.secureStorage?.label,
      systemAvailable: Boolean(status.secureStorage?.systemAvailable),
      fallbackActive: Boolean(status.secureStorage?.fallbackActive),
      migrationRecommended: Boolean(status.secureStorage?.migrationRecommended),
    },
  };
}

function getDataDirDiagnosticLabel() {
  return process.env.LIFEOS_DATA_DIR ? "Custom data directory configured" : "Default data directory";
}

function getAdminNetworkDiagnostics() {
  const diagnostics = getNetworkDiagnostics();
  const remoteValidationReport = getRemoteValidationReport();
  const latestBindingSession = getLatestBindingSession();
  return {
    ...diagnostics,
    cloudflareNamedTunnel: getCloudflareNamedTunnelStatus(),
    remoteValidationReport,
    latestBindingSession: latestBindingSession
      ? {
        id: latestBindingSession.id,
        expiresAt: latestBindingSession.expiresAt,
        confirmedAt: latestBindingSession.confirmedAt || null,
        expired: latestBindingSession.expiresAt <= Date.now() && !latestBindingSession.confirmedAt,
      }
      : null,
    remoteHealthSummary: summarizeRemoteHealth({
      baseUrl: diagnostics.desktopRuntimeConfig?.publicBaseUrl || diagnostics.remoteReadiness.baseUrl,
      readiness: diagnostics.remoteReadiness,
      report: remoteValidationReport,
      pairingSession: latestBindingSession,
    }),
  };
}

export function registerAdminRoutes(app: express.Express) {
  app.get("/api/v1/admin/status", (req, res) => {
    const configured = isAdminConfigured();
    const authenticated = Boolean(getAdminSessionByToken(getBearerToken(req)));
    const onboarding = configured && authenticated ? getOnboardingStatus() : null;
    res.json({
      configured,
      authenticated,
      envManaged: Boolean(process.env.LIFEOS_ADMIN_PASSWORD),
      onboardingRequired: onboarding?.required ?? null,
      nextPath: onboarding?.nextPath ?? null,
    });
  });

  app.get("/api/v1/admin/onboarding", requireAdmin, (_req, res) => {
    res.json({ onboarding: getOnboardingStatus() });
  });

  app.put("/api/v1/admin/onboarding/complete", requireAdmin, (req, res) => {
    try {
      const onboarding = markOnboardingComplete({ type: "admin", id: "owner" });
      insertAuditLog("admin_onboarding_completed", "admin", "owner", {
        completedAt: onboarding.completedAt,
        steps: onboarding.steps.map((step) => ({ id: step.id, done: step.done })),
        securityOverall: onboarding.securityOverall,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ onboarding });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: error.message || "Onboarding is not complete", steps: error.details || undefined });
    }
  });

  app.get("/api/v1/admin/config-diagnostics", requireAdmin, (_req, res) => {
    const publicBaseUrl = getConfiguredPublicBaseUrl();
    const host = process.env.LIFEOS_HOST || "127.0.0.1";
    const aiStatus = getAiConfigStatus();
    const publicAccessWarning = Boolean(publicBaseUrl) || host === "0.0.0.0";
    const backupSchedule = getBackupSchedule();

    res.json({
      ai: {
        ...aiStatus,
        recommendations: aiStatus.configured
          ? [
            aiStatus.source === "environment"
              ? "AI service is configured by environment variables. Restart LifeOS AI after changing them."
              : `AI Key has been saved to ${aiStatus.secureStorage.label}.`,
          ]
          : [
            aiStatus.secureStorage.systemAvailable ? "The desktop app will prefer system secure storage for AI Keys." : "This environment will store AI Keys with local AES-GCM encryption.",
            "You can also set GEMINI_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or LOCAL_MODEL_BASE_URL in .env.local and restart LifeOS AI.",
          ],
      },
      network: {
        host,
        publicBaseUrl,
        publicAccessAllowed: process.env.LIFEOS_ALLOW_PUBLIC === "1",
        publicAccessWarning,
        recommendations: publicAccessWarning
          ? ["Expose the service only through a trusted HTTPS tunnel or controlled reverse proxy.", "Public/LAN mode must explicitly set LIFEOS_ALLOW_PUBLIC=1.", "Set LIFEOS_TRUST_PROXY=1 only behind a trusted proxy."]
          : ["Currently listening on localhost only, suitable for desktop-only use."],
      },
      storage: {
        dataDir: getDataDirDiagnosticLabel(),
        dataDirConfigured: Boolean(process.env.LIFEOS_DATA_DIR),
        backupRetentionCount: process.env.LIFEOS_BACKUP_RETENTION_COUNT || "20",
        backupSchedule: {
          enabled: backupSchedule.enabled,
          intervalHours: backupSchedule.intervalHours,
          nextRunAt: backupSchedule.nextRunAt,
        },
        recommendations: backupSchedule.enabled
          ? ["Before upgrade, restore, or public access, confirm the latest SQLite backup is usable."]
          : ["Create a SQLite backup before upgrade, restore, or public access.", "Enable scheduled backups for long-term use."],
      },
      release: {
        ...getReleaseDiagnostics(),
        recommendations: ["When publishing for regular users, provide installers, USER-INSTALL.md, SHA256SUMS, and release-manifest.json."],
      },
      securityCheck: getSecurityDiagnostics(),
    });
  });

  app.get("/api/v1/admin/network-diagnostics", requireAdmin, (_req, res) => {
    res.json(getAdminNetworkDiagnostics());
  });

  app.post("/api/v1/admin/network-diagnostics/test-url", requireAdmin, async (req, res) => {
    const baseUrl = String(req.body?.baseUrl || "").trim();
    const persist = Boolean(req.body?.persist);
    const label = String(req.body?.label || "").trim();
    if (!baseUrl) return res.status(400).json({ error: "baseUrl is required" });
    try {
      const result = await testConnectionUrl(baseUrl);
      const remoteValidationReport = persist
        ? saveRemoteValidationReport({ label, baseUrl, result }, { type: "admin", id: "owner" })
        : getRemoteValidationReport();
      insertAuditLog("network_connection_tested", "network", baseUrl, {
        ok: result.ok,
        status: result.status,
        latencyMs: result.latencyMs,
        persisted: persist,
        baseUrl: remoteValidationReport?.baseUrl,
      });
      res.json({ result, remoteValidationReport });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Connection test failed" });
    }
  });

  app.post("/api/v1/admin/network-diagnostics/remote-health", requireAdmin, async (_req, res) => {
    try {
      const result = await runRemoteHealthCheck("manual");
      res.json({ ...result, diagnostics: getAdminNetworkDiagnostics() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Remote health check failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.get("/api/v1/admin/cloudflare-tunnel", requireAdmin, (_req, res) => {
    res.json({ tunnel: getManagedCloudflareTunnelStatus(), diagnostics: getAdminNetworkDiagnostics() });
  });

  app.post("/api/v1/admin/cloudflare-named-tunnel/config", requireAdmin, (req, res) => {
    try {
      const status = generateCloudflareNamedTunnelConfig({
        name: req.body?.name,
        hostname: req.body?.hostname,
        credentialsFile: req.body?.credentialsFile,
      });
      insertAuditLog("cloudflare_named_tunnel_config_generated", "network", status.baseUrl || "cloudflare-named", {
        hostname: status.hostname,
        configPath: status.configPath,
        publicBaseUrlConfigured: Boolean(status.desktopConfig.publicBaseUrl),
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ namedTunnel: getCloudflareNamedTunnelStatus(), diagnostics: getAdminNetworkDiagnostics(), message: "Cloudflare Named Tunnel config generated and saved for startup." });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Cloudflare Named Tunnel config is invalid" });
    }
  });

  app.post("/api/v1/admin/cloudflare-named-tunnel/start", requireAdmin, async (req, res) => {
    try {
      const tunnel = await startConfiguredCloudflareNamedTunnel();
      const namedTunnel = getCloudflareNamedTunnelStatus();
      if (namedTunnel.baseUrl) process.env.PUBLIC_BASE_URL = namedTunnel.baseUrl;
      insertAuditLog("cloudflare_named_tunnel_started", "network", namedTunnel.baseUrl || "cloudflare-named", {
        pid: tunnel.pid,
        hostname: namedTunnel.hostname,
        configPath: namedTunnel.configPath,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ tunnel, namedTunnel, diagnostics: getAdminNetworkDiagnostics(), message: "Cloudflare Named Tunnel started. The stable HTTPS domain is now the mobile pairing address." });
    } catch (error: any) {
      insertAuditLog("cloudflare_named_tunnel_start_failed", "network", "cloudflare-named", {
        error: error?.message || "Cloudflare Named Tunnel start failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Cloudflare Named Tunnel start failed", namedTunnel: getCloudflareNamedTunnelStatus() });
    }
  });

  app.post("/api/v1/admin/cloudflare-tunnel/start", requireAdmin, async (req, res) => {
    const port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000");
    try {
      const tunnel = await startManagedCloudflareTunnel(port);
      if (!tunnel.url) throw new Error("Cloudflare Tunnel did not return a public URL");
      const config = saveDesktopRuntimeConfig({
        mode: "cloudflare",
        label: "Cloudflare Tunnel",
        baseUrl: tunnel.url,
      });
      process.env.PUBLIC_BASE_URL = tunnel.url;
      insertAuditLog("cloudflare_tunnel_started", "network", tunnel.url, {
        pid: tunnel.pid,
        url: tunnel.url,
        configMode: config.mode,
        publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        tunnel,
        config,
        diagnostics: getAdminNetworkDiagnostics(),
        message: "Cloudflare Tunnel started. The public HTTPS address has been saved for mobile pairing.",
      });
    } catch (error: any) {
      insertAuditLog("cloudflare_tunnel_start_failed", "network", "cloudflare", {
        error: error?.message || "Cloudflare Tunnel start failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Cloudflare Tunnel start failed", tunnel: getManagedCloudflareTunnelStatus() });
    }
  });

  app.post("/api/v1/admin/cloudflare-tunnel/stop", requireAdmin, (req, res) => {
    const tunnel = stopManagedCloudflareTunnel();
    insertAuditLog("cloudflare_tunnel_stopped", "network", "cloudflare", {
      stoppedAt: Date.now(),
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.json({ tunnel, diagnostics: getAdminNetworkDiagnostics(), message: "Cloudflare Tunnel stopped." });
  });

  app.post("/api/v1/admin/tailscale-serve/start", requireAdmin, (req, res) => {
    const port = String(process.env.LIFEOS_PORT || process.env.PORT || "3000");
    try {
      const serve = startTailscaleHttpsServe(port);
      const config = saveDesktopRuntimeConfig({
        mode: "tailscale",
        label: "Tailscale HTTPS Serve",
        baseUrl: serve.url,
      });
      process.env.PUBLIC_BASE_URL = serve.url;
      insertAuditLog("tailscale_https_serve_started", "network", serve.url, {
        command: serve.command,
        url: serve.url,
        configMode: config.mode,
        publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        serve,
        config,
        diagnostics: getAdminNetworkDiagnostics(),
        message: "Tailscale HTTPS Serve started. The stable Tailnet HTTPS address has been saved for mobile pairing.",
      });
    } catch (error: any) {
      insertAuditLog("tailscale_https_serve_start_failed", "network", "tailscale", {
        error: error?.message || "Tailscale HTTPS Serve start failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Tailscale HTTPS Serve start failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.post("/api/v1/admin/tailscale-serve/stop", requireAdmin, (req, res) => {
    try {
      const serve = stopTailscaleHttpsServe();
      insertAuditLog("tailscale_https_serve_stopped", "network", serve.url || "tailscale", {
        command: serve.command,
        url: serve.url,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({ serve, diagnostics: getAdminNetworkDiagnostics(), message: "Tailscale HTTPS Serve stopped." });
    } catch (error: any) {
      insertAuditLog("tailscale_https_serve_stop_failed", "network", "tailscale", {
        error: error?.message || "Tailscale HTTPS Serve stop failed",
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.status(400).json({ error: error.message || "Tailscale HTTPS Serve stop failed", diagnostics: getAdminNetworkDiagnostics() });
    }
  });

  app.put("/api/v1/admin/desktop-connection-config", requireAdmin, (req, res) => {
    try {
      const config = saveDesktopRuntimeConfig({
        mode: req.body?.mode,
        label: req.body?.label,
        baseUrl: req.body?.baseUrl,
      });
      insertAuditLog("desktop_connection_config_saved", "network", config.mode, {
        mode: config.mode,
        label: config.label,
        host: config.host,
        port: config.port,
        publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
        allowPublic: config.allowPublic,
        restartRequired: true,
      }, (req as any).actor?.type, (req as any).actor?.id);
      res.json({
        config,
        restartRequired: true,
        message: "Desktop connection configuration saved. Quit and reopen LifeOS AI for it to take effect.",
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Desktop connection configuration is invalid" });
    }
  });

  app.get("/api/v1/admin/ai-providers", requireAdmin, (_req, res) => {
    res.json({ providers: listAiProviderStatuses() });
  });

  app.post("/api/v1/admin/ai-providers/:providerId/test", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    const status = getAiProviderStatus(providerId);
    insertAuditLog("ai_provider_tested", "config", providerId, {
      ...aiStatusAuditMetadata(status),
      result: status.enabled && status.configured ? "ready" : "not_configured",
    });
    res.json({
      ok: status.enabled && status.configured,
      provider: status,
      message: status.enabled
        ? status.configured
          ? `${status.provider} is configured.`
          : status.id === "local"
            ? `${status.provider} has no endpoint configured.`
            : `${status.provider} has no key configured.`
        : `${status.provider} configuration is disabled.`,
    });
  });

  app.put("/api/v1/admin/ai-providers/:providerId/model", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    const model = String(req.body?.model || "").trim();
    try {
      const status = saveSelectedAiModel(providerId, model, { type: "admin", id: "owner" });
      insertAuditLog("ai_provider_model_updated", "config", providerId, {
        provider: status.provider,
        model: status.selectedModel,
      });
      res.json({ provider: status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Unsupported AI model" });
    }
  });

  app.put("/api/v1/admin/ai-providers/:providerId/active", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    try {
      saveActiveAiProvider(providerId, { type: "admin", id: "owner" });
      const status = getAiProviderStatus(providerId);
      insertAuditLog("ai_provider_default_updated", "config", providerId, {
        provider: status.provider,
        active: status.active,
        configured: status.configured,
        selectedModel: status.selectedModel,
      });
      res.json({ provider: status, providers: listAiProviderStatuses() });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Could not update default AI provider" });
    }
  });

  app.get("/api/v1/admin/diagnostic-bundle", requireAdmin, (req, res) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bundle = createDiagnosticBundle() as any;
    insertAuditLog("diagnostic_bundle_exported", "diagnostics", "lifeos-diagnostics", {
      stamp,
      aiConfigured: Boolean(bundle.ai?.configured),
      aiProviders: Array.isArray(bundle.ai?.providers) ? bundle.ai.providers.length : 0,
      configuredAiProviders: Array.isArray(bundle.ai?.providers) ? bundle.ai.providers.filter((provider: any) => provider.configured).length : 0,
      deviceTotal: bundle.devices?.total || 0,
      deviceActive: bundle.devices?.active || 0,
      deviceOnline: bundle.devices?.online || 0,
      backupCount: bundle.database?.backups?.length || 0,
      pendingRestore: Boolean(bundle.database?.pendingRestore),
      releaseManifestAvailable: Boolean(bundle.release?.manifestAvailable),
      releaseChecksumAvailable: Boolean(bundle.release?.checksumAvailable),
      releaseArtifactCount: bundle.release?.artifactCount || 0,
      securityOverall: bundle.security?.overall || "unknown",
      publicMode: Boolean(bundle.security?.publicMode),
    }, (req as any).actor?.type, (req as any).actor?.id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="lifeos-diagnostics-${stamp}.json"`);
    res.json(bundle);
  });

  app.put("/api/v1/admin/ai-key", requireAdmin, (req, res) => {
    const apiKey = String(req.body?.apiKey || "").trim();
    if (process.env.GEMINI_API_KEY) {
      return res.status(409).json({ error: "AI key is managed by GEMINI_API_KEY environment variable" });
    }
    if (apiKey.length < 16) {
      return res.status(400).json({ error: "API key is too short" });
    }

    saveAiApiKey(apiKey);
    const status = getAiConfigStatus();
    insertAuditLog("ai_key_saved", "config", "google_gemini", aiStatusAuditMetadata(status));
    res.json({ ai: getAiConfigStatus() });
  });

  app.put("/api/v1/admin/ai-providers/:providerId/key", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    const provider = aiProviders.find((item) => item.id === providerId)!;
    const apiKey = String(req.body?.apiKey || "").trim();
    if (process.env[provider.envVar]) {
      return res.status(409).json({ error: `AI key is managed by ${provider.envVar} environment variable` });
    }
    if (apiKey.length < 8) {
      return res.status(400).json({ error: "API key is too short" });
    }

    try {
      saveAiApiKey(apiKey, providerId);
      const status = getAiProviderStatus(providerId);
      insertAuditLog("ai_key_saved", "config", providerId, aiStatusAuditMetadata(status));
      res.json({ provider: status });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "AI provider configuration is invalid" });
    }
  });

  app.delete("/api/v1/admin/ai-key", requireAdmin, (_req, res) => {
    if (process.env.GEMINI_API_KEY) {
      return res.status(409).json({ error: "AI key is managed by GEMINI_API_KEY environment variable" });
    }
    deleteAiApiKey();
    const status = getAiConfigStatus();
    insertAuditLog("ai_key_deleted", "config", "google_gemini", aiStatusAuditMetadata(status));
    res.json({ ai: getAiConfigStatus() });
  });

  app.delete("/api/v1/admin/ai-providers/:providerId/key", requireAdmin, (req, res) => {
    const providerId = getProviderId(req.params.providerId);
    if (!providerId) return res.status(404).json({ error: "Unknown AI provider" });
    const provider = aiProviders.find((item) => item.id === providerId)!;
    if (process.env[provider.envVar]) {
      return res.status(409).json({ error: `AI key is managed by ${provider.envVar} environment variable` });
    }
    deleteAiApiKey(providerId);
    const status = getAiProviderStatus(providerId);
    insertAuditLog("ai_key_deleted", "config", providerId, aiStatusAuditMetadata(status));
    res.json({ provider: status });
  });

  app.post("/api/v1/admin/setup", (req, res) => {
    if (isAdminConfigured()) {
      return res.status(409).json({ error: "Admin is already configured" });
    }

    const password = String(req.body?.password || "");
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    createAdminCredential(password);
    setClientState("lifeos_admin_password_policy", evaluatePasswordPolicy(password), { type: "admin", id: "owner" });
    const session = createAdminSession();
    setHttpOnlyCookie(res, "lifeos_admin_session", session.token, session.expiresAt);
    setClientCookie(res, "lifeos_csrf", createSecret("csrf"), session.expiresAt);
    res.json({ expiresAt: session.expiresAt, onboardingRequired: true, nextPath: "/admin/onboarding" });
  });

  app.put("/api/v1/admin/password", requireAdmin, (req, res) => {
    if (process.env.LIFEOS_ADMIN_PASSWORD) {
      return res.status(409).json({ error: "Admin password is managed by LIFEOS_ADMIN_PASSWORD environment variable" });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!verifyAdminPassword(currentPassword)) {
      insertAuditLog("admin_password_change_failed", "admin", "owner", { reason: "invalid_current_password" }, "admin", "owner");
      return res.status(401).json({ error: "Current password is invalid" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const policy = evaluatePasswordPolicy(newPassword);
    createAdminCredential(newPassword, { auditAction: false });
    setClientState("lifeos_admin_password_policy", policy, { type: "admin", id: "owner" });
    insertAuditLog("admin_password_changed", "admin", "owner", {
      meetsPolicy: policy.meetsPolicy,
      lengthBucket: policy.lengthBucket,
      hasVariety: policy.hasVariety,
      notCommon: policy.notCommon,
    }, "admin", "owner");
    res.json({ ok: true, passwordPolicy: policy, securityCheck: getSecurityDiagnostics() });
  });

  app.post("/api/v1/admin/login", rateLimit({ keyPrefix: "admin-login", windowMs: 15 * 60 * 1000, max: 12 }), (req, res) => {
    if (!isAdminConfigured()) {
      return res.status(409).json({ error: "Admin setup is required" });
    }

    const key = loginKey(req);
    const failure = loginFailures.get(key);
    if (failure && failure.lockedUntil > Date.now()) {
      res.setHeader("Retry-After", String(Math.ceil((failure.lockedUntil - Date.now()) / 1000)));
      return res.status(423).json({ error: "Admin login is temporarily locked" });
    }

    const password = String(req.body?.password || "");
    if (!verifyAdminPassword(password)) {
      const next = { count: (failure?.count || 0) + 1, lockedUntil: 0 };
      if (next.count >= 5) next.lockedUntil = Date.now() + 10 * 60 * 1000;
      loginFailures.set(key, next);
      insertAuditLog("admin_login_failed", "admin", "owner");
      return res.status(401).json({ error: "Invalid password" });
    }

    loginFailures.delete(key);
    const session = createAdminSession();
    setHttpOnlyCookie(res, "lifeos_admin_session", session.token, session.expiresAt);
    setClientCookie(res, "lifeos_csrf", createSecret("csrf"), session.expiresAt);
    const onboarding = getOnboardingStatus();
    res.json({ expiresAt: session.expiresAt, onboardingRequired: onboarding.required, nextPath: onboarding.nextPath });
  });

  app.post("/api/v1/admin/logout", requireAdmin, (req, res) => {
    const token = getBearerToken(req);
    if (token) {
      db.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?").run(Date.now(), tokenHash(token));
    }
    clearHttpOnlyCookie(res, "lifeos_admin_session");
    clearHttpOnlyCookie(res, "lifeos_csrf");
    insertAuditLog("admin_logout", "admin", "owner");
    res.json({ ok: true });
  });

  app.get("/api/v1/audit-logs", requireAdmin, (_req, res) => {
    res.json({ logs: listAuditLogs() });
  });
}
