-- Migration: Add patient_notes table
-- Run this once in the Supabase SQL editor on your live database.

create table if not exists public.patient_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  receipt_id uuid references public.receipts(id) on delete set null,
  note text not null,
  doctor_id uuid,
  receptionist_id uuid references public.receptionist(id) on delete set null,
  clinic_id uuid references public.clinics(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists patient_notes_patient_id_idx on public.patient_notes(patient_id);
create index if not exists patient_notes_created_at_idx on public.patient_notes(created_at desc);
