# Local patient security verification — 7 October 2026

Status: GO for continued local testing. NO-GO for production deployment.

## Completed

- Session storage, session validation/revocation, clinical notes and patient reads/writes use authorized server operations.
- Patient search, clinic records, MRN lookup, history, birthdays, manager records/file indexes, EOD enrichment and backup exports no longer require direct public access to patient tables.
- Legacy registration screens use the existing atomic registration operation. Patient hard deletion is disabled pending an archive design.
- Clinic file numbers remain text, preserving leading zeros. Current numbers feed EOD exports. Shared demographics and existing clinic links are preserved.
- Patient-history failures clear displayed data and show an error. Clearing a clinic MRN now clears its local cached value too.

## Local database protection

Applied only locally:

1. 20261006212910_restrict_login_session_access.sql
2. 20261006213452_restrict_clinical_note_access.sql
3. 20261007103653_restrict_patient_record_access.sql

Anonymous and authenticated roles have no SELECT/INSERT/UPDATE/DELETE privileges on patients, clinic_patient_files and patient_backup_exports. Public access to seven patient-related functions is revoked. Protected server operations retain service-role access after session, role and clinic checks.

The prior patient permissions were captured in local-patient-permissions-rollback.sql. Rollback was rehearsed successfully, then restrictions were immediately reapplied. This snapshot is for the disposable local instance only and restores insecure old permissions; it is not a production rollback artifact.

## Evidence

- Production build and focused session, clinical-note, patient mutation, search, pagination, file-number/Excel and payment-refresh tests pass.
- Actual localhost HTTP tests verify both fake clinics, cross-clinic rejection, missing-session rejection, manager access and reports-only denial.
- Direct anonymous REST access to protected tables and patient functions is rejected.
- Local registration, demographic/file updates and duplicate-file rejection pass. Guessed foreign patient linking is rejected.
- Patient backup preview/download and export audit counts reconcile. Workbook register rows match independent clinic-file records, including text file numbers.
- The actual EOD export function runs against restrictive local Supabase: expected sheets, treatment-plan collection totals, patient names and current file labels reconcile with independent source queries.
- Integration tests use only localhost and fake records. Temporary sessions, new fake patients and export audit rows are cleaned up. Existing payments are not changed.
- The user previously confirmed local profile, file-number, refresh and export screen tests. Automated export checks do not replace visual testing of every manager screen or prove a complete database disaster recovery.

## Remaining production gates

- Receipt, payment, balance and treatment-plan browser access still requires server authorization and database permission hardening. Existing refund permissions need review.
- Production server-only credentials and isolated Preview settings must be configured and verified; never test writes against production through Preview.
- Verify a complete backup restore, record exact production application/database rollback state, test concurrent financial operations and coordinate the release window.
- No commit, push, deployment or live database change was performed in this stage.

VOID/revisions, appointment integration and per-visit doctor-income attribution remain separate features.
