"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";
import type { Clinic, Patient, Receptionist, Service } from "../../lib/types";

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

type TopServiceSummary = {
  id: string;
  name: string;
  count: number;
  revenue: number;
  patientCount: number;
  doctorCount: number;
  revenueShare: number;
  isTopPerformer: boolean;
};

type TopServicesSummaryPayload = {
  services: TopServiceSummary[];
  totalRevenue: number;
  uniqueServices: number;
  mostPerformed: TopServiceSummary | null;
  highestRevenue: TopServiceSummary | null;
};

type TopServiceDetail = {
  id: string;
  name: string;
  revenue: number;
  count: number;
  averagePrice: number;
  patientCount: number;
  revenueShare: number;
  patients: Array<{ id: string; name: string }>;
  doctors: Array<{ id: string; name: string }>;
  revenueTrend: Array<{ date: string; label: string; revenue: number; count: number }>;
};

type Receipt = {
  id: string;
  receptionist_id: string;
  patient_id: string | null;
  total: number;
  payment_method: string | null;
  notes?: string | null;
  created_at: string;
};

type ReceiptItem = {
  id: string;
  receipt_id: string;
  service_id: string;
  doctor_id: string | null;
  price: number | null;
  total: number | null;
  created_at: string;
  services?: {
    name?: string | null;
  } | null;
};

type Refund = {
  id: string;
  receipt_id: string;
  total_amount: number;
  reason?: string | null;
  refunded_by?: string | null;
  refunded_by_receptionist?: {
    name?: string | null;
  } | null;
  created_at: string;
};

const EMPTY_TOP_SERVICES_SUMMARY: TopServicesSummaryPayload = {
  services: [],
  totalRevenue: 0,
  uniqueServices: 0,
  mostPerformed: null,
  highestRevenue: null,
};

