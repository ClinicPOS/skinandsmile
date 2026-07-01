"use client";

import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

const BOSS_PIN = "0404";

function getPaymentCategory(method: string): string {
  const m = (method || "").toLowerCase();
  if (m.startsWith("cash")) return "Cash";
  if (m.startsWith("split")) return "Split Payment";
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
  const [activeClinicId, setActiveClinicId] = useState("");
  const [activeClinicName, setActiveClinicName] = useState("");
  const [pinError, setPinError] = useState("");

  const [receptionists, setReceptionists] = useState<any[]>([]);
  const [clinics, setClinics] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [receiptItems, setReceiptItems] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [calendarDate, setCalendarDate] = useState(new Date());

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

  async function loadReportForMonth(date: Date) {
    setIsLoading(true);
    setSelectedDay(null);
    const year = date.getFullYear();
    const month = date.getMonth();
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 1).toISOString();

    const [receiptsRes, itemsRes, servicesRes, refundsRes] = await Promise.allSettled([
      supabase.from("receipts").select("*").gte("created_at", from).lt("created_at", to),
      supabase.from("receipt_items").select("*, services(name)").gte("created_at", from).lt("created_at", to),
      supabase.from("services").select("*"),
      supabase.from("refunds").select("*").gte("created_at", from).lt("created_at", to),
    ]);

    if (receiptsRes.status === "fulfilled") setReceipts(receiptsRes.value.data || []);
    if (itemsRes.status === "fulfilled") setReceiptItems(itemsRes.value.data || []);
    if (servicesRes.status === "fulfilled") setServices(servicesRes.value.data || []);
    if (refundsRes.status === "fulfilled") setRefunds(refundsRes.value.data || []);
    setIsLoading(false);
  }

  function navigateMonth(delta: number) {
    const next = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + delta);
    setCalendarDate(next);
    if (role) loadReportForMonth(next);
  }

  function handleUnlock() {
    if (pinInput === BOSS_PIN) {
      setRole("boss");
      setPinError("");
      loadReportForMonth(calendarDate);
      return;
    }
    const match = receptionists.find((r) => r.pin === pinInput);
    if (match) {
      setRole("receptionist");
      const clinic = clinics.find((c) => c.id === match.clinic_id);
      setActiveClinicId(clinic?.id || "");
      setActiveClinicName(clinic?.name || "");
      setPinError("");
      loadReportForMonth(calendarDate);
      return;
    }
    setPinError("Invalid PIN. Try again.");
  }

  // ── RECEPTIONIST VIEW DATA ──────────────────────────────────────────────
  const receptionistStats = useMemo(() => {
    if (role !== "receptionist") return null;
    const clinicReceptionistIds = new Set(
      receptionists.filter((r) => r.clinic_id === activeClinicId).map((r) => r.id)
    );
    const mine = receipts.filter((r) => clinicReceptionistIds.has(r.receptionist_id));
    const cashReceipts = mine.filter((r) =>
      (r.payment_method || "").toLowerCase().startsWith("cash")
    );
    const cashTotal = cashReceipts.reduce((s, r) => s + Number(r.total || 0), 0);
    const totalRevenue = mine.reduce((s, r) => s + Number(r.total || 0), 0);

    const paymentBreakdown: Record<string, number> = {};
    for (const r of mine) {
      const cat = getPaymentCategory(r.payment_method || "");
      paymentBreakdown[cat] = (paymentBreakdown[cat] || 0) + Number(r.total || 0);
    }

    return { totalTransactions: mine.length, cashTotal, cashCount: cashReceipts.length, totalRevenue, paymentBreakdown };
  }, [role, receipts, receptionists, activeClinicId]);

  // ── BOSS VIEW DATA ──────────────────────────────────────────────────────
  const bossStats = useMemo(() => {
    if (role !== "boss") return null;

    const totalRevenue = receipts.reduce((s, r) => s + Number(r.total || 0), 0);
    const totalPatients = new Set(receipts.map((r) => r.patient_id)).size;

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

    const paymentBreakdown: Record<string, number> = {};
    for (const r of receipts) {
      const cat = getPaymentCategory(r.payment_method || "");
      paymentBreakdown[cat] = (paymentBreakdown[cat] || 0) + Number(r.total || 0);
    }

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

  // ── CALENDAR DATA ──────────────────────────────────────────────────────
  const calendarStats = useMemo(() => {
    if (role !== "boss") return null;
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const dailyData: Record<number, { revenue: number; patients: Set<string>; count: number; hasPromo: boolean; hasRefund: boolean; refundTotal: number }> = {};
    for (let d = 1; d <= daysInMonth; d++) {
      dailyData[d] = { revenue: 0, patients: new Set(), count: 0, hasPromo: false, hasRefund: false, refundTotal: 0 };
    }

    for (const receipt of receipts) {
      const receiptDate = new Date(receipt.created_at || new Date());
      if (receiptDate.getFullYear() === year && receiptDate.getMonth() === month) {
        const day = receiptDate.getDate();
        if (dailyData[day]) {
          dailyData[day].revenue += Number(receipt.total || 0);
          if (receipt.patient_id) dailyData[day].patients.add(receipt.patient_id);
          dailyData[day].count += 1;
          if (Number(receipt.discount_amount) > 0) dailyData[day].hasPromo = true;
        }
      }
    }

    for (const refund of refunds) {
      const refundDate = new Date(refund.created_at || new Date());
      if (refundDate.getFullYear() === year && refundDate.getMonth() === month) {
        const day = refundDate.getDate();
        if (dailyData[day]) {
          dailyData[day].hasRefund = true;
          dailyData[day].refundTotal += Number(refund.total_amount || 0);
        }
      }
    }

    return { year, month, daysInMonth, startingDayOfWeek, dailyData };
  }, [role, receipts, refunds, calendarDate]);

  // ── SELECTED DAY DETAIL VIEW ──────────────────────────────────────────
  const selectedDayStats = useMemo(() => {
    if (!selectedDay || !calendarStats || role !== "boss") return null;

    const selectedDate = new Date(calendarStats.year, calendarStats.month, selectedDay);
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayReceipts = receipts.filter((r) => {
      const receiptDate = new Date(r.created_at || new Date());
      return receiptDate >= selectedDate && receiptDate < nextDate;
    });

    const totalRevenue = dayReceipts.reduce((s, r) => s + Number(r.total || 0), 0);
    const totalPatients = new Set(dayReceipts.map((r) => r.patient_id)).size;

    const clinicMap: Record<string, { name: string; revenue: number; patients: Set<string>; paymentMethods: Record<string, number> }> = {};
    for (const clinic of clinics) {
      clinicMap[clinic.id] = { name: clinic.name, revenue: 0, patients: new Set(), paymentMethods: {} };
    }

    for (const receipt of dayReceipts) {
      const receptionist = receptionists.find((r) => r.id === receipt.receptionist_id);
      const clinicId = receptionist?.clinic_id;
      if (!clinicId || !clinicMap[clinicId]) continue;

      const entry = clinicMap[clinicId];
      entry.revenue += Number(receipt.total || 0);
      if (receipt.patient_id) entry.patients.add(receipt.patient_id);

      const cat = getPaymentCategory(receipt.payment_method || "");
      entry.paymentMethods[cat] = (entry.paymentMethods[cat] || 0) + Number(receipt.total || 0);
    }

    const paymentBreakdown: Record<string, number> = {};
    for (const r of dayReceipts) {
      const cat = getPaymentCategory(r.payment_method || "");
      paymentBreakdown[cat] = (paymentBreakdown[cat] || 0) + Number(r.total || 0);
    }

    const dayReceiptItems = receiptItems.filter((item) => dayReceipts.some((r) => r.id === item.receipt_id));
    const serviceMap: Record<string, { name: string; count: number; revenue: number }> = {};
    for (const item of dayReceiptItems) {
      const name = item.services?.name || services.find((s) => s.id === item.service_id)?.name || "Unknown";
      if (!serviceMap[item.service_id]) serviceMap[item.service_id] = { name, count: 0, revenue: 0 };
      serviceMap[item.service_id].count += 1;
      serviceMap[item.service_id].revenue += Number(item.total || item.price || 0);
    }
    const topServices = Object.values(serviceMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const dayRefunds = refunds.filter((r) => {
      const d = new Date(r.created_at || new Date());
      return d >= selectedDate && d < nextDate;
    });
    const totalRefunded = dayRefunds.reduce((s, r) => s + Number(r.total_amount || 0), 0);

    return { totalRevenue, totalPatients, totalTransactions: dayReceipts.length, clinicMap, paymentBreakdown, topServices, selectedDate, dayRefunds, totalRefunded };
  }, [selectedDay, calendarStats, role, receipts, refunds, receiptItems, services, clinics, receptionists]);

  const monthLabel = calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

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
            <h2 className="mt-1 text-xl font-semibold text-slate-900">{monthLabel}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateMonth(-1)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-teal-300"
            >
              ← Prev
            </button>
            <button
              onClick={() => navigateMonth(1)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-teal-300"
            >
              Next →
            </button>
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
              <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-600">Total Revenue</p>
                <p className="mt-2 text-3xl font-bold text-teal-800">
                  AED {receptionistStats.totalRevenue.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{receptionistStats.totalTransactions} transactions</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Cash Collected</p>
                <p className="mt-2 text-3xl font-bold text-slate-800">
                  AED {receptionistStats.cashTotal.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{receptionistStats.cashCount} cash transactions</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Clinic</p>
                <p className="mt-2 text-xl font-bold text-slate-800">{activeClinicName}</p>
                <p className="mt-1 text-xs text-slate-400">{monthLabel}</p>
              </div>
            </div>
            {Object.keys(receptionistStats.paymentBreakdown).length > 0 && (
              <div>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Payment Methods</h3>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="space-y-2">
                    {Object.entries(receptionistStats.paymentBreakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([method, amount]) => {
                        const pct = receptionistStats.totalRevenue > 0 ? ((amount as number) / receptionistStats.totalRevenue) * 100 : 0;
                        return (
                          <div key={method}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-slate-700">{method}</span>
                              <span className="font-semibold text-slate-900">AED {(amount as number).toFixed(2)}</span>
                            </div>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── BOSS VIEW ── */}
        {role === "boss" && bossStats && !isLoading && (
          <div className="space-y-6">
            {selectedDay && selectedDayStats ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {selectedDayStats.selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </h3>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="px-3 py-1 text-sm rounded border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-slate-700"
                  >
                    ← Back to Calendar
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-3 mb-6">
                  <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-600">Total Revenue</p>
                    <p className="mt-2 text-3xl font-bold text-teal-800">
                      AED {selectedDayStats.totalRevenue.toFixed(2)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Patients Seen</p>
                    <p className="mt-2 text-3xl font-bold text-slate-800">{selectedDayStats.totalPatients}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Transactions</p>
                    <p className="mt-2 text-3xl font-bold text-slate-800">{selectedDayStats.totalTransactions}</p>
                  </div>
                </div>

                {selectedDayStats.dayRefunds.length > 0 && (
                  <div className="mb-6 rounded-2xl border border-purple-200 bg-purple-50/60 p-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-purple-700 mb-3">Refunds This Day</p>
                    <div className="space-y-2">
                      {selectedDayStats.dayRefunds.map((refund: any) => (
                        <div key={refund.id} className="flex items-center justify-between rounded-xl bg-white border border-purple-100 px-4 py-2.5">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              {new Date(refund.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}
                            </p>
                            <p className="text-xs text-slate-500 italic">{refund.reason || "No reason given"}</p>
                          </div>
                          <span className="font-bold text-purple-700">- AED {Number(refund.total_amount).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-between border-t border-purple-200 pt-2 text-sm font-bold text-purple-800">
                      <span>Total Refunded</span>
                      <span>- AED {selectedDayStats.totalRefunded.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Per Clinic</h3>
                  <div className="space-y-3">
                    {Object.entries(selectedDayStats.clinicMap).map(([clinicId, data]) => (
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

                <div className="mb-6">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Payment Methods</h3>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="space-y-2">
                      {Object.entries(selectedDayStats.paymentBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([method, amount]) => {
                          const pct = selectedDayStats.totalRevenue > 0 ? ((amount as number) / selectedDayStats.totalRevenue) * 100 : 0;
                          return (
                            <div key={method}>
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-700">{method}</span>
                                <span className="font-semibold text-slate-900">AED {(amount as number).toFixed(2)}</span>
                              </div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>

                {selectedDayStats.topServices.length > 0 && (
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
                          {selectedDayStats.topServices.map((s, i) => (
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
            ) : (
              <>
                {/* Calendar */}
                {calendarStats && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                        <div key={day} className="text-center text-xs font-semibold text-slate-500 py-2">
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: calendarStats.startingDayOfWeek }).map((_, i) => (
                        <div key={`empty-${i}`} className="aspect-square bg-slate-50 rounded" />
                      ))}
                      {Array.from({ length: calendarStats.daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const data = calendarStats.dailyData[day];
                        return (
                          <button
                            key={day}
                            onClick={() => setSelectedDay(day)}
                            className="aspect-square rounded border-2 border-slate-200 bg-white p-1 text-left text-xs hover:border-teal-300 hover:bg-teal-50 transition"
                          >
                            <div className="font-semibold text-slate-900">{day}</div>
                            {data.count > 0 && (
                              <>
                                <div className="text-teal-700 font-semibold">AED {data.revenue.toFixed(0)}</div>
                                <div className="text-slate-500 text-[10px]">{data.patients.size}P</div>
                                {data.hasPromo && (
                                  <div className="mt-0.5 text-[9px] font-bold text-red-500 leading-tight">PROMO</div>
                                )}
                                {data.hasRefund && (
                                  <div className="mt-0.5 text-[9px] font-bold text-purple-600 leading-tight">REFUND</div>
                                )}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Monthly summary */}
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
                                <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
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
              </>
            )}
          </div>
        )}
      </div>
    </AppFrame>
  );
}
