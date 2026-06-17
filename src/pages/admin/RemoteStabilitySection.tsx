import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { importRemoteAcceptanceReport, recordRemoteAcceptance, runRemoteAcceptance } from "../../services/lifeosApi";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import RemoteAcceptanceChecklistCard from "./RemoteAcceptanceChecklistCard";
import RemoteHealthSummaryCard from "./RemoteHealthSummaryCard";

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
  const acceptanceBaseUrl = diagnostics.desktopRuntimeConfig?.publicBaseUrl || diagnostics.remoteHealthSummary.baseUrl;
  const smokeCommand = acceptanceBaseUrl
    ? `LIFEOS_REMOTE_BASE_URL="${acceptanceBaseUrl}" npm run remote:smoke`
    : `npm run remote:smoke`;
  const acceptanceCommand = acceptanceBaseUrl
    ? `LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" LIFEOS_REMOTE_BASE_URL="${acceptanceBaseUrl}" npm run remote:acceptance`
    : `LIFEOS_REMOTE_ACCEPTANCE_OUT="./remote-acceptance.json" npm run remote:acceptance`;
  const acceptanceEvidence = (id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]) => {
    const item = diagnostics.remoteAcceptanceChecklist.find((entry) => entry.id === id);
    return {
      source: "admin-long-term-remote-checklist",
      requirements: [
        `Saved remote entry: ${acceptanceBaseUrl || "not configured"}`,
        item?.action || "",
        id === "cellular-mobile-chat" ? "Phone Wi-Fi disabled and /mobile/chat verified over cellular data." : "",
        id === "restart-restore" ? "Desktop app restarted and remote health passed after restore." : "",
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
      <RemoteHealthSummaryCard recovery={diagnostics.remoteRecoveryReport} summary={diagnostics.remoteHealthSummary} />
      <RemoteAcceptanceChecklistCard
        acceptanceCommand={acceptanceCommand}
        acceptingId={acceptingId}
        checklist={diagnostics.remoteAcceptanceChecklist || []}
        importingReport={importingReport}
        reportText={reportText}
        runbooks={diagnostics.remoteAcceptanceRunbooks}
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
