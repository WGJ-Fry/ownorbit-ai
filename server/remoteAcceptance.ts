import { saveRemoteValidationReport, type RemoteHealthSummary, type RemoteValidationReport } from "./remoteValidationReport.ts";
import { getClientState, setClientState } from "./clientState";

const REMOTE_ACCEPTANCE_STATE_KEY = "lifeos_remote_acceptance_records";
const REMOTE_ACCEPTANCE_RUNBOOK_STATE_KEY = "lifeos_remote_acceptance_runbook_reports";
const MANUAL_ACCEPTANCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const manualAcceptanceIds = new Set(["restart-restore", "cellular-mobile-chat", "network-interruption", "diagnostic-export"]);
const runbookEntryKinds = new Set(["temporary-cloudflare", "tailscale-https", "local", "stable-https", "insecure-http"]);
const runbookManualSteps = [
  {
    id: "cellular-mobile-chat",
    title: "Phone cellular /mobile/chat",
    instruction: "Turn off phone Wi-Fi, open the saved mobile entry on cellular data, send one chat message, and confirm realtime/retry state is healthy.",
    required: true,
  },
  {
    id: "restart-restore",
    title: "Desktop restart restore",
    instruction: "Quit and reopen the desktop app, run the remote health check again, and confirm the same HTTPS entry still serves /api/v1/health, /mobile/chat, and WebSocket.",
    required: true,
  },
  {
    id: "network-interruption",
    title: "Network interruption recovery",
    instruction: "Disconnect and reconnect the remote path, then confirm diagnostics refresh and the phone gets a clear recovery message.",
    required: true,
  },
  {
    id: "diagnostic-export",
    title: "Export diagnostic evidence",
    instruction: "Export the admin diagnostic bundle after the manual checks.",
    required: true,
  },
];

export type RemoteAcceptanceItem = {
  id: "tailscale-https-serve" | "cloudflare-named-tunnel" | "remote-smoke" | "restart-restore" | "cellular-mobile-chat" | "network-interruption" | "diagnostic-export" | "ci-remote-mock";
  status: "passed" | "needs-action" | "manual-required";
  evidence: string;
  action: string;
  command?: string;
  acceptedAt?: number;
  expiresAt?: number;
};

export type RemoteAcceptanceSummary = {
  ready: boolean;
  passed: number;
  total: number;
  needsAction: number;
  manualRequired: number;
  hasLongTermEntry: boolean;
  hasRealWorldEvidence: boolean;
  blockingItems: Array<Pick<RemoteAcceptanceItem, "id" | "status" | "action" | "command">>;
};

export type RemoteAcceptanceRecord = {
  id: RemoteAcceptanceItem["id"];
  baseUrl: string;
  note: string;
  evidence?: {
    entryKind: RemoteAcceptanceRunbookRecord["entryKind"];
    verifiedUrl: string;
    source: string;
    requirements: string[];
  };
  createdAt: number;
};

export type RemoteAcceptanceRunbookRecord = {
  id: string;
  baseUrl: string;
  entryKind: "temporary-cloudflare" | "tailscale-https" | "local" | "stable-https" | "insecure-http";
  longTermReady: boolean;
  longTermReason: string;
  realWorldAcceptanceRequired: boolean;
  completionStatus: "ready" | "automated-ready-manual-required" | "not-ready";
  generatedAt: string;
  importedAt: number;
  automatedChecks: {
    ok: boolean;
    httpsStatus?: {
      ok: boolean;
      protocol: string;
      requiredForLongTerm: boolean;
      trustedByRuntime: boolean;
      error?: string;
    };
    passed: number;
    total: number;
    latencyMs: number;
    steps: Array<{
      id: string;
      ok: boolean;
      status: number;
      url: string;
      latencyMs: number;
      error?: string;
    }>;
  };
  manualAcceptance: Array<{ id: string; title: string; required: boolean }>;
};

