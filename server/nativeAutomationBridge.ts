import { spawn } from "child_process";
import path from "path";

export const NATIVE_AUTOMATION_CONFIRMATION_TEXT = "RUN NATIVE ACTION";
export const NATIVE_AUTOMATION_ENABLE_ENV = "LIFEOS_ENABLE_NATIVE_AUTOMATION_BRIDGE";
export const NATIVE_AUTOMATION_ALLOWLIST_ENV = "LIFEOS_NATIVE_AUTOMATION_ALLOWLIST";
export const NATIVE_AUTOMATION_FILE_ROOTS_ENV = "LIFEOS_NATIVE_FILE_ROOTS";
export const NATIVE_AUTOMATION_MOCK_ENV = "LIFEOS_NATIVE_AUTOMATION_BRIDGE_MOCK";

const MAX_NATIVE_PAYLOAD_CHARS = 4000;
const DEFAULT_COMMAND_TIMEOUT_MS = 8000;

export type NativeAutomationKind = "clipboard" | "shortcut" | "file" | "app" | "calendar" | "reminder" | "shell";
export type NativeAutomationRisk = "low" | "medium" | "high";
export type NativeAutomationPlanStatus = "ready" | "blocked";

export type NativeAutomationInput = {
  kind?: NativeAutomationKind;
  title?: string;
  target?: string;
  payload?: string;
  shortcutName?: string;
  appBundleId?: string;
  source?: string;
  explicitConsent?: boolean;
  confirmationText?: string;
};

export type NativeAutomationPlan = {
  generatedAt: string;
  mode: "disabled" | "guarded" | "mock";
  kind: NativeAutomationKind;
  actionId: string;
  status: NativeAutomationPlanStatus;
  canExecute: boolean;
  supportedNow: boolean;
  risk: NativeAutomationRisk;
  commandPreview: string[];
  title: string;
  sanitizedTarget: string;
  sanitizedSource: string;
  payloadPreview: string;
  writesExternalSystem: boolean;
  requirements: Array<"native-bridge" | "action-allowlist" | "explicit-consent" | "confirmation-text" | "audit-log" | "macos-runtime">;
  blockedReasons: string[];
  safety: {
    bridgeEnabled: boolean;
    mockMode: boolean;
    allowlisted: boolean;
    platformSupported: boolean;
    explicitConsent: boolean;
    confirmationAccepted: boolean;
    auditRequired: true;
    sensitivePayloadBlocked: boolean;
    payloadWithinLimit: boolean;
    targetWithinAllowedRoots: boolean;
  };
};

export type NativeAutomationExecutionResult = {
  ok: boolean;
  dryRun: boolean;
  executedAt: string;
  message: string;
  plan: NativeAutomationPlan;
  auditSummary: {
    actionId: string;
    kind: NativeAutomationKind;
    consent: boolean;
    writesExternalSystem: boolean;
    connector: "native-automation-bridge";
  };
  commandResult?: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  };
};

type CommandRunner = (
  command: string,
  args: string[],
  options: { stdin?: string; timeoutMs: number },
) => Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>;

type NativeAutomationBuildOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  platform?: NodeJS.Platform | string;
  now?: Date;
};

type NativeAutomationExecuteOptions = NativeAutomationBuildOptions & {
  runCommand?: CommandRunner;
};

type ResolvedNativeAction = {
  rawActionId: string;
  publicActionId: string;
  commandPreview: string[];
  shortcutName?: string;
  fileTarget?: string;
  appBundleId?: string;
};

function compact(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 160);
}

function redactNativeAutomationText(value: unknown) {
  const text = compact(value);
  if (!text) return "";
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/\/(?:home|tmp|private\/tmp|var\/folders|Volumes)\/[^\s]+/g, "/[redacted-path]")
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, "C:\\Users\\[redacted]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[redacted-phone]")
    .replace(/(bearer|token|key|secret|password)=\S+/gi, "$1=[redacted]");
}

function looksSensitive(value: string) {
  return /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/i.test(value) ||
    /\b(?:github_pat_|ghp_|sk-|sk-or-|AIza)/.test(value) ||
    /(token|key|secret|password)=\S+/i.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /\/Users\/[^/\s]+/.test(value) ||
    /[A-Z]:\\Users\\/i.test(value);
}

function normalizeKind(value: unknown): NativeAutomationKind {
  return ["clipboard", "shortcut", "file", "app", "calendar", "reminder", "shell"].includes(String(value))
    ? String(value) as NativeAutomationKind
    : "shell";
}

function riskForNativeKind(kind: NativeAutomationKind): NativeAutomationRisk {
  if (kind === "clipboard") return "medium";
  if (kind === "app") return "medium";
  return "high";
}

function readAllowlist(env: NativeAutomationBuildOptions["env"]) {
  return new Set(String(env?.[NATIVE_AUTOMATION_ALLOWLIST_ENV] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean));
}

