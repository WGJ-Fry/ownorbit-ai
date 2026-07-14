import type express from "express";
import { setHttpOnlyCookie } from "./httpSecurity";
import { getConfiguredPublicBasePath } from "./publicBaseUrl";

export const INSTALL_PAIRING_COOKIE = "lifeos_pairing_intent";
export const INSTALL_PAIRING_TTL_MS = 24 * 60 * 60 * 1000;

const MANIFEST_LINK_PATTERN = /<link rel="manifest" href="\/?manifest\.webmanifest" \/>/;
const BASE_TAG_PATTERN = /<base\s+href="[^"]*"\s*\/?>/;

export function normalizeInstallPairingToken(value: unknown) {
  if (typeof value !== "string") return "";
  const token = value.trim();
  if (!/^bind_[A-Za-z0-9_-]{8,180}$/.test(token)) return "";
  return token;
}

export function pairingInstallPath(pairingToken: string) {
  return `/mobile/install/${encodeURIComponent(pairingToken)}`;
}

function withBasePath(path: string, basePath = getConfiguredPublicBasePath()) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedBasePath = basePath.replace(/\/+$/, "");
  return normalizedBasePath ? `${normalizedBasePath}${normalizedPath}` : normalizedPath;
}

export function publicBaseHref(basePath = getConfiguredPublicBasePath()) {
  const normalizedBasePath = basePath.replace(/\/+$/, "");
  return normalizedBasePath ? `${normalizedBasePath}/` : "/";
}

export function htmlWithPublicBaseHref(html: string, basePath = getConfiguredPublicBasePath()) {
  const baseTag = `<base href="${publicBaseHref(basePath)}" />`;
  if (BASE_TAG_PATTERN.test(html)) return html.replace(BASE_TAG_PATTERN, baseTag);
  return html.replace(/<head>/i, `<head>\n    ${baseTag}`);
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export function getInstallPairingToken(req: express.Request) {
  const installPathMatch = req.path.match(/^\/mobile\/install\/([^/?#]+)$/);
  const rawToken = installPathMatch
    ? safeDecodeURIComponent(installPathMatch[1] || "")
    : req.path === "/mobile/pair"
      ? req.query.token
      : req.query.pairingToken;
  return normalizeInstallPairingToken(rawToken);
}

export function htmlWithInstallPairingManifest(html: string, req: express.Request) {
  const pairingToken = getInstallPairingToken(req);
  if (!pairingToken) return html;
  const manifestHref = `${withBasePath("/manifest.webmanifest")}?pairingToken=${encodeURIComponent(pairingToken)}`;
  return html.replace(MANIFEST_LINK_PATTERN, `<link rel="manifest" href="${manifestHref}" />`);
}

export function setInstallPairingIntentCookie(res: express.Response, pairingToken: string) {
  if (!pairingToken) return;
  setHttpOnlyCookie(res, INSTALL_PAIRING_COOKIE, pairingToken, Date.now() + INSTALL_PAIRING_TTL_MS);
}

export function mobileManifest(pairingToken = "", basePath = getConfiguredPublicBasePath()) {
  const startUrl = pairingToken ? withBasePath(pairingInstallPath(pairingToken), basePath) : withBasePath("/mobile/chat", basePath);
  const icon = (path: string) => withBasePath(path, basePath);
  return {
    name: "OwnOrbit AI",
    short_name: "OwnOrbit",
    id: withBasePath("/mobile/chat", basePath),
    description: "Personal AI mobile client connected to your OwnOrbit desktop core.",
    start_url: startUrl,
    scope: withBasePath("/", basePath),
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "browser"],
    orientation: "portrait",
    background_color: "#060a10",
    theme_color: "#060a10",
    categories: ["productivity", "utilities"],
    launch_handler: {
      client_mode: "navigate-existing",
    },
    prefer_related_applications: false,
    icons: [
      {
        src: icon("/icon.svg"),
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
      {
        src: icon("/icons/icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: icon("/icons/icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    screenshots: [
      {
        src: icon("/screenshots/real-mobile-chat.jpg"),
        sizes: "390x844",
        type: "image/jpeg",
        form_factor: "narrow",
        label: "Mobile AI Chat",
      },
      {
        src: icon("/screenshots/real-mobile-device.jpg"),
        sizes: "390x844",
        type: "image/jpeg",
        form_factor: "narrow",
        label: "Device & Connection",
      },
    ],
    shortcuts: [
      {
        name: "Mobile AI",
        short_name: "AI",
        url: withBasePath("/mobile/chat", basePath),
        icons: [{ src: icon("/icons/icon-192.png"), sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Pair Computer",
        short_name: "Pair",
        url: pairingToken ? withBasePath(pairingInstallPath(pairingToken), basePath) : withBasePath("/mobile/device", basePath),
        icons: [{ src: icon("/icons/icon-192.png"), sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Local Actions",
        short_name: "Actions",
        url: withBasePath("/mobile/actions", basePath),
        icons: [{ src: icon("/icons/icon-192.png"), sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Problem-Solving Tools",
        short_name: "Tools",
        url: withBasePath("/mobile/tools", basePath),
        icons: [{ src: icon("/icons/icon-192.png"), sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
