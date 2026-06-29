"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

const BOSS_PIN = "0404";

type DateRange = "today" | "week" | "month";

function getDateRangeStart(range: DateRange): string {
  const now = new Date();
  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  if (range === "week") {
    const day = now.getDay(); // 0 = Sunday
    const diff = day === 0 ? 6 : day - 1; // Monday = 0
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
    return monday.toISOString();
  }
  // month
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

function getPaymentCategory(method: string): string {
  const m = (method || "").toLowerCase();
  if (m.startsWith("cash")) return "Cash";
  if (m.startsWith("mixed")) return "Mixed";
  if (m.includes("tabby")) return "Tabby";
  if (m.includes("tamara")) return "Tamara";
  if (m.includes("visa")) return "Visa";
  if (m.includes("mastercard")) return "Mastercard";
  if (m.includes("card")) return "Card";
  return method || "Other";
}

export default function ReportsPage() {
  const [pinInput, setPinInput] = useState("");
  const [role, setRole] = useState<"boss" | "receptionist" | null>(null);
  const [activeReceptionistId, setActiveReceptionistId] = useState("");
  const [activeClinicName, setActiveClinicName] = useState("");
  const [pinError, setPinError] = useState("");

  const [receptionists, setReceptionists] = useState<any[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [receiptItems, setReceiptItems] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function loadMeta() {
      const [rRes, cRes] = await Promise.allSettled([
        supabase.from("receptionist").select("*"),
        supabase.from("clinics").select("*"),
      ]);
      if (rRes.status === "fulfilled") setReceptionists(rRes.value.data || []);
      if (cRes.status === "fulfilled") setClinics(cRes.value.data || []);
    }
    loadMeta();
  }, []);

  async function loadReportData(range: DateRange) {
    setIsLoading(true);
    const since = getDateRangeStart(range);

    const [receiptsRes, itemsRes, servicesRes] = await Promise.allSettled([
      supabase.from("receipts").select("*").gte("created_at", since),
      supabase.from("receipt_items").select("*, services(name)").gte("created_at", since),
      supabase.from("services").select("*"),
    ]);

    if (receiptsRes.status === "fulfilled") setReceipts(receiptsRes.value.data || []);
    if (itemsRes.status === "fulfilled") setReceiptItems(itemsRes.value.data || []);
    if (servicesRes.status === "fulfilled") setServices(servicesRes.value.data || []);
    setIsLoading(false);
  }

  function handleUnlock() {
    if (pinInput === BOSS_PIN) {
      setRole("boss");
      setPinError("");
      loadReportData(dateRange);
      return;
    }
    const match = receptionists.find((r) => r.pin === pinInput);
    if (match) {
      setRole("receptionist");
      setActiveReceptionistId(match.id);
      const clinic = clinics.find((c) => c.id === match.clinic_id);
      setActiveClinicName(clinic?.name || "");
      setPinError("");
      loadReportData(dateRange);
      return;
    }
    setPinError("Invalid PIN. Try again.");
  }

  function handleRangeChange(range: DateRange) {
    setDateRange(range);
    loadReportData(range);
  }

  // ── RECEPTIONIST VIEW DATA ──────────────────────────────────────────────
  const receptionistStats = useMemo(() => {
    if (role !== "receptionist") return null;
    const mine = receipts.filter((r) => r.receptionist_id === activeReceptionistId);
    const cashReceipts = mine.filter((r) =>
      (r.payment_method || "").toLowerCase().startsWith("cash")
    );
    const cashTotal = cashReceipts.reduce((s, r) => s + Number(r.total || 0), 0);
    return { totalTransactions: mine.length, cashTotal, cashCount: cashReceipts.length };
  }, [role, receipts, activeReceptionistId]);

  // ── BOSS VIEW DATA ──────────────────────────────────────────────────────
  const bossStats = useMemo(() => {
    if (role !== "boss") return null;

    const totalRevenue = receipts.reduce((s, r) => s + Number(r.total || 0), 0);
    const totalPatients = new Set(receipts.map((r) => r.patient_id)).size;

    // Per clinic breakdown
    const clinicMap: Record<string, { name: string; revenue: number; patients: Set<string>; paymentMethods: Record<string, number> }> = {};
    for (const clinic of clinics) {
      clinicMap[clinic.id] = { name: clinic.name, revenue: 0, patients: new Set(), paymentMethods: {} };
    }

    for (const receipt of receipts) {
      const receptionist = receptionists.find((r) => r.id === receipt.receptionist_id);
      const clinicId = receptionist?.clinic_id;
      if (!clinicId || !clinicMap[clinicId]) continue;

      const entry = clinicMap[clinicId];
      entry.revenue += Number(receipt.total || 0);
      if (receipt.patient_id) entry.patients.add(receipt.patient_id);

      const cat = getPaymentCategory(receipt.payment_method || "");
      entry.paymentMethods[cat] = (entry.paymentMethods[cat] || 0) + Number(receipt.total || 0);
    }

    // Overall payment method breakdown
    const paymentBreakdown: Record<string, number> = {};
    for (const r of receipts) {
      const cat = getPaymentCategory(r.payment_method || "");
      paymentBreakdown[cat] = (paymentBreakdown[cat] || 0) + Number(r.total || 0);
    }

    // Top services
    const serviceMap: Record<string, { name: string; count: number; revenue: number }> = {};
    for (const item of receiptItems) {
      const name = item.services?.name || services.find((s) => s.id === item.service_id)?.name || "Unknown";
      if (!serviceMap[item.service_id]) serviceMap[item.service_id] = { name, count: 0, revenue: 0 };
      serviceMap[item.service_id].count += 1;
      serviceMap[item.service_id].revenue += Number(item.total || item.price || 0);
    }
    const topServices = Object.values(serviceMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return { totalRevenue, totalPatients, totalTransactions: receipts.length, clinicMap, paymentBreakdown, topServices };
  }, [role, receipts, receiptItems, services, clinics, receptionists]);

  const rangeLabels: Record<DateRange, string> = { today: "Today", week: "This Week", month: "This Month" };

  if (role === null) {
    return (
      <AppFrame title="Reports" description="View financial summaries for your clinic shifts.">
        <div className="mx-auto max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700">Access Reports</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Enter PIN</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manager PIN for full reports. Receptionist PIN for your shift summary.
          </p>
          <div className="mt-5 space-y-3">
            <input
              type="password"
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Enter PIN"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
            />
            {pinError && <p className="text-sm text-red-500">{pinError}</p>}
            <button
              onClick={handleUnlock}
              className="w-full rounded-2xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-600"
            >
              View Reports
            </button>
          </div>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Reports" description="Financial summary for your clinic.">
      <div className="space-y-6">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700">
              {role === "boss" ? "Manager View — All Clinics" : `Receptionist View — ${activeClinicName}`}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">
              {rangeLabels[dateRange]}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {(["today", "week", "month"] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => handleRangeChange(r)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  dateRange === r
                    ? "bg-teal-700 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-teal-300"
                }`}
              >
                {rangeLabels[r]}
              </button>
            ))}
            <button
              onClick={() => { setRole(null); setPinInput(""); }}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
            >
              Lock
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Loading...
          </div>
        )}

        {/* ── RECEPTIONIST VIEW ── */}
        {role === "receptionist" && receptionistStats && !isLoading && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Cash Collected</p>
                <p className="mt-2 text-3xl font-bold text-teal-700">
                  AED {receptionistStats.cashTotal.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{receptionistStats.cashCount} cash transactions</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Total Transactions</p>
                <p className="mt-2 text-3xl font-bold text-slate-800">{receptionistStats.totalTransactions}</p>
                <p className="mt-1 text-xs text-slate-400">all payment methods</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Period</p>
                <p className="mt-2 text-xl font-bold text-slate-800">{rangeLabels[dateRange]}</p>
                <p className="mt-1 text-xs text-slate-400">{activeClinicName}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── BOSS VIEW ── */}
        {role === "boss" && bossStats && !isLoading && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-600">Total Revenue</p>
                <p className="mt-2 text-3xl font-bold text-teal-800">
                  AED {bossStats.totalRevenue.toFixed(2)}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Patients Seen</p>
                <p className="mt-2 text-3xl font-bold text-slate-800">{bossStats.totalPatients}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Transactions</p>
                <p className="mt-2 text-3xl font-bold text-slate-800">{bossStats.totalTransactions}</p>
              </div>
            </div>

            {/* Per clinic breakdown */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Per Clinic</h3>
              <div className="space-y-3">
                {Object.entries(bossStats.clinicMap).map(([clinicId, data]) => (
                  <div key={clinicId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-900">{data.name}</p>
                      <p className="text-lg font-bold text-teal-700">AED {data.revenue.toFixed(2)}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{data.patients.size} patients</p>
                    {Object.keys(data.paymentMethods).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Object.entries(data.paymentMethods)
                          .sort((a, b) => b[1] - a[1])
                          .map(([method, amount]) => (
                            <span key={method} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                              {method}: AED {(amount as number).toFixed(2)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Payment method breakdown */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Payment Methods (All Clinics)</h3>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="space-y-2">
                  {Object.entries(bossStats.paymentBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([method, amount]) => {
                      const pct = bossStats.totalRevenue > 0 ? ((amount as number) / bossStats.totalRevenue) * 100 : 0;
                      return (
                        <div key={method}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-700">{method}</span>
                            <span className="font-semibold text-slate-900">AED {(amount as number).toFixed(2)}</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-teal-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Top services */}
            {bossStats.topServices.length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Top Services</h3>
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Service</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Count</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bossStats.topServices.map((s, i) => (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                          <td className="px-4 py-3 text-center text-slate-500">{s.count}</td>
                          <td className="px-4 py-3 text-right font-semibold text-teal-700">AED {s.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppFrame>
  );
}
