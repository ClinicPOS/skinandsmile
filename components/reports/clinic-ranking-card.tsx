type ClinicRankingRow = {
  clinicId: string;
  clinicName: string;
  netSales: number;
  targetAttainment: number | null;
  status: "good" | "average" | "needs_attention" | "no_target_set";
};

type ClinicRankingCardProps = {
  rows: ClinicRankingRow[];
  formatCurrency: (value: number | null | undefined) => string;
};

function statusLabel(status: ClinicRankingRow["status"]) {
  if (status === "good") return "On Track";
  if (status === "average") return "Watch";
  if (status === "needs_attention") return "Needs Attention";
  return "No Target";
}

function statusClasses(status: ClinicRankingRow["status"]) {
  if (status === "good") return "text-emerald-700 bg-emerald-50";
  if (status === "average") return "text-amber-700 bg-amber-50";
  if (status === "needs_attention") return "text-rose-700 bg-rose-50";
  return "text-slate-600 bg-slate-100";
}

function progressClasses(status: ClinicRankingRow["status"]) {
  if (status === "good") return "bg-emerald-500";
  if (status === "average") return "bg-amber-400";
  if (status === "needs_attention") return "bg-rose-400";
  return "bg-slate-300";
}

export function ClinicRankingCard({ rows, formatCurrency }: ClinicRankingCardProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Clinic Performance</h3>
          <p className="mt-1 text-xs text-slate-500">Ranked by net sales for the selected period.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No clinic performance data for this period.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row, index) => {
            const progress = row.targetAttainment == null ? null : Math.max(0, Math.min(row.targetAttainment, 100));
            return (
              <div key={row.clinicId} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700 shadow-sm">
                        {index + 1}
                      </span>
                      <p className="truncate text-sm font-semibold text-slate-950">{row.clinicName}</p>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatCurrency(row.netSales)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClasses(row.status)}`}>
                    {statusLabel(row.status)}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white">
                    <div
                      className={`h-full rounded-full ${progressClasses(row.status)}`}
                      style={{ width: `${progress ?? 0}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    {row.targetAttainment == null ? "No target" : `${row.targetAttainment.toFixed(0)}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
