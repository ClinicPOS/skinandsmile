alter table public.treatment_plan_payments
  add column if not exists source_payment_record_id uuid references public.treatment_plan_payment_records(id) on delete set null;

create index if not exists treatment_plan_payments_source_payment_record_id_idx
  on public.treatment_plan_payments(source_payment_record_id);

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
    source_payment_record_id,
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
    v_payment_id,
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

-- Backfill pass 1: direct legacy link where already present on records.
update public.treatment_plan_payments p
set source_payment_record_id = r.id
from public.treatment_plan_payment_records r
where p.source_payment_record_id is null
  and r.legacy_treatment_plan_payment_id = p.id;

-- Backfill pass 2: conservative unambiguous group linking (supports split rows).
with allocation_signatures as (
  select
    a.payment_id as record_id,
    string_agg(
      lower(a.method_variant) || ':' || to_char(round(coalesce(a.invoice_allocation_amount, 0), 2), 'FM9999999990.00'),
      '|' order by lower(a.method_variant), to_char(round(coalesce(a.invoice_allocation_amount, 0), 2), 'FM9999999990.00')
    ) as signature,
    count(*) as allocation_count
  from public.treatment_plan_payment_allocations a
  group by a.payment_id
),
record_groups as (
  select
    r.id as record_id,
    r.treatment_plan_id,
    r.created_at,
    coalesce(r.receptionist_id, '00000000-0000-0000-0000-000000000000'::uuid) as receptionist_id_key,
    coalesce(r.register_session_id, '00000000-0000-0000-0000-000000000000'::uuid) as register_session_id_key,
    round(coalesce(r.total_invoice_amount_settled, 0), 2) as expected_sum,
    a.signature as expected_signature,
    a.allocation_count as expected_count
  from public.treatment_plan_payment_records r
  join allocation_signatures a on a.record_id = r.id
  where coalesce(r.status, 'completed') in ('completed', 'partially_refunded', 'refunded')
),
payment_groups as (
  select
    p.treatment_plan_id,
    p.created_at,
    coalesce(p.receptionist_id, '00000000-0000-0000-0000-000000000000'::uuid) as receptionist_id_key,
    coalesce(p.register_session_id, '00000000-0000-0000-0000-000000000000'::uuid) as register_session_id_key,
    string_agg(
      case
        when coalesce(p.payment_method, '') ilike '%tabby card%' then 'tabby_card'
        when coalesce(p.payment_method, '') ilike '%tabby%' then 'tabby_standard'
        when coalesce(p.payment_method, '') ilike '%tamara%' then 'tamara'
        when coalesce(p.payment_method, '') ilike '%cash%' then 'cash'
        when coalesce(p.payment_method, '') ilike '%bank transfer%' then 'bank_transfer'
        when coalesce(p.payment_method, '') ilike '%insurance%' then 'insurance'
        when coalesce(p.payment_method, '') ilike '%visa%' then 'card'
        when coalesce(p.payment_method, '') ilike '%mastercard%' then 'card'
        when coalesce(p.payment_method, '') ilike '%card%' then 'card'
        else 'unknown'
      end || ':' || to_char(round(coalesce(p.amount, 0), 2), 'FM9999999990.00'),
      '|' order by
      case
        when coalesce(p.payment_method, '') ilike '%tabby card%' then 'tabby_card'
        when coalesce(p.payment_method, '') ilike '%tabby%' then 'tabby_standard'
        when coalesce(p.payment_method, '') ilike '%tamara%' then 'tamara'
        when coalesce(p.payment_method, '') ilike '%cash%' then 'cash'
        when coalesce(p.payment_method, '') ilike '%bank transfer%' then 'bank_transfer'
        when coalesce(p.payment_method, '') ilike '%insurance%' then 'insurance'
        when coalesce(p.payment_method, '') ilike '%visa%' then 'card'
        when coalesce(p.payment_method, '') ilike '%mastercard%' then 'card'
        when coalesce(p.payment_method, '') ilike '%card%' then 'card'
        else 'unknown'
      end,
      to_char(round(coalesce(p.amount, 0), 2), 'FM9999999990.00')
    ) as signature,
    count(*) as payment_count,
    round(sum(coalesce(p.amount, 0)), 2) as payment_sum,
    array_agg(p.id order by p.id) as payment_ids
  from public.treatment_plan_payments p
  where p.source_payment_record_id is null
  group by
    p.treatment_plan_id,
    p.created_at,
    coalesce(p.receptionist_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(p.register_session_id, '00000000-0000-0000-0000-000000000000'::uuid)
),
candidate_matches as (
  select
    r.record_id,
    p.payment_ids
  from record_groups r
  join payment_groups p
    on p.treatment_plan_id = r.treatment_plan_id
   and p.created_at = r.created_at
   and p.receptionist_id_key = r.receptionist_id_key
   and p.register_session_id_key = r.register_session_id_key
  where p.payment_sum = r.expected_sum
    and p.payment_count = r.expected_count
    and p.signature = r.expected_signature
),
record_match_counts as (
  select record_id, count(*) as c
  from candidate_matches
  group by record_id
),
expanded_edges as (
  select
    m.record_id,
    unnest(m.payment_ids) as payment_id
  from candidate_matches m
),
payment_match_counts as (
  select payment_id, count(*) as c
  from expanded_edges
  group by payment_id
),
final_edges as (
  select
    e.record_id,
    e.payment_id
  from expanded_edges e
  join record_match_counts rc on rc.record_id = e.record_id and rc.c = 1
  join payment_match_counts pc on pc.payment_id = e.payment_id and pc.c = 1
)
update public.treatment_plan_payments p
set source_payment_record_id = f.record_id
from final_edges f
where p.id = f.payment_id
  and p.source_payment_record_id is null;
