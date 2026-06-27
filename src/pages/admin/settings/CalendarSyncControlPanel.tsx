import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { executeCalendarSyncOperation, getCalendarSyncPreview, previewCalendarSync } from "../../../services/lifeosApi";
import type { CalendarSyncExecuteInput, CalendarSyncPreview } from "../../../services/lifeosApi";
import { useI18n } from "../../../i18n/I18nProvider";

type WritableProvider = NonNullable<CalendarSyncExecuteInput["providerId"]>;
type WritableKind = NonNullable<CalendarSyncExecuteInput["kind"]>;
type WritableAction = NonNullable<CalendarSyncExecuteInput["action"]>;

const confirmationPhrase = "WRITE TO EXTERNAL CALENDAR";
const providerIds: WritableProvider[] = ["apple-calendar", "google-calendar", "system-reminders"];
const kindIds: WritableKind[] = ["event", "task"];
const actionIds: WritableAction[] = ["create", "update", "complete", "delete"];

export default function CalendarSyncControlPanel({
  initialPreview,
  onChanged,
}: {
  initialPreview: CalendarSyncPreview;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState(initialPreview);
  const [providerId, setProviderId] = useState<WritableProvider>("google-calendar");
  const [kind, setKind] = useState<WritableKind>("event");
  const [action, setAction] = useState<WritableAction>("create");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [externalId, setExternalId] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => setPreview(initialPreview), [initialPreview]);

  const proposedItem = useMemo(() => ({
    providerId,
    kind,
    action,
    title: title.trim() || t("calendarSyncControl.untitled"),
    startsAt: startsAt || undefined,
    dueAt: dueAt || undefined,
    externalId: externalId.trim() || undefined,
    source: "admin-settings-calendar-sync",
  }), [action, dueAt, externalId, kind, providerId, startsAt, title, t]);

  const selectedProvider = preview.providers.find((provider) => provider.id === providerId);
  const canExecute = Boolean(preview.writeBackSupported && selectedProvider?.writeSupported && confirmationText === confirmationPhrase && title.trim());

  const refreshPreview = async () => {
    setBusy("preview");
    setStatus(null);
    try {
      const result = await previewCalendarSync([proposedItem]);
      setPreview(result);
      setStatus(t("calendarSyncControl.previewReady"));
    } catch (error: any) {
      setStatus(error.message || t("calendarSyncControl.previewFailed"));
    } finally {
      setBusy(null);
    }
  };

  const refreshCurrent = async () => {
    setBusy("refresh");
    setStatus(null);
    try {
      const result = await getCalendarSyncPreview();
      setPreview(result);
      setStatus(t("calendarSyncControl.refreshed"));
    } catch (error: any) {
      setStatus(error.message || t("calendarSyncControl.previewFailed"));
    } finally {
      setBusy(null);
    }
  };

  const executeSelected = async () => {
    setBusy("execute");
    setStatus(null);
    try {
      const result = await executeCalendarSyncOperation({
        providerId,
        kind,
        action,
        title: title.trim(),
        startsAt: startsAt || undefined,
        dueAt: dueAt || undefined,
        notes: notes.trim() || undefined,
        externalId: externalId.trim() || undefined,
        explicitConsent: true,
        confirmationText,
        source: "admin-settings-calendar-sync",
      });
      setStatus(t("calendarSyncControl.executed", { id: result.externalId || "-" }));
      await refreshPreview();
      await onChanged();
    } catch (error: any) {
      setStatus(error.message || t("calendarSyncControl.executeFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6 rounded-[28px] border border-white/[0.08] bg-[#101722] p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-bold">
            <CalendarClock className="h-4 w-4 text-cyan-300" />
            {t("calendarSyncControl.title")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t("calendarSyncControl.body")}</p>
        </div>
        <button
          type="button"
          onClick={refreshCurrent}
          disabled={Boolean(busy)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-bold disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("calendarSyncControl.refresh")}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {providerIds.map((id) => {
          const provider = preview.providers.find((candidate) => candidate.id === id);
          return (
            <div key={id} className="rounded-2xl border border-white/[0.06] bg-[#060a10] p-3 text-xs">
              <div className="font-bold text-zinc-200">{t(`calendarSyncControl.provider.${id}` as any)}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-zinc-400">
                <span>{t("calendarSyncControl.read")}</span>
                <span className={provider?.readSupported ? "text-emerald-200" : "text-amber-200"}>{provider?.readSupported ? "OK" : "-"}</span>
                <span>{t("calendarSyncControl.write")}</span>
                <span className={provider?.writeSupported ? "text-emerald-200" : "text-amber-200"}>{provider?.writeSupported ? "OK" : "-"}</span>
              </div>
              <div className="mt-2 text-[11px] text-zinc-500">{provider?.recommendations[0] || "-"}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-xs font-bold text-zinc-300">
          {t("calendarSyncControl.provider")}
          <select value={providerId} onChange={(event) => setProviderId(event.target.value as WritableProvider)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm">
            {providerIds.map((id) => <option key={id} value={id}>{t(`calendarSyncControl.provider.${id}` as any)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("calendarSyncControl.kind")}
          <select value={kind} onChange={(event) => setKind(event.target.value as WritableKind)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm">
            {kindIds.map((id) => <option key={id} value={id}>{t(`calendarSyncControl.kind.${id}` as any)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("calendarSyncControl.action")}
          <select value={action} onChange={(event) => setAction(event.target.value as WritableAction)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm">
            {actionIds.map((id) => <option key={id} value={id}>{t(`calendarSyncControl.action.${id}` as any)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("calendarSyncControl.externalId")}
          <input value={externalId} onChange={(event) => setExternalId(event.target.value)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-xs font-bold text-zinc-300 md:col-span-3">
          {t("calendarSyncControl.itemTitle")}
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("calendarSyncControl.startsAt")}
          <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("calendarSyncControl.dueAt")}
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300">
          {t("calendarSyncControl.confirmation")}
          <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder={confirmationPhrase} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-bold text-zinc-300 md:col-span-3">
          {t("calendarSyncControl.notes")}
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-white/[0.08] bg-[#060a10] px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={refreshPreview} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-100 disabled:opacity-50">
          <ShieldCheck className="h-4 w-4" />
          {t("calendarSyncControl.preview")}
        </button>
        <button type="button" onClick={executeSelected} disabled={Boolean(busy) || !canExecute} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-100 disabled:opacity-40">
          <Play className="h-4 w-4" />
          {t("calendarSyncControl.execute")}
        </button>
        <span className="text-xs text-zinc-500">{t("calendarSyncControl.confirmHint")}</span>
      </div>

      {status ? <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs text-zinc-300">{status}</div> : null}

      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-[#060a10] p-3 text-xs">
        <div className="mb-2 flex flex-wrap items-center gap-2 font-bold">
          {t("calendarSyncControl.syncPlan")}
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-400">
            {t("calendarSyncControl.planStats", {
              pull: preview.syncPlan.pullExternal,
              push: preview.syncPlan.pushLocal,
              conflicts: preview.syncPlan.reviewConflicts,
              blocked: preview.syncPlan.blocked,
            })}
          </span>
        </div>
        <div className="space-y-2">
          {preview.syncPlan.items.slice(0, 5).map((item) => (
            <div key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-zinc-200">{item.title}</span>
                <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-zinc-400">{t(`calendarSyncControl.direction.${item.direction}` as any)}</span>
              </div>
              <div className="mt-1 text-zinc-500">{item.reason}</div>
            </div>
          ))}
          {preview.syncPlan.items.length === 0 ? <div className="text-zinc-500">{t("calendarSyncControl.noPlanItems")}</div> : null}
        </div>
      </div>
    </section>
  );
}
