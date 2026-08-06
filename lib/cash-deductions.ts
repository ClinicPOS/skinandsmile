import { roundCurrency } from "./money";

export const DUBAI_TIMEZONE = "Asia/Dubai";

export function getDubaiBusinessDate(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DUBAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export function extractLegacyCashAmount(paymentMethodRaw: string, totalAmount: number): number {
  const paymentMethod = String(paymentMethodRaw || "").toLowerCase();
  const safeTotal = roundCurrency(Math.max(0, Number(totalAmount || 0)));
  if (!paymentMethod || safeTotal <= 0) return 0;

  if (paymentMethod.includes("split payment")) {
    const matches = [...String(paymentMethodRaw || "").matchAll(/([A-Za-z ]+?)\s+AED\s+([\d.]+)/gi)];
    return roundCurrency(matches.reduce((sum, match) => {
      const label = String(match[1] || "")
        .replace(/split payment/gi, "")
        .replace(/[()]/g, "")
        .trim()
        .toLowerCase();
      const amount = Number(match[2] || 0);
      if (!label.includes("cash") || !Number.isFinite(amount) || amount <= 0) return sum;
      return sum + amount;
    }, 0));
  }

  if (paymentMethod.includes("cash")) return safeTotal;
  return 0;
}

export function getCashDeductionTypeLabel(type: "expense" | "commission"): string {
  return type === "commission" ? "Commission" : "Expense";
}
