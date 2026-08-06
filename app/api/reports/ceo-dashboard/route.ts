import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { buildComparisonRange, buildDashboardRange, DashboardPeriod, percentageChange, statusFromTarget } from "../../../../lib/ceo-dashboard";
import { extractLegacyCashAmount } from "../../../../lib/cash-deductions";

export const dynamic = "force-dynamic";

type SessionRow = {
  token: string;
  session_mode?: string | null;
  user_role?: string | null;
  clinic_id?: string | null;
};

type ReceiptRow = {
  id: string;
  patient_id: string | null;
  receptionist_id: string | null;
  doctor_id: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  total_before_gateway_fee: number | null;
  gateway_fee: number | null;
  amount_paid: number | null;
  discount_amount: number | null;
  payment_method: string | null;
  created_at: string;
  transaction_type?: string | null;
};

type ReceptionistRow = {
  id: string;
  clinic_id: string | null;
};

type RefundRow = {
  id: string;
  receipt_id: string;
  total_amount: number | null;
  created_at: string;
};

type RefundItemRow = {
  refund_id: string;
  amount: number | null;
};

type PaymentRecordRow = {
  id: string;
  clinic_id: string;
  receipt_id?: string | null;
  receptionist_id?: string | null;
  total_payment_fee_amount: number | null;
  total_customer_charged_amount: number | null;
  status: string | null;
  created_at: string;
};

type PaymentAllocationRow = {
  id: string;
  payment_id: string;
  method_group: string;
  method_variant: string;
  treatment_net_amount: number | null;
  fee_amount: number | null;
  refunded_treatment_amount: number | null;
  refunded_fee_amount: number | null;
  customer_charged_amount?: number | null;
};

type PaymentAllocationRefundRow = {
  payment_id: string;
  payment_allocation_id: string;
  refunded_treatment_amount: number | null;
  total_returned_amount: number | null;
  reversed_fee_amount: number | null;
  created_at: string;
};

type OutstandingBalanceRow = {
  id: string;
  clinic_id: string;
  original_amount: number | null;
  created_at?: string | null;
};

type BalancePaymentRow = {
  outstanding_balance_id: string;
  amount: number | null;
  created_at: string;
};

type TreatmentPlanRow = {
  id: string;
  clinic_id: string;
  total_amount: number | null;
  created_at?: string | null;
};

type TreatmentPlanPaymentRow = {
  treatment_plan_id: string;
  clinic_id: string;
  amount: number | null;
  payment_method?: string | null;
  receptionist_id?: string | null;
  created_at?: string | null;
};

type CashSupplementRow = {
  amount: number | null;
  receptionist_id: string | null;
  payment_method?: string | null;
  created_at?: string | null;
};