type AcceptanceDiagnostics = {
  desktopRuntimeConfig?: { mode?: string; publicBaseUrl?: string } | null;
  tailscale?: { serveRunning?: boolean; httpsServeUrl?: string };
  cloudflareNamedTunnel?: { ready?: boolean; configured?: boolean; baseUrl?: string; hostname?: string };
};

type ConnectionTestResult = {
  ok: boolean;
  status: number;
  url: string;
  latencyMs: number;
  error?: string;
  steps?: Array<{
    id: string;
    ok: boolean;
    status: number;
    url: string;
    latencyMs: number;
    error?: string;
  }>;
};

function sameUrl(left = "", right = "") {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.search = "";
    leftUrl.hash = "";
    rightUrl.search = "";
    rightUrl.hash = "";
    return leftUrl.toString().replace(/\/$/, "") === rightUrl.toString().replace(/\/$/, "");
  } catch {
    return false;
  }
}

function reportCoversBase(report: RemoteValidationReport | null, baseUrl = "") {
  return Boolean(report?.ok && baseUrl && sameUrl(report.baseUrl, baseUrl));
}

function sanitizeBaseUrl(value = "") {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Remote acceptance URL must not contain username, password, token, query, or fragment.");
  }
  if (parsed.protocol !== "https:") throw new Error("Remote acceptance requires the current HTTPS remote entry.");
  return parsed.toString().replace(/\/$/, "");
}

function safeUrl(value: unknown) {
  const parsed = new URL(String(value || ""));
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Remote acceptance report URLs must not contain username, password, token, query, or fragment.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function safeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function safeNote(value: unknown) {
  return String(value || "").replace(/\b(token|key|secret|password)=\S+/gi, "$1=[redacted]").trim().slice(0, 240);
}

function safeRequirements(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => safeNote(item)).filter(Boolean).slice(0, 6)
    : [];
}

function entryKind(baseUrl: string): RemoteAcceptanceRunbookRecord["entryKind"] {
  const parsed = new URL(baseUrl);
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith(".trycloudflare.com")) return "temporary-cloudflare";
  if (host.includes(".ts.net") || host.includes(".tailscale")) return "tailscale-https";
  if (host.includes("localhost") || host === "127.0.0.1") return "local";
  if (parsed.protocol === "https:") return "stable-https";
  return "insecure-http";
}

function longTermReason(kind: RemoteAcceptanceRunbookRecord["entryKind"], smokeOk: boolean) {
  if (kind === "temporary-cloudflare") return "Temporary trycloudflare.com entries are for testing only. Use Tailscale HTTPS Serve or Cloudflare Named Tunnel for long-term use.";
  if (kind === "local" || kind === "insecure-http") return "Remote entry is not an accepted HTTPS long-term remote entry.";
  if (!smokeOk) return "Remote smoke checks did not all pass.";
  return "Remote entry is HTTPS, non-temporary, and passed automated smoke checks.";
}

function safeHttpsStatus(value: unknown, baseUrl: string, automatedOk: boolean): NonNullable<RemoteAcceptanceRunbookRecord["automatedChecks"]["httpsStatus"]> {
  const parsed = new URL(baseUrl);
  const protocol = parsed.protocol.replace(":", "");
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reportedOk = typeof raw.ok === "boolean" ? raw.ok : automatedOk;
  const trustedByRuntime = typeof raw.trustedByRuntime === "boolean" ? raw.trustedByRuntime : reportedOk;
  const error = raw.error ? safeNote(raw.error) : undefined;
  const ok = protocol === "https" && reportedOk && trustedByRuntime && !error;
  return {
    ok,
    protocol,
    requiredForLongTerm: true,
    trustedByRuntime: protocol === "https" && trustedByRuntime && !error,
    error,
  };
}

function completionStatus(longTermReady: boolean, realWorldAcceptanceRequired: boolean): RemoteAcceptanceRunbookRecord["completionStatus"] {
  if (!longTermReady) return "not-ready";
  return realWorldAcceptanceRequired ? "automated-ready-manual-required" : "ready";
}

