import type { SupabaseClient } from "@supabase/supabase-js";
import { fromMinorUnits, roundCurrency, toMinorUnits } from "./money";
import { paymentVariantLabel, type PaymentMethodVariant } from "./payment-allocation";
import type { PaymentAllocation } from "./types";

export type ReceiptRefundLike = {
  total_amount?: number | null;
};

// ─── Snapshot-backed item refund types ──────────────────────────────────────

/** Classification of a receipt's snapshot coverage for refund routing. */
export type ReceiptSnapshotStatus = "snapshot" | "legacy" | "mixed";

/**
 * Immutable historical values from receipt_items snapshot fields.
 * Derived entirely from saved receipt_items data — never from current services.
 */
export type ReceiptItemRefundSnapshot = {
  receiptItemId: string;
  serviceName: string;
  treatmentAmount: number;  // = taxable_amount
  vatAmount: number;        // = vat_amount
  invoiceAmount: number;    // = final_line_total
};

/** Remaining refundable amounts after subtracting all prior snapshot refund_items. */
export type ReceiptItemRemainingRefundable = {
  receiptItemId: string;
  remainingTreatment: number;
  remainingVat: number;
  remainingInvoice: number;
  isFullyRefunded: boolean;
};

// ─── Snapshot helpers ────────────────────────────────────────────────────────

/**
 * Classify whether a set of receipt_items rows for one receipt is snapshot-backed,
 * legacy, or mixed/incomplete.
 *
 * SNAPSHOT:  ALL items have taxable_amount, vat_amount, and final_line_total non-null.
 * LEGACY:    ALL items lack all three snapshot fields.
 * MIXED:     Any other combination — treated as data integrity error, refund blocked.
 */
export function classifyReceiptSnapshotStatus(
  items: Array<{ taxable_amount?: number | null; vat_amount?: number | null; final_line_total?: number | null }>
): ReceiptSnapshotStatus {
  if (items.length === 0) return "legacy";
  const snapshotCount = items.filter(
    (item) => item.taxable_amount != null && item.vat_amount != null && item.final_line_total != null
  ).length;
  if (snapshotCount === items.length) return "snapshot";
  if (snapshotCount === 0) return "legacy";
  return "mixed";
}

/**
 * Extract the immutable refund snapshot from a snapshot-backed receipt_items row.
 * Returns null if the item is not snapshot-backed (missing any required field).
 */
export function getReceiptItemRefundSnapshot(item: {
  id: string;
  service_name_snapshot?: string | null;
  service_id?: string | null;
  taxable_amount?: number | null;
  vat_amount?: number | null;
  final_line_total?: number | null;
}): ReceiptItemRefundSnapshot | null {
  if (item.taxable_amount == null || item.vat_amount == null || item.final_line_total == null) {
    return null;
  }
  return {
    receiptItemId: item.id,
    serviceName: String(item.service_name_snapshot || "Service"),
    treatmentAmount: roundCurrency(Number(item.taxable_amount)),
    vatAmount: roundCurrency(Number(item.vat_amount)),
    invoiceAmount: roundCurrency(Number(item.final_line_total)),
  };
}

/**
 * Compute the remaining refundable amounts for one snapshot-backed item,
 * subtracting all prior refund_items rows that have non-null refunded_invoice_amount.
 *
 * Uses minor-unit arithmetic throughout to avoid floating-point drift.
 * Clamps to [0, historical] on each component.
 * Throws if prior refund totals exceed the historical snapshot values —
 * this indicates corrupt data and must not be silently accepted.
 */
