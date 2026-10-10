# POS database security rollout preparation

Historical preparation document. For the applied live release and current remaining checks, see [live-release-2026-10-10.md](live-release-2026-10-10.md).

Status: session, clinical-note and patient-access stages are implemented and tested locally. Three permission migrations have been applied only to disposable local Supabase. Production deployment is not approved; financial access, production credentials and recovery verification remain release gates.

## Confirmed starting point

- The app uses its own app-auth cookie and active_sessions table, rather than a Supabase Auth identity for each employee.
- At the starting point, browser and server clients used the same public anonymous key. Protected local session, note and patient operations now use server-only credentials after authorization.
- Production patients and active_sessions have anonymous ALL policies with unconditional expressions. clinic_patient_files has unconditional select/insert/update policies. patient_notes has anonymous grants and no row-level security.
- Shared patient demographics are linked to clinic-specific files. Thirty production patients have links to more than one clinic. Do not split or backfill these patients during security work.
- Existing feature routes, columns and file-number constraints exist. This does not mean database access is protected.
- database-access-inventory.json lists static table/RPC access sites. Indirect helper calls, dynamic table names, REST calls, views and function internals require manual follow-up; it is not a complete permission specification.

## Recommended transition

Use the existing server session model for the first migration, with explicit authorization in each server operation. Move protected data access out of the browser before removing anonymous permissions. Do not introduce an unrestricted SQL/RPC proxy. A privileged database credential must be server-only, never a NEXT_PUBLIC variable, never copied to the frontend, and every route must verify session, role, clinic and entity membership first.

This is an intermediate architecture. Individual employee identity and Supabase Auth can be a later coordinated migration. Do not switch authentication or patient ownership silently during this release.

## Implementation sequence

1. Inventory login, session creation/lookup/revocation, PIN verification, report login, patient reads/writes, receipt/payment reads/writes, treatment plans, doctor reports, exports, and administration. Inspect views, SECURITY DEFINER functions and grants as well as tables.
2. Build the server-only database client and a central authorization layer; test missing/invalid sessions, invalid roles, cross-clinic IDs, and reports-only sessions. Session storage must not remain publicly readable or writable in the final state.
3. Migrate login/session flows and protected browser reads first, then patient, clinical notes and administrative writes. Preserve legacy data behavior; make ambiguous unscoped notes manager-only pending an explicit ownership rule.
4. Migrate receipts, payments and treatment-plan operations. Preserve existing transactional database functions, duplicate protections, payment allocation rules and doctor attribution. Add retry/idempotency coverage for financial operations rather than relying on browser button disabling.
5. Prepare explicit, versioned grants/RLS/function changes for a disposable local Supabase instance. Do not issue blanket revokes against production. Audit functions and views for alternative access paths.
6. Prove anonymous users cannot read or mutate protected tables, session tokens or protected functions, while every authorized clinic workflow succeeds. Use fake records only.
7. Verify Excel/PDF exports, daily totals, refunds, partial payments, balances, multiple plans, manager views and both clinics. Test two concurrent cashiers and interrupted requests.
8. Verify a backup restore, document the exact previous Vercel deployment and database permission snapshot, and reconcile restored counts. A Vercel rollback does not restore data or database grants.
9. Schedule a brief write pause, deploy compatible server paths before permission restriction, coordinate the final permission change with the browser release, revoke old sessions if required, and smoke-test both clinics before reopening writes.

## Release gates

- No protected anonymous table, view, session or function access remains.
- No privileged key enters browser code, logs, repository or exported files.
- Invalid sessions and roles fail closed; employee/doctor/entity IDs are verified against the authorized clinic.
- Browser testing uses local/test database credentials. Vercel Preview currently shares production Supabase settings according to prior screenshots; verify and isolate it before testing there.
- All critical clinic flows pass against the restrictive test schema, including exports and payment concurrency.
- Backup recovery and application/database rollback procedures are verified.
- Clinic approves shared patient identity versus independent records as a separate data-model decision.

## Rollback boundaries

During a failed cutover, pause writes and restore the recorded application and database access configuration together. Avoid reverting only the website while leaving incompatible permissions. Restoring permissive policies reintroduces the known exposure, so treat it as a temporary emergency measure. Never restore an old production data dump over newer patient/payment records to undo a code release. Preserve and reconcile writes made during the release window.

## Pending decisions

- Shared patient demographics with clinic-specific records, or independent patients? Default for this security migration: preserve current links.
- Which manager roles may view/edit both clinics, and which employees may perform refunds/voids?
- Where will server-only production credentials be managed and who may access them?
- What downtime window, backup retention and recovery target will the clinic accept?

VOID receipts, treatment-plan revisions, appointment integration and new doctor-income policy remain separate features.
