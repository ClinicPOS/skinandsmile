-- Migration: Rename existing Skin and Smile clinic to Al Satwa, add Al Dana clinic,
-- and clone Al Satwa services into Al Dana (without creating doctors/receptionists).
-- Run this once in the Supabase SQL editor on your live database.

do $$
declare
  satwa_clinic_id uuid;
  dana_clinic_id uuid;
  has_service_description boolean;
  has_service_price boolean;
  has_service_requires_quantity boolean;
  has_service_billing_unit boolean;
  has_service_category boolean;
  detected_clinic_names text;
  insert_columns text;
  select_columns text;
  duplicate_match text;
  copy_sql text;
begin
  update public.clinics
  set name = 'Skin and Smile Dental Clinic (Al Satwa)'
  where (
    lower(name) like '%skin%'
    and lower(name) like '%smile%'
    and lower(name) like '%dental%'
    and lower(name) not like '%al dana%'
  )
  or lower(trim(name)) in (
    'skin and smile dental clinic',
    'skin and smile dental',
    'skin & smile dental clinic',
    'skin and smile dental clinic (al satwa)'
  );

  select id
  into satwa_clinic_id
  from public.clinics
  where name = 'Skin and Smile Dental Clinic (Al Satwa)'
  order by created_at asc
  limit 1;

  if satwa_clinic_id is null then
    select c.id
    into satwa_clinic_id
    from public.clinics c
    where lower(c.name) like '%skin%'
      and lower(c.name) like '%smile%'
      and lower(c.name) like '%dental%'
      and lower(c.name) not like '%al dana%'
    order by c.created_at asc
    limit 1;
  end if;

  if satwa_clinic_id is null then
    select c.id
    into satwa_clinic_id
    from public.clinics c
    where lower(c.name) not like '%al dana%'
    order by (
      select count(*)
      from public.services s
      where s.clinic_id = c.id
    ) desc, c.created_at asc
    limit 1;
  end if;

  if satwa_clinic_id is null then
    select coalesce(string_agg(name, ', '), '(none)')
    into detected_clinic_names
    from public.clinics;

    raise exception 'Could not find source clinic to copy services from. Existing clinics: %', detected_clinic_names;
  end if;

  insert into public.clinics (name)
  select 'Skin and Smile Dental Clinic (Al Dana)'
  where not exists (
    select 1
    from public.clinics
    where name = 'Skin and Smile Dental Clinic (Al Dana)'
  );

  select id
  into dana_clinic_id
  from public.clinics
  where name = 'Skin and Smile Dental Clinic (Al Dana)'
  order by created_at asc
  limit 1;

  if dana_clinic_id is null then
    raise exception 'Could not create/find Skin and Smile Dental Clinic (Al Dana).';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'clinic_id'
  ) then
    raise exception 'services.clinic_id column is required to copy clinic-specific services.';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'description'
  )
  into has_service_description;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'price'
  )
  into has_service_price;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'requires_quantity'
  )
  into has_service_requires_quantity;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'billing_unit'
  )
  into has_service_billing_unit;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'category'
  )
  into has_service_category;

  insert_columns := 'name';
  select_columns := 's.name';
  duplicate_match := 'd.name = s.name';

  if has_service_description then
    insert_columns := insert_columns || ', description';
    select_columns := select_columns || ', s.description';
    duplicate_match := duplicate_match || ' and coalesce(d.description, '''') = coalesce(s.description, '''')';
  end if;

  if has_service_price then
    insert_columns := insert_columns || ', price';
    select_columns := select_columns || ', s.price';
    duplicate_match := duplicate_match || ' and coalesce(d.price, 0) = coalesce(s.price, 0)';
  end if;

  if has_service_requires_quantity then
    insert_columns := insert_columns || ', requires_quantity';
    select_columns := select_columns || ', coalesce(s.requires_quantity, false)';
    duplicate_match := duplicate_match || ' and coalesce(d.requires_quantity, false) = coalesce(s.requires_quantity, false)';
  end if;

  if has_service_billing_unit then
    insert_columns := insert_columns || ', billing_unit';
    select_columns := select_columns || ', coalesce(s.billing_unit, ''Session'')';
    duplicate_match := duplicate_match || ' and coalesce(d.billing_unit, ''Session'') = coalesce(s.billing_unit, ''Session'')';
  end if;

  if has_service_category then
    insert_columns := insert_columns || ', category';
    select_columns := select_columns || ', s.category';
    duplicate_match := duplicate_match || ' and coalesce(d.category, '''') = coalesce(s.category, '''')';
  end if;

  copy_sql := format(
    'insert into public.services (%1$s, clinic_id)
     select %2$s, %3$L::uuid
     from public.services s
     where s.clinic_id = %4$L::uuid
       and not exists (
         select 1
         from public.services d
         where d.clinic_id = %3$L::uuid
           and %5$s
       )',
    insert_columns,
    select_columns,
    dana_clinic_id,
    satwa_clinic_id,
    duplicate_match
  );

  execute copy_sql;
end
$$;
