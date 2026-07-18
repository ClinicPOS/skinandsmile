-- Recalculate today's Tabby/Tamara gateway fees to a direct 7.5% fee.
-- Uses the Dubai calendar day and updates only receipts that already have a
-- Tabby/Tamara gateway fee recorded.

begin;

-- Preview affected receipts before updating.
with day_bounds as (
  select
    ((now() at time zone 'Asia/Dubai')::date at time zone 'Asia/Dubai') as starts_at,
    (((now() at time zone 'Asia/Dubai')::date + 1) at time zone 'Asia/Dubai') as ends_at
), fee_rows as (
  select
    r.id,
    r.created_at,
    r.payment_method,
    r.gateway_fee_provider,
    r.total_before_gateway_fee,
    r.gateway_fee as old_gateway_fee,
    r.total as old_total,
    r.amount_paid as old_amount_paid,
    coalesce(
      case
        when r.payment_method ilike 'Split Payment%'
          then nullif((regexp_match(r.payment_method, '\+\s*(tabby(?:\s+card)?|tamara(?:\s+card)?)\s+AED\s+([0-9]+(?:\.[0-9]+)?)', 'i'))[2], '')::numeric
        else null
      end,
      nullif(r.amount_paid - coalesce(r.gateway_fee, 0), 0),
      r.total_before_gateway_fee,
      r.total - coalesce(r.gateway_fee, 0)
    ) as fee_base
  from public.receipts r
  cross join day_bounds d
  where r.created_at >= d.starts_at
    and r.created_at < d.ends_at
    and coalesce(r.gateway_fee, 0) > 0
    and (
      coalesce(r.gateway_fee_provider, '') ilike '%tabby%'
      or coalesce(r.gateway_fee_provider, '') ilike '%tamara%'
      or coalesce(r.payment_method, '') ilike '%tabby%'
      or coalesce(r.payment_method, '') ilike '%tamara%'
    )
)
select
  id,
  created_at,
  payment_method,
  gateway_fee_provider,
  fee_base,
  old_gateway_fee,
  round(fee_base * 0.075, 2) as new_gateway_fee,
  old_total,
  round(coalesce(total_before_gateway_fee, old_total - old_gateway_fee) + round(fee_base * 0.075, 2), 2) as new_total,
  old_amount_paid,
  case
    when old_amount_paid is null then null
    else round(old_amount_paid - old_gateway_fee + round(fee_base * 0.075, 2), 2)
  end as new_amount_paid
from fee_rows
order by created_at;

with day_bounds as (
  select
    ((now() at time zone 'Asia/Dubai')::date at time zone 'Asia/Dubai') as starts_at,
    (((now() at time zone 'Asia/Dubai')::date + 1) at time zone 'Asia/Dubai') as ends_at
), fee_rows as (
  select
    r.id,
    r.total_before_gateway_fee,
    r.gateway_fee as old_gateway_fee,
    r.total as old_total,
    r.amount_paid as old_amount_paid,
    coalesce(
      case
        when r.payment_method ilike 'Split Payment%'
          then nullif((regexp_match(r.payment_method, '\+\s*(tabby(?:\s+card)?|tamara(?:\s+card)?)\s+AED\s+([0-9]+(?:\.[0-9]+)?)', 'i'))[2], '')::numeric
        else null
      end,
      nullif(r.amount_paid - coalesce(r.gateway_fee, 0), 0),
      r.total_before_gateway_fee,
      r.total - coalesce(r.gateway_fee, 0)
    ) as fee_base
  from public.receipts r
  cross join day_bounds d
  where r.created_at >= d.starts_at
    and r.created_at < d.ends_at
    and coalesce(r.gateway_fee, 0) > 0
    and (
      coalesce(r.gateway_fee_provider, '') ilike '%tabby%'
      or coalesce(r.gateway_fee_provider, '') ilike '%tamara%'
      or coalesce(r.payment_method, '') ilike '%tabby%'
      or coalesce(r.payment_method, '') ilike '%tamara%'
    )
), recalculated as (
  select
    id,
    old_gateway_fee,
    round(fee_base * 0.075, 2) as new_gateway_fee,
    round(coalesce(total_before_gateway_fee, old_total - old_gateway_fee) + round(fee_base * 0.075, 2), 2) as new_total,
    case
      when old_amount_paid is null then null
      else round(old_amount_paid - old_gateway_fee + round(fee_base * 0.075, 2), 2)
    end as new_amount_paid
  from fee_rows
)
update public.receipts r
set
  gateway_fee = recalculated.new_gateway_fee,
  total = recalculated.new_total,
  amount_paid = recalculated.new_amount_paid
from recalculated
where r.id = recalculated.id
returning
  r.id,
  recalculated.old_gateway_fee,
  r.gateway_fee as new_gateway_fee,
  r.total as new_total,
  r.amount_paid as new_amount_paid;

commit;
