-- Local rehearsal only. Preserve all existing register rows and financial history.
create function public.protected_register_change(p_action text,p_receptionist_id uuid,p_clinic_id uuid,p_register_id uuid,p_amount numeric,p_expected_cash numeric) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.cash_register_sessions%rowtype;v_action text;
begin
 if p_amount is null or p_amount<0 or p_amount>10000000 or p_amount<>round(p_amount,2) then raise exception 'Invalid cash';end if;
 perform 1 from public.receptionist where id=p_receptionist_id and clinic_id=p_clinic_id for update;
 if not found then raise exception 'Invalid receptionist clinic';end if;
 if p_action='open' then
  select * into v_row from public.cash_register_sessions where receptionist_id=p_receptionist_id and closed_at is null for update;
  if found then return to_jsonb(v_row);end if;
  insert into public.cash_register_sessions(receptionist_id,opening_cash,opened_at) values(p_receptionist_id,p_amount,now()) returning * into v_row;v_action='OPEN_REGISTER';
 elsif p_action='close' then
  select * into v_row from public.cash_register_sessions where id=p_register_id and receptionist_id=p_receptionist_id for update;
  if not found then raise exception 'Register not found';end if;
  if v_row.closed_at is not null then
   if v_row.closing_cash is distinct from p_amount then raise exception 'Register already closed';end if;
   return to_jsonb(v_row);
  end if;
  if p_expected_cash is null then raise exception 'Expected cash required';end if;
  update public.cash_register_sessions set closing_cash=p_amount,variance=round(p_amount-p_expected_cash,2),closed_at=now() where id=p_register_id returning * into v_row;v_action='CLOSE_REGISTER';
 else raise exception 'Invalid register action';end if;
 insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_verified,reason,new_data) values(p_clinic_id,v_action,'cash_register_session',v_row.id::text,p_receptionist_id,'receptionist',true,'Register shift change',to_jsonb(v_row));
 return to_jsonb(v_row);
end;$$;
revoke all on function public.protected_register_change(text,uuid,uuid,uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function public.protected_register_change(text,uuid,uuid,uuid,numeric,numeric) to service_role;
revoke insert,update,delete on public.cash_register_sessions from public,anon,authenticated;
