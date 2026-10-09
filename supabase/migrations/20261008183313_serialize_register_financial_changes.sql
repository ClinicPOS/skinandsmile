-- Local rehearsal only. Serialize register closing with changes to its cash ledger.
create function public.register_ledger_version(p_receptionist_id uuid) returns text language plpgsql security invoker set search_path='' as $$
declare v_table text;v_part text;v_result text:='';v_where text;
begin
 foreach v_table in array array['receipts','payment_records','balance_payments','patient_credits','treatment_plan_payment_records','treatment_plan_payments','refunds','payment_allocation_refunds'] loop
  v_where:=case v_table when 'refunds' then 'refunded_by' when 'payment_allocation_refunds' then 'processed_by' else 'receptionist_id' end;
  execute format('select coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by t.id),'''') from public.%I t where %I=$1',v_table,v_where) into v_part using p_receptionist_id;
  v_result:=v_result||v_part;
 end loop;
 select coalesce(string_agg(md5(to_jsonb(a)::text),'' order by a.id),'') into v_part from public.payment_allocations a join public.payment_records p on p.id=a.payment_id where p.receptionist_id=p_receptionist_id;v_result:=v_result||v_part;
 select coalesce(string_agg(md5(to_jsonb(a)::text),'' order by a.id),'') into v_part from public.treatment_plan_payment_allocations a join public.treatment_plan_payment_records p on p.id=a.payment_id where p.receptionist_id=p_receptionist_id;
 v_result:=v_result||v_part;
 select coalesce(string_agg(md5(to_jsonb(d)::text),'' order by d.id),'') into v_part from public.cash_deductions d join public.cash_register_sessions r on r.id=d.register_session_id where r.receptionist_id=p_receptionist_id;
 return md5(v_result||v_part);
end;$$;
revoke all on function public.register_ledger_version(uuid) from public,anon,authenticated;
grant execute on function public.register_ledger_version(uuid) to service_role;
create function public.guard_register_ledger_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_data jsonb;v_rec uuid;v_register uuid;v_closed timestamptz;
begin
 v_data:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 v_rec:=coalesce((v_data->>'receptionist_id')::uuid,(v_data->>'processed_by')::uuid,(v_data->>'refunded_by')::uuid);
 v_register:=(v_data->>'register_session_id')::uuid;
 if v_rec is null and v_register is not null then select receptionist_id into v_rec from public.cash_register_sessions where id=v_register;end if;
 if TG_TABLE_NAME='payment_allocations' then select receptionist_id into v_rec from public.payment_records where id=(v_data->>'payment_id')::uuid;
 select id into v_register from public.cash_register_sessions where receptionist_id=v_rec and closed_at is null;
 elsif TG_TABLE_NAME='treatment_plan_payment_allocations' then select receptionist_id,register_session_id into v_rec,v_register from public.treatment_plan_payment_records where id=(v_data->>'payment_id')::uuid;
 end if;
 if v_rec is not null then perform pg_advisory_xact_lock(hashtextextended('register-ledger:'||v_rec::text,0));end if;
 if TG_OP='INSERT' and v_register is not null then
  select closed_at into v_closed from public.cash_register_sessions where id=v_register and receptionist_id=v_rec for share;
  if not found or v_closed is not null then raise exception 'Register is no longer open';end if;
 end if;
 if TG_OP='DELETE' then return old;else return new;end if;
end;$$;
revoke all on function public.guard_register_ledger_change() from public,anon,authenticated;
grant execute on function public.guard_register_ledger_change() to service_role;
do $$declare t text;begin foreach t in array array['receipts','payment_records','payment_allocations','balance_payments','patient_credits','treatment_plan_payment_records','treatment_plan_payments','treatment_plan_payment_allocations','cash_deductions','refunds','payment_allocation_refunds'] loop execute format('create trigger serialize_register_ledger before insert or update or delete on public.%I for each row execute function public.guard_register_ledger_change()',t);end loop;end;$$;
create function public.close_verified_register(p_receptionist_id uuid,p_clinic_id uuid,p_register_id uuid,p_amount numeric,p_expected_cash numeric,p_ledger_version text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.cash_register_sessions%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('register-ledger:'||p_receptionist_id::text,0));
 select * into v_row from public.cash_register_sessions where id=p_register_id and receptionist_id=p_receptionist_id for update;
 if not found then raise exception 'Register not found';end if;
 if v_row.closed_at is null and (p_ledger_version is null or public.register_ledger_version(p_receptionist_id)<>p_ledger_version) then raise exception 'Cash ledger changed. Refresh before closing.';end if;
 return public.protected_register_change('close',p_receptionist_id,p_clinic_id,p_register_id,p_amount,p_expected_cash);
end;$$;
revoke all on function public.close_verified_register(uuid,uuid,uuid,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.close_verified_register(uuid,uuid,uuid,numeric,numeric,text) to service_role;
