alter table public.receipts
  add column if not exists discount_reason text;
