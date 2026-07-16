-- The Edit Patient modal saves an address, but live databases created before
-- supabase-schema.sql included it don't have the column. Safe to re-run.

alter table public.patients
  add column if not exists address text;