export function getReceiptItemRemainingRefundable(
  snapshot: ReceiptItemRefundSnapshot,
  priorRefundItems: Array<{
    receipt_item_id?: string | null;
    refunded_treatment_amount?: number | null;
    refunded_vat_amount?: number | null;
    refunded_invoice_amount?: number | null;
  }>
): ReceiptItemRemainingRefundable {
  // Sum only snapshot-backed prior refunds (refunded_invoice_amount non-null) for this item.
  const relevant = priorRefundItems.filter(
    (row) => row.receipt_item_id === snapshot.receiptItemId && row.refunded_invoice_amount != null
  );

  const priorTreatmentMinor = relevant.reduce(
    (sum, row) => sum + toMinorUnits(Number(row.refunded_treatment_amount ?? 0)),
    0
  );
  const priorVatMinor = relevant.reduce(
    (sum, row) => sum + toMinorUnits(Number(row.refunded_vat_amount ?? 0)),
    0
  );
  const priorInvoiceMinor = relevant.reduce(
    (sum, row) => sum + toMinorUnits(Number(row.refunded_invoice_amount ?? 0)),
    0
  );

  const historicalTreatmentMinor = toMinorUnits(snapshot.treatmentAmount);
  const historicalVatMinor = toMinorUnits(snapshot.vatAmount);
  const historicalInvoiceMinor = toMinorUnits(snapshot.invoiceAmount);

  // Corrupt-data guard: prior refunds must not exceed historical values.
  if (priorTreatmentMinor > historicalTreatmentMinor + 1) {
    throw new Error(
      `Corrupt refund data for item ${snapshot.receiptItemId}: prior refunded treatment ` +
      `${fromMinorUnits(priorTreatmentMinor).toFixed(2)} exceeds historical ` +
      `${snapshot.treatmentAmount.toFixed(2)}.`
    );
  }
  if (priorVatMinor > historicalVatMinor + 1) {
    throw new Error(
      `Corrupt refund data for item ${snapshot.receiptItemId}: prior refunded VAT ` +
      `${fromMinorUnits(priorVatMinor).toFixed(2)} exceeds historical ` +
      `${snapshot.vatAmount.toFixed(2)}.`
    );
  }
  if (priorInvoiceMinor > historicalInvoiceMinor + 1) {
    throw new Error(
      `Corrupt refund data for item ${snapshot.receiptItemId}: prior refunded invoice ` +
      `${fromMinorUnits(priorInvoiceMinor).toFixed(2)} exceeds historical ` +
      `${snapshot.invoiceAmount.toFixed(2)}.`
    );
  }

  const remainingTreatmentMinor = Math.max(0, historicalTreatmentMinor - priorTreatmentMinor);
  const remainingVatMinor = Math.max(0, historicalVatMinor - priorVatMinor);
  const remainingInvoiceMinor = Math.max(0, historicalInvoiceMinor - priorInvoiceMinor);

  return {
    receiptItemId: snapshot.receiptItemId,
    remainingTreatment: fromMinorUnits(remainingTreatmentMinor),
    remainingVat: fromMinorUnits(remainingVatMinor),
    remainingInvoice: fromMinorUnits(remainingInvoiceMinor),
    isFullyRefunded: remainingInvoiceMinor === 0,
  };
}

/**
 * Sum the remaining invoice amounts for a set of selected snapshot-backed items.
 * Use this as the refund target for snapshot receipts instead of
 * calculateReceiptItemsRefundTotal (which is kept for legacy receipts).
 */
export function calculateSnapshotItemsRefundTotal(
  remainingItems: ReceiptItemRemainingRefundable[]
): number {
  const totalMinor = remainingItems.reduce(
    (sum, item) => sum + toMinorUnits(item.remainingInvoice),
    0
  );
  return fromMinorUnits(totalMinor);
}

/**
 * Build refund_items insert rows for snapshot-backed items (full remaining refund per item).
 *
 * amount = refunded_treatment_amount  (preserves CEO dashboard compatibility —
 *   the dashboard sums amount as "treatment/service value").
 * All three new snapshot columns are also populated for per-item audit.
 */
export function buildSnapshotRefundItemRows(
  items: Array<{
    snapshot: ReceiptItemRefundSnapshot;
    remaining: ReceiptItemRemainingRefundable;
    serviceId?: string | null;
  }>
): RefundItemInsertRow[] {
  return items.map(({ snapshot, remaining, serviceId }) => ({
    receipt_item_id: snapshot.receiptItemId,
    service_id: serviceId ?? null,
    service_name: snapshot.serviceName,
    amount: roundCurrency(remaining.remainingTreatment),
    refunded_treatment_amount: roundCurrency(remaining.remainingTreatment),
    refunded_vat_amount: roundCurrency(remaining.remainingVat),
    refunded_invoice_amount: roundCurrency(remaining.remainingInvoice),
  }));
}

