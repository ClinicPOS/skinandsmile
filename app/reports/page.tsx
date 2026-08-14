"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as XLSX from "xlsx-js-style";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AttentionPanel } from "../../components/reports/attention-panel";
import { ClinicRankingCard } from "../../components/reports/clinic-ranking-card";
import { ExecutiveKpiCard } from "../../components/reports/executive-kpi-card";
import {
  ManagementSnapshotStrip,
  type ManagementSnapshotItem,
} from "../../components/reports/management-snapshot-strip";
import { ReportsControlBar } from "../../components/reports/reports-control-bar";
import { ReportsDatePickerPopover } from "../../components/reports/reports-date-picker-popover";
import { ReportsLoadingState } from "../../components/reports/reports-loading-state";
import { ReportsFrame } from "../../components/reports-frame";
import { supabase } from "../../lib/supabase";
import {
  type DashboardPeriod,
  formatCurrency,
  percentageChange,
  statusIcon,
  statusLabel,
} from "../../lib/ceo-dashboard";
import { printHtmlWhenImagesReady } from "../../lib/receipt-branding";

type DashboardResponse = {
  meta: {
    currentRange: {
      period: DashboardPeriod;
      label: string;
      startUtcIso: string;
      endUtcIso: string;
      startDubaiDate: string;
      endDubaiDate: string;
    };
    compareRange: {
      label: string;
      startDubaiDate: string;
      endDubaiDate: string;
    };
    timezone: string;
    lastUpdatedAt: string;
    clinicId: string | null;
    selectedYear: number;
  };
  overview: {
    netSales: number;
    netSalesCompare: number;
    netCollectionsAfterDeductions: number;
    netCollectionsAfterDeductionsCompare: number;
    targetProgress: number | null;
    customerCollections: number;
    customerCollectionsCompare: number;
    birthdayDiscounts?: number;
    birthdayDiscountsCompare?: number;
    outstandingBalance: number;
    outstandingBalanceCompare: number;
    uniquePatientsSeen: number;
    uniquePatientsSeenCompare: number;
    completedVisits: number;
    newPatients: number;
    returningPatients: number;
    refundsTreatmentValue: number;
    comparisonRefundsTreatmentValue: number;
    missingData: {
      cancelledStatusNotRecorded: boolean;
      providerDeductionsNotRecorded: boolean;
      paymentAllocationCoverageIncomplete: boolean;
      targetConfigurationAvailable: boolean;
    };
  } | null;
  clinicPerformance: Array<{
    clinicId: string;
    clinicName: string;
    netSales: number;
    expectedTarget: number | null;
    targetAttainment: number | null;
    status: "good" | "average" | "needs_attention" | "no_target_set";
    previousPeriodChangePercent: number | null;
    uniquePatients: number;
    averageNetSalesPerPatient: number;
  }>;
  doctorPerformance: Array<{
    doctorId: string;
    doctorName: string;
    clinicName: string;
    uniquePatients: number;
    completedVisits: number;
    netSales: number;
    averageNetSalesPerPatient: number;
  }>;
  trends: {
    sales: {
      granularity: "day" | "month";
      points: Array<{
        date: string | null;
        label: string;
        netSales: number;
        target: number | null;
        previousYear: number | null;
        belowTarget: boolean | null;
      }>;
    };
    monthly: Array<{
      month: string;
      netSales: number;
      target: number | null;
      previousYear: number | null;
      belowTarget: boolean | null;
    }>;
    patientDemand: {
      historyDays: number;
      message: string;
      dayOfWeek: Array<{
        weekday: string;
        visits: number;
        averagePerOpenDay: number | null;
      }>;
      dayOfMonthBuckets: Array<{
        label: string;
        visits: number;
      }>;
      eventsInRange: Array<{
        eventType: string;
        startDate: string;
        endDate: string;
        clinicId: string | null;
      }>;
    };
  };
  payments: {
    methods: Array<{
      method: "cash" | "card" | "tabby" | "tamara";
      amount: number;
      count: number;
    }>;
    paymentMethodUses: number;
    paymentFeesCollected: number;
    customerCollections: number;
    customerRefunds: number;
    providerDeductionsAvailable: boolean;
    providerDeductions: number | null;
    netSettlement: number | null;
    missingAllocationCoverage: boolean;
  };
  cashManagement: {
    cashCollected: number;
    commissionsPaid: number;
    expensesPaid: number;
    totalCashDeductions: number;
    cashAfterDeductions: number;
    details: Array<{
      id: string;
      createdAt: string;
      clinicId: string;
      clinicName: string;
      registerSessionId: string;
      receptionistName: string;
      paidToName: string;
      description: string;
      referenceNumber: string | null;
      amount: number;
      type: "expense" | "commission";
      status: "active" | "voided";
      voidedAt: string | null;
      voidReason: string | null;
      voidedByName: string | null;
    }>;
  };
  attentionItems: string[];
};

type ReportsSessionResponse = {
  authenticated: boolean;
  accessLabel?: string;
};

type DashboardTab = "overview" | "clinics_doctors" | "trends_demand" | "payments";
type ReportsQuickPreset =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "single_day"
  | "custom_range";

type ReportsDateSelection = {
  preset: ReportsQuickPreset;
  startDate: string;
  endDate: string;
};

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "clinics_doctors", label: "Clinics & Doctors" },
  { id: "trends_demand", label: "Trends" },
  { id: "payments", label: "Payments" },
];

const QUICK_PRESETS: Array<{ id: ReportsQuickPreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last_7_days", label: "Last 7 Days" },
  { id: "last_30_days", label: "Last 30 Days" },
  { id: "this_week", label: "This Week" },
  { id: "last_week", label: "Last Week" },
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
];

const METHOD_COLORS: Record<string, string> = {
  cash: "#0f766e",
  card: "#0284c7",
  tabby: "#7c3aed",
  tamara: "#b45309",
};

function methodLabel(method: string) {
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  if (method === "tabby") return "Tabby";
  if (method === "tamara") return "Tamara";
  return method;
}

function getDubaiYmd(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
}

function parseDubaiYmd(ymd: string) {
  return new Date(`${ymd}T00:00:00+04:00`);
}

function parseYmdParts(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
}

function shiftDubaiYmd(ymd: string, days: number) {
  const next = parseDubaiYmd(ymd);
  next.setUTCDate(next.getUTCDate() + days);
  return getDubaiYmd(next);
}

function getStartOfDubaiWeek(ymd: string) {
  const current = parseDubaiYmd(ymd);
  const weekdayText = current.toLocaleDateString("en-US", { timeZone: "Asia/Dubai", weekday: "short" });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = map[weekdayText] ?? 0;
  const offsetToMonday = weekday === 0 ? -6 : 1 - weekday;
  return shiftDubaiYmd(ymd, offsetToMonday);
}