function readFileRoots(env: NativeAutomationBuildOptions["env"]) {
  return String(env?.[NATIVE_AUTOMATION_FILE_ROOTS_ENV] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function isPathInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeFileTarget(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || /[\0\r\n]/.test(raw)) return "";
  return path.isAbsolute(raw) ? path.resolve(raw) : "";
}

function safeShortcutName(value: unknown) {
  const name = compact(value);
  if (!name || /[\r\n\0]/.test(name) || name.length > 80) return "";
  return name;
}

function safeBundleId(value: unknown) {
  const bundleId = compact(value);
  if (!bundleId || bundleId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundleId) || bundleId.includes("..") || !bundleId.includes(".")) {
    return "";
  }
  return bundleId;
}

function resolveNativeAction(kind: NativeAutomationKind, input: NativeAutomationInput): ResolvedNativeAction {
  if (kind === "clipboard") {
    return {
      rawActionId: "clipboard:write-text",
      publicActionId: "clipboard:write-text",
      commandPreview: ["pbcopy", "<text via stdin>"],
    };
  }
  if (kind === "shortcut") {
    const shortcutName = safeShortcutName(input.shortcutName || input.target || input.title);
    const rawActionId = shortcutName ? `shortcut:${shortcutName}` : "shortcut:[missing-name]";
    return {
      rawActionId,
      publicActionId: redactNativeAutomationText(rawActionId) || "shortcut:[redacted]",
      commandPreview: ["shortcuts", "run", redactNativeAutomationText(shortcutName) || "[shortcut-name]"],
      shortcutName,
    };
  }
  if (kind === "file") {
    const fileTarget = normalizeFileTarget(input.target);
    return {
      rawActionId: "file:reveal",
      publicActionId: "file:reveal",
      commandPreview: ["open", "-R", fileTarget ? redactNativeAutomationText(fileTarget) || "[allowed-file]" : "[absolute-file-path]"],
      fileTarget,
    };
  }
  if (kind === "app") {
    const appBundleId = safeBundleId(input.appBundleId || input.target || input.title);
    const rawActionId = appBundleId ? `app:${appBundleId}` : "app:[missing-bundle-id]";
    return {
      rawActionId,
      publicActionId: appBundleId ? rawActionId : "app:[missing-bundle-id]",
      commandPreview: ["open", "-b", appBundleId || "[bundle-id]"],
      appBundleId,
    };
  }
  return {
    rawActionId: `${kind}:blocked`,
    publicActionId: `${kind}:blocked`,
    commandPreview: [],
  };
}

function buildBlockedReasons(input: {
  kind: NativeAutomationKind;
  bridgeEnabled: boolean;
  allowlisted: boolean;
  platformSupported: boolean;
  explicitConsent: boolean;
  confirmationAccepted: boolean;
  sensitivePayloadBlocked: boolean;
  payloadWithinLimit: boolean;
  targetWithinAllowedRoots: boolean;
  action: ResolvedNativeAction;
}) {
  const reasons: string[] = [];
  if (!["clipboard", "shortcut", "file", "app"].includes(input.kind)) reasons.push("unsupported_native_action_kind");
  if (!input.bridgeEnabled) reasons.push("native_bridge_disabled");
  if (!input.platformSupported) reasons.push("macos_runtime_required");
  if (!input.allowlisted) reasons.push("action_not_in_allowlist");
  if (!input.explicitConsent) reasons.push("explicit_consent_required");
  if (!input.confirmationAccepted) reasons.push("confirmation_text_required");
  if (!input.payloadWithinLimit) reasons.push("payload_too_large");
  if (input.sensitivePayloadBlocked) reasons.push("sensitive_payload_blocked");
  if (input.kind === "shortcut" && !input.action.shortcutName) reasons.push("shortcut_name_required");
  if (input.kind === "file" && !input.action.fileTarget) reasons.push("absolute_file_target_required");
  if (input.kind === "file" && !input.targetWithinAllowedRoots) reasons.push("file_target_not_in_allowed_roots");
  if (input.kind === "app" && !input.action.appBundleId) reasons.push("app_bundle_id_required");
  return reasons;
}

