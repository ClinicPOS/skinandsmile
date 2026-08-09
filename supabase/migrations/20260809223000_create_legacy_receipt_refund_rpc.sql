create or replace function public.create_legacy_receipt_refund(
  p_receipt_id uuid,
  p_receptionist_id uuid,
  p_refunded_by uuid,
  p_reason text,
  p_total_amount numeric,
  p_payment_method text,
  p_refund_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.receipts%rowtype;
  v_refund_id uuid;
  v_paid_amount numeric(12,2);
  v_refunded_so_far numeric(12,2);
  v_refund_total numeric(12,2);
begin
  select * into v_receipt
  from public.receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Receipt not found';
  end if;

  v_paid_amount := round(coalesce(v_receipt.amount_paid, v_receipt.total, 0), 2);
  v_refund_total := round(coalesce(p_total_amount, 0), 2);

  if v_refund_total <= 0 then
    raise exception 'Refund amount must be greater than zero';
  end if;

  select round(coalesce(sum(total_amount), 0), 2)
  into v_refunded_so_far
  from public.refunds
  where receipt_id = p_receipt_id;

  if round(v_refunded_so_far + v_refund_total, 2) > v_paid_amount then
    raise exception 'Refund exceeds the amount originally paid';
  end if;

  insert into public.refunds (
    receipt_id,
    receptionist_id,
    refunded_by,
    reason,
    total_amount,
    payment_method
  ) values (
    p_receipt_id,
    p_receptionist_id,
    p_refunded_by,
    nullif(trim(coalesce(p_reason, '')), ''),
    v_refund_total,
    nullif(trim(coalesce(p_payment_method, '')), '')
  )
  returning id into v_refund_id;

  insert into public.refund_items (
    refund_id,
    receipt_item_id,
    service_id,
    service_name,
    amount
  )
  select
    v_refund_id,
    case
      when nullif(trim(coalesce(item->>'receipt_item_id', '')), '') is null then null
      else (item->>'receipt_item_id')::uuid
    end,
    case
      when nullif(trim(coalesce(item->>'service_id', '')), '') is null then null
      else (item->>'service_id')::uuid
    end,
    nullif(trim(coalesce(item->>'service_name', '')), ''),
    round(coalesce((item->>'amount')::numeric, 0), 2)
  from jsonb_array_elements(coalesce(p_refund_items, '[]'::jsonb)) as item
  where round(coalesce((item->>'amount')::numeric, 0), 2) > 0;

  return v_refund_id;
end;
$$;
