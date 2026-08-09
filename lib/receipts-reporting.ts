import { getDubaiBusinessDate } from "./cash-deductions";
import type { PaymentAllocation } from "./types";

export type ReportingPaymentBreakdown = {
  cash: number;
  card: number;
  tabby: number;
  tabbyCard: number;
  tamara: number;
  insurance: number;
  bankTransfer: number;
  legacyUnallocated: number;
  mop: string;
};

export function getPaymentBreakdownForReporting(paymentMethodRaw: string, totalAmount: number): ReportingPaymentBreakdown {
  const paymentMethod = String(paymentMethodRaw || "").toLowerCase();
  const safeTotal = Math.max(0, Number(totalAmount || 0));
  const breakdown: ReportingPaymentBreakdown = {
    cash: 0,
    card: 0,
    tabby: 0,
    tabbyCard: 0,
    tamara: 0,
    insurance: 0,
    bankTransfer: 0,
    legacyUnallocated: 0,
    mop: "",
  };

  if (!paymentMethod || safeTotal <= 0) {
    breakdown.mop = "LEGACY / UNALLOCATED";
    return breakdown;
  }

  if (paymentMethod.includes("split payment")) {
    const matches = [...String(paymentMethodRaw || "").matchAll(/([A-Za-z ]+?)\s+AED\s+([\d.]+)/gi)];
    for (const match of matches) {
      const label = String(match[1] || "")
        .replace(/split payment/gi, "")
        .replace(/[()]/g, "")
        .trim()
        .toLowerCase();
      const amount = Number(match[2] || 0);
      if (!label || !Number.isFinite(amount) || amount <= 0) continue;

      if (label.includes("tabby card")) {
        breakdown.tabbyCard += amount;
      } else if (label.includes("tabby")) {
        breakdown.tabby += amount;
      } else if (label.includes("tamara")) {
        breakdown.tamara += amount;
      } else if (label.includes("insurance")) {
        breakdown.insurance += amount;
      } else if (label.includes("bank")) {
        breakdown.bankTransfer += amount;
      } else if (label.includes("cash")) {
        breakdown.cash += amount;
      } else {
        breakdown.legacyUnallocated += amount;
      }
    }

    breakdown.mop = matches.length > 0 ? "SPLIT" : "LEGACY / UNALLOCATED";
    return breakdown;
  }

  if (paymentMethod.includes("tabby card")) {
    breakdown.tabbyCard = safeTotal;
    breakdown.mop = "TABBY CARD";
    return breakdown;
  }

  if (paymentMethod.includes("tabby")) {
    breakdown.tabby = safeTotal;
    breakdown.mop = "TABBY";
    return breakdown;
  }

  if (paymentMethod.includes("tamara")) {
    breakdown.tamara = safeTotal;
    breakdown.mop = "TAMARA";
    return breakdown;
  }

  if (paymentMethod.includes("bank transfer")) {
    breakdown.bankTransfer = safeTotal;
    breakdown.mop = "BANK TRANSFER";
    return breakdown;
  }

  if (paymentMethod.includes("insurance")) {
    breakdown.insurance = safeTotal;
    breakdown.mop = "INSURANCE";
    return breakdown;
  }

  if (paymentMethod.includes("cash")) {
    breakdown.cash = safeTotal;
    breakdown.mop = "CASH";
    return breakdown;
  }

  breakdown.legacyUnallocated = safeTotal;
  breakdown.mop = "LEGACY / UNALLOCATED";
  return breakdown;
}

export function summarizeStoredAllocationRowsForReporting(rows: PaymentAllocation[]) {
  const breakdown = {
    cash: 0,
    card: 0,
    tabby: 0,
    tabbyCard: 0,
    tamara: 0,
    legacyUnallocated: 0,
  };
  const references = {
    card: new Set<string>(),
    tabby: new Set<string>(),
    tamara: new Set<string>(),
  };
  let tabbyFee = 0;
  let tabbyCardFee = 0;
  let tamaraFee = 0;

  rows.forEach((row) => {
    const invoiceAllocated = Number(row.invoice_allocation_amount || 0);
    const feeAmount = Number(row.fee_amount || 0);
    const reference = String(row.provider_reference_number || "").trim();

    if (row.method_variant === "cash") {
      breakdown.cash += invoiceAllocated;
      return;
    }
    if (row.method_variant === "card") {
      breakdown.card += invoiceAllocated;
      if (reference) references.card.add(reference);
      return;
    }
    if (row.method_variant === "tabby_card") {
      breakdown.tabbyCard += invoiceAllocated;
      tabbyCardFee += feeAmount;
      if (reference) references.tabby.add(reference);
      return;
    }
    if (row.method_variant === "tabby_standard") {
      breakdown.tabby += invoiceAllocated;
      tabbyFee += feeAmount;
      if (reference) references.tabby.add(reference);
      return;
    }
    if (row.method_variant === "tamara") {
      breakdown.tamara += invoiceAllocated;
      tamaraFee += feeAmount;
      if (reference) references.tamara.add(reference);
      return;
    }

    breakdown.legacyUnallocated += invoiceAllocated;
  });

  return {
    breakdown,
    tabbyFee,
    tabbyCardFee,
    tamaraFee,
    references: {
      card: [...references.card].join(", "),
      tabby: [...references.tabby].join(", "),
      tamara: [...references.tamara].join(", "),
    },
  };
}

export type ReportingCollectionSummary = {
  cash: number;
  card: number;
  tabby: number;
  tabbyCard: number;
  tamara: number;
  insurance: number;
  bankTransfer: number;
  legacyUnallocated: number;
  tabbyInvoice: number;
  tabbyCardInvoice: number;
  tamaraInvoice: number;
  tabbySurcharge: number;
  tabbyCardSurcharge: number;
  tamaraSurcharge: number;
};

export function summarizeStoredAllocationCollectionsForReporting(rows: PaymentAllocation[]): ReportingCollectionSummary {
  const summary: ReportingCollectionSummary = {
    cash: 0,
    card: 0,
    tabby: 0,
    tabbyCard: 0,
    tamara: 0,
    insurance: 0,
    bankTransfer: 0,
    legacyUnallocated: 0,
    tabbyInvoice: 0,
    tabbyCardInvoice: 0,
    tamaraInvoice: 0,
    tabbySurcharge: 0,
    tabbyCardSurcharge: 0,
    tamaraSurcharge: 0,
  };

  rows.forEach((row) => {
    const customerChargedAmount = Number(row.customer_charged_amount || 0);
    const invoiceAllocationAmount = Number(row.invoice_allocation_amount || 0);
    const feeAmount = Number(row.fee_amount || 0);

    switch (row.method_variant) {
      case "cash":
        summary.cash += customerChargedAmount;
        break;
      case "card":
        summary.card += customerChargedAmount;
        break;
      case "tabby_standard":
        summary.tabby += customerChargedAmount;
        summary.tabbyInvoice += invoiceAllocationAmount;
        summary.tabbySurcharge += feeAmount;
        break;
      case "tabby_card":
        summary.tabbyCard += customerChargedAmount;
        summary.tabbyCardInvoice += invoiceAllocationAmount;
        summary.tabbyCardSurcharge += feeAmount;
        break;
      case "tamara":
        summary.tamara += customerChargedAmount;
        summary.tamaraInvoice += invoiceAllocationAmount;
        summary.tamaraSurcharge += feeAmount;
        break;
      default:
        summary.legacyUnallocated += customerChargedAmount;
        break;
    }
  });

  return summary;
}

export function getBusinessDayKeyForReporting(value: Date | string): string {
  return getDubaiBusinessDate(value);
}
