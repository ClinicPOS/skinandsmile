param([switch]$RehearseDatabase, [ValidateSet('pos_restore_audit_20261008','pos_restore_audit_20261009','pos_restore_audit_20261010')][string]$RehearsalDatabase='pos_restore_audit_20261008')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
if (-not $RehearseDatabase) {
    & npx.cmd tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'Type checks failed. Stop here.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. Stop here.' }
    Write-Host 'PASS: type checks and production build. No deployment or database change.'
    exit 0
}
# This switch modifies ONLY the separate, restored local audit database.
# All migration changes roll back if a migration or preservation check fails.
$dockerExe = 'C:\Users\Manex\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
$outputFolder = 'C:\Users\Manex\Documents\Codex\2026-10-05\referenced-chatgpt-conversation-this-is-an\outputs'
if (-not (Test-Path -LiteralPath $outputFolder)) { throw 'The expected local audit output folder is missing.' }
$sqlFile = Join-Path $outputFolder ("complete-local-migration-rehearsal-$RehearsalDatabase.sql")
$logFile = Join-Path $outputFolder ("complete-local-migration-rehearsal-$RehearsalDatabase.log")
$before = @'
DO $$ BEGIN
 IF current_database() <> 'pos_restore_audit_20261008' THEN
  RAISE EXCEPTION 'Wrong database: stop rehearsal';
 END IF;
 IF to_regclass('public.pos_accounts') IS NOT NULL THEN
  RAISE EXCEPTION 'This copy already has the migration. Do not reapply.';
 END IF;
END $$;
CREATE TEMP TABLE original_record_fingerprints(table_name text, projection text, row_count bigint, fingerprint text);
DO $$ DECLARE item record; fields text; saved_count bigint; saved_hash text; BEGIN
 FOR item IN SELECT c.relname, c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
  SELECT string_agg(format('%I',attname),',' ORDER BY attnum) INTO fields
  FROM pg_attribute WHERE attrelid=item.oid AND attnum>0 AND NOT attisdropped;
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(row_to_json(original)::text,chr(10) ORDER BY row_to_json(original)::text),'''')) FROM (SELECT %s FROM public.%I) original',fields,item.relname)
  INTO saved_count,saved_hash;
  INSERT INTO original_record_fingerprints VALUES(item.relname,fields,saved_count,saved_hash);
 END LOOP;
END $$;
'@
$after = @'
DO $$ DECLARE item record; actual_count bigint; actual_hash text; BEGIN
 FOR item IN SELECT * FROM original_record_fingerprints LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(row_to_json(original)::text,chr(10) ORDER BY row_to_json(original)::text),'''')) FROM (SELECT %s FROM public.%I) original',item.projection,item.table_name)
  INTO actual_count,actual_hash;
  IF actual_count<>item.row_count OR actual_hash<>item.fingerprint THEN
   RAISE EXCEPTION 'Original records changed in table %; rolling back',item.table_name;
  END IF;
 END LOOP;
 RAISE NOTICE 'PASS: all original public table records preserved exactly';
END $$;
'@
$migrationFiles = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'supabase\migrations') -Filter '2026100*.sql' | Sort-Object Name
if ($migrationFiles.Count -ne 24) { throw 'Migration list changed. Review before running this rehearsal.' }
$migrationText = ($migrationFiles | ForEach-Object {
    '-- migration: ' + $_.Name + [Environment]::NewLine + (Get-Content -LiteralPath $_.FullName -Raw)
}) -join [Environment]::NewLine
$integrityText = Get-Content -LiteralPath (Join-Path $repoRoot 'docs\security\isolated-recovery-integrity-check.sql') -Raw
$before = $before.Replace('pos_restore_audit_20261008', $RehearsalDatabase)
($before + [Environment]::NewLine + $migrationText + [Environment]::NewLine + $after + [Environment]::NewLine + $integrityText) | Set-Content -LiteralPath $sqlFile -Encoding utf8
& $dockerExe cp $sqlFile 'supabase_db_POS-Recovery-Test:/tmp/complete-local-migration-rehearsal.sql'
if ($LASTEXITCODE -ne 0) { throw 'Could not copy the local rehearsal file.' }
$previousErrorPreference = $ErrorActionPreference
try {
    # Windows PowerShell treats native stderr notices as errors. PostgreSQL
    # writes normal NOTICE messages there too; use its exit code for success.
    $ErrorActionPreference = 'Continue'
    & $dockerExe exec supabase_db_POS-Recovery-Test psql -U supabase_admin -d $RehearsalDatabase --single-transaction --set=ON_ERROR_STOP=1 --file=/tmp/complete-local-migration-rehearsal.sql *> $logFile
    $databaseExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorPreference
}
if ($databaseExitCode -ne 0) { throw "Local migration rehearsal failed. Check the private log before retrying: $logFile" }
Write-Host 'PASS: 24 migrations, unchanged original records and relationship integrity in the separate local recovery copy. Production was not contacted.'
