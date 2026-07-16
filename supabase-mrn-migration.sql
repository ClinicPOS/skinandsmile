-- Add MRN (Medical Record Number) column to patients.
-- Free-text so it can hold clinic-specific formats like "H24-3164".

alter table public.patients
  add column if not exists mrn text;

create index if not exists patients_mrn_idx on public.patients (mrn);
