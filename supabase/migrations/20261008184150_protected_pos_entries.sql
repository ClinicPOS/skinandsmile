create table public.pos_entry_requests(id uuid primary key,kind text not null,actor_id uuid not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table public.pos_entry_requests enable row level security;
revoke all on public.pos_entry_requests from public,anon,authenticated;
grant select,insert on public.pos_entry_requests to service_role;
create function public.create_protected_pos_entry(p_request_id uuid,p_kind text,p_clinic_id uuid,p_actor_id uuid,p_owner boolean,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_saved public.pos_entry_requests%rowtype;v_row jsonb;v_file uuid;v_reg uuid;v_plan public.treatment_plans%rowtype;v_i integer;v_count integer;
begin
 if p_request_id is null or p_kind not in ('plan','deposit','legacy_balance') then raise exception 'Unsupported entry';end if;
 perform pg_advisory_xact_lock(hashtextextended('pos-entry:'||p_request_id::text,0));
 if p_owner then perform 1 from public.pos_accounts where id=p_actor_id and enabled and role='owner';else perform 1 from public.receptionist where id=p_actor_id and clinic_id=p_clinic_id;end if;
 if not found then raise exception 'Actor clinic mismatch';end if;
 select * into v_saved from public.pos_entry_requests where id=p_request_id;
 if found then
  if v_saved.kind<>p_kind or v_saved.actor_id<>p_actor_id or v_saved.payload<>p_data||jsonb_build_object('clinic_id',p_clinic_id) then raise exception 'Request already used';end if;return v_saved.result;
 end if;
 select id into v_file from public.clinic_patient_files where patient_id=(p_data->>'patient_id')::uuid and clinic_id=p_clinic_id for share;
 if not found then raise exception 'Patient clinic mismatch';end if;
 if not p_owner then
  select id into v_reg from public.cash_register_sessions where receptionist_id=p_actor_id and closed_at is null for share;
  if not found then raise exception 'Open register required';end if;
 end if;
 if p_kind='plan' then
  if p_data->>'service_id' is not null and not exists(select 1 from public.services where id=(p_data->>'service_id')::uuid and (clinic_id=p_clinic_id or clinic_id is null) and is_active) then raise exception 'Service clinic mismatch';end if;
  insert into public.treatment_plans(id,patient_id,clinic_id,clinic_patient_file_id,service_id,title,total_amount,planned_visits,notes,payment_arrangement,is_legacy,historical_amount_paid,created_by,status)
  values(p_request_id,(p_data->>'patient_id')::uuid,p_clinic_id,v_file,(p_data->>'service_id')::uuid,p_data->>'title',(p_data->>'total_amount')::numeric,(p_data->>'planned_visits')::integer,p_data->>'notes',p_data->>'payment_arrangement',coalesce((p_data->>'is_legacy')::boolean,false),coalesce((p_data->>'historical_amount_paid')::numeric,0),case when p_owner then null else p_actor_id end,'Active') returning * into v_plan;
  v_count:=coalesce((p_data->>'historical_visits')::integer,0);
  for v_i in 1..v_count loop
   insert into public.treatment_plan_visits(treatment_plan_id,visit_number,visit_date,receptionist_id,notes) values(v_plan.id,v_i,coalesce((p_data->>'historical_visit_date')::date,current_date),case when p_owner then null else p_actor_id end,'Imported historical visit - doctor attribution unavailable');
  end loop;v_row:=to_jsonb(v_plan);
 elsif p_kind='deposit' then
  if p_owner then raise exception 'Receptionist register required';end if;
  if (p_data->>'register_session_id')::uuid is distinct from v_reg then raise exception 'Register mismatch';end if;
  insert into public.patient_credits(id,patient_id,patient_file_id,clinic_id,amount,payment_method,reason,expected_treatment_date,notes,receptionist_id,register_session_id)
  values(p_request_id,(p_data->>'patient_id')::uuid,v_file,p_clinic_id,(p_data->>'amount')::numeric,p_data->>'payment_method',p_data->>'reason',(p_data->>'expected_treatment_date')::date,p_data->>'notes',p_actor_id,v_reg) returning to_jsonb(patient_credits.*) into v_row;
 else
  if not p_owner then raise exception 'Owner required for old balance';end if;
  insert into public.outstanding_balances(id,patient_id,patient_file_id,clinic_id,original_date,original_amount,reason,reference_number)
  values(p_request_id,(p_data->>'patient_id')::uuid,v_file,p_clinic_id,(p_data->>'original_date')::date,(p_data->>'original_amount')::numeric,p_data->>'reason',p_data->>'reference_number') returning to_jsonb(outstanding_balances.*) into v_row;
 end if;
 insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_verified,reason,new_data) values(p_clinic_id,'CREATE_'||upper(p_kind),p_kind,p_request_id::text,p_actor_id,case when p_owner then 'owner' else 'receptionist' end,true,'Recorded POS entry',v_row);
 insert into public.pos_entry_requests(id,kind,actor_id,payload,result) values(p_request_id,p_kind,p_actor_id,p_data||jsonb_build_object('clinic_id',p_clinic_id),v_row);
 return v_row;
end;$$;
revoke all on function public.create_protected_pos_entry(uuid,text,uuid,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.create_protected_pos_entry(uuid,text,uuid,uuid,boolean,jsonb) to service_role;
revoke insert,update,delete on public.treatment_plans,public.treatment_plan_visits,public.patient_credits,public.outstanding_balances from public,anon,authenticated;
