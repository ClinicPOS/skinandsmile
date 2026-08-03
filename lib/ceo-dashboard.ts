export type DashboardPeriod = "today" | "this_week" | "this_month" | "this_year" | "custom";

export type DashboardRange = {
  period: DashboardPeriod;
  label: string;
  startUtcIso: string;
  endUtcIso: string;
  startDubaiDate: string;
  endDubaiDate: string;
};

export type ClinicPerformanceStatus = "good" | "average" | "needs_attention" | "no_target_set";

const DUBAI_OFFSET = "+04:00";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dubaiParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value || "0");
  const month = Number(parts.find((part) => part.type === "month")?.value || "0");
  const day = Number(parts.find((part) => part.type === "day")?.value || "0");
  return { year, month, day };
}

function makeDubaiDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0) {
  const iso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}.${String(ms).padStart(3, "0")}${DUBAI_OFFSET}`;
  return new Date(iso);
}

function addDubaiDays(date: Date, days: number) {
  const parts = dubaiParts(date);
  const base = makeDubaiDate(parts.year, parts.month, parts.day);
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai",
    month: "short",
    year: "numeric",
  });
}

function dateLabel(date: Date) {
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function startOfDubaiWeek(now: Date) {
  // Sun=0 ... Sat=6, Monday-start week
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekdayText = now.toLocaleDateString("en-US", { timeZone: "Asia/Dubai", weekday: "short" });
  const weekdayNumber = map[weekdayText] ?? 0;
  const offsetToMonday = weekdayNumber === 0 ? -6 : 1 - weekdayNumber;
  return addDubaiDays(makeDubaiDate(dubaiParts(now).year, dubaiParts(now).month, dubaiParts(now).day), offsetToMonday);
}

export function buildDashboardRange(input: {
  period: DashboardPeriod;
  now?: Date;
  customStart?: string | null;
  customEnd?: string | null;
}): DashboardRange {
  const now = input.now || new Date();
  const today = makeDubaiDate(dubaiParts(now).year, dubaiParts(now).month, dubaiParts(now).day);
  let start = today;
  let end = addDubaiDays(today, 1);
  let label = "Today";

  if (input.period === "this_week") {
    start = startOfDubaiWeek(now);
    end = addDubaiDays(start, 7);
    label = "This Week";
  } else if (input.period === "this_month") {
    const parts = dubaiParts(now);
    start = makeDubaiDate(parts.year, parts.month, 1);
    end = makeDubaiDate(parts.year, parts.month + 1, 1);
    label = "This Month";
  } else if (input.period === "this_year") {
    const parts = dubaiParts(now);
    start = makeDubaiDate(parts.year, 1, 1);
    end = makeDubaiDate(parts.year + 1, 1, 1);
    label = "This Year";
  } else if (input.period === "custom") {
    if (!input.customStart || !input.customEnd) {
      throw new Error("Custom range requires start and end dates.");
    }
    const [sy, sm, sd] = input.customStart.split("-").map(Number);
    const [ey, em, ed] = input.customEnd.split("-").map(Number);
    start = makeDubaiDate(sy, sm, sd);
    end = addDubaiDays(makeDubaiDate(ey, em, ed), 1);
    label = `${dateLabel(start)} - ${dateLabel(addDubaiDays(end, -1))}`;
  }

  return {
    period: input.period,
    label,
    startUtcIso: start.toISOString(),
    endUtcIso: end.toISOString(),
    startDubaiDate: dateLabel(start),
    endDubaiDate: dateLabel(addDubaiDays(end, -1)),
  };
}

export function buildComparisonRange(current: DashboardRange): DashboardRange {
  let start = new Date(current.startUtcIso);
  let end = new Date(current.endUtcIso);
  let label = "";

  if (current.period === "today") {
    start = addDubaiDays(start, -1);
    end = addDubaiDays(end, -1);
    label = "Yesterday";
  } else if (current.period === "this_week") {
    start = addDubaiDays(start, -7);
    end = addDubaiDays(end, -7);
    label = "Previous week";
  } else if (current.period === "this_month") {
    const startParts = dubaiParts(start);
    start = makeDubaiDate(startParts.year, startParts.month - 1, 1);
    end = makeDubaiDate(startParts.year, startParts.month, 1);
    label = `Previous month (${monthLabel(start)})`;
  } else if (current.period === "this_year") {
    const startParts = dubaiParts(start);
    start = makeDubaiDate(startParts.year - 1, 1, 1);
    end = makeDubaiDate(startParts.year, 1, 1);
    label = "Previous year";
  } else {
    const ms = new Date(current.endUtcIso).getTime() - new Date(current.startUtcIso).getTime();
    end = new Date(current.startUtcIso);
    start = new Date(end.getTime() - ms);
    label = "Previous equivalent range";
  }

  return {
    period: current.period,
    label,
    startUtcIso: start.toISOString(),
    endUtcIso: end.toISOString(),
    startDubaiDate: dateLabel(start),
    endDubaiDate: dateLabel(addDubaiDays(end, -1)),
  };
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Not available";
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return `AED ${rounded.toLocaleString("en-US")}`;
  }
  const fixed = rounded.toFixed(2);
  const parts = fixed.split(".");
  return `AED ${Number(parts[0]).toLocaleString("en-US")}.${parts[1]}`;
}

export function statusFromTarget(attainmentPercent: number | null): ClinicPerformanceStatus {
  if (attainmentPercent == null || !Number.isFinite(attainmentPercent)) return "no_target_set";
  if (attainmentPercent >= 100) return "good";
  if (attainmentPercent >= 80) return "average";
  return "needs_attention";
}

export function statusLabel(status: ClinicPerformanceStatus) {
  if (status === "good") return "Good";
  if (status === "average") return "Average";
  if (status === "needs_attention") return "Needs Attention";
  return "No Target Set";
}

export function statusIcon(status: ClinicPerformanceStatus) {
  if (status === "good") return "G";
  if (status === "average") return "A";
  if (status === "needs_attention") return "!";
  return "i";
}

export function percentageChange(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
