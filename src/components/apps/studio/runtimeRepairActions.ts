import type { CustomAppAutoRepairQueueItem, CustomAppAutoRepairTask } from "../../../services/lifeosApi";
import type { StudioTelemetryLog } from "./StudioTelemetryLogPanel";

type Translate = (key: any, vars?: Record<string, string>) => string;

type RuntimeRepairActionsInput = {
  t: Translate;
  appendSimulatorLog: (log: StudioTelemetryLog) => void;
  completeRuntimeAutoRepair: (task: CustomAppAutoRepairTask, instruction: string, appId?: string | null) => Promise<unknown>;
  handleRefineCode: (instruction: string, persist?: boolean, overrideInstruction?: boolean) => Promise<string | null>;
  planRuntimeAutoRepair: (appId?: string | null) => Promise<{ autoRepairTask: CustomAppAutoRepairTask; suggestedInstruction: string } | null | undefined>;
  setIsApplyingRuntimeRepair: (value: boolean) => void;
  setRefineError: (value: string | null) => void;
  setRefineInstruction: (value: string) => void;
};

export function createStudioRuntimeRepairActions({
  t,
  appendSimulatorLog,
  completeRuntimeAutoRepair,
  handleRefineCode,
  planRuntimeAutoRepair,
  setIsApplyingRuntimeRepair,
  setRefineError,
  setRefineInstruction,
}: RuntimeRepairActionsInput) {
  const runRuntimeRepairTask = async (
    task: CustomAppAutoRepairTask,
    instruction: string,
    appId: string,
    options: { canResume: boolean; completedMessage: string },
  ) => {
    if (!options.canResume) {
      setRefineInstruction(instruction);
      appendSimulatorLog({ time: "DEBUG", text: t("studio.runtime.manualReviewRequired"), type: "log" });
      return;
    }
    const repairedCode = await handleRefineCode(instruction, true);
    if (!repairedCode) return;
    await completeRuntimeAutoRepair(task, instruction, appId);
    appendSimulatorLog({ time: "DEBUG", text: options.completedMessage, type: "info" });
  };

  const handleApplyRuntimeRepair = async (appId: string) => {
    setIsApplyingRuntimeRepair(true);
    try {
      const response = await planRuntimeAutoRepair(appId);
      if (response?.suggestedInstruction) await runRuntimeRepairTask(response.autoRepairTask, response.suggestedInstruction, appId, {
        canResume: response.autoRepairTask.canAutoApply,
        completedMessage: t("studio.runtime.debugAppliedAndSaved"),
      });
    } catch (err: any) {
      setRefineError(err.message || t("studio.runtime.applyFailed"));
    } finally {
      setIsApplyingRuntimeRepair(false);
    }
  };

  const handleResumeRuntimeRepair = async (item: CustomAppAutoRepairQueueItem) => {
    if (!item.appId) return;
    setIsApplyingRuntimeRepair(true);
    try {
      await runRuntimeRepairTask(item.task, item.resumeInstruction, item.appId, {
        canResume: item.canResumeInStudio,
        completedMessage: t("studio.runtime.autoRepairQueueResumed"),
      });
    } catch (err: any) {
      setRefineError(err.message || t("studio.runtime.applyFailed"));
    } finally {
      setIsApplyingRuntimeRepair(false);
    }
  };

  return { handleApplyRuntimeRepair, handleResumeRuntimeRepair };
}
