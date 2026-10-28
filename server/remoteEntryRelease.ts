import { getConfiguredPublicBaseUrl, isTemporaryTryCloudflareUrl } from "./publicBaseUrl.ts";

type SavedRemoteEntry = { mode: string; publicBaseUrl: string } | null | undefined;

// A saved startup entry that comes back by itself after a restart: Tailscale
// HTTPS Serve, a Cloudflare Named Tunnel, or a configured HTTPS entry. Quick
// tunnels are never restored, so starting one must not overwrite these — the
// quick URL only takes over the runtime PUBLIC_BASE_URL.
export function isRestartStableRemoteEntry(config: SavedRemoteEntry) {
  const url = String(config?.publicBaseUrl || "");
  if (!url.startsWith("https://") || isTemporaryTryCloudflareUrl(url)) return false;
  return config?.mode === "tailscale" || config?.mode === "cloudflare" || config?.mode === "configured";
}

export type SurvivingRemoteEntry = {
  mode: "cloudflare" | "tailscale";
  label: string;
  url: string;
} | null;

function useRemoteEntryAtRuntime(url: string) {
  process.env.PUBLIC_BASE_URL = url;
  process.env.LIFEOS_ALLOW_PUBLIC = "1";
  process.env.LIFEOS_TRUST_PROXY = "1";
}

// Both tunnels can run at once and the last one started owns PUBLIC_BASE_URL.
// When the owner stops, a still-live path must stay usable: its WebSockets
// arrive over plain HTTP with X-Forwarded-Proto and are only accepted while
// proxy trust or its public origin is configured. With no live tunnel left, a
// saved configured HTTPS entry (a reverse proxy outside this core, kept when a
// quick tunnel was started over it) gets back what desktop/main.cjs applies
// for it at launch.
export function releaseStoppedRemoteEntry(survivor: SurvivingRemoteEntry, savedEntry?: SavedRemoteEntry) {
  if (survivor) {
    useRemoteEntryAtRuntime(survivor.url);
    return "survivor" as const;
  }
  if (getConfiguredPublicBaseUrl()) return "kept" as const;
  if (savedEntry?.mode === "configured" && isRestartStableRemoteEntry(savedEntry)) {
    useRemoteEntryAtRuntime(savedEntry.publicBaseUrl);
    return "saved-configured" as const;
  }
  delete process.env.LIFEOS_TRUST_PROXY;
  // A LAN-bound core still needs this for its own listener.
  if (process.env.LIFEOS_HOST !== "0.0.0.0") delete process.env.LIFEOS_ALLOW_PUBLIC;
  return "cleared" as const;
}
