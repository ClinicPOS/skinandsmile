create extension if not exists pgcrypto;

create table if not exists public.receptionist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shift text not null default 'Morning',
  pin text not null,
  clinic_id uuid,
  created_at timestamptz not null default now()
);

insert into public.receptionist (name, shift, pin)
select 'Front Desk', 'Morning', '0404'
where not exists (
  select 1
  from public.receptionist
);

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  whatsapp text,
  instagram text,
  facebook text,
  tiktok text,
  receipt_print_name text,
  receipt_title text,
  receipt_vat_note text,
  receipt_thank_you text,
  receipt_final_message text,
  trn text,
  room text,
  logo text,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2),
  requires_quantity boolean not null default false,
  billing_unit text not null default 'Session',
  created_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receptionist_id uuid not null references public.receptionist(id),
  patient_id uuid references public.patients(id),
  total numeric(12,2) not null default 0,
  total_before_gateway_fee numeric(12,2),
  gateway_fee numeric(12,2),
  gateway_fee_provider text,
  payment_method text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists receipts_receptionist_id_idx on public.receipts (receptionist_id);
create index if not exists receipts_patient_id_idx on public.receipts (patient_id);
create index if not exists receipts_created_at_idx on public.receipts (created_at desc);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  service_id uuid not null references public.services(id),
  doctor_id uuid,
  quantity int default 1,
  price numeric(10,2),
  total numeric(12,2),
  created_at timestamptz not null default now()
);

create index if not exists receipt_items_receipt_id_idx on public.receipt_items (receipt_id);
create index if not exists receipt_items_service_id_idx on public.receipt_items (service_id);
create index if not exists receipt_items_created_at_idx on public.receipt_items (created_at desc);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  total_amount numeric(12,2) not null,
  reason text,
  refunded_by uuid references public.receptionist(id),
  created_at timestamptz not null default now()
);

create index if not exists refunds_receipt_id_idx on public.refunds (receipt_id);
create index if not exists refunds_created_at_idx on public.refunds (created_at desc);

create table if not exists public.cash_register_sessions (
  id uuid primary key default gen_random_uuid(),
  receptionist_id uuid not null references public.receptionist(id),
  opening_cash numeric(12,2) not null default 0,
  closing_cash numeric(12,2),
  variance numeric(12,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists cash_register_sessions_opened_at_idx
  on public.cash_register_sessions (opened_at desc);

create index if not exists cash_register_sessions_receptionist_id_idx
  on public.cash_register_sessions (receptionist_id);

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