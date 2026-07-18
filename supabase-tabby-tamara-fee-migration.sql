-- Stores 7.5% Tabby/Tamara gateway fees on receipts.
-- Run this once in the Supabase SQL editor before saving Tabby/Tamara receipts.

alter table public.receipts
  add column if not exists total_before_gateway_fee numeric(12,2),
  add column if not exists gateway_fee numeric(12,2),
  add column if not exists gateway_fee_provider text;