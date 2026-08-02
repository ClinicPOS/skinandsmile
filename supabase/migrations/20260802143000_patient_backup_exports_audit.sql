-- Patient backup export audit + session scope hardening.
-- Safe migration: additive only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'active_sessions'
  ) THEN
    ALTER TABLE public.active_sessions
      ADD COLUMN IF NOT EXISTS session_mode text,
      ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS user_role text,
      ADD COLUMN IF NOT EXISTS receptionist_id uuid REFERENCES public.receptionist(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'active_sessions'
  ) THEN
    CREATE INDEX IF NOT EXISTS active_sessions_token_idx ON public.active_sessions(token);
    CREATE INDEX IF NOT EXISTS active_sessions_clinic_scope_idx ON public.active_sessions(clinic_id, session_mode);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.patient_backup_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id text NOT NULL UNIQUE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE RESTRICT,
  session_token text,
  user_id uuid,
  receptionist_id uuid REFERENCES public.receptionist(id) ON DELETE SET NULL,
  exported_at timestamptz NOT NULL DEFAULT now(),
  filename text NOT NULL,
  patient_count integer NOT NULL DEFAULT 0 CHECK (patient_count >= 0),
  treatment_record_count integer NOT NULL DEFAULT 0 CHECK (treatment_record_count >= 0),
  export_status text NOT NULL DEFAULT 'started' CHECK (export_status IN ('started', 'success', 'failed')),
  error_message text
);

CREATE INDEX IF NOT EXISTS patient_backup_exports_clinic_idx
  ON public.patient_backup_exports(clinic_id, exported_at DESC);

CREATE INDEX IF NOT EXISTS patient_backup_exports_status_idx
  ON public.patient_backup_exports(export_status, exported_at DESC);

ALTER TABLE public.patient_backup_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_backup_exports_select ON public.patient_backup_exports;
DROP POLICY IF EXISTS patient_backup_exports_insert ON public.patient_backup_exports;
DROP POLICY IF EXISTS patient_backup_exports_update ON public.patient_backup_exports;

CREATE POLICY patient_backup_exports_select ON public.patient_backup_exports FOR SELECT USING (true);
CREATE POLICY patient_backup_exports_insert ON public.patient_backup_exports FOR INSERT WITH CHECK (true);
CREATE POLICY patient_backup_exports_update ON public.patient_backup_exports FOR UPDATE USING (true) WITH CHECK (true);
