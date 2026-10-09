-- Browser database access is replaced by authenticated, clinic-scoped server routes.
-- Retain all records and service-role access; do not modify managed Auth/Storage schemas.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT table_name, column_name, grantee FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND grantee IN ('PUBLIC','anon','authenticated') LOOP
    EXECUTE format('REVOKE ALL (%I) ON public.%I FROM %I', item.column_name, item.table_name, item.grantee);
  END LOOP;
  FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.relname);
  END LOOP;
END $$;
