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
  provider_reference_normalized text generated always as (
    case
      when provider_reference_number is null then null
      else regexp_replace(upper(trim(provider_reference_number)), '[\s-]+', '', 'g')
    end
  ) stored,
  terminal_authorization_code text,
  card_network text,
  status text not null default 'completed' check (status in ('completed','partially_refunded','refunded','voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists treatment_plan_payment_allocations_payment_id_idx on public.treatment_plan_payment_allocations(payment_id);
create index if not exists treatment_plan_payment_allocations_group_variant_idx on public.treatment_plan_payment_allocations(method_group, method_variant);
create index if not exists treatment_plan_payment_allocations_provider_ref_idx on public.treatment_plan_payment_allocations(provider_reference_normalized);

create unique index if not exists treatment_plan_payment_allocations_provider_ref_unique_idx
  on public.treatment_plan_payment_allocations(method_group, provider_reference_normalized)
  where provider_reference_normalized is not null and method_group in ('tabby', 'tamara');

alter table public.treatment_plan_payment_records enable row level security;
alter table public.treatment_plan_payment_allocations enable row level security;

drop policy if exists treatment_plan_payment_records_select on public.treatment_plan_payment_records;
drop policy if exists treatment_plan_payment_records_insert on public.treatment_plan_payment_records;
drop policy if exists treatment_plan_payment_records_update on public.treatment_plan_payment_records;
drop policy if exists treatment_plan_payment_allocations_select on public.treatment_plan_payment_allocations;
drop policy if exists treatment_plan_payment_allocations_insert on public.treatment_plan_payment_allocations;
drop policy if exists treatment_plan_payment_allocations_update on public.treatment_plan_payment_allocations;

create policy treatment_plan_payment_records_select on public.treatment_plan_payment_records for select using (true);
create policy treatment_plan_payment_records_insert on public.treatment_plan_payment_records for insert with check (true);
create policy treatment_plan_payment_records_update on public.treatment_plan_payment_records for update using (true);
create policy treatment_plan_payment_allocations_select on public.treatment_plan_payment_allocations for select using (true);
create policy treatment_plan_payment_allocations_insert on public.treatment_plan_payment_allocations for insert with check (true);
create policy treatment_plan_payment_allocations_update on public.treatment_plan_payment_allocations for update using (true);

create or replace function public.create_treatment_plan_payment_record_with_allocations(
  p_treatment_plan_id uuid,
  p_patient_id uuid,
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
  p_register_session_id uuid default null,
  p_created_by uuid default null,
  p_created_at timestamptz default null,
  p_payment_note_prefix text default null
)
returns table (payment_record_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_sum_invoice numeric(12,2);
  v_sum_vat numeric(12,2);
  v_sum_fees numeric(12,2);
  v_sum_customer numeric(12,2);
begin
  if jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) = 0 then
    raise exception 'Treatment plan payment allocations are required';
  end if;

  insert into public.treatment_plan_payment_records (
    treatment_plan_id,
    patient_id,
    clinic_id,
    receptionist_id,
    register_session_id,
    total_invoice_amount_settled,
    total_vat_amount,
    total_payment_fee_amount,
    total_customer_charged_amount,
    payment_method_summary,
    is_split,
    status,
    created_by,
    created_at,
    updated_at
  ) values (
    p_treatment_plan_id,
    p_patient_id,
    p_clinic_id,
    p_receptionist_id,
    p_register_session_id,
    round(coalesce(p_total_invoice_amount_settled, 0), 2),
    round(coalesce(p_total_vat_amount, 0), 2),
    round(coalesce(p_total_payment_fee_amount, 0), 2),
    round(coalesce(p_total_customer_charged_amount, 0), 2),
    coalesce(p_payment_method_summary, ''),
    coalesce(p_is_split, false),
    coalesce(p_status, 'completed'),
    coalesce(p_created_by, p_receptionist_id),
    v_created_at,
    v_created_at
  )
  returning id into v_payment_id;

  insert into public.treatment_plan_payment_allocations (
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
    status,
    created_at,
    updated_at
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
    coalesce(nullif(trim(item->>'status'), ''), 'completed'),
    v_created_at,
    v_created_at
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) as item;

  select
    round(coalesce(sum(invoice_allocation_amount), 0), 2),
    round(coalesce(sum(vat_amount), 0), 2),
    round(coalesce(sum(fee_amount), 0), 2),
    round(coalesce(sum(customer_charged_amount), 0), 2)
  into v_sum_invoice, v_sum_vat, v_sum_fees, v_sum_customer
  from public.treatment_plan_payment_allocations
  where payment_id = v_payment_id;

  if round(coalesce(p_total_invoice_amount_settled, 0), 2) <> v_sum_invoice then
    raise exception 'Treatment plan payment allocation invoice total mismatch. Expected %, got %', p_total_invoice_amount_settled, v_sum_invoice;
  end if;
  if round(coalesce(p_total_vat_amount, 0), 2) <> v_sum_vat then
    raise exception 'Treatment plan payment allocation VAT total mismatch. Expected %, got %', p_total_vat_amount, v_sum_vat;
  end if;
  if round(coalesce(p_total_payment_fee_amount, 0), 2) <> v_sum_fees then
    raise exception 'Treatment plan payment allocation fee total mismatch. Expected %, got %', p_total_payment_fee_amount, v_sum_fees;
  end if;
  if round(coalesce(p_total_customer_charged_amount, 0), 2) <> v_sum_customer then
    raise exception 'Treatment plan payment allocation customer total mismatch. Expected %, got %', p_total_customer_charged_amount, v_sum_customer;
  end if;

  insert into public.treatment_plan_payments (
    treatment_plan_id,
    patient_id,
    clinic_id,
    amount,
    payment_method,
    receptionist_id,
    register_session_id,
    notes,
    created_at
  )
  select
    p_treatment_plan_id,
    p_patient_id,
    p_clinic_id,
    allocation.invoice_allocation_amount,
    trim(
      concat(
        case allocation.method_variant
          when 'cash' then 'Cash'
          when 'card' then 'Card'
          when 'tabby_standard' then 'Tabby'
          when 'tabby_card' then 'Tabby Card'
          when 'tamara' then 'Tamara'
          else allocation.method_variant
        end,
        case
          when allocation.method_variant = 'card' and allocation.card_network is not null and trim(allocation.card_network) <> ''
            then ' (' || trim(allocation.card_network) || ')'
          else ''
        end,
        case
          when allocation.provider_reference_number is not null and trim(allocation.provider_reference_number) <> ''
            then ' (Ref: ' || trim(allocation.provider_reference_number) || ')'
          else ''
        end
      )
    ),
    p_receptionist_id,
    p_register_session_id,
    concat_ws(
      ' | ',
      nullif(trim(coalesce(p_payment_note_prefix, '')), ''),
      'Invoice settled AED ' || to_char(round(allocation.invoice_allocation_amount, 2), 'FM9999999990.00'),
      'Fee AED ' || to_char(round(allocation.fee_amount, 2), 'FM9999999990.00') || ' @ ' || to_char(round(allocation.fee_rate * 100, 1), 'FM9999999990.0') || '%',
      'Customer charged AED ' || to_char(round(allocation.customer_charged_amount, 2), 'FM9999999990.00')
    ),
    v_created_at
  from public.treatment_plan_payment_allocations allocation
  where allocation.payment_id = v_payment_id;

  payment_record_id := v_payment_id;
  created_at := v_created_at;
  return next;
end;
$$;

insert into public.treatment_plan_payment_records (
  treatment_plan_id,
  patient_id,
  clinic_id,
  receptionist_id,
  register_session_id,
  total_invoice_amount_settled,
  total_vat_amount,
  total_payment_fee_amount,
  total_customer_charged_amount,
  payment_method_summary,
  is_split,
  status,
  created_by,
  legacy_treatment_plan_payment_id,
  created_at,
  updated_at
)
select
  legacy.treatment_plan_id,
  legacy.patient_id,
  legacy.clinic_id,
  legacy.receptionist_id,
  legacy.register_session_id,
  round(coalesce(legacy.amount, 0), 2),
  0,
  round(
    coalesce(nullif(substring(coalesce(legacy.notes, '') from 'Fee AED ([0-9]+(?:\.[0-9]+)?)'), ''), '0')::numeric,
    2
  ),
  round(
    coalesce(
      nullif(substring(coalesce(legacy.notes, '') from 'Customer charged AED ([0-9]+(?:\.[0-9]+)?)'), '')::numeric,
      coalesce(legacy.amount, 0) + coalesce(nullif(substring(coalesce(legacy.notes, '') from 'Fee AED ([0-9]+(?:\.[0-9]+)?)'), ''), '0')::numeric
    ),
    2
  ),
  coalesce(legacy.payment_method, ''),
  false,
  'completed',
  legacy.receptionist_id,
  legacy.id,
  legacy.created_at,
  legacy.created_at
from public.treatment_plan_payments legacy
where not exists (
  select 1
  from public.treatment_plan_payment_records record
  where record.legacy_treatment_plan_payment_id = legacy.id
);

insert into public.treatment_plan_payment_allocations (
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
  status,
  created_at,
  updated_at
)
select
  record.id,
  case
    when legacy.payment_method ilike '%tabby%' then 'tabby'
    when legacy.payment_method ilike '%tamara%' then 'tamara'
    when legacy.payment_method ilike '%cash%' then 'cash'
    else 'card'
  end,
  case
    when legacy.payment_method ilike '%tabby card%' then 'tabby_card'
    when legacy.payment_method ilike '%tabby%' then 'tabby_standard'
    when legacy.payment_method ilike '%tamara%' then 'tamara'
    when legacy.payment_method ilike '%cash%' then 'cash'
    else 'card'
  end,
  round(coalesce(legacy.amount, 0), 2),
  0,
  round(coalesce(legacy.amount, 0), 2),
  round(
    case
      when coalesce(legacy.amount, 0) > 0 and substring(coalesce(legacy.notes, '') from 'Fee AED ([0-9]+(?:\.[0-9]+)?)') is not null
        then coalesce(nullif(substring(coalesce(legacy.notes, '') from 'Fee AED ([0-9]+(?:\.[0-9]+)?)'), ''), '0')::numeric / legacy.amount
      when legacy.payment_method ilike '%tabby%' or legacy.payment_method ilike '%tamara%'
        then 0.075
      else 0
    end,
    6
  ),
  round(
    coalesce(nullif(substring(coalesce(legacy.notes, '') from 'Fee AED ([0-9]+(?:\.[0-9]+)?)'), ''), '0')::numeric,
    2
  ),
  round(
    coalesce(
      nullif(substring(coalesce(legacy.notes, '') from 'Customer charged AED ([0-9]+(?:\.[0-9]+)?)'), '')::numeric,
      coalesce(legacy.amount, 0) + coalesce(nullif(substring(coalesce(legacy.notes, '') from 'Fee AED ([0-9]+(?:\.[0-9]+)?)'), ''), '0')::numeric
    ),
    2
  ),
  nullif(substring(coalesce(legacy.payment_method, '') from 'Ref:\s*([^)]+)'), ''),
  null,
  case
    when legacy.payment_method ilike '%visa%' then 'Visa'
    when legacy.payment_method ilike '%mastercard%' then 'Mastercard'
    else null
  end,
  'completed',
  legacy.created_at,
  legacy.created_at
from public.treatment_plan_payments legacy
join public.treatment_plan_payment_records record
  on record.legacy_treatment_plan_payment_id = legacy.id
where not exists (
  select 1
  from public.treatment_plan_payment_allocations allocation
  where allocation.payment_id = record.id
);
