import { useMemo, useState } from "react";
import { Play, RefreshCw, ShieldAlert, TerminalSquare } from "lucide-react";
import { createNativeAutomationPlan, executeNativeAutomation } from "../../../services/lifeosApi";
import type { NativeAutomationInput, NativeAutomationKind, NativeAutomationPlan } from "../../../services/lifeosApi";
import { useI18n } from "../../../i18n/I18nProvider";

const confirmationPhrase = "RUN NATIVE ACTION";
const kindIds: NativeAutomationKind[] = ["clipboard", "shortcut", "file", "app", "calendar", "reminder", "shell"];

function statusTone(plan: NativeAutomationPlan | null) {
  if (!plan) return "border-white/[0.08] bg-white/[0.03] text-zinc-300";
  if (plan.status === "ready") return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
  return "border-amber-400/20 bg-amber-500/10 text-amber-100";
}

export default function NativeAutomationControlPanel() {
  const { t } = useI18n();
  const [kind, setKind] = useState<NativeAutomationKind>("shortcut");
  const [title, setTitle] = useState("");
  const [shortcutName, setShortcutName] = useState("");
  const [target, setTarget] = useState("");
  const [payload, setPayload] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [plan, setPlan] = useState<NativeAutomationPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const input = useMemo<NativeAutomationInput>(() => ({
    kind,
    title: title.trim() || t("nativeAutomationControl.untitled"),
    target: target.trim() || undefined,
    shortcutName: shortcutName.trim() || undefined,
    appBundleId: kind === "app" ? target.trim() || undefined : undefined,
    payload,
    source: "admin-settings-native-automation",
    explicitConsent: true,
    confirmationText,
  }), [confirmationText, kind, payload, shortcutName, target, title, t]);

  const canExecute = Boolean(plan?.canExecute && confirmationText === confirmationPhrase);

  const refreshPlan = async () => {
    setBusy("plan");
    setStatus(null);
    try {
      const result = await createNativeAutomationPlan(input);
      setPlan(result);
      setStatus(result.canExecute ? t("nativeAutomationControl.planReady") : t("nativeAutomationControl.planBlocked"));
    } catch (error: any) {
      setStatus(error.message || t("nativeAutomationControl.planFailed"));
    } finally {
      setBusy(null);
    }
  };

  const executePlan = async () => {
    setBusy("execute");
    setStatus(null);
    try {
      const result = await executeNativeAutomation(input);
      setPlan(result.plan);
      setStatus(result.ok ? t("nativeAutomationControl.executed") : result.message || t("nativeAutomationControl.blocked"));
    } catch (error: any) {
      setStatus(error.message || t("nativeAutomationControl.executeFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-bold">
            <TerminalSquare className="h-4 w-4 text-cyan-300" />
            {t("nativeAutomationControl.title")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t("nativeAutomationControl.body")}</p>
        </div>
        <span className="rounded-full border border-amber-300/15 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-100">
          {t("nativeAutomationControl.confirmHint")}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-bold text-zinc-300">
          {t("nativeAutomationControl.kind")}
          <select value={kind} onChange={(event) => setKind(event.target.value as NativeAutomationKind)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm">
            {kindIds.map((id) => <option key={id} value={id}>{t(`nativeAutomationControl.kind.${id}` as any)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("nativeAutomationControl.shortcutName")}
          <input value={shortcutName} onChange={(event) => setShortcutName(event.target.value)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("nativeAutomationControl.confirmation")}
          <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder={confirmationPhrase} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("nativeAutomationControl.itemTitle")}
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300 md:col-span-2">
          {t("nativeAutomationControl.target")}
          <input value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300 md:col-span-3">
          {t("nativeAutomationControl.payload")}
          <textarea value={payload} onChange={(event) => setPayload(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={refreshPlan} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-100 disabled:opacity-50">
          <RefreshCw className="h-4 w-4" />
          {t("nativeAutomationControl.plan")}
        </button>
        <button type="button" onClick={executePlan} disabled={Boolean(busy) || !canExecute} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-100 disabled:opacity-40">
          <Play className="h-4 w-4" />
          {t("nativeAutomationControl.execute")}
        </button>
      </div>

      {status ? <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs text-zinc-300">{status}</div> : null}

      <div className={`mt-4 rounded-2xl border p-4 text-xs ${statusTone(plan)}`}>
        <div className="flex items-center gap-2 font-bold">
          <ShieldAlert className="h-4 w-4" />
          {plan ? t("nativeAutomationControl.planStatus", { status: plan.status, mode: plan.mode }) : t("nativeAutomationControl.noPlan")}
        </div>
        {plan ? (
          <>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <div><span className="opacity-70">{t("nativeAutomationControl.actionId")}</span><div className="mt-1 break-all font-semibold">{plan.actionId}</div></div>
              <div><span className="opacity-70">{t("nativeAutomationControl.risk")}</span><div className="mt-1 font-semibold">{plan.risk}</div></div>
              <div><span className="opacity-70">{t("nativeAutomationControl.command")}</span><div className="mt-1 break-all font-mono">{plan.commandPreview.join(" ") || "-"}</div></div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border border-current/15 bg-black/10 p-3">
                <div className="font-bold">{t("nativeAutomationControl.safety")}</div>
                <div className="mt-2 space-y-1 opacity-80">
                  <div>{t("nativeAutomationControl.bridge")}: {plan.safety.bridgeEnabled ? "OK" : "-"}</div>
                  <div>{t("nativeAutomationControl.allowlist")}: {plan.safety.allowlisted ? "OK" : "-"}</div>
                  <div>{t("nativeAutomationControl.fileRoots")}: {plan.kind !== "file" || plan.safety.targetWithinAllowedRoots ? "OK" : "-"}</div>
                  <div>{t("nativeAutomationControl.platform")}: {plan.safety.platformSupported ? "OK" : "-"}</div>
                  <div>{t("nativeAutomationControl.audit")}: {plan.safety.auditRequired ? "OK" : "-"}</div>
                </div>
              </div>
              <div className="rounded-xl border border-current/15 bg-black/10 p-3">
                <div className="font-bold">{t("nativeAutomationControl.blockedReasons")}</div>
                <div className="mt-2 space-y-1 opacity-80">
                  {plan.blockedReasons.length ? plan.blockedReasons.map((reason) => <div key={reason}>{reason}</div>) : <div>{t("nativeAutomationControl.none")}</div>}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-2 opacity-75">{t("nativeAutomationControl.noPlanBody")}</p>
        )}
      </div>
    </section>
  );
}
