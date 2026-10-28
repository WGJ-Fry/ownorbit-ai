import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { insertAuditLog } from "./audit";
import { getActiveDeviceBySignature } from "./auth";
import { isKnownCandidateOrigin } from "./deviceEndpoints";
import { getActiveDeviceByToken, updateDevicePresence } from "./devices";
import { getConfiguredPublicOrigin, stripConfiguredPublicBasePath } from "./publicBaseUrl";

const wsClients = new Map<string, WebSocket>();
const MAX_REALTIME_CLIENTS = 100;
const MAX_REALTIME_PAYLOAD_BYTES = 64 * 1024;

function websocketOriginAllowed(request: http.IncomingMessage) {
  const origin = String(request.headers.origin || "").trim();
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
    const allowedOrigins = new Set<string>();
    const host = String(request.headers.host || "").trim();
    if (host) {
      const directProtocol = (request.socket as any).encrypted ? "https:" : "http:";
      allowedOrigins.add(`${directProtocol}//${host}`);
    }
    if (process.env.LIFEOS_TRUST_PROXY === "1") {
      const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
      const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
      if (forwardedHost && (forwardedProtocol === "http" || forwardedProtocol === "https")) {
        allowedOrigins.add(`${forwardedProtocol}://${forwardedHost}`);
      }
    }
    const publicOrigin = getConfiguredPublicOrigin();
    if (publicOrigin) allowedOrigins.add(publicOrigin);
    if (allowedOrigins.has(originUrl.origin)) return true;
    // Tunnels reach the core over plain HTTP and a quick tunnel sends no
    // X-Forwarded-Host, so a phone on a live origin that is not PUBLIC_BASE_URL
    // (a quick tunnel being handed off, or one still up after Tailscale Serve
    // took the runtime address) is matched against the cached candidate list.
    // Called per upgrade only: deviceEndpoints imports this module back.
    return isKnownCandidateOrigin(originUrl.origin);
  } catch {
    return false;
  }
}

export function broadcastRealtime(payload: unknown) {
  const message = JSON.stringify(payload);
  for (const client of wsClients.values()) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

export function sendRealtimeToDevice(deviceId: string, payload: unknown) {
  const client = wsClients.get(deviceId);
  if (!client || client.readyState !== WebSocket.OPEN) return false;
  client.send(JSON.stringify(payload));
  return true;
}

export function getOnlineDeviceCount() {
  return wsClients.size;
}

export function isDeviceOnline(deviceId: string) {
  return wsClients.has(deviceId);
}

export function closeDeviceConnection(deviceId: string, reason = "Device disconnected") {
  const client = wsClients.get(deviceId);
  if (client) client.close(1008, reason);
  wsClients.delete(deviceId);
}

export function attachRealtimeServer(server: http.Server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_REALTIME_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });

  server.on("upgrade", (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
    } catch {
      socket.destroy();
      return;
    }
    if (stripConfiguredPublicBasePath(url.pathname) !== "/api/v1/ws") {
      socket.destroy();
      return;
    }
    if (!websocketOriginAllowed(request) || wss.clients.size >= MAX_REALTIME_CLIENTS) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    let authenticatedDeviceId: string | null = null;
    let authenticationClosed = false;
    const authTimer = setTimeout(() => {
      if (!authenticatedDeviceId) {
        authenticationClosed = true;
        ws.close(1008, "Authentication required");
      }
    }, 5000);

    ws.on("message", (raw) => {
      try {
        if (authenticationClosed || ws.readyState !== WebSocket.OPEN) return;
        const event = JSON.parse(raw.toString());
        if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
          ws.send(JSON.stringify({ type: "error", message: "Invalid realtime payload", timestamp: Date.now() }));
          return;
        }
        if (!authenticatedDeviceId) {
          if (event.type !== "auth") {
            ws.send(JSON.stringify({ type: "error", message: "Authentication required", timestamp: Date.now() }));
            return;
          }

          const device = getActiveDeviceByToken(String(event.deviceId || ""), String(event.accessToken || "")) || getActiveDeviceBySignature({
            deviceId: String(event.deviceId || ""),
            method: "WS",
            path: "/api/v1/ws",
            bodyHash: "",
            timestamp: String(event.timestamp || ""),
            nonce: String(event.nonce || ""),
            signature: String(event.signature || ""),
          });
          if (!device) {
            authenticationClosed = true;
            ws.close(1008, "Invalid device credential");
            return;
          }

          clearTimeout(authTimer);
          const now = Date.now();
          authenticatedDeviceId = device.id;
          updateDevicePresence(device.id, "online", now);
          insertAuditLog("device_online", "device", device.id, undefined, "device", device.id);
          const previousClient = wsClients.get(device.id);
          wsClients.set(device.id, ws);
          if (previousClient && previousClient !== ws) previousClient.close(1000, "Connection replaced");
          ws.send(JSON.stringify({ type: "auth.ok", deviceId: device.id, timestamp: now }));
          broadcastRealtime({ type: "device.online", deviceId: device.id, timestamp: now });
          return;
        }

        if (event.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          return;
        }

        ws.send(JSON.stringify({ type: "error", message: "Unsupported realtime event", timestamp: Date.now() }));
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid realtime payload", timestamp: Date.now() }));
      }
    });

    ws.on("close", () => {
      authenticationClosed = true;
      clearTimeout(authTimer);
      if (!authenticatedDeviceId) return;
      if (wsClients.get(authenticatedDeviceId) !== ws) return;
      const closedAt = Date.now();
      wsClients.delete(authenticatedDeviceId);
      updateDevicePresence(authenticatedDeviceId, "offline", closedAt);
      broadcastRealtime({ type: "device.offline", deviceId: authenticatedDeviceId, timestamp: closedAt });
    });
  });

  return wss;
}
