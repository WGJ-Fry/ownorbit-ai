import { Dispatch, SetStateAction, useCallback, useEffect, useState } from "react";
import type { ProblemBlueprint } from "../../../services/problemBlueprint";
import {
  attachGeneratedAppToProblemBlueprint,
  createProblemBlueprint,
  listProblemBlueprints,
  type StoredProblemBlueprint,
} from "../../../services/lifeosApi";

type TFunction = (key: any) => string;

type UseStudioProblemBlueprintHistoryInput = {
  problemInput: string;
  problemBlueprint: ProblemBlueprint;
  t: TFunction;
  setProblemInput: Dispatch<SetStateAction<string>>;
  setWizardAppName: Dispatch<SetStateAction<string>>;
  setPromptInput: Dispatch<SetStateAction<string>>;
  setGenerationError: Dispatch<SetStateAction<string | null>>;
  setIsImportWizardOpen: Dispatch<SetStateAction<boolean>>;
};

export function useStudioProblemBlueprintHistory({
  problemInput,
  problemBlueprint,
  t,
  setProblemInput,
  setWizardAppName,
  setPromptInput,
  setGenerationError,
  setIsImportWizardOpen,
}: UseStudioProblemBlueprintHistoryInput) {
  const [activeProblemBlueprintId, setActiveProblemBlueprintId] = useState<string | null>(null);
  const [recentProblemBlueprints, setRecentProblemBlueprints] = useState<StoredProblemBlueprint[]>([]);
  const [isLoadingProblemBlueprints, setIsLoadingProblemBlueprints] = useState(false);

  const upsertRecentBlueprint = useCallback((blueprint: StoredProblemBlueprint) => {
    setRecentProblemBlueprints((prev) => [blueprint, ...prev.filter((item) => item.id !== blueprint.id)].slice(0, 12));
  }, []);

  const refreshProblemBlueprints = useCallback(async () => {
    setIsLoadingProblemBlueprints(true);
    try {
      const data = await listProblemBlueprints(12);
      setRecentProblemBlueprints(data.blueprints);
    } catch (error) {
      console.error("Failed to load problem blueprints:", error);
    } finally {
      setIsLoadingProblemBlueprints(false);
    }
  }, []);

  useEffect(() => {
    void refreshProblemBlueprints();
  }, [refreshProblemBlueprints]);

  const handleGenerateFromProblemBlueprint = useCallback(async () => {
    if (!problemBlueprint.isReady) return;
    try {
      const { blueprint } = await createProblemBlueprint(problemInput, "studio");
      upsertRecentBlueprint(blueprint);
      setActiveProblemBlueprintId(blueprint.id);
      setWizardAppName(blueprint.suggestedAppName);
      setPromptInput(blueprint.appPrompt);
      setGenerationError(null);
      setIsImportWizardOpen(true);
    } catch (error) {
      console.error("Failed to save problem blueprint:", error);
      setGenerationError(t("studio.problemSolver.saveFailed"));
      setWizardAppName(problemBlueprint.suggestedAppName);
      setPromptInput(problemBlueprint.appPrompt);
      setIsImportWizardOpen(true);
    }
  }, [problemBlueprint, problemInput, setGenerationError, setIsImportWizardOpen, setPromptInput, setWizardAppName, t, upsertRecentBlueprint]);

  const handleRestoreProblemBlueprint = useCallback((blueprint: StoredProblemBlueprint) => {
    setProblemInput(blueprint.problem);
  }, [setProblemInput]);

  const handleRegenerateProblemBlueprint = useCallback((blueprint: StoredProblemBlueprint) => {
    setProblemInput(blueprint.problem);
    setActiveProblemBlueprintId(blueprint.id);
    setWizardAppName(blueprint.suggestedAppName);
    setPromptInput(blueprint.appPrompt);
    setGenerationError(null);
    setIsImportWizardOpen(true);
  }, [setGenerationError, setIsImportWizardOpen, setProblemInput, setPromptInput, setWizardAppName]);

  const attachGeneratedAppToActiveProblemBlueprint = useCallback((input: { appId: string; appName: string }) => {
    if (!activeProblemBlueprintId) return;
    const blueprintId = activeProblemBlueprintId;
    setActiveProblemBlueprintId(null);
    void attachGeneratedAppToProblemBlueprint(blueprintId, input)
      .then(({ blueprint }) => upsertRecentBlueprint(blueprint))
      .catch((error) => console.error("Failed to attach generated app to problem blueprint:", error));
  }, [activeProblemBlueprintId, upsertRecentBlueprint]);

  return {
    activeProblemBlueprintId,
    attachGeneratedAppToActiveProblemBlueprint,
    handleGenerateFromProblemBlueprint,
    handleRegenerateProblemBlueprint,
    handleRestoreProblemBlueprint,
    isLoadingProblemBlueprints,
    recentProblemBlueprints,
    setActiveProblemBlueprintId,
  };
}
