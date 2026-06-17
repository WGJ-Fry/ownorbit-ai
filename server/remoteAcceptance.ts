import type { RemoteHealthSummary, RemoteValidationReport } from "./remoteValidationReport";
import { getClientState, setClientState } from "./clientState";

const REMOTE_ACCEPTANCE_STATE_KEY = "lifeos_remote_acceptance_records";
const manualAcceptanceIds = new Set(["restart-restore", "cellular-mobile-chat"]);

export type RemoteAcceptanceItem = {
  id: "tailscale-https-serve" | "cloudflare-named-tunnel" | "remote-smoke" | "restart-restore" | "cellular-mobile-chat" | "ci-remote-mock";
  status: "passed" | "needs-action" | "manual-required";
  evidence: string;
  action: string;
  command?: string;
  acceptedAt?: number;
};

export type RemoteAcceptanceRecord = {
  id: RemoteAcceptanceItem["id"];
  baseUrl: string;
  note: string;
  createdAt: number;
};

type AcceptanceDiagnostics = {
  desktopRuntimeConfig?: { mode?: string; publicBaseUrl?: string } | null;
  tailscale?: { serveRunning?: boolean; httpsServeUrl?: string };
  cloudflareNamedTunnel?: { ready?: boolean; configured?: boolean; baseUrl?: string; hostname?: string };
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

function safeNote(value: unknown) {
  return String(value || "").replace(/\b(token|key|secret|password)=\S+/gi, "$1=[redacted]").trim().slice(0, 240);
}

export function getRemoteAcceptanceRecords(): RemoteAcceptanceRecord[] {
  const value = getClientState(REMOTE_ACCEPTANCE_STATE_KEY)?.value;
  return Array.isArray(value) ? value as RemoteAcceptanceRecord[] : [];
}

export function saveRemoteAcceptanceRecord(input: {
  id: RemoteAcceptanceItem["id"];
  baseUrl: string;
  note?: string;
}, actor?: { type: string; id: string }) {
  if (!manualAcceptanceIds.has(input.id)) throw new Error("Only real-world manual acceptance items can be marked manually.");
  const record: RemoteAcceptanceRecord = {
    id: input.id,
    baseUrl: sanitizeBaseUrl(input.baseUrl),
    note: safeNote(input.note),
    createdAt: Date.now(),
  };
  const records = getRemoteAcceptanceRecords().filter((item) => !(item.id === record.id && sameUrl(item.baseUrl, record.baseUrl)));
  setClientState(REMOTE_ACCEPTANCE_STATE_KEY, [...records, record], actor);
  return record;
}

function manualRecord(records: RemoteAcceptanceRecord[], id: RemoteAcceptanceItem["id"], baseUrl: string) {
  return records
    .filter((item) => item.id === id && sameUrl(item.baseUrl, baseUrl))
    .sort((left, right) => right.createdAt - left.createdAt)[0] || null;
}

export function buildRemoteAcceptanceChecklist(input: {
  diagnostics: AcceptanceDiagnostics;
  health: RemoteHealthSummary;
  report: RemoteValidationReport | null;
  records?: RemoteAcceptanceRecord[];
}): RemoteAcceptanceItem[] {
  const { diagnostics, health, report } = input;
  const runtimeUrl = diagnostics.desktopRuntimeConfig?.publicBaseUrl || health.baseUrl || "";
  const tailscaleUrl = diagnostics.tailscale?.httpsServeUrl || "";
  const namedUrl = diagnostics.cloudflareNamedTunnel?.baseUrl || "";
  const stableHealthPassed = health.status === "healthy" && reportCoversBase(report, runtimeUrl);
  const restored = Boolean(report?.ok && /auto-restore|startup/i.test(report.label || ""));
  const restartRecord = manualRecord(input.records || [], "restart-restore", runtimeUrl);
  const cellularRecord = manualRecord(input.records || [], "cellular-mobile-chat", runtimeUrl);

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
      evidence: restored ? report!.label : restartRecord ? `Manually accepted at ${new Date(restartRecord.createdAt).toISOString()}: ${restartRecord.note || restartRecord.baseUrl}` : "Restart LifeOS AI and confirm the saved Tailscale/Named Tunnel entry is restored automatically.",
      action: "Quit and reopen the desktop app, then run the remote health check again.",
      acceptedAt: restartRecord?.createdAt,
    },
    {
      id: "cellular-mobile-chat",
      status: cellularRecord ? "passed" : "manual-required",
      evidence: cellularRecord ? `Manually accepted at ${new Date(cellularRecord.createdAt).toISOString()}: ${cellularRecord.note || cellularRecord.baseUrl}` : "Requires a real phone on cellular data opening /mobile/chat through the saved HTTPS entry.",
      action: "Turn off phone Wi-Fi, open the saved mobile entry, send a chat message, and confirm WebSocket/retry state is healthy.",
      acceptedAt: cellularRecord?.createdAt,
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
