import { useEffect, useRef, useState } from "react";
import { createDeviceWebSocketAuthMessage, getStoredDeviceCredentialAsync, realtimeWebSocketUrl, rotateDeviceToken } from "../services/lifeosApi";

export type RealtimeStatus = "unbound" | "connecting" | "connected" | "offline";

export function useLifeOSRealtime() {
  const [status, setStatus] = useState<RealtimeStatus>("unbound");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const retryRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const stoppedRef = useRef(false);
  const connectingRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  useEffect(() => {
    stoppedRef.current = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearHeartbeat = () => {
      if (heartbeatRef.current !== null) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };

    const scheduleReconnect = (delay: number) => {
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delay);
    };

    const forceReconnect = () => {
      if (stoppedRef.current) return;
      const ws = socketRef.current;
      if (connectingRef.current || ws?.readyState === WebSocket.CONNECTING || ws?.readyState === WebSocket.OPEN) return;
      retryRef.current = 0;
      clearReconnectTimer();
      void connect();
    };

    const connect = async () => {
      if (stoppedRef.current || connectingRef.current) return;
      connectingRef.current = true;

      let credential;
      try {
        credential = await getStoredDeviceCredentialAsync();
      } catch {
        connectingRef.current = false;
        setStatus("offline");
        scheduleReconnect(Math.min(30_000, 1000 * 2 ** retryRef.current));
        retryRef.current += 1;
        return;
      }
      if (!credential) {
        connectingRef.current = false;
        setStatus("unbound");
        return;
      }
      if (credential.accessToken && credential.accessTokenExpiresAt && credential.accessTokenExpiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000) {
        credential = await rotateDeviceToken().catch(() => credential);
      }

      setStatus("connecting");
      let ws: WebSocket;
      try {
        ws = new WebSocket(realtimeWebSocketUrl());
      } catch {
        connectingRef.current = false;
        setStatus("offline");
        scheduleReconnect(Math.min(30_000, 1000 * 2 ** retryRef.current));
        retryRef.current += 1;
        return;
      }
      socketRef.current = ws;
      connectingRef.current = false;

      ws.onopen = async () => {
        const authMessage = await createDeviceWebSocketAuthMessage();
        if (socketRef.current !== ws || stoppedRef.current) return;
        if (!authMessage) {
          socketRef.current = null;
          ws.close(1008, "Missing device credential");
          setStatus("unbound");
          return;
        }
        ws.send(JSON.stringify(authMessage));
        setLastEventAt(Date.now());
        clearHeartbeat();
        heartbeatRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
          }
        }, 25_000);
      };

      ws.onmessage = async (message) => {
        if (socketRef.current !== ws) return;
        try {
          const event = JSON.parse(message.data);
          if (event?.type === "auth.ok") {
            retryRef.current = 0;
            setStatus("connected");
          }
          if (event?.type === "device.token.rotate_requested") {
            const currentCredential = await getStoredDeviceCredentialAsync();
            if (currentCredential?.accessToken) rotateDeviceToken().catch(() => null);
          }
        } catch {}
        setLastEventAt(Date.now());
      };

      ws.onerror = () => {
        if (socketRef.current !== ws) return;
        setStatus("offline");
      };

      ws.onclose = () => {
        if (socketRef.current !== ws) return;
        clearHeartbeat();
        socketRef.current = null;
        if (stoppedRef.current) {
          clearReconnectTimer();
          return;
        }
        setStatus("offline");
        const delay = Math.min(30_000, 1000 * 2 ** retryRef.current);
        retryRef.current += 1;
        scheduleReconnect(delay);
      };
    };

    const handleOnline = () => forceReconnect();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") forceReconnect();
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    void connect();

    return () => {
      stoppedRef.current = true;
      clearReconnectTimer();
      clearHeartbeat();
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      socketRef.current?.close();
    };
  }, []);

  return { status, lastEventAt };
}
