-- Read-only schema discovery for clinic RLS/auth linkage.
-- Run in non-production first, then share results before enforcing strict RLS.

select table_schema, table_name
from information_schema.tables
where table_schema in ('public', 'auth')
  and table_name in (
    'users',
    'clinic_memberships',
    'receptionist',
    'clinics',
    'patients',
    'clinic_patient_files',
    'receipts',
    'treatment_plans',
    'patient_treatment_visits'
  )
order by table_schema, table_name;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema in ('public', 'auth')
  and table_name in (
    'users',
    'clinic_memberships',
    'receptionist',
    'clinics',
    'patients',
    'clinic_patient_files',
    'receipts',
    'treatment_plans',
    'patient_treatment_visits'
  )
order by table_schema, table_name, ordinal_position;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