export function getRemoteAcceptanceRecords(): RemoteAcceptanceRecord[] {
  const value = getClientState(REMOTE_ACCEPTANCE_STATE_KEY)?.value;
  return Array.isArray(value) ? value as RemoteAcceptanceRecord[] : [];
}

export function getRemoteAcceptanceRunbookRecords(): RemoteAcceptanceRunbookRecord[] {
  const value = getClientState(REMOTE_ACCEPTANCE_RUNBOOK_STATE_KEY)?.value;
  return Array.isArray(value) ? value as RemoteAcceptanceRunbookRecord[] : [];
}

export function saveRemoteAcceptanceRunbookReport(report: any, actor?: { type: string; id: string }) {
  const baseUrl = sanitizeBaseUrl(report?.baseUrl);
  const reportedEntryKind = String(report?.entryKind || "");
  if (!runbookEntryKinds.has(reportedEntryKind)) throw new Error("Remote acceptance report has an unsupported entry kind.");
  const derivedEntryKind = entryKind(baseUrl);
  const steps = Array.isArray(report?.automatedChecks?.steps) ? report.automatedChecks.steps.slice(0, 12).map((step: any) => ({
    id: String(step?.id || "unknown").slice(0, 40),
    ok: Boolean(step?.ok),
    status: safeNumber(step?.status),
    url: safeUrl(step?.url),
    latencyMs: safeNumber(step?.latencyMs),
    error: step?.error ? safeNote(step.error) : undefined,
  })) : [];
  const manualAcceptance = Array.isArray(report?.manualAcceptance) ? report.manualAcceptance.slice(0, 8).map((step: any) => ({
    id: String(step?.id || "unknown").slice(0, 48),
    title: String(step?.title || "Manual acceptance").slice(0, 80),
    required: Boolean(step?.required),
  })) : [];
  const realWorldAcceptanceRequired = typeof report?.realWorldAcceptanceRequired === "boolean"
    ? Boolean(report.realWorldAcceptanceRequired)
    : manualAcceptance.some((step) => step.required);
  const automatedOk = Boolean(report?.automatedChecks?.ok);
  const httpsStatus = safeHttpsStatus(report?.automatedChecks?.httpsStatus, baseUrl, automatedOk);
  const readinessOk = automatedOk && httpsStatus.ok;
  const longTermReady = readinessOk && derivedEntryKind !== "temporary-cloudflare" && derivedEntryKind !== "local" && derivedEntryKind !== "insecure-http";
  const record: RemoteAcceptanceRunbookRecord = {
    id: `remote-acceptance-runbook-${Date.now()}`,
    baseUrl,
    entryKind: derivedEntryKind,
    longTermReady,
    longTermReason: longTermReason(derivedEntryKind, readinessOk),
    realWorldAcceptanceRequired,
    completionStatus: completionStatus(longTermReady, realWorldAcceptanceRequired),
    generatedAt: Number.isFinite(Date.parse(report?.generatedAt)) ? new Date(report.generatedAt).toISOString() : new Date().toISOString(),
    importedAt: Date.now(),
    automatedChecks: {
      ok: automatedOk,
      httpsStatus,
      passed: safeNumber(report?.automatedChecks?.passed),
      total: safeNumber(report?.automatedChecks?.total, steps.length || 1),
      latencyMs: safeNumber(report?.automatedChecks?.latencyMs),
      steps,
    },
    manualAcceptance,
  };
  saveRemoteValidationReport({
    label: `remote-acceptance:${record.entryKind}`,
    baseUrl,
    result: {
      ok: record.automatedChecks.ok,
      status: record.automatedChecks.ok ? 200 : 0,
      url: baseUrl,
      latencyMs: record.automatedChecks.latencyMs,
      steps,
      error: record.automatedChecks.ok ? undefined : record.longTermReason,
    },
  }, actor);
  const records = getRemoteAcceptanceRunbookRecords().filter((item) => !sameUrl(item.baseUrl, record.baseUrl));
  setClientState(REMOTE_ACCEPTANCE_RUNBOOK_STATE_KEY, [...records, record].slice(-5), actor);
  return record;
}

