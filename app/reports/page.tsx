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

    const [receiptsRes, itemsRes, servicesRes] = await Promise.allSettled([
      supabase.from("receipts").select("*").gte("created_at", from).lt("created_at", to),
      supabase.from("receipt_items").select("*, services(name)").gte("created_at", from).lt("created_at", to),
      supabase.from("services").select("*"),
    ]);

    const loadedReceipts = receiptsRes.status === "fulfilled" ? (receiptsRes.value.data || []) : [];
    let loadedRefunds: any[] = [];
    if (loadedReceipts.length > 0) {
      const receiptIds = loadedReceipts.map((r: any) => r.id);
      const refundsRes = await supabase.from("refunds").select("*, refunded_by_receptionist:refunded_by(name)").in("receipt_id", receiptIds);
      loadedRefunds = refundsRes.data || [];
    }

    setReceipts(loadedReceipts);
    if (itemsRes.status === "fulfilled") setReceiptItems(itemsRes.value.data || []);
    if (servicesRes.status === "fulfilled") setServices(servicesRes.value.data || []);
    setRefunds(loadedRefunds);
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

    const dailyData: Record<number, { revenue: number; patients: Set<string>; count: number; hasPromo: boolean; hasRefund: boolean; hasLateRefund: boolean; refundTotal: number }> = {};
    for (let d = 1; d <= daysInMonth; d++) {
      dailyData[d] = { revenue: 0, patients: new Set(), count: 0, hasPromo: false, hasRefund: false, hasLateRefund: false, refundTotal: 0 };
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
      const receipt = receipts.find((r) => r.id === refund.receipt_id);
      if (!receipt) continue;
      const receiptDate = new Date(receipt.created_at || new Date());
      if (receiptDate.getFullYear() === year && receiptDate.getMonth() === month) {
        const day = receiptDate.getDate();
        if (dailyData[day]) {
          dailyData[day].hasRefund = true;
          dailyData[day].refundTotal += Number(refund.total_amount || 0);
          dailyData[day].revenue -= Number(refund.total_amount || 0);
          const refundDate = new Date(refund.created_at || new Date());
          if (refundDate.getDate() !== day || refundDate.getMonth() !== month || refundDate.getFullYear() !== year) {
            dailyData[day].hasLateRefund = true;
          }
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

    const dayRefunds = refunds
      .filter((r) => {
        const receipt = receipts.find((rec) => rec.id === r.receipt_id);
        if (!receipt) return false;
        const receiptDate = new Date(receipt.created_at || new Date());
        return receiptDate >= selectedDate && receiptDate < nextDate;
      })
      .map((r) => {
        const refundDate = new Date(r.created_at || new Date());
        const isSameDay = refundDate >= selectedDate && refundDate < nextDate;
        return { ...r, isSameDay };
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
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-teal-300 sm:px-4 sm:py-2 sm:text-sm"
            >
              ← Prev
            </button>
            <button
              onClick={() => navigateMonth(1)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-teal-300 sm:px-4 sm:py-2 sm:text-sm"
            >
              Next →
            </button>
            <button
              onClick={() => { setRole(null); setPinInput(""); }}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 sm:px-4 sm:py-2 sm:text-sm"
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
                <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {selectedDayStats.selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </h3>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="self-start rounded border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:self-auto"
                  >
                    ← Back to Calendar
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-3 mb-6">
                  <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-600">Net Revenue</p>
                    <p className="mt-2 text-3xl font-bold text-teal-800">
                      AED {(selectedDayStats.totalRevenue - selectedDayStats.totalRefunded).toFixed(2)}
                    </p>
                    {selectedDayStats.totalRefunded > 0 && (
                      <p className="mt-1 text-xs text-red-500">−AED {selectedDayStats.totalRefunded.toFixed(2)} refunded</p>
                    )}
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
                              {new Date(refund.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}{" "}
                              <span className={`text-xs font-normal ${refund.isSameDay ? "text-slate-900" : "text-red-500"}`}>
                                ({new Date(refund.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})
                              </span>
                            </p>
                            <p className="text-xs text-slate-500 italic">{refund.reason || "No reason given"}</p>
                            <p className="text-xs text-slate-400">
                              Processed by: <span className="font-medium text-slate-600">{refund.refunded_by_receptionist?.name || "Boss"}</span>
                            </p>
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
                  <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
                      <table className="w-full min-w-[400px] text-sm">
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
                  <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:p-4">
                    <div className="grid grid-cols-7 gap-0.5 mb-1 sm:gap-1 sm:mb-2">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                        <div key={day} className="text-center text-[10px] font-semibold text-slate-500 py-1 sm:text-xs sm:py-2">
                          {day}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
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
                            className="aspect-square rounded border border-slate-200 bg-white p-0.5 text-left text-[10px] hover:border-teal-300 hover:bg-teal-50 transition sm:border-2 sm:p-1 sm:text-xs"
                          >
                            <div className="font-semibold text-slate-900 text-[10px] sm:text-xs">{day}</div>
                            {data.count > 0 && (
                              <>
                                <div className="text-teal-700 font-semibold text-[8px] leading-tight sm:text-[10px]">
                                  {data.revenue >= 1000
                                    ? `${(data.revenue / 1000).toFixed(1)}k`
                                    : data.revenue.toFixed(0)}
                                </div>
                                <div className="text-slate-500 text-[8px] leading-tight sm:text-[10px]">{data.patients.size}P</div>
                                {data.hasPromo && (
                                  <div className="mt-0.5 text-[7px] font-bold text-red-500 leading-tight sm:text-[9px]">PROMO</div>
                                )}
                                {data.hasRefund && (
                                  <div className={`mt-0.5 text-[7px] font-bold leading-tight sm:text-[9px] ${data.hasLateRefund ? "text-yellow-500" : "text-purple-600"}`}>RFND</div>
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
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
                      <table className="w-full min-w-[400px] text-sm">
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
