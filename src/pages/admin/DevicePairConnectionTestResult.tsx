import { AlertTriangle, CheckCircle2, Copy, XCircle } from "lucide-react";
import { useState } from "react";
import type { ConnectionTestResult } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

const stepKey = {
  health: "devicePair.testStep.health",
  "mobile-shell": "devicePair.testStep.mobileShell",
  websocket: "devicePair.testStep.websocket",
} as const;

const stepFixKey = {
  health: "devicePair.testFix.health",
  "mobile-shell": "devicePair.testFix.mobileShell",
  websocket: "devicePair.testFix.websocket",
} as const;

const repairHintKey = {
  "desktop-service-unreachable": "devicePair.repair.desktopServiceUnreachable",
  "wrong-lifeos-target": "devicePair.repair.wrongLifeosTarget",
  "mobile-shell-missing": "devicePair.repair.mobileShellMissing",
  "websocket-upgrade-blocked": "devicePair.repair.websocketUpgradeBlocked",
  "localhost-phone-unreachable": "devicePair.repair.localhostPhoneUnreachable",
  "https-required": "devicePair.repair.httpsRequired",
  "public-mode-risk": "devicePair.repair.publicModeRisk",
} as const;

function buildRepairPacket(result: ConnectionTestResult, translate: (key: TranslationKey) => string) {
  const passed = result.steps?.filter((step) => step.ok).length || 0;
  const total = result.steps?.length || 0;
  const lines = [
    "OwnOrbit AI mobile pairing connection repair packet",
    `URL: ${result.url}`,
    `Result: ${result.ok ? "PASS" : "FAIL"} (${passed}/${total})`,
    `Latency: ${result.latencyMs}ms`,
    result.httpsStatus ? `HTTPS: ${result.httpsStatus.ok ? "OK" : result.httpsStatus.error || "Needs trusted HTTPS"}` : "",
    result.error ? `Error: ${result.error}` : "",
    "",
    "Checks:",
    ...(result.steps || []).map((step) => {
      const label = translate(stepKey[step.id]);
      const status = step.ok ? "PASS" : "FAIL";
      const detail = step.ok ? `${step.latencyMs}ms` : step.error || `HTTP ${step.status}`;
      return `- ${label}: ${status} - ${detail} - ${step.url}`;
    }),
  ].filter(Boolean);
  if (result.fixes?.length) {
    lines.push("", "Fix these in order:");
    for (const hint of result.fixes) lines.push(`- ${translate(repairHintKey[hint.id])}`);
  }
  if (!result.httpsStatus?.ok) lines.push(`- ${translate("devicePair.testFix.https")}`);
  return lines.join("\n");
}

export default function DevicePairConnectionTestResult({ result }: { result: ConnectionTestResult }) {
  const { t } = useI18n();
  const [copiedRepairPacket, setCopiedRepairPacket] = useState(false);
  const passed = result.steps?.filter((step) => step.ok).length || 0;
  const total = result.steps?.length || 0;
  const failedSteps = result.steps?.filter((step) => !step.ok) || [];
  const repairHints = result.fixes || [];
  const hasActionableRepair = !result.ok || repairHints.length > 0 || !result.httpsStatus?.ok;
  return (
    <div className={`mt-2 rounded-xl border p-3 text-left text-xs leading-relaxed ${result.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
      <div className="font-bold">
        {result.ok
          ? t("devicePair.testSuccess", { latency: result.latencyMs, url: result.url, passed, total })
          : t("devicePair.testFailure", { message: result.error || `HTTP ${result.status}`, passed, total })}
      </div>
      {hasActionableRepair ? (
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(buildRepairPacket(result, t)).catch(() => null);
            setCopiedRepairPacket(true);
            window.setTimeout(() => setCopiedRepairPacket(false), 1400);
          }}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.10] bg-black/15 px-3 py-2 text-xs font-bold text-zinc-50 hover:bg-black/25"
        >
          <Copy className="h-3.5 w-3.5" />
          {copiedRepairPacket ? t("devicePair.repairPacketCopied") : t("devicePair.copyRepairPacket")}
        </button>
      ) : null}
      <div className="mt-2 space-y-2">
        {(result.steps || []).map((step) => (
          <div key={step.id} className="rounded-lg border border-white/[0.08] bg-black/10 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-zinc-100">{t(stepKey[step.id])}</span>
              <span className={`inline-flex items-center gap-1 font-bold ${step.ok ? "text-emerald-200" : "text-amber-100"}`}>
                {step.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {step.ok ? t("devicePair.testStep.pass") : t("devicePair.testStep.fail")}
              </span>
            </div>
            <div className="mt-1 break-all font-mono text-[10px] opacity-70">{step.url}</div>
            <div className="mt-1 opacity-80">
              {step.ok ? t("devicePair.testStep.latency", { latency: step.latencyMs }) : step.error || `HTTP ${step.status}`}
            </div>
            {!step.ok && repairHints.length === 0 ? <div className="mt-1 text-amber-50/90">{t(stepFixKey[step.id])}</div> : null}
          </div>
        ))}
      </div>
      {repairHints.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-300/20 bg-amber-400/10 p-2 text-amber-50">
          <div className="mb-1 inline-flex items-center gap-1 font-bold">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("devicePair.repair.title")}
          </div>
          <div className="space-y-1">
            {repairHints.map((hint) => (
              <div key={`${hint.id}-${hint.stepId || "global"}`} className={hint.severity === "danger" ? "text-rose-50" : "text-amber-50/90"}>
                {t(repairHintKey[hint.id])}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {failedSteps.length === 0 && !result.ok ? (
        <div className="mt-2 rounded-lg border border-amber-300/20 bg-amber-400/10 p-2 text-amber-50">
          {t("devicePair.testFix.generic")}
        </div>
      ) : null}
      {!result.httpsStatus?.ok ? (
        <div className="mt-2 rounded-lg border border-amber-300/20 bg-amber-400/10 p-2 text-amber-50">
          <div>{result.httpsStatus?.error || t("devicePair.testHttpsWarning")}</div>
          <div className="mt-1 text-amber-50/90">{t("devicePair.testFix.https")}</div>
        </div>
      ) : null}
    </div>
  );
}
