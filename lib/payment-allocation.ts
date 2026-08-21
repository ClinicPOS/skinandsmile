import { fromMinorUnits, roundCurrency, sumMinorUnits, toMinorUnits } from "./money";

export const PROVIDER_FEE_RATE = 0.075;

export type PaymentMethodGroup = "cash" | "card" | "bank_transfer" | "tabby" | "tamara";
export type PaymentMethodVariant = "cash" | "card" | "bank_transfer" | "tabby_standard" | "tabby_card" | "tamara";

export type PaymentAllocationDraft = {
  id: string;
  methodVariant: PaymentMethodVariant | "";
  invoiceAllocationAmountInput: string;
  providerReferenceNumber: string;
  terminalAuthorizationCode: string;
  cardNetwork: string;
};

export type PaymentAllocationComputed = {
  id: string;
  methodGroup: PaymentMethodGroup;
  methodVariant: PaymentMethodVariant;
  treatmentNetAmount: number;
  vatAmount: number;
  invoiceAllocationAmount: number;
  feeRate: number;
  feeAmount: number;
  customerChargedAmount: number;
  providerReferenceNumber: string | null;
  terminalAuthorizationCode: string | null;
  cardNetwork: string | null;
};

export type PaymentValidationError = {
  code:
    | "missing_method"
    | "negative_or_zero_allocation"
    | "remaining_amount"
    | "overallocation"
    | "duplicate_rows"
    | "missing_reference"
    | "duplicate_reference";
  rowId?: string;
  message: string;
};

type PaymentSummaryOptions = {
  includeAmounts?: boolean;
  includeReferences?: boolean;
};

export function paymentGroupFromVariant(variant: PaymentMethodVariant): PaymentMethodGroup {
  if (variant === "cash") return "cash";
  if (variant === "card") return "card";
  if (variant === "bank_transfer") return "bank_transfer";
  if (variant === "tamara") return "tamara";
  return "tabby";
}

export function paymentVariantLabel(variant: PaymentMethodVariant): string {
  switch (variant) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "bank_transfer":
      return "Bank Transfer";
    case "tabby_standard":
      return "Tabby";
    case "tabby_card":
      return "Tabby Card";
    case "tamara":
      return "Tamara";
    default:
      return variant;
  }
}

