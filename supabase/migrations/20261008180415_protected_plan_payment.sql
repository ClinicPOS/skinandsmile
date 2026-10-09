-- LOCAL TEST ONLY. A checked, serialized wrapper around the existing financial contract.
create table public.pos_plan_payment_requests(id uuid primary key, treatment_plan_id uuid not null references public.treatment_plans(id), args jsonb not null, result jsonb not null,created_at timestamptz not null default now());
alter table public.pos_plan_payment_requests enable row level security;
revoke all on public.pos_plan_payment_requests from public,anon,authenticated;
grant select,insert on public.pos_plan_payment_requests to service_role;
create function public.record_protected_plan_payment(p_request_id uuid,p_args jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_plan public.treatment_plans%rowtype; v_prior public.pos_plan_payment_requests%rowtype; v_paid numeric; v_amount numeric; v_result jsonb;
begin
 select * into v_plan from public.treatment_plans where id=(p_args->>'p_treatment_plan_id')::uuid for update;
 if not found or v_plan.clinic_id is distinct from (p_args->>'p_clinic_id')::uuid or v_plan.patient_id is distinct from (p_args->>'p_patient_id')::uuid then raise exception 'Plan clinic mismatch' using errcode='42501'; end if;
 perform 1 from public.receptionist where id=(p_args->>'p_receptionist_id')::uuid and clinic_id=v_plan.clinic_id;
 if not found then raise exception 'Receptionist clinic mismatch' using errcode='42501'; end if;
 select * into v_prior from public.pos_plan_payment_requests where id=p_request_id;
 if found then
  if v_prior.args is distinct from p_args then raise exception 'Request already used' using errcode='23505'; end if;
  return v_prior.result;
 end if;
 if v_plan.status='Cancelled' then raise exception 'Plan cancelled'; end if;
 perform 1 from public.cash_register_sessions where id=(p_args->>'p_register_session_id')::uuid and receptionist_id=(p_args->>'p_receptionist_id')::uuid and closed_at is null for share;
 if not found then raise exception 'Open register required' using errcode='42501'; end if;
 select coalesce(sum(total_invoice_amount_settled),0) into v_paid from public.treatment_plan_payment_records where treatment_plan_id=v_plan.id and status in ('completed','partially_refunded','refunded');
 select v_paid+coalesce(sum(amount),0) into v_paid from public.treatment_plan_payments where treatment_plan_id=v_plan.id and source_payment_record_id is null;
 v_paid:=v_paid+case when v_plan.is_legacy then coalesce(v_plan.historical_amount_paid,0) else 0 end;
 v_amount:=(p_args->>'p_total_invoice_amount_settled')::numeric;
 if v_amount is null or v_amount<=0 or v_amount>greatest(0,v_plan.total_amount-v_paid) then raise exception 'Payment exceeds remaining'; end if;
 select to_jsonb(saved) into v_result from public.create_treatment_plan_payment_record_with_allocations(
 v_plan.id,v_plan.patient_id,v_plan.clinic_id,(p_args->>'p_receptionist_id')::uuid,v_amount,(p_args->>'p_total_vat_amount')::numeric,(p_args->>'p_total_payment_fee_amount')::numeric,(p_args->>'p_total_customer_charged_amount')::numeric,p_args->>'p_payment_method_summary',(p_args->>'p_is_split')::boolean,'completed',p_args->'p_allocations',(p_args->>'p_register_session_id')::uuid,(p_args->>'p_receptionist_id')::uuid,now(),p_args->>'p_payment_note_prefix') saved;
 insert into public.pos_plan_payment_requests values(p_request_id,v_plan.id,p_args,v_result,now());
 insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_verified,reason,new_data) values(v_plan.clinic_id,'COLLECT_PLAN_PAYMENT','treatment_plan_payment_records',v_result->>'payment_record_id',(p_args->>'p_receptionist_id')::uuid,'receptionist',true,'Treatment plan payment',v_result);
 return v_result;
end;
$$;
revoke all on function public.record_protected_plan_payment(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_protected_plan_payment(uuid,jsonb) to service_role;
DO $$ declare fn record; begin for fn in select oid::regprocedure as signature from pg_proc where proname='create_treatment_plan_payment_record_with_allocations' and pronamespace='public'::regnamespace loop execute format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn.signature); end loop; end $$;
revoke insert,update,delete on public.treatment_plan_payments,public.treatment_plan_payment_records,public.treatment_plan_payment_allocations from public,anon,authenticated;