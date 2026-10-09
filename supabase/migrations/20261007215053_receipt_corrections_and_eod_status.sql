-- LOCAL ONLY; receipt corrections preserve original amounts and payment identity.
alter table public.receipts add column status text not null default 'COMPLETED' check(status in ('COMPLETED','VOIDED'));
alter table public.receipts add column original_receipt_id uuid references public.receipts(id) on delete restrict;
alter table public.receipts add column replacement_receipt_id uuid unique references public.receipts(id) on delete restrict;
alter table public.receipts add column void_reason text;
alter table public.receipts add column voided_by uuid references public.pos_accounts(id) on delete restrict;
alter table public.receipts add column voided_at timestamptz;
alter table public.receipt_refund_requests add column kind text not null default 'REFUND' check(kind in ('REFUND','CORRECTION'));
alter table public.receipt_refund_requests add column replacement_receipt_id uuid references public.receipts(id) on delete restrict;
grant update on public.pos_checkout_requests to service_role;
alter function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) rename to transition_receipt_refund_v1;
revoke all on function public.transition_receipt_refund_v1(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;

create function public.transition_receipt_refund(p_id uuid,p_receipt_id uuid,p_action text,p_proposal jsonb,p_actor jsonb,p_reason text,p_reference text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.receipt_refund_requests%rowtype; r public.receipts%rowtype; replacement public.receipts%rowtype;
 actor uuid:=(p_actor->>'actor_id')::uuid; approver public.pos_accounts%rowtype;
 today date:=(now() at time zone 'Asia/Dubai')::date; v_result jsonb; paid numeric; new_vat numeric; balance_id uuid;
begin
 select * into r from public.receipts where id=p_receipt_id for update;
 if not found then raise exception 'Receipt not found'; end if;
 select * into q from public.receipt_refund_requests where id=p_id for update;
 if p_action in ('request','approve','execute') and r.status='VOIDED' and not (p_action='execute' and q.status='COMPLETED') then raise exception 'This receipt is voided. Use its replacement.'; end if;
 if p_action in ('approve','execute') and q.status<>'COMPLETED' and (q.created_at at time zone 'Asia/Dubai')::date<>today then raise exception 'Same-day approval required. Cancel this old request and submit a fresh request.'; end if;
 if p_action='execute' and q.status='APPROVED' and (q.reviewed_at at time zone 'Asia/Dubai')::date<>today then raise exception 'Approval expired at end of day. Cancel and request again.'; end if;
 if p_action='request' then
  v_result:=public.transition_receipt_refund_v1(p_id,p_receipt_id,p_action,p_proposal,p_actor,p_reason,p_reference);
  if p_proposal->>'kind'='CORRECTION' then
   update public.receipt_refund_requests set kind='CORRECTION' where id=p_id;
   select to_jsonb(t) into v_result from public.receipt_refund_requests t where id=p_id;
  end if;
  return v_result;
 end if;
 if q.kind<>'CORRECTION' or p_action<>'execute' then return public.transition_receipt_refund_v1(p_id,p_receipt_id,p_action,p_proposal,p_actor,p_reason,p_reference); end if;
 if not coalesce((p_actor->>'verified')::boolean,false) or p_actor->>'actor_role'<>'receptionist' or q.requested_by<>actor
 or not exists(select 1 from public.receptionist where id=actor and clinic_id=r.clinic_id) then raise exception 'Requesting clinic receptionist required' using errcode='42501'; end if;
 if q.status='COMPLETED' then return to_jsonb(q); end if;
 if q.status<>'APPROVED' then raise exception 'Manager approval required'; end if;
 select * into approver from public.pos_accounts where id=q.reviewed_by and enabled for share;
 if not found or approver.role<>'owner' and not exists(select 1 from public.pos_manager_access where account_id=q.reviewed_by and clinic_id=r.clinic_id and 'correction_approval'=any(permissions) and (starts_on is null or starts_on<=today) and (ends_on is null or ends_on>=today)) then raise exception 'Approver access changed. Cancel and request again.'; end if;
 if (r.created_at at time zone 'Asia/Dubai')::date<>today then raise exception 'Earlier-day receipts need owner reconciliation before correction.'; end if;
 if r.treatment_plan_id is not null or coalesce(r.transaction_type,'regular')<>'regular' or exists(select 1 from public.treatment_plan_visits where receipt_id=r.id) or exists(select 1 from public.receipt_items where receipt_id=r.id and cardinality(teeth)>0) then raise exception 'Treatment-plan and tooth records require owner review before correction.'; end if;
 if q.fingerprint<>public.receipt_refund_fingerprint(r.id) then raise exception 'Receipt changed. Cancel and request again.'; end if;
 if exists(select 1 from public.refunds where receipt_id=r.id) or coalesce(r.credit_applied,0)<>0 or coalesce(r.gateway_fee,0)<>0 then raise exception 'Refunded, credit or fee-backed receipts require owner review.'; end if;
 perform 1 from public.payment_records where receipt_id=r.id for update;
 perform 1 from public.payment_allocations where payment_id in(select id from public.payment_records where receipt_id=r.id) for update;
 if (select count(*) from public.payment_records where receipt_id=r.id)>1 or exists(select 1 from public.payment_allocations a join public.payment_records p on p.id=a.payment_id where p.receipt_id=r.id and (a.method_variant<>'cash' or a.refunded_treatment_amount<>0 or a.refunded_vat_amount<>0)) then raise exception 'Only an unreversed cash receipt is supported for automatic correction.'; end if;
 select coalesce(sum(total_customer_charged_amount),0) into paid from public.payment_records where receipt_id=r.id;
 if paid>0 and (select count(*) from public.payment_allocations where payment_id in(select id from public.payment_records where receipt_id=r.id))<>1 then raise exception 'Split payments need owner review before correction.'; end if;
 if paid<>coalesce(r.amount_paid,r.total,0) then raise exception 'Saved payments do not reconcile. Ask the owner to review.'; end if;
 if paid>(q.proposal->>'total')::numeric then raise exception 'Collected money exceeds the corrected bill. Record a refund or patient credit first.'; end if;
 perform 1 from public.outstanding_balances where receipt_id=r.id for update;
 if exists(select 1 from public.balance_payments p join public.outstanding_balances b on b.id=p.outstanding_balance_id where b.receipt_id=r.id) then raise exception 'This receipt has later balance payments. Ask the owner to review.'; end if;
 perform set_config('pos.audit_actor',(p_actor||jsonb_build_object('reason',q.requested_reason))::text,true);
 v_result:=public.complete_pos_checkout(p_id,(q.proposal->'checkout')||jsonb_build_object('audit_actor',p_actor||jsonb_build_object('reason',q.requested_reason)));
 select * into replacement from public.receipts where id=p_id;
 new_vat:=case when replacement.total>0 then round(replacement.vat*paid/replacement.total,2) else 0 end;
 update public.payment_records set receipt_id=p_id,total_vat_amount=new_vat,updated_at=now() where receipt_id=r.id;
 update public.payment_allocations set vat_amount=new_vat,treatment_net_amount=paid-new_vat,updated_at=now() where payment_id in(select id from public.payment_records where receipt_id=p_id);
 update public.outstanding_balances set cancelled_original_amount=original_amount,original_amount=0,reason=coalesce(reason,'')||' | Cancelled by approved receipt correction '||p_id::text where receipt_id=r.id;
 update public.outstanding_balances set original_amount=replacement.total-paid,reason='Remaining balance on corrected receipt' where receipt_id=p_id;
 update public.receipts set amount_paid=paid,payment_method=r.payment_method,original_receipt_id=r.id where id=p_id returning * into replacement;
 update public.receipts set status='VOIDED',replacement_receipt_id=p_id,void_reason=q.requested_reason,voided_by=q.reviewed_by,voided_at=now() where id=r.id returning * into r;
 select id into balance_id from public.outstanding_balances where receipt_id=p_id limit 1;
 v_result:=v_result||jsonb_build_object('receipt',to_jsonb(replacement),'paymentRecordId',(select id from public.payment_records where receipt_id=p_id limit 1),'balance',(select to_jsonb(b) from public.outstanding_balances b where id=balance_id));
 update public.pos_checkout_requests set result=v_result where id=p_id;
 update public.pos_checkout_requests set result=jsonb_set(pos_checkout_requests.result,'{receipt}',to_jsonb(r)) where id=r.id;
 update public.receipt_refund_requests set status='COMPLETED',replacement_receipt_id=p_id,completed_at=now() where id=p_id returning * into q;
 return to_jsonb(q);
end;
$$;
revoke all on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) to service_role;
