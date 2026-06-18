import { useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Copy } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

const itemKey = {
  "tailscale-https-serve": "connection.acceptance.item.tailscale",
  "cloudflare-named-tunnel": "connection.acceptance.item.cloudflare",
  "remote-smoke": "connection.acceptance.item.remoteSmoke",
  "restart-restore": "connection.acceptance.item.restartRestore",
  "cellular-mobile-chat": "connection.acceptance.item.cellular",
  "network-interruption": "connection.acceptance.item.networkInterruption",
  "diagnostic-export": "connection.acceptance.item.diagnosticExport",
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
  acceptanceCommand,
  checklist,
  acceptingId,
  importingReport,
  reportText,
  runbooks,
  runningAcceptance,
  smokeCommand,
  summary,
  onAccept,
  onImportReport,
  onRunAcceptance,
  onReportTextChange,
}: {
  acceptanceCommand: string;
  checklist: NetworkDiagnostics["remoteAcceptanceChecklist"];
  acceptingId?: string | null;
  importingReport?: boolean;
  reportText?: string;
  runbooks?: NetworkDiagnostics["remoteAcceptanceRunbooks"];
  runningAcceptance?: boolean;
  smokeCommand: string;
  summary?: NetworkDiagnostics["remoteAcceptanceSummary"];
  onAccept?: (id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]) => void;
  onImportReport?: () => void;
  onRunAcceptance?: () => void;
  onReportTextChange?: (value: string) => void;
}) {
  const { t } = useI18n();
  const [copiedCommand, setCopiedCommand] = useState<"smoke" | "acceptance" | null>(null);
  const handleCopyCommand = async (kind: "smoke" | "acceptance", command: string) => {
    await navigator.clipboard.writeText(command).catch(() => undefined);
    setCopiedCommand(kind);
    window.setTimeout(() => setCopiedCommand(null), 1400);
  };

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#061016]/65 p-4">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-zinc-100">{t("connection.acceptance.title")}</div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t("connection.acceptance.body")}</p>
          {summary ? (
            <div className={`mt-3 rounded-xl border p-3 text-xs ${summary.ready ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
              <div className="font-bold">
                {summary.ready ? t("connection.acceptance.summaryReady") : t("connection.acceptance.summaryNotReady")}
              </div>
              <div className="mt-1 leading-relaxed opacity-85">
                {t("connection.acceptance.summaryCounts", {
                  passed: summary.passed,
                  total: summary.total,
                  needsAction: summary.needsAction,
                  manualRequired: summary.manualRequired,
                })}
              </div>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                <div>{summary.hasLongTermEntry ? t("connection.acceptance.summaryLongTermOk") : t("connection.acceptance.summaryLongTermMissing")}</div>
                <div>{summary.hasRealWorldEvidence ? t("connection.acceptance.summaryEvidenceOk") : t("connection.acceptance.summaryEvidenceMissing")}</div>
              </div>
            </div>
          ) : null}
          <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-500/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-cyan-50">{t("connection.acceptance.smokeTitle")}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-cyan-100/75">{t("connection.acceptance.smokeBody")}</p>
              </div>
              <button
                onClick={() => handleCopyCommand("smoke", smokeCommand)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-2.5 py-1.5 text-[11px] font-bold text-cyan-50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedCommand === "smoke" ? t("connection.acceptance.commandCopied") : t("connection.acceptance.copySmokeCommand")}
              </button>
            </div>
            <code className="mt-2 block break-all rounded-lg bg-black/30 px-2 py-1.5 text-[10px] leading-relaxed text-cyan-50/90">{smokeCommand}</code>
          </div>
          <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-500/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-cyan-50">{t("connection.acceptance.commandTitle")}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-cyan-100/75">{t("connection.acceptance.commandBody")}</p>
              </div>
              <button
                onClick={() => handleCopyCommand("acceptance", acceptanceCommand)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-2.5 py-1.5 text-[11px] font-bold text-cyan-50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedCommand === "acceptance" ? t("connection.acceptance.commandCopied") : t("connection.acceptance.copyCommand")}
              </button>
            </div>
            <code className="mt-2 block break-all rounded-lg bg-black/30 px-2 py-1.5 text-[10px] leading-relaxed text-cyan-50/90">{acceptanceCommand}</code>
            <button
              onClick={onRunAcceptance}
              disabled={runningAcceptance}
              className="mt-2 inline-flex rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-2.5 py-1.5 text-[11px] font-bold text-cyan-50 disabled:opacity-50"
            >
              {runningAcceptance ? t("connection.acceptance.running") : t("connection.acceptance.runNow")}
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="text-xs font-bold text-zinc-100">{t("connection.acceptance.importTitle")}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{t("connection.acceptance.importBody")}</p>
            <textarea
              value={reportText || ""}
              onChange={(event) => onReportTextChange?.(event.target.value)}
              placeholder={t("connection.acceptance.importPlaceholder")}
              className="mt-2 min-h-20 w-full resize-y rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            <button
              onClick={onImportReport}
              disabled={!reportText?.trim() || importingReport}
              className="mt-2 inline-flex rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            >
              {importingReport ? t("connection.acceptance.importing") : t("connection.acceptance.importReport")}
            </button>
            {runbooks?.latest?.length ? (
              <div className="mt-3 space-y-2">
                <div className="text-[11px] font-bold text-zinc-200">{t("connection.acceptance.latestEvidence")}</div>
                {runbooks.latest.map((record) => (
                  <div key={record.id} className="rounded-lg border border-white/[0.08] bg-black/20 px-2 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] font-bold text-zinc-100">{record.entryKind}</div>
                      <div className={record.longTermReady ? "text-[10px] font-bold text-emerald-200" : "text-[10px] font-bold text-amber-200"}>
                        {record.longTermReady ? t("connection.acceptance.longTermReady") : t("connection.acceptance.longTermNotReady")}
                      </div>
                    </div>
                    {record.completionStatus === "automated-ready-manual-required" ? (
                      <div className="mt-1 text-[10px] font-bold text-sky-200">{t("connection.acceptance.manualStillRequired")}</div>
                    ) : null}
                    <div className="mt-1 break-all text-[10px] text-zinc-400">{record.baseUrl}</div>
                    <div className="mt-1 text-[10px] text-zinc-400">
                      {t("connection.acceptance.automatedPassed", { passed: record.automatedChecks.passed, total: record.automatedChecks.total })}
                      {" · "}
                      {new Date(record.importedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
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
                {onAccept && item.status === "manual-required" && (item.id === "restart-restore" || item.id === "cellular-mobile-chat" || item.id === "network-interruption" || item.id === "diagnostic-export") ? (
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
