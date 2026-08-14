type ExecutiveKpiCardProps = {
  title: string;
  value: string;
  comparison?: string | null;
  comparisonTone?: "positive" | "negative" | "neutral";
  note?: string;
  progressPercent?: number | null;
  progressTone?: "positive" | "warning" | "negative" | "neutral";
};

function comparisonClass(tone: ExecutiveKpiCardProps["comparisonTone"]) {
  if (tone === "positive") return "text-emerald-700 bg-emerald-50";
  if (tone === "negative") return "text-rose-700 bg-rose-50";
  return "text-slate-600 bg-slate-100";
}

function progressClass(tone: ExecutiveKpiCardProps["progressTone"]) {
  if (tone === "positive") return "bg-emerald-500";
  if (tone === "warning") return "bg-amber-400";
  if (tone === "negative") return "bg-rose-400";
  return "bg-teal-600";
}

export function ExecutiveKpiCard({
  title,
  value,
  comparison,
  comparisonTone = "neutral",
  note,
  progressPercent,
  progressTone = "neutral",
}: ExecutiveKpiCardProps) {
  const safeProgress = progressPercent == null ? null : Math.max(0, Math.min(progressPercent, 100));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-[1.9rem]">{value}</p>
      {safeProgress != null ? (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${progressClass(progressTone)}`}
              style={{ width: `${safeProgress}%` }}
            />
          </div>
        </div>
      ) : null}
      {comparison ? (
        <div className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${comparisonClass(comparisonTone)}`}>
          {comparison}
        </div>
      ) : null}
      {note ? <p className="mt-2 text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}
