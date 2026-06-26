import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { importRemoteAcceptanceReport, recordRemoteAcceptance, runRemoteAcceptance } from "../../services/lifeosApi";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import RemoteAcceptanceChecklistCard from "./RemoteAcceptanceChecklistCard";
import RemoteHealthSummaryCard from "./RemoteHealthSummaryCard";

const emptyRemoteHealthSummary: NetworkDiagnostics["remoteHealthSummary"] = {
  status: "unchecked",
  severity: "warning",
  entryKind: "missing",
  baseUrl: "",
  lastCheckedAt: null,
  ageMs: null,
  recommendations: ["run-remote-health"],
  checks: [
    { id: "https", status: "unknown" },
    { id: "health", status: "unknown" },
    { id: "mobile-shell", status: "unknown" },
    { id: "websocket", status: "unknown" },
    { id: "qr-entry", status: "unknown" },
  ],
};

const emptyRemoteAcceptanceSummary: NetworkDiagnostics["remoteAcceptanceSummary"] = {
  ready: false,
  passed: 0,
  total: 0,
  needsAction: 0,
  manualRequired: 0,
  hasLongTermEntry: false,
  hasRealWorldEvidence: false,
  blockingItems: [],
};

const emptyRemoteAcceptanceRunbooks: NetworkDiagnostics["remoteAcceptanceRunbooks"] = {
  total: 0,
  latest: [],
};

export default function RemoteStabilitySection({
  diagnostics,
  onDiagnostics,
  onStatus,
}: {
  diagnostics: NetworkDiagnostics;
  onDiagnostics?: (diagnostics: NetworkDiagnostics) => void;
  onStatus?: (status: string) => void;
}) {
  const { t } = useI18n();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [importingReport, setImportingReport] = useState(false);
  const [runningAcceptance, setRunningAcceptance] = useState(false);
  const [reportText, setReportText] = useState("");
  const remoteHealthSummary = diagnostics.remoteHealthSummary || emptyRemoteHealthSummary;
  const remoteAcceptanceChecklist = diagnostics.remoteAcceptanceChecklist || [];
  const remoteAcceptanceSummary = diagnostics.remoteAcceptanceSummary || emptyRemoteAcceptanceSummary;
  const remoteAcceptanceRunbooks = diagnostics.remoteAcceptanceRunbooks || emptyRemoteAcceptanceRunbooks;
  const remoteCandidate = diagnostics.connectionCandidates?.find((candidate) => candidate.mode !== "local");
  const acceptanceBaseUrl = diagnostics.desktopRuntimeConfig?.publicBaseUrl
    || remoteHealthSummary.baseUrl
    || diagnostics.recommendedBaseUrl
    || remoteCandidate?.baseUrl
    || "";
  const smokeCommand = acceptanceBaseUrl
    ? `LIFEOS_REMOTE_BASE_URL="${acceptanceBaseUrl}" npm run remote:smoke`
    : `npm run remote:smoke`;
  const acceptanceCommand = acceptanceBaseUrl
    ? `LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" LIFEOS_REMOTE_BASE_URL="${acceptanceBaseUrl}" npm run remote:acceptance`
    : `LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" npm run remote:acceptance`;
  const acceptanceEvidence = (id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]) => {
    const item = remoteAcceptanceChecklist.find((entry) => entry.id === id);
    return {
      source: "admin-long-term-remote-checklist",
      requirements: [
        `Saved remote entry: ${acceptanceBaseUrl || "not configured"}`,
        item?.action || "",
        id === "cellular-mobile-chat" ? "Phone Wi-Fi disabled and /mobile/chat verified over cellular data." : "",
        id === "restart-restore" ? "Desktop app restarted and remote health passed after restore." : "",
        id === "network-switch" ? "Phone switched between Wi-Fi and cellular; /mobile/chat recovered on the same HTTPS entry." : "",
        id === "stale-qr-repair" ? "Old QR or home-screen entry was confirmed stale; fresh QR re-pair restored /mobile/chat." : "",
        id === "network-interruption" ? "Remote path interrupted, restored, and phone recovery guidance verified." : "",
        id === "diagnostic-export" ? "Diagnostic bundle exported after real-world remote checks." : "",
      ].filter(Boolean),
    };
  };
  const handleRecordAcceptance = async (id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]) => {
    setAcceptingId(id);
    try {
      const note = id === "cellular-mobile-chat"
        ? "Phone Wi-Fi disabled; /mobile/chat opened through the saved HTTPS entry; chat and realtime state confirmed."
        : id === "restart-restore"
          ? "Desktop app restarted; saved HTTPS entry restored; remote health confirmed after restart."
          : id === "network-switch"
            ? "Phone switched between Wi-Fi and cellular; /mobile/chat recovered on the same saved HTTPS entry."
            : id === "stale-qr-repair"
              ? "Old QR or stale home-screen entry failed safely; fresh QR re-pair restored /mobile/chat."
              : id === "network-interruption"
                ? "Remote path was interrupted and restored; diagnostics refreshed; phone recovery guidance and reconnect state confirmed."
                : "Admin diagnostic bundle exported after real remote acceptance checks.";
      const result = await recordRemoteAcceptance(id, note, acceptanceEvidence(id));
      onDiagnostics?.(result.diagnostics);
      onStatus?.(t("connection.acceptance.recorded"));
    } catch (error: any) {
      onStatus?.(error.message || t("connection.acceptance.recordFailed"));
    } finally {
      setAcceptingId(null);
    }
  };
  const handleImportReport = async () => {
    setImportingReport(true);
    try {
      const parsed = JSON.parse(reportText);
      const result = await importRemoteAcceptanceReport(parsed);
      setReportText("");
      onDiagnostics?.(result.diagnostics);
      onStatus?.(t("connection.acceptance.imported"));
    } catch (error: any) {
      onStatus?.(error.message || t("connection.acceptance.importFailed"));
    } finally {
      setImportingReport(false);
    }
  };
  const handleRunAcceptance = async () => {
    setRunningAcceptance(true);
    try {
      const result = await runRemoteAcceptance();
      onDiagnostics?.(result.diagnostics);
      onStatus?.(result.record.longTermReady ? t("connection.acceptance.runReady") : t("connection.acceptance.runNotReady"));
    } catch (error: any) {
      onStatus?.(error.message || t("connection.acceptance.runFailed"));
    } finally {
      setRunningAcceptance(false);
    }
  };

  return (
    <>
      <RemoteHealthSummaryCard monitor={diagnostics.remoteHealthMonitor} recovery={diagnostics.remoteRecoveryReport} summary={remoteHealthSummary} />
      <RemoteAcceptanceChecklistCard
        acceptanceCommand={acceptanceCommand}
        acceptingId={acceptingId}
        checklist={remoteAcceptanceChecklist}
        summary={remoteAcceptanceSummary}
        importingReport={importingReport}
        reportText={reportText}
        runbooks={remoteAcceptanceRunbooks}
        runningAcceptance={runningAcceptance}
        smokeCommand={smokeCommand}
        onImportReport={handleImportReport}
        onRunAcceptance={handleRunAcceptance}
        onAccept={handleRecordAcceptance}
        onReportTextChange={setReportText}
      />
    </>
  );
}
