-- LOCAL TEST ONLY: production rollout is not approved.
-- Requires every patient read/write caller to use the checked server routes
-- and SUPABASE_SERVER_SECRET_KEY to be configured privately on the server.
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_patient_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_backup_exports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.patients, public.clinic_patient_files, public.patient_backup_exports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patients, public.clinic_patient_files, public.patient_backup_exports TO service_role;

DO $$
DECLARE existing record;
BEGIN
  FOR existing IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('patients', 'clinic_patient_files', 'patient_backup_exports')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', existing.policyname, existing.tablename);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.create_patient_with_clinic_file(text,text,text,text,text,text,text,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_patient_clinic_file(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_clinic_birthday_patients(uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_clinic_birthday_remaining_count(uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.import_clinic_patient_batch(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_clinic_file_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_patient_file_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_patient_with_clinic_file(text,text,text,text,text,text,text,text,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_patient_clinic_file(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_clinic_birthday_patients(uuid,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_clinic_birthday_remaining_count(uuid,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.import_clinic_patient_batch(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_clinic_file_number(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_patient_file_number() TO service_role;
