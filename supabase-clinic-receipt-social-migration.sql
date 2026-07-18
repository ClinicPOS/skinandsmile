-- Adds editable receipt printout/social fields to clinics.
-- Run this once in the Supabase SQL editor before saving these fields in Backend.

alter table public.clinics
  add column if not exists room text,
  add column if not exists whatsapp text,
  add column if not exists instagram text,
  add column if not exists facebook text,
  add column if not exists tiktok text,
  add column if not exists receipt_print_name text,
  add column if not exists receipt_title text,
  add column if not exists receipt_vat_note text,
  add column if not exists receipt_thank_you text,
  add column if not exists receipt_final_message text,
  add column if not exists trn text,
  add column if not exists logo text;