export default function ReportsPage() {
  const [pinInput, setPinInput] = useState("");
  const [role, setRole] = useState<"boss" | "receptionist" | null>(null);
  const [activeClinicId, setActiveClinicId] = useState("");
  const [activeClinicName, setActiveClinicName] = useState("");
  const [pinError, setPinError] = useState("");

  const [receptionists, setReceptionists] = useState<Receptionist[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedClinic, setSelectedClinic] = useState<string | null>(null); // null = All Clinics
  
  // Date range filter states
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [filterType, setFilterType] = useState<"today" | "yesterday" | "week" | "month" | "lastMonth" | "custom" | "selectedDate">("today");

  // Service details panel state
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [showServicePanel, setShowServicePanel] = useState(false);
  const [topServicesSummary, setTopServicesSummary] = useState<TopServicesSummaryPayload>(EMPTY_TOP_SERVICES_SUMMARY);
  const [topServicesLoading, setTopServicesLoading] = useState(false);
  const [topServicesError, setTopServicesError] = useState("");
  const [selectedServiceDetail, setSelectedServiceDetail] = useState<TopServiceDetail | null>(null);
  const [serviceDetailLoading, setServiceDetailLoading] = useState(false);
  const [serviceDetailError, setServiceDetailError] = useState("");

  type ApiErrorPayload = {
    error?: string;
    details?: string;
    hint?: string;
  };

  const parseApiError = useCallback(async <T,>(response: Response, fallbackMessage: string): Promise<T> => {
    const payload = await response.json().catch(() => null) as (T & ApiErrorPayload) | null;

    if (!response.ok) {
      const messageParts = [payload?.error, payload?.details, payload?.hint].filter(Boolean);
      throw new Error(messageParts.join(" ") || fallbackMessage);
    }

    if (!payload) {
      throw new Error("Top Services returned an invalid response. Please sign in again.");
    }

    return payload as T;
  }, []);

  useEffect(() => {
    async function loadMeta() {
      const [rRes, cRes, pRes] = await Promise.allSettled([
        supabase.from("receptionist").select("*"),
        supabase.from("clinics").select("*"),
        supabase.from("patients").select("*"),
      ]);
      if (rRes.status === "fulfilled") setReceptionists(rRes.value.data || []);
      if (cRes.status === "fulfilled") setClinics(cRes.value.data || []);
      if (pRes.status === "fulfilled") setPatients(pRes.value.data || []);
    }
    loadMeta();
  }, []);

  async function loadReportForMonth(date: Date) {
    setIsLoading(true);
    const year = date.getFullYear();
    const month = date.getMonth();
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 1).toISOString();

    const [receiptsRes, itemsRes, servicesRes] = await Promise.allSettled([
      supabase.from("receipts").select("*").gte("created_at", from).lt("created_at", to),
      supabase.from("receipt_items").select("*, services(name)").gte("created_at", from).lt("created_at", to),
      supabase.from("services").select("*"),
    ]);

    const loadedReceipts: Receipt[] = receiptsRes.status === "fulfilled" ? ((receiptsRes.value.data || []) as Receipt[]) : [];
    let loadedRefunds: Refund[] = [];
    if (loadedReceipts.length > 0) {
      const receiptIds = loadedReceipts.map((r) => r.id);
      const refundsRes = await supabase.from("refunds").select("*, refunded_by_receptionist:refunded_by(name)").in("receipt_id", receiptIds);
      loadedRefunds = (refundsRes.data || []) as Refund[];
    }

    setReceipts(loadedReceipts);
    if (itemsRes.status === "fulfilled") setReceiptItems((itemsRes.value.data || []) as ReceiptItem[]);
    if (servicesRes.status === "fulfilled") setServices((servicesRes.value.data || []) as Service[]);
    setRefunds(loadedRefunds);
    setIsLoading(false);
  }

  async function loadAllReceipts() {
    setIsLoading(true);
    const [receiptsRes, itemsRes, servicesRes] = await Promise.allSettled([
      supabase.from("receipts").select("*"),
      supabase.from("receipt_items").select("*, services(name)"),
      supabase.from("services").select("*"),
    ]);

    const loadedReceipts: Receipt[] = receiptsRes.status === "fulfilled" ? ((receiptsRes.value.data || []) as Receipt[]) : [];
    let loadedRefunds: Refund[] = [];
    if (loadedReceipts.length > 0) {
      const receiptIds = loadedReceipts.map((r) => r.id);
      const refundsRes = await supabase.from("refunds").select("*, refunded_by_receptionist:refunded_by(name)").in("receipt_id", receiptIds);
      loadedRefunds = (refundsRes.data || []) as Refund[];
    }

    setReceipts(loadedReceipts);
    if (itemsRes.status === "fulfilled") setReceiptItems((itemsRes.value.data || []) as ReceiptItem[]);
    if (servicesRes.status === "fulfilled") setServices((servicesRes.value.data || []) as Service[]);
    setRefunds(loadedRefunds);
    setIsLoading(false);
  }

  function handleUnlock() {
    const found = receptionists.find((r) => String(r.pin) === pinInput);
    if (pinInput === BOSS_PIN) {
      setRole("boss");
      setPinError("");
      loadAllReceipts();
      return;
    }
    if (found) {
      setRole("receptionist");
      const clinicId = found.clinic_id || "";
      setActiveClinicId(clinicId);
      setActiveClinicName(found.name);
      if (clinicId) {
        const clinic = clinics.find((c) => c.id === clinicId);
        if (clinic) setActiveClinicName(clinic.name);
      }
      setPinError("");
      loadReportForMonth(new Date());
      return;
    }
    setPinError("Invalid PIN. Try again.");
  }

  function navigateMonth(offset: number) {
    const d = new Date(calendarDate);
    d.setMonth(d.getMonth() + offset);
    setCalendarDate(d);
    loadReportForMonth(d);
  }

  const getTodayRange = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { from: today, to: tomorrow };
  }, []);

  const getFilterRange = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (filterType === "selectedDate" && selectedDate) {
      const selected = new Date(selectedDate);
      selected.setHours(0, 0, 0, 0);
      const nextDay = new Date(selected);
      nextDay.setDate(nextDay.getDate() + 1);
      return { from: selected, to: nextDay };
    }

    if (filterType === "custom") {
      if (startDate && endDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        return { from: start, to: end };
      }
      return getTodayRange();
    }

    if (filterType === "today") return getTodayRange();

    if (filterType === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const endYesterday = new Date(yesterday);
      endYesterday.setDate(endYesterday.getDate() + 1);
      return { from: yesterday, to: endYesterday };
    }

    if (filterType === "week") {
      const first = new Date(today);
      first.setDate(today.getDate() - today.getDay());
      const last = new Date(first);
      last.setDate(last.getDate() + 7);
      return { from: first, to: last };
    }

    if (filterType === "month") {
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: new Date(today.getFullYear(), today.getMonth() + 1, 1),
      };
    }

    if (filterType === "lastMonth") {
      const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return {
        from: lastMonthDate,
        to: new Date(today.getFullYear(), today.getMonth(), 1),
      };
    }

    return getTodayRange();
  }, [endDate, filterType, getTodayRange, selectedDate, startDate]);

  const getFilteredReceipts = useCallback((receiptsToFilter: Receipt[]) => {
    const { from, to } = getFilterRange();
    return receiptsToFilter.filter((r) => {
      const receiptDate = new Date(r.created_at || new Date());
      return receiptDate >= from && receiptDate < to;
    });
  }, [getFilterRange]);

  const receptionistStats = useMemo(() => {
    if (role !== "receptionist") return null;
    const clinicReceptionistIds = new Set(
      receptionists.filter((r) => r.clinic_id === activeClinicId).map((r) => r.id)
    );
    const filteredReceipts = getFilteredReceipts(receipts);
    const mine = filteredReceipts.filter((r) => clinicReceptionistIds.has(r.receptionist_id));
    const cashReceipts = mine.filter((r) => (r.payment_method || "").toLowerCase().startsWith("cash"));
    const cashTotal = cashReceipts.reduce((s, r) => s + Number(r.total || 0), 0);
    const totalRevenue = mine.reduce((s, r) => s + Number(r.total || 0), 0);

    const paymentBreakdown: Record<string, number> = {};
    for (const r of mine) {
      const cat = getPaymentCategory(r.payment_method || "");
      paymentBreakdown[cat] = (paymentBreakdown[cat] || 0) + Number(r.total || 0);
    }

    const myRefunds = refunds.filter((refund) => {
      const receipt = receipts.find((r) => r.id === refund.receipt_id);
      return receipt && mine.some((m) => m.id === receipt.id);
    });
    const totalRefunded = myRefunds.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const netRevenue = totalRevenue - totalRefunded;

    return { totalTransactions: mine.length, cashTotal, cashCount: cashReceipts.length, totalRevenue: netRevenue, paymentBreakdown, totalRefunded, grossRevenue: totalRevenue };
  }, [role, receipts, refunds, receptionists, activeClinicId, getFilteredReceipts]);

  const bossStats = useMemo(() => {
    if (role !== "boss") return null;

    let filteredReceipts = getFilteredReceipts(receipts);
    
    // Filter by selected clinic if not "All Clinics"
    if (selectedClinic) {
      filteredReceipts = filteredReceipts.filter((r) => {
        const receptionist = receptionists.find((rec) => rec.id === r.receptionist_id);
        return receptionist?.clinic_id === selectedClinic;
      });
    }
    
    const totalRevenue = filteredReceipts.reduce((s, r) => s + Number(r.total || 0), 0);
    const totalPatients = new Set(filteredReceipts.map((r) => r.patient_id)).size;

    const clinicMap: Record<string, { name: string; revenue: number; refunded: number; patients: Set<string>; paymentMethods: Record<string, number> }> = {};
    for (const clinic of clinics) {
      clinicMap[clinic.id] = { name: clinic.name, revenue: 0, refunded: 0, patients: new Set(), paymentMethods: {} };
    }

    for (const receipt of filteredReceipts) {
      const receptionist = receptionists.find((r) => r.id === receipt.receptionist_id);
      const clinicId = receptionist?.clinic_id;
      if (!clinicId || !clinicMap[clinicId]) continue;

      const entry = clinicMap[clinicId];
      entry.revenue += Number(receipt.total || 0);
      if (receipt.patient_id) entry.patients.add(receipt.patient_id);

      const cat = getPaymentCategory(receipt.payment_method || "");
      entry.paymentMethods[cat] = (entry.paymentMethods[cat] || 0) + Number(receipt.total || 0);
    }

    for (const refund of refunds) {
      const receipt = receipts.find((r) => r.id === refund.receipt_id);
      const receptionist = receptionists.find((r) => r.id === receipt?.receptionist_id);
      const clinicId = receptionist?.clinic_id;
      if (!clinicId || !clinicMap[clinicId]) continue;
      clinicMap[clinicId].refunded += Number(refund.total_amount || 0);
    }

    const paymentBreakdown: Record<string, number> = {};
    for (const r of filteredReceipts) {
      const cat = getPaymentCategory(r.payment_method || "");
      paymentBreakdown[cat] = (paymentBreakdown[cat] || 0) + Number(r.total || 0);
    }

    const filteredRefunds = refunds.filter((refund) => {
      const receipt = receipts.find((r) => r.id === refund.receipt_id);
      if (!receipt) return false;
      return filteredReceipts.some((fr) => fr.id === receipt.id);
    });
    const totalRefunded = filteredRefunds.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const netRevenue = totalRevenue - totalRefunded;

    const serviceMap: Record<string, { name: string; count: number; revenue: number }> = {};
    const filteredReceiptIds = new Set(filteredReceipts.map((r) => r.id));
    for (const item of receiptItems) {
      // Only include items from receipts that passed the date and clinic filters
      if (!filteredReceiptIds.has(item.receipt_id)) continue;
      const name = item.services?.name || services.find((s) => s.id === item.service_id)?.name || "Unknown";
      if (!serviceMap[item.service_id]) serviceMap[item.service_id] = { name, count: 0, revenue: 0 };
      serviceMap[item.service_id].count += 1;
      serviceMap[item.service_id].revenue += Number(item.total || item.price || 0);
    }
    const topServices = Object.values(serviceMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return { totalRevenue: netRevenue, totalPatients, totalTransactions: filteredReceipts.length, clinicMap, paymentBreakdown, topServices, totalRefunded, grossRevenue: totalRevenue };
  }, [role, receipts, refunds, receiptItems, services, clinics, receptionists, selectedClinic, getFilteredReceipts]);

  const clinicLabel = useMemo(() => {
    if (!selectedClinic) return "All Clinics";
    const clinic = clinics.find((c) => c.id === selectedClinic);
    return clinic?.name || "Unknown Clinic";
  }, [selectedClinic, clinics]);

  const filterLabel = useMemo(() => {
    if (filterType === "selectedDate" && selectedDate) {
      return selectedDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    }
    if (filterType === "today") return "Today";
    if (filterType === "yesterday") return "Yesterday";
    if (filterType === "week") return "This Week";
    if (filterType === "month") return "This Month";
    if (filterType === "lastMonth") return "Last Month";
    if (filterType === "custom" && startDate && endDate) {
      return `${new Date(startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    return "Today";
  }, [filterType, startDate, endDate, selectedDate]);

  const topServicesRequest = useMemo(() => {
    if (role !== "boss") return null;

    const { from, to } = getFilterRange();
    return {
      clinicId: selectedClinic,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }, [role, selectedClinic, getFilterRange]);

  useEffect(() => {
    if (!topServicesRequest) {
      return;
    }
    const request = topServicesRequest;

    const controller = new AbortController();

    async function loadTopServicesSummary() {
      setTopServicesLoading(true);
      setTopServicesError("");

      const params = new URLSearchParams({
        from: request.from,
        to: request.to,
      });

      if (request.clinicId) {
        params.set("clinicId", request.clinicId);
      }

      try {
        const response = await fetch(`/api/reports/top-services?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        const payload = await parseApiError<{ summary?: TopServicesSummaryPayload }>(
          response,
          "Failed to load top services analytics."
        );
        setTopServicesSummary(payload.summary || EMPTY_TOP_SERVICES_SUMMARY);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setTopServicesSummary(EMPTY_TOP_SERVICES_SUMMARY);
        setTopServicesError(error instanceof Error ? error.message : "Unable to load Top Services right now.");
      } finally {
        if (!controller.signal.aborted) {
          setTopServicesLoading(false);
        }
      }
    }

    loadTopServicesSummary();

    return () => controller.abort();
  }, [parseApiError, topServicesRequest]);

  useEffect(() => {
    if (!showServicePanel || !selectedServiceId || !topServicesRequest) {
      return;
    }
    const request = topServicesRequest;
    const serviceId = selectedServiceId;

    const controller = new AbortController();

    async function loadServiceDetail() {
      setServiceDetailLoading(true);
      setServiceDetailError("");

      const params = new URLSearchParams({
        from: request.from,
        to: request.to,
        serviceId,
      });

      if (request.clinicId) {
        params.set("clinicId", request.clinicId);
      }

      try {
        const response = await fetch(`/api/reports/top-services?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        const payload = await parseApiError<{ detail?: TopServiceDetail | null }>(
          response,
          "Failed to load service detail."
        );
        setSelectedServiceDetail(payload.detail || null);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error(error);
        setSelectedServiceDetail(null);
        setServiceDetailError(error instanceof Error ? error.message : "Unable to load this service detail right now.");
      } finally {
        if (!controller.signal.aborted) {
          setServiceDetailLoading(false);
        }
      }
    }

    loadServiceDetail();

    return () => controller.abort();
  }, [parseApiError, showServicePanel, selectedServiceId, topServicesRequest]);

  const calendarStats = useMemo(() => {
    if (role !== "boss") return null;
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const dailyData: Record<number, { revenue: number; patients: Set<string>; count: number; hasPromo: boolean; hasRefund: boolean; hasLateRefund: boolean; refundTotal: number }> = {};

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStart = new Date(year, month, day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(year, month, day);
      dayEnd.setHours(23, 59, 59, 999);

      let dayReceipts = receipts.filter((r) => {
        const rDate = new Date(r.created_at || new Date());
        return rDate >= dayStart && rDate <= dayEnd;
      });
      
      // Filter by selected clinic if not "All Clinics"
      if (selectedClinic) {
        dayReceipts = dayReceipts.filter((r) => {
          const receptionist = receptionists.find((rec) => rec.id === r.receptionist_id);
          return receptionist?.clinic_id === selectedClinic;
        });
      }

      const dayRevenue = dayReceipts.reduce((s, r) => s + Number(r.total || 0), 0);
      const dayPatients = new Set(
        dayReceipts.map((r) => r.patient_id).filter((patientId): patientId is string => Boolean(patientId))
      );

      const dayRefunds = refunds.filter((ref) => {
        const receipt = receipts.find((r) => r.id === ref.receipt_id);
        if (!receipt) return false;
        const rDate = new Date(receipt.created_at || new Date());
        return rDate >= dayStart && rDate <= dayEnd;
      });

      const hasPromo = dayReceipts.some((r) => r.notes?.includes("Promo") || r.notes?.includes("promo"));
      const hasRefund = dayRefunds.length > 0;
      const refundTotal = dayRefunds.reduce((s, r) => s + Number(r.total_amount || 0), 0);

      dailyData[day] = {
        revenue: dayRevenue,
        patients: dayPatients,
        count: dayReceipts.length,
        hasPromo,
        hasRefund,
        hasLateRefund: hasRefund && new Date().getTime() - new Date(dayRefunds[dayRefunds.length - 1].created_at).getTime() > 86400000,
        refundTotal,
      };
    }

    return { daysInMonth, startingDayOfWeek, dailyData };
  }, [role, receipts, refunds, receptionists, calendarDate, selectedClinic]);

  const chartData = useMemo(() => {
    if (role !== "boss") return [];

    let filteredReceipts = getFilteredReceipts(receipts);
    
    // Filter by selected clinic if not "All Clinics"
    if (selectedClinic) {
      filteredReceipts = filteredReceipts.filter((r) => {
        const receptionist = receptionists.find((rec) => rec.id === r.receptionist_id);
        return receptionist?.clinic_id === selectedClinic;
      });
    }

    if (filteredReceipts.length === 0) return [];

    // For Today/Yesterday: Aggregate by hour
    if (filterType === "today" || filterType === "yesterday" || filterType === "selectedDate") {
      const hourlyData: Record<number, { revenue: number; transactions: number; patients: Set<string> }> = {};
      
      for (let hour = 0; hour < 24; hour++) {
        hourlyData[hour] = { revenue: 0, transactions: 0, patients: new Set() };
      }

      for (const receipt of filteredReceipts) {
        const receiptDate = new Date(receipt.created_at);
        const hour = receiptDate.getHours();
        hourlyData[hour].revenue += Number(receipt.total || 0);
        hourlyData[hour].transactions += 1;
        if (receipt.patient_id) hourlyData[hour].patients.add(receipt.patient_id);
      }

      return Object.entries(hourlyData).map(([hour, data]) => ({
        label: `${String(Number(hour)).padStart(2, "0")}:00`,
        revenue: Number(data.revenue.toFixed(2)),
        transactions: data.transactions,
        patients: data.patients.size,
      }));
    }

    // For Week/Month/LastMonth/Custom: Aggregate by day
    const dailyData: Record<string, { revenue: number; transactions: number; patients: Set<string> }> = {};
    const { from, to } = getFilterRange();

    // Initialize all days in range
    const current = new Date(from);
    while (current < to) {
      const dateKey = current.toISOString().split("T")[0];
      dailyData[dateKey] = { revenue: 0, transactions: 0, patients: new Set() };
      current.setDate(current.getDate() + 1);
    }

    for (const receipt of filteredReceipts) {
      const receiptDate = new Date(receipt.created_at);
      const dateKey = receiptDate.toISOString().split("T")[0];
      if (dailyData[dateKey]) {
        dailyData[dateKey].revenue += Number(receipt.total || 0);
        dailyData[dateKey].transactions += 1;
        if (receipt.patient_id) dailyData[dateKey].patients.add(receipt.patient_id);
      }
    }

    return Object.entries(dailyData)
      .map(([date, data]) => {
        const dateObj = new Date(date);
        let label = "";
        
        if (filterType === "week") {
          const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          label = dayNames[dateObj.getDay()];
        } else {
          label = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        }

        return {
          label,
          revenue: Number(data.revenue.toFixed(2)),
          transactions: data.transactions,
          patients: data.patients.size,
        };
      })
      .sort((a, b) => {
        // For week view, sort by day of week
        if (filterType === "week") {
          const dayOrder = { "Sun": 0, "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6 };
          return (dayOrder[a.label as keyof typeof dayOrder] || 0) - (dayOrder[b.label as keyof typeof dayOrder] || 0);
        }
        return 0;
      });
  }, [role, receipts, filterType, selectedClinic, receptionists, getFilterRange, getFilteredReceipts]);

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
      <div className="space-y-8">
        {/* ── HEADER ── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Reports</h1>
            <p className="mt-1 text-sm text-slate-500">
              {role === "boss" ? "All Clinics • Manager View" : `${activeClinicName} • Your Shift`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {role === "boss" && (
              <button
                onClick={() => { setRole(null); setPinInput(""); }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Lock
              </button>
            )}
            {role === "receptionist" && (
              <button
                onClick={() => { setRole(null); setPinInput(""); }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Lock
              </button>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            Loading...
          </div>
        )}

        {!isLoading && role === "boss" && (
          <>
            {/* ── CLINIC AND FILTER DISPLAY ── */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">Clinic</p>
                <p className="text-sm font-semibold text-teal-700">{clinicLabel}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 mb-1">Report Period</p>
                <p className="text-sm font-semibold text-teal-700">{filterLabel}</p>
              </div>
            </div>

            {/* ── CLINIC SELECTOR ── */}
            <div className="mb-4">
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 block mb-2">Select Clinic</label>
              <select
                value={selectedClinic || ""}
                onChange={(e) => setSelectedClinic(e.target.value || null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">All Clinics</option>
                {clinics.map((clinic) => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name}
                  </option>
                ))}
              </select>
            </div>

            {/* ── FILTER BAR ── */}
            <div className="flex flex-wrap gap-2">
              {(["today", "yesterday", "week", "month", "lastMonth"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setFilterType(type);
                    setStartDate("");
                    setEndDate("");
                    setSelectedDate(null);
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    filterType === type
                      ? "bg-teal-700 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {type === "today" && "Today"}
                  {type === "yesterday" && "Yesterday"}
                  {type === "week" && "This Week"}
                  {type === "month" && "This Month"}
                  {type === "lastMonth" && "Last Month"}
                </button>
              ))}
              <button
                onClick={() => setFilterType("custom")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  filterType === "custom"
                    ? "bg-teal-700 text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Custom
              </button>
              {filterType === "selectedDate" && (
                <button
                  onClick={() => {
                    setFilterType("today");
                    setSelectedDate(null);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  ✕ Clear Filter
                </button>
              )}
            </div>

            {/* ── CUSTOM DATE RANGE ── */}
            {filterType === "custom" && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                    />
                  </div>
                  <button
                    onClick={() => { setStartDate(""); setEndDate(""); setFilterType("today"); }}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            {/* ── KPI CARDS ── */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">Key Metrics • {filterLabel}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Gross Sales */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Gross Sales</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">
                        AED {bossStats?.grossRevenue.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Net: AED {bossStats?.totalRevenue.toFixed(2)}
                      </p>
                    </div>
                    <div className="text-3xl text-teal-600">💰</div>
                  </div>
                </div>

                {/* Patients Seen */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Patients Seen</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{bossStats?.totalPatients}</p>
                      <p className="mt-1 text-xs text-slate-400">Unique patients</p>
                    </div>
                    <div className="text-3xl">👥</div>
                  </div>
                </div>

                {/* Transactions */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Transactions</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{bossStats?.totalTransactions}</p>
                      <p className="mt-1 text-xs text-slate-400">Total completed</p>
                    </div>
                    <div className="text-3xl">📊</div>
                  </div>
                </div>

                {/* Average Transaction */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Avg Transaction</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">
                        AED {bossStats && bossStats.totalTransactions > 0
                          ? (bossStats.totalRevenue / bossStats.totalTransactions).toFixed(2)
                          : "0.00"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">Per transaction</p>
                    </div>
                    <div className="text-3xl">📈</div>
                  </div>
                </div>

                {/* Outstanding Balance (Placeholder) */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Outstanding</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">AED 0.00</p>
                      <p className="mt-1 text-xs text-slate-400">Placeholder</p>
                    </div>
                    <div className="text-3xl">⏳</div>
                  </div>
                </div>

                {/* Refunds */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Refunds</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">
                        AED {bossStats?.totalRefunded.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">{refunds.filter((r) => getFilteredReceipts([receipts.find((rec) => rec.id === r.receipt_id)!]).length > 0).length} transactions</p>
                    </div>
                    <div className="text-3xl">↩️</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── REVENUE TREND CHART ── */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Revenue Trend</h3>
              {chartData.length > 0 ? (
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis 
                        dataKey="label" 
                        stroke="#64748b"
                        style={{ fontSize: "0.75rem" }}
                      />
                      <YAxis 
                        stroke="#64748b"
                        style={{ fontSize: "0.75rem" }}
                        tickFormatter={(value) => `AED ${value.toLocaleString()}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #cbd5e1",
                          borderRadius: "0.5rem",
                          padding: "0.75rem",
                        }}
                        formatter={(value, name) => {
                          if (name === "revenue") return [`AED ${Number(value).toFixed(2)}`, "Revenue"];
                          if (name === "transactions") return [value, "Transactions"];
                          if (name === "patients") return [value, "Patients"];
                          return [value, name];
                        }}
                        labelFormatter={(label) => `${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="#0d9488"
                        strokeWidth={3}
                        dot={{ fill: "#0d9488", r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-80 flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-center text-slate-500">
                    <p className="text-sm font-medium">No revenue recorded</p>
                    <p className="text-xs mt-1">during the selected period</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── TOP SERVICES ANALYTICS ── */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Top Services</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Ranked by revenue for {clinicLabel} during {filterLabel}.
                  </p>
                </div>

                {topServicesSummary.highestRevenue && (
                  <div className="rounded-2xl bg-teal-50 px-4 py-3 lg:max-w-xs">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Top Performer</p>
                    <p className="mt-2 text-base font-semibold text-slate-900">{topServicesSummary.highestRevenue.name}</p>
                    <p className="mt-1 text-sm text-teal-700">
                      AED {topServicesSummary.highestRevenue.revenue.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {topServicesSummary.highestRevenue.count} times performed
                    </p>
                  </div>
                )}
              </div>

              {topServicesLoading ? (
                <div className="flex h-56 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">
                  Loading service analytics...
                </div>
              ) : topServicesError ? (
                <div className="flex h-56 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-sm text-red-600">
                  {topServicesError}
                </div>
              ) : topServicesSummary.services.length > 0 ? (
                <>
                  <div className="grid gap-4 py-6 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Services Offered</p>
                      <p className="mt-3 text-2xl font-bold text-slate-900">{topServicesSummary.uniqueServices}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Most Performed</p>
                      <p className="mt-3 text-base font-semibold text-slate-900">{topServicesSummary.mostPerformed?.name || "—"}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {topServicesSummary.mostPerformed ? `${topServicesSummary.mostPerformed.count} times` : "No activity"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Highest Revenue</p>
                      <p className="mt-3 text-base font-semibold text-slate-900">{topServicesSummary.highestRevenue?.name || "—"}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {topServicesSummary.highestRevenue
                          ? `AED ${topServicesSummary.highestRevenue.revenue.toFixed(2)}`
                          : "No activity"}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead className="border-b border-slate-200">
                        <tr>
                          <th className="text-left px-4 py-3 font-semibold text-slate-700">Service</th>
                          <th className="text-center px-4 py-3 font-semibold text-slate-700">Times Performed</th>
                          <th className="text-right px-4 py-3 font-semibold text-slate-700">Revenue</th>
                          <th className="text-right px-4 py-3 font-semibold text-slate-700">% of Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topServicesSummary.services.map((service) => (
                          <tr
                            key={service.id}
                            onClick={() => {
                              setSelectedServiceId(service.id);
                              setSelectedServiceDetail(null);
                              setServiceDetailError("");
                              setShowServicePanel(true);
                            }}
                            className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 ${
                              service.isTopPerformer ? "bg-teal-50/60" : "bg-white"
                            }`}
                          >
                            <td className="px-4 py-4">
                              <div>
                                <p className="font-medium text-slate-900">{service.name}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {service.patientCount} patients • {service.doctorCount} dentists
                                </p>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-center text-slate-600">{service.count}</td>
                            <td className="px-4 py-4 text-right font-semibold text-teal-700">AED {service.revenue.toFixed(2)}</td>
                            <td className="px-4 py-4 text-right text-slate-600">{service.revenueShare.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-4 text-xs text-slate-500">
                    Click any service to inspect patients treated, dentists involved, average price, and revenue trend.
                  </p>
                </>
              ) : (
                <div className="flex h-56 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                  <div className="text-center text-slate-500">
                    <p className="text-sm font-medium">No services were performed during the selected period.</p>
                    <p className="mt-1 text-xs text-slate-400">Try another clinic or date range.</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── CALENDAR ── */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  {calendarDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </h3>
                <div className="flex gap-2">
                  <button onClick={() => navigateMonth(-1)} className="px-3 py-1 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">← Prev</button>
                  <button onClick={() => navigateMonth(1)} className="px-3 py-1 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">Next →</button>
                </div>
              </div>
              {calendarStats && (
                <div className="grid grid-cols-7 gap-1">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                    <div key={day} className="text-center text-xs font-semibold text-slate-500 py-2">{day}</div>
                  ))}
                  {Array.from({ length: calendarStats.startingDayOfWeek }).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square bg-slate-50 rounded" />
                  ))}
                  {Array.from({ length: calendarStats.daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const data = calendarStats.dailyData[day];
                    const clickedDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day);
                    return (
                      <button
                        key={day}
                        onClick={() => {
                          setSelectedDate(clickedDate);
                          setFilterType("selectedDate");
                        }}
                        className="aspect-square rounded border border-slate-200 bg-white p-1.5 text-left text-[10px] hover:border-teal-300 hover:bg-teal-50 transition"
                      >
                        <div className="font-semibold text-slate-900">{day}</div>
                        {data && data.count > 0 && (
                          <>
                            <div className="text-teal-700 font-semibold text-[8px] leading-tight">
                              {data.revenue >= 1000 ? `${(data.revenue / 1000).toFixed(1)}k` : `${data.revenue.toFixed(0)}`}
                            </div>
                            <div className="text-slate-500 text-[8px] leading-tight">{data.patients.size}P</div>
                            {data.hasPromo && <div className="mt-0.5 text-[7px] font-bold text-red-500 leading-tight">PROMO</div>}
                            {data.hasRefund && (
                              <div className={`mt-0.5 text-[7px] font-bold leading-tight ${data.hasLateRefund ? "text-yellow-500" : "text-purple-600"}`}>
                                RFND
                              </div>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── PER CLINIC PERFORMANCE ── */}
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 mb-4">Clinic Performance</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {bossStats && Object.entries(bossStats.clinicMap).map(([clinicId, data]) => (
                  <div key={clinicId} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition">
                    <h4 className="font-semibold text-slate-900">{data.name}</h4>
                    <div className="mt-4 space-y-3">
                      <div>
                        <p className="text-xs text-slate-500">Revenue</p>
                        <p className="mt-1 text-xl font-bold text-teal-700">AED {(data.revenue - data.refunded).toFixed(2)}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-slate-500">Patients</p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">{data.patients.size}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Transactions</p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">—</p>
                        </div>
                      </div>
                      {data.refunded > 0 && (
                        <div className="pt-3 border-t border-slate-200">
                          <p className="text-xs text-red-500">Refunded: −AED {data.refunded.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── PAYMENT METHODS ── */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Payment Methods</h3>
              <div className="space-y-4">
                {bossStats && Object.entries(bossStats.paymentBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([method, amount]) => {
                    const pct = bossStats.totalRevenue > 0 ? ((amount as number) / bossStats.totalRevenue) * 100 : 0;
                    return (
                      <div key={method}>
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="font-medium text-slate-700">{method}</span>
                          <div>
                            <span className="font-semibold text-slate-900">AED {(amount as number).toFixed(2)}</span>
                            <span className="text-slate-500 text-xs ml-2">{pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* ── ANALYTICS SECTION ── */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Top Services */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-4">Top Services</h3>
                <div className="space-y-3">
                  {topServicesSummary.services.length > 0 ? (
                    topServicesSummary.services.slice(0, 5).map((service) => (
                      <div key={service.id} className="flex items-center justify-between pb-3 border-b border-slate-100 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{service.name}</p>
                          <p className="text-xs text-slate-500">{service.count} times performed</p>
                        </div>
                        <p className="font-semibold text-teal-700">AED {service.revenue.toFixed(2)}</p>
                      </div>
                    ))
                  ) : topServicesLoading ? (
                    <p className="text-sm text-slate-500">Loading service data...</p>
                  ) : (
                    <p className="text-sm text-slate-500">No service data available</p>
                  )}
                </div>
              </div>

              {/* Top Dentists (Placeholder) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-4">Top Dentists</h3>
                <div className="h-40 flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-center text-slate-500">
                    <p className="text-sm font-medium">Placeholder</p>
                    <p className="text-xs mt-1">Dentist analytics coming soon</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── SERVICE DETAILS PANEL ── */}
            {showServicePanel && selectedServiceId && (
              <div className="fixed inset-0 z-50 overflow-hidden">
                <div
                  className="absolute inset-0 bg-black/50"
                  onClick={() => {
                    setShowServicePanel(false);
                    setSelectedServiceDetail(null);
                    setServiceDetailError("");
                    setServiceDetailLoading(false);
                  }}
                />
                <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-lg rounded-l-2xl overflow-y-auto">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-bold text-slate-900">
                        {selectedServiceDetail?.name || "Service Details"}
                      </h2>
                      <button
                        onClick={() => {
                          setShowServicePanel(false);
                          setSelectedServiceDetail(null);
                          setServiceDetailError("");
                          setServiceDetailLoading(false);
                        }}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        ✕
                      </button>
                    </div>

                    {serviceDetailLoading ? (
                      <div className="flex h-64 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">
                        Loading service detail...
                      </div>
                    ) : serviceDetailError ? (
                      <div className="flex h-64 items-center justify-center rounded-xl border border-red-100 bg-red-50 px-6 text-center text-sm text-red-600">
                        {serviceDetailError}
                      </div>
                    ) : selectedServiceDetail ? (
                      <>
                        <div className="space-y-4 border-b border-slate-200 pb-6">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Total Revenue</p>
                            <p className="mt-1 text-2xl font-bold text-teal-700">AED {selectedServiceDetail.revenue.toFixed(2)}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Times Performed</p>
                              <p className="mt-1 text-xl font-bold text-slate-900">{selectedServiceDetail.count}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Patients Treated</p>
                              <p className="mt-1 text-xl font-bold text-slate-900">{selectedServiceDetail.patientCount}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Average Price</p>
                              <p className="mt-1 text-lg font-bold text-slate-900">AED {selectedServiceDetail.averagePrice.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">% of Revenue</p>
                              <p className="mt-1 text-lg font-bold text-slate-900">{selectedServiceDetail.revenueShare.toFixed(1)}%</p>
                            </div>
                          </div>
                        </div>

                        <div className="py-6 border-b border-slate-200">
                          <div className="mb-4 flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">Revenue Trend</p>
                            <p className="text-xs text-slate-500">{filterLabel}</p>
                          </div>
                          {selectedServiceDetail.revenueTrend.length > 0 ? (
                            <div className="h-48 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={selectedServiceDetail.revenueTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                  <XAxis dataKey="label" stroke="#64748b" style={{ fontSize: "0.7rem" }} />
                                  <YAxis
                                    stroke="#64748b"
                                    style={{ fontSize: "0.7rem" }}
                                    tickFormatter={(value) => `AED ${Number(value).toFixed(0)}`}
                                  />
                                  <Tooltip
                                    formatter={(value, name) => {
                                      if (name === "revenue") return [`AED ${Number(value).toFixed(2)}`, "Revenue"];
                                      if (name === "count") return [value, "Times Performed"];
                                      return [value, name];
                                    }}
                                  />
                                  <Line type="monotone" dataKey="revenue" stroke="#0d9488" strokeWidth={3} dot={{ fill: "#0d9488", r: 3 }} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          ) : (
                            <div className="flex h-32 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">
                              No trend data available for this filter.
                            </div>
                          )}
                        </div>

                        <div className="py-6 border-b border-slate-200">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">Dentists Who Performed It</p>
                          {selectedServiceDetail.doctors.length > 0 ? (
                            <div className="space-y-2">
                              {selectedServiceDetail.doctors.map((doctor) => (
                                <p key={doctor.id} className="text-sm text-slate-700">• {doctor.name}</p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">No dentists recorded for this service.</p>
                          )}
                        </div>

                        <div className="py-6">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-600">Patients Treated</p>
                          {selectedServiceDetail.patients.length > 0 ? (
                            <div className="max-h-64 space-y-2 overflow-y-auto">
                              {selectedServiceDetail.patients.map((patient) => (
                                <p key={patient.id} className="text-sm text-slate-700">• {patient.name}</p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">No patient records found for this service.</p>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex h-64 items-center justify-center rounded-xl bg-slate-50 px-6 text-center text-sm text-slate-500">
                        This service was not found for the selected filters.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── RECENT TRANSACTIONS ── */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm overflow-x-auto">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Recent Transactions</h3>
              <table className="w-full min-w-[600px] text-sm">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Time</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Patient</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Clinic</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Method</th>
                    <th className="text-right px-4 py-3 font-semibold text-slate-600">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredReceipts(receipts).slice(0, 10).map((receipt, i) => {
                    const patient = patients.find((p) => p.id === receipt.patient_id);
                    const receptionist = receptionists.find((r) => r.id === receipt.receptionist_id);
                    const clinic = clinics.find((c) => c.id === receptionist?.clinic_id);
                    return (
                      <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600">
                          {new Date(receipt.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-3 text-slate-900 font-medium">{patient?.name || "Unknown"}</td>
                        <td className="px-4 py-3 text-slate-600">{clinic?.name || "Unknown"}</td>
                        <td className="px-4 py-3 text-slate-600">{receipt.payment_method}</td>
                        <td className="px-4 py-3 text-right font-semibold text-teal-700">AED {receipt.total.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
        )}

        {!isLoading && role === "receptionist" && receptionistStats && (
          <>
            {/* ── RECEPTIONIST VIEW ── */}
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-teal-200 bg-teal-50 p-6 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal-600">Total Revenue</p>
                  <p className="mt-2 text-2xl font-bold text-teal-800">AED {receptionistStats.totalRevenue.toFixed(2)}</p>
                  <p className="mt-1 text-xs text-slate-400">{receptionistStats.totalTransactions} transactions</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Cash Collected</p>
                  <p className="mt-2 text-2xl font-bold text-slate-800">AED {receptionistStats.cashTotal.toFixed(2)}</p>
                  <p className="mt-1 text-xs text-slate-400">{receptionistStats.cashCount} cash transactions</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Your Clinic</p>
                  <p className="mt-2 text-lg font-bold text-slate-800">{activeClinicName}</p>
                  <p className="mt-1 text-xs text-slate-400">{filterLabel}</p>
                </div>
              </div>

              {/* Payment Methods */}
              {Object.keys(receptionistStats.paymentBreakdown).length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900 mb-4">Payment Methods</h3>
                  <div className="space-y-3">
                    {Object.entries(receptionistStats.paymentBreakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([method, amount]) => {
                        const pct = receptionistStats.totalRevenue > 0 ? ((amount as number) / receptionistStats.totalRevenue) * 100 : 0;
                        return (
                          <div key={method}>
                            <div className="flex items-center justify-between text-sm mb-2">
                              <span className="font-medium text-slate-700">{method}</span>
                              <span className="font-semibold text-slate-900">AED {(amount as number).toFixed(2)}</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
            </>
        )}
      </div>
    </AppFrame>
  );
}