/**
 * [Future use — not exposed in Phase 4 UI]
 * For a partial invoice amount against one snapshot item, compute
 * the proportional treatment/VAT split using minor-unit arithmetic.
 * requestedInvoice must be <= remaining.remainingInvoice.
 */
export function splitSnapshotItemPartialRefund(
  remaining: ReceiptItemRemainingRefundable,
  requestedInvoice: number
): { refundedTreatment: number; refundedVat: number; refundedInvoice: number } {
  const requestedMinor = toMinorUnits(requestedInvoice);
  const remainingInvoiceMinor = toMinorUnits(remaining.remainingInvoice);
  const remainingTreatmentMinor = toMinorUnits(remaining.remainingTreatment);

  if (remainingInvoiceMinor <= 0 || requestedMinor <= 0) {
    return { refundedTreatment: 0, refundedVat: 0, refundedInvoice: 0 };
  }

  const clampedMinor = Math.min(requestedMinor, remainingInvoiceMinor);
  const treatmentMinor = Math.round((remainingTreatmentMinor * clampedMinor) / remainingInvoiceMinor);
  const vatMinor = clampedMinor - treatmentMinor;

  return {
    refundedTreatment: fromMinorUnits(treatmentMinor),
    refundedVat: fromMinorUnits(vatMinor),
    refundedInvoice: fromMinorUnits(clampedMinor),
  };
}

export type RefundableReceiptLike = {
  id: string;
  receipt_number?: number | null;
  receptionist_id: string;
  patient_id?: string | null;
  subtotal?: number | null;
  vat?: number | null;
  total?: number | null;
  amount_paid?: number | null;
  payment_method?: string | null;
  created_at?: string | null;
};

export type RefundableReceiptItemLike = {
  id: string;
  service_id?: string | null;
  total?: number | null;
  price?: number | null;
};

export type RefundItemInsertRow = {
  receipt_item_id: string | null;
  service_id: string | null;
  service_name: string;
  amount: number;
  // Populated for snapshot-backed refunds; NULL for legacy.
  refunded_treatment_amount?: number | null;
  refunded_vat_amount?: number | null;
  refunded_invoice_amount?: number | null;
};

export type AllocationRefundDraftRequest = {
  allocation: PaymentAllocation;
  requestedInvoiceAmount: number;
  refundedTreatmentAmount: number;
  refundedVatAmount: number;
};

export type AllocationRefundBreakdown = {
  id: string;
  allocationId: string;
  methodGroup: PaymentAllocation["method_group"];
  methodVariant: PaymentAllocation["method_variant"];
  methodLabel: string;
  refundedTreatmentAmount: number;
  refundedVatAmount: number;
  refundedInvoiceAmount: number;
  reversedFeeAmount: number;
  totalReturnedAmount: number;
  originalFeeAmount: number;
  nonRefundableFeeAmount: number;
  providerReference: string;
  terminalAuthorizationCode: string;
  originalCustomerChargedAmount: number;
  originalInvoiceAmount: number;
};

export type CreateAllocationRefundResult = {
  refundData: any;
  breakdown: AllocationRefundBreakdown[];
  warningMessage?: string;
};

export type RefundProcessingMode = "legacy" | "modern" | "admin_review";

export function resolveRefundProcessingMode(params: {
  paymentRecordCount: number;
  allocationCount: number;
}): RefundProcessingMode {
  if (params.paymentRecordCount <= 0) return "legacy";
  if (params.allocationCount > 0) return "modern";
  return "admin_review";
}

export function isNonRefundableSurchargeVariant(variant: string | null | undefined): boolean {
  return variant === "tabby_standard" || variant === "tabby_card" || variant === "tamara";
}

export function getRefundableFeeAmount(
  allocation: Pick<PaymentAllocation, "method_variant" | "fee_rate">,
  refundedInvoiceAmount: number
): number {
  if (isNonRefundableSurchargeVariant(allocation.method_variant)) return 0;
  return roundCurrency(refundedInvoiceAmount * Number(allocation.fee_rate || 0));
}

