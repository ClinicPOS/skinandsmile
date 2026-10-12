-- Expanded VOID is version-gated so an older application keeps its old financial/report contract.
-- Voids are accounting cancellation, NEVER a payment-provider refund.
begin;
-- Abort the whole migration if any existing financial/clinical row changes.
create temporary table pos_void_preservation(table_name text,projection text,row_count bigint,fingerprint text) on commit drop;
do $preserve$ declare item text;fields text;n bigint;h text;begin
 foreach item in array array['receipts','receipt_items','payment_records','payment_allocations','refunds','refund_items','payment_allocation_refunds','outstanding_balances','balance_payments','patient_credits','treatment_plans','treatment_plan_visits','treatment_plan_payment_records','treatment_plan_payments','treatment_plan_payment_allocations','receipt_refund_requests','pos_checkout_requests','pos_plan_payment_requests'] loop
  select string_agg(format('%I',attname),',' order by attnum) into fields from pg_attribute where attrelid=format('public.%I',item)::regclass and attnum>0 and not attisdropped;
  execute format('select count(*),md5(coalesce(string_agg(row_to_json(original)::text,chr(10) order by original.id),'''')) from (select %s from public.%I) original',fields,item) into n,h;
  insert into pos_void_preservation values(item,fields,n,h);
 end loop;
end;$preserve$;
alter table public.balance_payments add column status text not null default 'completed' check(status in ('completed','cancelled'));
alter table public.patient_credits add column status text not null default 'completed' check(status in ('completed','cancelled'));
alter table public.treatment_plan_payments add column status text not null default 'completed' check(status in ('completed','cancelled'));
-- Exact financial links only. A shared plan_id is NOT a payment-to-receipt link.
alter table public.treatment_plan_payment_records add column receipt_id uuid references public.receipts(id) on delete restrict;
alter table public.treatment_plan_payments add column if not exists visit_id uuid references public.treatment_plan_visits(id) on delete restrict;
alter table public.treatment_plan_payments add column receipt_id uuid references public.receipts(id) on delete restrict;
alter table public.refunds add column accounting_void_request_id uuid references public.receipt_refund_requests(id) on delete restrict;
alter table public.payment_allocation_refunds add column accounting_void_request_id uuid references public.receipt_refund_requests(id) on delete restrict;
alter table public.receipt_refund_requests alter column receipt_id drop not null;
alter table public.receipt_refund_requests add column plan_payment_id uuid references public.treatment_plan_payment_records(id) on delete restrict;
alter table public.receipt_refund_requests add constraint refund_request_target check (
 (receipt_id is not null and plan_payment_id is null) or (receipt_id is null and plan_payment_id is not null and kind='VOID'));
create unique index receipt_plan_payment_one_open on public.receipt_refund_requests(plan_payment_id) where status in ('PENDING','APPROVED');
create index if not exists pos_void_credits_receipt on public.patient_credits(receipt_id);
create index if not exists pos_void_plan_records_receipt on public.treatment_plan_payment_records(receipt_id);
create index if not exists pos_void_plan_payments_receipt on public.treatment_plan_payments(receipt_id);
create index if not exists pos_void_visits_receipt on public.treatment_plan_visits(receipt_id);

create table public.pos_void_audits (
 request_id uuid primary key references public.receipt_refund_requests(id) on delete restrict,
 target_id uuid not null unique, clinic_id uuid not null references public.clinics(id),
 requested_by uuid not null references public.receptionist(id), approved_by uuid not null references public.pos_accounts(id),
 reason text not null, requested_at timestamptz not null, approved_at timestamptz not null default now(),
 original_values jsonb not null, reversal_summary jsonb not null
);
alter table public.pos_void_audits enable row level security;
revoke all on public.pos_void_audits from public,anon,authenticated,service_role;
grant select,insert on public.pos_void_audits to service_role;
grant update on public.pos_plan_payment_requests to service_role;
create trigger pos_void_audit_immutable before update or delete on public.pos_void_audits for each row execute function pos_private.prevent_activity_changes();
create trigger pos_activity_capture after insert on public.pos_void_audits for each row execute function pos_private.capture_activity();

create function public.pos_void_snapshot(p_target_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 with legacy_links as (
  select id,source_payment_record_id from public.treatment_plan_payments where receipt_id=p_target_id or visit_id in(select id from public.treatment_plan_visits where receipt_id=p_target_id)
 ), target_plans as (
  select id from public.treatment_plan_payment_records where (id=p_target_id and not exists(select 1 from public.receipts where id=p_target_id)) or receipt_id=p_target_id
  or id in(select source_payment_record_id from legacy_links) or legacy_treatment_plan_payment_id in(select id from legacy_links)
 ), balances as (select id from public.outstanding_balances where receipt_id=p_target_id)
 select jsonb_build_object(
 'receipt',(select to_jsonb(r) from public.receipts r where id=p_target_id),
 'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.receipt_items i where receipt_id=p_target_id),
 'payments',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.payment_records i where receipt_id=p_target_id),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.payment_allocations i where payment_id in (select id from public.payment_records where receipt_id=p_target_id)),
 'refunds',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.refunds i where receipt_id=p_target_id),
 'refund_items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.refund_items i where refund_id in(select id from public.refunds where receipt_id=p_target_id)),
 'allocation_refunds',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.payment_allocation_refunds i where receipt_id=p_target_id),
 'balances',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.outstanding_balances i where id in(select id from balances)),
 'balance_payments',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.balance_payments i where outstanding_balance_id in(select id from balances)),
 'credits',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.patient_credits i where receipt_id=p_target_id),
 'plan_payments',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.treatment_plan_payment_records i where id in(select id from target_plans)),
 'plan_allocations',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.treatment_plan_payment_allocations i where payment_id in(select id from target_plans)),
 'plan_legacy_payments',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.treatment_plan_payments i where id in(select id from legacy_links) or source_payment_record_id in(select id from target_plans) or id in(select legacy_treatment_plan_payment_id from public.treatment_plan_payment_records where id in(select id from target_plans))),
 'clinical_links',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from public.treatment_plan_visits i where receipt_id=p_target_id)
 );
$$;
create function public.prepare_pos_void(p_target_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s jsonb; r jsonb; plan jsonb; total numeric; summary jsonb;
begin
 s:=public.pos_void_snapshot(p_target_id);r:=s->'receipt';plan:=s->'plan_payments'->0;
 if r='null'::jsonb and plan is null then raise exception 'Receipt or plan payment not found';end if;
 if r->>'status'='VOIDED' or r='null'::jsonb and plan->>'status'='cancelled' then raise exception 'This entry is already voided';end if;
 total:=coalesce((r->>'total')::numeric,(plan->>'total_customer_charged_amount')::numeric,0);
 summary:=jsonb_build_object(
  'recordedCollections',coalesce((select sum((v->>'total_customer_charged_amount')::numeric) from jsonb_array_elements((s->'payments')||(s->'plan_payments')) v where v->>'status'<>'cancelled'),0),
  'recordedFees',coalesce((r->>'gateway_fee')::numeric,0)+coalesce((select sum((v->>'total_payment_fee_amount')::numeric) from jsonb_array_elements(s->'plan_payments') v where v->>'status'<>'cancelled'),0),
  'completedRefunds',coalesce((select sum((v->>'total_amount')::numeric) from jsonb_array_elements(s->'refunds') v where v->>'accounting_void_request_id' is null),0),
  'creditToRestore',coalesce((select -sum((v->>'amount')::numeric) from jsonb_array_elements(s->'credits') v where v->>'status'='completed' and (v->>'amount')::numeric<0),0),
  'creditToCancel',coalesce((select sum((v->>'amount')::numeric) from jsonb_array_elements(s->'credits') v where v->>'status'='completed' and (v->>'amount')::numeric>0),0),
  'laterBalanceCollections',coalesce((select sum((v->>'amount')::numeric) from jsonb_array_elements(s->'balance_payments') v where v->>'status'='completed'),0),
  'planPaymentCount',jsonb_array_length(s->'plan_payments'),
  'clinicalVisitsPreserved',jsonb_array_length(s->'clinical_links'),
  'moneyMovement','None. Actual money and previous refunds require separate reconciliation.');
 return jsonb_build_object('kind','VOID','workflow_version',2,'total',total,'invoice',total,'fingerprint',md5(s::text),
 'method','Cancel mistaken POS entry; no money movement','reconciliation',summary,
 'items',jsonb_build_array(jsonb_build_object('service_name',case when r='null'::jsonb then 'Treatment plan payment' else 'Whole receipt' end,'refunded_invoice_amount',total)));
end;$$;
revoke all on function public.pos_void_snapshot(uuid),public.prepare_pos_void(uuid) from public,anon,authenticated;
grant execute on function public.pos_void_snapshot(uuid),public.prepare_pos_void(uuid) to service_role;

alter function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) rename to transition_receipt_refund_v3;
revoke all on function public.transition_receipt_refund_v3(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
create function public.transition_receipt_refund(p_id uuid,p_receipt_id uuid,p_action text,p_proposal jsonb,p_actor jsonb,p_reason text,p_reference text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 q public.receipt_refund_requests%rowtype; r public.receipts%rowtype;
 plan public.treatment_plan_payment_records%rowtype; account public.pos_accounts%rowtype;
 actor uuid:=(p_actor->>'actor_id')::uuid; clinic uuid; patient uuid; plan_id uuid; rec uuid;
 linked_plan_ids uuid[];linked_legacy_ids uuid[];s jsonb; prepared jsonb; today date:=(now() at time zone 'Asia/Dubai')::date;
begin
 select * into q from public.receipt_refund_requests where id=p_id;
 if coalesce(q.kind,p_proposal->>'kind','REFUND')<>'VOID' then
  return public.transition_receipt_refund_v3(p_id,p_receipt_id,p_action,p_proposal,p_actor,p_reason,p_reference);
 end if;
 -- Only the matching server application opts into the expanded financial contract.
 -- Browser input cannot set this field; the server adds it after session checks.
 if p_actor->>'void_workflow_version' is distinct from '2' then
  if q.proposal->>'workflow_version'='2' then raise exception 'Use the updated POS app to review this void request.';end if;
  return public.transition_receipt_refund_v3(p_id,p_receipt_id,p_action,p_proposal,p_actor,p_reason,p_reference);
 end if;
 if not coalesce((p_actor->>'verified')::boolean,false) or actor is null then raise exception 'Verified identity required' using errcode='42501';end if;
 -- Lock the patient's credit owner before the receipt, matching checkout's lock order.
 select * into r from public.receipts where id=p_receipt_id;
 if found then clinic:=r.clinic_id;patient:=r.patient_id;plan_id:=r.treatment_plan_id;
 else select * into plan from public.treatment_plan_payment_records where id=p_receipt_id;
  if not found then raise exception 'Entry not found';end if;
  clinic:=plan.clinic_id;patient:=plan.patient_id;plan_id:=plan.treatment_plan_id;
 end if;
 if clinic is null then select clinic_id into clinic from public.receptionist where id=r.receptionist_id;end if;
 select coalesce(array_agg(id),'{}') into linked_plan_ids from public.treatment_plan_payment_records where (r.id is null and id=p_receipt_id) or receipt_id=p_receipt_id
 or id in(select source_payment_record_id from public.treatment_plan_payments where visit_id in(select id from public.treatment_plan_visits where receipt_id=p_receipt_id) or receipt_id=p_receipt_id)
 or legacy_treatment_plan_payment_id in(select id from public.treatment_plan_payments where visit_id in(select id from public.treatment_plan_visits where receipt_id=p_receipt_id) or receipt_id=p_receipt_id);
 select coalesce(array_agg(id),'{}') into linked_legacy_ids from public.treatment_plan_payments where receipt_id=p_receipt_id or visit_id in(select id from public.treatment_plan_visits where receipt_id=p_receipt_id)
 or source_payment_record_id=any(linked_plan_ids) or id in(select legacy_treatment_plan_payment_id from public.treatment_plan_payment_records where id=any(linked_plan_ids));
 perform 1 from public.clinic_patient_files where patient_id=patient and clinic_id=clinic for update;
 -- Plan payment inserts take a plan lock. Never cancel every payment on that plan.
 perform 1 from public.treatment_plans where id in(
  select plan_id union select treatment_plan_id from public.treatment_plan_payment_records where id=any(linked_plan_ids)
 ) order by id for update;
 if r.id is not null then select * into r from public.receipts where id=p_receipt_id for update;
 else select * into plan from public.treatment_plan_payment_records where id=p_receipt_id for update;end if;
 select * into q from public.receipt_refund_requests where id=p_id for update;
 if p_action in ('request','cancel') then
  if p_actor->>'actor_role' is distinct from 'receptionist' or not exists(select 1 from public.receptionist where id=actor and clinic_id=clinic) then raise exception 'Requesting clinic receptionist required' using errcode='42501';end if;
 elsif p_action in ('approve','reject') then
  select * into account from public.pos_accounts where id=actor and enabled for share;
  if not found or account.role not in('owner','clinic_manager') or p_actor->>'actor_role' is distinct from account.role then raise exception 'Individual approver required' using errcode='42501';end if;
  perform 1 from public.pos_manager_access where account_id=actor and clinic_id=clinic and 'correction_approval'=any(permissions) and (starts_on is null or starts_on<=today) and (ends_on is null or ends_on>=today) for share;
  if account.role<>'owner' and not found then raise exception 'Approval access is not assigned' using errcode='42501';end if;
 else raise exception 'Void completes on manager approval; it cannot be executed as a refund';end if;
 perform set_config('pos.audit_actor',(p_actor||jsonb_build_object('reason',p_reason))::text,true);
 if p_action='request' then
  if q.id is not null then
   if coalesce(q.receipt_id,q.plan_payment_id) is distinct from p_receipt_id or q.requested_by<>actor or q.requested_reason is distinct from p_reason or q.proposal->>'originalInput' is distinct from p_proposal->>'originalInput' then raise exception 'Request ID already used';end if;
   return to_jsonb(q);
  end if;
  if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Void reason required';end if;
  prepared:=public.prepare_pos_void(p_receipt_id);
  if prepared->>'fingerprint' is distinct from p_proposal->>'fingerprint' then raise exception 'Financial records changed. Reload before requesting.';end if;
  if exists(select 1 from public.receipt_refund_requests where coalesce(receipt_id,plan_payment_id)=p_receipt_id and status in('PENDING','APPROVED')) then raise exception 'An open request already exists. Review or cancel it first.';end if;
  insert into public.receipt_refund_requests(id,receipt_id,plan_payment_id,clinic_id,requested_by,requested_reason,proposal,fingerprint,kind)
  values(p_id,r.id,case when r.id is null then plan.id end,clinic,actor,trim(p_reason),prepared||jsonb_build_object('originalInput',p_proposal->>'originalInput'),prepared->>'fingerprint','VOID') returning * into q;
  return to_jsonb(q);
 end if;
 if q.id is null or coalesce(q.receipt_id,q.plan_payment_id) is distinct from p_receipt_id then raise exception 'Request not found';end if;
 if p_action='approve' and q.status='COMPLETED' then
  if q.reviewed_by<>actor then raise exception 'Original approver required';end if;
  return to_jsonb(q);
 end if;
 if q.status<>'PENDING' then raise exception 'Request already closed';end if;
 if p_action='cancel' then
  if q.requested_by<>actor then raise exception 'Only the requesting receptionist can cancel' using errcode='42501';end if;
  update public.receipt_refund_requests set status='CANCELLED' where id=p_id returning * into q;return to_jsonb(q);
 elsif p_action='reject' then
  if length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Rejection reason required';end if;
  update public.receipt_refund_requests set status='REJECTED',reviewed_by=actor,reviewed_at=now(),review_reason=p_reason where id=p_id returning * into q;return to_jsonb(q);
 end if;
 if r.status='VOIDED' or r.id is null and plan.status='cancelled' then raise exception 'Entry already voided';end if;
 -- Serialize all dependent writers before taking the immutable before-image.
 perform 1 from public.payment_records where receipt_id=p_receipt_id order by id for update;
 perform 1 from public.payment_allocations where payment_id in(select id from public.payment_records where receipt_id=p_receipt_id) order by id for update;
 perform 1 from public.outstanding_balances where receipt_id=p_receipt_id order by id for update;
 perform 1 from public.balance_payments where outstanding_balance_id in(select id from public.outstanding_balances where receipt_id=p_receipt_id) order by id for update;
 perform 1 from public.patient_credits where receipt_id=p_receipt_id order by id for update;
 perform 1 from public.refunds where receipt_id=p_receipt_id order by id for update;
 perform 1 from public.payment_allocation_refunds where receipt_id=p_receipt_id order by id for update;
 perform 1 from public.treatment_plan_payment_records where id=any(linked_plan_ids) order by id for update;
 perform 1 from public.treatment_plan_payment_allocations where payment_id in(select id from public.treatment_plan_payment_records where id=any(linked_plan_ids)) order by id for update;
 perform 1 from public.treatment_plan_payments where id=any(linked_legacy_ids) order by id for update;
 s:=public.pos_void_snapshot(p_receipt_id);
 if md5(s::text) is distinct from q.fingerprint then raise exception 'Financial records changed. Cancel and request again.';end if;
 -- Credit can be spent on other receipts. Never silently overdraw that ledger.
 if coalesce((select sum(amount) from public.patient_credits where patient_id=patient and clinic_id=clinic and status='completed' and receipt_id is distinct from p_receipt_id),0)<0 then
  raise exception 'Receipt-generated credit has already been spent. Reconcile that credit before approval.';
 end if;
 -- Refuse ambiguous/malformed cross-clinic links rather than reversing somebody else's money.
 if r.id is not null and coalesce(r.credit_applied,0)<>coalesce((select -sum(amount) from public.patient_credits where receipt_id=r.id and status='completed' and amount<0),0) then
  raise exception 'Applied credit does not match its ledger. Reconcile the original credit before approval.';
 end if;
 if exists(select 1 from jsonb_array_elements(s->'plan_legacy_payments') v where (v->>'clinic_id')::uuid is distinct from clinic or (v->>'patient_id')::uuid is distinct from patient)
 or exists(select 1 from public.payment_records where receipt_id=p_receipt_id and clinic_id is distinct from clinic)
 or exists(select 1 from public.outstanding_balances where receipt_id=p_receipt_id and (clinic_id is distinct from clinic or patient_id is distinct from patient))
 or exists(select 1 from public.treatment_plan_payments where id=any(linked_legacy_ids) and (clinic_id is distinct from clinic or patient_id is distinct from patient))
 or exists(select 1 from public.treatment_plan_payment_records where id=any(linked_plan_ids) and (clinic_id is distinct from clinic or patient_id is distinct from patient))
 or exists(select 1 from public.patient_credits where receipt_id=p_receipt_id and (clinic_id is distinct from clinic or patient_id is distinct from patient)) then raise exception 'Financial links do not match the receipt patient and clinic';end if;
 insert into public.pos_void_audits(request_id,target_id,clinic_id,requested_by,approved_by,reason,requested_at,original_values,reversal_summary)
 values(p_id,p_receipt_id,clinic,q.requested_by,actor,q.requested_reason,q.created_at,s,q.proposal->'reconciliation');
 update public.payment_records set status='cancelled',updated_at=now() where receipt_id=p_receipt_id;
 update public.payment_allocations set status='voided',updated_at=now() where payment_id in(select id from public.payment_records where receipt_id=p_receipt_id);
 update public.balance_payments set status='cancelled' where outstanding_balance_id in(select id from public.outstanding_balances where receipt_id=p_receipt_id);
 update public.outstanding_balances set cancelled_original_amount=coalesce(cancelled_original_amount,original_amount),original_amount=0 where receipt_id=p_receipt_id;
 -- Excluding the original debit restores credit once; no new cash deposit is invented.
 update public.patient_credits set status='cancelled' where receipt_id=p_receipt_id;
 -- Keep actual refund identities, amounts and return references forever. Cancel only their accounting contribution.
 update public.refunds set accounting_void_request_id=p_id where receipt_id=p_receipt_id;
 update public.payment_allocation_refunds set accounting_void_request_id=p_id where receipt_id=p_receipt_id;
 update public.treatment_plan_payment_records set status='cancelled',updated_at=now() where id=any(linked_plan_ids);
 update public.treatment_plan_payment_allocations set status='voided',updated_at=now() where payment_id in(select id from public.treatment_plan_payment_records where id=any(linked_plan_ids));
 update public.treatment_plan_payments set status='cancelled' where id=any(linked_legacy_ids);
 update public.pos_plan_payment_requests set result=result||jsonb_build_object('status','cancelled','void_request_id',p_id)
 where result->>'payment_record_id' in(select id::text from public.treatment_plan_payment_records where id=any(linked_plan_ids));
 if r.id is not null then
  update public.receipts set status='VOIDED',void_reason=q.requested_reason,voided_by=actor,voided_at=now() where id=r.id returning * into r;
  update public.pos_checkout_requests set result=jsonb_set(result,'{receipt}',to_jsonb(r))||jsonb_build_object(
   'balance',(select to_jsonb(b) from public.outstanding_balances b where b.receipt_id=r.id limit 1),
   'credit',(select to_jsonb(c) from public.patient_credits c where c.receipt_id=r.id limit 1)) where id=r.id;
 end if;
 update public.receipt_refund_requests set status='COMPLETED',reviewed_by=actor,reviewed_at=now(),review_reason=nullif(p_reason,''),completed_at=now() where id=p_id returning * into q;
 return to_jsonb(q);
end;$$;
revoke all on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) to service_role;

-- Prevent any later writer attaching new financial effects to a voided receipt.
create function pos_private.guard_void_financial_link() returns trigger language plpgsql security invoker set search_path='' as $$
declare target uuid; parent uuid; current_status text;
begin
 target:=new.receipt_id;
 if target is not null then
  select status into current_status from public.receipts where id=target for share;
  if current_status='VOIDED' then raise exception 'Voided receipts cannot accept new financial records';end if;
 end if;
 return new;
end;$$;
do $$declare t text;begin foreach t in array array['payment_records','patient_credits','outstanding_balances','refunds','payment_allocation_refunds','treatment_plan_payment_records','treatment_plan_payments'] loop
 execute format('create trigger guard_void_financial_link before insert or update of receipt_id on public.%I for each row execute function pos_private.guard_void_financial_link()',t);
end loop;end;$$;
revoke all on function pos_private.guard_void_financial_link() from public,anon,authenticated;
grant usage on schema pos_private to service_role;
grant execute on function pos_private.guard_void_financial_link() to service_role;

-- Keep existing checkout/balance/plan contracts, but count only active ledger rows.
-- Editing their stored definitions also preserves later patches and grants.
do $$declare fn record; definition text;begin
 for fn in select oid from pg_proc where pronamespace='public'::regnamespace and proname in('complete_pos_checkout','complete_pos_checkout_before_register_lock','record_balance_payment','record_protected_plan_payment') loop
  definition:=pg_get_functiondef(fn.oid);
  definition:=replace(definition,'from public.patient_credits where patient_id=', 'from public.patient_credits where status=''completed'' and patient_id=');
  definition:=replace(definition,'from public.balance_payments where outstanding_balance_id=', 'from public.balance_payments where status=''completed'' and outstanding_balance_id=');
  definition:=replace(definition,'from public.treatment_plan_payments where treatment_plan_id=', 'from public.treatment_plan_payments where status=''completed'' and treatment_plan_id=');
  execute definition;
 end loop;
end;$$;
do $verify$ declare item record;n bigint;h text;begin
 for item in select * from pos_void_preservation loop
  execute format('select count(*),md5(coalesce(string_agg(row_to_json(original)::text,chr(10) order by original.id),'''')) from (select %s from public.%I) original',item.projection,item.table_name) into n,h;
  if n<>item.row_count or h<>item.fingerprint then raise exception 'Original records changed in %, aborting VOID migration',item.table_name;end if;
 end loop;
end;$verify$;
commit;
