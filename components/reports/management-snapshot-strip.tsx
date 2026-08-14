export type ManagementSnapshotItem = {
  label: string;
  title: string;
  subtitle?: string;
  tone?: "teal" | "cyan" | "amber" | "rose" | "slate";
};

type ManagementSnapshotStripProps = {
  items: ManagementSnapshotItem[];
};

function toneClasses(tone: ManagementSnapshotItem["tone"]) {
  if (tone === "cyan") return "border-cyan-200 bg-cyan-50";
  if (tone === "amber") return "border-amber-200 bg-amber-50";
  if (tone === "rose") return "border-rose-200 bg-rose-50";
  if (tone === "slate") return "border-slate-200 bg-slate-50";
  return "border-teal-200 bg-teal-50";
}

export function ManagementSnapshotStrip({ items }: ManagementSnapshotStripProps) {
  if (items.length === 0) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={`rounded-3xl border p-4 shadow-sm ${toneClasses(item.tone)}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
          <p className="mt-2 text-base font-semibold text-slate-950">{item.title}</p>
          {item.subtitle ? <p className="mt-1 text-sm text-slate-600">{item.subtitle}</p> : null}
        </div>
      ))}
    </div>
  );
}
