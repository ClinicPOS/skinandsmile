-- Payment allocations refactor:
-- parent payment records, child allocation records, and allocation-linked refunds.

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
  status text not null default 'completed' check (status in ('pending','completed','partially_refunded','refunded','cancelled')),
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_records_receipt_id_idx on public.payment_records(receipt_id);
create index if not exists payment_records_clinic_id_idx on public.payment_records(clinic_id);
create index if not exists payment_records_created_at_idx on public.payment_records(created_at desc);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payment_records(id) on delete cascade,
  method_group text not null check (method_group in ('cash','card','tabby','tamara')),
  method_variant text not null check (method_variant in ('cash','card','tabby_standard','tabby_card','tamara')),
  treatment_net_amount numeric(12,2) not null check (treatment_net_amount >= 0),
  vat_amount numeric(12,2) not null check (vat_amount >= 0),
  invoice_allocation_amount numeric(12,2) not null check (invoice_allocation_amount > 0),
  fee_rate numeric(8,6) not null default 0 check (fee_rate >= 0),
  fee_amount numeric(12,2) not null default 0 check (fee_amount >= 0),
  customer_charged_amount numeric(12,2) not null check (customer_charged_amount >= 0),
  provider_reference_number text,
  provider_reference_normalized text generated always as (
    case
      when provider_reference_number is null then null
      else regexp_replace(upper(trim(provider_reference_number)), '[\s-]+', '', 'g')
    end
  ) stored,
  terminal_authorization_code text,
  card_network text,
  status text not null default 'completed' check (status in ('completed','partially_refunded','refunded','voided')),
  refunded_treatment_amount numeric(12,2) not null default 0 check (refunded_treatment_amount >= 0),
  refunded_vat_amount numeric(12,2) not null default 0 check (refunded_vat_amount >= 0),
  refunded_fee_amount numeric(12,2) not null default 0 check (refunded_fee_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_allocations_payment_id_idx on public.payment_allocations(payment_id);
create index if not exists payment_allocations_group_variant_idx on public.payment_allocations(method_group, method_variant);
create index if not exists payment_allocations_provider_ref_idx on public.payment_allocations(provider_reference_normalized);

create unique index if not exists payment_allocations_provider_ref_unique_idx
  on public.payment_allocations(method_group, provider_reference_normalized)
  where provider_reference_normalized is not null and method_group in ('tabby', 'tamara');

create table if not exists public.payment_allocation_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid references public.refunds(id) on delete set null,
  payment_id uuid not null references public.payment_records(id) on delete cascade,
  payment_allocation_id uuid not null references public.payment_allocations(id) on delete cascade,
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  reason text,
  refunded_treatment_amount numeric(12,2) not null check (refunded_treatment_amount >= 0),
  refunded_vat_amount numeric(12,2) not null check (refunded_vat_amount >= 0),
  refunded_invoice_amount numeric(12,2) not null check (refunded_invoice_amount >= 0),
  reversed_fee_amount numeric(12,2) not null check (reversed_fee_amount >= 0),
  total_returned_amount numeric(12,2) not null check (total_returned_amount >= 0),
  original_fee_rate numeric(8,6) not null check (original_fee_rate >= 0),
  processed_by uuid references public.receptionist(id) on delete set null,
  status text not null default 'completed' check (status in ('pending','completed','cancelled')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_allocation_refunds_payment_id_idx on public.payment_allocation_refunds(payment_id);
create index if not exists payment_allocation_refunds_allocation_id_idx on public.payment_allocation_refunds(payment_allocation_id);
create index if not exists payment_allocation_refunds_receipt_id_idx on public.payment_allocation_refunds(receipt_id);
create unique index if not exists payment_allocation_refunds_idempotency_idx
  on public.payment_allocation_refunds(idempotency_key)
  where idempotency_key is not null;

alter table public.payment_records enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_allocation_refunds enable row level security;

drop policy if exists payment_records_select on public.payment_records;
drop policy if exists payment_records_insert on public.payment_records;
drop policy if exists payment_records_update on public.payment_records;
drop policy if exists payment_allocations_select on public.payment_allocations;
drop policy if exists payment_allocations_insert on public.payment_allocations;
drop policy if exists payment_allocations_update on public.payment_allocations;
drop policy if exists payment_allocation_refunds_select on public.payment_allocation_refunds;
drop policy if exists payment_allocation_refunds_insert on public.payment_allocation_refunds;
drop policy if exists payment_allocation_refunds_update on public.payment_allocation_refunds;

create policy payment_records_select on public.payment_records for select using (true);
create policy payment_records_insert on public.payment_records for insert with check (true);
create policy payment_records_update on public.payment_records for update using (true);
create policy payment_allocations_select on public.payment_allocations for select using (true);
create policy payment_allocations_insert on public.payment_allocations for insert with check (true);
create policy payment_allocations_update on public.payment_allocations for update using (true);
create policy payment_allocation_refunds_select on public.payment_allocation_refunds for select using (true);
create policy payment_allocation_refunds_insert on public.payment_allocation_refunds for insert with check (true);
create policy payment_allocation_refunds_update on public.payment_allocation_refunds for update using (true);

create or replace function public.create_payment_record_with_allocations(
  p_receipt_id uuid,
  p_clinic_id uuid,
  p_receptionist_id uuid,
  p_total_invoice_amount_settled numeric,
  p_total_vat_amount numeric,
  p_total_payment_fee_amount numeric,
  p_total_customer_charged_amount numeric,
  p_payment_method_summary text,
  p_is_split boolean,
  p_status text,
  p_allocations jsonb,
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_sum_invoice numeric(12,2);
  v_sum_fees numeric(12,2);
  v_sum_customer numeric(12,2);
begin
  insert into public.payment_records (
    receipt_id,
    clinic_id,
    receptionist_id,
    total_invoice_amount_settled,
    total_vat_amount,
    total_payment_fee_amount,
    total_customer_charged_amount,
    payment_method_summary,
    is_split,
    status,
    created_by
  ) values (
    p_receipt_id,
    p_clinic_id,
    p_receptionist_id,
    p_total_invoice_amount_settled,
    p_total_vat_amount,
    p_total_payment_fee_amount,
    p_total_customer_charged_amount,
    coalesce(p_payment_method_summary, ''),
    coalesce(p_is_split, false),
    coalesce(p_status, 'completed'),
    coalesce(p_created_by, p_receptionist_id)
  )
  returning id into v_payment_id;

  insert into public.payment_allocations (
    payment_id,
    method_group,
    method_variant,
    treatment_net_amount,
    vat_amount,
    invoice_allocation_amount,
    fee_rate,
    fee_amount,
    customer_charged_amount,
    provider_reference_number,
    terminal_authorization_code,
    card_network,
    status
  )
  select
    v_payment_id,
    lower(trim(coalesce(item->>'method_group', ''))),
    lower(trim(coalesce(item->>'method_variant', ''))),
    round((item->>'treatment_net_amount')::numeric, 2),
    round((item->>'vat_amount')::numeric, 2),
    round((item->>'invoice_allocation_amount')::numeric, 2),
    coalesce((item->>'fee_rate')::numeric, 0),
    round((item->>'fee_amount')::numeric, 2),
    round((item->>'customer_charged_amount')::numeric, 2),
    nullif(trim(coalesce(item->>'provider_reference_number', '')), ''),
    nullif(trim(coalesce(item->>'terminal_authorization_code', '')), ''),
    nullif(trim(coalesce(item->>'card_network', '')), ''),
    coalesce(nullif(trim(item->>'status'), ''), 'completed')
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) as item;

  select
    round(coalesce(sum(invoice_allocation_amount), 0), 2),
    round(coalesce(sum(fee_amount), 0), 2),
    round(coalesce(sum(customer_charged_amount), 0), 2)
  into v_sum_invoice, v_sum_fees, v_sum_customer
  from public.payment_allocations
  where payment_id = v_payment_id;

  if round(coalesce(p_total_invoice_amount_settled, 0), 2) <> v_sum_invoice then
    raise exception 'Payment allocation invoice total mismatch. Expected %, got %', p_total_invoice_amount_settled, v_sum_invoice;
  end if;
  if round(coalesce(p_total_payment_fee_amount, 0), 2) <> v_sum_fees then
    raise exception 'Payment allocation fee total mismatch. Expected %, got %', p_total_payment_fee_amount, v_sum_fees;
  end if;
  if round(coalesce(p_total_customer_charged_amount, 0), 2) <> v_sum_customer then
    raise exception 'Payment allocation customer total mismatch. Expected %, got %', p_total_customer_charged_amount, v_sum_customer;
  end if;

  return v_payment_id;
end;
$$;

create or replace function public.create_payment_allocation_refund(
  p_refund_id uuid,
  p_payment_allocation_id uuid,
  p_refunded_treatment_amount numeric,
  p_refunded_vat_amount numeric,
  p_reason text,
  p_processed_by uuid,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allocation public.payment_allocations%rowtype;
  v_payment public.payment_records%rowtype;
  v_refund_id uuid;
  v_refund_invoice numeric(12,2);
  v_reversed_fee numeric(12,2);
  v_refunded_customer numeric(12,2);
begin
  select * into v_allocation
  from public.payment_allocations
  where id = p_payment_allocation_id
  for update;

  if not found then
    raise exception 'Payment allocation not found';
  end if;

  select * into v_payment
  from public.payment_records
  where id = v_allocation.payment_id
  for update;

  if not found then
    raise exception 'Payment record not found';
  end if;

  v_refund_invoice := round(coalesce(p_refunded_treatment_amount, 0) + coalesce(p_refunded_vat_amount, 0), 2);
  if v_refund_invoice <= 0 then
    raise exception 'Refund amount must be greater than zero';
  end if;

  if round(v_allocation.refunded_treatment_amount + p_refunded_treatment_amount, 2) > round(v_allocation.treatment_net_amount, 2) then
    raise exception 'Refunded treatment amount exceeds original allocation';
  end if;
  if round(v_allocation.refunded_vat_amount + p_refunded_vat_amount, 2) > round(v_allocation.vat_amount, 2) then
    raise exception 'Refunded VAT exceeds original allocation';
  end if;

  v_reversed_fee := round(v_refund_invoice * coalesce(v_allocation.fee_rate, 0), 2);
  if round(v_allocation.refunded_fee_amount + v_reversed_fee, 2) > round(v_allocation.fee_amount, 2) then
    raise exception 'Reversed fee exceeds original allocation fee';
  end if;

  v_refunded_customer := round(v_refund_invoice + v_reversed_fee, 2);

  insert into public.payment_allocation_refunds (
    refund_id,
    payment_id,
    payment_allocation_id,
    receipt_id,
    clinic_id,
    reason,
    refunded_treatment_amount,
    refunded_vat_amount,
    refunded_invoice_amount,
    reversed_fee_amount,
    total_returned_amount,
    original_fee_rate,
    processed_by,
    status,
    idempotency_key
  )
  values (
    p_refund_id,
    v_payment.id,
    v_allocation.id,
    v_payment.receipt_id,
    v_payment.clinic_id,
    p_reason,
    round(p_refunded_treatment_amount, 2),
    round(p_refunded_vat_amount, 2),
    v_refund_invoice,
    v_reversed_fee,
    v_refunded_customer,
    coalesce(v_allocation.fee_rate, 0),
    p_processed_by,
    'completed',
    nullif(trim(coalesce(p_idempotency_key, '')), '')
  )
  returning id into v_refund_id;

  update public.payment_allocations
  set
    refunded_treatment_amount = round(refunded_treatment_amount + p_refunded_treatment_amount, 2),
    refunded_vat_amount = round(refunded_vat_amount + p_refunded_vat_amount, 2),
    refunded_fee_amount = round(refunded_fee_amount + v_reversed_fee, 2),
    status = case
      when round(refunded_treatment_amount + p_refunded_treatment_amount, 2) >= round(treatment_net_amount, 2)
        and round(refunded_vat_amount + p_refunded_vat_amount, 2) >= round(vat_amount, 2)
        and round(refunded_fee_amount + v_reversed_fee, 2) >= round(fee_amount, 2)
      then 'refunded'
      else 'partially_refunded'
    end,
    updated_at = now()
  where id = v_allocation.id;

  update public.payment_records
  set
    status = case
      when exists (
        select 1
        from public.payment_allocations pa
        where pa.payment_id = v_payment.id and pa.status in ('completed', 'partially_refunded')
      ) then 'partially_refunded'
      else 'refunded'
    end,
    updated_at = now()
  where id = v_payment.id;

  return v_refund_id;
end;
$$;