type CashDeductionRow = {
  id: string;
  clinic_id: string;
  register_session_id: string;
  business_date: string;
  type: "expense" | "commission";
  paid_to_name: string;
  description: string;
  reference_number: string | null;
  amount: number | null;
  status: "active" | "voided";
  created_at: string;
  created_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

type CashRegisterSessionRow = {
  id: string;
  receptionist_id: string;
  opened_at: string;
  closed_at: string | null;
};

type DoctorRow = {
  id: string;
  name: string;
  clinic_id: string | null;
};

type ReceiptItemRow = {
  receipt_id: string;
  doctor_id: string | null;
  total: number | null;
};

type TargetRow = {
  clinic_id: string;
  target_year: number;
  target_month: number;
  net_sales_target: number;
};

type ScheduleRow = {
  clinic_id: string;
  weekday: number;
  is_open: boolean;
};

type EventRow = {
  clinic_id: string | null;
  applies_to_all_clinics: boolean;
  start_date: string;
  end_date: string;
  event_type: string;
  is_closed_day: boolean;
};

function asNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTableMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

function normalizeMethodGroup(group: string) {
  const key = String(group || "").toLowerCase();
  if (key === "cash") return "cash";
  if (key === "card") return "card";
  if (key === "tabby") return "tabby";
  if (key === "tamara") return "tamara";
  return "unknown";
}

function dubaiDateOnly(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
}

function parseYmd(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return { y, m, d };
}

function makeDubaiDate(ymd: string) {
  return new Date(`${ymd}T00:00:00+04:00`);
}

function addDays(ymd: string, days: number) {
  const date = makeDubaiDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return dubaiDateOnly(date);
}

function eachDubaiDay(startIso: string, endIso: string) {
  const days: string[] = [];
  let cursor = dubaiDateOnly(new Date(startIso));
  const end = dubaiDateOnly(new Date(endIso));
  while (cursor < end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function weekdayDubai(ymd: string) {
  const weekdayText = makeDubaiDate(ymd).toLocaleDateString("en-US", { timeZone: "Asia/Dubai", weekday: "short" });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekdayText] ?? 0;
}

function nextMonthStart(ymd: string) {
  const { y, m } = parseYmd(ymd);
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

function matchesClinic(event: EventRow, clinicId: string) {
  return event.applies_to_all_clinics || event.clinic_id === clinicId;
}

function isClosedByEvent(day: string, clinicId: string, events: EventRow[]) {
  for (const event of events) {
    if (!matchesClinic(event, clinicId)) continue;
    if (!event.is_closed_day) continue;
    if (day >= event.start_date && day <= event.end_date) return true;
  }
  return false;
}

function isClinicOpenOnDay(clinicId: string, day: string, scheduleByClinic: Map<string, Map<number, boolean>>, events: EventRow[]) {
  const schedule = scheduleByClinic.get(clinicId);
  // No schedule configured → assume open every day (avoid suppressing all targets).
  const weekday = weekdayDubai(day);
  if (schedule) {
    if (!schedule.has(weekday)) return true; // weekday not explicitly configured → assume open
    if (!schedule.get(weekday)) return false;
  }
  // No schedule for clinic at all → treat as open, but still check event closures below.
  if (isClosedByEvent(day, clinicId, events)) return false;
  return true;
}

function monthKey(ymd: string) {
  return ymd.slice(0, 7);
}

function expectedTargetForRange(
  clinicId: string,
  startIso: string,
  endIso: string,
  targetsByClinicMonth: Map<string, number>,
  scheduleByClinic: Map<string, Map<number, boolean>>,
  events: EventRow[]
) {
  const days = eachDubaiDay(startIso, endIso);
  const uniqueMonths = [...new Set(days.map((day) => monthKey(day)))];
  let expected = 0;
  let hasAnyTarget = false;

  for (const month of uniqueMonths) {
    const monthStart = `${month}-01`;
    const monthEnd = nextMonthStart(monthStart);
    const monthDays = eachDubaiDay(makeDubaiDate(monthStart).toISOString(), makeDubaiDate(monthEnd).toISOString());
    const openDaysInMonth = monthDays.filter((day) => isClinicOpenOnDay(clinicId, day, scheduleByClinic, events) !== false).length;
    if (openDaysInMonth <= 0) continue;
    const targetKey = `${clinicId}:${month}`;
    const monthlyTarget = targetsByClinicMonth.get(targetKey);
    if (monthlyTarget == null) continue;
    hasAnyTarget = true;
    const openDaysInRange = days.filter((day) => monthKey(day) === month && isClinicOpenOnDay(clinicId, day, scheduleByClinic, events) !== false).length;
    expected += (monthlyTarget * openDaysInRange) / openDaysInMonth;
  }

  return { expectedTarget: expected, hasAnyTarget };
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ error: "Supabase configuration is missing." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const period = String(body?.period || "today") as DashboardPeriod;
  const clinicId = String(body?.clinicId || "").trim() || null;
  const customStart = body?.customStart ? String(body.customStart) : null;
  const customEnd = body?.customEnd ? String(body.customEnd) : null;
  const selectedYear = Number(body?.year || new Date().getFullYear());

  let currentRange;
  try {
    currentRange = buildDashboardRange({ period, customStart, customEnd });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid date range." }, { status: 400 });
  }
  const compareRange = buildComparisonRange(currentRange);
  const yearRange = {
    startIso: new Date(`${selectedYear}-01-01T00:00:00+04:00`).toISOString(),
    endIso: new Date(`${selectedYear + 1}-01-01T00:00:00+04:00`).toISOString(),
    previousStartIso: new Date(`${selectedYear - 1}-01-01T00:00:00+04:00`).toISOString(),
    previousEndIso: new Date(`${selectedYear}-01-01T00:00:00+04:00`).toISOString(),
  };
  const historyRange = {
    startIso: new Date(new Date(currentRange.endUtcIso).getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    endIso: currentRange.endUtcIso,
  };
  const currentRangeStartDubai = dubaiDateOnly(new Date(currentRange.startUtcIso));
  const currentRangeEndDubai = addDays(dubaiDateOnly(new Date(currentRange.endUtcIso)), -1);
  const compareRangeStartDubai = dubaiDateOnly(new Date(compareRange.startUtcIso));
  const compareRangeEndDubai = addDays(dubaiDateOnly(new Date(compareRange.endUtcIso)), -1);

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("app-auth")?.value || "";
  if (!sessionToken) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: sessionData, error: sessionError } = await supabase
    .from("active_sessions")
    .select("token, session_mode, user_role, clinic_id")
    .eq("token", sessionToken)
    .maybeSingle();

  if (sessionError || !sessionData) return Response.json({ error: "Unauthorized session." }, { status: 401 });
  const session = sessionData as SessionRow;
  const sessionMode = String(session.session_mode || "").toLowerCase();
  const sessionRole = String(session.user_role || "").toLowerCase();
  const allowedRoles = new Set(["ceo", "it_admin"]);
  if (sessionMode !== "manager" || !allowedRoles.has(sessionRole)) {
    return Response.json({ error: "Forbidden. CEO dashboard access is limited to CEO and IT administrator roles." }, { status: 403 });
  }

  const [clinicsRes, receptionistsRes, doctorsRes] = await Promise.all([
    supabase.from("clinics").select("id, name").order("name", { ascending: true }),
    supabase.from("receptionist").select("id, clinic_id"),
    supabase.from("doctors").select("id, name, clinic_id"),
  ]);
  if (clinicsRes.error || receptionistsRes.error || doctorsRes.error) {
    return Response.json({ error: "Failed to load master data." }, { status: 500 });
  }

  const clinics = (clinicsRes.data || []) as Array<{ id: string; name: string }>;
  const receptionists = (receptionistsRes.data || []) as ReceptionistRow[];
  const doctors = (doctorsRes.data || []) as DoctorRow[];
  const receptionistClinicMap = new Map(receptionists.map((row) => [row.id, row.clinic_id || ""]));
  const clinicIds = clinicId ? [clinicId] : clinics.map((clinic) => clinic.id);
  const selectedReceptionistIds = new Set(
    receptionists.filter((row) => clinicIds.includes(String(row.clinic_id || ""))).map((row) => row.id)
  );

  if (clinicId && !clinics.some((clinic) => clinic.id === clinicId)) {
    return Response.json({ error: "Invalid clinic filter." }, { status: 400 });
  }
  if (selectedReceptionistIds.size === 0 && clinicId) {
    return Response.json({
      meta: { currentRange, compareRange, lastUpdatedAt: new Date().toISOString() },
      overview: null,
      clinicPerformance: [],
      doctorPerformance: [],
      trends: { monthly: [], patientDemand: { historyDays: 0, message: "Not enough history.", dayOfWeek: [], dayOfMonthBuckets: [] } },
      payments: { methods: [], missingAllocationCoverage: true },
      cashManagement: {
        cashCollected: 0,
        commissionsPaid: 0,
        expensesPaid: 0,
        totalCashDeductions: 0,
        cashAfterDeductions: 0,
        details: [],
      },
      attentionItems: ["No reception staff assigned to the selected clinic."],
    });
  }

  const fetchReceipts = async (startIso: string, endIso: string) => {
    let query = supabase
      .from("receipts")
      .select("id, patient_id, receptionist_id, doctor_id, subtotal, vat, total, total_before_gateway_fee, gateway_fee, amount_paid, discount_amount, payment_method, created_at, transaction_type")
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    if (selectedReceptionistIds.size > 0 && selectedReceptionistIds.size !== receptionists.length) {
      query = query.in("receptionist_id", [...selectedReceptionistIds]);
    }
    const { data, error } = await query;
    if (error) throw error;
    return ((data || []) as ReceiptRow[]).filter((row) => String(row.transaction_type || "regular") !== "plan_summary");
  };

  const fetchRefunds = async (startIso: string, endIso: string) => {
    const { data, error } = await supabase
      .from("refunds")
      .select("id, receipt_id, total_amount, created_at")
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    if (error) throw error;
    return (data || []) as RefundRow[];
  };

  const fetchRefundItems = async (refundIds: string[]) => {
    if (refundIds.length === 0) return [] as RefundItemRow[];
    const { data, error } = await supabase
      .from("refund_items")
      .select("refund_id, amount")
      .in("refund_id", refundIds);
    if (error) throw error;
    return (data || []) as RefundItemRow[];
  };

  const [currentReceipts, compareReceipts, yearlyReceipts, previousYearReceipts, historyReceipts, currentRefunds, compareRefunds] = await Promise.all([
    fetchReceipts(currentRange.startUtcIso, currentRange.endUtcIso),
    fetchReceipts(compareRange.startUtcIso, compareRange.endUtcIso),
    fetchReceipts(yearRange.startIso, yearRange.endIso),
    fetchReceipts(yearRange.previousStartIso, yearRange.previousEndIso),
    fetchReceipts(historyRange.startIso, historyRange.endIso),
    fetchRefunds(currentRange.startUtcIso, currentRange.endUtcIso),
    fetchRefunds(compareRange.startUtcIso, compareRange.endUtcIso),
  ]);

  const currentReceiptMap = new Map(currentReceipts.map((row) => [row.id, row]));
  const compareReceiptMap = new Map(compareReceipts.map((row) => [row.id, row]));
  const currentRefundsFiltered = currentRefunds.filter((refund) => currentReceiptMap.has(refund.receipt_id));
  const compareRefundsFiltered = compareRefunds.filter((refund) => compareReceiptMap.has(refund.receipt_id));

  let currentRefundItems: RefundItemRow[] = [];
  let compareRefundItems: RefundItemRow[] = [];
  try {
    [currentRefundItems, compareRefundItems] = await Promise.all([
      fetchRefundItems(currentRefundsFiltered.map((row) => row.id)),
      fetchRefundItems(compareRefundsFiltered.map((row) => row.id)),
    ]);
  } catch (error) {
    if (!isTableMissing(error)) throw error;
  }

  const groupedRefundTreatment = (rows: RefundItemRow[]) => {
    const byRefund = new Map<string, number>();
    for (const row of rows) {
      byRefund.set(row.refund_id, (byRefund.get(row.refund_id) || 0) + asNumber(row.amount));
    }
    return byRefund;
  };

  const currentRefundTreatmentByRefund = groupedRefundTreatment(currentRefundItems);
  const compareRefundTreatmentByRefund = groupedRefundTreatment(compareRefundItems);

  const currentRefundTreatment = currentRefundsFiltered.reduce((sum, row) => sum + (currentRefundTreatmentByRefund.get(row.id) || 0), 0);
  const compareRefundTreatment = compareRefundsFiltered.reduce((sum, row) => sum + (compareRefundTreatmentByRefund.get(row.id) || 0), 0);

  const sumReceiptCollectionAmount = (rows: ReceiptRow[]) => rows.reduce((sum, row) => sum + (row.amount_paid == null ? asNumber(row.total) : asNumber(row.amount_paid)), 0);
  const sumAmountRows = (rows: Array<{ amount: number | null }>) => rows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  const fetchCollectionSupplementRows = async (tableName: string, startIso: string, endIso: string) => {
    if (selectedReceptionistIds.size === 0) return [] as CashSupplementRow[];
    const { data, error } = await supabase
      .from(tableName)
      .select("amount, receptionist_id, payment_method, created_at")
      .in("receptionist_id", [...selectedReceptionistIds])
      .gte("created_at", startIso)
      .lt("created_at", endIso);
    if (error) {
      if (isTableMissing(error)) return [];
      throw error;
    }
    return (data || []) as CashSupplementRow[];
  };

  const [currentBalancePayments, currentDeposits, currentTreatmentPlanPayments, compareBalancePayments, compareDeposits, compareTreatmentPlanPayments, yearlyBalancePayments, yearlyDeposits, yearlyTreatmentPlanPayments, previousYearBalancePaymentRows, previousYearDepositRows, previousYearTreatmentPlanPaymentRows] = await Promise.all([
    fetchCollectionSupplementRows("balance_payments", currentRange.startUtcIso, currentRange.endUtcIso),
    fetchCollectionSupplementRows("patient_credits", currentRange.startUtcIso, currentRange.endUtcIso),
    fetchCollectionSupplementRows("treatment_plan_payments", currentRange.startUtcIso, currentRange.endUtcIso),
    fetchCollectionSupplementRows("balance_payments", compareRange.startUtcIso, compareRange.endUtcIso),
    fetchCollectionSupplementRows("patient_credits", compareRange.startUtcIso, compareRange.endUtcIso),
    fetchCollectionSupplementRows("treatment_plan_payments", compareRange.startUtcIso, compareRange.endUtcIso),
    fetchCollectionSupplementRows("balance_payments", yearRange.startIso, yearRange.endIso),
    fetchCollectionSupplementRows("patient_credits", yearRange.startIso, yearRange.endIso),
    fetchCollectionSupplementRows("treatment_plan_payments", yearRange.startIso, yearRange.endIso),
    fetchCollectionSupplementRows("balance_payments", yearRange.previousStartIso, yearRange.previousEndIso),
    fetchCollectionSupplementRows("patient_credits", yearRange.previousStartIso, yearRange.previousEndIso),
    fetchCollectionSupplementRows("treatment_plan_payments", yearRange.previousStartIso, yearRange.previousEndIso),
  ]);

  const currentCollectionsEod = sumReceiptCollectionAmount(currentReceipts)
    + sumAmountRows(currentBalancePayments)
    + sumAmountRows(currentDeposits)
    + sumAmountRows(currentTreatmentPlanPayments);
  const compareCollectionsEod = sumReceiptCollectionAmount(compareReceipts)
    + sumAmountRows(compareBalancePayments)
    + sumAmountRows(compareDeposits)
    + sumAmountRows(compareTreatmentPlanPayments);

  const currentNetSales = currentCollectionsEod;
  const compareNetSales = compareCollectionsEod;
  const currentCollections = currentCollectionsEod;
  const compareCollections = compareCollectionsEod;
  const currentUniquePatients = new Set(currentReceipts.map((row) => row.patient_id).filter(Boolean)).size;
  const compareUniquePatients = new Set(compareReceipts.map((row) => row.patient_id).filter(Boolean)).size;
  const currentCompletedVisits = currentReceipts.length;

  const currentPatientIds = new Set(currentReceipts.map((row) => row.patient_id).filter((value): value is string => !!value));
  const { data: historicalBeforeRows, error: historicalBeforeError } = await supabase
    .from("receipts")
    .select("patient_id, receptionist_id, created_at, transaction_type")
    .lt("created_at", currentRange.startUtcIso);
  if (historicalBeforeError) return Response.json({ error: historicalBeforeError.message }, { status: 500 });
  const historicalBefore = ((historicalBeforeRows || []) as Array<{ patient_id: string | null; receptionist_id: string | null; transaction_type?: string | null }>)
    .filter((row) => String(row.transaction_type || "regular") !== "plan_summary")
    .filter((row) => {
      if (!row.receptionist_id) return false;
      const clinicOfReceptionist = receptionistClinicMap.get(row.receptionist_id) || "";
      return clinicIds.includes(clinicOfReceptionist);
    });
  const previousPatientSet = new Set(historicalBefore.map((row) => row.patient_id).filter((value): value is string => !!value));
  let newPatients = 0;
  let returningPatients = 0;
  for (const patientId of currentPatientIds) {
    if (previousPatientSet.has(patientId)) returningPatients += 1;
    else newPatients += 1;
  }

  // Targets / schedules / events are optional dependencies.
  let targetRows: TargetRow[] = [];
  let scheduleRows: ScheduleRow[] = [];
  let eventRows: EventRow[] = [];
  let targetDataAvailable = true;
  try {
    const [targetsRes, scheduleRes, eventsRes] = await Promise.all([
      supabase
        .from("clinic_monthly_targets")
        .select("clinic_id, target_year, target_month, net_sales_target"),
      supabase
        .from("clinic_operating_schedule")
        .select("clinic_id, weekday, is_open"),
      supabase
        .from("clinic_calendar_events")
        .select("clinic_id, applies_to_all_clinics, start_date, end_date, event_type, is_closed_day"),
    ]);
    if (targetsRes.error || scheduleRes.error || eventsRes.error) {
      if (isTableMissing(targetsRes.error || scheduleRes.error || eventsRes.error)) {
        targetDataAvailable = false;
      } else {
        return Response.json({ error: "Failed loading target configuration." }, { status: 500 });
      }
    } else {
      targetRows = (targetsRes.data || []) as TargetRow[];
      scheduleRows = (scheduleRes.data || []) as ScheduleRow[];
      eventRows = (eventsRes.data || []) as EventRow[];
    }
  } catch (error) {
    if (!isTableMissing(error)) throw error;
    targetDataAvailable = false;
  }

  const scheduleByClinic = new Map<string, Map<number, boolean>>();
  for (const row of scheduleRows) {
    if (!scheduleByClinic.has(row.clinic_id)) scheduleByClinic.set(row.clinic_id, new Map<number, boolean>());
    scheduleByClinic.get(row.clinic_id)!.set(Number(row.weekday), !!row.is_open);
  }
  const targetsByClinicMonth = new Map<string, number>();
  for (const row of targetRows) {
    const month = `${row.target_year}-${String(row.target_month).padStart(2, "0")}`;
    targetsByClinicMonth.set(`${row.clinic_id}:${month}`, asNumber(row.net_sales_target));
  }

  const clinicPerformance = clinicIds.map((id) => {
    const name = clinics.find((clinic) => clinic.id === id)?.name || "Unknown Clinic";
    const clinicReceipts = currentReceipts.filter((row) => receptionistClinicMap.get(row.receptionist_id || "") === id);
    const clinicCompareReceipts = compareReceipts.filter((row) => receptionistClinicMap.get(row.receptionist_id || "") === id);
    const clinicPatients = new Set(clinicReceipts.map((row) => row.patient_id).filter(Boolean)).size;
    const clinicReceiptCollections = sumReceiptCollectionAmount(clinicReceipts);
    const clinicCompareReceiptCollections = sumReceiptCollectionAmount(clinicCompareReceipts);
    const clinicBalancePayments = currentBalancePayments.filter((row) => row.receptionist_id && receptionistClinicMap.get(row.receptionist_id) === id);
    const clinicCompareBalancePayments = compareBalancePayments.filter((row) => row.receptionist_id && receptionistClinicMap.get(row.receptionist_id) === id);
    const clinicDeposits = currentDeposits.filter((row) => row.receptionist_id && receptionistClinicMap.get(row.receptionist_id) === id);
    const clinicCompareDeposits = compareDeposits.filter((row) => row.receptionist_id && receptionistClinicMap.get(row.receptionist_id) === id);
    const clinicTreatmentPlanPayments = currentTreatmentPlanPayments.filter((row) => row.receptionist_id && receptionistClinicMap.get(row.receptionist_id) === id);
    const clinicCompareTreatmentPlanPayments = compareTreatmentPlanPayments.filter((row) => row.receptionist_id && receptionistClinicMap.get(row.receptionist_id) === id);
    const clinicCollections = clinicReceiptCollections + sumAmountRows(clinicBalancePayments) + sumAmountRows(clinicDeposits) + sumAmountRows(clinicTreatmentPlanPayments);
    const clinicCompareCollections = clinicCompareReceiptCollections + sumAmountRows(clinicCompareBalancePayments) + sumAmountRows(clinicCompareDeposits) + sumAmountRows(clinicCompareTreatmentPlanPayments);
    const expected = targetDataAvailable
      ? expectedTargetForRange(id, currentRange.startUtcIso, currentRange.endUtcIso, targetsByClinicMonth, scheduleByClinic, eventRows)
      : { expectedTarget: 0, hasAnyTarget: false };
    const targetAttainment = expected.hasAnyTarget && expected.expectedTarget > 0
      ? (clinicCollections / expected.expectedTarget) * 100
      : null;
    const avgPerPatient = clinicPatients > 0 ? clinicCollections / clinicPatients : 0;

    return {
      clinicId: id,
      clinicName: name,
      netSales: clinicCollections,
      expectedTarget: expected.hasAnyTarget ? expected.expectedTarget : null,
      targetAttainment,
      status: statusFromTarget(targetAttainment),
      previousPeriodChangePercent: percentageChange(clinicCollections, clinicCompareCollections),
      uniquePatients: clinicPatients,
      averageNetSalesPerPatient: avgPerPatient,
    };
  });

  // Outstanding (snapshot at period end).
  const outstandingWindowEnd = currentRange.endUtcIso > compareRange.endUtcIso ? currentRange.endUtcIso : compareRange.endUtcIso;
  const [outstandingRowsRes, planRowsRes] = await Promise.all([
    supabase
      .from("outstanding_balances")
      .select("id, clinic_id, original_amount, created_at")
      .in("clinic_id", clinicIds)
      .lt("created_at", outstandingWindowEnd),
    supabase
      .from("treatment_plans")
      .select("id, clinic_id, total_amount, created_at")
      .in("clinic_id", clinicIds)
      .lt("created_at", outstandingWindowEnd),
  ]);
  if (outstandingRowsRes.error || planRowsRes.error) {
    return Response.json({ error: "Failed loading outstanding balance data." }, { status: 500 });
  }
  const outstandingRows = (outstandingRowsRes.data || []) as OutstandingBalanceRow[];
  const planRows = (planRowsRes.data || []) as TreatmentPlanRow[];
  const outstandingIds = outstandingRows.map((row) => row.id);
  const planIds = planRows.map((row) => row.id);

  const fetchBalancePayments = async () => {
    if (outstandingIds.length === 0) return [] as BalancePaymentRow[];
    const chunkSize = 500;
    const rows: BalancePaymentRow[] = [];
    for (let index = 0; index < outstandingIds.length; index += chunkSize) {
      const chunk = outstandingIds.slice(index, index + chunkSize);
      const { data, error } = await supabase
        .from("balance_payments")
        .select("outstanding_balance_id, amount, created_at")
        .in("outstanding_balance_id", chunk)
        .lt("created_at", outstandingWindowEnd);
      if (error) throw error;
      rows.push(...((data || []) as BalancePaymentRow[]));
    }
    return rows;
  };

  const fetchPlanPayments = async () => {
    if (planIds.length === 0) return [] as TreatmentPlanPaymentRow[];
    const chunkSize = 500;
    const rows: TreatmentPlanPaymentRow[] = [];
    for (let index = 0; index < planIds.length; index += chunkSize) {
      const chunk = planIds.slice(index, index + chunkSize);
      const { data, error } = await supabase
        .from("treatment_plan_payments")
        .select("treatment_plan_id, clinic_id, amount, created_at")
        .in("treatment_plan_id", chunk)
        .lt("created_at", outstandingWindowEnd);
      if (error) throw error;
      rows.push(...((data || []) as TreatmentPlanPaymentRow[]));
    }
    return rows;
  };

  const [balancePaymentRows, planPaymentRows] = await Promise.all([fetchBalancePayments(), fetchPlanPayments()]);

  const computeOutstandingAt = (endIso: string) => {
    const paidByBalance = new Map<string, number>();
    for (const row of balancePaymentRows) {
      if (row.created_at >= endIso) continue;
      paidByBalance.set(row.outstanding_balance_id, (paidByBalance.get(row.outstanding_balance_id) || 0) + asNumber(row.amount));
    }
    const outstandingLegacy = outstandingRows
      .filter((row) => !row.created_at || row.created_at < endIso)
      .reduce((sum, row) => sum + Math.max(0, asNumber(row.original_amount) - (paidByBalance.get(row.id) || 0)), 0);

    const paidByPlan = new Map<string, number>();
    for (const row of planPaymentRows) {
      const createdAt = row.created_at;
      if (createdAt && createdAt >= endIso) continue;
      paidByPlan.set(row.treatment_plan_id, (paidByPlan.get(row.treatment_plan_id) || 0) + asNumber(row.amount));
    }
    const outstandingPlans = planRows.reduce((sum, row) => sum + Math.max(0, asNumber(row.total_amount) - (paidByPlan.get(row.id) || 0)), 0);
    return outstandingLegacy + outstandingPlans;
  };

  const currentOutstanding = computeOutstandingAt(currentRange.endUtcIso);
  const compareOutstanding = computeOutstandingAt(compareRange.endUtcIso);

  // Doctor performance.
  let doctorPerformanceWarning: string | null = null;
  let doctorPerformance: Array<{
    doctorId: string;
    doctorName: string;
    clinicName: string;
    uniquePatients: number;
    completedVisits: number;
    netSales: number;
    averageNetSalesPerPatient: number;
  }> = [];
  if (currentReceipts.length > 0) {
    const receiptIds = currentReceipts.map((row) => row.id);
    const chunkSize = 500;
    const allReceiptItems: ReceiptItemRow[] = [];
    for (let index = 0; index < receiptIds.length; index += chunkSize) {
      const chunk = receiptIds.slice(index, index + chunkSize);
      const { data: receiptItemsData, error: receiptItemsError } = await supabase
        .from("receipt_items")
        .select("receipt_id, doctor_id, total")
        .in("receipt_id", chunk);
      if (receiptItemsError) {
        const errorCode = String((receiptItemsError as { code?: string }).code || "");
        if (isTableMissing(receiptItemsError)) {
          doctorPerformanceWarning = "Doctor performance is unavailable because receipt item tables are not yet available.";
        } else if (errorCode === "42501") {
          doctorPerformanceWarning = "Doctor performance is unavailable due to receipt item permission policy.";
        } else {
          doctorPerformanceWarning = "Doctor performance is temporarily unavailable.";
        }
        console.error("Doctor performance query failed", receiptItemsError);
        break;
      }
      allReceiptItems.push(...((receiptItemsData || []) as ReceiptItemRow[]));
    }
    const items = allReceiptItems;
    // Build a map from receiptId → doctor_id (from receipt_items rows that have it set)
    const itemDoctorByReceipt = new Map<string, string>();
    for (const item of items) {
      if (item.doctor_id) itemDoctorByReceipt.set(item.receipt_id, item.doctor_id);
    }

    const doctorMap = new Map<string, {
      doctorId: string;
      doctorName: string;
      clinicId: string | null;
      receiptIds: Set<string>;
      patientIds: Set<string>;
      netSales: number;
    }>();

    // Aggregate per receipt. doctor_id comes from receipt_items if set,
    // otherwise falls back to receipts.doctor_id (which is always populated).
    for (const receipt of currentReceipts) {
      const doctorId = itemDoctorByReceipt.get(receipt.id) || receipt.doctor_id;
      if (!doctorId) continue;
      const doctor = doctors.find((row) => row.id === doctorId);
      const current = doctorMap.get(doctorId) || {
        doctorId,
        doctorName: doctor?.name || "Unknown Doctor",
        clinicId: doctor?.clinic_id || null,
        receiptIds: new Set<string>(),
        patientIds: new Set<string>(),
        netSales: 0,
      };
      current.receiptIds.add(receipt.id);
      if (receipt.patient_id) current.patientIds.add(receipt.patient_id);
      // Net sales for this receipt
      const receiptNetSales = (() => {
        const subtotal = receipt.subtotal == null ? null : asNumber(receipt.subtotal);
        const discount = asNumber(receipt.discount_amount);
        const vat = asNumber(receipt.vat);
        const totalBeforeFee = receipt.total_before_gateway_fee == null
          ? Math.max(0, asNumber(receipt.total) - asNumber(receipt.gateway_fee))
          : asNumber(receipt.total_before_gateway_fee);
        return subtotal != null ? Math.max(0, subtotal - discount) : Math.max(0, totalBeforeFee - vat);
      })();
      current.netSales += receiptNetSales;
      doctorMap.set(doctorId, current);
    }
    if (!doctorPerformanceWarning) {
      doctorPerformance = [...doctorMap.values()].map((row) => ({
        doctorId: row.doctorId,
        doctorName: row.doctorName,
        clinicName: clinics.find((clinic) => clinic.id === row.clinicId)?.name || "Unassigned",
        uniquePatients: row.patientIds.size,
        completedVisits: row.receiptIds.size,
        netSales: row.netSales,
        averageNetSalesPerPatient: row.patientIds.size > 0 ? row.netSales / row.patientIds.size : 0,
      })).sort((left, right) => right.netSales - left.netSales);
    }
  }

  // Monthly trends.
  const monthlyTrend = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1;
    const monthStart = new Date(`${selectedYear}-${String(monthNumber).padStart(2, "0")}-01T00:00:00+04:00`);
    const nextMonth = new Date(`${selectedYear}-${String(monthNumber + 1).padStart(2, "0")}-01T00:00:00+04:00`);
    const monthKeyValue = `${selectedYear}-${String(monthNumber).padStart(2, "0")}`;
    const monthReceipts = yearlyReceipts.filter((row) => row.created_at >= monthStart.toISOString() && row.created_at < nextMonth.toISOString());
    const previousMonthReceipts = previousYearReceipts.filter((row) => {
      const date = new Date(row.created_at);
      return date.getUTCMonth() + 1 === monthNumber;
    });
    const monthBalancePayments = yearlyBalancePayments.filter((row) => row.created_at && row.created_at >= monthStart.toISOString() && row.created_at < nextMonth.toISOString());
    const monthDeposits = yearlyDeposits.filter((row) => row.created_at && row.created_at >= monthStart.toISOString() && row.created_at < nextMonth.toISOString());
    const monthTreatmentPlanPayments = yearlyTreatmentPlanPayments.filter((row) => row.created_at && row.created_at >= monthStart.toISOString() && row.created_at < nextMonth.toISOString());
    const previousYearBalancePayments = previousYearBalancePaymentRows.filter((row) => row.created_at && new Date(row.created_at).getUTCMonth() + 1 === monthNumber);
    const previousYearDeposits = previousYearDepositRows.filter((row) => row.created_at && new Date(row.created_at).getUTCMonth() + 1 === monthNumber);
    const previousYearTreatmentPlanPayments = previousYearTreatmentPlanPaymentRows.filter((row) => row.created_at && new Date(row.created_at).getUTCMonth() + 1 === monthNumber);
    const netSales = sumReceiptCollectionAmount(monthReceipts)
      + sumAmountRows(monthBalancePayments)
      + sumAmountRows(monthDeposits)
      + sumAmountRows(monthTreatmentPlanPayments);
    const previousYearSales = sumReceiptCollectionAmount(previousMonthReceipts)
      + sumAmountRows(previousYearBalancePayments)
      + sumAmountRows(previousYearDeposits)
      + sumAmountRows(previousYearTreatmentPlanPayments);
    const targetForMonth = clinicIds.reduce((sum, id) => sum + (targetsByClinicMonth.get(`${id}:${monthKeyValue}`) || 0), 0);
    return {
      month: new Date(`${selectedYear}-${String(monthNumber).padStart(2, "0")}-01`).toLocaleDateString("en-US", { month: "short" }),
      netSales,
      target: targetForMonth > 0 ? targetForMonth : null,
      previousYear: previousYearSales > 0 ? previousYearSales : null,
      belowTarget: targetForMonth > 0 ? netSales < targetForMonth : null,
    };
  });

  // Patient demand patterns (completed visits only).
  const historyDays = Math.floor((new Date(historyRange.endIso).getTime() - new Date(historyRange.startIso).getTime()) / (24 * 60 * 60 * 1000));
  const dayOfWeekBuckets = Array.from({ length: 7 }, (_, weekday) => ({ weekday, visits: 0, averagePerOpenDay: null as number | null }));
  const dayOfMonthBuckets = [
    { label: "Days 1-7", visits: 0 },
    { label: "Days 8-14", visits: 0 },
    { label: "Days 15-21", visits: 0 },
    { label: "Days 22-end", visits: 0 },
  ];
  for (const receipt of historyReceipts) {
    const day = dubaiDateOnly(new Date(receipt.created_at));
    const weekday = weekdayDubai(day);
    dayOfWeekBuckets[weekday].visits += 1;
    const dayNumber = parseYmd(day).d;
    if (dayNumber <= 7) dayOfMonthBuckets[0].visits += 1;
    else if (dayNumber <= 14) dayOfMonthBuckets[1].visits += 1;
    else if (dayNumber <= 21) dayOfMonthBuckets[2].visits += 1;
    else dayOfMonthBuckets[3].visits += 1;
  }

  const weeklyOpenCounts = new Map<number, number>();
  if (targetDataAvailable) {
    const days = eachDubaiDay(historyRange.startIso, historyRange.endIso);
    for (const day of days) {
      for (const id of clinicIds) {
        const open = isClinicOpenOnDay(id, day, scheduleByClinic, eventRows);
        if (open === true) {
          const weekday = weekdayDubai(day);
          weeklyOpenCounts.set(weekday, (weeklyOpenCounts.get(weekday) || 0) + 1);
        }
      }
    }
    dayOfWeekBuckets.forEach((bucket) => {
      const openDays = weeklyOpenCounts.get(bucket.weekday) || 0;
      bucket.averagePerOpenDay = openDays > 0 ? bucket.visits / openDays : null;
    });
  }

  let demandMessage = "";
  if (historyDays < 90) demandMessage = "Not enough history (minimum 90 days required).";
  else if (historyDays < 180) demandMessage = "Limited-data notice: trends are directional only.";
  else demandMessage = "Pattern highlights based on completed visits only; correlation does not imply causation.";

  // Payments section from allocation model where available.
  let paymentRows: PaymentRecordRow[] = [];
  let allocationRows: PaymentAllocationRow[] = [];
  let allocationRefundRows: PaymentAllocationRefundRow[] = [];
  let missingAllocationCoverage = false;
  try {
    let paymentRecordsQuery = supabase
      .from("payment_records")
      .select("id, clinic_id, receipt_id, receptionist_id, total_payment_fee_amount, total_customer_charged_amount, status, created_at")
      .gte("created_at", currentRange.startUtcIso)
      .lt("created_at", currentRange.endUtcIso);
    if (clinicId) paymentRecordsQuery = paymentRecordsQuery.eq("clinic_id", clinicId);
    const recordsRes = await paymentRecordsQuery;
    if (recordsRes.error) throw recordsRes.error;
    paymentRows = (recordsRes.data || []) as PaymentRecordRow[];
    const paymentIds = paymentRows.map((row) => row.id);
    if (paymentIds.length > 0) {
      const [allocRes, refundRes] = await Promise.all([
        supabase
          .from("payment_allocations")
          .select("id, payment_id, method_group, method_variant, treatment_net_amount, fee_amount, refunded_treatment_amount, refunded_fee_amount, customer_charged_amount")
          .in("payment_id", paymentIds),
        supabase
          .from("payment_allocation_refunds")
          .select("payment_id, payment_allocation_id, refunded_treatment_amount, total_returned_amount, reversed_fee_amount, created_at")
          .in("payment_id", paymentIds),
      ]);
      if (allocRes.error) throw allocRes.error;
      if (refundRes.error) throw refundRes.error;
      allocationRows = (allocRes.data || []) as PaymentAllocationRow[];
      allocationRefundRows = (refundRes.data || []) as PaymentAllocationRefundRow[];
    }
    const methodMap = new Map<string, { method: string; amount: number; count: number }>();
    for (const allocation of allocationRows) {
      const method = normalizeMethodGroup(allocation.method_group);
      if (method === "unknown") continue;
      const treatmentNet = Math.max(0, asNumber(allocation.treatment_net_amount) - asNumber(allocation.refunded_treatment_amount));
      const current = methodMap.get(method) || { method, amount: 0, count: 0 };
      current.amount += treatmentNet;
      current.count += 1;
      methodMap.set(method, current);
    }
    const paymentMethods = ["cash", "card", "tabby", "tamara"].map((method) => methodMap.get(method) || { method, amount: 0, count: 0 });

    const paymentFeesCollected = allocationRows.reduce((sum, row) => sum + Math.max(0, asNumber(row.fee_amount) - asNumber(row.refunded_fee_amount)), 0);
    const customerCollections = paymentRows.reduce((sum, row) => sum + asNumber(row.total_customer_charged_amount), 0);
    const customerRefunds = allocationRefundRows.reduce((sum, row) => sum + asNumber(row.total_returned_amount), 0);
    let currentCashDeductionRows: CashDeductionRow[] = [];
    let compareCashDeductionRows: CashDeductionRow[] = [];
    try {
      const [currentDeductionsRes, compareDeductionsRes] = await Promise.all([
        supabase
          .from("cash_deductions")
          .select("id, clinic_id, register_session_id, business_date, type, paid_to_name, description, reference_number, amount, status, created_at, created_by, voided_at, voided_by, void_reason")
          .in("clinic_id", clinicIds)
          .gte("business_date", currentRangeStartDubai)
          .lte("business_date", currentRangeEndDubai)
          .order("created_at", { ascending: false }),
        supabase
          .from("cash_deductions")
          .select("id, clinic_id, register_session_id, business_date, type, paid_to_name, description, reference_number, amount, status, created_at, created_by, voided_at, voided_by, void_reason")
          .in("clinic_id", clinicIds)
          .gte("business_date", compareRangeStartDubai)
          .lte("business_date", compareRangeEndDubai)
          .order("created_at", { ascending: false }),
      ]);
      if (!currentDeductionsRes.error) currentCashDeductionRows = (currentDeductionsRes.data || []) as CashDeductionRow[];
      if (!compareDeductionsRes.error) compareCashDeductionRows = (compareDeductionsRes.data || []) as CashDeductionRow[];
    } catch (error) {
      if (!isTableMissing(error)) throw error;
    }

    const currentActiveCashDeductions = currentCashDeductionRows.filter((row) => row.status === "active");
    const compareActiveCashDeductions = compareCashDeductionRows.filter((row) => row.status === "active");
    const commissionsPaid = currentActiveCashDeductions
      .filter((row) => row.type === "commission")
      .reduce((sum, row) => sum + asNumber(row.amount), 0);
    const expensesPaid = currentActiveCashDeductions
      .filter((row) => row.type === "expense")
      .reduce((sum, row) => sum + asNumber(row.amount), 0);
    const totalCashDeductions = commissionsPaid + expensesPaid;
    const compareTotalCashDeductions = compareActiveCashDeductions.reduce((sum, row) => sum + asNumber(row.amount), 0);

    const receiptIdsWithStructuredPayments = new Set(
      paymentRows.map((row) => String(row.receipt_id || "")).filter(Boolean)
    );
    const structuredCashCollections = allocationRows.reduce((sum, row) => {
      if (normalizeMethodGroup(row.method_group) !== "cash") return sum;
      return sum + asNumber(row.customer_charged_amount);
    }, 0);
    const fallbackReceiptCashCollections = currentReceipts.reduce((sum, receipt) => {
      if (receiptIdsWithStructuredPayments.has(receipt.id)) return sum;
      return sum + extractLegacyCashAmount(String(receipt.payment_method || ""), asNumber(receipt.amount_paid == null ? receipt.total : receipt.amount_paid));
    }, 0);
    const balanceCashCollections = currentBalancePayments.reduce((sum, row) => {
      return sum + extractLegacyCashAmount(String(row.payment_method || ""), asNumber(row.amount));
    }, 0);
    const depositCashCollections = currentDeposits.reduce((sum, row) => {
      return sum + extractLegacyCashAmount(String(row.payment_method || ""), asNumber(row.amount));
    }, 0);
    const treatmentPlanCashCollections = currentTreatmentPlanPayments.reduce((sum, row) => {
      return sum + extractLegacyCashAmount(String(row.payment_method || ""), asNumber(row.amount));
    }, 0);
    const cashCollected = structuredCashCollections + fallbackReceiptCashCollections + balanceCashCollections + depositCashCollections + treatmentPlanCashCollections;
    const cashAfterDeductions = cashCollected - totalCashDeductions;

    const detailReceptionistIds = new Set<string>(
      currentCashDeductionRows
        .flatMap((row) => [String(row.created_by || ""), String(row.voided_by || "")])
        .filter(Boolean)
    );
    const detailRegisterSessionIds = new Set<string>(currentCashDeductionRows.map((row) => String(row.register_session_id || "")).filter(Boolean));
    const [detailReceptionistsRes, detailRegisterSessionsRes] = await Promise.all([
      detailReceptionistIds.size > 0
        ? supabase.from("receptionist").select("id, name").in("id", [...detailReceptionistIds])
        : Promise.resolve({ data: [], error: null }),
      detailRegisterSessionIds.size > 0
        ? supabase.from("cash_register_sessions").select("id, receptionist_id, opened_at, closed_at").in("id", [...detailRegisterSessionIds])
        : Promise.resolve({ data: [], error: null }),
    ]);
    const detailReceptionistMap = new Map<string, string>();
    if (!detailReceptionistsRes.error) {
      ((detailReceptionistsRes.data || []) as Array<{ id: string; name: string | null }>).forEach((row) => {
        detailReceptionistMap.set(String(row.id), String(row.name || ""));
      });
    }
    const registerSessionMap = new Map<string, CashRegisterSessionRow>();
    if (!detailRegisterSessionsRes.error) {
      ((detailRegisterSessionsRes.data || []) as CashRegisterSessionRow[]).forEach((row) => {
        registerSessionMap.set(String(row.id), row);
      });
    }

    const cashDeductionDetails = currentCashDeductionRows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      clinicId: row.clinic_id,
      clinicName: clinics.find((clinic) => clinic.id === row.clinic_id)?.name || "Unknown Clinic",
      registerSessionId: row.register_session_id,
      receptionistName: detailReceptionistMap.get(String(row.created_by || "")) || detailReceptionistMap.get(String(registerSessionMap.get(String(row.register_session_id || ""))?.receptionist_id || "")) || "Reception",
      paidToName: row.paid_to_name,
      description: row.description,
      referenceNumber: row.reference_number,
      amount: asNumber(row.amount),
      type: row.type,
      status: row.status,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
      voidedByName: detailReceptionistMap.get(String(row.voided_by || "")) || null,
    }));
    const providerDeductionsAvailable = false;
    const providerDeductions = null;

    const overviewTargetExpected = clinicPerformance.reduce((sum, row) => sum + (row.expectedTarget || 0), 0);
    const overviewTargetAttainment = overviewTargetExpected > 0 ? (currentNetSales / overviewTargetExpected) * 100 : null;

    const attentionItems: string[] = [];
    for (const clinicMetric of clinicPerformance) {
      if (clinicMetric.expectedTarget == null) {
        attentionItems.push(`${clinicMetric.clinicName}: Missing monthly target.`);
      } else if (period !== "today" && (clinicMetric.targetAttainment || 0) < 80) {
        attentionItems.push(`${clinicMetric.clinicName}: Target attainment below 80%.`);
      }
      // Only alert on decline for multi-day periods. For "today" the day is partial so
      // a mid-day comparison to a complete prior day will almost always show decline.
      const isMultiDayPeriod = period !== "today";
      // Also suppress when the clinic had near-zero activity in both periods (noise).
      const hasSubstantialActivity = (clinicMetric.netSales || 0) > 50 || (compareNetSales || 0) > 50;
      if (isMultiDayPeriod && hasSubstantialActivity && (clinicMetric.previousPeriodChangePercent || 0) <= -20) {
        attentionItems.push(`${clinicMetric.clinicName}: Significant decline vs comparison period.`);
      }
    }
    const refundRate = currentNetSales > 0 ? (currentRefundTreatment / currentNetSales) * 100 : 0;
    if (refundRate > 10) {
      attentionItems.push("Refund treatment value is unusually high (>10% of net sales).");
    }
    if (currentOutstanding > compareOutstanding * 1.15 && compareOutstanding > 0) {
      attentionItems.push("Outstanding balance increased significantly from the comparison period.");
    }
    if (currentReceipts.length === 0) {
      attentionItems.push("No completed visits recorded in the selected period.");
    }
    if (doctorPerformanceWarning) {
      attentionItems.push(doctorPerformanceWarning);
    }

    const paymentRecordIds = new Set(paymentRows.map((row) => row.id));
    // no receipt_id selected from payment records on purpose to keep payload compact.
    if (currentReceipts.length > 0 && paymentRecordIds.size === 0) missingAllocationCoverage = true;

    return Response.json({
      meta: {
        currentRange,
        compareRange,
        timezone: "Asia/Dubai",
        lastUpdatedAt: new Date().toISOString(),
        clinicId,
        selectedYear,
      },
      overview: {
        netSales: currentNetSales,
        netSalesCompare: compareNetSales,
        netCollectionsAfterDeductions: currentCollections - totalCashDeductions,
        netCollectionsAfterDeductionsCompare: compareCollections - compareTotalCashDeductions,
        targetProgress: overviewTargetAttainment,
        customerCollections: currentCollections,
        customerCollectionsCompare: compareCollections,
        outstandingBalance: currentOutstanding,
        outstandingBalanceCompare: compareOutstanding,
        uniquePatientsSeen: currentUniquePatients,
        uniquePatientsSeenCompare: compareUniquePatients,
        completedVisits: currentCompletedVisits,
        newPatients,
        returningPatients,
        refundsTreatmentValue: currentRefundTreatment,
        comparisonRefundsTreatmentValue: compareRefundTreatment,
        missingData: {
          cancelledStatusNotRecorded: true,
          providerDeductionsNotRecorded: true,
          paymentAllocationCoverageIncomplete: missingAllocationCoverage,
          targetConfigurationAvailable: targetDataAvailable,
        },
      },
      clinicPerformance,
      doctorPerformance,
      trends: {
        monthly: monthlyTrend,
        patientDemand: {
          historyDays,
          message: demandMessage,
          dayOfWeek: dayOfWeekBuckets.map((bucket) => ({
            weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][bucket.weekday],
            visits: bucket.visits,
            averagePerOpenDay: bucket.averagePerOpenDay,
          })),
          dayOfMonthBuckets,
          eventsInRange: eventRows.filter((row) => {
            const rangeStart = dubaiDateOnly(new Date(historyRange.startIso));
            const rangeEnd = addDays(dubaiDateOnly(new Date(historyRange.endIso)), -1);
            return row.start_date <= rangeEnd && row.end_date >= rangeStart;
          }).map((row) => ({
            eventType: row.event_type,
            startDate: row.start_date,
            endDate: row.end_date,
            clinicId: row.clinic_id,
          })),
        },
      },
      payments: {
        methods: paymentMethods,
        paymentMethodUses: paymentMethods.reduce((sum, row) => sum + row.count, 0),
        paymentFeesCollected,
        customerCollections,
        customerRefunds,
        providerDeductionsAvailable,
        providerDeductions,
        netSettlement: null,
        missingAllocationCoverage,
      },
      cashManagement: {
        cashCollected,
        commissionsPaid,
        expensesPaid,
        totalCashDeductions,
        cashAfterDeductions,
        details: cashDeductionDetails,
      },
      attentionItems,
    });
  } catch (error) {
    if (isTableMissing(error)) {
      return Response.json({ error: "Required dashboard tables are not available yet. Run migrations first." }, { status: 412 });
    }
    console.error("CEO dashboard aggregation error", error);
    return Response.json({ error: "Failed to compute CEO dashboard metrics." }, { status: 500 });
  }
}
