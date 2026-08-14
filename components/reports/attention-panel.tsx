type AttentionPanelProps = {
  items: string[];
};

export function AttentionPanel({ items }: AttentionPanelProps) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-amber-950">Needs Attention</h3>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-amber-100 bg-white/70 px-3 py-2 text-sm text-amber-900">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
