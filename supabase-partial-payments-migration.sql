-- Partial payments at POS checkout.
-- receipts.amount_paid: what was actually collected at checkout. NULL means the
-- receipt was paid in full (all legacy rows stay NULL, so old data needs no backfill).
-- receipts.total remains the full invoice amount.
alter table public.receipts
  add column if not exists amount_paid numeric(12,2) check (amount_paid is null or amount_paid >= 0);

-- Auto-created outstanding balances link back to the receipt they came from.
-- Manually added balances (migrated from the old system) keep receipt_id NULL.
alter table public.outstanding_balances
  add column if not exists receipt_id uuid references public.receipts(id) on delete set null;

create index if not exists outstanding_balances_receipt_id_idx
  on public.outstanding_balances(receipt_id);
