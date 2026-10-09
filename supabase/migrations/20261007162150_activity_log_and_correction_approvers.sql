-- LOCAL TEST ONLY: new protected activity history and approver configuration.
create schema if not exists pos_private;
revoke all on schema pos_private from public,anon,authenticated;
create table public.activity_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(), clinic_id uuid,
  action text not null, entity_type text not null, entity_id text,
  actor_id uuid, actor_role text not null default 'unknown',
  actor_reference text, actor_verified boolean not null default false,
  reason text, old_data jsonb, new_data jsonb
);
create index activity_log_clinic_time_idx on public.activity_log(clinic_id,occurred_at desc,id desc);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from public,anon,authenticated,service_role;
grant select,insert on public.activity_log to service_role;
grant usage,select on sequence public.activity_log_id_seq to service_role;

create table public.clinic_correction_approvers (
  clinic_id uuid primary key references public.clinics(id) on delete restrict,
  primary_approver_id uuid not null references public.receptionist(id) on delete restrict,
  backup_approver_id uuid references public.receptionist(id) on delete restrict,
  temporary_approver_id uuid references public.receptionist(id) on delete restrict,
  temporary_start date, temporary_end date,
  updated_at timestamptz not null default now(),
  check (backup_approver_id is distinct from primary_approver_id),
  check ((temporary_approver_id is null and temporary_start is null and temporary_end is null)
    or (temporary_approver_id is not null and temporary_start is not null and temporary_end is not null and temporary_end>=temporary_start))
);
alter table public.clinic_correction_approvers enable row level security;
revoke all on public.clinic_correction_approvers from public,anon,authenticated;
grant select,insert,update on public.clinic_correction_approvers to service_role;

create function pos_private.prevent_activity_changes() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Activity history cannot be edited or deleted' using errcode='42501'; end;
$$;
create trigger activity_log_immutable before update or delete on public.activity_log for each row execute function pos_private.prevent_activity_changes();
revoke all on function pos_private.prevent_activity_changes() from public,anon,authenticated;

-- Dedicated private trigger writer records database changes even on remaining legacy paths.
-- Legacy/client-supplied staff fields are not treated as verified identity.
create function pos_private.capture_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_actor jsonb;
  v_clinic uuid; v_actor_id uuid; v_entity text;
begin
  v_old:=case when TG_OP='INSERT' then null else to_jsonb(OLD) end;
  v_new:=case when TG_OP='DELETE' then null else to_jsonb(NEW) end;
  if TG_OP='UPDATE' and v_old=v_new then return NEW; end if;
  v_row:=coalesce(v_new,v_old);
  v_entity:=coalesce(v_row->>'id',v_row->>'clinic_id');
  v_clinic:=nullif(v_row->>'clinic_id','')::uuid;
  if v_clinic is null and v_row->>'receipt_id' is not null then
    select clinic_id into v_clinic from public.receipts where id=(v_row->>'receipt_id')::uuid;
  end if;
  if v_clinic is null and v_row->>'treatment_plan_id' is not null then
    select clinic_id into v_clinic from public.treatment_plans where id=(v_row->>'treatment_plan_id')::uuid;
  end if;
  if v_clinic is null and v_row->>'payment_id' is not null then
    if TG_TABLE_NAME='treatment_plan_payment_allocations' then
      select clinic_id into v_clinic from public.treatment_plan_payment_records where id=(v_row->>'payment_id')::uuid;
    else
      select clinic_id into v_clinic from public.payment_records where id=(v_row->>'payment_id')::uuid;
    end if;
  end if;
  -- Only service-only functions set verified actor context. Direct legacy writes remain unknown.
  v_actor:=nullif(current_setting('pos.audit_actor',true),'')::jsonb;
  v_actor_id:=nullif(v_actor->>'actor_id','')::uuid;
  insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_reference,actor_verified,reason,old_data,new_data)
    values(v_clinic,TG_OP,TG_TABLE_NAME,v_entity,v_actor_id,coalesce(v_actor->>'actor_role','unknown'),
      v_actor->>'actor_reference',coalesce((v_actor->>'verified')::boolean,false),coalesce(v_actor->>'reason',v_row->>'reason'),v_old,v_new);
  return case when TG_OP='DELETE' then OLD else NEW end;
end;
$$;
revoke all on function pos_private.capture_activity() from public,anon,authenticated,service_role;
DO $$
declare t text;
begin
  foreach t in array array['patients','clinic_patient_files','patient_notes','receipts','receipt_items','treatment_plans','treatment_plan_visits',
    'treatment_plan_payments','treatment_plan_payment_records','treatment_plan_payment_allocations','payment_records','payment_allocations',
    'refunds','refund_items','payment_allocation_refunds','outstanding_balances','balance_payments','patient_credits','clinic_correction_approvers'] loop
    if to_regclass(format('public.%I',t)) is not null then
      execute format('create trigger pos_activity_capture after insert or update or delete on public.%I for each row execute function pos_private.capture_activity()',t);
    end if;
  end loop;
end;
$$;

create function public.save_clinic_correction_approvers(p_clinic_id uuid,p_settings jsonb,p_expected_updated_at timestamptz,p_actor jsonb,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old public.clinic_correction_approvers%rowtype; v_saved public.clinic_correction_approvers%rowtype; v_staff uuid;
begin
  if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Reason is required' using errcode='22023'; end if;
  perform 1 from public.clinics where id=p_clinic_id for update;
  if not found then raise exception 'Clinic not found' using errcode='22023'; end if;
  select * into v_old from public.clinic_correction_approvers where clinic_id=p_clinic_id;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'Settings changed; refresh first' using errcode='23505'; end if;
  if p_settings->>'primary_approver_id' is null then raise exception 'Primary approver required' using errcode='22023'; end if;
  foreach v_staff in array array[(p_settings->>'primary_approver_id')::uuid,(p_settings->>'backup_approver_id')::uuid,(p_settings->>'temporary_approver_id')::uuid] loop
    if v_staff is not null and not exists(select 1 from public.receptionist where id=v_staff) then
      raise exception 'Staff account not found' using errcode='22023'; end if;
  end loop;
  perform pg_catalog.set_config('pos.audit_actor',(p_actor||jsonb_build_object('reason',trim(p_reason)))::text,true);
  insert into public.clinic_correction_approvers(clinic_id,primary_approver_id,backup_approver_id,temporary_approver_id,temporary_start,temporary_end)
    values(p_clinic_id,(p_settings->>'primary_approver_id')::uuid,(p_settings->>'backup_approver_id')::uuid,(p_settings->>'temporary_approver_id')::uuid,
      (p_settings->>'temporary_start')::date,(p_settings->>'temporary_end')::date)
    on conflict(clinic_id) do update set primary_approver_id=excluded.primary_approver_id,backup_approver_id=excluded.backup_approver_id,
      temporary_approver_id=excluded.temporary_approver_id,temporary_start=excluded.temporary_start,temporary_end=excluded.temporary_end,updated_at=clock_timestamp()
    returning * into v_saved;
  return to_jsonb(v_saved);
end;
$$;
revoke all on function public.save_clinic_correction_approvers(uuid,jsonb,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_clinic_correction_approvers(uuid,jsonb,timestamptz,jsonb,text) to service_role;

-- Login history must now use fixed server operations.
alter table public.login_logs enable row level security;
revoke all on public.login_logs from public,anon,authenticated;
grant select,insert on public.login_logs to service_role;
DO $$ declare p record; begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='login_logs' loop
  execute format('drop policy %I on public.login_logs',p.policyname);
 end loop;
end $$;
