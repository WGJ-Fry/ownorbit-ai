import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { ConnectionTestResult } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";

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

export default function DevicePairConnectionTestResult({ result }: { result: ConnectionTestResult }) {
  const { t } = useI18n();
  const passed = result.steps?.filter((step) => step.ok).length || 0;
  const total = result.steps?.length || 0;
  const failedSteps = result.steps?.filter((step) => !step.ok) || [];
  const repairHints = result.fixes || [];
  return (
    <div className={`mt-2 rounded-xl border p-3 text-left text-xs leading-relaxed ${result.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100" : "border-amber-400/20 bg-amber-500/10 text-amber-100"}`}>
      <div className="font-bold">
        {result.ok
          ? t("devicePair.testSuccess", { latency: result.latencyMs, url: result.url, passed, total })
          : t("devicePair.testFailure", { message: result.error || `HTTP ${result.status}`, passed, total })}
      </div>
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
