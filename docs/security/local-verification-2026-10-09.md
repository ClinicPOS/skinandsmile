# Local verification, 9 October 2026

Production was not changed, pushed or deployed. Tests used localhost:3001 and the disposable POS-Recovery-Test database. Fake financial fixtures remain for audit; temporary test sessions were removed.

## Verified

- Next.js 16.3.8 production build and TypeScript passed after the reporting and invoice fixes.
- Patient registration/editing, duplicate file numbers, clinic access, history, birthdays and protected export workflows passed after function search-path hardening.
- Checkout, register ownership/concurrent opening/stale reconciliation, balance payments, treatment-plan payments, cancellation, doctor-attributed visits, manager permissions, refunds and whole-receipt void tests passed against the patched local server.
- Actual CEO and Excel EOD gross/net collections, deductions, cash, clinic totals and daily trend reconcile for the 8 October fixtures.
- A newly created fake previous-month receipt was refunded on 9 October. Today's gross collections stayed unchanged; today's net collection and cash decreased by AED 210. The actual EOD export and CEO comparison passed for this refund-only day, including its refund details sheet.
- PDF generation rejects anonymous access/malformed requests and renders a fake invoice with a blocked private-resource image. JavaScript stays disabled; asset/font waits are bounded without page-script evaluation. Asset-policy checks reject private API/database URLs, arbitrary origins, file access, scripts and writes.
- Local metadata audit: zero public base tables without row-level security, zero public base tables accessible to anonymous users, zero anonymous-executable public security-definer functions.
- Production dependency audit: zero reported vulnerabilities after the scoped ExcelJS UUID override. Five high development-only findings remain in the ESLint/braces dependency chain; an unavailable patch or incompatible downgrade was not applied. ExcelJS workbook round-trip/formatting checks passed.

## Database rehearsal evidence and limits

The first 23 migrations committed successfully in the isolated restored-backup database, with every original public record fingerprint preserved. Windows PowerShell incorrectly treated the success NOTICE as a native-command error; the verification script now handles that case and checks the actual exit code. The read-only foreign-key audit passed all 164 relationships.

Migration 24 changes only the search paths of legacy functions. It was applied to the disposable test database and restored audit copy; patient workflows passed afterwards. Do not rerun the initial migration sequence on an already migrated audit copy.

### Fresh backup rehearsal completed

The verified 9 October backup at `C:\Clinic-Backups\Current-POS\Daily\2026-10-09` was restored into the new isolated database `pos_restore_audit_20261009`. The local Auth/Storage structure was inherited from the prior compatible recovery copy; its application/private schemas and Auth/Storage records were cleared only inside this new database before restoring the fresh backup. Production roles were not applied to the shared local cluster: the roles file contains only role timeout settings, and all required local roles already existed.

The restore completed in one transaction: all 72 dump table row counts matched and all 145 original foreign-key relationships passed. All 24 migrations then completed in one transaction with every original public record fingerprint unchanged and all 164 resulting foreign-key relationships valid. The final audit found zero public base tables without row-level security, zero anonymous table/view access and zero anonymous-executable public security-definer functions. Public connection access to the isolated recovery database is revoked. The running fake-data POS database and earlier recovery copy were not modified.

Backup SHA256 fingerprints:

- schema.sql: `602430D2C1BF95B8710AD5439C0813348B7AF4286D11006E196D91C2618B618B`
- data.sql: `2C2036126861D515BBB9CC1D153EC7AE1340EB025E21E625FB2C1BFAB9B07A45`

Private restore and migration logs are in the existing private outputs folder. No live database connection, deployment or push was performed.

## Before live cutover

1. Completed: fresh production backup verified and complete migration order rehearsed on a separate copy. Recheck for later production activity before cutover; a newer backup is needed if records change after this backup.
2. Provision real named owner/manager accounts and verify private server/session secrets and deployment settings. Demo accounts and local credentials must never be deployed.
3. Coordinate database changes, application deployment and rollback during the agreed closure window; verify live login, checkout, refund/void, clinic isolation and EOD immediately afterwards.

These checks support local readiness, not a claim that all production data and hosting configuration have already been verified. Treatment-plan ranking credit remains pending until managers agree its stage values. The requested later receptionist-login simplification is separate from this verified release scope.
