import type { TreatmentPlan, TreatmentPlanPaymentRecord } from "./types";

type RollupDateInput = string | Date | null | undefined;

type StructuredPaymentLike = {
  id: string;
  treatment_plan_id: string;
  total_invoice_amount_settled: number | null;
  status?: TreatmentPlanPaymentRecord["status"] | string | null;
  legacy_treatment_plan_payment_id?: string | null;
  created_at?: string | null;
};

type LegacyPaymentLike = {
  id: string;
  treatment_plan_id: string;
  amount: number | null;
  created_at?: string | null;
  status?: string | null;
  source_payment_record_id?: string | null;
  notes?: string | null;
};

export type TreatmentPlanPaidComponents = {
  historicalPaid: number;
  structuredPaid: number;
  legacyFallbackPaid: number;
  posPaidToDate: number;
  totalPaidToDate: number;
};

export type TreatmentPlanRollup = TreatmentPlanPaidComponents & {
  remainingBalance: number;
};

const STRUCTURED_COUNTABLE_STATUSES = new Set(["completed", "partially_refunded", "refunded"]);
const LEGACY_EXCLUDED_STATUSES = new Set(["cancelled", "canceled", "voided", "invalid"]);

function asNumber(value: unknown): number {
  return Number(value || 0);
}

function asTimestamp(value: RollupDateInput): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function shouldIncludeAt(createdAt: RollupDateInput, asOfTimestamp: number | null): boolean {
  if (asOfTimestamp == null) return true;
  const createdAtTimestamp = asTimestamp(createdAt);
  if (createdAtTimestamp == null) return true;
  return createdAtTimestamp <= asOfTimestamp;
}

function isStructuredCountableStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  return STRUCTURED_COUNTABLE_STATUSES.has(status.toLowerCase());
}

function isLegacyCountableStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  return !LEGACY_EXCLUDED_STATUSES.has(status.toLowerCase());
}

function looksLikeStructuredMirrorNote(notes: string | null | undefined): boolean {
  const value = String(notes || "");
  if (!value) return false;
  return value.includes("Invoice settled AED")
    && value.includes("Fee AED")
    && value.includes("Customer charged AED");
}

export function computeTreatmentPlanPaidComponents(
  plan: Pick<TreatmentPlan, "id" | "total_amount" | "is_legacy" | "historical_amount_paid">,
  options?: {
    structuredPayments?: StructuredPaymentLike[];
    legacyPayments?: LegacyPaymentLike[];
    asOf?: RollupDateInput;
  }
): TreatmentPlanPaidComponents {
  const structuredPayments = options?.structuredPayments || [];
  const legacyPayments = options?.legacyPayments || [];
  const asOfTimestamp = asTimestamp(options?.asOf);

  const linkedLegacyPaymentIds = new Set<string>();
  let structuredPaid = 0;

  for (const payment of structuredPayments) {
    if (payment.treatment_plan_id !== plan.id) continue;
    if (!shouldIncludeAt(payment.created_at, asOfTimestamp)) continue;
    if (payment.legacy_treatment_plan_payment_id) {
      linkedLegacyPaymentIds.add(String(payment.legacy_treatment_plan_payment_id));
    }
    if (!isStructuredCountableStatus(payment.status)) continue;
    structuredPaid += asNumber(payment.total_invoice_amount_settled);
  }

  let legacyFallbackPaid = 0;
  for (const payment of legacyPayments) {
    if (payment.treatment_plan_id !== plan.id) continue;
    if (!shouldIncludeAt(payment.created_at, asOfTimestamp)) continue;
    if (!isLegacyCountableStatus(payment.status)) continue;
    if (payment.source_payment_record_id) continue;
    if (looksLikeStructuredMirrorNote(payment.notes)) continue;
    if (payment.id && linkedLegacyPaymentIds.has(String(payment.id))) continue;
    legacyFallbackPaid += asNumber(payment.amount);
  }

  const historicalPaid = plan.is_legacy ? Math.max(0, asNumber(plan.historical_amount_paid)) : 0;
  const posPaidToDate = structuredPaid + legacyFallbackPaid;
  const totalPaidToDate = historicalPaid + posPaidToDate;

  return {
    historicalPaid,
    structuredPaid,
    legacyFallbackPaid,
    posPaidToDate,
    totalPaidToDate,
  };
}

export function computeTreatmentPlanRollup(
  plan: Pick<TreatmentPlan, "id" | "total_amount" | "is_legacy" | "historical_amount_paid">,
  options?: {
    structuredPayments?: StructuredPaymentLike[];
    legacyPayments?: LegacyPaymentLike[];
    asOf?: RollupDateInput;
  }
): TreatmentPlanRollup {
  const paid = computeTreatmentPlanPaidComponents(plan, options);
  const remainingBalance = Math.max(0, asNumber(plan.total_amount) - paid.totalPaidToDate);
  return {
    ...paid,
    remainingBalance,
  };
}
