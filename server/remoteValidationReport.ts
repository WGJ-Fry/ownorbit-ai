import { getClientState, setClientState } from "./clientState";

const REMOTE_VALIDATION_STATE_KEY = "lifeos_remote_validation_report";

type ProbeStep = {
  id: string;
  ok: boolean;
  status: number;
  url: string;
  latencyMs: number;
  error?: string;
};

export type RemoteValidationReport = {
  id: string;
  label: string;
  baseUrl: string;
  url: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  passed: number;
  total: number;
  createdAt: number;
  error?: string;
  steps: ProbeStep[];
};

export type RemoteHealthSummary = {
  status: "healthy" | "unchecked" | "failing" | "stale" | "temporary" | "insecure" | "missing";
  severity: "ok" | "warning" | "danger";
  baseUrl: string;
  lastCheckedAt: number | null;
  ageMs: number | null;
  recommendations: Array<
    | "save-long-term-entry"
    | "run-remote-health"
    | "replace-temporary-tunnel"
    | "use-https"
    | "refresh-stale-check"
    | "fix-health-check"
    | "fix-mobile-shell"
    | "fix-websocket"
    | "ready"
  >;
  checks: Array<{
    id: "https" | "health" | "mobile-shell" | "websocket" | "qr-entry";
    status: "ok" | "warning" | "fail" | "unknown";
    detail?: string;
  }>;
};

function sanitizeUrl(value: string) {
  const parsed = new URL(value);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function safeString(value: unknown, fallback: string, maxLength = 120) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, maxLength);
}

export function saveRemoteValidationReport(input: {
  label?: string;
  baseUrl: string;
  result: {
    ok: boolean;
    status: number;
    url: string;
    latencyMs: number;
    error?: string;
    steps?: ProbeStep[];
  };
}, actor?: { type: string; id: string }) {
  const steps = (input.result.steps || []).map((step) => ({
    id: safeString(step.id, "unknown", 40),
    ok: Boolean(step.ok),
    status: Number.isFinite(step.status) ? step.status : 0,
    url: sanitizeUrl(step.url),
    latencyMs: Number.isFinite(step.latencyMs) ? step.latencyMs : 0,
    error: step.error ? safeString(step.error, "Remote check failed", 240) : undefined,
  }));
  const report: RemoteValidationReport = {
    id: `remote-validation-${Date.now()}`,
    label: safeString(input.label, "Saved remote entry"),
    baseUrl: sanitizeUrl(input.baseUrl),
    url: sanitizeUrl(input.result.url),
    ok: Boolean(input.result.ok),
    status: Number.isFinite(input.result.status) ? input.result.status : 0,
    latencyMs: Number.isFinite(input.result.latencyMs) ? input.result.latencyMs : 0,
    passed: steps.filter((step) => step.ok).length,
    total: steps.length || 1,
    createdAt: Date.now(),
    error: input.result.error ? safeString(input.result.error, "Remote entry check failed", 240) : undefined,
    steps,
  };
  setClientState(REMOTE_VALIDATION_STATE_KEY, report, actor);
  return report;
}

export function getRemoteValidationReport(): RemoteValidationReport | null {
  const state = getClientState(REMOTE_VALIDATION_STATE_KEY);
  return (state?.value || null) as RemoteValidationReport | null;
}

function safeSanitizeUrl(value: string) {
  try {
    return sanitizeUrl(value);
  } catch {
    return "";
  }
}

function sameBaseUrl(left: string, right: string) {
  const safeLeft = safeSanitizeUrl(left);
  const safeRight = safeSanitizeUrl(right);
  return Boolean(safeLeft && safeRight && safeLeft === safeRight);
}

function stepStatus(report: RemoteValidationReport | null, id: ProbeStep["id"]): RemoteHealthSummary["checks"][number] {
  const step = report?.steps.find((item) => item.id === id);
  if (!step) return { id: id as RemoteHealthSummary["checks"][number]["id"], status: "unknown" as const };
  return {
    id: id as RemoteHealthSummary["checks"][number]["id"],
    status: step.ok ? "ok" as const : "fail" as const,
    detail: step.error,
  };
}

export function summarizeRemoteHealth(input: {
  baseUrl?: string;
  readiness?: { status?: string; baseUrl?: string };
  report?: RemoteValidationReport | null;
  now?: number;
}): RemoteHealthSummary {
  const baseUrl = safeSanitizeUrl(input.baseUrl || input.readiness?.baseUrl || input.report?.baseUrl || "");
  const now = input.now || Date.now();
  const report = input.report || null;
  const ageMs = report ? Math.max(0, now - report.createdAt) : null;
  const reportIsCurrent = Boolean(report && baseUrl && sameBaseUrl(baseUrl, report.baseUrl));
  const isHttps = baseUrl.startsWith("https://");
  const isTemporary = baseUrl.includes(".trycloudflare.com") || input.readiness?.status === "temporary";
  const qrStatus = !baseUrl
    ? "fail"
    : isTemporary
      ? "warning"
      : input.readiness?.status === "ready"
        ? "ok"
        : input.readiness?.status === "needs-restart"
          ? "warning"
          : "unknown";

  const checks: RemoteHealthSummary["checks"] = [
    {
      id: "https",
      status: !baseUrl ? "unknown" : isHttps ? "ok" : "fail",
      detail: baseUrl || undefined,
    },
    stepStatus(reportIsCurrent ? report : null, "health"),
    stepStatus(reportIsCurrent ? report : null, "mobile-shell"),
    stepStatus(reportIsCurrent ? report : null, "websocket"),
    {
      id: "qr-entry",
      status: qrStatus,
      detail: baseUrl || undefined,
    },
  ];

  const recommendations = new Set<RemoteHealthSummary["recommendations"][number]>();
  let status: RemoteHealthSummary["status"] = "healthy";
  let severity: RemoteHealthSummary["severity"] = "ok";

  if (!baseUrl) {
    status = "missing";
    severity = "danger";
    recommendations.add("save-long-term-entry");
  } else if (!isHttps) {
    status = "insecure";
    severity = "danger";
    recommendations.add("use-https");
  } else if (isTemporary) {
    status = "temporary";
    severity = "warning";
    recommendations.add("replace-temporary-tunnel");
  } else if (!report) {
    status = "unchecked";
    severity = "warning";
    recommendations.add("run-remote-health");
  } else if (!reportIsCurrent || (ageMs !== null && ageMs > 10 * 60 * 1000)) {
    status = "stale";
    severity = "warning";
    recommendations.add("refresh-stale-check");
  } else if (!report.ok) {
    status = "failing";
    severity = "danger";
    if (checks.find((check) => check.id === "health")?.status === "fail") recommendations.add("fix-health-check");
    if (checks.find((check) => check.id === "mobile-shell")?.status === "fail") recommendations.add("fix-mobile-shell");
    if (checks.find((check) => check.id === "websocket")?.status === "fail") recommendations.add("fix-websocket");
  } else {
    recommendations.add("ready");
  }

  return {
    status,
    severity,
    baseUrl,
    lastCheckedAt: report?.createdAt || null,
    ageMs,
    recommendations: Array.from(recommendations),
    checks,
  };
}
