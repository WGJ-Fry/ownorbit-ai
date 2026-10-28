import os from "os";

// A second VPN-style tunnel that claims the default route keeps Tailscale from
// coming online. On macOS the usual cause is a proxy client running in TUN mode:
// Clash/mihomo/Surge address their tunnel inside the 198.18.0.0/15 benchmark
// range they use for fake-ip, and turn on route hijacking plus DNS interception.
// Tailscale always addresses itself inside 100.64.0.0/10, so the two are easy to
// tell apart without inspecting the user's process list.

export type TunnelConflictInterface = {
  device: string;
  kind: "proxy-fake-ip" | "other-tunnel";
};

export type TunnelConflictReport = {
  detected: boolean;
  severity: "none" | "likely" | "possible";
  interfaces: TunnelConflictInterface[];
  reason: "" | "proxy-tun-mode" | "other-tunnel-interface";
};

function isTailscaleCgnat(address: string) {
  const match = address.match(/^100\.(\d+)\./);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

function isProxyFakeIpRange(address: string) {
  const match = address.match(/^198\.(\d+)\./);
  if (!match) return false;
  const second = Number(match[1]);
  return second === 18 || second === 19;
}

function isTunnelDevice(name: string) {
  return /^(utun|tun|tap|ipsec|ppp)\d*$/i.test(name.trim());
}

// Only the device name and a coarse kind are reported. Tunnel addresses are left
// out on purpose so this never widens what diagnostics expose.
export function detectTunnelConflicts(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): TunnelConflictReport {
  const found: TunnelConflictInterface[] = [];

  for (const [device, entries] of Object.entries(interfaces)) {
    if (!isTunnelDevice(device)) continue;
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isTailscaleCgnat(entry.address)) continue;
      found.push({ device, kind: isProxyFakeIpRange(entry.address) ? "proxy-fake-ip" : "other-tunnel" });
      break;
    }
  }

  const proxyTunnel = found.some((item) => item.kind === "proxy-fake-ip");
  return {
    detected: found.length > 0,
    severity: proxyTunnel ? "likely" : found.length ? "possible" : "none",
    interfaces: found,
    reason: proxyTunnel ? "proxy-tun-mode" : found.length ? "other-tunnel-interface" : "",
  };
}

// The two settings a proxy client needs so it stops swallowing Tailscale traffic:
// keep the CGNAT range out of the hijacked route table, and let MagicDNS names
// resolve through Tailscale's own resolver instead of the intercepted port 53.
export const TAILSCALE_CGNAT_RANGE = "100.64.0.0/10";
export const TAILSCALE_MAGIC_DNS_RESOLVER = "100.100.100.100";

// Where MagicDNS and HTTPS Certificates are turned on. Both are required before
// `tailscale serve` can produce a stable HTTPS hostname, and neither is on by
// default, so the guidance has to name the page instead of just the feature.
export const TAILSCALE_DNS_ADMIN_URL = "https://login.tailscale.com/admin/dns";

export function buildTunnelConflictNote(report: TunnelConflictReport, tailscaleOnline: boolean) {
  if (!report.detected) return "";
  const devices = report.interfaces.map((item) => item.device).join(", ");

  if (report.severity === "likely") {
    return tailscaleOnline
      ? `A proxy client appears to be running in TUN mode (${devices}). Tailscale is online now, but if it drops, exclude ${TAILSCALE_CGNAT_RANGE} from the proxy's hijacked routes and resolve *.ts.net through ${TAILSCALE_MAGIC_DNS_RESOLVER}.`
      : `A proxy client appears to be running in TUN mode (${devices}). Its route hijacking and DNS interception stop Tailscale from connecting. Either switch that client to system-proxy mode, or exclude ${TAILSCALE_CGNAT_RANGE} from its routes and resolve *.ts.net through ${TAILSCALE_MAGIC_DNS_RESOLVER}.`;
  }

  return tailscaleOnline
    ? `Another tunnel interface is active (${devices}). It is not interfering right now, but it can compete with Tailscale for the default route.`
    : `Another tunnel interface is active (${devices}). A second VPN or tunnel can take over the default route and stop Tailscale from connecting. Disconnect it and retry.`;
}
