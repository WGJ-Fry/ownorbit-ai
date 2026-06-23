import { CheckCircle2, Copy, PlugZap, QrCode } from "lucide-react";
import type { NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import NoPhoneReachableNotice from "./NoPhoneReachableNotice";

type ConnectionCandidate = NetworkDiagnostics["connectionCandidates"][number];

type ConnectionRecommendedEntryCardProps = {
  baseUrl: string;
  copied: string | null;
  diagnostics: NetworkDiagnostics;
  mobileChatUrl: string;
  recommendedCandidate: ConnectionCandidate | null;
  remoteHealthBusy: boolean;
  savingCandidate: string | null;
  testingCandidate: string | null;
  onCopyText: (label: string, value: string) => void;
  onRemoteHealthCheck: () => void;
  onSaveCandidate: (candidate: ConnectionCandidate) => void;
  onTestCandidate: (candidateId: string, candidateBaseUrl: string, persist?: boolean, label?: string) => void;
};

export default function ConnectionRecommendedEntryCard({
  baseUrl,
  copied,
  diagnostics,
  mobileChatUrl,
  recommendedCandidate,
  remoteHealthBusy,
  savingCandidate,
  testingCandidate,
  onCopyText,
  onRemoteHealthCheck,
  onSaveCandidate,
  onTestCandidate,
}: ConnectionRecommendedEntryCardProps) {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-cyan-100">
            <CheckCircle2 className="h-4 w-4" />
            {t("connection.recommendedAddress")}
          </div>
          <div className="mt-2 font-mono text-sm text-cyan-50">{recommendedCandidate?.baseUrl || baseUrl}</div>
          <div className="mt-2 text-xs leading-relaxed text-cyan-100/75">
            {!recommendedCandidate
              ? t("connection.noPhoneReachableDescription")
              : recommendedCandidate.stability === "temporary"
              ? t("connection.temporaryRecommendedDescription")
              : recommendedCandidate.requiresRestart
              ? t("connection.restartRequiredDescription")
              : t("connection.activeDescription")}
          </div>
          {recommendedCandidate?.envTemplate ? (
            <div className="mt-3 rounded-xl border border-cyan-100/15 bg-[#061016]/45 p-3">
              <div className="mb-1 text-[11px] font-bold text-cyan-100/80">{t("connection.recommendedEnv")}</div>
              <div className="font-mono text-[11px] leading-relaxed text-cyan-50/85">{recommendedCandidate.envTemplate}</div>
              {recommendedCandidate.requiresRestart ? (
                <div className="mt-2 text-[11px] leading-relaxed text-cyan-100/60">
                  {t("connection.packageRestartHint", { instruction: recommendedCandidate.restartInstruction })}
                </div>
              ) : null}
            </div>
          ) : null}
          {diagnostics.desktopRuntimeConfig ? (
            <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-3 text-[11px] leading-relaxed text-emerald-100">
              {t("connection.savedDesktopConfig", { label: diagnostics.desktopRuntimeConfig.label, url: diagnostics.desktopRuntimeConfig.baseUrl })} <a href="/admin/devices/pair" className="font-bold text-emerald-50 underline decoration-emerald-200/50 underline-offset-4">{t("connection.openPairingQr")}</a>
            </div>
          ) : null}
          {!recommendedCandidate ? <NoPhoneReachableNotice /> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {recommendedCandidate ? (
            <button
              onClick={() => onCopyText("recommended-mobile", recommendedCandidate.mobileChatUrl || mobileChatUrl)}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/20 bg-[#061016]/45 px-3 py-2 text-xs font-bold text-cyan-50"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied === "recommended-mobile" ? t("connection.copiedMobileEntry") : t("connection.copyMobileEntry")}
            </button>
          ) : null}
          {recommendedCandidate?.envTemplate ? (
            <button
              aria-label={t("connection.copyRecommendedEnvAria")}
              onClick={() => onCopyText("recommended-env", recommendedCandidate.envTemplate)}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/20 bg-[#061016]/45 px-3 py-2 text-xs font-bold text-cyan-50"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied === "recommended-env" ? t("connection.copiedRecommendedEnv") : t("connection.copyRecommendedEnv")}
            </button>
          ) : null}
          {recommendedCandidate ? (
            <button
              onClick={() => onTestCandidate(recommendedCandidate.id, recommendedCandidate.baseUrl)}
              disabled={testingCandidate === recommendedCandidate.id}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/20 bg-[#061016]/45 px-3 py-2 text-xs font-bold text-cyan-50 disabled:opacity-50"
            >
              <PlugZap className="h-3.5 w-3.5" />
              {testingCandidate === recommendedCandidate.id ? t("connection.testing") : t("connection.testRecommended")}
            </button>
          ) : null}
          {recommendedCandidate ? (
            <button
              onClick={() => onSaveCandidate(recommendedCandidate)}
              disabled={savingCandidate === recommendedCandidate.id}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {savingCandidate === recommendedCandidate.id ? t("connection.saving") : t("connection.saveDesktopConfig")}
            </button>
          ) : null}
          <a href="/admin/devices/pair" className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100">
            <QrCode className="h-3.5 w-3.5" />
            {t("connection.openPairingQr")}
          </a>
          {diagnostics.desktopRuntimeConfig?.publicBaseUrl ? (
            <button
              onClick={() => onTestCandidate("saved-desktop-config", diagnostics.desktopRuntimeConfig!.publicBaseUrl, true, diagnostics.desktopRuntimeConfig!.label)}
              disabled={testingCandidate === "saved-desktop-config"}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 disabled:opacity-50"
            >
              <PlugZap className="h-3.5 w-3.5" />
              {testingCandidate === "saved-desktop-config" ? t("connection.testing") : t("connection.testSavedRemote")}
            </button>
          ) : null}
          <button
            onClick={onRemoteHealthCheck}
            disabled={remoteHealthBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/10 px-3 py-2 text-xs font-bold text-sky-100 disabled:opacity-50"
          >
            <PlugZap className="h-3.5 w-3.5" />
            {remoteHealthBusy ? t("connection.testing") : t("connection.runRemoteHealth")}
          </button>
        </div>
      </div>
    </div>
  );
}
