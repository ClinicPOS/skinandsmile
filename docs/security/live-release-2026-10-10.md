# Live POS release — 10 October 2026

This record supersedes earlier local-only readiness notes. The live application and database security update have been applied.

## Verified release

- Application commit: `9b976ea2399293011b82a77c95462b1fe8f637eb`.
- Vercel production deployment was Ready for that commit. Live site: https://skinandsmile.vercel.app.
- Fresh backup completed at 01:15:42 Dubai time. Local SQL source: `C:\Clinic-Backups\Current-POS\Daily\2026-10-10`. The encrypted Google Drive archive passed integrity and checksum checks according to the backup log.
- Fresh disposable restore matched all 72 original public table counts. Original 145 foreign-key relationships passed; 164 passed after the release migrations.
- The 24 release migrations were applied together in an explicit transaction, with exact before/after fingerprints of original public records and relationship checks. The operation succeeded; those preservation checks did not raise an error.
- Applied bundle: `secure_pos_release_20261010`, recorded remote migration version `20261009212851`.
- Post-release audit: zero public base tables without row-level security, zero anonymous table/view read or write grants, and zero anonymous executable public security-definer functions.
- Read-only live smoke checks passed: login pages loaded; unsigned private API calls and anonymous direct reads of patients, receipts, receptionist and session tables were denied.
- The owner confirmed that the live owner backend opens after login.
- No live test receipt, payment, refund or patient alteration was created during these checks.

## Remaining operational checks

- Receptionist login and viewing existing patients/receipt history still require operator confirmation before reopening the clinic.
- Configure actual manager accounts and clinic permissions through the owner backend. Do not invent staff identities or share the owner password.
- Treatment-plan doctor ranking credit remains pending where the clinic has not agreed on attribution values. Existing historical doctor attribution was preserved.

## Future migration and recovery boundaries

Do not run a blind `supabase db push`. The remote history records today's changes as one atomic bundle, while the repository retains individual migration files, including older existing-schema migrations. Reconcile migration history with the already-applied live schema before the next database release; do not rerun the SQL merely to fill history entries.

The local permission rollback SQL is not a production rollback snapshot. An application rollback alone may be incompatible with the new permissions. If recovery is needed, pause writes and review application/database compatibility together. Never overwrite live data with an older backup to undo a code release.

The original `.env.local` points at production. Keep interactive testing on the isolated local test copy. Never publish server secret keys or use them in browser code.
