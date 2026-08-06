import { type SupabaseClient } from "@supabase/supabase-js";
import { extractLegacyCashAmount, getDubaiBusinessDate } from "../../../lib/cash-deductions";
import { roundCurrency } from "../../../lib/money";

export type RegisterSessionContext = {
  id: string;
  receptionistId: string;
  clinicId: string;
  openedAt: string;
  closedAt: string | null;
};

type RegisterSessionRow = {
  id: string;
  receptionist_id: string;
  opened_at: string;
  closed_at: string | null;
};

type ReceptionistRow = {
  id: string;
  clinic_id: string | null;
  name: string | null;
};

type ReceiptRow = {
  id: string;
  total: number | null;
  amount_paid: number | null;
  payment_method: string | null;
  transaction_type?: string | null;
};

type PaymentRecordRow = {
  id: string;
  receipt_id: string | null;
};

type PaymentAllocationRow = {
  payment_id: string;
  method_group: string;
  customer_charged_amount: number | null;
};

type TreatmentPlanPaymentRecordRow = {
  id: string;
  legacy_treatment_plan_payment_id: string | null;
};

type TreatmentPlanPaymentAllocationRow = {
  payment_id: string;
  method_group: string;
  customer_charged_amount: number | null;
};

type TreatmentPlanPaymentRow = {
  id: string;
  amount: number | null;
  payment_method: string | null;
};

type SimpleAmountRow = {
  amount: number | null;
};

