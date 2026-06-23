import type { AiProviderStatus, BackupRecord, BackupSchedule, BoundDevice, ConfigDiagnostics, OnboardingStatus } from "./lifeosApi";

export type OnboardingHandoffSummaryInput = {
  providers: AiProviderStatus[];
  backups: BackupRecord[];
  backupSchedule: BackupSchedule | null;
  devices: BoundDevice[];
  diagnostics: ConfigDiagnostics | null;
  onboarding: OnboardingStatus | null;
};

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function remoteReadinessLabel(diagnostics: ConfigDiagnostics | null) {
  const readiness = (diagnostics?.network as any)?.remoteReadiness;
  if (readiness?.status) return readiness.status;
  if (diagnostics?.network.publicBaseUrl) return diagnostics.network.publicAccessAllowed ? "configured" : "configured-needs-opt-in";
  return "local-only";
}

export function buildOnboardingHandoffSummary(input: OnboardingHandoffSummaryInput) {
  const activeProvider = input.providers.find((provider) => provider.active) || input.providers.find((provider) => provider.configured) || null;
  const configuredProviders = input.providers.filter((provider) => provider.configured);
  const activeDevices = input.devices.filter((device) => device.status !== "revoked");
  const latestBackup = input.backups[0] || null;
  const securityOverall = input.diagnostics?.securityCheck.overall || input.onboarding?.securityOverall || "unknown";
  const riskItems = input.diagnostics?.securityCheck.items.filter((item) => item.status !== "ok") || [];
  const remoteReadiness = remoteReadinessLabel(input.diagnostics);
  const nextSteps = [
    !activeProvider ? "Configure an AI provider" : "",
    !latestBackup ? "Create an initial backup" : "",
    !input.backupSchedule?.enabled ? "Enable automatic backups" : "",
    activeDevices.length === 0 ? "Pair a phone" : "",
    securityOverall !== "ok" ? "Resolve security warnings" : "",
    remoteReadiness === "local-only" ? "Configure Tailscale or Cloudflare Tunnel for remote use" : "",
  ].filter(Boolean);

  return [
    "LifeOS AI first-launch handoff",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Onboarding complete: ${yesNo(Boolean(input.onboarding?.completed))}`,
    `AI provider: ${activeProvider ? `${activeProvider.provider} (${activeProvider.selectedModel || activeProvider.defaultModel || "model not selected"})` : "not configured"}`,
    `Configured providers: ${configuredProviders.length}`,
    `Initial backup: ${latestBackup ? "created" : "missing"}`,
    `Latest backup: ${latestBackup?.file || "-"}`,
    `Automatic backups: ${input.backupSchedule?.enabled ? `enabled every ${input.backupSchedule.intervalHours}h` : "disabled"}`,
    `Paired devices: ${activeDevices.length}`,
    `Remote access readiness: ${remoteReadiness}`,
    `Security status: ${securityOverall}`,
    `Security items needing attention: ${riskItems.length}`,
    "",
    "Recommended next checks:",
    ...(nextSteps.length ? nextSteps.map((step) => `- ${step}`) : ["- Send the first chat message", "- Open the mobile PWA from the home screen", "- Run a remote connectivity test before relying on off-LAN access"]),
    "",
    "Sensitive values are intentionally excluded: API keys, device tokens, cookies, local paths, and diagnostic logs.",
  ].join("\n");
}
