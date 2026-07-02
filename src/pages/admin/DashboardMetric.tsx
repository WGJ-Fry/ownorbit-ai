import type { ReactNode } from "react";

type MetricTone = "cyan" | "blue" | "green" | "amber";

const toneClasses: Record<MetricTone, string> = {
  cyan: "text-cyan-300 bg-cyan-500/10 border-cyan-400/20",
  blue: "text-blue-300 bg-blue-500/10 border-blue-400/20",
  green: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
  amber: "text-amber-300 bg-amber-500/10 border-amber-400/20",
};

export default function DashboardMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: MetricTone }) {
  return (
    <div className="rounded-3xl border border-white/[0.08] bg-[#101722] p-5">
      <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center mb-4 ${toneClasses[tone]}`}>{icon}</div>
      <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}
