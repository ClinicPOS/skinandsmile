-- Local only. Keep historical unattributed visits untouched; require doctor for new visits.
alter function public.record_treatment_plan_visit(uuid,uuid,uuid,uuid,uuid,text) rename to record_treatment_plan_visit_v1;
create function public.record_treatment_plan_visit(p_visit_id uuid,p_plan_id uuid,p_clinic_id uuid,p_doctor_id uuid,p_receptionist_id uuid,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_doctor_id is null and not exists(select 1 from public.treatment_plan_visits where id=p_visit_id) then
  raise exception 'Select the doctor who performed this visit' using errcode='22023';
 end if;
 return public.record_treatment_plan_visit_v1(p_visit_id,p_plan_id,p_clinic_id,p_doctor_id,p_receptionist_id,p_notes);
end; $$;
revoke all on function public.record_treatment_plan_visit(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.record_treatment_plan_visit_v1(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_treatment_plan_visit(uuid,uuid,uuid,uuid,uuid,text) to service_role;