export function getRemainingAllocationAmounts(
  allocation: Pick<PaymentAllocation, "treatment_net_amount" | "vat_amount" | "refunded_treatment_amount" | "refunded_vat_amount">
) {
  const treatment = roundCurrency(
    Math.max(0, Number(allocation.treatment_net_amount || 0) - Number(allocation.refunded_treatment_amount || 0))
  );
  const vat = roundCurrency(Math.max(0, Number(allocation.vat_amount || 0) - Number(allocation.refunded_vat_amount || 0)));
  return {
    treatment,
    vat,
    invoice: roundCurrency(treatment + vat),
  };
}

export function splitAllocationRefundAmounts(
  allocation: Pick<PaymentAllocation, "treatment_net_amount" | "vat_amount" | "refunded_treatment_amount" | "refunded_vat_amount">,
  requestedInvoiceAmount: number
) {
  const remaining = getRemainingAllocationAmounts(allocation);
  const requestedMinor = toMinorUnits(requestedInvoiceAmount);
  const remainingTreatmentMinor = toMinorUnits(remaining.treatment);
  const remainingVatMinor = toMinorUnits(remaining.vat);
  const remainingInvoiceMinor = remainingTreatmentMinor + remainingVatMinor;
  const refundedTreatmentMinor = remainingInvoiceMinor > 0
    ? Math.round((remainingTreatmentMinor * requestedMinor) / remainingInvoiceMinor)
    : 0;
  const refundedVatMinor = requestedMinor - refundedTreatmentMinor;
  return {
    refundedTreatmentAmount: fromMinorUnits(refundedTreatmentMinor),
    refundedVatAmount: fromMinorUnits(refundedVatMinor),
  };
}

export function calculateReceiptMaxRefundableAmount(
  receipt: Pick<RefundableReceiptLike, "amount_paid" | "total">,
  refunds: ReceiptRefundLike[]
): number {
  const paidAmount = Number(receipt.amount_paid ?? receipt.total ?? 0);
  const previouslyRefunded = refunds.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  return roundCurrency(Math.max(0, paidAmount - previouslyRefunded));
}

export function calculateAllocationMaxRefundableInvoiceAmount(
  allocations: Array<Pick<PaymentAllocation, "treatment_net_amount" | "vat_amount" | "refunded_treatment_amount" | "refunded_vat_amount">>
): number {
  return roundCurrency(
    allocations.reduce((sum, allocation) => sum + getRemainingAllocationAmounts(allocation).invoice, 0)
  );
}

export function calculateReceiptItemsRefundTotal(
  receipt: Pick<RefundableReceiptLike, "subtotal" | "vat">,
  itemsToRefund: RefundableReceiptItemLike[]
): number {
  const subtotal = Number(receipt.subtotal || 0);
  const vat = Number(receipt.vat || 0);
  const itemsSubtotal = itemsToRefund.reduce((sum, item) => sum + Number(item.total || item.price || 0), 0);
  const proportionalVat = subtotal > 0 ? (itemsSubtotal / subtotal) * vat : 0;
  return roundCurrency(itemsSubtotal + proportionalVat);
}

export function summarizeRefundMethodVariants(variants: Array<string | null | undefined>): string {
  const labels = [...new Set(
    variants
      .filter((variant): variant is PaymentMethodVariant => !!variant)
      .map((variant) => paymentVariantLabel(variant))
  )];
  return labels.join(" + ");
}

export function autoAllocateRefundAmounts(
  totalRefundAmount: number,
  allocations: PaymentAllocation[],
  selectedAllocationIds: string[]
): Record<string, string> {
  const selectedSet = new Set(selectedAllocationIds);
  let remainingMinor = toMinorUnits(totalRefundAmount);
  const nextInputs: Record<string, string> = {};

  allocations.forEach((allocation) => {
    if (!selectedSet.has(allocation.id)) return;
    const allocationRemainingMinor = toMinorUnits(getRemainingAllocationAmounts(allocation).invoice);
    const assignedMinor = Math.max(0, Math.min(allocationRemainingMinor, remainingMinor));
    nextInputs[allocation.id] = assignedMinor > 0 ? fromMinorUnits(assignedMinor).toFixed(2) : "";
    remainingMinor -= assignedMinor;
  });

  return nextInputs;
}

