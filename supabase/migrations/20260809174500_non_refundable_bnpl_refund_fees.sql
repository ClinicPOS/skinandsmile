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
  v_requires_fee_reversal boolean;
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

  v_requires_fee_reversal := v_allocation.method_variant not in ('tabby_standard', 'tabby_card', 'tamara');
  v_reversed_fee := case
    when v_requires_fee_reversal then round(v_refund_invoice * coalesce(v_allocation.fee_rate, 0), 2)
    else 0
  end;

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
        and (
          not v_requires_fee_reversal
          or round(refunded_fee_amount + v_reversed_fee, 2) >= round(fee_amount, 2)
        )
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