export function saveRemoteAcceptanceRunbookFromConnectionTest(input: {
  baseUrl: string;
  result: ConnectionTestResult;
}, actor?: { type: string; id: string }) {
  const baseUrl = sanitizeBaseUrl(input.baseUrl);
  const kind = entryKind(baseUrl);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    entryKind: kind,
    longTermReady: input.result.ok && kind !== "temporary-cloudflare" && kind !== "local" && kind !== "insecure-http",
    longTermReason: longTermReason(kind, input.result.ok),
    realWorldAcceptanceRequired: runbookManualSteps.some((step) => step.required),
    completionStatus: completionStatus(input.result.ok && kind !== "temporary-cloudflare" && kind !== "local" && kind !== "insecure-http", true),
    automatedChecks: {
      ok: input.result.ok,
      httpsStatus: safeHttpsStatus(undefined, baseUrl, input.result.ok),
      passed: (input.result.steps || []).filter((step) => step.ok).length,
      total: input.result.steps?.length || 1,
      latencyMs: input.result.latencyMs,
      steps: input.result.steps || [{
        id: "health",
        ok: input.result.ok,
        status: input.result.status,
        url: input.result.url,
        latencyMs: input.result.latencyMs,
        error: input.result.error,
      }],
    },
    manualAcceptance: runbookManualSteps,
  };
  return saveRemoteAcceptanceRunbookReport(report, actor);
}

export function saveRemoteAcceptanceRecord(input: {
  id: RemoteAcceptanceItem["id"];
  baseUrl: string;
  note?: string;
  evidence?: {
    source?: string;
    requirements?: string[];
  };
}, actor?: { type: string; id: string }) {
  if (!manualAcceptanceIds.has(input.id)) throw new Error("Only real-world manual acceptance items can be marked manually.");
  const baseUrl = sanitizeBaseUrl(input.baseUrl);
  const record: RemoteAcceptanceRecord = {
    id: input.id,
    baseUrl,
    note: safeNote(input.note),
    evidence: {
      entryKind: entryKind(baseUrl),
      verifiedUrl: baseUrl,
      source: safeNote(input.evidence?.source || "admin-checklist"),
      requirements: safeRequirements(input.evidence?.requirements),
    },
    createdAt: Date.now(),
  };
  const records = getRemoteAcceptanceRecords().filter((item) => !(item.id === record.id && sameUrl(item.baseUrl, record.baseUrl)));
  setClientState(REMOTE_ACCEPTANCE_STATE_KEY, [...records, record], actor);
  return record;
}

function latestManualRecord(records: RemoteAcceptanceRecord[], id: RemoteAcceptanceItem["id"], baseUrl: string) {
  return records
    .filter((item) => item.id === id && sameUrl(item.baseUrl, baseUrl))
    .sort((left, right) => right.createdAt - left.createdAt)[0] || null;
}

function manualRecord(records: RemoteAcceptanceRecord[], id: RemoteAcceptanceItem["id"], baseUrl: string, now = Date.now()) {
  const record = latestManualRecord(records, id, baseUrl);
  if (!record) return null;
  return now - record.createdAt <= MANUAL_ACCEPTANCE_MAX_AGE_MS ? record : null;
}

function manualEvidence(record: RemoteAcceptanceRecord | null) {
  if (!record) return "";
  return record.note || record.evidence?.requirements?.join("; ") || record.baseUrl;
}

function staleManualEvidence(record: RemoteAcceptanceRecord | null, fallback: string) {
  if (!record) return fallback;
  return `Previous acceptance at ${new Date(record.createdAt).toISOString()} is older than 7 days. Repeat this real-world check for the current HTTPS entry.`;
}

