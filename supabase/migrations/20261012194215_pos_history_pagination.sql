-- LOCAL PERFORMANCE WORK. Kept separate from VOID release.
begin;
-- A bounded, globally ordered history page replaces full-clinic history reads.
create function public.pos_receipt_history_page(p_clinic_id uuid,p_offset integer default 0,p_limit integer default 50) returns jsonb
language sql security invoker set search_path='' as $$
 with receipt_entries as (
  select r.id,r.created_at,'receipt'::text kind from public.receipts r
  where r.clinic_id=p_clinic_id or r.clinic_id is null and exists(select 1 from public.receptionist x where x.id=r.receptionist_id and x.clinic_id=p_clinic_id)
  order by r.created_at desc,r.id desc limit greatest(0,p_offset)+least(100,greatest(1,p_limit))+1
 ), plan_entries as (
  select p.id,p.created_at,'plan'::text kind from public.treatment_plan_payment_records p where clinic_id=p_clinic_id
  order by p.created_at desc,p.id desc limit greatest(0,p_offset)+least(100,greatest(1,p_limit))+1
 ), entries as (
  select * from receipt_entries union all select * from plan_entries
 ), page as (
  select * from entries order by created_at desc,id desc,kind desc offset greatest(0,p_offset) limit least(100,greatest(1,p_limit))+1
 ), visible as (
  select * from page order by created_at desc,id desc,kind desc limit least(100,greatest(1,p_limit))
 ) select jsonb_build_object(
 'receipts',coalesce((select jsonb_agg(to_jsonb(r) order by v.created_at desc,v.id desc) from visible v join public.receipts r on r.id=v.id where v.kind='receipt'),'[]'),
 'planPayments',coalesce((select jsonb_agg(to_jsonb(p) order by v.created_at desc,v.id desc) from visible v join public.treatment_plan_payment_records p on p.id=v.id where v.kind='plan'),'[]'),
 'hasMore',(select count(*) from page)>least(100,greatest(1,p_limit)));
$$;
revoke all on function public.pos_receipt_history_page(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.pos_receipt_history_page(uuid,integer,integer) to service_role;
create index if not exists receipts_history_page on public.receipts(clinic_id,created_at desc,id desc);
create index if not exists plan_payments_history_page on public.treatment_plan_payment_records(clinic_id,created_at desc,id desc);
commit;
