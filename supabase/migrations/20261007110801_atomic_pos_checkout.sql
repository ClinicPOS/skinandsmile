-- LOCAL TEST ONLY: additive checkout operation. Existing public financial paths are not yet restricted.
create table if not exists public.pos_checkout_requests (
  id uuid primary key, clinic_id uuid not null references public.clinics(id),
  request_payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table public.pos_checkout_requests enable row level security;
revoke all on public.pos_checkout_requests from public,anon,authenticated;
grant select,insert on public.pos_checkout_requests to service_role;

create or replace function public.complete_pos_checkout(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  r public.receipts%rowtype;
  line public.receipt_items%rowtype;
  a jsonb;
  v_saved public.pos_checkout_requests%rowtype;
  v_file uuid;
  v_credit numeric := coalesce((p_payload->'receipt'->>'credit_applied')::numeric,0);
  v_credit_available numeric;
  v_subtotal numeric := 0; v_vat numeric := 0; v_total numeric := 0; v_discount numeric := 0;
  v_invoice_paid numeric := 0; v_paid_vat numeric := 0; v_fees numeric := 0; v_customer_paid numeric := 0;
  v_remaining numeric; v_rate numeric; v_service_rate numeric;
  v_payment uuid; v_credit_row jsonb := null; v_balance_row jsonb := null;
  v_items jsonb; v_result jsonb; v_ref text;
  v_register uuid := (p_payload->>'registerSessionId')::uuid;
begin
  if p_request_id is null or jsonb_typeof(p_payload->'items') <> 'array' or jsonb_array_length(p_payload->'items') not between 1 and 200
    or jsonb_typeof(p_payload->'allocations') <> 'array' then raise exception 'Invalid checkout' using errcode='22023'; end if;
  r := jsonb_populate_record(null::public.receipts,p_payload->'receipt');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  if not exists(select 1 from public.receptionist where id=r.receptionist_id and clinic_id=r.clinic_id) then
    raise exception 'Invalid receptionist clinic' using errcode='42501'; end if;
  if r.doctor_id is not null and not exists(select 1 from public.doctors where id=r.doctor_id and clinic_id=r.clinic_id and is_active=true) then
    raise exception 'Invalid doctor clinic' using errcode='42501'; end if;
  select id into v_file from public.clinic_patient_files where patient_id=r.patient_id and clinic_id=r.clinic_id for update;
  if not found then raise exception 'Patient clinic mismatch' using errcode='42501'; end if;
  if r.patient_file_id is not null and r.patient_file_id <> v_file then
    raise exception 'File clinic mismatch' using errcode='42501'; end if;
  select * into v_saved from public.pos_checkout_requests where id=p_request_id;
  if found then
    if v_saved.clinic_id <> r.clinic_id or (v_saved.request_payload-'audit_actor') <> (p_payload-'audit_actor') then
      raise exception 'Request ID already used' using errcode='23505'; end if;
    return v_saved.result || jsonb_build_object('replayed',true);
  end if;
  if v_register is not null and not exists(select 1 from public.cash_register_sessions where id=v_register and receptionist_id=r.receptionist_id and closed_at is null) then
    raise exception 'Invalid open register' using errcode='42501'; end if;
  if v_credit < 0 or v_credit <> round(v_credit,2) then raise exception 'Invalid credit' using errcode='22023'; end if;
  for line in select * from jsonb_populate_recordset(null::public.receipt_items,p_payload->'items') loop
    select vat_rate into v_service_rate from public.services where id=line.service_id and (clinic_id is null or clinic_id=r.clinic_id) and is_active=true;
    if not found then raise exception 'Invalid service clinic' using errcode='42501'; end if;
    if v_service_rate is null or line.vat_rate is distinct from v_service_rate then
      raise exception 'Service VAT changed or not configured' using errcode='23514'; end if;
    if line.quantity is null or line.quantity <= 0 or line.price is null or line.price < 0 or line.original_price is null or line.original_price < 0
      or line.total is null or line.total <> round(line.price*line.quantity,2)
      or line.allocated_global_discount_amount is null or line.allocated_global_discount_amount not between 0 and line.total
      or line.taxable_amount is null or line.taxable_amount <> line.total-line.allocated_global_discount_amount
      or line.vat_amount is null or line.vat_amount <> round(line.taxable_amount*v_service_rate,2)
      or line.final_line_total is null or line.final_line_total <> line.taxable_amount+line.vat_amount then
      raise exception 'Invalid line amounts' using errcode='22023'; end if;
    v_subtotal := v_subtotal + round(greatest(line.price,line.original_price)*line.quantity,2);
    v_vat := v_vat+line.vat_amount; v_total := v_total+line.final_line_total;
    v_discount := v_discount + round(greatest(line.price,line.original_price)*line.quantity,2)-line.taxable_amount;
  end loop;
  for a in select value from jsonb_array_elements(p_payload->'allocations') loop
    v_rate := case when a->>'method_group' in ('tabby','tamara') then 0.075 else 0 end;
    if (a->>'invoice_allocation_amount')::numeric <= 0 or (a->>'vat_amount')::numeric < 0
      or (a->>'treatment_net_amount')::numeric < 0
      or (a->>'invoice_allocation_amount')::numeric <> (a->>'treatment_net_amount')::numeric+(a->>'vat_amount')::numeric
      or (a->>'fee_rate')::numeric <> v_rate
      or (a->>'fee_amount')::numeric <> round((a->>'invoice_allocation_amount')::numeric*v_rate,2)
      or (a->>'customer_charged_amount')::numeric <> (a->>'invoice_allocation_amount')::numeric+(a->>'fee_amount')::numeric
      or (a->>'method_group' in ('tabby','tamara') and length(trim(coalesce(a->>'provider_reference_number',''))) = 0) then
      raise exception 'Invalid payment allocation' using errcode='22023'; end if;
    v_invoice_paid:=v_invoice_paid+(a->>'invoice_allocation_amount')::numeric;
    v_paid_vat:=v_paid_vat+(a->>'vat_amount')::numeric;
    v_fees:=v_fees+(a->>'fee_amount')::numeric;
    v_customer_paid:=v_customer_paid+(a->>'customer_charged_amount')::numeric;
  end loop;
  v_remaining:=v_total-v_credit-v_invoice_paid;
  if v_remaining < 0 or v_paid_vat <> (case when v_total>0 then round(v_vat*v_invoice_paid/v_total,2) else 0 end) or round(r.subtotal,2) is distinct from v_subtotal
    or r.vat is distinct from v_vat or r.total_before_gateway_fee is distinct from v_total
    or r.total is distinct from v_total+v_fees or coalesce(r.discount_amount,0) <> v_discount
    or coalesce(r.gateway_fee,0) <> v_fees or coalesce(r.birthday_discount_amount,0) > v_discount
    or (r.amount_paid is not null and r.amount_paid <> v_customer_paid)
    or (r.amount_paid is null and (v_credit > 0 or v_remaining > 0 or v_fees > 0)) then
    raise exception 'Checkout total mismatch' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into v_credit_available from public.patient_credits where patient_id=r.patient_id and clinic_id=r.clinic_id;
  if v_credit > 0 and v_credit > greatest(0,v_credit_available) then raise exception 'Patient credit changed' using errcode='23514'; end if;
  perform pg_catalog.set_config('pos.audit_actor',coalesce(p_payload->'audit_actor','{}'::jsonb)::text,true);
  insert into public.receipts(id,patient_id,patient_file_id,doctor_id,receptionist_id,clinic_id,subtotal,vat,total,total_before_gateway_fee,
    gateway_fee,gateway_fee_provider,discount_amount,birthday_discount_amount,discount_reason,notes,payment_method,amount_paid,credit_applied)
    values(p_request_id,r.patient_id,v_file,r.doctor_id,r.receptionist_id,r.clinic_id,v_subtotal,v_vat,v_total+v_fees,v_total,
    nullif(v_fees,0),r.gateway_fee_provider,nullif(v_discount,0),r.birthday_discount_amount,r.discount_reason,null,r.payment_method,r.amount_paid,nullif(v_credit,0)) returning * into r;
  insert into public.receipt_items(receipt_id,service_id,quantity,price,total,original_price,teeth,service_name_snapshot,
    allocated_global_discount_amount,taxable_amount,vat_rate,vat_amount,final_line_total)
    select r.id,service_id,quantity,price,total,original_price,coalesce(teeth,'{}'),service_name_snapshot,
      allocated_global_discount_amount,taxable_amount,vat_rate,vat_amount,final_line_total
      from jsonb_populate_recordset(null::public.receipt_items,p_payload->'items');
  select jsonb_agg(to_jsonb(i)) into v_items from public.receipt_items i where receipt_id=r.id;
  if jsonb_array_length(p_payload->'allocations') > 0 then
    v_payment := public.create_payment_record_with_allocations(r.id,r.clinic_id,r.receptionist_id,v_invoice_paid,v_paid_vat,v_fees,
      v_customer_paid,r.payment_method,jsonb_array_length(p_payload->'allocations')>1,'completed',p_payload->'allocations',r.receptionist_id);
  end if;
  v_ref:='#'||lpad(r.receipt_number::text,5,'0');
  if v_credit > 0 then
    insert into public.patient_credits(patient_id,clinic_id,amount,reason,receipt_id,receptionist_id,register_session_id,patient_file_id)
    values(r.patient_id,r.clinic_id,-v_credit,'Applied to receipt '||v_ref,r.id,r.receptionist_id,v_register,v_file)
    returning to_jsonb(patient_credits.*) into v_credit_row;
  end if;
  if v_remaining > 0 then
    insert into public.outstanding_balances(patient_id,clinic_id,original_date,original_amount,reason,reference_number,created_by,receipt_id,patient_file_id)
    values(r.patient_id,r.clinic_id,(now() at time zone 'Asia/Dubai')::date,v_remaining,
      'Partial payment at POS — paid AED '||v_customer_paid||' + credit AED '||v_credit||' of AED '||r.total,v_ref,r.receptionist_id,r.id,v_file)
    returning to_jsonb(outstanding_balances.*) into v_balance_row;
  end if;
  v_result:=jsonb_build_object('receipt',to_jsonb(r),'items',v_items,'paymentRecordId',v_payment,'credit',v_credit_row,'balance',v_balance_row,'replayed',false);
  insert into public.pos_checkout_requests(id,clinic_id,request_payload,result) values(p_request_id,r.clinic_id,p_payload-'audit_actor',v_result);
  return v_result;
end;
$$;
revoke all on function public.complete_pos_checkout(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_pos_checkout(uuid,jsonb) to service_role;
