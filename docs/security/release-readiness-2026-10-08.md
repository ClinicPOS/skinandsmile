Updated local results: see [local completion checkpoint](local-completion-checkpoint-2026-10-08.md). Several application and recovery blockers below have since been addressed locally; production remains NO-GO.

# Release and live Supabase security review — 8 October 2026

**Decision: NO-GO for production deployment or bulk security migration. GO for staged local remediation.** This review made no live database changes, commits, pushes or deployments. Live checks used project metadata, security advisors, migration listing and read-only SQL against schema/grant/policy metadata, not patient records. No evidence of a breach was sought or established.

## Live project confirmed

Project vkcwmzdtypetqtqceazy is skin-smile-pos, ACTIVE_HEALTHY, Singapore region, PostgreSQL 17.6.1.127. Healthy describes operation, not access security. The POS connector account successfully accessed this exact project.

Security advisors reported:

- Nine public tables with RLS disabled: patient_notes, outstanding_balances, patient_credits, balance_payments, treatment_plans, clinic_file_number_counters, treatment_plan_payments, clinic_memberships, treatment_plan_visits. Catalog checks also confirmed anonymous SELECT/INSERT/UPDATE/DELETE grants on these tables.
- Ten functions with mutable search_path. Fix individually with schema-qualified references and regression tests, not an untested blanket search_path change.
- Six SECURITY DEFINER functions executable by anonymous clients, with corresponding authenticated-role findings: create_legacy_receipt_refund, create_patient_with_clinic_file, create_payment_allocation_refund, create_payment_record_with_allocations, create_treatment_plan_payment_record_with_allocations, ensure_patient_clinic_file. Financial and patient operations must validate identities server-side; changing table RLS alone does not close privileged functions.

Additional catalog findings beyond the nine disabled-RLS tables:

- active_sessions, patients, receipts, receipt_items, receptionist, refunds, refund_items, clinics, doctors, services, login_logs and cash_register_sessions have anonymous ALL policies using/checking true. Other tables have permissive public policies. These allow the anonymous API role to operate within its grants without POS-login authorization. UI passwords do not constrain these database paths.
- public.can_access_clinic explicitly allows auth.uid() IS NULL. Policies using that helper do not restrict anonymous callers to a clinic.
- clinic_memberships itself has no RLS and anonymous write grants; it is used by admin/clinic authorization helpers.
- Checking grants alone is not enough to prove row access on RLS-enabled tables. Findings here include the applicable policy expressions; no exploit/write test was performed live.

