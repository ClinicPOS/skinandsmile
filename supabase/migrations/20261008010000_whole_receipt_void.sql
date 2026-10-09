-- Local-only: manager confirmation cancels mistaken entries, not actual money returned.
alter table public.receipt_refund_requests drop constraint receipt_refund_requests_kind_check;
alter table public.receipt_refund_requests add constraint receipt_refund_requests_kind_check check(kind in ('REFUND','CORRECTION','VOID'));
alter function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) rename to transition_receipt_refund_v2;
create function public.transition_receipt_refund(p_id uuid,p_receipt_id uuid,p_action text,p_proposal jsonb,p_actor jsonb,p_reason text,p_reference text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.receipt_refund_requests%rowtype; r public.receipts%rowtype; result jsonb;
begin
 select * into r from public.receipts where id=p_receipt_id for update;
 select * into q from public.receipt_refund_requests where id=p_id for update;
 if q.kind='VOID' and p_action='approve' and q.status='COMPLETED' then
  if not coalesce((p_actor->>'verified')::boolean,false) or (p_actor->>'actor_id')::uuid<>q.reviewed_by then raise exception 'Original approver required'; end if;
  return to_jsonb(q);
 end if;
 if p_proposal->>'kind'='VOID' or q.kind='VOID' and p_action='approve' then
  if r.status='VOIDED' or (r.created_at at time zone 'Asia/Dubai')::date<>(now() at time zone 'Asia/Dubai')::date then raise exception 'Only current-day receipts can be voided.'; end if;
  if r.treatment_plan_id is not null or coalesce(r.transaction_type,'regular')<>'regular' or exists(select 1 from public.treatment_plan_visits where receipt_id=r.id) then raise exception 'Treatment-plan receipts need separate clinical review.'; end if;
  if coalesce(r.credit_applied,0)<>0 or coalesce(r.gateway_fee,0)<>0 or exists(select 1 from public.refunds where receipt_id=r.id) then raise exception 'Credit, fee or refunded receipts need owner reconciliation.'; end if;
  perform 1 from public.payment_records where receipt_id=r.id for update;
  perform 1 from public.payment_allocations where payment_id in(select id from public.payment_records where receipt_id=r.id) for update;
  if exists(select 1 from public.payment_allocations a join public.payment_records p on p.id=a.payment_id where p.receipt_id=r.id and (a.method_variant<>'cash' or a.status<>'completed')) then raise exception 'Only unreversed cash entries can be voided in this version.'; end if;
  perform 1 from public.outstanding_balances where receipt_id=r.id for update;
  if exists(select 1 from public.balance_payments p join public.outstanding_balances b on b.id=p.outstanding_balance_id where b.receipt_id=r.id) then raise exception 'Later balance payments require owner reconciliation.'; end if;
 end if;
 if q.kind='VOID' and p_action='execute' then raise exception 'Void completes on manager approval.'; end if;
 result:=public.transition_receipt_refund_v2(p_id,p_receipt_id,p_action,p_proposal,p_actor,p_reason,p_reference);
 if p_action='request' and p_proposal->>'kind'='VOID' then update public.receipt_refund_requests set kind='VOID' where id=p_id;
 elsif q.kind='VOID' and p_action='approve' then
  update public.payment_records set status='cancelled',updated_at=now() where receipt_id=r.id;
  update public.payment_allocations set status='voided',updated_at=now() where payment_id in(select id from public.payment_records where receipt_id=r.id);
  update public.outstanding_balances set cancelled_original_amount=original_amount,original_amount=0,reason=coalesce(reason,'')||' | Approved whole receipt void' where receipt_id=r.id;
  update public.receipts set status='VOIDED',void_reason=q.requested_reason,voided_by=(p_actor->>'actor_id')::uuid,voided_at=now() where id=r.id returning * into r;
  update public.pos_checkout_requests set result=jsonb_set(pos_checkout_requests.result,'{receipt}',to_jsonb(r)) where id=r.id;
  update public.receipt_refund_requests set status='COMPLETED',completed_at=now() where id=p_id;
 end if;
 select to_jsonb(t) into result from public.receipt_refund_requests t where id=p_id;return result;
end; $$;
revoke all on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.transition_receipt_refund_v2(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) to service_role;
