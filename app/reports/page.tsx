"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import {
  buildComparisonRange,
  buildDashboardRange,
  DashboardPeriod,
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
    targetProgress: number | null;
    customerCollections: number;
    customerCollectionsCompare: number;
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
  attentionItems: string[];
};

type DashboardTab = "overview" | "clinics_doctors" | "trends_demand" | "payments";

const PERIOD_OPTIONS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_year", label: "This Year" },
  { value: "custom", label: "Custom" },
];

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "clinics_doctors", label: "Clinics & Doctors" },
  { id: "trends_demand", label: "Trends" },
  { id: "payments", label: "Payments" },
];

// Per-method palette
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

function deltaClass(value: number | null, direction: "higher_better" | "lower_better") {
  if (value == null) return "text-slate-400";
  const positive = direction === "higher_better" ? value >= 0 : value <= 0;
  return positive ? "text-emerald-600" : "text-rose-600";
}

function deltaPrefix(value: number | null) {
  if (value == null) return null;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function comparisonPhrase(value: number | null, direction: "higher_better" | "lower_better") {
  if (value == null) return "No comparable data";
  const improving = direction === "higher_better" ? value >= 0 : value <= 0;
  const magnitude = Math.abs(value).toFixed(1);
  return improving ? `Improved ${magnitude}%` : `Declined ${magnitude}%`;
}

function aedShort(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toFixed(0);
}

function aedAxisFormatter(value: number) {
  return `${aedShort(value)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aedTooltipFormatter(value: any, name: string) {
  const num = typeof value === "number" ? value : Number(value);
  return [`AED ${(isFinite(num) ? num : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];
}

// â”€â”€ Skeleton â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-100 ${className || ""}`} />;
}

function SkeletonKpiCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="mt-3 h-7 w-32" />
          <SkeletonBlock className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTable({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBlock key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 border-t border-slate-50 pt-2">
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonBlock key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// â”€â”€ Summary Banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SummaryBanner({ data }: { data: DashboardResponse }) {
  const total = data.clinicPerformance.length;
  const counts = {
    good: data.clinicPerformance.filter((c) => c.status === "good").length,
    average: data.clinicPerformance.filter((c) => c.status === "average").length,
    needs: data.clinicPerformance.filter((c) => c.status === "needs_attention").length,
    missing: data.clinicPerformance.filter((c) => c.status === "no_target_set").length,
  };
  const summary = counts.good || counts.average || counts.needs || counts.missing
    ? `${counts.good} Good | ${counts.average} Average | ${counts.needs} Needs Attention${counts.missing ? ` | ${counts.missing} No Target Set` : ""}`
    : "Unable to calculate status";
  const note = counts.needs > 0
    ? `${counts.needs} clinic${counts.needs > 1 ? "s" : ""} need attention`
    : counts.missing > 0
      ? `${counts.missing} clinic${counts.missing > 1 ? "s" : ""} have no target set`
      : total > 0
        ? `All ${total} clinics on pace`
        : "No clinic status available";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-slate-900">{summary}</p>
        <p className="text-xs text-slate-500">{note}</p>
      </div>
    </div>
  );
}

// â”€â”€ KPI Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type KpiCardProps = {
  title: string;
  value: number | null;
  compare: number | null;
  direction: "higher_better" | "lower_better";
  isPercent?: boolean;
  plainNumber?: boolean;
  accent?: string;
  note?: string;
  comparisonLabel?: string;
};

function KpiCard({ title, value, compare, direction, isPercent, plainNumber, accent = "bg-teal-500", note, comparisonLabel }: KpiCardProps) {
  const displayValue = value == null
    ? "Not available"
    : isPercent
      ? `${value.toFixed(1)}%`
      : plainNumber
        ? String(Math.round(value))
        : formatCurrency(value);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={`absolute left-0 top-0 h-full w-1 rounded-l-2xl ${accent}`} />
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-slate-900">{displayValue}</p>
      {note && <p className="mt-1 text-[11px] text-slate-500">{note}</p>}
      <div className="mt-2 flex items-center gap-1">
        <span className={`text-xs font-medium ${deltaClass(compare, direction)}`}>
          {compare == null ? "No comparable data" : `${comparisonPhrase(compare, direction)}${comparisonLabel ? ` vs ${comparisonLabel}` : ""}`}
        </span>
      </div>
    </div>
  );
}

