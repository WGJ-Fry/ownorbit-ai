import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, LockKeyhole, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { getAdminStatus, getHealth, loginAdmin, resetLocalAdminPassword, setupAdmin } from "../../services/lifeosApi";
import LanguageSwitcher from "../../i18n/LanguageSwitcher";
import { useI18n } from "../../i18n/I18nProvider";

type Mode = "loading" | "setup" | "login" | "reset";
type PublicRiskItem = Awaited<ReturnType<typeof getHealth>>["publicRisk"]["items"][number];

export default function AdminLoginPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [envManaged, setEnvManaged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLoadFailed, setStatusLoadFailed] = useState(false);
  const [publicSetupRisk, setPublicSetupRisk] = useState(false);
  const [publicRiskItems, setPublicRiskItems] = useState<PublicRiskItem[]>([]);
  const onlyPasswordRisk = publicRiskItems.length > 0 && publicRiskItems.every((item) => item.id === "password");

  const loginTitle = mode === "setup" ? t("auth.setupTitle") : mode === "reset" ? t("auth.resetPasswordTitle") : t("auth.loginTitle");
  const loginDescription = mode === "setup"
    ? t("auth.setupDescription")
    : mode === "reset"
      ? t("auth.resetPasswordDescription")
      : envManaged
        ? t("auth.envDescription")
        : t("auth.loginDescription");

  const friendlyError = useCallback((message: string, code = "") => {
    if (code === "invalid_password") return t("auth.invalidPassword");
    if (code === "admin_login_locked") return t("auth.loginLocked");
    if (code === "local_reset_only") return t("auth.localResetOnly");
    if (code === "env_managed_password") return t("auth.envManagedResetBlocked");
    if (code === "weak_password") return t("auth.passwordWeak");
    if (code === "admin_setup_required") return t("auth.setupRequired");
    if (/Invalid password/i.test(message)) return t("auth.invalidPassword");
    if (/temporarily locked/i.test(message)) return t("auth.loginLocked");
    if (/only available on this computer/i.test(message)) return t("auth.localResetOnly");
    if (/managed by LIFEOS_ADMIN_PASSWORD/i.test(message)) return t("auth.envManagedResetBlocked");
    if (/at least 12 characters/i.test(message)) return t("auth.passwordMin");
    if (/too common|repeated characters|keyboard|number sequences|too weak|include at least two/i.test(message)) return t("auth.passwordWeak");
    return message || t("auth.failed");
  }, [t]);

  const loadStatus = useCallback(async () => {
    setMode("loading");
    setStatusLoadFailed(false);
    setError(null);
    try {
      const status = await Promise.all([
        getAdminStatus({ timeoutMs: 5000 }),
        getHealth({ timeoutMs: 5000 }).catch(() => null),
      ]);
      const [adminStatus, health] = status;
      setEnvManaged(adminStatus.envManaged);
      setPublicSetupRisk(Boolean(health?.publicSetupRisk));
      setPublicRiskItems(health?.publicRisk?.items || []);
      if (adminStatus.authenticated) {
        window.location.href = adminStatus.nextPath || "/chat";
        return;
      }
      setMode(adminStatus.configured ? "login" : "setup");
    } catch {
      setStatusLoadFailed(true);
      setMode("login");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSubmit = async () => {
    setError(null);
    if ((mode === "setup" || mode === "reset") && password.length < 12) {
      setError(t("auth.passwordMin"));
      return;
    }
    if ((mode === "setup" || mode === "reset") && password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "setup") {
        const session = await setupAdmin(password);
        window.location.href = session.nextPath || "/admin/onboarding";
      } else if (mode === "reset") {
        const session = await resetLocalAdminPassword(password);
        window.location.href = session.onboardingRequired ? (session.nextPath || "/admin/onboarding") : (session.nextPath || "/chat");
      } else {
        const session = await loginAdmin(password);
        window.location.href = onlyPasswordRisk
          ? "/admin/settings#admin-password-strength"
          : session.onboardingRequired ? (session.nextPath || "/admin/onboarding") : (session.nextPath || "/chat");
      }
    } catch (err: any) {
      setError(friendlyError(err.message || "", err.code || ""));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060a10] text-zinc-100 flex items-center justify-center p-5">
      <div className="w-full max-w-sm rounded-[28px] border border-white/[0.08] bg-[#101722] p-6 shadow-2xl">
        <div className="mb-4 flex justify-end">
          <LanguageSwitcher compact />
        </div>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10">
          {mode === "loading" ? <Loader2 className="h-5 w-5 animate-spin text-cyan-300" /> : <ShieldCheck className="h-5 w-5 text-cyan-300" />}
        </div>

        <h1 className="text-xl font-bold">{loginTitle}</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{loginDescription}</p>

        {publicSetupRisk ? (
          <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100">
            <div className="mb-1 flex items-center gap-2 font-bold text-amber-50">
              <AlertTriangle className="h-4 w-4" />
              {mode === "setup" ? t("auth.strongPasswordTitle") : onlyPasswordRisk ? t("auth.updatePasswordTitle") : t("auth.publicSetupTitle")}
            </div>
            {mode === "setup" ? t("auth.strongPasswordBody") : onlyPasswordRisk ? t("auth.updatePasswordBody") : t("auth.publicSetupBody")}
            {!onlyPasswordRisk && publicRiskItems.length ? (
              <div className="mt-3 space-y-2">
                {publicRiskItems.slice(0, 4).map((item) => (
                  <div key={item.id} className="rounded-xl border border-red-100/10 bg-black/15 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-red-50">{item.label}</div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.status === "critical" ? "bg-red-400/15 text-red-50" : "bg-amber-400/15 text-amber-100"}`}>
                        {item.status === "critical" ? t("auth.mustFix") : t("auth.shouldFix")}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-red-100/75">{item.message}</div>
                    <div className="mt-1 text-xs text-red-100/55">{item.action}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {error && <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>}
        {statusLoadFailed ? (
          <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100">
            <div className="font-bold text-amber-50">{t("auth.statusCheckTitle")}</div>
            <div className="mt-1 text-amber-100/80">{t("auth.statusCheckBody")}</div>
            <button
              type="button"
              onClick={() => void loadStatus()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-amber-100/20 bg-black/15 px-3 py-2 text-xs font-bold text-amber-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("auth.retryStatusCheck")}
            </button>
          </div>
        ) : null}

        {mode !== "loading" && (
          <div className="mt-6 space-y-3">
            {mode === "setup" ? (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-xs leading-relaxed text-zinc-400">
                <div className="mb-2 font-bold text-zinc-200">{t("auth.firstRunGuide")}</div>
                <div>{t("auth.firstRunStep1")}</div>
                <div>{t("auth.firstRunStep2")}</div>
                <div>{t("auth.firstRunStep3")}</div>
              </div>
            ) : null}
            <label htmlFor="admin-password" className="block text-xs font-bold uppercase tracking-wider text-zinc-500">{t("common.password")}</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSubmit();
              }}
              className="w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60"
              autoFocus
            />

            {(mode === "setup" || mode === "reset") && (
              <>
                <label htmlFor="admin-confirm-password" className="block text-xs font-bold uppercase tracking-wider text-zinc-500">{t("common.confirmPassword")}</label>
                <input
                  id="admin-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleSubmit();
                  }}
                  className="w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-4 py-3 text-sm outline-none focus:border-cyan-400/60"
                />
              </>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-bold text-[#061016] disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              {mode === "setup" ? t("auth.finishSetup") : mode === "reset" ? t("auth.resetPasswordSubmit") : t("auth.enterConsole")}
            </button>
            {mode === "login" && !envManaged ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPassword("");
                  setConfirmPassword("");
                  setMode("reset");
                }}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 text-sm font-bold text-zinc-300 hover:bg-white/[0.06]"
              >
                {t("auth.forgotPassword")}
              </button>
            ) : null}
            {mode === "reset" ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setPassword("");
                  setConfirmPassword("");
                  setMode("login");
                }}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 text-sm font-bold text-zinc-300 hover:bg-white/[0.06]"
              >
                {t("common.back")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
