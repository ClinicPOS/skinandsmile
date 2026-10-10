# Local workflow review — 10 October 2026

Production is in use. No push, deployment, live database change or live test transaction was performed for this review.

## Treatment-plan fix

New plans have zero saved visits. A clinic patient file is an identity link, not evidence of treatment. Completed visits now count saved `treatment_plan_visits` rows in the patient profile, owner backend, history, payment invoices and EOD export. Historical imported visit rows continue to count.

The new migration replaces only `record_treatment_plan_visit`; it does not update/delete plans, visit history, payments or doctor attribution. New visits require an active doctor in the same clinic. Existing visit numbers are retained; next numbers remain greater than the saved maximum, even if older numbering contains gaps. Concurrent submissions and identical retries remain protected by the plan lock and request ID.

Local end-to-end checks verified creation at zero, visits 1 through 5 with doctor attribution, completion on the fifth saved visit, rejection of visit 6, payments creating no visits, imported history retention, concurrent limit enforcement and idempotent retry.

## Verification

All existing `*-tests.mjs` suites passed. All existing local integration suites passed, with the checkout suite rerun successfully after correcting an EOD test assumption about receipt-only fixtures. That assertion now compares receipt-only payment methods only when plan, old-balance, prepayment and earlier-receipt refund collections are absent; the overall financial reconciliation still always runs. The session test harness now loads the current API-key helper instead of a stale empty mock.

Covered local workflows: patient registration/search/history and notes; clinic isolation and private reads; owner/manager permissions, staff revocation and password changes; register ownership and closing; full/partial/split/BNPL checkout, discounts, credits and concurrent retries; old balances, deposits and treatment-plan payments; plan cancellation; refund request/approval/return and whole-receipt void; EOD reconciliation/export; doctor ranking calculations and invoice PDF asset restrictions.

TypeScript and production build passed. A transaction that reapplied the new migration and compared exact hashes of every existing local plan and visit row passed, then rolled back.

## Deployment remains pending

The running site still has the old visit-count logic. Coordinate this app/function change after clinic closing with a fresh backup and the pending manager-operations release. Review production migration metadata before applying either new migration. Do not rewrite older migrations or automatically renumber/delete historical visits. Existing historical records without doctors must remain unattributed unless separately verified.

These results cover the listed automated scenarios and code review, not proof that every possible system state is flawless. No real email sending, physical printer test, or production data repair was performed in this review.
