import { signalManagedCloudflareTunnelsForShutdown, stopManagedCloudflareTunnel } from "./cloudflareTunnel.ts";
import { stopOwnedTailscaleHttpsServeOnShutdown } from "./networkDiagnostics.ts";
import { cleanupTailscaleSocket } from "./tailscaleSocket.ts";

export type RemoteEntryShutdownSteps = {
  signalCloudflareTunnels: () => unknown;
  stopTailscaleServe: () => { reason?: string; error?: unknown } | void;
  cleanupTailscaleSocket: () => unknown;
  clearRuntimeEnv: () => void;
  waitForCloudflareTunnels: () => Promise<unknown>;
  warn?: (message: string, detail?: unknown) => void;
};

// Quit cleanup runs from process "exit", where an await never resumes, and
// from SIGTERM/SIGINT, which the desktop shell races with app.exit after
// 1.5 s. Everything that has to happen therefore runs synchronously before
// anything is awaited; only the graceful wait for cloudflared to exit is left
// for the signal path. Later calls return the first call's wait.
export function createRemoteEntryShutdown(steps: RemoteEntryShutdownSteps) {
  let pending: Promise<void> | null = null;
  const warn = steps.warn || ((message: string, detail?: unknown) => console.warn(message, detail));
  const runStep = (label: string, step: () => unknown) => {
    try {
      step();
    } catch (error: any) {
      warn(`${label} failed:`, error?.message || error);
    }
  };

  return function cleanupOwnedRemoteEntry() {
    if (pending) return pending;
    pending = Promise.resolve();
    runStep("Cloudflare Tunnel shutdown signal", steps.signalCloudflareTunnels);
    runStep("Tailscale HTTPS Serve shutdown cleanup", () => {
      const result = steps.stopTailscaleServe();
      if (result && result.reason === "stop-failed") warn("Tailscale HTTPS Serve shutdown cleanup failed:", result.error);
    });
    runStep("Tailscale socket cleanup", steps.cleanupTailscaleSocket);
    // After Serve is off: the Windows serve target is derived from this port.
    runStep("Remote entry environment cleanup", steps.clearRuntimeEnv);
    let wait: Promise<unknown>;
    try {
      wait = Promise.resolve(steps.waitForCloudflareTunnels());
    } catch (error) {
      wait = Promise.reject(error);
    }
    pending = wait.then(() => undefined, (error: any) => {
      warn("Cloudflare Tunnel shutdown failed:", error?.message || error);
    });
    return pending;
  };
}

export function createOwnedRemoteEntryShutdown(input: { port: string; tailscaleSocketPath: string }) {
  return createRemoteEntryShutdown({
    signalCloudflareTunnels: signalManagedCloudflareTunnelsForShutdown,
    stopTailscaleServe: () => stopOwnedTailscaleHttpsServeOnShutdown(input.port),
    cleanupTailscaleSocket: () => cleanupTailscaleSocket(input.tailscaleSocketPath),
    clearRuntimeEnv: () => {
      delete process.env.LIFEOS_TAILSCALE_LOOPBACK_PORT;
    },
    waitForCloudflareTunnels: stopManagedCloudflareTunnel,
  });
}
