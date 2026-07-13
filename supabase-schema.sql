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
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2),
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