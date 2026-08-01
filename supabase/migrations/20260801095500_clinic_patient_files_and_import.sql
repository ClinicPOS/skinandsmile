-- Stage 1: clinic-scoped patient files + normalized imported treatment visits.
-- Safe, forward-only migration: no drops, no truncates, no destructive updates.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper.
create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.safe_parse_iso_date(p_value text)
returns date
language plpgsql
as $$
declare
  v_year int;
  v_month int;
  v_day int;
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  v_year := substring(p_value from 1 for 4)::int;
  v_month := substring(p_value from 6 for 2)::int;
  v_day := substring(p_value from 9 for 2)::int;

  if v_month < 1 or v_month > 12 or v_day < 1 or v_day > 31 then
    return null;
  end if;

  begin
    return make_date(v_year, v_month, v_day);
  exception when datetime_field_overflow then
    return null;
  end;
end;
$$;

-- ------------------------------------------------------------
-- 1) Clinic patient files (one patient file per clinic)
-- ------------------------------------------------------------
create table if not exists public.clinic_patient_files (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  file_no text not null,
  mrn text,
  clinical_notes text,
  legacy_source jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_patient_files_file_no_not_blank check (length(btrim(file_no)) > 0),
  constraint clinic_patient_files_unique_file_per_clinic unique (clinic_id, file_no),
  constraint clinic_patient_files_unique_patient_per_clinic unique (clinic_id, patient_id)
);

create index if not exists clinic_patient_files_patient_id_idx on public.clinic_patient_files(patient_id);
create index if not exists clinic_patient_files_clinic_id_idx on public.clinic_patient_files(clinic_id);

drop trigger if exists trg_clinic_patient_files_updated_at on public.clinic_patient_files;
create trigger trg_clinic_patient_files_updated_at
before update on public.clinic_patient_files
for each row
execute function public.set_row_updated_at();

-- ------------------------------------------------------------
-- 2) Per-clinic file-number counters + safe allocator function
-- ------------------------------------------------------------
create table if not exists public.clinic_file_number_counters (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  next_value bigint not null check (next_value >= 1),
  updated_at timestamptz not null default now()
);

create or replace function public.sync_clinic_counter_from_file_no()
returns trigger
language plpgsql
as $$
declare
  v_file_numeric bigint;
begin
  if new.file_no ~ '^\d+$' then
    v_file_numeric := new.file_no::bigint;
    insert into public.clinic_file_number_counters (clinic_id, next_value, updated_at)
    values (new.clinic_id, v_file_numeric + 1, now())
    on conflict (clinic_id) do update
      set next_value = greatest(public.clinic_file_number_counters.next_value, excluded.next_value),
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_counter_from_file_no on public.clinic_patient_files;
create trigger trg_sync_counter_from_file_no
after insert or update of file_no, clinic_id on public.clinic_patient_files
for each row
execute function public.sync_clinic_counter_from_file_no();

create or replace function public.next_clinic_file_number(p_clinic_id uuid)
returns text
language plpgsql
as $$
declare
  v_candidate bigint;
  v_result text;
begin
  if p_clinic_id is null then
    raise exception 'clinic id is required';
  end if;

  perform pg_advisory_xact_lock(('x' || substr(md5(p_clinic_id::text), 1, 16))::bit(64)::bigint);

  insert into public.clinic_file_number_counters (clinic_id, next_value, updated_at)
  values (
    p_clinic_id,
    coalesce(
      (
        select max(file_no::bigint) + 1
        from public.clinic_patient_files
        where clinic_id = p_clinic_id
          and file_no ~ '^\d+$'
      ),
      1
    ),
    now()
  )
  on conflict (clinic_id) do nothing;

  loop
    update public.clinic_file_number_counters
    set next_value = next_value + 1,
        updated_at = now()
    where clinic_id = p_clinic_id
    returning next_value - 1 into v_candidate;

    v_result := v_candidate::text;
    exit when not exists (
      select 1
      from public.clinic_patient_files
      where clinic_id = p_clinic_id
        and file_no = v_result
    );
  end loop;

  return v_result;
end;
$$;

