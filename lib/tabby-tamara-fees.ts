export const INSTALLMENT_FEE_RATE = 0.075;

export type InstallmentFeeProvider = "Tabby" | "Tamara";

export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function getInstallmentFeeProvider(method: string | null | undefined): InstallmentFeeProvider | null {
  const normalized = String(method || "").toLowerCase();
  if (normalized.includes("tabby")) return "Tabby";
  if (normalized.includes("tamara")) return "Tamara";
  return null;
}

export function calculateInstallmentFee(amount: number): number {
  const baseAmount = Number(amount) || 0;
  if (baseAmount <= 0) return 0;
  return roundMoney(baseAmount / (1 - INSTALLMENT_FEE_RATE) - baseAmount);
}