export function buildAllocationRefundRequests(params: {
  allocations: PaymentAllocation[];
  selectedAllocationIds: string[];
  requestedAmountsByAllocationId: Record<string, string>;
  expectedRefundAmount: number;
}): { requests: AllocationRefundDraftRequest[]; error?: string } {
  const { allocations, selectedAllocationIds, requestedAmountsByAllocationId, expectedRefundAmount } = params;
  const selectedSet = new Set(selectedAllocationIds);
  const requests: AllocationRefundDraftRequest[] = [];

  for (const allocation of allocations) {
    if (!selectedSet.has(allocation.id)) continue;
    const requestedRaw = String(requestedAmountsByAllocationId[allocation.id] || "").trim();
    const requestedInvoiceAmount = roundCurrency(Number(requestedRaw || 0));
    const remaining = getRemainingAllocationAmounts(allocation);
    if (!requestedRaw || !Number.isFinite(Number(requestedRaw)) || requestedInvoiceAmount <= 0) {
      return { requests: [], error: `Enter a valid refund amount for ${paymentVariantLabel(allocation.method_variant)}.` };
    }
    if (requestedInvoiceAmount > remaining.invoice + 0.0001) {
      return {
        requests: [],
        error: `${paymentVariantLabel(allocation.method_variant)} can refund at most AED ${remaining.invoice.toFixed(2)}.`,
      };
    }
    const split = splitAllocationRefundAmounts(allocation, requestedInvoiceAmount);
    requests.push({
      allocation,
      requestedInvoiceAmount,
      refundedTreatmentAmount: split.refundedTreatmentAmount,
      refundedVatAmount: split.refundedVatAmount,
    });
  }

  if (requests.length === 0) {
    return { requests: [], error: "Select at least one payment allocation to refund." };
  }

  const selectedTotalMinor = requests.reduce((sum, request) => sum + toMinorUnits(request.requestedInvoiceAmount), 0);
  const expectedTotalMinor = toMinorUnits(expectedRefundAmount);
  if (selectedTotalMinor !== expectedTotalMinor) {
    return {
      requests: [],
      error: `Selected payment allocations must add up to AED ${roundCurrency(expectedRefundAmount).toFixed(2)}.`,
    };
  }

  return { requests };
}