grant execute on function public.next_clinic_file_number(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 3) Normalize imported treatment visits
-- ------------------------------------------------------------
create table if not exists public.patient_treatment_visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_file_id uuid not null references public.clinic_patient_files(id) on delete restrict,
  visit_sequence int not null check (visit_sequence > 0),
  visit_date date,
  treatment_description text,
  fee_aed numeric(12,2) check (fee_aed is null or fee_aed >= 0),
  doctor_id uuid,
  original_dentist_name text,
  import_batch_id text,
  source_row_number int,
  source_visit_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_treatment_visits_batch_row_sequence_uniq unique (import_batch_id, source_row_number, visit_sequence)
);

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'doctors'
  ) then
    begin
      alter table public.patient_treatment_visits
        add constraint patient_treatment_visits_doctor_id_fkey
        foreign key (doctor_id) references public.doctors(id) on delete set null;
    exception when duplicate_object then
      null;
    end;
  end if;
end
$$;

create index if not exists patient_treatment_visits_clinic_id_idx on public.patient_treatment_visits(clinic_id);
create index if not exists patient_treatment_visits_patient_file_id_idx on public.patient_treatment_visits(patient_file_id);
create index if not exists patient_treatment_visits_visit_date_idx on public.patient_treatment_visits(visit_date desc);

drop trigger if exists trg_patient_treatment_visits_updated_at on public.patient_treatment_visits;
create trigger trg_patient_treatment_visits_updated_at
before update on public.patient_treatment_visits
for each row
execute function public.set_row_updated_at();

-- ------------------------------------------------------------
-- 4) Add patient_file_id references for forward compatibility
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'receipts'
      and column_name = 'patient_file_id'
  ) then
    null;
  else
    alter table public.receipts add column patient_file_id uuid;
  end if;

  begin
    alter table public.receipts
      add constraint receipts_patient_file_id_fkey
      foreign key (patient_file_id) references public.clinic_patient_files(id) on delete set null;
  exception when duplicate_object then
    null;
  end;
end
$$;

create index if not exists receipts_patient_file_id_idx on public.receipts(patient_file_id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='treatment_plans' and column_name='patient_file_id') then
    null;
  else
    alter table public.treatment_plans add column patient_file_id uuid;
  end if;
  begin
    alter table public.treatment_plans
      add constraint treatment_plans_patient_file_id_fkey
      foreign key (patient_file_id) references public.clinic_patient_files(id) on delete set null;
  exception when duplicate_object then
    null;
  end;
end
$$;

create index if not exists treatment_plans_patient_file_id_idx on public.treatment_plans(patient_file_id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='treatment_plan_payments' and column_name='patient_file_id') then
    null;
  else
    alter table public.treatment_plan_payments add column patient_file_id uuid;
  end if;
  begin
    alter table public.treatment_plan_payments
      add constraint treatment_plan_payments_patient_file_id_fkey
      foreign key (patient_file_id) references public.clinic_patient_files(id) on delete set null;
  exception when duplicate_object then
    null;
  end;
end
$$;

create index if not exists treatment_plan_payments_patient_file_id_idx on public.treatment_plan_payments(patient_file_id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_notes' and column_name='patient_file_id') then
    null;
  else
    alter table public.patient_notes add column patient_file_id uuid;
  end if;
  begin
    alter table public.patient_notes
      add constraint patient_notes_patient_file_id_fkey
      foreign key (patient_file_id) references public.clinic_patient_files(id) on delete set null;
  exception when duplicate_object then
    null;
  end;
end
$$;

create index if not exists patient_notes_patient_file_id_idx on public.patient_notes(patient_file_id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='outstanding_balances' and column_name='patient_file_id') then
    null;
  else
    alter table public.outstanding_balances add column patient_file_id uuid;
  end if;
  begin
    alter table public.outstanding_balances
      add constraint outstanding_balances_patient_file_id_fkey
      foreign key (patient_file_id) references public.clinic_patient_files(id) on delete set null;
  exception when duplicate_object then
    null;
  end;
end
$$;

create index if not exists outstanding_balances_patient_file_id_idx on public.outstanding_balances(patient_file_id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='patient_credits' and column_name='patient_file_id') then
    null;
  else
    alter table public.patient_credits add column patient_file_id uuid;
  end if;
  begin
    alter table public.patient_credits
      add constraint patient_credits_patient_file_id_fkey
      foreign key (patient_file_id) references public.clinic_patient_files(id) on delete set null;
  exception when duplicate_object then
    null;
  end;
end
$$;

create index if not exists patient_credits_patient_file_id_idx on public.patient_credits(patient_file_id);

-- Seed clinic files from existing receipts/receptionist mapping if possible.
insert into public.clinic_patient_files (clinic_id, patient_id, file_no, mrn, legacy_source)
select distinct
  rcp.clinic_id,
  p.id,
  coalesce(p.patient_number::text, 'LEG-' || left(p.id::text, 8)),
  p.mrn,
  jsonb_build_object('seeded_from', 'existing_receipts')
from public.receipts r
join public.receptionist rcp on rcp.id = r.receptionist_id
join public.patients p on p.id = r.patient_id
where r.patient_id is not null
on conflict (clinic_id, patient_id) do nothing;

-- Backfill references.
update public.receipts r
set patient_file_id = cpf.id
from public.receptionist rcp,
     public.clinic_patient_files cpf
where r.receptionist_id = rcp.id
  and cpf.clinic_id = rcp.clinic_id
  and cpf.patient_id = r.patient_id
  and r.patient_id is not null
  and r.patient_file_id is null;

-- ------------------------------------------------------------
-- 5) Import staging + exceptions tables
-- ------------------------------------------------------------
create table if not exists public.clinic_patient_import_staging (
  id bigserial primary key,
  import_batch_id text not null,
  clinic_code text not null,
  patient_name text,
  file_no text,
  gender text,
  mrn text,
  contact_no text,
  nationality text,
  medical_history text,
  legacy_column_8 text,
  source_row_number int not null,
  created_at timestamptz not null default now(),
  constraint clinic_patient_import_staging_uniq unique (import_batch_id, source_row_number)
);