export function buildRemoteAcceptanceChecklist(input: {
  diagnostics: AcceptanceDiagnostics;
  health: RemoteHealthSummary;
  report: RemoteValidationReport | null;
  records?: RemoteAcceptanceRecord[];
  now?: number;
}): RemoteAcceptanceItem[] {
  const { diagnostics, health, report } = input;
  const now = input.now || Date.now();
  const runtimeUrl = diagnostics.desktopRuntimeConfig?.publicBaseUrl || health.baseUrl || "";
  const tailscaleUrl = diagnostics.tailscale?.httpsServeUrl || "";
  const namedUrl = diagnostics.cloudflareNamedTunnel?.baseUrl || "";
  const stableHealthPassed = health.status === "healthy" && reportCoversBase(report, runtimeUrl);
  const restored = Boolean(report?.ok && /auto-restore|startup/i.test(report.label || ""));
  const restartLatestRecord = latestManualRecord(input.records || [], "restart-restore", runtimeUrl);
  const cellularLatestRecord = latestManualRecord(input.records || [], "cellular-mobile-chat", runtimeUrl);
  const interruptionLatestRecord = latestManualRecord(input.records || [], "network-interruption", runtimeUrl);
  const diagnosticLatestRecord = latestManualRecord(input.records || [], "diagnostic-export", runtimeUrl);
  const restartRecord = manualRecord(input.records || [], "restart-restore", runtimeUrl, now);
  const cellularRecord = manualRecord(input.records || [], "cellular-mobile-chat", runtimeUrl, now);
  const interruptionRecord = manualRecord(input.records || [], "network-interruption", runtimeUrl, now);
  const diagnosticRecord = manualRecord(input.records || [], "diagnostic-export", runtimeUrl, now);

  return [
    {
      id: "tailscale-https-serve",
      status: diagnostics.tailscale?.serveRunning && tailscaleUrl && stableHealthPassed && sameUrl(runtimeUrl, tailscaleUrl) ? "passed" : "needs-action",
      evidence: diagnostics.tailscale?.serveRunning && tailscaleUrl ? tailscaleUrl : "Tailscale HTTPS Serve has not been proven as the saved healthy entry.",
      action: "Start Tailscale HTTPS Serve, save it as the desktop remote entry, restart LifeOS AI, then run remote health.",
      command: "tailscale serve --bg https:443 http://127.0.0.1:3000",
    },
    {
      id: "cloudflare-named-tunnel",
      status: diagnostics.cloudflareNamedTunnel?.ready && namedUrl && stableHealthPassed && sameUrl(runtimeUrl, namedUrl) ? "passed" : "needs-action",
      evidence: diagnostics.cloudflareNamedTunnel?.ready && namedUrl ? namedUrl : "Cloudflare Named Tunnel is not configured and verified as the saved healthy entry.",
      action: "Generate the Named Tunnel config, start it, save its HTTPS hostname, restart LifeOS AI, then run remote health.",
      command: "cloudflared tunnel run <name>",
    },
    {
      id: "remote-smoke",
      status: report?.ok && stableHealthPassed ? "passed" : "needs-action",
      evidence: report ? `${report.passed}/${report.total} checks at ${report.baseUrl}` : "No saved remote smoke report yet.",
      action: "Run the admin remote health check or execute npm run remote:smoke with LIFEOS_REMOTE_BASE_URL.",
      command: "LIFEOS_REMOTE_BASE_URL=https://your-stable-entry npm run remote:smoke",
    },
    {
      id: "restart-restore",
      status: restored || restartRecord ? "passed" : "manual-required",
      evidence: restored ? report!.label : restartRecord ? `Manually accepted at ${new Date(restartRecord.createdAt).toISOString()}: ${manualEvidence(restartRecord)}` : staleManualEvidence(restartLatestRecord, "Restart LifeOS AI and confirm the saved Tailscale/Named Tunnel entry is restored automatically."),
      action: "Quit and reopen the desktop app, then run the remote health check again.",
      acceptedAt: restartRecord?.createdAt,
      expiresAt: restartRecord ? restartRecord.createdAt + MANUAL_ACCEPTANCE_MAX_AGE_MS : undefined,
    },
    {
      id: "cellular-mobile-chat",
      status: cellularRecord ? "passed" : "manual-required",
      evidence: cellularRecord ? `Manually accepted at ${new Date(cellularRecord.createdAt).toISOString()}: ${manualEvidence(cellularRecord)}` : staleManualEvidence(cellularLatestRecord, "Requires a real phone on cellular data opening /mobile/chat through the saved HTTPS entry."),
      action: "Turn off phone Wi-Fi, open the saved mobile entry, send a chat message, and confirm WebSocket/retry state is healthy.",
      acceptedAt: cellularRecord?.createdAt,
      expiresAt: cellularRecord ? cellularRecord.createdAt + MANUAL_ACCEPTANCE_MAX_AGE_MS : undefined,
    },
    {
      id: "network-interruption",
      status: interruptionRecord ? "passed" : "manual-required",
      evidence: interruptionRecord ? `Manually accepted at ${new Date(interruptionRecord.createdAt).toISOString()}: ${manualEvidence(interruptionRecord)}` : staleManualEvidence(interruptionLatestRecord, "Disconnect and reconnect the remote path, then confirm diagnostics refresh and the phone shows a clear recovery message."),
      action: "Temporarily interrupt Tailscale/Tunnel/network, restore it, run remote health again, and verify the phone reconnect guidance.",
      acceptedAt: interruptionRecord?.createdAt,
      expiresAt: interruptionRecord ? interruptionRecord.createdAt + MANUAL_ACCEPTANCE_MAX_AGE_MS : undefined,
    },
    {
      id: "diagnostic-export",
      status: diagnosticRecord ? "passed" : "manual-required",
      evidence: diagnosticRecord ? `Manually accepted at ${new Date(diagnosticRecord.createdAt).toISOString()}: ${manualEvidence(diagnosticRecord)}` : staleManualEvidence(diagnosticLatestRecord, "Export the admin diagnostic bundle after the real remote checks."),
      action: "Export diagnostics from Settings and keep the redacted bundle with the release/acceptance evidence.",
      acceptedAt: diagnosticRecord?.createdAt,
      expiresAt: diagnosticRecord ? diagnosticRecord.createdAt + MANUAL_ACCEPTANCE_MAX_AGE_MS : undefined,
    },
    {
      id: "ci-remote-mock",
      status: "passed",
      evidence: "GitHub Actions runs npm run remote:mock-smoke as the remote-path regression guard.",
      action: "Keep the Quality Gate workflow required before merging.",
      command: "npm run remote:mock-smoke",
    },
  ];
}

