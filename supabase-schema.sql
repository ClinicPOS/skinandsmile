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
  receipt_qr_url text,
  trn text,
  room text,
  logo text,
  a4_invoice_logo_url text,
  a4_invoice_logo_width_mm double precision,
  a4_invoice_logo_height_mm double precision,
  a4_invoice_logo_alignment text,
  a4_invoice_logo_offset_x_mm double precision,
  a4_invoice_logo_offset_y_mm double precision,
  a4_invoice_primary_color text,
  a4_invoice_secondary_color text,
  a4_invoice_accent_color text,
  a4_invoice_text_color text,
  a4_invoice_divider_color text,
  a4_invoice_slogan text,
  enable_expenses boolean not null default false,
  enable_commissions boolean not null default false,
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
  original_price numeric(12,2),
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

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  receptionist_id uuid not null references public.receptionist(id) on delete restrict,
  total_invoice_amount_settled numeric(12,2) not null check (total_invoice_amount_settled >= 0),
  total_vat_amount numeric(12,2) not null default 0 check (total_vat_amount >= 0),
  total_payment_fee_amount numeric(12,2) not null default 0 check (total_payment_fee_amount >= 0),
  total_customer_charged_amount numeric(12,2) not null check (total_customer_charged_amount >= 0),
  payment_method_summary text not null default '',
  is_split boolean not null default false,
  status text not null default 'completed',
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payment_records(id) on delete cascade,
  method_group text not null,
  method_variant text not null,
  treatment_net_amount numeric(12,2) not null,
  vat_amount numeric(12,2) not null,
  invoice_allocation_amount numeric(12,2) not null,
  fee_rate numeric(8,6) not null default 0,
  fee_amount numeric(12,2) not null default 0,
  customer_charged_amount numeric(12,2) not null,
  provider_reference_number text,
  terminal_authorization_code text,
  card_network text,
  status text not null default 'completed',
  refunded_treatment_amount numeric(12,2) not null default 0,
  refunded_vat_amount numeric(12,2) not null default 0,
  refunded_fee_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_allocation_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid references public.refunds(id) on delete set null,
  payment_id uuid not null references public.payment_records(id) on delete cascade,
  payment_allocation_id uuid not null references public.payment_allocations(id) on delete cascade,
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  reason text,
  refunded_treatment_amount numeric(12,2) not null,
  refunded_vat_amount numeric(12,2) not null,
  refunded_invoice_amount numeric(12,2) not null,
  reversed_fee_amount numeric(12,2) not null,
  total_returned_amount numeric(12,2) not null,
  original_fee_rate numeric(8,6) not null,
  processed_by uuid references public.receptionist(id) on delete set null,
  status text not null default 'completed',
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.cash_deductions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  register_session_id uuid not null references public.cash_register_sessions(id) on delete restrict,
  business_date date not null,
  type text not null check (type in ('expense', 'commission')),
  staff_id uuid references public.doctors(id) on delete set null,
  paid_to_name text not null,
  description text not null,
  reference_number text,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'active' check (status in ('active', 'voided')),
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.receptionist(id) on delete set null,
  updated_at timestamptz not null default now(),
  voided_by uuid references public.receptionist(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  constraint cash_deductions_void_requires_metadata check (
    status <> 'voided'
    or (voided_at is not null and nullif(btrim(coalesce(void_reason, '')), '') is not null)
  )
);

create index if not exists cash_deductions_clinic_date_idx
  on public.cash_deductions (clinic_id, business_date, created_at desc);
create index if not exists cash_deductions_register_session_idx
  on public.cash_deductions (register_session_id, status, created_at desc);
create index if not exists cash_deductions_type_status_idx
  on public.cash_deductions (type, status, created_at desc);

create table if not exists public.cash_deduction_events (
  id uuid primary key default gen_random_uuid(),
  deduction_id uuid not null references public.cash_deductions(id) on delete cascade,
  action text not null check (action in ('created', 'updated', 'voided')),
  changed_by uuid references public.receptionist(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text,
  previous_data jsonb,
  next_data jsonb
);

create index if not exists cash_deduction_events_deduction_idx
  on public.cash_deduction_events (deduction_id, changed_at desc);

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
  status text not null default 'completed',
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
  method_group text not null,
  method_variant text not null,
  treatment_net_amount numeric(12,2) not null,
  vat_amount numeric(12,2) not null default 0,
  invoice_allocation_amount numeric(12,2) not null,
  fee_rate numeric(8,6) not null default 0,
  fee_amount numeric(12,2) not null default 0,
  customer_charged_amount numeric(12,2) not null,
  provider_reference_number text,
  terminal_authorization_code text,
  card_network text,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists treatment_plan_payment_allocations_payment_id_idx on public.treatment_plan_payment_allocations(payment_id);
create index if not exists treatment_plan_payment_allocations_group_variant_idx on public.treatment_plan_payment_allocations(method_group, method_variant);

create table if not exists public.clinic_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  target_year int not null check (target_year between 2000 and 2100),
  target_month int not null check (target_month between 1 and 12),
  net_sales_target numeric(14,2) not null check (net_sales_target >= 0),
  notes text,
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_monthly_targets_unique unique (clinic_id, target_year, target_month)
);

create index if not exists clinic_monthly_targets_clinic_idx
  on public.clinic_monthly_targets(clinic_id, target_year, target_month);

create table if not exists public.clinic_operating_schedule (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  is_open boolean not null default true,
  opens_at time,
  closes_at time,
  notes text,
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_operating_schedule_unique unique (clinic_id, weekday)
);

create index if not exists clinic_operating_schedule_clinic_idx
  on public.clinic_operating_schedule(clinic_id, weekday);

create table if not exists public.clinic_calendar_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade,
  applies_to_all_clinics boolean not null default false,
  event_name text not null,
  event_type text not null check (
    event_type in (
      'public_holiday',
      'ramadan_eid',
      'clinic_closure',
      'marketing_campaign',
      'other_business_event'
    )
  ),
  start_date date not null,
  end_date date not null,
  is_closed_day boolean not null default false,
  notes text,
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_calendar_events_date_order check (end_date >= start_date),
  constraint clinic_calendar_events_scope_check check (
    applies_to_all_clinics = true or clinic_id is not null
  )
);

create index if not exists clinic_calendar_events_date_idx
  on public.clinic_calendar_events(start_date, end_date);
create index if not exists clinic_calendar_events_scope_idx
  on public.clinic_calendar_events(applies_to_all_clinics, clinic_id, event_type);