-- LOCAL TEST ONLY. Public lookup fields exclude credentials; mutations are owner-only.
revoke select,insert,update,delete on public.receptionist from public,anon,authenticated;
grant select(id,name,clinic_id,shift) on public.receptionist to anon,authenticated;
create function public.owner_save_receptionist(p_owner_id uuid,p_id uuid,p_name text,p_shift text,p_clinic_id uuid,p_pin text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old public.receptionist%rowtype; v_new public.receptionist%rowtype;
begin
 perform 1 from public.pos_accounts where id=p_owner_id and role='owner' and enabled for share;
 if not found then raise exception 'Owner required' using errcode='42501';end if;
 if length(trim(p_name)) not between 1 and 200 or length(p_shift)>100 or p_clinic_id is null or (p_pin is not null and p_pin !~ '^[0-9]{4}$') then raise exception 'Invalid staff fields';end if;
 if p_id is null then
  if p_pin is null then raise exception 'PIN required';end if;
  insert into public.receptionist(name,shift,clinic_id,pin) values(trim(p_name),p_shift,p_clinic_id,p_pin) returning * into v_new;
 else
  select * into v_old from public.receptionist where id=p_id for update;
  if not found or v_old.clinic_id is distinct from p_clinic_id then raise exception 'Changing clinic would alter history';end if;
  update public.receptionist set name=trim(p_name),shift=p_shift,pin=coalesce(p_pin,pin) where id=p_id returning * into v_new;
 end if;
 insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_verified,reason,old_data,new_data) values(p_clinic_id,'SAVE_RECEPTIONIST','receptionist',v_new.id::text,p_owner_id,'owner',true,'Staff assignment or PIN changed',to_jsonb(v_old)-'pin',to_jsonb(v_new)-'pin');
 return to_jsonb(v_new)-'pin';
end;
$$;
revoke all on function public.owner_save_receptionist(uuid,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.owner_save_receptionist(uuid,uuid,text,text,uuid,text) to service_role;