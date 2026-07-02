import { ArrowRight, CheckCircle2, KeyRound, QrCode, Sparkles } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  aiConfigured: boolean;
  hasBackup: boolean;
  hasDevice: boolean;
  remoteReady: boolean;
};

function stepTone(done: boolean, active: boolean) {
  if (done) return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  if (active) return "border-cyan-400/30 bg-cyan-500/10 text-cyan-100";
  return "border-white/[0.08] bg-white/[0.03] text-zinc-300";
}

export default function OnboardingQuickStartCard({ aiConfigured, hasBackup, hasDevice, remoteReady }: Props) {
  const { t } = useI18n();
  const primaryHref = !aiConfigured ? "#onboarding-ai-key" : !hasDevice ? "/admin/devices/pair" : "/chat";
  const primaryLabel = !aiConfigured
    ? t("onboarding.quickPrimaryAi")
    : !hasDevice
      ? t("onboarding.quickPrimaryQr")
      : t("onboarding.quickPrimaryChat");
  const primaryIcon = !aiConfigured ? <KeyRound className="h-4 w-4" /> : !hasDevice ? <QrCode className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />;

  const steps = [
    {
      key: "ai",
      done: aiConfigured,
      active: !aiConfigured,
      title: t("onboarding.quickStepAi"),
      body: t("onboarding.quickStepAiBody"),
    },
    {
      key: "qr",
      done: hasDevice,
      active: aiConfigured && !hasDevice,
      title: t("onboarding.quickStepQr"),
      body: t("onboarding.quickStepQrBody"),
    },
    {
      key: "chat",
      done: aiConfigured && hasDevice,
      active: aiConfigured && hasDevice,
      title: t("onboarding.quickStepChat"),
      body: t("onboarding.quickStepChatBody"),
    },
  ];

  return (
    <section className="mb-5 rounded-[28px] border border-cyan-400/20 bg-cyan-500/10 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-[#060a10]/45 px-3 py-1 text-xs font-bold text-cyan-100">
            <Sparkles className="h-3.5 w-3.5" />
            {t("onboarding.quickEyebrow")}
          </div>
          <h2 className="mt-3 text-2xl font-bold text-white">{t("onboarding.quickTitle")}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-cyan-50/80">{t("onboarding.quickBody")}</p>
        </div>
        <a
          href={primaryHref}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#061016]"
        >
          {primaryIcon}
          {primaryLabel}
        </a>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {steps.map((step) => (
          <div key={step.key} className={`min-h-[118px] rounded-2xl border p-4 ${stepTone(step.done, step.active)}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold">{step.title}</div>
              {step.done ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : null}
            </div>
            <div className="mt-2 text-xs leading-relaxed opacity-80">{step.body}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl border border-white/[0.08] bg-[#060a10]/35 p-4 text-xs leading-relaxed text-cyan-50/75 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="font-bold text-cyan-50">{t("onboarding.quickAdvancedTitle")}</div>
          <div className="mt-1">{t("onboarding.quickAdvancedBody", { backup: hasBackup ? t("common.ok") : t("common.warning"), remote: remoteReady ? t("common.ok") : t("common.warning") })}</div>
        </div>
        <a href="/admin/settings" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-3 text-sm font-bold text-zinc-100">
          {t("onboarding.quickAdvancedAction")}
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}
