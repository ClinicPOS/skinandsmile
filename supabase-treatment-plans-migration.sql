-- Adds multi-visit treatment plans with visit tracking and payment collection.
-- Run this once in the Supabase SQL editor before using Treatment Plans.

create table if not exists public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  total_amount numeric(12,2) not null default 0,
  planned_visits int not null default 1,
  status text not null default 'Active' check (status in ('Active', 'Completed', 'Cancelled')),
  notes text,
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists treatment_plans_patient_id_idx on public.treatment_plans(patient_id);
create index if not exists treatment_plans_clinic_id_idx on public.treatment_plans(clinic_id);
create index if not exists treatment_plans_status_idx on public.treatment_plans(status);

create table if not exists public.treatment_plan_visits (
  id uuid primary key default gen_random_uuid(),
  treatment_plan_id uuid not null references public.treatment_plans(id) on delete cascade,
  visit_number int not null,
  visit_date date not null default current_date,
  doctor_id uuid references public.doctors(id) on delete set null,
  receptionist_id uuid references public.receptionist(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists treatment_plan_visits_plan_id_idx on public.treatment_plan_visits(treatment_plan_id);
create index if not exists treatment_plan_visits_date_idx on public.treatment_plan_visits(visit_date desc);

create table if not exists public.treatment_plan_payments (
  id uuid primary key default gen_random_uuid(),
  treatment_plan_id uuid not null references public.treatment_plans(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  amount numeric(12,2) not null,
  payment_method text not null,
  receptionist_id uuid not null references public.receptionist(id) on delete restrict,
  register_session_id uuid references public.cash_register_sessions(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists treatment_plan_payments_plan_id_idx on public.treatment_plan_payments(treatment_plan_id);
create index if not exists treatment_plan_payments_patient_id_idx on public.treatment_plan_payments(patient_id);
create index if not exists treatment_plan_payments_clinic_id_idx on public.treatment_plan_payments(clinic_id);
create index if not exists treatment_plan_payments_created_at_idx on public.treatment_plan_payments(created_at desc);