-- Phase 5: POS independent registration support.
-- Adds an atomic helper RPC for outcome A/B:
-- - Existing patient already linked to clinic => return existing file
-- - Existing patient not linked => create clinic_patient_files row safely

create or replace function public.ensure_patient_clinic_file(
  p_patient_id uuid,
  p_clinic_id uuid,
  p_mrn_input text default null,
  p_file_no text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_patient_exists boolean;
  v_existing_file_id uuid;
  v_existing_file_no text;
  v_file_no text := nullif(trim(coalesce(p_file_no, '')), '');
  v_created_file_id uuid;
  v_created_file_no text;
  v_clinic_file_created boolean := false;
begin
  if p_patient_id is null then
    raise exception 'patient id is required';
  end if;
  if p_clinic_id is null then
    raise exception 'clinic id is required';
  end if;

  select exists(select 1 from public.patients where id = p_patient_id)
  into v_patient_exists;
  if not v_patient_exists then
    raise exception 'patient not found';
  end if;

  -- Outcome A: already linked to this clinic.
  select cpf.id, cpf.file_no
  into v_existing_file_id, v_existing_file_no
  from public.clinic_patient_files cpf
  where cpf.clinic_id = p_clinic_id
    and cpf.patient_id = p_patient_id
  limit 1;

  if v_existing_file_id is not null then
    return jsonb_build_object(
      'patient_id', p_patient_id,
      'clinic_patient_file_id', v_existing_file_id,
      'file_no', v_existing_file_no,
      'clinic_file_created', false
    );
  end if;

  -- Outcome B: existing patient, new clinic link.
  if v_file_no is null then
    select public.next_clinic_file_number(p_clinic_id) into v_file_no;
  end if;

  if exists (
    select 1
    from public.clinic_patient_files
    where clinic_id = p_clinic_id
      and file_no = v_file_no
  ) then
    raise exception 'File number % is already taken in this clinic.', v_file_no;
  end if;

  insert into public.clinic_patient_files (clinic_id, patient_id, file_no, mrn, is_active)
  values (
    p_clinic_id,
    p_patient_id,
    v_file_no,
    nullif(trim(coalesce(p_mrn_input, '')), ''),
    true
  )
  on conflict (clinic_id, patient_id) do nothing
  returning id, file_no into v_created_file_id, v_created_file_no;

  if v_created_file_id is not null then
    v_clinic_file_created := true;
  end if;

  if v_created_file_id is null then
    select cpf.id, cpf.file_no
    into v_created_file_id, v_created_file_no
    from public.clinic_patient_files cpf
    where cpf.clinic_id = p_clinic_id
      and cpf.patient_id = p_patient_id
    limit 1;
  end if;

  if v_created_file_id is null then
    raise exception 'Failed to create or retrieve clinic patient file.';
  end if;

  return jsonb_build_object(
    'patient_id', p_patient_id,
    'clinic_patient_file_id', v_created_file_id,
    'file_no', v_created_file_no,
    'clinic_file_created', v_clinic_file_created
  );
end;
$$;

grant execute on function public.ensure_patient_clinic_file(uuid, uuid, text, text) to anon, authenticated;
