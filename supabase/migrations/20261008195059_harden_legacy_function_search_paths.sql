-- Keep legacy SQL names working, with trusted schemas ordered explicitly.
-- Public-schema CREATE is already revoked from untrusted roles by the prior migration.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
  'next_clinic_file_number','is_clinic_admin','can_access_clinic',
  'import_clinic_patient_batch','create_patient_with_clinic_file',
  'next_patient_file_number','safe_parse_iso_date','set_row_updated_at',
  'sync_clinic_counter_from_file_no','ensure_patient_clinic_file'
 ) LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp',item.signature);
 END LOOP;
END $$;
