-- Atomic patient + clinic file creation.
-- Called from the POS when a new patient is registered at checkout.
-- Either both rows are committed or neither is — no orphaned patients.

CREATE OR REPLACE FUNCTION public.create_patient_with_clinic_file(
  p_name             TEXT,
  p_phone            TEXT,
  p_email            TEXT,
  p_date_of_birth    TEXT,
  p_sex              TEXT,
  p_nationality      TEXT,
  p_emirates_id      TEXT,
  p_passport_number  TEXT,
  p_mrn_input        TEXT,
  p_clinic_id        UUID,
  p_file_no          TEXT          -- pass '' to auto-assign
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_patient_id   UUID;
  v_file_id      UUID;
  v_file_no      TEXT := NULLIF(TRIM(p_file_no), '');
BEGIN
  -- Auto-assign file number when not provided
  IF v_file_no IS NULL THEN
    SELECT public.next_clinic_file_number(p_clinic_id) INTO v_file_no;
  END IF;

  -- Guard: file number must not already exist in this clinic
  IF EXISTS (
    SELECT 1 FROM public.clinic_patient_files
    WHERE clinic_id = p_clinic_id AND file_no = v_file_no
  ) THEN
    RAISE EXCEPTION 'File number % is already taken in this clinic.', v_file_no;
  END IF;

  -- Insert patient
  INSERT INTO public.patients (
    name, phone, email, date_of_birth, sex, nationality,
    emirates_id, passport_number, mrn
  )
  VALUES (
    TRIM(p_name),
    COALESCE(NULLIF(TRIM(p_phone), ''), ''),
    NULLIF(TRIM(p_email), ''),
    NULLIF(TRIM(p_date_of_birth), '')::date,
    NULLIF(TRIM(p_sex), ''),
    NULLIF(TRIM(p_nationality), ''),
    NULLIF(TRIM(p_emirates_id), ''),
    NULLIF(TRIM(p_passport_number), ''),
    NULLIF(TRIM(p_mrn_input), '')
  )
  RETURNING id INTO v_patient_id;

  -- Insert clinic patient file in the same transaction
  INSERT INTO public.clinic_patient_files (clinic_id, patient_id, file_no, mrn, is_active)
  VALUES (
    p_clinic_id,
    v_patient_id,
    v_file_no,
    NULLIF(TRIM(p_mrn_input), ''),
    TRUE
  )
  RETURNING id INTO v_file_id;

  RETURN jsonb_build_object(
    'patient_id',            v_patient_id,
    'clinic_patient_file_id', v_file_id,
    'file_no',               v_file_no
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise so the caller sees the real error; the transaction is rolled back automatically.
    RAISE;
END;
$$;

-- Grant execute to anon and authenticated (same as other RPC functions in this app)
GRANT EXECUTE ON FUNCTION public.create_patient_with_clinic_file(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT
) TO anon, authenticated;
