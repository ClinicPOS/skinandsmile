-- Fix the import function so empty phone/nationality values are stored as empty strings,
-- avoiding NOT NULL constraint failures on existing patients tables.

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
