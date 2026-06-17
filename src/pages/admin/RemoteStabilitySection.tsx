import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { recordRemoteAcceptance } from "../../services/lifeosApi";
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
  const handleRecordAcceptance = async (id: NetworkDiagnostics["remoteAcceptanceChecklist"][number]["id"]) => {
    setAcceptingId(id);
    try {
      const note = id === "cellular-mobile-chat"
        ? "Phone Wi-Fi disabled; /mobile/chat opened through the saved HTTPS entry; chat and realtime state confirmed."
        : "Desktop app restarted; saved HTTPS entry restored; remote health confirmed after restart.";
      const result = await recordRemoteAcceptance(id, note);
      onDiagnostics?.(result.diagnostics);
      onStatus?.(t("connection.acceptance.recorded"));
    } catch (error: any) {
      onStatus?.(error.message || t("connection.acceptance.recordFailed"));
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <>
      <RemoteHealthSummaryCard summary={diagnostics.remoteHealthSummary} />
      <RemoteAcceptanceChecklistCard acceptingId={acceptingId} checklist={diagnostics.remoteAcceptanceChecklist || []} onAccept={handleRecordAcceptance} />
    </>
  );
}
