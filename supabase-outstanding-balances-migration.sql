-- Outstanding balances migrated from the old clinic system.
-- Each row is one legacy invoice. Amount is fixed; status is derived from
-- SUM(balance_payments.amount) at read time (no stored status column — matches
-- how refunds work today).

create table if not exists public.outstanding_balances (
  id uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients(id) on delete restrict,
  clinic_id        uuid not null references public.clinics(id)  on delete restrict,
  original_date    date not null,
  original_amount  numeric(12,2) not null check (original_amount > 0),
  reason           text,
  reference_number text,
  created_by       uuid references public.receptionist(id),
  created_at       timestamptz not null default now()
);

create index if not exists outstanding_balances_patient_id_idx on public.outstanding_balances(patient_id);
create index if not exists outstanding_balances_clinic_id_idx  on public.outstanding_balances(clinic_id);

-- Each collection event (partial or full). The parent outstanding_balances row
-- is never mutated. Ties to a cash_register_session so close-out sums are correct.
create table if not exists public.balance_payments (
  id uuid primary key default gen_random_uuid(),
  outstanding_balance_id uuid not null references public.outstanding_balances(id) on delete cascade,
  amount              numeric(12,2) not null check (amount > 0),
  payment_method      text not null,
  receptionist_id     uuid not null references public.receptionist(id),
  register_session_id uuid references public.cash_register_sessions(id),
  notes               text,
  created_at          timestamptz not null default now()
);

create index if not exists balance_payments_outstanding_id_idx  on public.balance_payments(outstanding_balance_id);
create index if not exists balance_payments_created_at_idx      on public.balance_payments(created_at desc);
create index if not exists balance_payments_receptionist_id_idx on public.balance_payments(receptionist_id);