create table if not exists public.clinic_treatment_visit_import_staging (
  id bigserial primary key,
  import_batch_id text not null,
  clinic_code text not null,
  file_no text,
  visit_sequence int,
  visit_date text,
  treatment_done text,
  fee_aed text,
  dentist_name text,
  legacy_dentist_1 text,
  source_row_number int not null,
  created_at timestamptz not null default now(),
  constraint clinic_treatment_visit_import_staging_uniq unique (import_batch_id, source_row_number, visit_sequence)
);

create table if not exists public.clinic_import_exceptions (
  id bigserial primary key,
  import_batch_id text not null,
  source_table text not null,
  source_row_number int,
  severity text not null default 'error',
  error_code text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists clinic_import_exceptions_batch_idx on public.clinic_import_exceptions(import_batch_id, source_table);

-- ------------------------------------------------------------
-- 6) Safe import function (idempotent by batch + source row)
-- ------------------------------------------------------------
create or replace function public.import_clinic_patient_batch(p_import_batch_id text)
returns table (
  inserted_patient_files int,
  inserted_visits int,
  exception_count int
)
language plpgsql
as $$
declare
  v_inserted_patient_files int := 0;
  v_inserted_visits int := 0;
  v_row record;
  v_existing_file record;
  v_patient_id uuid;
