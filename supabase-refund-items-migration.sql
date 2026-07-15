-- Migration: Add refund_items table
-- Run this once in the Supabase SQL editor on your live database.

create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds(id) on delete cascade,
  receipt_item_id uuid references public.receipt_items(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  service_name text,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists refund_items_refund_id_idx on public.refund_items(refund_id);