export function normalizeProviderReference(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

export function referenceRequiredForVariant(variant: PaymentMethodVariant): boolean {
  return variant === "tabby_standard" || variant === "tabby_card" || variant === "tamara";
}

function parseDraftAmountToMinorUnits(raw: string): number {
  const normalized = String(raw || "").replace(/,/g, ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return toMinorUnits(parsed);
}

function distributeVatMinor(
  allocationInvoiceMinor: number[],
  paidInvoiceMinor: number,
  totalInvoiceMinor: number,
  totalVatMinor: number
): number[] {
  if (paidInvoiceMinor <= 0 || totalInvoiceMinor <= 0 || totalVatMinor <= 0) {
    return allocationInvoiceMinor.map(() => 0);
  }

  const paidVatMinor = Math.round((paidInvoiceMinor * totalVatMinor) / totalInvoiceMinor);
  const provisional = allocationInvoiceMinor.map((invoiceMinor) => Math.round((invoiceMinor * totalVatMinor) / totalInvoiceMinor));
  let delta = paidVatMinor - sumMinorUnits(provisional);

  if (delta === 0) return provisional;

  const adjusted = [...provisional];
  for (let index = adjusted.length - 1; index >= 0 && delta !== 0; index--) {
    const maxVat = allocationInvoiceMinor[index];
    if (delta > 0) {
      const room = maxVat - adjusted[index];
      if (room <= 0) continue;
      const step = Math.min(room, delta);
      adjusted[index] += step;
      delta -= step;
      continue;
    }

    const removable = adjusted[index];
    if (removable <= 0) continue;
    const step = Math.min(removable, Math.abs(delta));
    adjusted[index] -= step;
    delta += step;
  }

  return adjusted;
}

export function buildPaymentAllocations(
  drafts: PaymentAllocationDraft[],
  amountToPayInvoice: number,
  fullInvoiceTotal: number,
  fullVatAmount: number
): PaymentAllocationComputed[] {
  const amountToPayMinor = toMinorUnits(amountToPayInvoice);
  const fullInvoiceMinor = toMinorUnits(fullInvoiceTotal);
  const fullVatMinor = toMinorUnits(fullVatAmount);

  const rows = drafts
    .filter((row) => row.methodVariant)
    .map((row) => ({
      row,
      methodVariant: row.methodVariant as PaymentMethodVariant,
      invoiceAllocationMinor: Math.max(0, parseDraftAmountToMinorUnits(row.invoiceAllocationAmountInput)),
    }));

  const invoiceMinorByRow = rows.map((row) => row.invoiceAllocationMinor);
  const vatMinorByRow = distributeVatMinor(invoiceMinorByRow, amountToPayMinor, fullInvoiceMinor, fullVatMinor);

  return rows.map((entry, index) => {
    const methodGroup = paymentGroupFromVariant(entry.methodVariant);
    const invoiceMinor = entry.invoiceAllocationMinor;
    const vatMinor = vatMinorByRow[index] || 0;
    const treatmentNetMinor = Math.max(0, invoiceMinor - vatMinor);
    const feeRate = methodGroup === "tabby" || methodGroup === "tamara" ? PROVIDER_FEE_RATE : 0;
    const feeMinor = feeRate > 0 ? toMinorUnits(fromMinorUnits(invoiceMinor) * feeRate) : 0;
    const customerChargedMinor = invoiceMinor + feeMinor;

    const providerReference = referenceRequiredForVariant(entry.methodVariant)
      ? String(entry.row.providerReferenceNumber || "").trim()
      : "";

    return {
      id: entry.row.id,
      methodGroup,
      methodVariant: entry.methodVariant,
      treatmentNetAmount: fromMinorUnits(treatmentNetMinor),
      vatAmount: fromMinorUnits(vatMinor),
      invoiceAllocationAmount: fromMinorUnits(invoiceMinor),
      feeRate,
      feeAmount: fromMinorUnits(feeMinor),
      customerChargedAmount: fromMinorUnits(customerChargedMinor),
      providerReferenceNumber: providerReference || null,
      terminalAuthorizationCode: String(entry.row.terminalAuthorizationCode || "").trim() || null,
      cardNetwork: String(entry.row.cardNetwork || "").trim() || null,
    };
  });
}

export function validatePaymentAllocations(
  drafts: PaymentAllocationDraft[],
  amountToPayInvoice: number
): PaymentValidationError[] {
  const errors: PaymentValidationError[] = [];
  const amountToPayMinor = toMinorUnits(amountToPayInvoice);
  const active = drafts.filter((draft) => draft.methodVariant);

  const rowSumMinor = active.reduce((sum, row) => sum + Math.max(0, parseDraftAmountToMinorUnits(row.invoiceAllocationAmountInput)), 0);
  if (rowSumMinor < amountToPayMinor) {
    errors.push({
      code: "remaining_amount",
      message: `Remaining invoice amount is ${roundCurrency(fromMinorUnits(amountToPayMinor - rowSumMinor)).toFixed(2)} AED.`,
    });
  }
  if (rowSumMinor > amountToPayMinor) {
    errors.push({
      code: "overallocation",
      message: `Allocated invoice amount exceeds the amount to pay by ${roundCurrency(fromMinorUnits(rowSumMinor - amountToPayMinor)).toFixed(2)} AED.`,
    });
  }

  const rowKeys = new Set<string>();
  const providerReferences = new Set<string>();

  active.forEach((row) => {
    const variant = row.methodVariant as PaymentMethodVariant;
    if (!variant) {
      errors.push({ code: "missing_method", rowId: row.id, message: "Select a payment method for each row." });
      return;
    }

    const allocationMinor = parseDraftAmountToMinorUnits(row.invoiceAllocationAmountInput);
    if (allocationMinor <= 0) {
      errors.push({
        code: "negative_or_zero_allocation",
        rowId: row.id,
        message: "Invoice amount allocated must be greater than zero.",
      });
    }

    const reference = String(row.providerReferenceNumber || "").trim();
    if (referenceRequiredForVariant(variant) && !reference) {
      errors.push({
        code: "missing_reference",
        rowId: row.id,
        message: `${paymentVariantLabel(variant)} reference number is required.`,
      });
    }

    if (reference) {
      const providerScope = paymentGroupFromVariant(variant);
      const normalizedReference = normalizeProviderReference(reference);
      const providerRefKey = `${providerScope}:${normalizedReference}`;
      if (providerReferences.has(providerRefKey)) {
        errors.push({
          code: "duplicate_reference",
          rowId: row.id,
          message: `Duplicate ${providerScope} provider reference found: ${reference}.`,
        });
      }
      providerReferences.add(providerRefKey);
    }

    const dedupeKey = [
      variant,
      parseDraftAmountToMinorUnits(row.invoiceAllocationAmountInput),
      normalizeProviderReference(row.providerReferenceNumber),
      normalizeProviderReference(row.cardNetwork),
      normalizeProviderReference(row.terminalAuthorizationCode),
    ].join(":");

    if (rowKeys.has(dedupeKey)) {
      errors.push({
        code: "duplicate_rows",
        rowId: row.id,
        message: "Duplicate identical payment rows are not allowed.",
      });
    }
    rowKeys.add(dedupeKey);
  });

  return errors;
}

export function paymentSummaryLabel(
  allocations: PaymentAllocationComputed[],
  options: PaymentSummaryOptions = {}
): string {
  if (options.includeAmounts) {
    return allocations
      .map((allocation) => {
        const reference = options.includeReferences && allocation.providerReferenceNumber
          ? `, Ref: ${allocation.providerReferenceNumber}`
          : "";
        return `${paymentVariantLabel(allocation.methodVariant)} AED ${allocation.invoiceAllocationAmount.toFixed(2)}${reference}`;
      })
      .join(" + ");
  }

  const labels = [...new Set(allocations.map((allocation) => paymentVariantLabel(allocation.methodVariant)))];
  return labels.join(" + ");
}
