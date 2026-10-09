-- Coordinate with protected clinical-note routes and server-only credentials.
-- This file is not approval to apply changes to production.
ALTER TABLE public.patient_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.patient_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.patient_notes TO service_role;
