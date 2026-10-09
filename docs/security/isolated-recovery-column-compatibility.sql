-- Recovery-audit database ONLY. These are the six missing dump columns.
-- This permits a database-data recovery check; it is not a Storage server upgrade.
-- Types checked against Supabase Storage migrations 0062 and 0068.
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS versioning_status text NOT NULL DEFAULT 'DISABLED';
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS lifecycle_configuration jsonb;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS lifecycle_configuration_generation uuid;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS is_delete_marker boolean NOT NULL DEFAULT false;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS is_versioned boolean NOT NULL DEFAULT false;
