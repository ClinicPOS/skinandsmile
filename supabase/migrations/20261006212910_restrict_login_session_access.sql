-- Apply only after deploying and verifying server-only session storage.
-- Not approved for production execution by this file's existence.
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.active_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.active_sessions TO service_role;

-- Remove legacy anonymous authorization, in addition to table grants.
DROP POLICY IF EXISTS "Allow app access" ON public.active_sessions;