type CashDeductionRow = {
  id: string;
  clinic_id: string;
  register_session_id: string;
  business_date: string;
  type: "expense" | "commission";
  staff_id: string | null;
  paid_to_name: string;
  description: string;
  reference_number: string | null;
  amount: number;
  status: "active" | "voided";
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

type DoctorRow = {
  id: string;
  name: string | null;
};

export type CashDeductionListItem = CashDeductionRow & {
  staff_name: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  voided_by_name: string | null;
};

export type CashDeductionSummary = {
  businessDate: string;
  registerStatus: "open" | "closed";
  cashCollected: number;
  activeDeductionsTotal: number;
  availableCash: number;
  totalCommissions: number;
  totalExpenses: number;
};

export async function loadRegisterSessionContext(
  supabase: SupabaseClient,
  registerSessionId: string
): Promise<RegisterSessionContext | null> {
  const { data: sessionData, error: sessionError } = await supabase
    .from("cash_register_sessions")
    .select("id, receptionist_id, opened_at, closed_at")
    .eq("id", registerSessionId)
    .maybeSingle();
  if (sessionError || !sessionData) return null;

  const sessionRow = sessionData as RegisterSessionRow;
  const { data: receptionistData, error: receptionistError } = await supabase
    .from("receptionist")
    .select("id, clinic_id, name")
    .eq("id", sessionRow.receptionist_id)
    .maybeSingle();
  if (receptionistError || !receptionistData || !receptionistData.clinic_id) return null;

  const receptionist = receptionistData as ReceptionistRow;
  return {
    id: String(sessionRow.id),
    receptionistId: String(sessionRow.receptionist_id),
    clinicId: String(receptionist.clinic_id),
    openedAt: String(sessionRow.opened_at),
    closedAt: sessionRow.closed_at ? String(sessionRow.closed_at) : null,
  };
}

function sumCashAllocations(
  paymentIds: string[],
  allocations: Array<{ payment_id: string; method_group: string; customer_charged_amount: number | null }>
): number {
  const allowedIds = new Set(paymentIds);
  return roundCurrency(
    allocations.reduce((sum, row) => {
      if (!allowedIds.has(String(row.payment_id || ""))) return sum;
      if (String(row.method_group || "").toLowerCase() !== "cash") return sum;
      return sum + Number(row.customer_charged_amount || 0);
    }, 0)
  );
}

export async function computeRegisterSessionCashCollected(
  supabase: SupabaseClient,
  context: RegisterSessionContext
): Promise<number> {
  const rangeEnd = context.closedAt || new Date().toISOString();

  const [receiptsRes, paymentRecordsRes, balancePaymentsRes, depositsRes, treatmentPlanRecordRes, treatmentPlanLegacyRes] = await Promise.all([
    supabase
      .from("receipts")
      .select("id, total, amount_paid, payment_method, transaction_type")
      .eq("receptionist_id", context.receptionistId)
      .gte("created_at", context.openedAt)
      .lte("created_at", rangeEnd),
    supabase
      .from("payment_records")
      .select("id, receipt_id")
      .eq("receptionist_id", context.receptionistId)
      .eq("clinic_id", context.clinicId)
      .gte("created_at", context.openedAt)
      .lte("created_at", rangeEnd),
    supabase
      .from("balance_payments")
      .select("amount")
      .eq("register_session_id", context.id)
      .ilike("payment_method", "Cash%"),
    supabase
      .from("patient_credits")
      .select("amount")
      .eq("register_session_id", context.id)
      .gt("amount", 0)
      .ilike("payment_method", "Cash%"),
    supabase
      .from("treatment_plan_payment_records")
      .select("id, legacy_treatment_plan_payment_id")
      .eq("register_session_id", context.id),
    supabase
      .from("treatment_plan_payments")
      .select("id, amount, payment_method")
      .eq("register_session_id", context.id),
  ]);

  const receipts = !receiptsRes.error ? ((receiptsRes.data || []) as ReceiptRow[]).filter((row) => String(row.transaction_type || "regular") !== "plan_summary") : [];
  const paymentRecords = !paymentRecordsRes.error ? (paymentRecordsRes.data || []) as PaymentRecordRow[] : [];
  const balancePayments = !balancePaymentsRes.error ? (balancePaymentsRes.data || []) as SimpleAmountRow[] : [];
  const deposits = !depositsRes.error ? (depositsRes.data || []) as SimpleAmountRow[] : [];
  const treatmentPlanRecords = !treatmentPlanRecordRes.error ? (treatmentPlanRecordRes.data || []) as TreatmentPlanPaymentRecordRow[] : [];
  const treatmentPlanLegacyPayments = !treatmentPlanLegacyRes.error ? (treatmentPlanLegacyRes.data || []) as TreatmentPlanPaymentRow[] : [];

  const paymentRecordIds = paymentRecords.map((row) => String(row.id || "")).filter(Boolean);
  const treatmentPlanRecordIds = treatmentPlanRecords.map((row) => String(row.id || "")).filter(Boolean);

  const [receiptAllocationsRes, treatmentPlanAllocationsRes] = await Promise.all([
    paymentRecordIds.length > 0
      ? supabase
          .from("payment_allocations")
          .select("payment_id, method_group, customer_charged_amount")
          .in("payment_id", paymentRecordIds)
      : Promise.resolve({ data: [], error: null }),
    treatmentPlanRecordIds.length > 0
      ? supabase
          .from("treatment_plan_payment_allocations")
          .select("payment_id, method_group, customer_charged_amount")
          .in("payment_id", treatmentPlanRecordIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const receiptAllocations = !receiptAllocationsRes.error ? (receiptAllocationsRes.data || []) as PaymentAllocationRow[] : [];
  const treatmentPlanAllocations = !treatmentPlanAllocationsRes.error ? (treatmentPlanAllocationsRes.data || []) as TreatmentPlanPaymentAllocationRow[] : [];

  const receiptIdsWithStructuredPayments = new Set(
    paymentRecords.map((row) => String(row.receipt_id || "")).filter(Boolean)
  );

  const structuredReceiptCash = sumCashAllocations(paymentRecordIds, receiptAllocations);
  const legacyReceiptCash = roundCurrency(
    receipts.reduce((sum, receipt) => {
      if (receiptIdsWithStructuredPayments.has(String(receipt.id || ""))) return sum;
      const totalAmount = Number(receipt.amount_paid ?? receipt.total ?? 0);
      return sum + extractLegacyCashAmount(String(receipt.payment_method || ""), totalAmount);
    }, 0)
  );

  const structuredTreatmentPlanCash = sumCashAllocations(treatmentPlanRecordIds, treatmentPlanAllocations);
  const linkedLegacyIds = new Set(
    treatmentPlanRecords.map((row) => String(row.legacy_treatment_plan_payment_id || "")).filter(Boolean)
  );
  const legacyTreatmentPlanCash = roundCurrency(
    treatmentPlanLegacyPayments.reduce((sum, payment) => {
      if (linkedLegacyIds.has(String(payment.id || ""))) return sum;
      return sum + extractLegacyCashAmount(String(payment.payment_method || ""), Number(payment.amount || 0));
    }, 0)
  );

  const balanceCash = roundCurrency(balancePayments.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const depositCash = roundCurrency(deposits.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  return roundCurrency(
    structuredReceiptCash + legacyReceiptCash + structuredTreatmentPlanCash + legacyTreatmentPlanCash + balanceCash + depositCash
  );
}

export async function listCashDeductions(
  supabase: SupabaseClient,
  registerSessionId: string
): Promise<CashDeductionListItem[]> {
  const { data, error } = await supabase
    .from("cash_deductions")
    .select("*")
    .eq("register_session_id", registerSessionId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message || "Failed loading cash deductions.");

  const rows = (data || []) as CashDeductionRow[];
  const staffIds = [...new Set(rows.map((row) => String(row.staff_id || "")).filter(Boolean))];
  const receptionistIds = [...new Set(
    rows.flatMap((row) => [row.created_by, row.updated_by, row.voided_by].map((value) => String(value || "")).filter(Boolean))
  )];

  const [staffRes, receptionistsRes] = await Promise.all([
    staffIds.length > 0
      ? supabase.from("doctors").select("id, name").in("id", staffIds)
      : Promise.resolve({ data: [], error: null }),
    receptionistIds.length > 0
      ? supabase.from("receptionist").select("id, name").in("id", receptionistIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const staffMap = new Map<string, string>();
  if (!staffRes.error) {
    ((staffRes.data || []) as DoctorRow[]).forEach((row) => {
      staffMap.set(String(row.id), String(row.name || ""));
    });
  }

  const receptionistMap = new Map<string, string>();
  if (!receptionistsRes.error) {
    ((receptionistsRes.data || []) as ReceptionistRow[]).forEach((row) => {
      receptionistMap.set(String(row.id), String(row.name || ""));
    });
  }

  return rows.map((row) => ({
    ...row,
    amount: roundCurrency(Number(row.amount || 0)),
    staff_name: row.staff_id ? (staffMap.get(String(row.staff_id)) || row.paid_to_name || null) : null,
    created_by_name: row.created_by ? (receptionistMap.get(String(row.created_by)) || null) : null,
    updated_by_name: row.updated_by ? (receptionistMap.get(String(row.updated_by)) || null) : null,
    voided_by_name: row.voided_by ? (receptionistMap.get(String(row.voided_by)) || null) : null,
  }));
}

export function buildCashDeductionSummary(
  context: RegisterSessionContext,
  entries: CashDeductionListItem[],
  cashCollected: number
): CashDeductionSummary {
  const activeEntries = entries.filter((entry) => entry.status === "active");
  const totalCommissions = roundCurrency(
    activeEntries
      .filter((entry) => entry.type === "commission")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  );
  const totalExpenses = roundCurrency(
    activeEntries
      .filter((entry) => entry.type === "expense")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  );
  const activeDeductionsTotal = roundCurrency(totalCommissions + totalExpenses);
  const availableCash = roundCurrency(Math.max(0, cashCollected - activeDeductionsTotal));

  return {
    businessDate: getDubaiBusinessDate(context.openedAt),
    registerStatus: context.closedAt ? "closed" : "open",
    cashCollected: roundCurrency(cashCollected),
    activeDeductionsTotal,
    availableCash,
    totalCommissions,
    totalExpenses,
  };
}
