-- LOCAL TEST ONLY. Additive server-only operation; public financial access still requires migration.
create or replace function public.record_treatment_plan_visit(
  p_visit_id uuid, p_plan_id uuid, p_clinic_id uuid,
  p_doctor_id uuid, p_receptionist_id uuid, p_notes text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.treatment_plans%rowtype;
  v_visit public.treatment_plan_visits%rowtype;
  v_count integer;
  v_max integer;
  v_replayed boolean := false;
begin
  perform pg_catalog.set_config('pos.audit_actor',jsonb_build_object('actor_id',p_receptionist_id,'actor_role','staff','verified',p_receptionist_id is not null)::text,true);
  if p_visit_id is null or p_plan_id is null or p_clinic_id is null or length(coalesce(p_notes,'')) > 4000 then
    raise exception 'Invalid visit input' using errcode = '22023';
  end if;
  select * into v_plan from public.treatment_plans where id = p_plan_id for update;
  if not found then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  if v_plan.clinic_id <> p_clinic_id then raise exception 'Clinic mismatch' using errcode = '42501'; end if;
  if not exists (select 1 from public.clinic_patient_files where patient_id=v_plan.patient_id and clinic_id=p_clinic_id) then
    raise exception 'Patient is not linked to clinic' using errcode = '42501';
  end if;
  if p_receptionist_id is not null and not exists (select 1 from public.receptionist where id=p_receptionist_id and clinic_id=p_clinic_id) then
    raise exception 'Receptionist is not in clinic' using errcode = '42501';
  end if;
  select * into v_visit from public.treatment_plan_visits where id=p_visit_id;
  if found then
    if v_visit.treatment_plan_id <> p_plan_id or v_visit.doctor_id is distinct from p_doctor_id
      or v_visit.receptionist_id is distinct from p_receptionist_id or v_visit.notes is distinct from p_notes then
      raise exception 'Request ID already used for another visit' using errcode = '23505';
    end if;
    v_replayed := true;
  else
    if p_doctor_id is not null and not exists (select 1 from public.doctors where id=p_doctor_id and clinic_id=p_clinic_id and is_active=true) then
      raise exception 'Doctor is not active in clinic' using errcode = '42501';
    end if;
    if v_plan.status <> 'Active' then raise exception 'Plan is not active' using errcode = '23514'; end if;
    select greatest(count(*)::integer, case when v_plan.clinic_patient_file_id is not null then 1 else 0 end),
      coalesce(max(visit_number),0) into v_count,v_max
      from public.treatment_plan_visits where treatment_plan_id=p_plan_id;
    if v_plan.planned_visits is not null and v_count >= v_plan.planned_visits then
      raise exception 'Visit limit reached' using errcode = '23514';
    end if;
    insert into public.treatment_plan_visits(id,treatment_plan_id,visit_number,doctor_id,receptionist_id,notes)
      values(p_visit_id,p_plan_id,greatest(v_count,v_max)+1,p_doctor_id,p_receptionist_id,p_notes) returning * into v_visit;
    v_count := v_count+1;
    if v_plan.planned_visits is not null and v_count >= v_plan.planned_visits then
      update public.treatment_plans set status='Completed',completed_at=now() where id=p_plan_id returning * into v_plan;
    end if;
  end if;
  select greatest(count(*)::integer, case when v_plan.clinic_patient_file_id is not null then 1 else 0 end)
    into v_count from public.treatment_plan_visits where treatment_plan_id=p_plan_id;
  return jsonb_build_object('visit',to_jsonb(v_visit),'plan',to_jsonb(v_plan),'completedVisits',v_count,
    'totalVisits',v_plan.planned_visits,'replayed',v_replayed);
end;
$$;
revoke all on function public.record_treatment_plan_visit(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_treatment_plan_visit(uuid,uuid,uuid,uuid,uuid,text) to service_role;
