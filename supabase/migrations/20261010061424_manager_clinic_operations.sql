alter table public.pos_manager_access drop constraint pos_manager_access_permissions_check;
alter table public.pos_manager_access add constraint pos_manager_access_permissions_check check(permissions <@ array['doctors','services','receipt_design','reports','correction_approval','receptionists']::text[]);
alter table public.receptionist add column is_active boolean not null default true;
create or replace function public.manage_clinic_catalog(p_account_id uuid,p_clinic_id uuid,p_kind text,p_action text,p_entity_id uuid,p_data jsonb,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_role text;v_permission text;v_keys text[];v_key text;v_set text;v_table text;v_result jsonb;v_data jsonb;v_id uuid;v_price_data jsonb;
begin
 select role into v_role from public.pos_accounts where id=p_account_id and enabled for share;
 if not found then raise exception 'Named account required' using errcode='42501';end if;
 v_permission:=case p_kind when 'doctors' then 'doctors' when 'services' then 'services' when 'clinics' then 'receipt_design' end;
 if v_permission is null or p_action not in ('create','update','archive') or (p_kind='clinics' and p_action<>'update') then raise exception 'Unsupported operation' using errcode='22023';end if;
 if v_role<>'owner' then
  perform 1 from public.pos_manager_access where account_id=p_account_id and clinic_id=p_clinic_id and v_permission=any(permissions)
   and (starts_on is null or starts_on <= (now() at time zone 'Asia/Dubai')::date) and (ends_on is null or ends_on >= (now() at time zone 'Asia/Dubai')::date) for share;
  if not found then raise exception 'Clinic permission required' using errcode='42501';end if;
 end if;
 if length(trim(p_reason)) not between 3 and 1000 then raise exception 'Reason required' using errcode='22023';end if;
 v_keys:=case p_kind when 'doctors' then array['name','specialty','is_active'] when 'services' then array['name','display_name','variant','price','standard_price','vat_rate','category','category_id','default_visit_count','sort_order','active_plan_recommended','is_active','canonical_service_id','requires_quantity','billing_unit','tooth_selection_mode','pricing_type','min_price','max_price','search_keywords','common_aliases'] else
 array['receipt_print_name','receipt_title','receipt_vat_note','receipt_thank_you','receipt_final_message','receipt_qr_url','logo','instagram','facebook','tiktok','thermal_logo_width_mm','thermal_logo_max_height_mm','thermal_logo_alignment','thermal_logo_offset_x_mm','thermal_logo_offset_y_mm','thermal_logo_high_contrast','thermal_text_weight','thermal_font_size_px','a4_invoice_logo_url','a4_invoice_logo_width_mm','a4_invoice_logo_height_mm','a4_invoice_logo_alignment','a4_invoice_logo_offset_x_mm','a4_invoice_logo_offset_y_mm','a4_invoice_primary_color','a4_invoice_secondary_color','a4_invoice_accent_color','a4_invoice_text_color','a4_invoice_divider_color','a4_invoice_slogan'] end;
 if p_kind='clinics' then v_keys:=v_keys||array['address','room','phone','whatsapp'];end if;
 if v_role='owner' and p_kind='clinics' then v_keys:=v_keys||array['name','trn','code','enable_expenses','enable_commissions'];end if;
 v_data:=case when p_action='archive' then '{"is_active":false}'::jsonb else p_data end;
 if jsonb_typeof(v_data)<>'object' or v_data='{}'::jsonb then raise exception 'Fields required' using errcode='22023';end if;
 for v_key in select jsonb_object_keys(v_data) loop
  if not v_key=any(v_keys) then raise exception 'Field not allowed' using errcode='22023';end if;
 end loop;
 if p_kind='services' and v_data ? 'canonical_service_id' and v_data->>'canonical_service_id' is not null then
  perform 1 from public.services where id=(v_data->>'canonical_service_id')::uuid and clinic_id=p_clinic_id;
  if not found then raise exception 'Canonical service must belong to clinic' using errcode='22023';end if;
 end if;
 v_price_data:=v_data;
 if p_kind='services' and p_action<>'create' then
 select to_jsonb(s)||v_data into v_price_data from public.services s where s.id=p_entity_id and s.clinic_id=p_clinic_id for update;
 if not found then raise exception 'Service not in clinic' using errcode='P0002';end if;
 end if;
 if p_kind='services' and v_price_data->>'pricing_type'='variable' then
 if (v_price_data->>'min_price') is null or (v_price_data->>'max_price') is null or (v_price_data->>'price') is null or (v_price_data->>'min_price')::numeric<0 or (v_price_data->>'min_price')::numeric>(v_price_data->>'max_price')::numeric or (v_price_data->>'price')::numeric<(v_price_data->>'min_price')::numeric or (v_price_data->>'price')::numeric>(v_price_data->>'max_price')::numeric then raise exception 'Invalid price range' using errcode='22023';end if;
 end if;
 perform pg_catalog.set_config('pos.audit_actor',jsonb_build_object('actor_id',p_account_id,'actor_role',v_role,'verified',true,'reason',trim(p_reason))::text,true);
 v_table:=format('public.%I',p_kind);
 if p_action='create' then
  v_id:=coalesce(p_entity_id,gen_random_uuid());
  if length(trim(coalesce(v_data->>'name',''))) not between 1 and 200 then raise exception 'Name required' using errcode='22023';end if;
  if p_kind='doctors' then insert into public.doctors(id,clinic_id,name,specialty,is_active) values(v_id,p_clinic_id,trim(v_data->>'name'),v_data->>'specialty',coalesce((v_data->>'is_active')::boolean,true));
  else insert into public.services(id,clinic_id,name,display_name,price,standard_price,vat_rate,category,is_active,pricing_type) values(v_id,p_clinic_id,trim(v_data->>'name'),trim(v_data->>'name'),(v_data->>'price')::numeric,(v_data->>'price')::numeric,(v_data->>'vat_rate')::numeric,coalesce(v_data->>'category','General'),true,'fixed');end if;
 else v_id:=p_entity_id;end if;
 select string_agg(format('%1$I = (jsonb_populate_record(null::%2$s,$1)).%1$I',k,v_table),', ') into v_set from jsonb_object_keys(v_data) k;
 execute format('update %s set %s where id=$2 %s returning to_jsonb(%s.*)',v_table,v_set,case when p_kind='clinics' then 'and id=$3' else 'and clinic_id=$3' end,p_kind) into v_result using v_data,v_id,p_clinic_id;
 if v_result is null then raise exception 'Record not found in clinic' using errcode='P0002';end if;
 return v_result;
end;$$;
revoke all on function public.manage_clinic_catalog(uuid,uuid,text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.manage_clinic_catalog(uuid,uuid,text,text,uuid,jsonb,text) to service_role;
create function public.manager_save_receptionist(p_account_id uuid,p_id uuid,p_name text,p_shift text,p_clinic_id uuid,p_pin text,p_active boolean,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_role text; v_old public.receptionist%rowtype; v_new public.receptionist%rowtype;
begin
 select role into v_role from public.pos_accounts where id=p_account_id and enabled for share;
 if not found then raise exception 'Account required' using errcode='42501'; end if;
 if v_role<>'owner' then
 perform 1 from public.pos_manager_access where account_id=p_account_id and clinic_id=p_clinic_id and 'receptionists'=any(permissions) and (starts_on is null or starts_on<=(now() at time zone 'Asia/Dubai')::date) and (ends_on is null or ends_on>=(now() at time zone 'Asia/Dubai')::date) for share;
 if not found then raise exception 'Clinic permission required' using errcode='42501'; end if;
 end if;
 if length(trim(p_name)) not between 1 and 200 or length(p_shift)>100 or p_active is null or length(trim(p_reason)) not between 3 and 1000 or (p_pin is not null and p_pin !~ '^[0-9]{4}$') then raise exception 'Invalid staff fields'; end if;
 perform pg_catalog.set_config('pos.audit_actor',jsonb_build_object('actor_id',p_account_id,'actor_role',v_role,'verified',true,'reason',trim(p_reason))::text,true);
 if p_id is null then
 if p_pin is null then raise exception 'PIN required';end if;
 insert into public.receptionist(name,shift,clinic_id,pin,is_active) values(trim(p_name),p_shift,p_clinic_id,p_pin,p_active) returning * into v_new;
 else
 select * into v_old from public.receptionist where id=p_id for update;
 if not found or v_old.clinic_id is distinct from p_clinic_id then raise exception 'Record not in clinic' using errcode='P0002';end if;
 update public.receptionist set name=trim(p_name),shift=p_shift,pin=coalesce(p_pin,pin),is_active=p_active where id=p_id returning * into v_new;
 if not p_active or p_pin is not null then delete from public.active_sessions where receptionist_id=p_id;end if;
 end if;
 insert into public.activity_log(clinic_id,action,entity_type,entity_id,actor_id,actor_role,actor_verified,reason,old_data,new_data) values(p_clinic_id,'SAVE_RECEPTIONIST','receptionist',v_new.id::text,p_account_id,v_role,true,p_reason,to_jsonb(v_old)-'pin',to_jsonb(v_new)-'pin');
 return to_jsonb(v_new)-'pin';
end;$$;
revoke all on function public.manager_save_receptionist(uuid,uuid,text,text,uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.manager_save_receptionist(uuid,uuid,text,text,uuid,text,boolean,text) to service_role;
create function public.owner_disable_manager(p_owner_id uuid,p_account_id uuid,p_reason text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.pos_accounts where id=p_owner_id and enabled and role='owner' for share;
 if not found then raise exception 'Owner required' using errcode='42501';end if;
 if length(trim(p_reason)) not between 3 and 1000 then raise exception 'Reason required';end if;
 perform pg_catalog.set_config('pos.audit_actor',jsonb_build_object('actor_id',p_owner_id,'actor_role','owner','verified',true,'reason',trim(p_reason))::text,true);
 update public.pos_accounts set enabled=false,updated_at=clock_timestamp() where id=p_account_id and role='clinic_manager';
 if not found then raise exception 'Manager not found' using errcode='P0002';end if;
 delete from public.active_sessions where account_id=p_account_id;
end;$$;
revoke all on function public.owner_disable_manager(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.owner_disable_manager(uuid,uuid,text) to service_role;
