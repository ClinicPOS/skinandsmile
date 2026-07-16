-- Patient credits (advance payments / deposits).
-- Ledger table: a positive amount is a deposit received from the patient, a
-- negative amount is credit applied to a receipt. Available credit is
-- SUM(amount) at read time — no stored balance column, matching how
-- outstanding balance status is derived from balance_payments.

create table if not exists public.patient_credits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete restrict,
  clinic_id  uuid not null references public.clinics(id)  on delete restrict,
  amount numeric(12,2) not null check (amount <> 0),
  payment_method text,
  reason text,
  expected_treatment_date date,
  notes text,
  -- Set when credit is applied to a POS receipt; NULL for deposits.
  receipt_id uuid references public.receipts(id) on delete set null,
  receptionist_id uuid references public.receptionist(id),
  -- Ties cash deposits to a shift so register close-out sums are correct.
  register_session_id uuid references public.cash_register_sessions(id),
  created_at timestamptz not null default now()
);

create index if not exists patient_credits_patient_id_idx on public.patient_credits(patient_id);
create index if not exists patient_credits_clinic_id_idx  on public.patient_credits(clinic_id);
create index if not exists patient_credits_created_at_idx on public.patient_credits(created_at desc);
create index if not exists patient_credits_receptionist_id_idx on public.patient_credits(receptionist_id);

-- File numbers are official physical file labels — they must stay unique.
-- The live database already enforces this (the POS retry loops rely on 23505
-- duplicate errors); this index documents it and covers fresh installs.
create unique index if not exists patients_patient_number_key
  on public.patients(patient_number)
  where patient_number is not null;
