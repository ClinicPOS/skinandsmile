-- Read-only computed relationship. Original rows and IDs are preserved.
create function public.pos_scope_receipt(public.receipt_items) returns setof public.receipts rows 1 language sql stable security invoker set search_path='' as $$select r.* from public.receipts r where r.id=$1.receipt_id$$;
revoke all on function public.pos_scope_receipt(public.receipt_items) from public,anon,authenticated;
grant execute on function public.pos_scope_receipt(public.receipt_items) to service_role;
notify pgrst,'reload schema';
-- No public key reads/writes or privileged RPC calls. App accesses records through checked server routes.
revoke all on public.receipts,public.receipt_items,public.refunds,public.refund_items,public.payment_records,public.payment_allocations,public.payment_allocation_refunds,public.outstanding_balances,public.balance_payments,public.patient_credits,public.treatment_plans,public.treatment_plan_visits,public.treatment_plan_payments,public.treatment_plan_payment_records,public.treatment_plan_payment_allocations,public.cash_register_sessions,public.cash_deductions,public.birthday_greetings,public.service_favorites,public.patient_treatment_visits,public.receptionist,public.doctors,public.services,public.clinics from public,anon,authenticated;
-- Column grants must also be removed; table revocation alone does not remove them.
revoke select(id,name,clinic_id,shift) on public.receptionist from anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on all functions in schema public to service_role;
do $$declare t text;begin foreach t in array array['receipts','receipt_items','refunds','refund_items','payment_records','payment_allocations','payment_allocation_refunds','outstanding_balances','balance_payments','patient_credits','treatment_plans','treatment_plan_visits','treatment_plan_payments','treatment_plan_payment_records','treatment_plan_payment_allocations','cash_register_sessions','cash_deductions','birthday_greetings','service_favorites','patient_treatment_visits','receptionist','doctors','services','clinics'] loop execute format('alter table public.%I enable row level security',t);end loop;end;$$;
