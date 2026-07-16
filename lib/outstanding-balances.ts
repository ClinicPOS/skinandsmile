import type { OutstandingBalance, BalancePayment } from "./types";

export type BalanceStatus = "Unpaid" | "Partial" | "Paid";

export type BalanceRollup = {
  balance: OutstandingBalance;
  paid: number;
  remaining: number;
  status: BalanceStatus;
  payments: BalancePayment[];
};

export function rollupBalance(
  balance: OutstandingBalance,
  payments: BalancePayment[]
): BalanceRollup {
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const original = Number(balance.original_amount || 0);
  const remaining = Math.max(0, original - paid);
  const status: BalanceStatus = paid <= 0 ? "Unpaid" : remaining <= 0.0049 ? "Paid" : "Partial";
  return { balance, paid, remaining, status, payments };
}

export function rollupBalances(
  balances: OutstandingBalance[],
  paymentsByBalanceId: Map<string, BalancePayment[]>
): BalanceRollup[] {
  return balances.map((b) => rollupBalance(b, paymentsByBalanceId.get(b.id) || []));
}

export function totalRemaining(rollups: BalanceRollup[]): number {
  return rollups.reduce((s, r) => s + r.remaining, 0);
}

export function formatBalanceReference(balance: OutstandingBalance): string {
  return balance.reference_number?.trim() || `#${balance.id.slice(0, 8).toUpperCase()}`;
}
