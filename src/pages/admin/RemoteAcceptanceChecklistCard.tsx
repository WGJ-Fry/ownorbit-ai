import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3 } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

const itemKey = {
  "tailscale-https-serve": "connection.acceptance.item.tailscale",
  "cloudflare-named-tunnel": "connection.acceptance.item.cloudflare",
  "remote-smoke": "connection.acceptance.item.remoteSmoke",
  "restart-restore": "connection.acceptance.item.restartRestore",
  "cellular-mobile-chat": "connection.acceptance.item.cellular",
  "ci-remote-mock": "connection.acceptance.item.ci",
} as const;

const statusKey = {
  passed: "connection.acceptance.status.passed",
  "needs-action": "connection.acceptance.status.needsAction",
  "manual-required": "connection.acceptance.status.manualRequired",
} as const;

function tone(status: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["status"]) {
  if (status === "passed") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  if (status === "manual-required") return "border-sky-400/20 bg-sky-500/10 text-sky-100";
  return "border-amber-400/20 bg-amber-500/10 text-amber-100";
}

function StatusIcon({ status }: { status: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["status"] }) {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "manual-required") return <Clock3 className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

export default function RemoteAcceptanceChecklistCard({
  checklist,
  acceptingId,
  onAccept,
}: {
  checklist: NetworkDiagnostics["remoteAcceptanceChecklist"];
  acceptingId?: string | null;
  onAccept?: (id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#061016]/65 p-4">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-zinc-100">{t("connection.acceptance.title")}</div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t("connection.acceptance.body")}</p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {checklist.map((item) => (
              <div key={item.id} className={`rounded-xl border p-3 ${tone(item.status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold">{t(itemKey[item.id] as any)}</div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider opacity-75">{t(statusKey[item.status] as any)}</div>
                  </div>
                  <StatusIcon status={item.status} />
                </div>
                <div className="mt-2 break-words text-[11px] leading-relaxed opacity-85">{item.evidence}</div>
                <div className="mt-2 text-[11px] leading-relaxed opacity-95">{item.action}</div>
                {item.command ? <code className="mt-2 block break-all rounded-lg bg-black/25 px-2 py-1 text-[10px] opacity-90">{item.command}</code> : null}
                {onAccept && item.status === "manual-required" && (item.id === "restart-restore" || item.id === "cellular-mobile-chat") ? (
                  <button
                    onClick={() => onAccept(item.id)}
                    disabled={acceptingId === item.id}
                    className="mt-3 inline-flex rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                  >
                    {acceptingId === item.id ? t("connection.acceptance.recording") : t("connection.acceptance.markDone")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
