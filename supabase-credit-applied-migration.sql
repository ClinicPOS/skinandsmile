-- Patient credit applied at POS checkout.
-- receipts.credit_applied: portion of the invoice covered by the patient's
-- prepaid credit (patient_credits ledger). NULL means no credit was used, so
-- all legacy rows need no backfill. receipts.amount_paid keeps meaning "money
-- actually received at checkout" and excludes the credit portion.
-- Paid in full when amount_paid + credit_applied covers total.

alter table public.receipts
  add column if not exists credit_applied numeric(12,2)
    check (credit_applied is null or credit_applied > 0);
