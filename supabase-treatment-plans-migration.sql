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

create table if not exists public.treatment_plan_payment_records (
  id uuid primary key default gen_random_uuid(),
  treatment_plan_id uuid not null references public.treatment_plans(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  receptionist_id uuid not null references public.receptionist(id) on delete restrict,
  register_session_id uuid references public.cash_register_sessions(id) on delete set null,
  total_invoice_amount_settled numeric(12,2) not null check (total_invoice_amount_settled >= 0),
  total_vat_amount numeric(12,2) not null default 0 check (total_vat_amount >= 0),
  total_payment_fee_amount numeric(12,2) not null default 0 check (total_payment_fee_amount >= 0),
  total_customer_charged_amount numeric(12,2) not null check (total_customer_charged_amount >= 0),
  payment_method_summary text not null default '',
  is_split boolean not null default false,
  status text not null default 'completed' check (status in ('pending','completed','partially_refunded','refunded','cancelled')),
  created_by uuid references public.receptionist(id) on delete set null,
  legacy_treatment_plan_payment_id uuid unique references public.treatment_plan_payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists treatment_plan_payment_records_plan_id_idx on public.treatment_plan_payment_records(treatment_plan_id);
create index if not exists treatment_plan_payment_records_clinic_id_idx on public.treatment_plan_payment_records(clinic_id);
create index if not exists treatment_plan_payment_records_created_at_idx on public.treatment_plan_payment_records(created_at desc);

create table if not exists public.treatment_plan_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.treatment_plan_payment_records(id) on delete cascade,
  method_group text not null check (method_group in ('cash','card','tabby','tamara')),
  method_variant text not null check (method_variant in ('cash','card','tabby_standard','tabby_card','tamara')),
  treatment_net_amount numeric(12,2) not null check (treatment_net_amount >= 0),
  vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0),
  invoice_allocation_amount numeric(12,2) not null check (invoice_allocation_amount > 0),
  fee_rate numeric(8,6) not null default 0 check (fee_rate >= 0),
  fee_amount numeric(12,2) not null default 0 check (fee_amount >= 0),
  customer_charged_amount numeric(12,2) not null check (customer_charged_amount >= 0),
  provider_reference_number text,
  terminal_authorization_code text,
  card_network text,
  status text not null default 'completed' check (status in ('completed','partially_refunded','refunded','voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists treatment_plan_payment_allocations_payment_id_idx on public.treatment_plan_payment_allocations(payment_id);
create index if not exists treatment_plan_payment_allocations_group_variant_idx on public.treatment_plan_payment_allocations(method_group, method_variant);