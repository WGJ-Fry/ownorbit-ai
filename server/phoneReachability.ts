export function isLoopbackBindHost(bindHost: string) {
  const host = String(bindHost || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function isPrivateLanIPv4(host: string) {
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

// A LAN IP in the QR only works when the server actually listens on that interface.
// While the core is bound to loopback the QR still renders and still looks valid, but
// the phone can only ever get a connection refusal. Fail loudly instead.
// Tunnel hostnames (Tailscale, Cloudflare) legitimately proxy into loopback, so only
// literal private IPv4 addresses are rejected here.
export function pairingBaseUrlNeedsLanBinding(baseUrl: string, bindHost: string) {
  if (!isLoopbackBindHost(bindHost)) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return isPrivateLanIPv4(host);
  } catch {
    return false;
  }
}
