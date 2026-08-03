"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx-js-style";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
  { value: "custom", label: "Custom Date Range" },
];

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "clinics_doctors", label: "Clinics & Doctors" },
  { id: "trends_demand", label: "Trends & Patient Demand" },
  { id: "payments", label: "Payments" },
];

function deltaClass(value: number | null, direction: "higher_better" | "lower_better") {
  if (value == null) return "text-slate-500";
  const positive = direction === "higher_better" ? value >= 0 : value <= 0;
  return positive ? "text-emerald-700" : "text-rose-700";
}

function deltaPrefix(value: number | null) {
  if (value == null) return "Not available";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function methodLabel(method: string) {
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  if (method === "tabby") return "Tabby";
  if (method === "tamara") return "Tamara";
  return method;
}

function renderExportHtml(data: DashboardResponse) {
  const rows = data.clinicPerformance
    .map((row) => `
      <tr>
        <td>${row.clinicName}</td>
        <td>AED ${row.netSales.toFixed(2)}</td>
        <td>${row.expectedTarget == null ? "Not available" : `AED ${row.expectedTarget.toFixed(2)}`}</td>
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
        Clinic: ${data.meta.clinicId || "All Clinics"}<br/>
        Period: ${data.meta.currentRange.label} (${data.meta.currentRange.startDubaiDate} - ${data.meta.currentRange.endDubaiDate})<br/>
        Comparison: ${data.meta.compareRange.label} (${data.meta.compareRange.startDubaiDate} - ${data.meta.compareRange.endDubaiDate})<br/>
        Time Zone: ${data.meta.timezone}<br/>
        Generated: ${new Date(data.meta.lastUpdatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}
      </div>
      <div class="kpis">
        <div class="kpi"><div class="label">Net Sales</div><div class="value">${formatCurrency(data.overview?.netSales)}</div></div>
        <div class="kpi"><div class="label">Target Progress</div><div class="value">${data.overview?.targetProgress == null ? "Not available" : `${data.overview.targetProgress.toFixed(1)}%`}</div></div>
        <div class="kpi"><div class="label">Customer Collections</div><div class="value">${formatCurrency(data.overview?.customerCollections)}</div></div>
        <div class="kpi"><div class="label">Outstanding Balance</div><div class="value">${formatCurrency(data.overview?.outstandingBalance)}</div></div>
      </div>
      <h2>Clinic Comparison</h2>
      <table>
        <thead>
          <tr>
            <th>Clinic</th>
            <th>Net Sales</th>
            <th>Expected Target</th>
            <th>Target Attainment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="5">No data</td></tr>`}</tbody>
      </table>
    </body>
  </html>`;
}

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
        setError("Dashboard request timed out. Please retry and check Supabase query performance.");
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
    return () => {
      supabase.removeChannel(channel);
    };
  }, [period, loadDashboard]);

  const currentRangeLabel = useMemo(() => {
    if (data?.meta.currentRange) {
      return `${data.meta.currentRange.startDubaiDate} - ${data.meta.currentRange.endDubaiDate}`;
    }
    try {
      const current = buildDashboardRange({ period, customStart, customEnd });
      return `${current.startDubaiDate} - ${current.endDubaiDate}`;
    } catch {
      return "Select a valid range";
    }
  }, [data, period, customStart, customEnd]);

  const compareRangeLabel = useMemo(() => {
    if (data?.meta.compareRange) {
      return `${data.meta.compareRange.label}: ${data.meta.compareRange.startDubaiDate} - ${data.meta.compareRange.endDubaiDate}`;
    }
    try {
      const current = buildDashboardRange({ period, customStart, customEnd });
      const previous = buildComparisonRange(current);
      return `${previous.label}: ${previous.startDubaiDate} - ${previous.endDubaiDate}`;
    } catch {
      return "";
    }
  }, [data, period, customStart, customEnd]);

  const clinicLabel = clinicId
    ? clinics.find((clinic) => clinic.id === clinicId)?.name || "Selected Clinic"
    : "All Clinics";

  const exportExcel = () => {
    if (!data) return;
    const workbook = XLSX.utils.book_new();
    const summaryRows = [
      ["CEO Dashboard Summary"],
      [""],
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

    const clinicSheetRows = [
      ["Clinic", "Status", "Net Sales", "Expected Target", "Target Attainment %", "Previous Period Change %", "Unique Patients", "Avg Net Sales / Patient"],
      ...data.clinicPerformance.map((row) => [
        row.clinicName,
        statusLabel(row.status),
        row.netSales,
        row.expectedTarget ?? "",
        row.targetAttainment ?? "",
        row.previousPeriodChangePercent ?? "",
        row.uniquePatients,
        row.averageNetSalesPerPatient,
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(clinicSheetRows), "Clinic Comparison");

    const doctorSheetRows = [
      ["Doctor", "Clinic", "Unique Patients", "Completed Visits", "Net Sales", "Avg Net Sales / Patient"],
      ...data.doctorPerformance.map((row) => [
        row.doctorName,
        row.clinicName,
        row.uniquePatients,
        row.completedVisits,
        row.netSales,
        row.averageNetSalesPerPatient,
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(doctorSheetRows), "Doctor Performance");

    const trendRows = [
      ["Month", "Net Sales", "Target", "Previous Year", "Below Target"],
      ...data.trends.monthly.map((row) => [row.month, row.netSales, row.target ?? "", row.previousYear ?? "", row.belowTarget == null ? "" : row.belowTarget ? "Yes" : "No"]),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(trendRows), "Monthly Trends");

    const demandRows = [
      ["Patient Demand Patterns"],
      ["History Days", data.trends.patientDemand.historyDays],
      ["Message", data.trends.patientDemand.message],
      [""],
      ["Day of Week", "Visits", "Average per Open Day"],
      ...data.trends.patientDemand.dayOfWeek.map((row) => [row.weekday, row.visits, row.averagePerOpenDay ?? ""]),
      [""],
      ["Day-of-Month Bucket", "Visits"],
      ...data.trends.patientDemand.dayOfMonthBuckets.map((row) => [row.label, row.visits]),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(demandRows), "Patient Demand");

    const paymentRows = [
      ["Method", "Amount (Treatment Net)", "Payment Method Uses"],
      ...data.payments.methods.map((row) => [methodLabel(row.method), row.amount, row.count]),
      [""],
      ["Payment Fees Collected", data.payments.paymentFeesCollected],
      ["Customer Collections", data.payments.customerCollections],
      ["Customer Refunds", data.payments.customerRefunds],
      ["Provider Deductions", data.payments.providerDeductionsAvailable ? data.payments.providerDeductions ?? "" : "Not available"],
      ["Net Settlement", data.payments.netSettlement == null ? "Not available" : data.payments.netSettlement],
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(paymentRows), "Payments");

    XLSX.writeFile(workbook, `CEO_Dashboard_${new Date().toLocaleDateString("en-CA")}.xlsx`);
  };

  const exportPdfPrint = () => {
    if (!data) return;
    const html = renderExportHtml(data);
    printHtmlWhenImagesReady(html, "Please allow popups to print the CEO dashboard report.");
  };

  const overviewKpis = [
    {
      title: "Net Sales",
      value: data?.overview?.netSales ?? null,
      compare: percentageChange(data?.overview?.netSales ?? null, data?.overview?.netSalesCompare ?? null),
      direction: "higher_better" as const,
    },
    {
      title: "Target Progress",
      value: data?.overview?.targetProgress ?? null,
      compare: null,
      direction: "higher_better" as const,
      isPercent: true,
    },
    {
      title: "Customer Collections",
      value: data?.overview?.customerCollections ?? null,
      compare: percentageChange(data?.overview?.customerCollections ?? null, data?.overview?.customerCollectionsCompare ?? null),
      direction: "higher_better" as const,
    },
    {
      title: "Outstanding Balance",
      value: data?.overview?.outstandingBalance ?? null,
      compare: percentageChange(data?.overview?.outstandingBalance ?? null, data?.overview?.outstandingBalanceCompare ?? null),
      direction: "lower_better" as const,
    },
    {
      title: "Unique Patients Seen",
      value: data?.overview?.uniquePatientsSeen ?? null,
      compare: percentageChange(data?.overview?.uniquePatientsSeen ?? null, data?.overview?.uniquePatientsSeenCompare ?? null),
      direction: "higher_better" as const,
      plainNumber: true,
    },
  ];

  return (
    <AppFrame title="CEO Dashboard" description="Executive dashboard for net sales, targets, demand, and payments.">
      <div className="space-y-5">
        <div className="rounded-2xl border border-teal-100 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Clinic</label>
              <select
                value={clinicId}
                onChange={(event) => setClinicId(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300"
              >
                <option value="">All Clinics</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Period</label>
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300"
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Year Trend</label>
              <input
                type="number"
                value={selectedYear}
                min={2020}
                max={2100}
                onChange={(event) => setSelectedYear(Number(event.target.value || new Date().getFullYear()))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300"
              />
            </div>
            {period === "custom" && (
              <>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Start</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(event) => setCustomStart(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">End</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(event) => setCustomEnd(event.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300"
                  />
                </div>
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div>
              <span className="font-semibold text-slate-700">Active range:</span> {currentRangeLabel}
              {compareRangeLabel ? <span className="ml-2">• <span className="font-semibold text-slate-700">Comparison:</span> {compareRangeLabel}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-1">TZ: Asia/Dubai</span>
              <span className="rounded-full bg-slate-100 px-2 py-1">Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              {refreshing ? <span className="rounded-full bg-teal-50 px-2 py-1 text-teal-700">Refreshing…</span> : null}
              <button onClick={() => loadDashboard()} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">Retry</button>
              <button onClick={exportExcel} disabled={!data} className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Excel</button>
              <button onClick={exportPdfPrint} disabled={!data} className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 font-semibold text-teal-800 disabled:opacity-50">PDF / Print</button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 sm:grid-cols-4">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold sm:text-sm ${tab === entry.id ? "bg-teal-700 text-white" : "bg-white text-slate-700 border border-slate-200"}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            Loading CEO dashboard...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!loading && !error && data && tab === "overview" && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {overviewKpis.map((kpi) => (
                <div key={kpi.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kpi.title}</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">
                    {kpi.value == null
                      ? "Not available"
                      : kpi.isPercent
                        ? `${kpi.value.toFixed(1)}%`
                        : kpi.plainNumber
                          ? String(Math.round(kpi.value))
                          : formatCurrency(kpi.value)}
                  </p>
                  <p className={`mt-1 text-xs font-semibold ${deltaClass(kpi.compare, kpi.direction)}`}>
                    {kpi.compare == null ? "Comparison not available" : `${deltaPrefix(kpi.compare)} vs comparison period`}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-bold text-amber-900">Needs Attention</h3>
              {data.attentionItems.length === 0 ? (
                <p className="mt-2 text-sm text-amber-800">No critical alerts for this period.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {data.attentionItems.map((item) => <li key={item}>• {item}</li>)}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">Definitions</p>
              <p className="mt-1">Net Sales = completed treatment value excluding VAT - discounts - refunded treatment value excluding VAT.</p>
              <p className="mt-1">Operating profit is not shown because expense data is not present in POS.</p>
            </div>
          </div>
        )}

        {!loading && !error && data && tab === "clinics_doctors" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">Clinic Ranking</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-2 pr-3">Clinic</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Net Sales</th>
                      <th className="pb-2 pr-3">Expected Target</th>
                      <th className="pb-2 pr-3">Target %</th>
                      <th className="pb-2 pr-3">Previous Change</th>
                      <th className="pb-2 pr-3">Unique Patients</th>
                      <th className="pb-2 pr-3">Avg/Patient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clinicPerformance.map((row) => (
                      <tr key={row.clinicId} className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-semibold text-slate-900">{row.clinicName}</td>
                        <td className="py-2 pr-3">{statusIcon(row.status)} {statusLabel(row.status)}</td>
                        <td className="py-2 pr-3">{formatCurrency(row.netSales)}</td>
                        <td className="py-2 pr-3">{formatCurrency(row.expectedTarget)}</td>
                        <td className="py-2 pr-3">{row.targetAttainment == null ? "No Target Set" : `${row.targetAttainment.toFixed(1)}%`}</td>
                        <td className={`py-2 pr-3 ${deltaClass(row.previousPeriodChangePercent, "higher_better")}`}>{deltaPrefix(row.previousPeriodChangePercent)}</td>
                        <td className="py-2 pr-3">{row.uniquePatients}</td>
                        <td className="py-2 pr-3">{formatCurrency(row.averageNetSalesPerPatient)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">Doctor Performance</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="pb-2 pr-3">Doctor</th>
                      <th className="pb-2 pr-3">Clinic</th>
                      <th className="pb-2 pr-3">Unique Patients</th>
                      <th className="pb-2 pr-3">Completed Visits</th>
                      <th className="pb-2 pr-3">Net Sales</th>
                      <th className="pb-2 pr-3">Avg/Patient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.doctorPerformance.map((row) => (
                      <tr key={row.doctorId} className="border-t border-slate-100">
                        <td className="py-2 pr-3 font-semibold text-slate-900">{row.doctorName}</td>
                        <td className="py-2 pr-3">{row.clinicName}</td>
                        <td className="py-2 pr-3">{row.uniquePatients}</td>
                        <td className="py-2 pr-3">{row.completedVisits}</td>
                        <td className="py-2 pr-3">{formatCurrency(row.netSales)}</td>
                        <td className="py-2 pr-3">{formatCurrency(row.averageNetSalesPerPatient)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && data && tab === "trends_demand" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">Annual Performance ({selectedYear})</h3>
              <div className="mt-3 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trends.monthly}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="netSales" stroke="#0f766e" strokeWidth={2} name="Net Sales" />
                    <Line type="monotone" dataKey="target" stroke="#0284c7" strokeWidth={2} name="Monthly Target" />
                    <Line type="monotone" dataKey="previousYear" stroke="#64748b" strokeDasharray="5 5" name="Previous Year" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">Patient Demand Patterns</h3>
              <p className="mt-1 text-xs text-slate-600">{data.trends.patientDemand.message}</p>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.trends.patientDemand.dayOfWeek}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="weekday" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="visits" fill="#0f766e" name="Visits" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.trends.patientDemand.dayOfMonthBuckets}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="visits" fill="#0284c7" name="Visits" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && data && tab === "payments" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Payment Method Aggregates</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAmountMode("amount")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${amountMode === "amount" ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                  >
                    Amount
                  </button>
                  <button
                    onClick={() => setAmountMode("count")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${amountMode === "count" ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                  >
                    Count
                  </button>
                </div>
              </div>
              <div className="mt-3 h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.payments.methods.map((row) => ({
                      method: methodLabel(row.method),
                      value: amountMode === "amount" ? row.amount : row.count,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="method" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#0f766e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {data.payments.missingAllocationCoverage && (
                <p className="mt-2 text-xs text-amber-700">
                  Some historical receipts do not have allocation records. Split-payment method allocation metrics for those receipts are unavailable.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Fees Collected</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(data.payments.paymentFeesCollected)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Collections</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(data.payments.customerCollections)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer Refunds</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(data.payments.customerRefunds)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provider Deductions</p>
                <p className="mt-1 text-xl font-bold text-slate-900">
                  {data.payments.providerDeductionsAvailable ? formatCurrency(data.payments.providerDeductions) : "Not available"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net Settlement</p>
                <p className="mt-1 text-xl font-bold text-slate-900">
                  {data.payments.netSettlement == null ? "Not available" : formatCurrency(data.payments.netSettlement)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Method Uses</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{data.payments.paymentMethodUses}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppFrame>
  );
}
