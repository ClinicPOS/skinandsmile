-- LOCAL implementation; production rollout requires a verified named owner first.
create table public.pos_accounts (
 id uuid primary key references auth.users(id) on delete restrict,
 name text not null check(length(name) between 1 and 120),
 email text not null unique,
 role text not null check(role in ('owner','clinic_manager')),
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create unique index pos_single_owner on public.pos_accounts(role) where role='owner';
create table public.pos_manager_access (
 account_id uuid not null references public.pos_accounts(id) on delete restrict,
 clinic_id uuid not null references public.clinics(id) on delete restrict,
 permissions text[] not null default '{}' check(permissions <@ array['doctors','services','receipt_design','reports','correction_approval']::text[]),
 starts_on date, ends_on date,
 updated_at timestamptz not null default now(),
 primary key(account_id,clinic_id),
 check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
alter table public.pos_accounts enable row level security;
alter table public.pos_manager_access enable row level security;
revoke all on public.pos_accounts,public.pos_manager_access from public,anon,authenticated,service_role;
grant select,insert,update on public.pos_accounts,public.pos_manager_access to service_role;
alter table public.active_sessions add column account_id uuid references public.pos_accounts(id) on delete restrict;
alter table public.doctors add column is_active boolean not null default true;

-- Browser reads remain compatible with existing POS lookups; catalog writes use scoped server RPCs.
revoke insert,update,delete,truncate,references,trigger on public.doctors,public.services,public.clinics from public,anon,authenticated;
grant select on public.doctors,public.services,public.clinics to anon,authenticated;
create trigger pos_activity_capture after insert or update or delete on public.pos_accounts for each row execute function pos_private.capture_activity();
create trigger pos_activity_capture after insert or update or delete on public.pos_manager_access for each row execute function pos_private.capture_activity();
create trigger pos_activity_capture after insert or update or delete on public.doctors for each row execute function pos_private.capture_activity();
create trigger pos_activity_capture after insert or update or delete on public.services for each row execute function pos_private.capture_activity();
create trigger pos_activity_capture after insert or update or delete on public.clinics for each row execute function pos_private.capture_activity();

create function public.owner_save_manager(p_owner_id uuid,p_account_id uuid,p_name text,p_enabled boolean,p_clinic_id uuid,p_permissions text[],p_starts date,p_ends date,p_expected_updated_at timestamptz,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_old public.pos_manager_access%rowtype;v_account public.pos_accounts%rowtype;
begin
 perform 1 from public.pos_accounts where id=p_owner_id and role='owner' and enabled for share;
 if not found then raise exception 'Owner access required' using errcode='42501';end if;
 if length(trim(p_reason)) not between 3 and 1000 then raise exception 'Reason required' using errcode='22023';end if;
 select * into v_account from public.pos_accounts where id=p_account_id for update;
 if not found or v_account.role<>'clinic_manager' then raise exception 'Manager account required' using errcode='22023';end if;
 select * into v_old from public.pos_manager_access where account_id=p_account_id and clinic_id=p_clinic_id for update;
 if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'Access changed; refresh first' using errcode='23505';end if;
 perform pg_catalog.set_config('pos.audit_actor',jsonb_build_object('actor_id',p_owner_id,'actor_role','owner','verified',true,'reason',trim(p_reason))::text,true);
 update public.pos_accounts set name=trim(p_name),enabled=p_enabled,updated_at=clock_timestamp() where id=p_account_id;
 insert into public.pos_manager_access(account_id,clinic_id,permissions,starts_on,ends_on) values(p_account_id,p_clinic_id,p_permissions,p_starts,p_ends)
 on conflict(account_id,clinic_id) do update set permissions=excluded.permissions,starts_on=excluded.starts_on,ends_on=excluded.ends_on,updated_at=clock_timestamp();
 return jsonb_build_object('saved',true);
end;$$;
revoke all on function public.owner_save_manager(uuid,uuid,text,boolean,uuid,text[],date,date,timestamptz,text) from public,anon,authenticated;
grant execute on function public.owner_save_manager(uuid,uuid,text,boolean,uuid,text[],date,date,timestamptz,text) to service_role;

create function public.manage_clinic_catalog(p_account_id uuid,p_clinic_id uuid,p_kind text,p_action text,p_entity_id uuid,p_data jsonb,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_role text;v_permission text;v_keys text[];v_key text;v_set text;v_table text;v_result jsonb;v_data jsonb;v_id uuid;
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
 if v_role='owner' and p_kind='clinics' then v_keys:=v_keys||array['name','address','room','phone','whatsapp','trn','code','enable_expenses','enable_commissions'];end if;
 v_data:=case when p_action='archive' then '{"is_active":false}'::jsonb else p_data end;
 if jsonb_typeof(v_data)<>'object' or v_data='{}'::jsonb then raise exception 'Fields required' using errcode='22023';end if;
 for v_key in select jsonb_object_keys(v_data) loop
  if not v_key=any(v_keys) then raise exception 'Field not allowed' using errcode='22023';end if;
 end loop;
 if p_kind='services' and v_data ? 'canonical_service_id' and v_data->>'canonical_service_id' is not null then
  perform 1 from public.services where id=(v_data->>'canonical_service_id')::uuid and clinic_id=p_clinic_id;
  if not found then raise exception 'Canonical service must belong to clinic' using errcode='22023';end if;
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
