import { ArrowRight, CheckCircle2, Smartphone } from "lucide-react";
import type { BoundDevice, ConfigDiagnostics, NetworkDiagnostics } from "../../services/lifeosApi";
import { useI18n } from "../../i18n/I18nProvider";
import type { TranslationKey } from "../../i18n/translations";

const readinessStatusKeys: Record<NetworkDiagnostics["remoteReadiness"]["status"], TranslationKey> = {
  ready: "connection.readiness.status.ready",
  "needs-restart": "connection.readiness.status.needsRestart",
  temporary: "connection.readiness.status.temporary",
  "local-only": "connection.readiness.status.localOnly",
  "lan-only": "connection.readiness.status.lanOnly",
  blocked: "connection.readiness.status.blocked",
};

const readinessActionKeys: Record<NetworkDiagnostics["remoteReadiness"]["actions"][number]["id"], TranslationKey> = {
  noRemoteEntry: "connection.readiness.item.noRemoteEntry",
  localOnly: "connection.readiness.item.localOnly",
  lanOnly: "connection.readiness.item.lanOnly",
  needsHttps: "connection.readiness.item.needsHttps",
  needsPublicOptIn: "connection.readiness.item.needsPublicOptIn",
  needsRestart: "connection.readiness.item.needsRestart",
  temporaryTunnel: "connection.readiness.item.temporaryTunnel",
  ready: "connection.readiness.item.ready",
};

type Props = {
  devices: BoundDevice[];
  diagnostics: (Partial<ConfigDiagnostics["network"]> & Partial<Pick<NetworkDiagnostics, "connectionCandidates" | "recommendedBaseUrl" | "remoteReadiness">>) | null | undefined;
  done: boolean;
};

export default function OnboardingMobileCard({ devices, diagnostics, done }: Props) {
  const { t } = useI18n();
  const activeDeviceCount = devices.filter((device) => device.status !== "revoked").length;
  const readiness = diagnostics?.remoteReadiness;
  const connectionCandidates = diagnostics?.connectionCandidates || [];
  const candidate = readiness?.candidateId
    ? connectionCandidates.find((item) => item.id === readiness.candidateId)
    : connectionCandidates.find((item) => item.mode !== "local");
  const remoteUrl = candidate?.mobileChatUrl || candidate?.baseUrl || readiness?.baseUrl || diagnostics?.recommendedBaseUrl || "";
  const readinessTone = readiness?.severity === "ok" ? "text-emerald-200" : readiness?.severity === "danger" ? "text-red-200" : "text-amber-200";

  return (
    <section className="rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300">
            <Smartphone className="h-5 w-5" />
          </div>
          <h2 className="font-bold">{t("onboarding.mobileTitle")}</h2>
        </div>
        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : null}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        {t("onboarding.mobileDescription")}
      </p>
      <div className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs leading-relaxed text-zinc-400">
        <div>{t("onboarding.boundDevices", { count: activeDeviceCount })}</div>
        <div className="mt-2">{done ? t("onboarding.mobileReady") : t("onboarding.mobileTodo")}</div>
        <div className="mt-2">{t("onboarding.remoteHint")}</div>
      </div>
      <div className="mt-3 rounded-2xl border border-cyan-400/15 bg-cyan-500/10 p-4 text-xs leading-relaxed text-cyan-50/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-cyan-50">{t("onboarding.remoteReadinessTitle")}</div>
          <span className={`rounded-full bg-[#060a10]/55 px-2 py-0.5 text-[10px] font-bold ${readinessTone}`}>
            {readiness ? t(readinessStatusKeys[readiness.status]) : t("connection.readiness.status.localOnly")}
          </span>
        </div>
        <div className="mt-2 break-all font-mono text-[11px] text-cyan-100/75">
          {remoteUrl || t("connection.readiness.noAddress")}
        </div>
        {readiness?.actions?.length ? (
          <div className="mt-3 space-y-1 border-t border-cyan-200/10 pt-3">
            {readiness.actions.slice(0, 2).map((action) => (
              <div key={`${action.id}-${action.detail || ""}`}>
                {t(readinessActionKeys[action.id], { value: action.detail || remoteUrl || "-" })}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 border-t border-cyan-200/10 pt-3">{t("onboarding.remoteReadinessFallback")}</div>
        )}
      </div>
      <div className="mt-5 grid gap-3">
        <a
          href="/admin/devices/pair"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-200"
        >
          <Smartphone className="h-4 w-4" />
          {t("onboarding.openPairing")}
        </a>
        <a
          href="/admin/settings#mobile-connect"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-bold text-zinc-200"
        >
          <ArrowRight className="h-4 w-4" />
          {t("onboarding.openConnectionGuide")}
        </a>
      </div>
    </section>
  );
}
