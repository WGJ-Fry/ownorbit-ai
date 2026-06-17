import { CheckCircle2, Play, Save } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { generateCloudflareNamedTunnelConfig, startCloudflareNamedTunnel, type NetworkDiagnostics } from "../../services/lifeosApi";

export default function CloudflareNamedTunnelCard({
  namedTunnel,
  onUpdate,
}: {
  namedTunnel: NetworkDiagnostics["cloudflareNamedTunnel"];
  onUpdate: (diagnostics: NetworkDiagnostics) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(namedTunnel?.name || "lifeos-ai");
  const [hostname, setHostname] = useState(namedTunnel?.hostname || "");
  const [credentialsFile, setCredentialsFile] = useState(namedTunnel?.credentialsFile || "");
  const [busy, setBusy] = useState<"config" | "start" | null>(null);
  const [message, setMessage] = useState("");

  const handleGenerate = async () => {
    setBusy("config");
    setMessage("");
    try {
      const result = await generateCloudflareNamedTunnelConfig({ name, hostname, credentialsFile });
      onUpdate(result.diagnostics);
      setMessage(result.message);
    } catch (error: any) {
      setMessage(error.message || t("connection.namedConfigFailed"));
    } finally {
      setBusy(null);
    }
  };

  const handleStart = async () => {
    setBusy("start");
    setMessage("");
    try {
      const result = await startCloudflareNamedTunnel();
      onUpdate(result.diagnostics);
      setMessage(result.message);
    } catch (error: any) {
      setMessage(error.message || t("connection.namedStartFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-500/10 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-bold text-sky-100">{t("connection.namedTitle")}</div>
          <div className="mt-1 text-xs leading-relaxed text-sky-100/70">{t("connection.namedBody")}</div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${namedTunnel?.ready ? "bg-emerald-400/15 text-emerald-100" : "bg-amber-400/15 text-amber-100"}`}>
          {namedTunnel?.ready ? t("connection.longTermRecommended") : t("connection.needsConfig")}
        </span>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1.4fr_1.6fr_auto_auto]">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="rounded-xl border border-white/[0.08] bg-[#061016]/60 px-3 py-2 text-xs text-zinc-100 outline-none focus:border-sky-300/60"
          placeholder="lifeos-ai"
        />
        <input
          value={hostname}
          onChange={(event) => setHostname(event.target.value)}
          className="rounded-xl border border-white/[0.08] bg-[#061016]/60 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-sky-300/60"
          placeholder="lifeos.example.com"
        />
        <input
          value={credentialsFile}
          onChange={(event) => setCredentialsFile(event.target.value)}
          className="rounded-xl border border-white/[0.08] bg-[#061016]/60 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-sky-300/60"
          placeholder="/Users/me/.cloudflared/<tunnel-id>.json"
        />
        <button
          onClick={handleGenerate}
          disabled={!name || !hostname || !credentialsFile || busy !== null}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-300/20 bg-[#061016]/40 px-3 py-2 text-xs font-bold text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {busy === "config" ? t("connection.saving") : t("connection.namedGenerate")}
        </button>
        <button
          onClick={handleStart}
          disabled={!namedTunnel?.ready || busy !== null}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/15 px-3 py-2 text-xs font-bold text-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          {busy === "start" ? t("connection.running") : t("connection.namedStart")}
        </button>
      </div>
      <div className="mt-3 grid gap-2 text-[11px] leading-relaxed text-sky-100/70 md:grid-cols-2">
        <div className="rounded-xl border border-white/[0.08] bg-[#061016]/40 p-2">
          <div className="font-bold text-sky-100">{t("connection.configPath")}</div>
          <div className="mt-1 break-all font-mono">{namedTunnel?.configPath || "-"}</div>
        </div>
        <div className={`rounded-xl border p-2 ${namedTunnel?.credentialsFileExists ? "border-emerald-400/15 bg-emerald-500/10" : "border-amber-400/15 bg-amber-500/10"}`}>
          <div className="font-bold text-sky-100">{t("connection.namedCredentials")}</div>
          <div className="mt-1">{namedTunnel?.credentialsFileExists ? t("connection.namedCredentialsReady") : t("connection.namedCredentialsMissing")}</div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-[#061016]/40 p-2">
          <div className="font-bold text-sky-100">{t("connection.command")}</div>
          <div className="mt-1 break-all font-mono">{namedTunnel?.command || "-"}</div>
        </div>
      </div>
      {namedTunnel?.baseUrl ? (
        <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-2 text-xs text-emerald-100">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
          {t("connection.namedStableUrl", { url: namedTunnel.baseUrl })}
        </div>
      ) : null}
      {message ? <div className="mt-3 rounded-xl border border-white/[0.08] bg-[#061016]/40 p-2 text-xs text-sky-50">{message}</div> : null}
    </div>
  );
}