export function summarizeRemoteAcceptanceChecklist(checklist: RemoteAcceptanceItem[]): RemoteAcceptanceSummary {
  const passed = checklist.filter((item) => item.status === "passed").length;
  const needsAction = checklist.filter((item) => item.status === "needs-action").length;
  const manualRequired = checklist.filter((item) => item.status === "manual-required").length;
  const hasLongTermEntry = checklist.some((item) => (item.id === "tailscale-https-serve" || item.id === "cloudflare-named-tunnel") && item.status === "passed");
  const requiredRealWorldIds = new Set(["remote-smoke", "restart-restore", "cellular-mobile-chat", "network-interruption", "diagnostic-export", "ci-remote-mock"]);
  const hasRealWorldEvidence = checklist
    .filter((item) => requiredRealWorldIds.has(item.id))
    .every((item) => item.status === "passed");
  return {
    ready: hasLongTermEntry && hasRealWorldEvidence,
    passed,
    total: checklist.length,
    needsAction,
    manualRequired,
    hasLongTermEntry,
    hasRealWorldEvidence,
    blockingItems: checklist
      .filter((item) => item.status !== "passed")
      .filter((item) => !(hasLongTermEntry && (item.id === "tailscale-https-serve" || item.id === "cloudflare-named-tunnel")))
      .map((item) => ({
        id: item.id,
        status: item.status,
        action: item.action,
        command: item.command,
      })),
  };
}
