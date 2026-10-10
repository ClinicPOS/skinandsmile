begin;
do $$ declare r uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); begin
 select id into r from public.cash_register_sessions where receptionist_id='33333333-3333-4333-8333-333333333333' and closed_at is null limit 1;
 if r is null then raise exception 'Open fake register required'; end if;
 insert into public.cash_deductions(id,clinic_id,register_session_id,business_date,type,paid_to_name,description,amount,created_by,updated_by)
 values(d,'11111111-1111-4111-8111-111111111111',r,current_date,'expense','TEST','TEST atomic audit',10,'33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333');
 if (select count(*) from public.cash_deduction_events where deduction_id=d and action='created')<>1 then raise exception 'Missing creation audit'; end if;
 update public.cash_deductions set amount=11 where id=d;
 if (select count(*) from public.cash_deduction_events where deduction_id=d and action='updated')<>1 then raise exception 'Missing edit audit'; end if;
end $$;
create function public.test_fail_cash_audit() returns trigger language plpgsql as $$begin raise exception 'TEST audit failure'; end;$$;
create trigger test_fail_cash_audit before insert on public.cash_deduction_events for each row execute function public.test_fail_cash_audit();
do $$ declare d uuid; begin
 select id into d from public.cash_deductions where description='TEST atomic audit';
 begin update public.cash_deductions set amount=12 where id=d; raise exception 'Expected audit failure';
 exception when others then if SQLERRM<>'TEST audit failure' then raise; end if; end;
 if (select amount from public.cash_deductions where id=d)<>11 then raise exception 'Financial change did not roll back'; end if;
 raise notice 'PASS: create/edit logged once; audit failure rolls back financial change';
end $$;
rollback;
