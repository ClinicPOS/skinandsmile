-- LOCAL TEST ONLY. Preserve every financial and clinical record.
alter table public.treatment_plans add column if not exists cancelled_at timestamptz;
alter table public.treatment_plans add column if not exists cancelled_by uuid;
alter table public.treatment_plans add column if not exists cancellation_reason text;
create or replace function public.cancel_unused_treatment_plan(p_plan_id uuid,p_account_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_plan public.treatment_plans%rowtype; v_role text; v_today date := (now() at time zone 'Asia/Dubai')::date;
begin
 if length(trim(p_reason))<3 or length(p_reason)>1000 then raise exception 'Reason required'; end if;
 select * into v_plan from public.treatment_plans where id=p_plan_id for update;
 if not found then raise exception 'Plan not found' using errcode='P0002'; end if;
 select role into v_role from public.pos_accounts where id=p_account_id and enabled for share;
 if v_role is null or (v_role<>'owner' and not exists(select 1 from public.pos_manager_access where account_id=p_account_id and clinic_id=v_plan.clinic_id and 'correction_approval'=any(permissions) and (starts_on is null or starts_on<=v_today) and (ends_on is null or ends_on>=v_today))) then
  raise exception 'Permission denied' using errcode='42501';
 end if;
 if v_plan.status='Cancelled' then return; end if;
 if v_plan.status<>'Active' or coalesce(v_plan.is_legacy,false) or v_plan.source_imported_visit_id is not null or coalesce(v_plan.historical_amount_paid,0)>0
 or exists(select 1 from public.treatment_plan_visits where treatment_plan_id=p_plan_id)
 or exists(select 1 from public.treatment_plan_payments where treatment_plan_id=p_plan_id)
 or exists(select 1 from public.treatment_plan_payment_records where treatment_plan_id=p_plan_id)
 then raise exception 'Financial review required'; end if;
 update public.treatment_plans set status='Cancelled',cancelled_at=now(),cancelled_by=p_account_id,cancellation_reason=trim(p_reason) where id=p_plan_id;
 insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_verified,reason,old_data,new_data)
 values(v_plan.clinic_id,'CANCEL_UNUSED_PLAN','treatment_plans',p_plan_id::text,p_account_id,v_role,true,trim(p_reason),to_jsonb(v_plan),jsonb_build_object('status','Cancelled'));
end;
$$;
revoke all on function public.cancel_unused_treatment_plan(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_unused_treatment_plan(uuid,uuid,text) to service_role;

-- A payment/visit racing cancellation must lock the same parent plan.
create function pos_private.check_plan_accepts_record() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
 select status into v_status from public.treatment_plans where id=new.treatment_plan_id for share;
 if v_status='Cancelled' then raise exception 'Cancelled plans cannot accept payments or visits' using errcode='42501'; end if;
 return new;
end;
$$;
revoke all on function pos_private.check_plan_accepts_record() from public,anon,authenticated;
create trigger guard_cancelled_plan_payment before insert or update of treatment_plan_id on public.treatment_plan_payments for each row execute function pos_private.check_plan_accepts_record();
create trigger guard_cancelled_plan_payment_record before insert or update of treatment_plan_id on public.treatment_plan_payment_records for each row execute function pos_private.check_plan_accepts_record();
create trigger guard_cancelled_plan_visit before insert or update of treatment_plan_id on public.treatment_plan_visits for each row execute function pos_private.check_plan_accepts_record();
revoke delete on public.treatment_plans,public.treatment_plan_payments,public.treatment_plan_payment_records,public.treatment_plan_visits,public.outstanding_balances,public.balance_payments from public,anon,authenticated;
