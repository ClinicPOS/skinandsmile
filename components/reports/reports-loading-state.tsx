function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-100 ${className || ""}`} />;
}

export function ReportsLoadingState() {
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="mt-1 h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
          <div>
            <h2 className="text-base font-semibold text-slate-950">Loading report data…</h2>
            <p className="mt-1 text-sm text-slate-500">
              Please wait while we prepare the latest clinic performance.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-3 h-8 w-32" />
            <SkeletonBlock className="mt-3 h-2 w-full" />
            <SkeletonBlock className="mt-3 h-5 w-28" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="mt-2 h-3 w-56" />
          <SkeletonBlock className="mt-6 h-72 w-full" />
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="mt-2 h-3 w-40" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <SkeletonBlock className="h-4 w-40" />
                <SkeletonBlock className="mt-2 h-3 w-24" />
                <SkeletonBlock className="mt-3 h-2 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
