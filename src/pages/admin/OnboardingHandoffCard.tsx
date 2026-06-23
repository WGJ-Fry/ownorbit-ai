import { ClipboardCheck, MessageCircle, Network, Smartphone } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";

export default function OnboardingHandoffCard({ onCopySummary }: { onCopySummary?: () => void }) {
  const { t } = useI18n();
  const items = [
    {
      icon: <MessageCircle className="h-4 w-4" />,
      title: t("onboarding.handoffChatTitle"),
      body: t("onboarding.handoffChatBody"),
      href: "/chat",
      action: t("onboarding.startFirstChat"),
    },
    {
      icon: <Smartphone className="h-4 w-4" />,
      title: t("onboarding.handoffMobileTitle"),
      body: t("onboarding.handoffMobileBody"),
      href: "/admin/devices",
      action: t("onboarding.manageDevices"),
    },
    {
      icon: <Network className="h-4 w-4" />,
      title: t("onboarding.handoffRemoteTitle"),
      body: t("onboarding.handoffRemoteBody"),
      href: "/admin/settings#mobile-connect",
      action: t("onboarding.openConnectionGuide"),
    },
  ];

  return (
    <section className="mb-5 rounded-[28px] border border-emerald-400/20 bg-emerald-500/10 p-5">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200/80">{t("onboarding.handoffEyebrow")}</div>
      <h2 className="mt-2 text-xl font-bold text-zinc-50">{t("onboarding.handoffTitle")}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-emerald-50/80">{t("onboarding.handoffBody")}</p>
      {onCopySummary ? (
        <button
          onClick={onCopySummary}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-[#060a10]/35 px-4 py-3 text-sm font-bold text-emerald-100 transition-colors hover:bg-white/[0.06]"
        >
          <ClipboardCheck className="h-4 w-4" />
          {t("onboarding.copyHandoffSummary")}
        </button>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {items.map((item) => (
          <a key={item.title} href={item.href} className="rounded-2xl border border-white/[0.08] bg-[#060a10]/45 p-4 text-sm text-zinc-200 transition-colors hover:bg-white/[0.06]">
            <div className="flex items-center gap-2 font-bold text-zinc-50">
              <span className="text-emerald-200">{item.icon}</span>
              <span>{item.title}</span>
            </div>
            <p className="mt-2 min-h-[3.5rem] text-xs leading-relaxed text-zinc-400">{item.body}</p>
            <div className="mt-3 text-xs font-bold text-emerald-200">{item.action}</div>
          </a>
        ))}
      </div>
    </section>
  );
}