begin
  if coalesce(btrim(p_import_batch_id), '') = '' then
    raise exception 'import_batch_id is required';
  end if;

  delete from public.clinic_import_exceptions
  where import_batch_id = p_import_batch_id;

  -- Missing/unknown clinic, patient name, file number.
  insert into public.clinic_import_exceptions (import_batch_id, source_table, source_row_number, error_code, message, context)
  select
    s.import_batch_id,
    'clinic_patient_import_staging',
    s.source_row_number,
    case
      when coalesce(btrim(s.clinic_code), '') = '' then 'missing_clinic_code'
      when c.id is null then 'unknown_clinic_code'
      when coalesce(btrim(s.patient_name), '') = '' then 'missing_patient_name'
      when coalesce(btrim(s.file_no), '') = '' then 'missing_file_no'
      else 'unknown'
    end,
    case
      when coalesce(btrim(s.clinic_code), '') = '' then 'Clinic code is required.'
      when c.id is null then 'Clinic code was not found in clinics.code.'
      when coalesce(btrim(s.patient_name), '') = '' then 'Patient name is required.'
      when coalesce(btrim(s.file_no), '') = '' then 'File number is required.'
      else 'Invalid row.'
    end,
    jsonb_build_object('clinic_code', s.clinic_code, 'file_no', s.file_no)
  from public.clinic_patient_import_staging s
  left join public.clinics c
    on upper(c.code) = upper(s.clinic_code)
  where s.import_batch_id = p_import_batch_id
    and (
      coalesce(btrim(s.clinic_code), '') = ''
      or c.id is null
      or coalesce(btrim(s.patient_name), '') = ''
      or coalesce(btrim(s.file_no), '') = ''
    );

  -- Duplicate file numbers inside one clinic in same batch.
  insert into public.clinic_import_exceptions (import_batch_id, source_table, source_row_number, error_code, message, context)
  select
    s.import_batch_id,
    'clinic_patient_import_staging',
    s.source_row_number,
    'duplicate_file_no_in_batch',
    'Duplicate file number found inside same clinic and import batch.',
    jsonb_build_object('clinic_code', s.clinic_code, 'file_no', s.file_no)
  from public.clinic_patient_import_staging s
  join (
    select clinic_code, file_no
    from public.clinic_patient_import_staging
    where import_batch_id = p_import_batch_id
    group by clinic_code, file_no
    having count(*) > 1
  ) dup
    on dup.clinic_code = s.clinic_code
   and dup.file_no = s.file_no
  where s.import_batch_id = p_import_batch_id;

  -- Insert missing patient + clinic file rows; do not overwrite existing files.
  -- Important: we never merge people by name/phone. If clinic+file exists, we keep it.
  for v_row in
    select s.*, c.id as clinic_id
    from public.clinic_patient_import_staging s
    join public.clinics c
      on upper(c.code) = upper(s.clinic_code)
    where s.import_batch_id = p_import_batch_id
      and not exists (
        select 1
        from public.clinic_import_exceptions e
        where e.import_batch_id = s.import_batch_id
          and e.source_table = 'clinic_patient_import_staging'
          and e.source_row_number = s.source_row_number
      )
    order by s.source_row_number
  loop
    select id, patient_id, mrn
    into v_existing_file
    from public.clinic_patient_files
    where clinic_id = v_row.clinic_id
      and file_no = v_row.file_no
    limit 1;

    if v_existing_file.id is not null then
      if nullif(v_row.mrn, '') is not null
         and nullif(v_existing_file.mrn, '') is not null
         and nullif(v_row.mrn, '') <> nullif(v_existing_file.mrn, '') then
        insert into public.clinic_import_exceptions (import_batch_id, source_table, source_row_number, error_code, message, context)
        values (
          v_row.import_batch_id,
          'clinic_patient_import_staging',
          v_row.source_row_number,
          'conflicting_mrn',
          'Existing clinic file has a different MRN.',
          jsonb_build_object('file_no', v_row.file_no, 'existing_mrn', v_existing_file.mrn, 'incoming_mrn', v_row.mrn)
        );
      end if;
      continue;
    end if;

    if exists (
      select 1
      from public.patients p
      where lower(btrim(p.name)) = lower(btrim(v_row.patient_name))
        and (
          nullif(v_row.contact_no, '') is null
          or nullif(p.phone, '') is null
          or regexp_replace(p.phone, '\D', '', 'g') <> regexp_replace(v_row.contact_no, '\D', '', 'g')
        )
      limit 1
    ) then
      insert into public.clinic_import_exceptions (import_batch_id, source_table, source_row_number, severity, error_code, message, context)
      values (
        v_row.import_batch_id,
        'clinic_patient_import_staging',
        v_row.source_row_number,
        'warning',
        'ambiguous_possible_duplicate_person',
        'Possible duplicate person found by name. Imported as a separate person by design.',
        jsonb_build_object('patient_name', v_row.patient_name, 'contact_no', v_row.contact_no)
      );
    end if;

    insert into public.patients (name, phone, nationality)
    values (
      v_row.patient_name,
      coalesce(nullif(v_row.contact_no, ''), ''),
      coalesce(nullif(v_row.nationality, ''), '')
    )
    returning id into v_patient_id;

    begin
      insert into public.clinic_patient_files (clinic_id, patient_id, file_no, mrn, clinical_notes, legacy_source)
      values (
        v_row.clinic_id,
        v_patient_id,
        v_row.file_no,
        nullif(v_row.mrn, ''),
        nullif(v_row.medical_history, ''),
        jsonb_build_object(
          'import_batch_id', v_row.import_batch_id,
          'source_row_number', v_row.source_row_number,
          'legacy_column_8', v_row.legacy_column_8
        )
      );
      v_inserted_patient_files := v_inserted_patient_files + 1;
    exception when unique_violation then
      insert into public.clinic_import_exceptions (import_batch_id, source_table, source_row_number, error_code, message, context)
      values (
        v_row.import_batch_id,
        'clinic_patient_import_staging',
        v_row.source_row_number,
        'duplicate_file_no_in_db',
        'Clinic file number already exists in database.',
        jsonb_build_object('clinic_id', v_row.clinic_id, 'file_no', v_row.file_no)
      );
      delete from public.patients where id = v_patient_id;
    end;
  end loop;

  -- Visit validation: matching file + valid sequence/date/fee.
  insert into public.clinic_import_exceptions (import_batch_id, source_table, source_row_number, error_code, message, context)
  select
    v.import_batch_id,
    'clinic_treatment_visit_import_staging',
    v.source_row_number,
    case
      when c.id is null then 'unknown_clinic_code'
      when cpf.id is null then 'missing_clinic_patient_file'
      when v.visit_sequence is null or v.visit_sequence <= 0 then 'invalid_visit_sequence'
      when nullif(v.visit_date, '') is not null and public.safe_parse_iso_date(v.visit_date) is null then 'invalid_visit_date'
      when nullif(v.fee_aed, '') is not null and (regexp_replace(v.fee_aed, '[^0-9\.-]', '', 'g') = '' or regexp_replace(v.fee_aed, '[^0-9\.-]', '', 'g')::numeric < 0) then 'invalid_fee'
      else 'unknown'
    end,
    case
      when c.id is null then 'Clinic code was not found in clinics.code.'
      when cpf.id is null then 'Treatment row has no matching clinic patient file.'
      when v.visit_sequence is null or v.visit_sequence <= 0 then 'Visit sequence must be a positive integer.'
      when nullif(v.visit_date, '') is not null and public.safe_parse_iso_date(v.visit_date) is null then 'Visit date must be YYYY-MM-DD.'
      when nullif(v.fee_aed, '') is not null and (regexp_replace(v.fee_aed, '[^0-9\.-]', '', 'g') = '' or regexp_replace(v.fee_aed, '[^0-9\.-]', '', 'g')::numeric < 0) then 'Fee must be a valid non-negative amount.'
      else 'Invalid treatment visit row.'
    end,
    jsonb_build_object('clinic_code', v.clinic_code, 'file_no', v.file_no, 'visit_sequence', v.visit_sequence, 'dentist_name', v.dentist_name)
  from public.clinic_treatment_visit_import_staging v
  left join public.clinics c
    on upper(c.code) = upper(v.clinic_code)
  left join public.clinic_patient_files cpf
    on cpf.clinic_id = c.id
   and cpf.file_no = v.file_no
  where v.import_batch_id = p_import_batch_id
    and (
      c.id is null
      or cpf.id is null
      or v.visit_sequence is null
      or v.visit_sequence <= 0
      or (nullif(v.fee_aed, '') is not null and (regexp_replace(v.fee_aed, '[^0-9\.-]', '', 'g') = '' or regexp_replace(v.fee_aed, '[^0-9\.-]', '', 'g')::numeric < 0))
    );

  -- Insert normalized visits; idempotent on (batch,row,sequence).
  insert into public.patient_treatment_visits (
    clinic_id,
    patient_file_id,
    visit_sequence,
    visit_date,
    treatment_description,
    fee_aed,
    original_dentist_name,
    import_batch_id,
    source_row_number,
    source_visit_key
  )
  select
    c.id,
    cpf.id,
    v.visit_sequence,
    public.safe_parse_iso_date(v.visit_date),
    nullif(v.treatment_done, ''),
    case
      when nullif(v.fee_aed, '') is null then null
      else regexp_replace(v.fee_aed, '[^0-9\.-]', '', 'g')::numeric(12,2)
    end,
    nullif(v.dentist_name, ''),
    v.import_batch_id,
    v.source_row_number,
    md5(v.import_batch_id || ':' || v.source_row_number || ':' || v.visit_sequence)
  from public.clinic_treatment_visit_import_staging v
  join public.clinics c
    on upper(c.code) = upper(v.clinic_code)
  join public.clinic_patient_files cpf
    on cpf.clinic_id = c.id
   and cpf.file_no = v.file_no
  where v.import_batch_id = p_import_batch_id
    and not exists (
      select 1
      from public.clinic_import_exceptions e
      where e.import_batch_id = v.import_batch_id
        and e.source_table = 'clinic_treatment_visit_import_staging'
        and e.source_row_number = v.source_row_number
    )
  on conflict (import_batch_id, source_row_number, visit_sequence) do nothing;

  get diagnostics v_inserted_visits = row_count;

  return query
  select
    v_inserted_patient_files,
    v_inserted_visits,
    (
      select count(*)
      from public.clinic_import_exceptions
      where import_batch_id = p_import_batch_id
    )::int;
