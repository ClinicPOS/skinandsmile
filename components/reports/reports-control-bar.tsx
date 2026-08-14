"use client";

type ClinicOption = {
  id: string;
  name: string;
};

type QuickPreset = {
  id: string;
  label: string;
};

type ReportsControlBarProps = {
  clinics: ClinicOption[];
  clinicId: string;
  onClinicChange: (clinicId: string) => void;
  selectedLabel: string;
  comparisonLabel: string;
  activePreset: string;
  quickPresets: QuickPreset[];
  refreshing: boolean;
  disableNext: boolean;
  onPresetSelect: (preset: string) => void;
  onOpenDatePicker: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

export function ReportsControlBar({
  clinics,
  clinicId,
  onClinicChange,
  selectedLabel,
  comparisonLabel,
  activePreset,
  quickPresets,
  refreshing,
  disableNext,
  onPresetSelect,
  onOpenDatePicker,
  onPrevious,
  onNext,
}: ReportsControlBarProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-1 flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Clinic
              </label>
              <select
                value={clinicId}
                onChange={(event) => onClinicChange(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">All Clinics</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Date / Period
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onPrevious}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800"
                  aria-label="Previous period"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={onOpenDatePicker}
                  className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left transition hover:border-teal-300"
                >
                  <div className="text-sm font-semibold text-slate-950">{selectedLabel}</div>
                  <div className="mt-1 text-xs text-slate-500">{comparisonLabel}</div>
                </button>
                <button
                  type="button"
                  disabled={disableNext}
                  onClick={onNext}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Next period"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {quickPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onPresetSelect(preset.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  activePreset === preset.id
                    ? "bg-teal-700 text-white"
                    : "border border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-200 hover:text-teal-800"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          {refreshing ? (
            <span className="rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-700">
              Updating report…
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