// â”€â”€ Target progress bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function TargetBar({ pct, status }: { pct: number | null; status: string }) {
  if (pct == null) return <span className="text-xs text-slate-400">No target</span>;
  const capped = Math.min(pct, 100);
  const color =
    status === "good" ? "bg-emerald-500" :
    status === "average" ? "bg-amber-400" :
    "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 flex-shrink-0 overflow-hidden rounded-full bg-slate-100 sm:w-24">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${capped}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-700">{pct.toFixed(0)}%</span>
    </div>
  );
}

// â”€â”€ Export helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        <div class="kpi"><div class="label">Net Sales</div><div class="value">${formatCurrency(data.overview?.netSales)}</div></div>
        <div class="kpi"><div class="label">Target Pace</div><div class="value">${data.overview?.targetProgress == null ? "Not available" : `${data.overview.targetProgress.toFixed(1)}%`}</div></div>
        <div class="kpi"><div class="label">Customer Collections</div><div class="value">${formatCurrency(data.overview?.customerCollections)}</div></div>
        <div class="kpi"><div class="label">Outstanding Balance</div><div class="value">${formatCurrency(data.overview?.outstandingBalance)}</div></div>
      </div>
      <h2>Clinic Comparison</h2>
      <table>
        <thead><tr><th>Clinic</th><th>Net Sales</th><th>Expected Target</th><th>Target Attainment</th><th>Status</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5">No data</td></tr>`}</tbody>
      </table>
    </body>
  </html>`;
}

// â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function ReportsPage() {
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const [clinicId, setClinicId] = useState<string>("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [amountMode, setAmountMode] = useState<"amount" | "count">("amount");
  const [clinics, setClinics] = useState<Array<{ id: string; name: string }>>([]);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const inFlightRef = useRef(false);

  useEffect(() => {
    supabase.from("clinics").select("id, name").order("name", { ascending: true }).then(({ data: rows }) => {
      setClinics((rows || []) as Array<{ id: string; name: string }>);
    });
  }, []);

  const loadDashboard = useCallback(async (options?: { background?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const background = !!options?.background;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/reports/ceo-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          period,
          clinicId: clinicId || null,
          customStart: period === "custom" ? customStart : null,
          customEnd: period === "custom" ? customEnd : null,
          year: selectedYear,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load CEO dashboard.");
      }
      setData(payload as DashboardResponse);
      setLastUpdated(new Date().toISOString());
    } catch (fetchError) {
      setData(null);
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        setError("Dashboard request timed out. Please retry.");
      } else {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load CEO dashboard.");
      }
    } finally {
      clearTimeout(timeoutId);
      inFlightRef.current = false;
      if (background) setRefreshing(false);
      else setLoading(false);
    }
  }, [period, clinicId, customStart, customEnd, selectedYear]);

  useEffect(() => {
    if (period === "custom" && (!customStart || !customEnd)) return;
    loadDashboard();
  }, [period, clinicId, customStart, customEnd, selectedYear, loadDashboard]);

  useEffect(() => {
    if (period !== "today") return;
    const channel = supabase
      .channel("ceo-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "receipts" }, () => loadDashboard({ background: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "refunds" }, () => loadDashboard({ background: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_records" }, () => loadDashboard({ background: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_allocations" }, () => loadDashboard({ background: true }))
      .on("postgres_changes", { event: "*", schema: "public", table: "balance_payments" }, () => loadDashboard({ background: true }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [period, loadDashboard]);

  const currentRangeLabel = useMemo(() => {
    if (data?.meta.currentRange) {
      return `${data.meta.currentRange.startDubaiDate} - ${data.meta.currentRange.endDubaiDate}`;
    }
    try {
      const current = buildDashboardRange({ period, customStart, customEnd });
      return `${current.startDubaiDate} - ${current.endDubaiDate}`;
    } catch { return "Select a valid range"; }
  }, [data, period, customStart, customEnd]);

  const compareRangeLabel = useMemo(() => {
    if (data?.meta.compareRange) {
      return `${data.meta.compareRange.label}: ${data.meta.compareRange.startDubaiDate} - ${data.meta.compareRange.endDubaiDate}`;
    }
    try {
      const current = buildDashboardRange({ period, customStart, customEnd });
      const previous = buildComparisonRange(current);
      return `${previous.label}: ${previous.startDubaiDate} - ${previous.endDubaiDate}`;
    } catch { return ""; }
  }, [data, period, customStart, customEnd]);

  const clinicLabel = clinicId
    ? clinics.find((c) => c.id === clinicId)?.name || "Selected Clinic"
    : "All Clinics";

  const exportExcel = () => {
    if (!data) return;
    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["CEO Dashboard Summary"], [""],
      ["Clinic", clinicLabel],
      ["Period", `${data.meta.currentRange.label} (${currentRangeLabel})`],
      ["Comparison", compareRangeLabel],
      ["Generated", new Date(data.meta.lastUpdatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })],
      [""],
      ["Net Sales", data.overview?.netSales ?? ""],
      ["Customer Collections", data.overview?.customerCollections ?? ""],
      ["Outstanding Balance", data.overview?.outstandingBalance ?? ""],
      ["Unique Patients Seen", data.overview?.uniquePatientsSeen ?? ""],
      ["Completed Visits", data.overview?.completedVisits ?? ""],
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

    XLSX.writeFile(workbook, `CEO_Dashboard_${new Date().toLocaleDateString("en-CA")}.xlsx`);
  };

  const exportPdfPrint = () => {
    if (!data) return;
    const html = renderExportHtml(data, clinicLabel, currentRangeLabel, compareRangeLabel);
    printHtmlWhenImagesReady(html, "Please allow popups to print the CEO dashboard report.");
  };

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <AppFrame title="CEO Dashboard" description="Executive dashboard for net sales, targets, demand, and payments.">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">CEO Dashboard</h1>
              <p className="mt-1 text-xs text-slate-500">{clinicLabel} | {currentRangeLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 sm:justify-end">
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">Live</span>
              {lastUpdated && (
                <span className="rounded-full bg-slate-100 px-2 py-1">
                  Updated {new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <button onClick={exportExcel} disabled={!data} className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 disabled:opacity-40">Export</button>
              {error && (
                <button onClick={() => loadDashboard()} className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>

        {/* â”€â”€ Global filters â”€â”€ */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:items-end lg:gap-3">
            <div className="col-span-2 sm:col-span-1 lg:flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">Clinic</label>
              <select
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-100"
              >
                <option value="">All Clinics</option>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-100"
              >
                {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Year trend</label>
              <input
                type="number" value={selectedYear} min={2020} max={2100}
                onChange={(e) => setSelectedYear(Number(e.target.value || new Date().getFullYear()))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-100"
              />
            </div>
            {period === "custom" && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Start</label>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">End</label>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400" />
                </div>
              </>
            )}
          </div>

          {/* Status bar */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-slate-700">{currentRangeLabel}</span>
              {compareRangeLabel && <span className="ml-2 hidden sm:inline">| {compareRangeLabel}</span>}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {refreshing && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">Refreshing...</span>}
              {lastUpdated && <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 sm:inline">{new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
              <button onClick={exportExcel} disabled={!data} className="rounded-lg bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Excel</button>
              <button onClick={exportPdfPrint} disabled={!data} className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 disabled:opacity-40">PDF</button>
            </div>
          </div>
        </div>

        {/* â”€â”€ Tabs â”€â”€ */}
        <div className="grid grid-cols-4 gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              className={`rounded-xl px-2 py-2 text-[11px] font-semibold leading-tight transition-all sm:text-xs ${tab === entry.id ? "bg-teal-700 text-white shadow-sm" : "bg-white text-slate-600 border border-slate-200 hover:border-teal-200"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {/* â”€â”€ Loading skeleton â”€â”€ */}
        {loading && (
          <div className="space-y-4">
            <SkeletonBlock className="h-12 w-full" />
            <SkeletonKpiCards />
            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <SkeletonTable />
            </div>
          </div>
        )}

        {/* â”€â”€ Error â”€â”€ */}
        {!loading && error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â• OVERVIEW â•â•â•â•â•â•â•â•â•â• */}
        {!loading && !error && data && tab === "overview" && (
          <div className="space-y-4">
            <SummaryBanner data={data} />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                title="Net Sales"
                value={data.overview?.netSales ?? null}
                compare={percentageChange(data.overview?.netSales ?? null, data.overview?.netSalesCompare ?? null)}
                direction="higher_better"
                comparisonLabel={data.meta.compareRange.label}
              />
              <KpiCard
                title="Target Pace"
                value={data.overview?.targetProgress ?? null}
                compare={null}
                direction="higher_better"
                isPercent
                note="Against expected pace as of the selected date"
              />
              <KpiCard
                title="Customer Collections"
                value={data.overview?.customerCollections ?? null}
                compare={percentageChange(data.overview?.customerCollections ?? null, data.overview?.customerCollectionsCompare ?? null)}
                direction="higher_better"
                comparisonLabel={data.meta.compareRange.label}
              />
              <KpiCard
                title="Outstanding Balance"
                value={data.overview?.outstandingBalance ?? null}
                compare={percentageChange(data.overview?.outstandingBalance ?? null, data.overview?.outstandingBalanceCompare ?? null)}
                direction="lower_better"
                comparisonLabel={data.meta.compareRange.label}
              />
            </div>

            {/* Secondary metrics */}
            {data.overview && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                {[
                  { label: "Unique Patients", value: data.overview.uniquePatientsSeen },
                  { label: "Completed Visits", value: data.overview.completedVisits },
                  { label: "New Patients", value: data.overview.newPatients },
                  { label: "Returning Patients", value: data.overview.returningPatients },
                  { label: "Refunds", value: null, display: formatCurrency(data.overview.refundsTreatmentValue) },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <p className="text-[11px] font-medium text-slate-500">{item.label}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                      {item.display ?? String(item.value ?? 0)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(280px,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Net Sales vs Expected Target</h3>
                    <p className="mt-1 text-xs text-slate-500">Clinic performance in the selected period.</p>
                  </div>
                </div>
                <div className="mt-4 h-56 w-full sm:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.clinicPerformance} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="clinicName" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={aedAxisFormatter} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                      <Tooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(value: any, name: any) => [`AED ${(+value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name]}
                        contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="netSales" name="Net Sales" fill="#0f766e" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="expectedTarget" name="Expected Target" fill="#94a3b8" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-4">
                <SummaryBanner data={data} />

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900">Clinic Pace</h3>
                  <div className="mt-3 space-y-3">
                    {data.clinicPerformance.map((row) => (
                      <div key={row.clinicId}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">{row.clinicName}</p>
                            <p className="text-xs text-slate-500">{formatCurrency(row.netSales)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-slate-600">{statusLabel(row.status)}</p>
                            <p className="text-xs tabular-nums text-slate-500">{row.targetAttainment == null ? "No target" : `${row.targetAttainment.toFixed(0)}% pace`}</p>
                          </div>
                        </div>
                        <div className="mt-1.5">
                          <TargetBar pct={row.targetAttainment} status={row.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {data.attentionItems.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <h3 className="text-sm font-semibold text-amber-900">Needs Attention</h3>
                    <ul className="mt-2 space-y-1">
                      {data.attentionItems.map((item) => (
                        <li key={item} className="text-sm text-amber-900">- {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                  Net sales excludes VAT, discounts, and refunded treatment value.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â• CLINICS & DOCTORS â•â•â•â•â•â•â•â•â•â• */}
        {!loading && !error && data && tab === "clinics_doctors" && (
          <div className="space-y-4">
            {/* Clinic cards on mobile, table on desktop */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-bold text-slate-900">Clinic Ranking</h3>
              </div>
              {data.clinicPerformance.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">No clinic data for this period.</p>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="divide-y divide-slate-100 sm:hidden">
                    {data.clinicPerformance.map((row) => (
                      <div key={row.clinicId} className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{row.clinicName}</p>
                            <p className="mt-0.5 text-xs text-slate-500">{row.uniquePatients} patients</p>
                          </div>
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            row.status === "good" ? "bg-emerald-100 text-emerald-700" :
                            row.status === "average" ? "bg-amber-100 text-amber-700" :
                            row.status === "needs_attention" ? "bg-rose-100 text-rose-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>
                            {statusIcon(row.status)} {statusLabel(row.status)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-slate-500">Net Sales</p>
                            <p className="font-bold text-slate-800">{formatCurrency(row.netSales)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Target</p>
                            <p className="font-bold text-slate-800">{formatCurrency(row.expectedTarget)}</p>
                          </div>
                        </div>
                        <div className="mt-2">
                          <TargetBar pct={row.targetAttainment} status={row.status} />
                        </div>
                        {row.previousPeriodChangePercent != null && (
                          <p className={`mt-1 text-xs font-semibold ${deltaClass(row.previousPeriodChangePercent, "higher_better")}`}>
                            {comparisonPhrase(row.previousPeriodChangePercent, "higher_better")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="min-w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                          <th className="px-4 py-2.5">Clinic</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5">Net Sales</th>
                          <th className="px-4 py-2.5">Target</th>
                          <th className="px-4 py-2.5">Attainment</th>
                          <th className="px-4 py-2.5">vs Prior</th>
                          <th className="px-4 py-2.5">Patients</th>
                          <th className="px-4 py-2.5">Avg/Patient</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.clinicPerformance.map((row) => (
                          <tr key={row.clinicId} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-semibold text-slate-900">{row.clinicName}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                row.status === "good" ? "bg-emerald-100 text-emerald-700" :
                                row.status === "average" ? "bg-amber-100 text-amber-700" :
                                row.status === "needs_attention" ? "bg-rose-100 text-rose-700" :
                                "bg-slate-100 text-slate-600"
                              }`}>
                                {statusIcon(row.status)} {statusLabel(row.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold">{formatCurrency(row.netSales)}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(row.expectedTarget)}</td>
                            <td className="px-4 py-3"><TargetBar pct={row.targetAttainment} status={row.status} /></td>
                            <td className={`px-4 py-3 font-semibold ${deltaClass(row.previousPeriodChangePercent, "higher_better")}`}>
                              {comparisonPhrase(row.previousPeriodChangePercent, "higher_better")}
                            </td>
                            <td className="px-4 py-3">{row.uniquePatients}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(row.averageNetSalesPerPatient)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Doctor Performance */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-bold text-slate-900">Doctor Performance</h3>
              </div>
              {data.doctorPerformance.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-400">
                  No doctor data for this period. Receipts must have a doctor assigned.
                </p>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="divide-y divide-slate-100 sm:hidden">
                    {data.doctorPerformance.map((row) => (
                      <div key={row.doctorId} className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{row.doctorName}</p>
                            <p className="text-xs text-slate-500">{row.clinicName}</p>
                          </div>
                          <p className="text-sm font-bold text-teal-700">{formatCurrency(row.netSales)}</p>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                          <div><p className="text-slate-400">Visits</p><p className="font-semibold">{row.completedVisits}</p></div>
                          <div><p className="text-slate-400">Patients</p><p className="font-semibold">{row.uniquePatients}</p></div>
                          <div><p className="text-slate-400">Avg/Patient</p><p className="font-semibold">{formatCurrency(row.averageNetSalesPerPatient)}</p></div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop table */}
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="min-w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                          <th className="px-4 py-2.5">Doctor</th>
                          <th className="px-4 py-2.5">Clinic</th>
                          <th className="px-4 py-2.5">Patients</th>
                          <th className="px-4 py-2.5">Visits</th>
                          <th className="px-4 py-2.5">Net Sales</th>
                          <th className="px-4 py-2.5">Avg/Patient</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.doctorPerformance.map((row) => (
                          <tr key={row.doctorId} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-semibold text-slate-900">{row.doctorName}</td>
                            <td className="px-4 py-3 text-slate-600">{row.clinicName}</td>
                            <td className="px-4 py-3">{row.uniquePatients}</td>
                            <td className="px-4 py-3">{row.completedVisits}</td>
                            <td className="px-4 py-3 font-semibold text-teal-700">{formatCurrency(row.netSales)}</td>
                            <td className="px-4 py-3 text-slate-600">{formatCurrency(row.averageNetSalesPerPatient)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â• TRENDS & DEMAND â•â•â•â•â•â•â•â•â•â• */}
        {!loading && !error && data && tab === "trends_demand" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">Annual Performance - {selectedYear}</h3>
              <p className="mt-0.5 text-xs text-slate-500">Net Sales vs Monthly Target vs Previous Year</p>
              <div className="mt-3 h-64 w-full sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trends.monthly} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="gradNetSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0f766e" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={aedAxisFormatter} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(v: any, n: any) => [`AED ${(+v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, n]}
                      contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="netSales" stroke="#0f766e" strokeWidth={2.5} fill="url(#gradNetSales)" name="Net Sales" dot={{ r: 3, fill: "#0f766e" }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="target" stroke="#0284c7" strokeWidth={2} strokeDasharray="6 3" name="Target" dot={false} />
                    <Line type="monotone" dataKey="previousYear" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" name="Prev Year" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">Patient Demand Patterns</h3>
              <p className="mt-0.5 text-xs text-slate-500">{data.trends.patientDemand.message}</p>

              {data.trends.patientDemand.historyDays < 90 ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Not enough history to show demand patterns. Minimum 90 days of data required.
                </div>
              ) : (
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600">Visits by Day of Week</p>
                    <div className="h-48 w-full sm:h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.trends.patientDemand.dayOfWeek} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="weekday" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                          <Bar dataKey="visits" fill="#0f766e" radius={[4, 4, 0, 0]} name="Visits" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600">Visits by Week of Month</p>
                    <div className="h-48 w-full sm:h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.trends.patientDemand.dayOfMonthBuckets} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                          <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                          <Bar dataKey="visits" fill="#0284c7" radius={[4, 4, 0, 0]} name="Visits" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â• PAYMENTS â•â•â•â•â•â•â•â•â•â• */}
        {!loading && !error && data && tab === "payments" && (() => {
          const hasAnyPayment = data.payments.methods.some((m) => m.amount > 0 || m.count > 0);
          const totalAmount = data.payments.methods.reduce((s, m) => s + m.amount, 0);
          return (
            <div className="space-y-4">
              {/* Method chart + donut */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Payment Methods</h3>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setAmountMode("amount")}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${amountMode === "amount" ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >Amount</button>
                    <button
                      onClick={() => setAmountMode("count")}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${amountMode === "count" ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                    >Count</button>
                  </div>
                </div>

                {!hasAnyPayment ? (
                  <p className="mt-6 text-center text-sm text-slate-400">No payment allocation data for this period.</p>
                ) : (
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    {/* Bar chart */}
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.payments.methods.map((row) => ({
                            method: methodLabel(row.method),
                            value: amountMode === "amount" ? row.amount : row.count,
                            fill: METHOD_COLORS[row.method] || "#94a3b8",
                          }))}
                          margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="method" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                          <YAxis tickFormatter={amountMode === "amount" ? aedAxisFormatter : undefined} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
                          <Tooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={(value: any) =>
                              amountMode === "amount"
                                ? [`AED ${(+value || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Amount"]
                                : [value, "Uses"]
                            }
                            contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }}
                          />
                          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                            {data.payments.methods.map((entry) => (
                              <Cell key={entry.method} fill={METHOD_COLORS[entry.method] || "#94a3b8"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Donut share chart */}
                    <div className="flex flex-col items-center justify-center">
                      <p className="mb-2 text-xs font-semibold text-slate-600">
                        {amountMode === "amount" ? "Share of Net Amount" : "Share of Uses"}
                      </p>
                      <div className="h-44 w-full max-w-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={data.payments.methods.filter((m) => (amountMode === "amount" ? m.amount : m.count) > 0)}
                              dataKey={amountMode === "amount" ? "amount" : "count"}
                              nameKey="method"
                              cx="50%" cy="50%"
                              innerRadius="55%" outerRadius="80%"
                              paddingAngle={3}
                              label={({ method, percent }) => (percent ?? 0) > 0.05 ? `${methodLabel(method as string)} ${((percent ?? 0) * 100).toFixed(0)}%` : ""}
                              labelLine={false}
                            >
                              {data.payments.methods.map((entry) => (
                                <Cell key={entry.method} fill={METHOD_COLORS[entry.method] || "#94a3b8"} />
                              ))}
                            </Pie>
                            <Tooltip
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              formatter={(value: any) =>
                                amountMode === "amount"
                                  ? [`AED ${(+value || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, "Amount"]
                                  : [value, "Uses"]
                              }
                              contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      {/* Legend dots */}
                      <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
                        {data.payments.methods.map((m) => (
                          <div key={m.method} className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: METHOD_COLORS[m.method] || "#94a3b8" }} />
                            <span className="text-[11px] text-slate-600">{methodLabel(m.method)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {amountMode === "amount" && totalAmount > 0 && (
                  <p className="mt-3 text-right text-xs text-slate-500">
                    Total net: <span className="font-semibold text-slate-700">AED {totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </p>
                )}
                {data.payments.missingAllocationCoverage && (
                  <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                    Some historical receipts lack allocation records - split-payment breakdown for those receipts is unavailable.
                  </p>
                )}
              </div>

              {/* Payment summary cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: "Payment Fees Collected", value: formatCurrency(data.payments.paymentFeesCollected), accent: "border-l-violet-400" },
                  { label: "Customer Collections", value: formatCurrency(data.payments.customerCollections), accent: "border-l-teal-500" },
                  { label: "Customer Refunds", value: formatCurrency(data.payments.customerRefunds), accent: "border-l-rose-400" },
                  { label: "Provider Deductions", value: data.payments.providerDeductionsAvailable ? formatCurrency(data.payments.providerDeductions) : "Not available", accent: "border-l-slate-300" },
                  { label: "Net Settlement", value: data.payments.netSettlement == null ? "Not available" : formatCurrency(data.payments.netSettlement), accent: "border-l-slate-300" },
                  { label: "Method Uses", value: String(data.payments.paymentMethodUses), accent: "border-l-sky-400" },
                ].map((card) => (
                  <div key={card.label} className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm`}>
                    <div className={`absolute left-0 top-0 h-full w-1 rounded-l-2xl ${card.accent}`} />
                    <p className="text-xs font-medium text-slate-500">{card.label}</p>
                    <p className="mt-1.5 text-lg font-bold text-slate-900">{card.value}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      </div>
    </AppFrame>
  );
}
