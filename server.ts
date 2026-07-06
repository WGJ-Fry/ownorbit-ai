import "./server/env";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { storePath } from "./server/db";
import { tokenHash } from "./server/security";
import { insertAuditLog } from "./server/audit";
import { DeviceRecord, BindingSession, getDevices, insertBindingSession, insertDevice } from "./server/devices";
import { registerAiRoutes } from "./server/aiRoutes";
import { registerAdminRoutes } from "./server/routes/adminRoutes";
import { registerBackupRoutes } from "./server/routes/backupRoutes";
import { registerChatRoutes } from "./server/routes/chatRoutes";
import { registerCoreRoutes } from "./server/routes/coreRoutes";
import { registerCustomAppRoutes } from "./server/routes/customAppRoutes";
import { registerDeviceRoutes } from "./server/routes/deviceRoutes";
import { registerMemoryRoutes } from "./server/routes/memoryRoutes";
import { registerProblemBlueprintRoutes } from "./server/routes/problemBlueprintRoutes";
import { registerStateRoutes } from "./server/routes/stateRoutes";
import { attachRealtimeServer } from "./server/realtime";
import { runMigrations } from "./server/migrations";
import { redactApiErrorResponses, requireCsrf, securityHeaders } from "./server/httpSecurity";
import { startBackupScheduler } from "./server/backupSchedule";
import { maybeStartConfiguredCloudflareTunnel } from "./server/cloudflareTunnel";
import { startIcloudHandoffMonitor } from "./server/icloudHandoffMonitor";
import { maybeRefreshIcloudHandoff, maybeStartConfiguredTailscaleServe } from "./server/networkDiagnostics";
import { startRemoteHealthMonitor } from "./server/remoteHealthMonitor";
import { getInstallPairingToken, htmlWithInstallPairingManifest, htmlWithPublicBaseHref, setInstallPairingIntentCookie } from "./server/mobileInstall";
import { getConfiguredPublicBasePath } from "./server/publicBaseUrl";
import { migrateLegacyCustomAppsFromClientState } from "./server/customApps";

const app = express();
const PORT = Number(process.env.LIFEOS_PORT || process.env.PORT || 3000);
const HOST = process.env.LIFEOS_HOST || "127.0.0.1";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.APP_URL || "";
const RUNNING_BUNDLED_SERVER = typeof __dirname !== "undefined" && path.basename(__dirname) === "dist";

if ((HOST === "0.0.0.0" || PUBLIC_BASE_URL) && process.env.LIFEOS_ALLOW_PUBLIC !== "1") {
  throw new Error("Public/LAN mode requires LIFEOS_ALLOW_PUBLIC=1. Set it only behind trusted HTTPS/tunnel protection.");
}

type LifeOSStore = {
  devices: DeviceRecord[];
  bindingSessions: BindingSession[];
};

function migrateLegacyJsonStore() {
  if (!fs.existsSync(storePath)) return;
  if (getDevices(true).length > 0) return;

  try {
    const legacy = JSON.parse(fs.readFileSync(storePath, "utf8")) as LifeOSStore;
    for (const device of legacy.devices || []) {
      insertDevice(device);
    }
    for (const session of legacy.bindingSessions || []) {
      insertBindingSession({
        ...session,
        tokenHash: (session as any).tokenHash || tokenHash((session as any).token || ""),
      });
    }
    insertAuditLog("legacy_store_migrated", "database", "lifeos.db", {
      devices: legacy.devices?.length || 0,
      bindingSessions: legacy.bindingSessions?.length || 0,
    });
  } catch (error) {
    console.warn("Failed to migrate legacy JSON store:", error);
  }
}

runMigrations();
migrateLegacyJsonStore();
migrateLegacyCustomAppsFromClientState();
startBackupScheduler();
startRemoteHealthMonitor();
startIcloudHandoffMonitor();

