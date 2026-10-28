import { useCallback, useEffect, useState } from "react";
import type { CustomApp } from "../../../types";
import type { StudioPreviewDevice } from "./StudioResponsivePreview";
import type { StudioTelemetryLog } from "./StudioTelemetryLogPanel";

export type StudioRefineHistoryItem = {
  id: string;
  timestamp: string;
  instruction: string;
  code: string;
  persona: string;
};

const INITIAL_LOGS: StudioTelemetryLog[] = [
  { time: "SYSTEM", text: "OwnOrbit isolated rendering sandbox initialized.", type: "info" },
  { time: "ROUTER", text: "Adaptive state machine mounted. You can switch landscape or mobile viewport.", type: "log" },
];

function loadPreviewDevice(): StudioPreviewDevice {
  try {
    const saved = localStorage.getItem("omnipreview_device");
    if (saved === "mobile" || saved === "tablet" || saved === "responsive") return saved;
  } catch (e) {}
  return "mobile";
}

export function useStudioSimulatorState() {
  const [previewDevice, setPreviewDevice] = useState<StudioPreviewDevice>(loadPreviewDevice);
  const [refineHistory, setRefineHistory] = useState<StudioRefineHistoryItem[]>([]);
  const [isLandscape, setIsLandscape] = useState(false);
  const [showConsole, setShowConsole] = useState(true);
  const [simulatorLogs, setSimulatorLogs] = useState<StudioTelemetryLog[]>(INITIAL_LOGS);

  const appendSimulatorLog = useCallback((log: StudioTelemetryLog) => {
    setSimulatorLogs((prev) => [...prev, log].slice(-6));
  }, []);

  const resetSimulatorLogs = useCallback((log: StudioTelemetryLog = { time: "SYS", text: "Local telemetry logs reloaded and reset.", type: "info" }) => {
    setSimulatorLogs([log]);
  }, []);

  const toggleConsole = useCallback(() => {
    setShowConsole((current) => !current);
  }, []);

  const captureRefineVersion = useCallback((instruction: string, code: string) => {
    const version = {
      id: "ver_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      instruction,
      code,
      persona: "all",
    };
    setRefineHistory((prev) => [version, ...prev].slice(0, 10));
  }, []);

  const resetForSelectedApp = useCallback((app?: CustomApp) => {
    setRefineHistory([]);
    if (!app) return;
    setSimulatorLogs([
      { time: "SYSTEM", text: `OwnOrbit sandbox reset and loaded micro app \"${app.name}\".`, type: "info" },
      { time: "SANDBOX", text: "Live Console probe and H5 IndexedDB protection lock injected.", type: "log" },
    ]);
  }, []);

  useEffect(() => {
    const handleRemoteLog = (event: MessageEvent) => {
      if (event.data && event.data.source === "jarvis-sandbox-frame-log") {
        appendSimulatorLog({
          time: new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          text: event.data.message,
          type: event.data.type || "log",
        });
      }
    };
    window.addEventListener("message", handleRemoteLog);
    return () => window.removeEventListener("message", handleRemoteLog);
  }, [appendSimulatorLog]);

  return {
    appendSimulatorLog,
    captureRefineVersion,
    isLandscape,
    previewDevice,
    refineHistory,
    resetForSelectedApp,
    resetSimulatorLogs,
    setIsLandscape,
    setPreviewDevice,
    showConsole,
    simulatorLogs,
    toggleConsole,
  };
}
