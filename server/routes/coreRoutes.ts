import type express from "express";
import { listAiProviderStatuses } from "../appSecrets";
import { isAdminConfigured } from "../auth";
import { getDevices } from "../devices";
import { getCookie } from "../httpSecurity";
import { INSTALL_PAIRING_COOKIE, mobileManifest, normalizeInstallPairingToken } from "../mobileInstall";
import { getConfiguredPublicBaseUrl, isTemporaryTryCloudflareUrl } from "../publicBaseUrl";
import { getDesktopRuntimeConfig } from "../desktopRuntimeConfig";
import { isKnownCandidateOrigin } from "../deviceEndpoints";
import { getOnlineDeviceCount } from "../realtime";
import { getSecurityDiagnostics } from "../securityDiagnostics";
import { getPackageVersion } from "../version";

export function registerCoreRoutes(app: express.Express, host: string) {
  const traceHealth = process.env.LIFEOS_TRACE_HEALTH === "1";
  const trace = (label: string) => {
    if (traceHealth) console.log(`[health-trace] ${label}`);
  };

  app.get("/manifest.webmanifest", (req, res) => {
    const pairingToken = normalizeInstallPairingToken(req.query.pairingToken);
    if (pairingToken) {
      res.setHeader("Cache-Control", "no-store");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
    res.type("application/manifest+json").json(mobileManifest(pairingToken));
  });

  app.get("/api/v1/mobile/pairing-intent", (req, res) => {
    const pairingToken = normalizeInstallPairingToken(getCookie(req, INSTALL_PAIRING_COOKIE));
    res.setHeader("Cache-Control", "no-store");
    res.json({ token: pairingToken });
  });

  app.get("/api/v1/health", (req, res) => {
    trace("start");
    // Cross-candidate probes from the phone (another of this desktop's own
    // addresses) may read health to verify identity; every other origin keeps
    // getting an opaque response.
    const probeOrigin = String(req.headers.origin || "");
    if (probeOrigin) {
      try {
        if (isKnownCandidateOrigin(probeOrigin, host)) {
          res.setHeader("Access-Control-Allow-Origin", probeOrigin);
          res.setHeader("Vary", "Origin");
        }
      } catch {}
    }
    const desktopRuntimeConfig = getDesktopRuntimeConfig();
    trace("desktopRuntimeConfig");
    const configuredPublicBaseUrl = getConfiguredPublicBaseUrl();
    const savedPublicBaseUrl = desktopRuntimeConfig?.publicBaseUrl || "";
    const publicBaseUrl = configuredPublicBaseUrl
      || (savedPublicBaseUrl && !isTemporaryTryCloudflareUrl(savedPublicBaseUrl) ? savedPublicBaseUrl : "");
    trace("publicBaseUrl");
    const activeAiProvider = listAiProviderStatuses().find((provider) => provider.active);
    const aiConfigured = Boolean(activeAiProvider?.configured && !activeAiProvider.credentialResetRequired);
    trace("aiConfigured");
    const adminConfigured = isAdminConfigured();
    trace("adminConfigured");
    const publicAccessWarning = Boolean(publicBaseUrl) || host === "0.0.0.0";
    trace("publicAccessWarning");
    const securityDiagnostics = getSecurityDiagnostics();
    trace("securityDiagnostics");
    const publicRiskItems = securityDiagnostics.publicMode
      ? securityDiagnostics.items.filter((item) => item.status !== "ok")
      : [];
    trace("publicRiskItems");
    const deviceCount = getDevices().length;
    trace("deviceCount");
    const onlineDeviceCount = getOnlineDeviceCount();
    trace("onlineDeviceCount");
    res.json({
      ok: true,
      service: "lifeos-local-core",
      version: getPackageVersion(),
      uptime: process.uptime(),
      deviceCount,
      onlineDeviceCount,
      aiConfigured,
      adminConfigured,
      host,
      networkMode: host === "0.0.0.0" ? "lan" : "local",
      publicBaseUrl,
      remoteEntryMode: desktopRuntimeConfig?.publicBaseUrl && desktopRuntimeConfig.publicBaseUrl === publicBaseUrl ? desktopRuntimeConfig.mode : null,
      publicAccessWarning,
      publicAccessAllowed: process.env.LIFEOS_ALLOW_PUBLIC === "1",
      publicSetupRisk: publicAccessWarning && securityDiagnostics.overall !== "ok",
      publicRisk: {
        overall: securityDiagnostics.publicMode ? securityDiagnostics.overall : "ok",
        items: publicRiskItems.map((item) => ({
          id: item.id,
          label: item.label,
          status: item.status,
          message: item.message,
          action: item.action,
        })),
      },
      timestamp: Date.now(),
    });
    trace("done");
  });
}
