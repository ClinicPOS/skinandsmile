# Local Activity Log and Correction Approvers

Implemented and verified on 7 October 2026 against the disposable localhost Supabase and isolated test application. No production migration, commit, push or deployment was performed.

## Available locally

- Backend → Activity Log: administrator-only, clinic and record filters, All clinics including shared patient changes, pagination, UAE timestamps, reasons and before/after snapshots.
- Backend → Correction Approvers: per-clinic primary, optional backup and dated temporary replacement; mandatory change reason and optimistic concurrency protection. Temporary cover includes both dates and automatically falls back to the primary outside that period.
- Existing staff directory is reused. Cross-clinic staff can cover another clinic. These settings do not yet authorize refund/void execution.
- Shared administrator sessions are labelled as shared, without inventing a person's identity. Verified staff IDs are resolved to their current staff-directory names. Historical names are not snapshotted yet.
- New database changes on patients, clinic files, notes, receipts/items, treatment plans/visits/payments, payment records/allocations, refunds/items/allocations, balances/payments, credits and approver settings create audit entries in the same transaction. Existing historical actions are not reconstructed.
- Remaining legacy writes and protected patient operations without transaction actor context are explicitly unverified; this log does not yet prove who performed every change. Checkout, visit and approver RPCs supply trusted actor context.
- Login-attempt history uses fixed server operations. Anonymous browser access to login logs, activity logs and approver settings is denied.
- Audit rows cannot be updated/deleted by the application. A database administrator can still alter database objects; this is not external tamper-proof storage.

## Verification

`scripts/local-activity-approvers-integration.mjs` verifies unauthenticated/clinic/reports denial, administrator access, anonymous table/RPC denial, required reasons, invalid dates, duplicate backup rejection, dated cover/expiry, stale-save rejection, before/after snapshots, opaque actor references, history update denial, successful and failed login recording. Uses a temporary TEST clinic and sessions, then removes them. Test audit events remain intentionally.

Checkout integration, actual EOD export, atomic visit integration, protected patient integration, session/security tests and a production build also passed with audit triggers enabled. Focused lint passed for the new pages/helpers/APIs. UI interactions still need a human check; API tests and a successful build do not replace that check.

## Remaining before live use

1. Individual manager/approver authentication with verified identity, role and clinic coverage; staff configuration alone is not approval authentication.
2. Actual correction requests, approval/rejection, revalidation and atomic execution for void/refund operations, plus reports and replacement links.
3. Migrate remaining direct financial writes to authorized server operations and close their database access. Configuration does not close these paths.
4. Add verified actor context to remaining protected mutations and link global patient events reliably to clinic history where appropriate.
5. Verify a complete recoverable backup and test the final production rollout/rollback sequence. Audit data contains sensitive patient snapshots and needs the same privacy controls as clinical data.

Production recommendation: **NO-GO** for deploying this unfinished correction/security redesign. Continue isolated local implementation and review.

## Local rollback

Prefer forward fixes to preserve history. Do not delete the activity table or its rows. If a trigger blocks an operation, first diagnose and repair its private writer in the disposable test database. A future production rollback needs saved pre-change login-log permissions/policies and a reviewed application rollback coordinated with those permissions; reverting only the app would break login-history access. The migration is not intended to be run twice.
