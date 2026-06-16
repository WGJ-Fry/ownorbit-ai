import { listAiProviderStatuses } from "./appSecrets";
import { getClientState, setClientState } from "./clientState";
import { listBackups } from "./db";
import { getDevices } from "./devices";
import { getSecurityDiagnostics } from "./securityDiagnostics";

const ONBOARDING_COMPLETED_KEY = "lifeos_onboarding_completed";

export type OnboardingStepId = "ai" | "backup" | "device" | "security";

export type OnboardingStep = {
  id: OnboardingStepId;
  label: string;
  done: boolean;
  actionPath: string;
  message: string;
};

export function getOnboardingStatus() {
  const providers = listAiProviderStatuses();
  const backups = listBackups();
  const devices = getDevices();
  const security = getSecurityDiagnostics();
  const aiConfigured = providers.some((provider) => provider.configured);
  const hasBackup = backups.length > 0;
  const hasDevice = devices.some((device) => device.status !== "revoked");
  const securityReady = security.overall !== "critical";
  const completedState = getClientState(ONBOARDING_COMPLETED_KEY)?.value as { completedAt?: number } | undefined;

  const steps: OnboardingStep[] = [
    {
      id: "ai",
      label: "Configure AI Provider",
      done: aiConfigured,
      actionPath: "/admin/onboarding",
      message: aiConfigured ? "At least one AI provider is configured." : "Configure Gemini, OpenAI, OpenRouter, or a local model first.",
    },
    {
      id: "backup",
      label: "Create Initial Backup",
      done: hasBackup,
      actionPath: "/admin/onboarding",
      message: hasBackup ? `${backups.length} backup(s) available.` : "Create a SQLite snapshot before first use so you can roll back safely.",
    },
    {
      id: "device",
      label: "Pair Mobile",
      done: hasDevice,
      actionPath: "/admin/devices/pair",
      message: hasDevice ? `${devices.filter((device) => device.status !== "revoked").length} device(s) paired.` : "Pair a phone before using mobile as the daily entry point.",
    },
    {
      id: "security",
      label: "Security Check",
      done: securityReady,
      actionPath: "/admin/settings",
      message: securityReady ? "No blocking security risks found." : "Blocking security risks still need attention.",
    },
  ];

  const completed = steps.every((step) => step.done);
  return {
    steps,
    completed,
    completedAt: completed ? completedState?.completedAt || null : null,
    required: !completed || !completedState?.completedAt,
    securityOverall: security.overall,
    nextPath: completed ? "/chat" : "/admin/onboarding",
  };
}

export function markOnboardingComplete(actor: { type: string; id: string }) {
  const status = getOnboardingStatus();
  if (!status.completed) {
    const error = new Error("Onboarding is not complete yet");
    (error as any).statusCode = 409;
    (error as any).details = status.steps;
    throw error;
  }
  const completedAt = Date.now();
  setClientState(ONBOARDING_COMPLETED_KEY, { completedAt }, actor);
  return {
    ...getOnboardingStatus(),
    completedAt,
    required: false,
  };
}
