import { useCallback, useEffect, useState } from "react";
import {
  createCustomAppAutoRepairPlan,
  createCustomAppDebugRequest,
  createCustomAppRuntimeEvent,
  listCustomAppRuntimeEvents,
  type CustomAppAutoRepairTask,
  type CustomAppRepairProposal,
  type StoredCustomAppRuntimeEvent,
} from "../../../services/lifeosApi";
import type { StudioTelemetryLog } from "./StudioTelemetryLogPanel";

type Translate = (key: any, vars?: Record<string, string>) => string;

type UseStudioRuntimeDebugInput = {
  editingAppId: string | null;
  t: Translate;
  setRefineInstruction: (value: string) => void;
  appendSimulatorLog: (log: StudioTelemetryLog) => void;
};

export function useStudioRuntimeDebug({
  editingAppId,
  t,
  setRefineInstruction,
  appendSimulatorLog,
}: UseStudioRuntimeDebugInput) {
  const [runtimeEvents, setRuntimeEvents] = useState<StoredCustomAppRuntimeEvent[]>([]);
  const [isLoadingRuntimeEvents, setIsLoadingRuntimeEvents] = useState(false);
  const [runtimeEventsError, setRuntimeEventsError] = useState<string | null>(null);
  const [runtimeDebugIssue, setRuntimeDebugIssue] = useState("");
  const [isRequestingRuntimeDebug, setIsRequestingRuntimeDebug] = useState(false);
  const [runtimeRepairProposal, setRuntimeRepairProposal] = useState<CustomAppRepairProposal | null>(null);
  const [runtimeAutoRepairTask, setRuntimeAutoRepairTask] = useState<CustomAppAutoRepairTask | null>(null);

  const loadRuntimeEvents = useCallback(async (appId = editingAppId) => {
    if (!appId) {
      setRuntimeEvents([]);
      setRuntimeEventsError(null);
      return;
    }
    setIsLoadingRuntimeEvents(true);
    setRuntimeEventsError(null);
    try {
      const response = await listCustomAppRuntimeEvents(appId, 20);
      setRuntimeEvents(response.events);
    } catch (error: any) {
      setRuntimeEventsError(error?.message || t("studio.runtime.loadFailed"));
    } finally {
      setIsLoadingRuntimeEvents(false);
    }
  }, [editingAppId, t]);

  useEffect(() => {
    void loadRuntimeEvents(editingAppId);
  }, [editingAppId, loadRuntimeEvents]);

  const requestRuntimeDebug = useCallback(async (appId = editingAppId) => {
    if (!appId) return;
    setIsRequestingRuntimeDebug(true);
    setRuntimeEventsError(null);
    try {
      const response = await createCustomAppDebugRequest(appId, {
        issue: runtimeDebugIssue.trim() || t("studio.runtime.defaultDebugIssue"),
      });
      setRefineInstruction(response.suggestedInstruction);
      setRuntimeRepairProposal(response.repairProposal);
      setRuntimeAutoRepairTask(null);
      setRuntimeDebugIssue("");
      appendSimulatorLog({ time: "DEBUG", text: t("studio.runtime.debugInstructionReady"), type: "info" });
      await loadRuntimeEvents(appId);
      return response;
    } catch (error: any) {
      setRuntimeEventsError(error?.message || t("studio.runtime.requestFailed"));
      setRuntimeRepairProposal(null);
      setRuntimeAutoRepairTask(null);
      return null;
    } finally {
      setIsRequestingRuntimeDebug(false);
    }
  }, [appendSimulatorLog, editingAppId, loadRuntimeEvents, runtimeDebugIssue, setRefineInstruction, t]);

  const planRuntimeAutoRepair = useCallback(async (appId = editingAppId) => {
    if (!appId) return;
    setIsRequestingRuntimeDebug(true);
    setRuntimeEventsError(null);
    try {
      const response = await createCustomAppAutoRepairPlan(appId, {
        issue: runtimeDebugIssue.trim() || t("studio.runtime.defaultDebugIssue"),
      });
      setRefineInstruction(response.suggestedInstruction);
      setRuntimeRepairProposal(response.repairProposal);
      setRuntimeAutoRepairTask(response.autoRepairTask);
      setRuntimeDebugIssue("");
      appendSimulatorLog({
        time: "DEBUG",
        text: response.autoRepairTask.canAutoApply ? t("studio.runtime.autoRepairReady") : t("studio.runtime.autoRepairBlocked"),
        type: response.autoRepairTask.canAutoApply ? "info" : "log",
      });
      await loadRuntimeEvents(appId);
      return response;
    } catch (error: any) {
      setRuntimeEventsError(error?.message || t("studio.runtime.requestFailed"));
      setRuntimeRepairProposal(null);
      setRuntimeAutoRepairTask(null);
      return null;
    } finally {
      setIsRequestingRuntimeDebug(false);
    }
  }, [appendSimulatorLog, editingAppId, loadRuntimeEvents, runtimeDebugIssue, setRefineInstruction, t]);

  const recordRuntimeDebugApplied = useCallback((instruction: string, appId = editingAppId) => {
    if (!appId || !instruction.trim()) return;
    createCustomAppRuntimeEvent(appId, {
      eventType: "debug_applied",
      severity: "info",
      label: t("studio.runtime.debugAppliedLabel"),
      message: instruction.trim(),
    })
      .then(() => loadRuntimeEvents(appId))
      .catch(() => null);
  }, [editingAppId, loadRuntimeEvents, t]);

  return {
    isLoadingRuntimeEvents,
    isRequestingRuntimeDebug,
    loadRuntimeEvents,
    planRuntimeAutoRepair,
    recordRuntimeDebugApplied,
    requestRuntimeDebug,
    runtimeAutoRepairTask,
    runtimeDebugIssue,
    runtimeEvents,
    runtimeEventsError,
    runtimeRepairProposal,
    setRuntimeDebugIssue,
  };
}