export function buildNativeAutomationPlan(input: NativeAutomationInput = {}, options: NativeAutomationBuildOptions = {}): NativeAutomationPlan {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const generatedAt = (options.now || new Date()).toISOString();
  const kind = normalizeKind(input.kind);
  const payload = typeof input.payload === "string" ? input.payload : "";
  const action = resolveNativeAction(kind, input);
  const allowedFileRoots = readFileRoots(env);
  const bridgeEnabled = env[NATIVE_AUTOMATION_ENABLE_ENV] === "1";
  const mockMode = bridgeEnabled && env[NATIVE_AUTOMATION_MOCK_ENV] === "1";
  const mode: NativeAutomationPlan["mode"] = !bridgeEnabled ? "disabled" : mockMode ? "mock" : "guarded";
  const allowlisted = readAllowlist(env).has(action.rawActionId);
  const platformSupported = mockMode || platform === "darwin";
  const explicitConsent = input.explicitConsent === true;
  const confirmationAccepted = input.confirmationText === NATIVE_AUTOMATION_CONFIRMATION_TEXT;
  const payloadWithinLimit = payload.length <= MAX_NATIVE_PAYLOAD_CHARS;
  const sensitivePayloadBlocked = Boolean(payload && looksSensitive(payload) && env.LIFEOS_NATIVE_AUTOMATION_ALLOW_SENSITIVE_PAYLOAD !== "1");
  const targetWithinAllowedRoots = kind !== "file" || Boolean(action.fileTarget && allowedFileRoots.some((root) => isPathInside(root, action.fileTarget || "")));
  const blockedReasons = buildBlockedReasons({
    kind,
    bridgeEnabled,
    allowlisted,
    platformSupported,
    explicitConsent,
    confirmationAccepted,
    sensitivePayloadBlocked,
    payloadWithinLimit,
    targetWithinAllowedRoots,
    action,
  });
  const canExecute = blockedReasons.length === 0;

  return {
    generatedAt,
    mode,
    kind,
    actionId: action.publicActionId,
    status: canExecute ? "ready" : "blocked",
    canExecute,
    supportedNow: canExecute,
    risk: riskForNativeKind(kind),
    commandPreview: action.commandPreview,
    title: redactNativeAutomationText(input.title || input.shortcutName || input.appBundleId || input.target || `${kind} action`) || "Native action",
    sanitizedTarget: redactNativeAutomationText(input.target || input.shortcutName || input.appBundleId || action.publicActionId) || "[redacted]",
    sanitizedSource: redactNativeAutomationText(input.source || "Admin native automation") || "Admin native automation",
    payloadPreview: payload ? redactNativeAutomationText(payload).slice(0, 160) : "",
    writesExternalSystem: canExecute,
    requirements: ["native-bridge", "action-allowlist", "explicit-consent", "confirmation-text", "audit-log", "macos-runtime"],
    blockedReasons,
    safety: {
      bridgeEnabled,
      mockMode,
      allowlisted,
      platformSupported,
      explicitConsent,
      confirmationAccepted,
      auditRequired: true,
      sensitivePayloadBlocked,
      payloadWithinLimit,
      targetWithinAllowedRoots,
    },
  };
}

function redactCommandOutput(value: string) {
  return redactNativeAutomationText(value).slice(0, 800);
}

function runNativeCommand(command: string, args: string[], options: { stdin?: string; timeoutMs: number }) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        HOME: process.env.HOME || "",
        LANG: process.env.LANG || "C",
        PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;

    const finish = (exitCode: number | null, errorText = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: redactCommandOutput(Buffer.concat(stdout).toString("utf8")),
        stderr: redactCommandOutput(`${Buffer.concat(stderr).toString("utf8")}${errorText ? ` ${errorText}` : ""}`.trim()),
        timedOut,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      finish(null, "native automation command timed out");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
    child.stdin?.end(options.stdin || "");
  });
}

export async function executeNativeAutomation(input: NativeAutomationInput = {}, options: NativeAutomationExecuteOptions = {}): Promise<NativeAutomationExecutionResult> {
  const plan = buildNativeAutomationPlan(input, options);
  const executedAt = (options.now || new Date()).toISOString();
  const auditSummary = {
    actionId: plan.actionId,
    kind: plan.kind,
    consent: plan.safety.explicitConsent && plan.safety.confirmationAccepted,
    writesExternalSystem: plan.canExecute,
    connector: "native-automation-bridge" as const,
  };

  if (!plan.canExecute) {
    return {
      ok: false,
      dryRun: true,
      executedAt,
      message: plan.blockedReasons.join(", ") || "native_automation_blocked",
      plan,
      auditSummary,
    };
  }

  if (plan.safety.mockMode) {
    return {
      ok: true,
      dryRun: false,
      executedAt,
      message: "native_automation_mock_executed",
      plan,
      auditSummary,
      commandResult: { exitCode: 0, stdout: "[mock]", stderr: "", timedOut: false },
    };
  }

  const action = resolveNativeAction(plan.kind, input);
  const runner = options.runCommand || runNativeCommand;
  const timeoutMs = Number(options.env?.LIFEOS_NATIVE_AUTOMATION_TIMEOUT_MS || DEFAULT_COMMAND_TIMEOUT_MS);
  const commandResult = plan.kind === "clipboard"
    ? await runner(process.env.LIFEOS_PBCOPY_BIN || "/usr/bin/pbcopy", [], { stdin: input.payload || "", timeoutMs })
    : plan.kind === "file"
      ? await runner(process.env.LIFEOS_OPEN_BIN || "/usr/bin/open", ["-R", action.fileTarget || ""], { timeoutMs })
      : plan.kind === "app"
        ? await runner(process.env.LIFEOS_OPEN_BIN || "/usr/bin/open", ["-b", action.appBundleId || ""], { timeoutMs })
      : await runner(process.env.LIFEOS_SHORTCUTS_BIN || "/usr/bin/shortcuts", ["run", action.shortcutName || ""], { timeoutMs });

  return {
    ok: commandResult.exitCode === 0 && !commandResult.timedOut,
    dryRun: false,
    executedAt,
    message: commandResult.exitCode === 0 && !commandResult.timedOut ? "native_automation_executed" : "native_automation_command_failed",
    plan,
    auditSummary,
    commandResult,
  };
}
