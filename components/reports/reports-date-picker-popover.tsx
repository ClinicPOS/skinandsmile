"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ReportsDatePickerPopoverProps = {
  isOpen: boolean;
  todayDate: string;
  startDate: string;
  endDate: string;
  activePreset: string;
  onClose: () => void;
  onPresetSelect: (preset: string) => void;
  onSingleDateSelect: (date: string) => void;
  onRangeApply: (startDate: string, endDate: string) => void;
};

const PRESET_OPTIONS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7_days", label: "Last 7 Days" },
  { id: "last_30_days", label: "Last 30 Days" },
  { id: "this_week", label: "This Week" },
  { id: "last_week", label: "Last Week" },
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
] as const;

export function ReportsDatePickerPopover({
  isOpen,
  todayDate,
  startDate,
  endDate,
  activePreset,
  onClose,
  onPresetSelect,
  onSingleDateSelect,
  onRangeApply,
}: ReportsDatePickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [draftStartDate, setDraftStartDate] = useState(startDate);
  const [draftEndDate, setDraftEndDate] = useState(endDate);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(event.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  const rangeError = useMemo(() => {
    if (!draftStartDate || !draftEndDate) return "Choose both a start and end date.";
    if (draftStartDate > draftEndDate) return "End date must be after the start date.";
    if (draftEndDate > todayDate) return "Future dates are not available.";
    return "";
  }, [draftEndDate, draftStartDate, todayDate]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute left-0 top-[calc(100%+0.75rem)] z-30 w-full max-w-[24rem] rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.25)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Choose period</h3>
          <p className="mt-1 text-xs text-slate-500">Select a preset, one day, or a custom range.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        >
          Close
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESET_OPTIONS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              onPresetSelect(preset.id);
              onClose();
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              activePreset === preset.id
                ? "bg-teal-700 text-white"
                : "border border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-200 hover:text-teal-800"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Single specific date</p>
        <p className="mt-1 text-xs text-slate-500">Pick one day to load that date immediately.</p>
        <input
          type="date"
          value={startDate}
          max={todayDate}
          onChange={(event) => {
            if (!event.target.value) return;
            onSingleDateSelect(event.target.value);
            onClose();
          }}
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Custom date range</p>
        <p className="mt-1 text-xs text-slate-500">Choose a start and end date, then apply the range.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Start</label>
            <input
              type="date"
              value={draftStartDate}
              max={todayDate}
              onChange={(event) => setDraftStartDate(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">End</label>
            <input
              type="date"
              value={draftEndDate}
              max={todayDate}
              onChange={(event) => setDraftEndDate(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            />
          </div>
        </div>

        {rangeError ? <p className="mt-3 text-xs text-rose-600">{rangeError}</p> : null}

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!!rangeError}
            onClick={() => {
              if (rangeError) return;
              onRangeApply(draftStartDate, draftEndDate);
              onClose();
            }}
            className="rounded-full bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
          >
            Apply range
          </button>
        </div>
      </div>
    </div>
  );
}
