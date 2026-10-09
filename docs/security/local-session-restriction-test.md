# Local session restriction test

Applied only to Docker container supabase_db_POS-Recovery-Test. Production was not modified.

Migration: supabase/migrations/20261006212910_restrict_login_session_access.sql.

Server code must have SUPABASE_SESSION_SECRET_KEY configured privately before restriction. The isolated test copy uses its existing local service-role key. Do not use a NEXT_PUBLIC variable and do not paste credentials into logs or version control. The original repo is not configured for a production cutover.

Verified: anon and authenticated SQL reads fail; service_role reads succeed. The local REST endpoint rejects the public anonymous key and accepts the server key. This does not secure other tables or prove all browser workflows.

Pending manual tests: refresh the test POS, create a new login, open a patient, open the manager session list, and revoke a disposable test session. Log back in afterward. Confirm report login/logout and patient export too.

## Emergency reversal for this local test only

The local table previously had RLS enabled, one permissive anon ALL policy named Allow app access, and ALL table privileges for anon and authenticated. To restore that exact known local configuration if troubleshooting requires it, run the following only inside the named recovery-test container in a transaction:

```sql
GRANT ALL ON TABLE public.active_sessions TO anon, authenticated;
CREATE POLICY "Allow app access" ON public.active_sessions
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

This deliberately restores the known unsafe access and is not a production recommendation. Service-role privileges were already present and were not revoked. Do not use this local snapshot as a production rollback without independently capturing production configuration at cutover.
