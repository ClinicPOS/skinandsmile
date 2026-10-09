-- LOCAL ONLY. Deploy together with server/UI; old browser refund writes are revoked.
create table public.receipt_refund_requests (
 id uuid primary key, receipt_id uuid not null references public.receipts(id) on delete restrict,
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 requested_by uuid not null references public.receptionist(id) on delete restrict,
 requested_reason text not null check(length(requested_reason) between 3 and 1000),
 proposal jsonb not null, fingerprint text not null,
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','CANCELLED','COMPLETED')),
 reviewed_by uuid references public.pos_accounts(id) on delete restrict,
 review_reason text, reviewed_at timestamptz, returned_reference text,
 refund_id uuid unique references public.refunds(id) on delete restrict,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create unique index receipt_refund_one_open on public.receipt_refund_requests(receipt_id) where status in ('PENDING','APPROVED');
create index receipt_refund_queue on public.receipt_refund_requests(clinic_id,created_at desc);
alter table public.receipt_refund_requests enable row level security;
revoke all on public.receipt_refund_requests from public,anon,authenticated;
grant select,insert,update on public.receipt_refund_requests to service_role;
create trigger pos_activity_capture after insert or update or delete on public.receipt_refund_requests for each row execute function pos_private.capture_activity();

create function public.receipt_refund_fingerprint(p_receipt_id uuid) returns text language sql security invoker set search_path='' as $$
 select md5(jsonb_build_object(
 'receipt',(select to_jsonb(r) from public.receipts r where id=p_receipt_id),
 'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.receipt_items i where receipt_id=p_receipt_id),
 'refunds',(select jsonb_agg(to_jsonb(r) order by r.id) from public.refunds r where receipt_id=p_receipt_id),
 'refund_items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.refund_items i join public.refunds r on r.id=i.refund_id where r.receipt_id=p_receipt_id),
 'payments',(select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_records p where receipt_id=p_receipt_id),
 'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.payment_allocations a join public.payment_records p on p.id=a.payment_id where p.receipt_id=p_receipt_id)
 )::text);
$$;
revoke all on function public.receipt_refund_fingerprint(uuid) from public,anon,authenticated;
grant execute on function public.receipt_refund_fingerprint(uuid) to service_role;

create function public.transition_receipt_refund(p_id uuid,p_receipt_id uuid,p_action text,p_proposal jsonb,p_actor jsonb,p_reason text,p_reference text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_request public.receipt_refund_requests%rowtype; v_receipt public.receipts%rowtype;
 v_actor uuid := (p_actor->>'actor_id')::uuid; v_account public.pos_accounts%rowtype;
 v_staff public.receptionist%rowtype; v_proposal jsonb; v_refund uuid; v_piece jsonb; v_today date:=(now() at time zone 'Asia/Dubai')::date;
begin
 if not coalesce((p_actor->>'verified')::boolean,false) then raise exception 'Verified identity required'; end if;
 select * into v_receipt from public.receipts where id=p_receipt_id for update;
 if not found then raise exception 'Receipt not found'; end if;
 select * into v_request from public.receipt_refund_requests where id=p_id for update;
 if p_action in ('request','execute','cancel') then
  select * into v_staff from public.receptionist where id=v_actor and clinic_id=v_receipt.clinic_id;
  if not found or p_actor->>'actor_role'<>'receptionist' then raise exception 'Requesting clinic receptionist required' using errcode='42501'; end if;
 else
  select * into v_account from public.pos_accounts where id=v_actor and enabled for share;
  if not found or v_account.role not in ('owner','clinic_manager') then raise exception 'Individual approver required' using errcode='42501'; end if;
  if v_account.role<>'owner' and not exists(select 1 from public.pos_manager_access where account_id=v_actor and clinic_id=v_receipt.clinic_id and 'correction_approval'=any(permissions) and (starts_on is null or starts_on<=v_today) and (ends_on is null or ends_on>=v_today)) then raise exception 'Approval access is not assigned' using errcode='42501'; end if;
 end if;
 perform set_config('pos.audit_actor',(p_actor||jsonb_build_object('reason',p_reason))::text,true);
 if p_action='request' then
  if v_request.id is not null then
   if v_request.receipt_id<>p_receipt_id or v_request.requested_by<>v_actor or v_request.proposal<>p_proposal or v_request.requested_reason<>p_reason then raise exception 'Request ID already used'; end if;
   return to_jsonb(v_request);
  end if;
  if length(trim(p_reason)) not between 3 and 1000 or p_proposal is null or (p_proposal->>'total')::numeric<=0 then raise exception 'Valid refund and reason required'; end if;
  if p_proposal->>'fingerprint' is distinct from public.receipt_refund_fingerprint(p_receipt_id) then raise exception 'Receipt changed. Reload before requesting.'; end if;
  insert into public.receipt_refund_requests(id,receipt_id,clinic_id,requested_by,requested_reason,proposal,fingerprint)
  values(p_id,p_receipt_id,v_receipt.clinic_id,v_actor,p_reason,p_proposal,p_proposal->>'fingerprint') returning * into v_request;
  return to_jsonb(v_request);
 end if;
 if v_request.id is null or v_request.receipt_id<>p_receipt_id then raise exception 'Request not found'; end if;
 if p_action in ('execute','cancel') and v_request.requested_by<>v_actor then raise exception 'Only requesting receptionist can confirm'; end if;
 if p_action='execute' and v_request.status='COMPLETED' then return to_jsonb(v_request); end if;
 if p_action='cancel' then
  if v_request.status not in ('PENDING','APPROVED') then raise exception 'Request already closed'; end if;
  update public.receipt_refund_requests set status='CANCELLED' where id=p_id;
 elsif p_action in ('approve','reject') then
  if v_request.status<>'PENDING' then raise exception 'Request already reviewed'; end if;
  if p_action='reject' and length(trim(p_reason)) not between 3 and 1000 then raise exception 'Rejection reason required'; end if;
  if p_action='approve' and v_request.fingerprint<>public.receipt_refund_fingerprint(p_receipt_id) then raise exception 'Receipt changed. Cancel and request again.'; end if;
  update public.receipt_refund_requests set status=case when p_action='approve' then 'APPROVED' else 'REJECTED' end,reviewed_by=v_actor,reviewed_at=now(),review_reason=nullif(p_reason,'') where id=p_id;
 elsif p_action='execute' then
  if v_request.status<>'APPROVED' or v_request.reviewed_at<now()-interval '24 hours' then raise exception 'Current approval required. Cancel expired request and request again.'; end if;
  select * into v_account from public.pos_accounts where id=v_request.reviewed_by and enabled for share;
  if not found or v_account.role<>'owner' and not exists(select 1 from public.pos_manager_access where account_id=v_request.reviewed_by and clinic_id=v_receipt.clinic_id and 'correction_approval'=any(permissions) and (starts_on is null or starts_on<=v_today) and (ends_on is null or ends_on>=v_today)) then raise exception 'Approver access changed. Cancel and request again.'; end if;
  if length(trim(p_reference)) not between 3 and 200 then raise exception 'Return reference required'; end if;
  if v_request.fingerprint<>public.receipt_refund_fingerprint(p_receipt_id) then raise exception 'Receipt changed. Cancel and request again.'; end if;
  v_proposal:=v_request.proposal;
  insert into public.refunds(receipt_id,receptionist_id,refunded_by,reason,total_amount,payment_method)
  values(p_receipt_id,v_receipt.receptionist_id,v_actor,v_request.requested_reason,(v_proposal->>'total')::numeric,v_proposal->>'method') returning id into v_refund;
  for v_piece in select value from jsonb_array_elements(v_proposal->'allocations') loop
   if not exists(select 1 from public.payment_allocations a join public.payment_records p on p.id=a.payment_id where a.id=(v_piece->>'id')::uuid and p.receipt_id=p_receipt_id and p.clinic_id=v_receipt.clinic_id) then raise exception 'Payment does not belong to receipt'; end if;
   perform public.create_payment_allocation_refund(v_refund,(v_piece->>'id')::uuid,(v_piece->>'treatment')::numeric,(v_piece->>'vat')::numeric,v_request.requested_reason,v_actor,p_id::text||':'||(v_piece->>'id'));
  end loop;
  for v_piece in select value from jsonb_array_elements(v_proposal->'items') loop
   insert into public.refund_items(refund_id,receipt_item_id,service_id,service_name,amount,refunded_treatment_amount,refunded_vat_amount,refunded_invoice_amount)
   values(v_refund,(v_piece->>'receipt_item_id')::uuid,(v_piece->>'service_id')::uuid,v_piece->>'service_name',(v_piece->>'amount')::numeric,(v_piece->>'refunded_treatment_amount')::numeric,(v_piece->>'refunded_vat_amount')::numeric,(v_piece->>'refunded_invoice_amount')::numeric);
  end loop;
  update public.receipt_refund_requests set status='COMPLETED',refund_id=v_refund,returned_reference=p_reference,completed_at=now() where id=p_id;
 else raise exception 'Invalid refund action'; end if;
 select * into v_request from public.receipt_refund_requests where id=p_id;
 return to_jsonb(v_request);
end;
$$;
revoke all on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.transition_receipt_refund(uuid,uuid,text,jsonb,jsonb,text,text) to service_role;
revoke insert,update,delete on public.refunds,public.refund_items,public.payment_allocation_refunds from public,anon,authenticated;
revoke update,delete on public.payment_allocations,public.payment_records from public,anon,authenticated;
revoke execute on function public.create_payment_allocation_refund(uuid,uuid,numeric,numeric,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.create_legacy_receipt_refund(uuid,uuid,uuid,text,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_payment_allocation_refund(uuid,uuid,numeric,numeric,text,uuid,text) to service_role;