app.use((req, _res, next) => {
  const basePath = getConfiguredPublicBasePath();
  if (basePath && (req.url === basePath || req.url.startsWith(`${basePath}/`))) {
    req.url = req.url.slice(basePath.length) || "/";
  }
  next();
});

app.use(express.json({ limit: "64mb" }));
app.use(express.urlencoded({ limit: "64mb", extended: true }));
app.use(securityHeaders);
app.use(redactApiErrorResponses);
app.use(requireCsrf);

registerCoreRoutes(app, HOST);
registerAdminRoutes(app);
registerBackupRoutes(app);
registerDeviceRoutes(app);
registerChatRoutes(app);
registerMemoryRoutes(app);
registerProblemBlueprintRoutes(app);
registerCustomAppRoutes(app);
registerStateRoutes(app);

registerAiRoutes(app);

async function startServer() {
  const server = http.createServer(app);
  attachRealtimeServer(server);

  if (process.env.NODE_ENV !== "production" && !RUNNING_BUNDLED_SERVER) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.get(["/mobile/pair", "/mobile/chat", "/mobile/install/:installToken"], async (req, res, next) => {
      const pairingToken = getInstallPairingToken(req);
      if (!pairingToken) {
        next();
        return;
      }
      try {
        const indexPath = path.join(process.cwd(), "index.html");
        const rawHtml = await fs.promises.readFile(indexPath, "utf8");
        const installHtml = htmlWithPublicBaseHref(htmlWithInstallPairingManifest(rawHtml, req));
        const html = await vite.transformIndexHtml(req.originalUrl, installHtml);
        setInstallPairingIntentCookie(res, pairingToken);
        res.setHeader("Cache-Control", "no-store");
        res.status(200).type("html").send(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      const sendSpaIndex = (pairingToken = "") => {
        fs.readFile(indexPath, "utf8", (error, html) => {
          if (error) {
            res.status(500).send("LifeOS web shell is unavailable.");
            return;
          }
          if (pairingToken) {
            setInstallPairingIntentCookie(res, pairingToken);
            res.setHeader("Cache-Control", "no-store");
          }
          const manifestHtml = pairingToken ? htmlWithInstallPairingManifest(html, req) : html;
          res.type("html").send(htmlWithPublicBaseHref(manifestHtml));
        });
      };
      if (
        (req.path === "/mobile/pair" && req.query.token) ||
        (req.path === "/mobile/chat" && req.query.pairingToken) ||
        /^\/mobile\/install\/[^/?#]+$/.test(req.path)
      ) {
        const pairingToken = getInstallPairingToken(req);
        sendSpaIndex(pairingToken);
        return;
      }
      sendSpaIndex();
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    refreshIcloudHandoffAfterStartup("local-core-startup");
    maybeStartConfiguredCloudflareTunnel(String(PORT))
      .then((result) => {
        if (result.started && result.tunnel.url) {
          console.log(`Cloudflare Tunnel running at ${result.tunnel.url}`);
        }
        refreshIcloudHandoffAfterStartup("cloudflare-autostart");
      })
      .catch((error) => {
        console.warn("Cloudflare Tunnel autostart failed:", error?.message || error);
      });
    try {
      const tailscale = maybeStartConfiguredTailscaleServe(String(PORT));
      if (tailscale.started && tailscale.serve?.url) {
        console.log(`Tailscale HTTPS Serve running at ${tailscale.serve.url}`);
      }
      refreshIcloudHandoffAfterStartup("tailscale-autostart");
    } catch (error: any) {
      console.warn("Tailscale HTTPS Serve autostart failed:", error?.message || error);
    }
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

function refreshIcloudHandoffAfterStartup(reason: string) {
  try {
    const result = maybeRefreshIcloudHandoff(reason);
    if (result.refreshed) {
      console.log(`iCloud mobile entry refreshed after ${reason}: ${result.recommendedBaseUrl || "updated"}`);
    }
  } catch (error: any) {
    console.warn("iCloud mobile entry startup refresh failed:", error?.message || error);
  }
}

startServer();
