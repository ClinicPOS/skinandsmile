begin;

create temporary table duplicate_void_preservation(table_name text, projection text, n bigint, hash text) on commit drop;
do $audit$ declare t record; fields text; count_rows bigint; fingerprint text; begin
 for t in select c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') loop
  select string_agg(format('%I',attname),',' order by attnum) into fields from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped;
  execute format('select count(*),md5(coalesce(string_agg(row_to_json(original)::text,chr(10) order by row_to_json(original)::text),'''')) from (select %s from public.%I) original',fields,t.relname) into count_rows,fingerprint;
  insert into duplicate_void_preservation values(t.relname,fields,count_rows,fingerprint);
 end loop;
end;$audit$;
alter table public.treatment_plans add column duplicate_of_plan_id uuid references public.treatment_plans(id) on delete restrict;
alter table public.treatment_plans add constraint duplicate_plan_other_plan check(duplicate_of_plan_id is null or duplicate_of_plan_id<>id);
-- Only definitions and a new private audit table are installed here.
-- No existing payment, plan or clinical record is updated by this migration.
create function public.duplicate_plan_void_snapshot(p_plan_id uuid,p_keep_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'duplicatePlan',(select to_jsonb(t) from public.treatment_plans t where id=p_plan_id),
 'keptPlan',(select to_jsonb(t) from public.treatment_plans t where id=p_keep_id),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.treatment_plan_payment_records p where treatment_plan_id in(p_plan_id,p_keep_id)),
 'legacyPayments',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.treatment_plan_payments p where treatment_plan_id in(p_plan_id,p_keep_id)),
 'visits',(select coalesce(jsonb_agg(to_jsonb(v) order by id),'[]') from public.treatment_plan_visits v where treatment_plan_id in(p_plan_id,p_keep_id)));
$$;
create function public.prepare_duplicate_plan_void(p_payment_id uuid,p_keep_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare pay public.treatment_plan_payment_records%rowtype; wrong public.treatment_plans%rowtype; kept public.treatment_plans%rowtype; s jsonb; visits integer;
begin
 select * into pay from public.treatment_plan_payment_records where id=p_payment_id;
 if not found or pay.status<>'completed' or pay.receipt_id is not null then raise exception 'Select an active standalone plan payment. Linked receipts need receipt review.';end if;
 select * into wrong from public.treatment_plans where id=pay.treatment_plan_id;
 select * into kept from public.treatment_plans where id=p_keep_id;
 if kept.id is null or wrong.id=kept.id or kept.patient_id<>wrong.patient_id or kept.clinic_id<>wrong.clinic_id
 or wrong.status<>'Active' or kept.status<>'Active' or wrong.title<>kept.title or wrong.total_amount<>kept.total_amount or wrong.planned_visits<>kept.planned_visits
 or coalesce(wrong.is_legacy,false) or coalesce(kept.is_legacy,false) or coalesce(wrong.historical_amount_paid,0)<>0
 or wrong.source_imported_visit_id is not null then raise exception 'The retained plan must be the same active treatment for this patient and clinic. Other cases need owner review.';end if;
 if (wrong.created_at at time zone 'Asia/Dubai')::date<>(kept.created_at at time zone 'Asia/Dubai')::date
 or (wrong.created_at at time zone 'Asia/Dubai')::date<>(pay.created_at at time zone 'Asia/Dubai')::date then raise exception 'These are not duplicate plans created on the same day. Owner review required.';end if;
 if exists(select 1 from public.treatment_plan_payment_records where treatment_plan_id=wrong.id and id<>pay.id and status<>'cancelled')
 or exists(select 1 from public.treatment_plan_payments where treatment_plan_id=wrong.id and status<>'cancelled' and source_payment_record_id is distinct from pay.id and id is distinct from pay.legacy_treatment_plan_payment_id)
 or exists(select 1 from public.receipts where treatment_plan_id=wrong.id)
 or not exists(select 1 from public.treatment_plan_payment_records where treatment_plan_id=kept.id and status='completed' and total_invoice_amount_settled=pay.total_invoice_amount_settled)
 then raise exception 'The duplicate has other transactions or the retained payment cannot be verified. Owner review required.';end if;
 select count(*) into visits from public.treatment_plan_visits where treatment_plan_id=wrong.id;
 if visits>1 or exists(select 1 from public.treatment_plan_visits where treatment_plan_id=wrong.id and (receipt_id is not null or (created_at at time zone 'Asia/Dubai')::date<>(wrong.created_at at time zone 'Asia/Dubai')::date)) then raise exception 'This plan has additional clinical activity. Owner review required; no records changed.';end if;
 s:=public.duplicate_plan_void_snapshot(wrong.id,kept.id);
 return public.prepare_pos_void(pay.id)||jsonb_build_object('duplicatePlan',jsonb_build_object('planId',wrong.id,'keepPlanId',kept.id,'title',wrong.title,'fingerprint',md5(s::text),'preservedVisits',visits));
end;$$;

create table public.duplicate_plan_void_audits(
 request_id uuid primary key references public.receipt_refund_requests(id) on delete restrict,
 clinic_id uuid not null references public.clinics(id), cancelled_plan_id uuid not null unique references public.treatment_plans(id) on delete restrict,
 kept_plan_id uuid not null references public.treatment_plans(id) on delete restrict,
 approved_by uuid not null references public.pos_accounts(id), reason text not null, approved_at timestamptz not null default now(), original_values jsonb not null
);
alter table public.duplicate_plan_void_audits enable row level security;
revoke all on public.duplicate_plan_void_audits from public,anon,authenticated,service_role;
grant select,insert on public.duplicate_plan_void_audits to service_role;
create trigger duplicate_plan_void_audit_immutable before update or delete on public.duplicate_plan_void_audits for each row execute function pos_private.prevent_activity_changes();
create trigger pos_activity_capture after insert on public.duplicate_plan_void_audits for each row execute function pos_private.capture_activity();

alter function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) rename to transition_before_duplicate_plan_void;
revoke all on function public.transition_before_duplicate_plan_void(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
create function public.transition_receipt_refund(p_id uuid,p_receipt_id uuid,p_action text,p_proposal jsonb,p_actor jsonb,p_reason text,p_reference text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare q public.receipt_refund_requests%rowtype; pay public.treatment_plan_payment_records%rowtype; extra jsonb; prepared jsonb; result jsonb; original jsonb; keep_id uuid; actor uuid:=(p_actor->>'actor_id')::uuid;
begin
 select * into q from public.receipt_refund_requests where id=p_id;
 extra:=case when p_action='request' then p_proposal->'duplicatePlan' else q.proposal->'duplicatePlan' end;
 if extra is null then return public.transition_before_duplicate_plan_void(p_id,p_receipt_id,p_action,p_proposal,p_actor,p_reason,p_reference);end if;
 if coalesce(p_proposal->>'kind',q.kind)<>'VOID' or coalesce((p_actor->>'duplicate_plan_workflow_version')::integer,0)<>1 then raise exception 'Reload the updated duplicate-plan review screen.';end if;
 -- Older code cannot approve a duplicate-plan cancellation without its explicit review.
 if p_action='approve' and not coalesce((p_actor->>'confirm_duplicate_plan')::boolean,false) then raise exception 'Confirm that the retained plan is correct and the cancelled plan/visit is a duplicate.';end if;
 if p_action in('request','approve') and q.status is distinct from 'COMPLETED' then
  select * into pay from public.treatment_plan_payment_records where id=p_receipt_id;
  if not found then raise exception 'Plan payment not found';end if;
  keep_id:=(extra->>'keepPlanId')::uuid;
  -- Match the existing financial writer lock order: patient file, then plans.
  perform 1 from public.clinic_patient_files where patient_id=pay.patient_id and clinic_id=pay.clinic_id for update;
  perform 1 from public.treatment_plans where id in(pay.treatment_plan_id,keep_id) order by id for update;
  prepared:=public.prepare_duplicate_plan_void(pay.id,keep_id);
  if prepared->'duplicatePlan'->>'fingerprint' is distinct from extra->>'fingerprint' then raise exception 'Plan activity changed. Cancel this request and request again.';end if;
  original:=public.duplicate_plan_void_snapshot(pay.treatment_plan_id,keep_id);
 end if;
 result:=public.transition_before_duplicate_plan_void(p_id,p_receipt_id,p_action,p_proposal,p_actor,p_reason,p_reference);
 if p_action='request' then
  if q.id is null then update public.receipt_refund_requests set proposal=proposal||jsonb_build_object('duplicatePlan',prepared->'duplicatePlan') where id=p_id returning to_jsonb(receipt_refund_requests.*) into result;end if;
 elsif p_action='approve' and q.status is distinct from 'COMPLETED' then
  -- The payment reversal and duplicate-plan cancellation are one transaction.
  update public.treatment_plans set status='Cancelled',duplicate_of_plan_id=keep_id,cancelled_at=now(),cancelled_by=actor,cancellation_reason='Duplicate plan: '||q.requested_reason where id=pay.treatment_plan_id;
  insert into public.duplicate_plan_void_audits(request_id,clinic_id,cancelled_plan_id,kept_plan_id,approved_by,reason,original_values)
  values(p_id,pay.clinic_id,pay.treatment_plan_id,keep_id,actor,q.requested_reason,original);
 end if;
 return result;
end;$$;
revoke all on function public.duplicate_plan_void_snapshot(uuid,uuid),public.prepare_duplicate_plan_void(uuid,uuid),public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.duplicate_plan_void_snapshot(uuid,uuid),public.prepare_duplicate_plan_void(uuid,uuid),public.transition_before_duplicate_plan_void(uuid,uuid,text,jsonb,jsonb,text,text),public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) to service_role;
do $audit$ declare t record; count_rows bigint; fingerprint text; begin
 for t in select * from duplicate_void_preservation loop
  execute format('select count(*),md5(coalesce(string_agg(row_to_json(original)::text,chr(10) order by row_to_json(original)::text),'''')) from (select %s from public.%I) original',t.projection,t.table_name) into count_rows,fingerprint;
  if count_rows<>t.n or fingerprint<>t.hash then raise exception 'Original records changed in %; migration rolled back',t.table_name;end if;
 end loop;
 raise notice 'PASS: all original public table records preserved exactly';
end;$audit$;

commit;
