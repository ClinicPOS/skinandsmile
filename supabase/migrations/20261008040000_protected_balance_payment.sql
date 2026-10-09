-- LOCAL TEST ONLY. Lock, validate, save and audit each payment as one operation.
create or replace function public.record_balance_payment(p_id uuid,p_balance_id uuid,p_clinic_id uuid,p_receptionist_id uuid,p_register_id uuid,p_amount numeric,p_method text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_balance public.outstanding_balances%rowtype; v_register public.cash_register_sessions%rowtype; v_payment public.balance_payments%rowtype; v_paid numeric; v_receipt_id uuid; v_receipt_status text;
begin
 if p_id is null or p_amount is null or p_amount<=0 or p_amount>1000000 or round(p_amount,2)<>p_amount or p_method is null or p_method not in ('Cash','Card','Bank Transfer','Visa','Mastercard','Tabby','Tabby Card','Tamara','Tamara Card') or length(coalesce(p_notes,''))>2000 then raise exception 'Invalid payment' using errcode='22023'; end if;
 -- Use the receipt-before-balance lock order also used by whole receipt void.
 select receipt_id into v_receipt_id from public.outstanding_balances where id=p_balance_id and clinic_id=p_clinic_id;
 if not found then raise exception 'Balance clinic mismatch' using errcode='42501'; end if;
 if v_receipt_id is not null then
  select status into v_receipt_status from public.receipts where id=v_receipt_id for update;
  if v_receipt_status='VOIDED' then raise exception 'Voided receipt cannot accept a payment' using errcode='42501'; end if;
 end if;
 select * into v_balance from public.outstanding_balances where id=p_balance_id for update;
 if not found or v_balance.clinic_id<>p_clinic_id then raise exception 'Balance clinic mismatch' using errcode='42501'; end if;
 perform 1 from public.receptionist where id=p_receptionist_id and clinic_id=p_clinic_id;
 if not found then raise exception 'Receptionist clinic mismatch' using errcode='42501'; end if;
 select * into v_payment from public.balance_payments where id=p_id;
 if found then
  if v_payment.outstanding_balance_id is distinct from p_balance_id or v_payment.amount is distinct from p_amount or v_payment.payment_method is distinct from p_method or v_payment.receptionist_id is distinct from p_receptionist_id or v_payment.register_session_id is distinct from p_register_id or v_payment.notes is distinct from p_notes then raise exception 'Request already used' using errcode='23505'; end if;
  select coalesce(sum(amount),0) into v_paid from public.balance_payments where outstanding_balance_id=p_balance_id;
  return to_jsonb(v_payment)||jsonb_build_object('remaining_after_payment',greatest(0,v_balance.original_amount-v_paid));
 end if;
 select * into v_register from public.cash_register_sessions where id=p_register_id for share;
 if not found or v_register.receptionist_id<>p_receptionist_id or v_register.closed_at is not null then raise exception 'Register is not open for receptionist' using errcode='42501'; end if;
 select coalesce(sum(amount),0) into v_paid from public.balance_payments where outstanding_balance_id=p_balance_id;
 if p_amount>greatest(0,v_balance.original_amount-v_paid) then raise exception 'Payment exceeds remaining balance' using errcode='22023'; end if;
 insert into public.balance_payments(id,outstanding_balance_id,amount,payment_method,receptionist_id,register_session_id,notes) values(p_id,p_balance_id,p_amount,p_method,p_receptionist_id,p_register_id,p_notes) returning * into v_payment;
 insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_verified,reason,new_data)
 values(p_clinic_id,'COLLECT_BALANCE','balance_payments',p_id::text,p_receptionist_id,'receptionist',true,'Outstanding balance payment',to_jsonb(v_payment));
 return to_jsonb(v_payment)||jsonb_build_object('remaining_after_payment',greatest(0,v_balance.original_amount-v_paid-p_amount));
end;
$$;
revoke all on function public.record_balance_payment(uuid,uuid,uuid,uuid,uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.record_balance_payment(uuid,uuid,uuid,uuid,uuid,numeric,text,text) to service_role;
revoke insert,update,delete on public.balance_payments from public,anon,authenticated;