end;
$$;

grant execute on function public.import_clinic_patient_batch(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 7) Minimal clinic-membership model + RLS for new tables
-- ------------------------------------------------------------
alter table public.clinics add column if not exists code text;
create unique index if not exists clinics_code_unique_idx on public.clinics(upper(code)) where code is not null;

create table if not exists public.clinic_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'staff', 'receptionist')),
  created_at timestamptz not null default now(),
  primary key (user_id, clinic_id)
);

create or replace function public.is_clinic_admin(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.clinic_memberships m
    where m.user_id = p_user_id
      and m.role in ('admin', 'manager')
  );
$$;

create or replace function public.can_access_clinic(p_clinic_id uuid)
returns boolean
language sql
stable
as $$
  select
    auth.uid() is null
    or public.is_clinic_admin(auth.uid())
    or exists (
      select 1
      from public.clinic_memberships m
      where m.user_id = auth.uid()
        and m.clinic_id = p_clinic_id
    );
$$;

alter table public.clinic_patient_files enable row level security;
alter table public.patient_treatment_visits enable row level security;
alter table public.clinic_patient_import_staging enable row level security;
alter table public.clinic_treatment_visit_import_staging enable row level security;
alter table public.clinic_import_exceptions enable row level security;

drop policy if exists clinic_patient_files_select on public.clinic_patient_files;
create policy clinic_patient_files_select on public.clinic_patient_files
for select using (public.can_access_clinic(clinic_id));