export async function createAllocationBackedRefund(params: {
  supabase: SupabaseClient<any, any, any>;
  receiptId: string;
  receptionistId: string;
  processedBy: string | null;
  reason: string;
  requests: AllocationRefundDraftRequest[];
  refundItemRows: RefundItemInsertRow[];
  refundedBy?: string | null;
}): Promise<CreateAllocationRefundResult> {
  const methodSummary = summarizeRefundMethodVariants(params.requests.map((request) => request.allocation.method_variant)) || "Allocation Refund";
  const totalAmount = roundCurrency(
    params.requests.reduce((sum, request) => {
      const reversedFeeAmount = getRefundableFeeAmount(request.allocation, request.requestedInvoiceAmount);
      return sum + request.requestedInvoiceAmount + reversedFeeAmount;
    }, 0)
  );

  const { data: refundData, error: refundError } = await params.supabase
    .from("refunds")
    .insert([{
      receipt_id: params.receiptId,
      receptionist_id: params.receptionistId,
      refunded_by: params.refundedBy ?? null,
      reason: params.reason,
      total_amount: totalAmount,
      payment_method: methodSummary,
    }])
    .select()
    .single();

  if (refundError || !refundData) {
    throw new Error(refundError?.message || "Failed creating refund.");
  }

  const breakdown: AllocationRefundBreakdown[] = [];
  for (const request of params.requests) {
    const reversedFeeAmount = getRefundableFeeAmount(request.allocation, request.requestedInvoiceAmount);
    const totalReturnedAmount = roundCurrency(request.requestedInvoiceAmount + reversedFeeAmount);
    const idempotencyKey = `${refundData.id}:${request.allocation.id}:${request.requestedInvoiceAmount.toFixed(2)}`;
    const { data: allocationRefundId, error: allocationRefundError } = await params.supabase.rpc("create_payment_allocation_refund", {
      p_refund_id: refundData.id,
      p_payment_allocation_id: request.allocation.id,
      p_refunded_treatment_amount: request.refundedTreatmentAmount,
      p_refunded_vat_amount: request.refundedVatAmount,
      p_reason: params.reason,
      p_processed_by: params.processedBy,
      p_idempotency_key: idempotencyKey,
    });

    if (allocationRefundError) {
      throw new Error(allocationRefundError.message || "Failed creating payment allocation refund.");
    }

    breakdown.push({
      id: String(allocationRefundId),
      allocationId: request.allocation.id,
      methodGroup: request.allocation.method_group,
      methodVariant: request.allocation.method_variant,
      methodLabel: paymentVariantLabel(request.allocation.method_variant),
      refundedTreatmentAmount: roundCurrency(request.refundedTreatmentAmount),
      refundedVatAmount: roundCurrency(request.refundedVatAmount),
      refundedInvoiceAmount: roundCurrency(request.requestedInvoiceAmount),
      reversedFeeAmount,
      totalReturnedAmount,
      originalFeeAmount: roundCurrency(Number(request.allocation.fee_amount || 0)),
      nonRefundableFeeAmount: isNonRefundableSurchargeVariant(request.allocation.method_variant)
        ? roundCurrency(Number(request.allocation.fee_amount || 0))
        : 0,
      providerReference: String(request.allocation.provider_reference_number || ""),
      terminalAuthorizationCode: String(request.allocation.terminal_authorization_code || ""),
      originalCustomerChargedAmount: roundCurrency(Number(request.allocation.customer_charged_amount || 0)),
      originalInvoiceAmount: roundCurrency(Number(request.allocation.invoice_allocation_amount || 0)),
    });
  }

  let warningMessage: string | undefined;
  if (params.refundItemRows.length > 0) {
    const { error: refundItemsError } = await params.supabase.from("refund_items").insert(
      params.refundItemRows.map((row) => ({
        refund_id: refundData.id,
        receipt_item_id: row.receipt_item_id,
        service_id: row.service_id,
        service_name: row.service_name,
        amount: roundCurrency(row.amount),
        // Pass snapshot columns through — NULL for legacy rows, populated for snapshot rows.
        ...(row.refunded_treatment_amount != null ? { refunded_treatment_amount: roundCurrency(row.refunded_treatment_amount) } : {}),
        ...(row.refunded_vat_amount != null ? { refunded_vat_amount: roundCurrency(row.refunded_vat_amount) } : {}),
        ...(row.refunded_invoice_amount != null ? { refunded_invoice_amount: roundCurrency(row.refunded_invoice_amount) } : {}),
      }))
    );
    if (refundItemsError) {
      warningMessage = `Refund processed, but refund item rows failed: ${refundItemsError.message}`;
    }
  }

  return {
    refundData,
    breakdown,
    warningMessage,
  };
}

export async function createLegacyBackedRefund(params: {
  supabase: SupabaseClient<any, any, any>;
  receiptId: string;
  receptionistId: string;
  refundedBy?: string | null;
  reason: string;
  totalAmount: number;
  paymentMethod: string;
  refundItemRows: RefundItemInsertRow[];
}) {
  const normalizedTotalAmount = roundCurrency(params.totalAmount);
  const { data: refundId, error: rpcError } = await params.supabase.rpc("create_legacy_receipt_refund", {
    p_receipt_id: params.receiptId,
    p_receptionist_id: params.receptionistId,
    p_refunded_by: params.refundedBy ?? null,
    p_reason: params.reason,
    p_total_amount: normalizedTotalAmount,
    p_payment_method: params.paymentMethod,
    p_refund_items: params.refundItemRows.map((row) => ({
      receipt_item_id: row.receipt_item_id,
      service_id: row.service_id,
      service_name: row.service_name,
      amount: roundCurrency(row.amount),
    })),
  });
  if (rpcError || !refundId) {
    throw new Error(rpcError?.message || "Failed creating legacy refund.");
  }

  const [{ data: refundData, error: refundError }, { data: refundItemsData, error: refundItemsError }] = await Promise.all([
    params.supabase.from("refunds").select("*").eq("id", refundId).single(),
    params.supabase.from("refund_items").select("*").eq("refund_id", refundId),
  ]);

  if (refundError || !refundData) {
    throw new Error(refundError?.message || "Legacy refund was created but could not be loaded.");
  }
  if (refundItemsError) {
    throw new Error(refundItemsError.message || "Legacy refund item rows could not be loaded.");
  }

  return {
    refundData,
    refundItems: refundItemsData || [],
  };
}
