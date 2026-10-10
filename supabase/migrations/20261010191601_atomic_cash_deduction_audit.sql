-- The financial change and audit insert commit or roll back together.
create or replace function public.audit_cash_deduction_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.cash_deduction_events(deduction_id,action,changed_by,next_data)
    values(new.id,'created',new.created_by,to_jsonb(new));
  elsif to_jsonb(new) is distinct from to_jsonb(old) then
    insert into public.cash_deduction_events(deduction_id,action,changed_by,reason,previous_data,next_data)
    values(new.id,case when new.status='voided' and old.status<>'voided' then 'voided' else 'updated' end,
      new.updated_by,case when new.status='voided' and old.status<>'voided' then new.void_reason else null end,to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end; $$;
revoke all on function public.audit_cash_deduction_change() from public, anon, authenticated;
drop trigger if exists audit_cash_deduction_change on public.cash_deductions;
create trigger audit_cash_deduction_change after insert or update on public.cash_deductions
for each row execute function public.audit_cash_deduction_change();