drop policy if exists clinic_patient_files_insert on public.clinic_patient_files;
create policy clinic_patient_files_insert on public.clinic_patient_files
for insert with check (public.can_access_clinic(clinic_id));

drop policy if exists clinic_patient_files_update on public.clinic_patient_files;
create policy clinic_patient_files_update on public.clinic_patient_files
for update using (public.can_access_clinic(clinic_id))
with check (public.can_access_clinic(clinic_id));

drop policy if exists patient_treatment_visits_select on public.patient_treatment_visits;
create policy patient_treatment_visits_select on public.patient_treatment_visits
  for select using (true);

drop policy if exists patient_treatment_visits_insert on public.patient_treatment_visits;
create policy patient_treatment_visits_insert on public.patient_treatment_visits
  for insert with check (true);

drop policy if exists patient_treatment_visits_update on public.patient_treatment_visits;
create policy patient_treatment_visits_update on public.patient_treatment_visits
  for update using (true) with check (true);

drop policy if exists clinic_patient_import_staging_all on public.clinic_patient_import_staging;
create policy clinic_patient_import_staging_all on public.clinic_patient_import_staging
for all using (public.is_clinic_admin(auth.uid())) with check (public.is_clinic_admin(auth.uid()));

drop policy if exists clinic_treatment_visit_import_staging_all on public.clinic_treatment_visit_import_staging;
create policy clinic_treatment_visit_import_staging_all on public.clinic_treatment_visit_import_staging
for all using (public.is_clinic_admin(auth.uid())) with check (public.is_clinic_admin(auth.uid()));

drop policy if exists clinic_import_exceptions_all on public.clinic_import_exceptions;
create policy clinic_import_exceptions_all on public.clinic_import_exceptions
for all using (public.is_clinic_admin(auth.uid())) with check (public.is_clinic_admin(auth.uid()));

-- Verification queries (run manually after migration):
-- 1) Unique per clinic:
--    select clinic_id, file_no, count(*) from public.clinic_patient_files group by clinic_id, file_no having count(*) > 1;
-- 2) Counter readiness:
--    select c.name, c.code, coalesce(ct.next_value, 1) as next_value from public.clinics c left join public.clinic_file_number_counters ct on ct.clinic_id = c.id order by c.name;
-- 3) Backfill coverage:
--    select count(*) as receipts_without_patient_file from public.receipts where patient_id is not null and patient_file_id is null;
-- 4) Import exceptions:
--    select * from public.clinic_import_exceptions where import_batch_id = '<batch-id>' order by source_table, source_row_number;