References: [disabled RLS](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [function search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [anonymous privileged functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Compatibility blockers

Live has no receipts.status/original_receipt_id/replacement_receipt_id/voided_at, no active_sessions.account_id, and no outstanding_balances.cancelled_original_amount. New pos_accounts, pos_manager_access, receipt_refund_requests, pos_checkout_requests and activity_log are absent. Supabase's migration listing returned an empty array; this is not an empty database, but it means the current schema cannot be assumed to have the repository's migration history. Baseline and reconcile it before applying migrations, especially non-idempotent CREATE/ALTER/RENAME statements.

The local application depends on private server session/data credentials and a verified named owner. Vercel configuration, production owner provisioning and preview-versus-production isolation were not verified this turn. The old deployed client cannot safely run against all local access revocations. Deployment/migration order and a maintenance/read-only window must be rehearsed.

## Remaining application and reporting blockers

1. app/receipts/page.tsx getCashCollectedSinceOpen still sums receipts by amount_paid/total without excluding VOIDED and without the refund ledger. EOD success does not validate the till-close calculation.
2. app/receipt-log/receipt-log-client.tsx retains the old direct refund operation and linked-balance hard deletion. Local grants may deny it, but the screen remains incompatible with the approved request workflow. Remove or route it through the protected flow.
3. app/backend/backend-page-client.tsx still deletes treatment-plan payments, visits and plans separately, and hard-deletes outstanding balances. Treatment-plan void remains unfinished.
4. app/api/reports/ceo-dashboard/route.ts doctor ranking assigns an entire receipt to the last item doctor found, falling back to receipt doctor. It does not subtract refunded treatment from that ranking. Monetary award accuracy is not ready for mixed-doctor receipts/refunds. Per-visit doctor capture is implemented, but treatment-plan values remain pending by clinic decision.
5. app/receipt-history/page.tsx, app/treatment-history/page.tsx, profile history and alternate exports/reprints need consistent retained VOIDED labels and financial exclusion. Displaying originals in history is correct; summing them as active business is not.
6. Whole receipt void currently cancels the mistaken recorded collection, with manager acknowledgement, and does not transfer actual funds or require a replacement. Wrong-price cases require a correct receipt and till reconciliation. Clinical-plan-linked, prior-day, credit, fee and later-balance-payment cases are blocked in the local flow; this does not yet cover every live clinic use case.
7. EOD tests cover current-day fake receipt-only fixtures, including full/partial refunds and retained BNPL fees. Earlier-sale/later-refund, mixed methods, discounts, credits, plan collections and historical exports require wider reconciliation tests before claiming universal equality between sheets. Invoice/sales and cash collections are different measures.
8. app/api/auth/login/route.ts still accepts hardcoded shared-password alternatives. Receptionist PIN verification also starts from browser-visible receptionist data, and the new PIN endpoint uses process-local attempt limiting. Replace shared/hardcoded secrets, remove browser PIN reads and use durable rate limiting before claiming production authentication security.
9. Browser queries/writes remain for treatment plans, payments, cash shifts, credits, balances and catalog/staff administration. Blind RLS denial would break these. Migrate each to a clinic-scoped authenticated server route or verified Supabase identity policy before revocation.

## Recovery evidence

The latest available restore-log-attempt2.txt under C:\Clinic-Backups\POS-Recovery-Test ends in a failed restore due to schema incompatibility. Existing recovery work then used fake local fixtures. This is not proof that the production backup restores completely. The backup-review documentation describes offline fake-tool checks, not successful full real recovery or confirmed remote Drive sync. No live backup export or restore was attempted in this review.

Required: obtain a consistent backup in a quiet period, restore into a separate database, verify schema/functions/grants, aggregate row counts, relationships, sequences, financial totals and app reads. Include actual Storage objects separately where used; database metadata alone does not restore files. Keep the original backup intact.

## Safest implementation order

1. Freeze feature scope and establish a live schema baseline plus proven recovery.
2. Close session-token exposure first using verified server-only storage and a compatible application release; test login, logout, revocation and every role. Do not revoke the old deployment's access before its replacement is operational.
3. Protect patient/clinical data through server routes, then revoke anonymous grants/RPC execution and enable appropriate RLS. Repeat deny tests for other clinics and unauthenticated clients.
4. Finish financial/treatment-plan/shift server operations, eliminate legacy bypasses and financial hard deletes, and reconcile every totals/report path.
5. Protect permissions/membership, catalog and reporting tables; harden function search paths. Never use an allow-everyone policy just to remove the advisor warning.
6. Rehearse migrations against the verified live-schema clone without overwriting old receipts/IDs. Provision real owner/managers and private Vercel credentials. Ensure previews cannot mutate production.
7. Controlled release after clinic closing, compatible migration/app sequence, smoke tests and rerun security advisors. Retain original financial records and audit trail.

Rollback must be a matched code/database plan. Additive financial records cannot safely be erased by reverting code; old clients may not support new grants/statuses. Prefer a tested roll-forward fix for access/reporting errors. Use a full restore only with explicit downtime and a plan for transactions created after the backup.

## Verification in this review

Session security, patient mutation security, clinical-note access, CEO calculation tests, refund approval UI and profile payment refresh tests passed. The fresh production build passed, including TypeScript and 38 generated pages; it reported middleware-convention deprecation. Previous local integration/manual results cover checkout, refunds/voids, EOD and per-visit doctors; they are not production proof.

Fresh npm audit reported 8 vulnerabilities: 6 high, 2 moderate, 0 critical, including Next.js, ESLint-related dependency chains, ExcelJS and uuid. Some suggested automatic fixes are downgrades/major changes; do not run npm audit fix --force. Review the exact advisory and choose compatible upgrades with regression tests. Not all findings necessarily affect production runtime, but they cannot be dismissed without reviewing reachability. No dependency versions were changed.

No universal no-disruption guarantee is possible before the remaining compatibility/recovery work.