function getStartOfDubaiMonth(ymd: string) {
  const { year, month } = parseYmdParts(ymd);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function getPreviousMonthRange(ymd: string) {
  const { year: currentYear, month: currentMonth } = parseYmdParts(ymd);
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
  const startDate = `${previousYear}-${String(previousMonth).padStart(2, "0")}-01`;
  const currentMonthStart = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
  const endDate = shiftDubaiYmd(currentMonthStart, -1);
  return { startDate, endDate };
}

function rangeSpanInDays(startDate: string, endDate: string) {
  const start = parseDubaiYmd(startDate).getTime();
  const end = parseDubaiYmd(endDate).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function formatDisplayDate(dateYmd: string) {
  return parseDubaiYmd(dateYmd).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSelectedRangeLabel(startDate: string, endDate: string) {
  if (startDate === endDate) return formatDisplayDate(startDate);

  const start = parseYmdParts(startDate);
  const end = parseYmdParts(endDate);
  const startLabel = parseDubaiYmd(startDate).toLocaleDateString("en-GB", { timeZone: "Asia/Dubai", month: "short" });
  const endLabel = parseDubaiYmd(endDate).toLocaleDateString("en-GB", { timeZone: "Asia/Dubai", month: "short" });
  const sameYear = start.year === end.year;
  const sameMonth = sameYear && start.month === end.month;

  if (sameMonth) {
    return `${start.day} ${startLabel} – ${end.day} ${end.year}`;
  }

  if (sameYear) {
    return `${start.day} ${startLabel} – ${end.day} ${endLabel} ${end.year}`;
  }

  return `${formatDisplayDate(startDate)} – ${formatDisplayDate(endDate)}`;
}

function buildDateSelection(startDate: string, endDate: string, todayDate: string, preferredPreset?: ReportsQuickPreset): ReportsDateSelection {
  if (startDate === endDate) {
    if (startDate === todayDate) {
      return { preset: "today", startDate, endDate };
    }
    if (startDate === shiftDubaiYmd(todayDate, -1)) {
      return { preset: "yesterday", startDate, endDate };
    }
    return { preset: preferredPreset === "today" ? "today" : "single_day", startDate, endDate };
  }

  return { preset: preferredPreset || "custom_range", startDate, endDate };
}

function buildSelectionFromPreset(preset: ReportsQuickPreset, todayDate: string): ReportsDateSelection {
  if (preset === "today") return { preset, startDate: todayDate, endDate: todayDate };
  if (preset === "yesterday") {
    const yesterday = shiftDubaiYmd(todayDate, -1);
    return { preset, startDate: yesterday, endDate: yesterday };
  }
  if (preset === "last_7_days") {
    return { preset, startDate: shiftDubaiYmd(todayDate, -6), endDate: todayDate };
  }
  if (preset === "last_30_days") {
    return { preset, startDate: shiftDubaiYmd(todayDate, -29), endDate: todayDate };
  }
  if (preset === "this_week") {
    return { preset, startDate: getStartOfDubaiWeek(todayDate), endDate: todayDate };
  }
  if (preset === "last_week") {
    const currentWeekStart = getStartOfDubaiWeek(todayDate);
    const endDate = shiftDubaiYmd(currentWeekStart, -1);
    return { preset, startDate: shiftDubaiYmd(endDate, -6), endDate };
  }
  if (preset === "this_month") {
    return { preset, startDate: getStartOfDubaiMonth(todayDate), endDate: todayDate };
  }
  if (preset === "last_month") {
    const previousMonth = getPreviousMonthRange(todayDate);
    return { preset, ...previousMonth };
  }
  return { preset: "custom_range", startDate: todayDate, endDate: todayDate };
}

function buildComparisonLabel(selection: ReportsDateSelection) {
  const span = rangeSpanInDays(selection.startDate, selection.endDate);
  const compareEnd = shiftDubaiYmd(selection.startDate, -1);
  const compareStart = shiftDubaiYmd(compareEnd, -(span - 1));
  return `Compared with ${formatSelectedRangeLabel(compareStart, compareEnd)}`;
}

function shiftSelectionWindow(selection: ReportsDateSelection, direction: "previous" | "next", todayDate: string) {
  const span = rangeSpanInDays(selection.startDate, selection.endDate);
  const delta = direction === "previous" ? -span : span;
  const nextStart = selection.startDate === selection.endDate
    ? shiftDubaiYmd(selection.startDate, direction === "previous" ? -1 : 1)
    : shiftDubaiYmd(selection.startDate, delta);
  const nextEnd = selection.startDate === selection.endDate
    ? shiftDubaiYmd(selection.endDate, direction === "previous" ? -1 : 1)
    : shiftDubaiYmd(selection.endDate, delta);

  if (nextEnd > todayDate) {
    return selection;
  }
  return buildDateSelection(nextStart, nextEnd, todayDate);
}

function canNavigateForward(selection: ReportsDateSelection, todayDate: string) {
  if (selection.startDate === selection.endDate) {
    return selection.endDate < todayDate;
  }
  const span = rangeSpanInDays(selection.startDate, selection.endDate);
  return shiftDubaiYmd(selection.endDate, span) <= todayDate;
}

function toDashboardRequest(selection: ReportsDateSelection) {
  if (selection.preset === "today") {
    return {
      period: "today" as DashboardPeriod,
      customStart: null,
      customEnd: null,
    };
  }
  if (selection.preset === "this_week") {
    return {
      period: "this_week" as DashboardPeriod,
      customStart: null,
      customEnd: null,
    };
  }
  if (selection.preset === "this_month") {
    return {
      period: "this_month" as DashboardPeriod,
      customStart: null,
      customEnd: null,
    };
  }
  return {
    period: "custom" as DashboardPeriod,
    customStart: selection.startDate,
    customEnd: selection.endDate,
  };
}

function getComparisonTone(change: number | null, direction: "higher_better" | "lower_better") {
  if (change == null || Math.abs(change) < 0.01) return "neutral" as const;
  const positive = direction === "higher_better" ? change > 0 : change < 0;
  return positive ? "positive" as const : "negative" as const;
}

function buildPercentComparison(change: number | null, label: string, direction: "higher_better" | "lower_better") {
  if (change == null) return { text: `No comparison available`, tone: "neutral" as const };
  if (Math.abs(change) < 0.01) return { text: `No change vs ${label}`, tone: "neutral" as const };
  const arrow = change > 0 ? "↑" : "↓";
  return {
    text: `${arrow} ${Math.abs(change).toFixed(1)}% vs ${label}`,
    tone: getComparisonTone(change, direction),
  };
}

function buildCountComparison(current: number, previous: number | null, label: string, direction: "higher_better" | "lower_better") {
  if (previous == null) return { text: "No comparison available", tone: "neutral" as const };
  const delta = current - previous;
  if (delta === 0) return { text: `No change vs ${label}`, tone: "neutral" as const };
  const arrow = delta > 0 ? "↑" : "↓";
  const percent = percentageChange(current, previous);
  const suffix = percent == null ? "" : ` (${Math.abs(percent).toFixed(1)}%)`;
  return {
    text: `${arrow} ${Math.abs(delta)} vs ${label}${suffix}`,
    tone: getComparisonTone(percent, direction),
  };
}

function deriveManagementSnapshot(data: DashboardResponse): ManagementSnapshotItem[] {
  const items: ManagementSnapshotItem[] = [];
  const clinicsSortedBySales = [...data.clinicPerformance].sort((left, right) => right.netSales - left.netSales);
  const clinicsSortedByPatients = [...data.clinicPerformance].sort((left, right) => right.uniquePatients - left.uniquePatients);
  const biggestImprovement = [...data.clinicPerformance]
    .filter((clinic) => clinic.previousPeriodChangePercent != null && clinic.previousPeriodChangePercent > 0)
    .sort((left, right) => (right.previousPeriodChangePercent || 0) - (left.previousPeriodChangePercent || 0))[0];
  const needsAttentionClinic = data.clinicPerformance.find((clinic) => clinic.status === "needs_attention");

  if (clinicsSortedBySales[0]) {
    items.push({
      label: "Top Clinic",
      title: clinicsSortedBySales[0].clinicName,
      subtitle: formatCurrency(clinicsSortedBySales[0].netSales),
      tone: "teal",
    });
  }

  if (biggestImprovement) {
    items.push({
      label: "Biggest Improvement",
      title: biggestImprovement.clinicName,
      subtitle: `+${biggestImprovement.previousPeriodChangePercent?.toFixed(1)}% vs previous period`,
      tone: "cyan",
    });
  }

  if (clinicsSortedByPatients[0]) {
    items.push({
      label: "Busiest Clinic",
      title: clinicsSortedByPatients[0].clinicName,
      subtitle: `${clinicsSortedByPatients[0].uniquePatients} patients`,
      tone: "slate",
    });
  }

  if (needsAttentionClinic) {
    items.push({
      label: "Needs Attention",
      title: needsAttentionClinic.clinicName,
      subtitle: needsAttentionClinic.targetAttainment == null
        ? "No target configured"
        : `${needsAttentionClinic.targetAttainment.toFixed(0)}% of expected target`,
      tone: "amber",
    });
  } else if (data.attentionItems[0]) {
    items.push({
      label: "Needs Attention",
      title: data.attentionItems[0],
      tone: "amber",
    });
  }

  return items.slice(0, 4);
}

function renderExportHtml(data: DashboardResponse, clinicLabel: string, currentRangeLabel: string, compareRangeLabel: string) {
  const rows = data.clinicPerformance
    .map((row) => `
      <tr>
        <td>${row.clinicName}</td>
        <td>${formatCurrency(row.netSales)}</td>
        <td>${row.expectedTarget == null ? "Not available" : formatCurrency(row.expectedTarget)}</td>
        <td>${row.targetAttainment == null ? "No Target Set" : `${row.targetAttainment.toFixed(1)}%`}</td>
        <td>${statusLabel(row.status)}</td>
      </tr>
    `)
    .join("");
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>CEO Dashboard Export</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 16px; color: #0f172a; }
        h1, h2 { margin: 0 0 8px; }
        .meta { color: #475569; margin-bottom: 12px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 12px; text-align: left; }
        th { background: #f1f5f9; }
        .kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
        .kpi { border: 1px solid #dbeafe; border-radius: 8px; padding: 8px; background: #f8fafc; }
        .kpi .label { color: #475569; font-size: 11px; }
        .kpi .value { font-weight: bold; font-size: 14px; margin-top: 2px; }
      </style>
    </head>
    <body>
      <h1>CEO Dashboard Report</h1>
      <div class="meta">
        Clinic: ${clinicLabel}<br/>
        Period: ${data.meta.currentRange.label} (${currentRangeLabel})<br/>
        Comparison: ${compareRangeLabel}<br/>
        Time Zone: ${data.meta.timezone}<br/>
        Generated: ${new Date(data.meta.lastUpdatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}
      </div>
      <div class="kpis">
        <div class="kpi"><div class="label">Net Collections After Deductions</div><div class="value">${formatCurrency(data.overview?.netCollectionsAfterDeductions)}</div></div>
        <div class="kpi"><div class="label">Target Pace</div><div class="value">${data.overview?.targetProgress == null ? "Not available" : `${data.overview.targetProgress.toFixed(1)}%`}</div></div>
        <div class="kpi"><div class="label">Customer Collections</div><div class="value">${formatCurrency(data.overview?.customerCollections)}</div></div>
        <div class="kpi"><div class="label">Outstanding Balance</div><div class="value">${formatCurrency(data.overview?.outstandingBalance)}</div></div>
        <div class="kpi"><div class="label">Birthday Discounts</div><div class="value">${formatCurrency(data.overview?.birthdayDiscounts ?? 0)}</div></div>
      </div>
      <h2>Clinic Comparison</h2>
      <table>
        <thead><tr><th>Clinic</th><th>Net Sales</th><th>Expected Target</th><th>Target Attainment</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">No data</td></tr>`}</tbody>
      </table>
    </body>
  </html>`;
}

function TargetBar({ pct, status }: { pct: number | null; status: string }) {
  if (pct == null) return <span className="text-xs text-slate-400">No target</span>;
  const capped = Math.min(pct, 100);
  const color =
    status === "good" ? "bg-emerald-500" :
    status === "average" ? "bg-amber-400" :
    status === "needs_attention" ? "bg-rose-400" :
    "bg-slate-300";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${capped}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-700">{pct.toFixed(0)}%</span>
    </div>
  );
}

function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function ReportsPage() {
  const initialTodayDate = useMemo(() => getDubaiYmd(), []);
  const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "guest">("loading");
  const [accessLabel, setAccessLabel] = useState("Reports Access • All Clinics");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [dateSelection, setDateSelection] = useState<ReportsDateSelection>(() => buildSelectionFromPreset("today", initialTodayDate));
  const [clinicId, setClinicId] = useState("");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [yearInput, setYearInput] = useState<string>(String(new Date().getFullYear()));
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [amountMode, setAmountMode] = useState<"amount" | "count">("amount");
  const [showCashDeductionDetails, setShowCashDeductionDetails] = useState(false);
  const [clinics, setClinics] = useState<Array<{ id: string; name: string }>>([]);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const loginTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef<Record<string, DashboardResponse>>({});
  const dataRef = useRef<DashboardResponse | null>(null);
  const requestIdRef = useRef(0);

  const dashboardRequest = useMemo(() => toDashboardRequest(dateSelection), [dateSelection]);
  const dashboardCacheKey = useMemo(
    () => `${clinicId || "all"}|${dateSelection.startDate}|${dateSelection.endDate}|${selectedYear}`,
    [clinicId, dateSelection.endDate, dateSelection.startDate, selectedYear]
  );
  const selectedRangeLabel = useMemo(
    () => formatSelectedRangeLabel(dateSelection.startDate, dateSelection.endDate),
    [dateSelection.endDate, dateSelection.startDate]
  );
  const comparisonRangeLabel = useMemo(
    () => buildComparisonLabel(dateSelection),
    [dateSelection]
  );
  const canMoveForward = useMemo(
    () => canNavigateForward(dateSelection, initialTodayDate),
    [dateSelection, initialTodayDate]
  );
  const isLocked = lockedUntil > 0 && countdown > 0;
  const clinicLabel = clinicId
    ? clinics.find((clinic) => clinic.id === clinicId)?.name || "Selected Clinic"
    : "All Clinics";

  const managementSnapshot = useMemo(
    () => (data ? deriveManagementSnapshot(data) : []),
    [data]
  );

  const overviewComparisonLabel = data?.meta.compareRange.label || comparisonRangeLabel.replace("Compared with ", "");
  const salesTrendDescription = data?.trends.sales.granularity === "day"
    ? `Daily performance for ${selectedRangeLabel}, using the existing dashboard sales definition.`
    : `Monthly performance for ${selectedYear}, using the existing dashboard trend data.`;
  const showSalesTrendPreviousYear = data?.trends.sales.granularity === "month"
    && (data.trends.sales.points.some((point) => point.previousYear != null) ?? false);
  const paymentMethodLegend = useMemo(() => {
    const methods = data?.payments.methods || [];
    const total = methods.reduce((sum, method) => sum + (amountMode === "amount" ? method.amount : method.count), 0);
    return methods.map((method) => {
      const value = amountMode === "amount" ? method.amount : method.count;
      const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
      return {
        method: method.method,
        label: `${methodLabel(method.method)} ${percentage}%`,
      };
    });
  }, [amountMode, data?.payments.methods]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/reports/session", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({ authenticated: false }))) as ReportsSessionResponse;
      if (cancelled) return;
      if (response.ok && payload.authenticated) {
        setAccessLabel(payload.accessLabel || "Reports Access • All Clinics");
        setAuthStatus("authenticated");
        return;
      }
      setAuthStatus("guest");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockedUntil <= 0) return;
    function tick() {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdown(0);
        setLockedUntil(0);
        setLoginError("");
        if (loginTimerRef.current) clearInterval(loginTimerRef.current);
      } else {
        setCountdown(remaining);
      }
    }
    tick();
    loginTimerRef.current = setInterval(tick, 1000);
    return () => {
      if (loginTimerRef.current) clearInterval(loginTimerRef.current);
    };
  }, [lockedUntil]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!exportMenuRef.current) return;
      if (exportMenuRef.current.contains(event.target as Node)) return;
      setIsExportMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    supabase
      .from("clinics")
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data: rows, error: clinicsError }) => {
        if (cancelled || clinicsError) return;
        setClinics((rows || []) as Array<{ id: string; name: string }>);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  const loadDashboard = useCallback(async (options?: { force?: boolean }) => {
    if (authStatus !== "authenticated") return;

    const useCachedValue = !options?.force;
    const cached = cacheRef.current[dashboardCacheKey];
    if (useCachedValue && cached) {
      setData(cached);
      setLastUpdated(cached.meta.lastUpdatedAt);
      setError("");
    }

    if (!cached && !dataRef.current) setLoading(true);
    else setRefreshing(true);

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const response = await fetch("/api/reports/ceo-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: dashboardRequest.period,
          clinicId: clinicId || null,
          customStart: dashboardRequest.customStart,
          customEnd: dashboardRequest.customEnd,
          year: selectedYear,
          includeHistoricalData: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (requestId !== requestIdRef.current) return;

      if (!response.ok) {
        if (response.status === 401) {
          setAuthStatus("guest");
          setData(null);
          setError("");
          return;
        }
        setError("Unable to load report data.");
        return;
      }

      const nextData = payload as DashboardResponse;
      cacheRef.current[dashboardCacheKey] = nextData;
      setData(nextData);
      setLastUpdated(nextData.meta.lastUpdatedAt);
      setError("");
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError("Unable to load report data.");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [authStatus, clinicId, dashboardCacheKey, dashboardRequest.customEnd, dashboardRequest.customStart, dashboardRequest.period, selectedYear]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    void loadDashboard();
  }, [authStatus, loadDashboard]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const isTodaySelection = dateSelection.startDate === initialTodayDate && dateSelection.endDate === initialTodayDate;
    if (!isTodaySelection) return;

    const channel = supabase
      .channel("ceo-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "receipts" }, () => {
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => {
          void loadDashboard({ force: true });
        }, 500);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "refunds" }, () => {
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => {
          void loadDashboard({ force: true });
        }, 500);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_records" }, () => {
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = window.setTimeout(() => {
          void loadDashboard({ force: true });
        }, 500);
      })
      .subscribe();

    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [authStatus, dateSelection.endDate, dateSelection.startDate, initialTodayDate, loadDashboard]);

  async function handleReportsLogin(event: React.FormEvent) {
    event.preventDefault();
    if (lockedUntil > Date.now()) return;
    if (!username.trim() || !password) {
      setLoginError("Please enter your username and password.");
      return;
    }

    setLoginLoading(true);
    setLoginError("");
    const response = await fetch("/api/reports/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const payload = await response.json().catch(() => ({}));

    if (response.ok) {
      setPassword("");
      setLoginError("");
      setAccessLabel("Reports Access • All Clinics");
      setAuthStatus("authenticated");
      setLoginLoading(false);
      return;
    }

    if (response.status === 429 && typeof payload?.remaining === "number") {
      setLockedUntil(Date.now() + payload.remaining * 1000);
    } else if (response.status === 500) {
      setLoginError(payload?.error || "Reports login is unavailable.");
    } else {
      const attemptsLeft = Number(payload?.attemptsLeft || 0);
      setLoginError(
        attemptsLeft === 1
          ? "Wrong username or password. 1 attempt left before lockout."
          : `Wrong username or password. ${attemptsLeft} attempts left.`
      );
    }
    setLoginLoading(false);
  }

  async function handleLogout() {
    await fetch("/api/reports/logout", { method: "POST" });
    setData(null);
    setLoading(false);
    setRefreshing(false);
    setError("");
    setPassword("");
    setLoginError("");
    setLockedUntil(0);
    setCountdown(0);
    setClinics([]);
    setAccessLabel("Reports Access • All Clinics");
    setAuthStatus("guest");
    setIsExportMenuOpen(false);
  }

  function handlePresetSelect(preset: string) {
    setDateSelection(buildSelectionFromPreset(preset as ReportsQuickPreset, initialTodayDate));
  }

  function handleSingleDateSelect(date: string) {
    setDateSelection(buildDateSelection(date, date, initialTodayDate));
  }

  function handleRangeApply(startDate: string, endDate: string) {
    setDateSelection(buildDateSelection(startDate, endDate, initialTodayDate, "custom_range"));
  }

  function handleShiftPrevious() {
    setDateSelection((current) => shiftSelectionWindow(current, "previous", initialTodayDate));
  }

  function handleShiftNext() {
    setDateSelection((current) => shiftSelectionWindow(current, "next", initialTodayDate));
  }

  function exportExcel() {
    if (!data) return;
    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["CEO Dashboard Summary"], [""],
      ["Clinic", clinicLabel],
      ["Period", `${data.meta.currentRange.label} (${selectedRangeLabel})`],
      ["Comparison", comparisonRangeLabel],
      ["Generated", new Date(data.meta.lastUpdatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })],
      [""],
      ["Net Collections After Deductions", data.overview?.netCollectionsAfterDeductions ?? ""],
      ["Customer Collections", data.overview?.customerCollections ?? ""],
      ["Outstanding Balance", data.overview?.outstandingBalance ?? ""],
      ["Unique Patients Seen", data.overview?.uniquePatientsSeen ?? ""],
      ["Completed Visits", data.overview?.completedVisits ?? ""],
      [""],
      ["Cash Collected", data.cashManagement.cashCollected],
      ["Commissions Paid", data.cashManagement.commissionsPaid],
      ["Expenses Paid", data.cashManagement.expensesPaid],
      ["Total Cash Deductions", data.cashManagement.totalCashDeductions],
      ["Cash After Deductions", data.cashManagement.cashAfterDeductions],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 34 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Executive Summary");

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Clinic", "Status", "Net Sales", "Expected Target", "Target Attainment %", "Previous Period Change %", "Unique Patients", "Avg Net Sales / Patient"],
      ...data.clinicPerformance.map((row) => [row.clinicName, statusLabel(row.status), row.netSales, row.expectedTarget ?? "", row.targetAttainment ?? "", row.previousPeriodChangePercent ?? "", row.uniquePatients, row.averageNetSalesPerPatient]),
    ]), "Clinic Comparison");

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Doctor", "Clinic", "Unique Patients", "Completed Visits", "Net Sales", "Avg Net Sales / Patient"],
      ...data.doctorPerformance.map((row) => [row.doctorName, row.clinicName, row.uniquePatients, row.completedVisits, row.netSales, row.averageNetSalesPerPatient]),
    ]), "Doctor Performance");

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Month", "Net Sales", "Target", "Previous Year", "Below Target"],
      ...data.trends.monthly.map((row) => [row.month, row.netSales, row.target ?? "", row.previousYear ?? "", row.belowTarget == null ? "" : row.belowTarget ? "Yes" : "No"]),
    ]), "Monthly Trends");

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Method", "Amount (Treatment Net)", "Payment Method Uses"],
      ...data.payments.methods.map((row) => [methodLabel(row.method), row.amount, row.count]),
      [""], ["Payment Fees Collected", data.payments.paymentFeesCollected],
      ["Customer Collections", data.payments.customerCollections],
      ["Customer Refunds", data.payments.customerRefunds],
    ]), "Payments");

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Date & Time", "Clinic", "Register Session", "Receptionist", "Type", "Paid To", "Description", "Reference", "Amount", "Status", "Void Details"],
      ...data.cashManagement.details.map((row) => [
        new Date(row.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }),
        row.clinicName,
        row.registerSessionId,
        row.receptionistName,
        row.type === "commission" ? "Commission" : "Expense",
        row.paidToName,
        row.description,
        row.referenceNumber || "",
        row.amount,
        row.status,
        row.status === "voided"
          ? `${row.voidedAt ? new Date(row.voidedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }) : ""}${row.voidedByName ? ` by ${row.voidedByName}` : ""}${row.voidReason ? ` • ${row.voidReason}` : ""}`
          : "",
      ]),
    ]), "Cash Deductions");

    XLSX.writeFile(workbook, `CEO_Dashboard_${new Date().toLocaleDateString("en-CA")}.xlsx`);
    setIsExportMenuOpen(false);
  }

  function exportPdfPrint() {
    if (!data) return;
    const html = renderExportHtml(data, clinicLabel, selectedRangeLabel, comparisonRangeLabel);
    printHtmlWhenImagesReady(html, "Please allow popups to print the CEO dashboard report.");
    setIsExportMenuOpen(false);
  }

  function commitYearInput() {
    const parsedYear = Number(yearInput);
    if (!Number.isFinite(parsedYear) || parsedYear < 2020 || parsedYear > 2100) {
      setYearInput(String(selectedYear));
      return;
    }
    setSelectedYear(parsedYear);
  }

  if (authStatus === "loading") {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4">
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-500 shadow-sm">
            Loading reports access...
          </div>
        </div>
      </main>
    );
  }

  if (authStatus !== "authenticated") {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
          <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Reports Login</h1>
            <p className="mt-2 text-sm text-slate-500">Sign in to open the CEO dashboard.</p>
            <form onSubmit={handleReportsLogin} className="mt-6 space-y-4">
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Username"
                disabled={isLocked || loginLoading}
                autoFocus
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                disabled={isLocked || loginLoading}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
              />
              {isLocked ? (
                <p className="text-sm font-medium text-orange-600">
                  Too many attempts. Try again in {Math.max(0, countdown)}s.
                </p>
              ) : loginError ? (
                <p className="text-sm text-red-500">{loginError}</p>
              ) : null}
              <button
                type="submit"
                disabled={loginLoading || isLocked}
                className="w-full rounded-xl bg-teal-700 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
              >
                {loginLoading ? "Signing in..." : "Open Reports"}
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const netSalesComparison = buildPercentComparison(
    percentageChange(data?.overview?.netSales ?? null, data?.overview?.netSalesCompare ?? null),
    overviewComparisonLabel,
    "higher_better"
  );
  const targetTone = data?.overview?.targetProgress == null
    ? "neutral"
    : data.overview.targetProgress >= 100
      ? "positive"
      : data.overview.targetProgress >= 80
        ? "warning"
        : "negative";
  const patientsComparison = buildCountComparison(
    data?.overview?.uniquePatientsSeen ?? 0,
    data?.overview?.uniquePatientsSeenCompare ?? null,
    overviewComparisonLabel,
    "higher_better"
  );
  const averagePerPatient = data?.overview && data.overview.uniquePatientsSeen > 0
    ? data.overview.netSales / data.overview.uniquePatientsSeen
    : null;
  const averagePerPatientCompareBase = data?.overview && data.overview.uniquePatientsSeenCompare > 0
    ? data.overview.netSalesCompare / data.overview.uniquePatientsSeenCompare
    : null;
  const averagePerPatientComparison = buildPercentComparison(
    percentageChange(averagePerPatient, averagePerPatientCompareBase),
    overviewComparisonLabel,
    "higher_better"
  );
  const outstandingComparison = buildPercentComparison(
    percentageChange(data?.overview?.outstandingBalance ?? null, data?.overview?.outstandingBalanceCompare ?? null),
    overviewComparisonLabel,
    "lower_better"
  );
  const sortedClinicPerformance = data
    ? [...data.clinicPerformance].sort((left, right) => right.netSales - left.netSales)
    : [];
  const paymentMethodTotals = data?.payments.methods.reduce<Record<string, number>>((totals, row) => {
    totals[row.method] = row.amount;
    return totals;
  }, { cash: 0, card: 0, tabby: 0, tamara: 0 }) || { cash: 0, card: 0, tabby: 0, tamara: 0 };
  const noSalesInRange = !!data?.overview && data.overview.netSales === 0 && data.overview.completedVisits === 0;

  return (
    <ReportsFrame>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-700">{accessLabel}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">CEO Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Live performance across all clinics</p>
            <p className="mt-3 text-sm font-medium text-slate-700">
              {clinicLabel} • {selectedRangeLabel}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Live</span>
            {lastUpdated ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Updated {new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void loadDashboard({ force: true })}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800"
            >
              Refresh
            </button>
            <div ref={exportMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsExportMenuOpen((current) => !current)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800"
              >
                Export
              </button>
              {isExportMenuOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                  <button
                    type="button"
                    onClick={exportExcel}
                    disabled={!data}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    Export Excel
                  </button>
                  <button
                    type="button"
                    onClick={exportPdfPrint}
                    disabled={!data}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    Export PDF
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-full bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="relative">
        <ReportsControlBar
          clinics={clinics}
          clinicId={clinicId}
          onClinicChange={setClinicId}
          selectedLabel={selectedRangeLabel}
          comparisonLabel={comparisonRangeLabel}
          activePreset={dateSelection.preset}
          quickPresets={QUICK_PRESETS}
          refreshing={refreshing}
          disableNext={!canMoveForward}
          onPresetSelect={handlePresetSelect}
          onOpenDatePicker={() => setIsDatePickerOpen((current) => !current)}
          onPrevious={handleShiftPrevious}
          onNext={handleShiftNext}
        />
        {isDatePickerOpen ? (
          <ReportsDatePickerPopover
            isOpen={isDatePickerOpen}
            todayDate={initialTodayDate}
            startDate={dateSelection.startDate}
            endDate={dateSelection.endDate}
            activePreset={dateSelection.preset}
            onClose={() => setIsDatePickerOpen(false)}
            onPresetSelect={handlePresetSelect}
            onSingleDateSelect={handleSingleDateSelect}
            onRangeApply={handleRangeApply}
          />
        ) : null}
      </div>

      <div className="grid auto-cols-max grid-flow-col gap-2 overflow-x-auto rounded-3xl border border-slate-200 bg-slate-50 p-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
              tab === entry.id
                ? "bg-teal-700 text-white shadow-sm"
                : "bg-white text-slate-600 hover:border-teal-200 hover:text-teal-800"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-rose-900">Unable to load report data.</p>
              <p className="mt-1 text-sm text-rose-700">Your current filters were preserved. Please try again.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadDashboard({ force: true })}
              className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300"
            >
              Try Again
            </button>
          </div>
        </div>
      ) : null}

      {!data && loading ? <ReportsLoadingState /> : null}

      {data ? (
        <div className="space-y-5">
          {noSalesInRange ? (
            <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
              No recorded sales for {selectedRangeLabel}.
            </div>
          ) : null}

          {tab === "overview" ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <ExecutiveKpiCard
                  title="Net Sales"
                  value={formatCurrency(data.overview?.netSales ?? null)}
                  comparison={netSalesComparison.text}
                  comparisonTone={netSalesComparison.tone}
                />
                <ExecutiveKpiCard
                  title="Target Attainment"
                  value={data.overview?.targetProgress == null ? "Not available" : `${data.overview.targetProgress.toFixed(1)}%`}
                  progressPercent={data.overview?.targetProgress ?? null}
                  progressTone={targetTone}
                  note="Against expected pace for the selected period"
                />
                <ExecutiveKpiCard
                  title="Patients"
                  value={String(data.overview?.uniquePatientsSeen ?? 0)}
                  comparison={patientsComparison.text}
                  comparisonTone={patientsComparison.tone}
                />
                <ExecutiveKpiCard
                  title="Completed Visits"
                  value={String(data.overview?.completedVisits ?? 0)}
                  note="Comparison is not currently returned by the dashboard API."
                />
                <ExecutiveKpiCard
                  title="Average per Patient"
                  value={formatCurrency(averagePerPatient)}
                  comparison={averagePerPatientComparison.text}
                  comparisonTone={averagePerPatientComparison.tone}
                />
                <ExecutiveKpiCard
                  title="Outstanding Balance"
                  value={formatCurrency(data.overview?.outstandingBalance ?? null)}
                  comparison={outstandingComparison.text}
                  comparisonTone={outstandingComparison.tone}
                />
              </div>

              <ManagementSnapshotStrip items={managementSnapshot} />

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,1fr)]">
                <SectionCard
                  title="Sales Performance"
                  description="Net sales, target, and target attainment by clinic."
                >
                  {sortedClinicPerformance.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      No clinic performance data for this period.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="h-[360px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={sortedClinicPerformance.map((row) => ({
                              clinicName: row.clinicName,
                              netSales: row.netSales,
                              expectedTarget: row.expectedTarget ?? 0,
                            }))}
                            layout="vertical"
                            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis
                              type="category"
                              dataKey="clinicName"
                              tick={{ fontSize: 12 }}
                              axisLine={false}
                              tickLine={false}
                              width={160}
                            />
                            <Tooltip
                              formatter={(value, name) => [
                                `AED ${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                String(name ?? ""),
                              ]}
                              contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0", fontSize: 12 }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="netSales" name="Net Sales" fill="#0f766e" radius={[0, 6, 6, 0]} />
                            <Bar dataKey="expectedTarget" name="Expected Target" fill="#94a3b8" radius={[0, 6, 6, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                              <th className="pb-2 pr-4 font-semibold">Clinic</th>
                              <th className="pb-2 pr-4 font-semibold">Net Sales</th>
                              <th className="pb-2 pr-4 font-semibold">Target</th>
                              <th className="pb-2 font-semibold">Target %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {sortedClinicPerformance.map((row) => (
                              <tr key={row.clinicId}>
                                <td className="py-3 pr-4 font-semibold text-slate-950">{row.clinicName}</td>
                                <td className="py-3 pr-4 text-slate-800">{formatCurrency(row.netSales)}</td>
                                <td className="py-3 pr-4 text-slate-600">{formatCurrency(row.expectedTarget)}</td>
                                <td className="py-3 text-slate-600">
                                  {row.targetAttainment == null ? "No target" : `${row.targetAttainment.toFixed(1)}%`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </SectionCard>

                <ClinicRankingCard rows={sortedClinicPerformance} formatCurrency={formatCurrency} />
              </div>

              <SectionCard
                title="Cash Management"
                description="Cash collected minus active commissions and expenses for the selected period."
                actions={(
                  <button
                    type="button"
                    onClick={() => setShowCashDeductionDetails((current) => !current)}
                    className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                  >
                    {showCashDeductionDetails ? "Hide Details" : "Open Details"}
                  </button>
                )}
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                  <div className="rounded-3xl border border-teal-200 bg-teal-50 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-700">Cash Collected</p>
                    <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                      {formatCurrency(data.cashManagement.cashCollected)}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Commissions</p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">- {formatCurrency(data.cashManagement.commissionsPaid)}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Expenses</p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">- {formatCurrency(data.cashManagement.expensesPaid)}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-white p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Total Deductions</p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">{formatCurrency(data.cashManagement.totalCashDeductions)}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-950 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">Cash After Deductions</p>
                      <p className="mt-2 text-xl font-semibold text-white">{formatCurrency(data.cashManagement.cashAfterDeductions)}</p>
                    </div>
                  </div>
                </div>

                {showCashDeductionDetails ? (
                  <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200">
                    <table className="min-w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                          <th className="px-4 py-2.5">Date &amp; Time</th>
                          <th className="px-4 py-2.5">Clinic</th>
                          <th className="px-4 py-2.5">Register Session</th>
                          <th className="px-4 py-2.5">Receptionist</th>
                          <th className="px-4 py-2.5">Type</th>
                          <th className="px-4 py-2.5">Paid To</th>
                          <th className="px-4 py-2.5">Description</th>
                          <th className="px-4 py-2.5">Reference</th>
                          <th className="px-4 py-2.5">Amount</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5">Void Info</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {data.cashManagement.details.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="px-4 py-6 text-center text-sm text-slate-400">
                              No commission or expense entries recorded for this range.
                            </td>
                          </tr>
                        ) : (
                          data.cashManagement.details.map((row) => (
                            <tr key={row.id} className="align-top hover:bg-slate-50">
                              <td className="px-4 py-3 text-slate-700">{new Date(row.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}</td>
                              <td className="px-4 py-3 text-slate-700">{row.clinicName}</td>
                              <td className="px-4 py-3 text-slate-500">{row.registerSessionId}</td>
                              <td className="px-4 py-3 text-slate-700">{row.receptionistName}</td>
                              <td className="px-4 py-3 text-slate-700">{row.type === "commission" ? "Commission" : "Expense"}</td>
                              <td className="px-4 py-3 font-medium text-slate-900">{row.paidToName}</td>
                              <td className="px-4 py-3 text-slate-700">{row.description}</td>
                              <td className="px-4 py-3 text-slate-500">{row.referenceNumber || "—"}</td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(row.amount)}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${row.status === "voided" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                                  {row.status === "voided" ? "Voided" : "Active"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-500">
                                {row.status === "voided"
                                  ? `${row.voidedAt ? new Date(row.voidedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" }) : ""}${row.voidedByName ? ` by ${row.voidedByName}` : ""}${row.voidReason ? ` • ${row.voidReason}` : ""}`
                                  : "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </SectionCard>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  { label: "New Patients", value: String(data.overview?.newPatients ?? 0) },
                  { label: "Returning Patients", value: String(data.overview?.returningPatients ?? 0) },
                  { label: "Refunds", value: formatCurrency(data.overview?.refundsTreatmentValue ?? null) },
                  { label: "Birthday Discounts", value: formatCurrency(data.overview?.birthdayDiscounts ?? null) },
                  { label: "Customer Collections", value: formatCurrency(data.overview?.customerCollections ?? null) },
                ].map((item) => (
                  <div key={item.label} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">{item.value}</p>
                  </div>
                ))}
              </div>

              <AttentionPanel items={data.attentionItems} />
            </div>
          ) : null}

          {tab === "clinics_doctors" ? (
            <div className="space-y-5">
              <SectionCard
                title="Clinic Comparison"
                description="Net sales, target pace, previous-period movement, and patient mix by clinic."
              >
                {data.clinicPerformance.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No clinic data for this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                          <th className="px-4 py-3 font-semibold">Clinic</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Net Sales</th>
                          <th className="px-4 py-3 font-semibold">Target</th>
                          <th className="px-4 py-3 font-semibold">Attainment</th>
                          <th className="px-4 py-3 font-semibold">vs Previous</th>
                          <th className="px-4 py-3 font-semibold">Patients</th>
                          <th className="px-4 py-3 font-semibold">Avg / Patient</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sortedClinicPerformance.map((row) => {
                          const comparison = buildPercentComparison(row.previousPeriodChangePercent, overviewComparisonLabel, "higher_better");
                          return (
                            <tr key={row.clinicId} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-950">{row.clinicName}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  row.status === "good" ? "bg-emerald-100 text-emerald-700" :
                                  row.status === "average" ? "bg-amber-100 text-amber-700" :
                                  row.status === "needs_attention" ? "bg-rose-100 text-rose-700" :
                                  "bg-slate-100 text-slate-600"
                                }`}>
                                  {statusIcon(row.status)} {statusLabel(row.status)}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(row.netSales)}</td>
                              <td className="px-4 py-3 text-slate-600">{formatCurrency(row.expectedTarget)}</td>
                              <td className="px-4 py-3"><TargetBar pct={row.targetAttainment} status={row.status} /></td>
                              <td className={`px-4 py-3 text-sm font-semibold ${
                                comparison.tone === "positive" ? "text-emerald-700" :
                                comparison.tone === "negative" ? "text-rose-700" :
                                "text-slate-600"
                              }`}>
                                {comparison.text}
                              </td>
                              <td className="px-4 py-3 text-slate-700">{row.uniquePatients}</td>
                              <td className="px-4 py-3 text-slate-600">{formatCurrency(row.averageNetSalesPerPatient)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Doctor Performance" description="Doctor-level performance from receipts that include doctor assignments.">
                {data.doctorPerformance.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                    <p className="text-sm font-medium text-slate-700">No doctor performance data is available for this period.</p>
                    <p className="mt-1 text-sm text-slate-500">Receipts must have a doctor assigned for doctor-level reporting.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-[0.15em] text-slate-500">
                          <th className="px-4 py-3 font-semibold">Doctor</th>
                          <th className="px-4 py-3 font-semibold">Clinic</th>
                          <th className="px-4 py-3 font-semibold">Patients</th>
                          <th className="px-4 py-3 font-semibold">Visits</th>
                          <th className="px-4 py-3 font-semibold">Net Sales</th>
                          <th className="px-4 py-3 font-semibold">Avg / Patient</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.doctorPerformance.map((row) => (
                          <tr key={row.doctorId} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-semibold text-slate-950">{row.doctorName}</td>
                            <td className="px-4 py-3 text-slate-600">{row.clinicName}</td>
                            <td className="px-4 py-3 text-slate-700">{row.uniquePatients}</td>
                            <td className="px-4 py-3 text-slate-700">{row.completedVisits}</td>
                            <td className="px-4 py-3 font-semibold text-teal-700">{formatCurrency(row.netSales)}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(row.averageNetSalesPerPatient)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
            </div>
          ) : null}

          {tab === "trends_demand" ? (
            <div className="space-y-5">
              <SectionCard
                title="Sales Trend"
                description={salesTrendDescription}
                actions={(
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={yearInput}
                      min={2020}
                      max={2100}
                      onChange={(event) => setYearInput(event.target.value)}
                      onBlur={commitYearInput}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitYearInput();
                        }
                      }}
                      className="w-24 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                    />
                  </div>
                )}
              >
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.trends.sales.points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                      <defs>
                        <linearGradient id="gradNetSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0f766e" stopOpacity={0.18} />
                          <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                      <Tooltip
                        formatter={(value, name) => [
                          `AED ${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                          String(name ?? ""),
                        ]}
                        contentStyle={{ borderRadius: "16px", border: "1px solid #e2e8f0", fontSize: 12 }}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="netSales" stroke="#0f766e" strokeWidth={2.5} fill="url(#gradNetSales)" name="Net Sales" dot={{ r: 3, fill: "#0f766e" }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="target" stroke="#0284c7" strokeWidth={2} strokeDasharray="6 3" name="Target" dot={false} />
                      {showSalesTrendPreviousYear ? (
                        <Line type="monotone" dataKey="previousYear" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" name="Previous Year" dot={false} />
                      ) : null}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="Visit Patterns" description={data.trends.patientDemand.message}>
                {data.trends.patientDemand.historyDays < 90 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Not enough history to show demand patterns. Minimum 90 days of data required.
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Visits by Day of Week</p>
                      <div className="mt-3 h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={data.trends.patientDemand.dayOfWeek} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="weekday" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                            <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                            <Bar dataKey="visits" fill="#0f766e" radius={[6, 6, 0, 0]} name="Visits" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Visits by Week of Month</p>
                      <div className="mt-3 h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={data.trends.patientDemand.dayOfMonthBuckets} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                            <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                            <Bar dataKey="visits" fill="#0284c7" radius={[6, 6, 0, 0]} name="Visits" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>
            </div>
          ) : null}

          {tab === "payments" ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <ExecutiveKpiCard title="Total Collected" value={formatCurrency(data.payments.customerCollections)} />
                <ExecutiveKpiCard title="Cash" value={formatCurrency(paymentMethodTotals.cash)} />
                <ExecutiveKpiCard title="Card" value={formatCurrency(paymentMethodTotals.card)} />
                <ExecutiveKpiCard title="Tabby" value={formatCurrency(paymentMethodTotals.tabby)} />
                <ExecutiveKpiCard title="Tamara" value={formatCurrency(paymentMethodTotals.tamara)} />
                <ExecutiveKpiCard title="Payment Fees Collected" value={formatCurrency(data.payments.paymentFeesCollected)} />
              </div>

              <SectionCard
                title="Payment Methods"
                description="Distribution of payment methods using the existing payments model."
                actions={(
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAmountMode("amount")}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${amountMode === "amount" ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      Amount
                    </button>
                    <button
                      type="button"
                      onClick={() => setAmountMode("count")}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${amountMode === "count" ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      Count
                    </button>
                  </div>
                )}
              >
                {data.payments.methods.every((method) => method.amount <= 0 && method.count <= 0) ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    No payment allocation data for this period.
                  </div>
                ) : (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.payments.methods.map((row) => ({
                            method: methodLabel(row.method),
                            value: amountMode === "amount" ? row.amount : row.count,
                          }))}
                          layout="vertical"
                          margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                          <XAxis type="number" tickFormatter={amountMode === "amount" ? (value) => String(value) : undefined} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="method" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={56} />
                          <Tooltip
                            formatter={(value) =>
                              amountMode === "amount"
                                ? [`AED ${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Amount"]
                                : [value, "Uses"]
                            }
                            contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }}
                          />
                          <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                            {data.payments.methods.map((entry) => (
                              <Cell key={entry.method} fill={METHOD_COLORS[entry.method] || "#94a3b8"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="flex flex-col justify-center rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mx-auto h-52 w-full max-w-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={data.payments.methods.filter((method) => (amountMode === "amount" ? method.amount : method.count) > 0)}
                              dataKey={amountMode === "amount" ? "amount" : "count"}
                              nameKey="method"
                              cx="50%"
                              cy="50%"
                              innerRadius="56%"
                              outerRadius="82%"
                              paddingAngle={3}
                            >
                              {data.payments.methods.map((entry) => (
                                <Cell key={entry.method} fill={METHOD_COLORS[entry.method] || "#94a3b8"} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value) =>
                                amountMode === "amount"
                                  ? [`AED ${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Amount"]
                                  : [value, "Uses"]
                              }
                              contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-2">
                        {paymentMethodLegend.map((method) => (
                          <div key={method.method} className="flex items-center gap-1 text-[11px] text-slate-600">
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: METHOD_COLORS[method.method] || "#94a3b8" }} />
                            {method.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {data.payments.missingAllocationCoverage ? (
                  <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs text-amber-700">
                    Some historical receipts lack allocation records, so split-payment breakdown is incomplete for those receipts.
                  </p>
                ) : null}
              </SectionCard>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "Customer Refunds", value: formatCurrency(data.payments.customerRefunds) },
                  { label: "Provider Deductions", value: data.payments.providerDeductionsAvailable ? formatCurrency(data.payments.providerDeductions) : "Not available" },
                  { label: "Net Settlement", value: data.payments.netSettlement == null ? "Not available" : formatCurrency(data.payments.netSettlement) },
                  { label: "Method Uses", value: String(data.payments.paymentMethodUses) },
                  { label: "Commissions Paid", value: formatCurrency(data.cashManagement.commissionsPaid) },
                  { label: "Expenses Paid", value: formatCurrency(data.cashManagement.expensesPaid) },
                ].map((card) => (
                  <div key={card.label} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{card.label}</p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">{card.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </ReportsFrame>
  );
}
