# Individual owner and clinic-manager workspace

Implemented and tested locally on 7 October 2026. No commit, push, deployment or production database changes were performed.

## User-facing behavior

- `/login/staff` authenticates individual accounts through Supabase Auth password authentication; passwords are not stored in app account tables or activity snapshots.
- The named owner uses Backend → Managers & Access to create managers, assign clinics, grant/revoke section permissions, disable an account, and set optional start/end dates for temporary cover. Only the owner can do this. Manager creation returns a generated password once; no email is sent.
- Managers use `/clinic-admin`, with a fixed assigned clinic and only their granted sections: dashboard/reports, doctors, services, and receipt design. A manager assigned to multiple clinics chooses an assigned clinic when signing in; their session is bound to that clinic.
- Owner clinic workspace can switch clinics. The shared legacy administrator credential is not an owner account.
- Doctor/service deletion controls were replaced with Inactive/Reactivate. Existing database records and links are retained. New visits and checkout cannot assign an inactive doctor. Replaying an already saved visit still works after that doctor becomes inactive.
- Receipt controls include printed text, existing clinic logo choice, thermal alignment/width/font size, A4 logo size/alignment/colors/slogan. Owner advanced branding pages remain available and save through protected server operations. Legal clinic identity fields (such as TRN) are owner-only.
- Editing catalog names/prices does not rewrite receipt amounts. Current print/reprint code still uses current branding and some current catalog labels; receipt design is not an immutable historical snapshot yet.
- Password changes verify the current password and revoke other app sessions. Logout invalidates the current app session.

## Security design

`pos_accounts` holds the trusted Auth user ID, name, email, enabled state and role. `pos_manager_access` holds clinic assignments, permissions, inclusive UAE dates and optimistic concurrency timestamps. User-editable Auth metadata is not used for authorization. The database enforces one owner; this UI cannot create another owner or demote/disable the owner.

New named-account app sessions last up to eight hours. Account and clinic permissions are re-read without caching on every request. Disabled/expired assignments therefore stop existing sessions. SQL write operations recheck enabled accounts and current clinic permissions while holding row locks, and append audit history in the same transaction.

Scoped catalog writes reject record moves, arbitrary table/column selection, cross-clinic IDs and plain-text/URL violations. Raw browser writes to doctors, services and clinics are revoked for both anonymous and authenticated roles. New account/access tables have RLS enabled and no browser grants. Public catalog reads remain for existing POS compatibility. Clinic-manager page routing is restricted to their workspace and its explicit APIs; reports require their exact clinic and the reports permission.

`POS_NAMED_ADMIN_ONLY=true` is configured **only in the isolated local test app**. It rejects legacy shared administrator login and existing legacy administrator sessions there. The original repository environment and production variables were not changed. A coordinated live rollout would need this flag and private server credentials after provisioning and testing the real owner.

## Verification

`scripts/local-manager-workspace-integration.mjs` uses real local Auth logins and fake clinic data. It verifies:

- owner-only account creation/permission changes, manager clinic choices, route/API isolation;
- doctor/service add/edit/deactivate, malicious field and cross-clinic ID rejection;
- inactive-doctor new-visit denial and saved-visit retry after archival;
- receipt text/logo validation and HTML attribute escaping;
- anonymous catalog-write/account-read denial;
- dashboard limited to assigned clinic; all-clinic and foreign-clinic requests denied;
- immediate permission revocation, global disable and dated expiry;
- named audit actors, current-password verification, other-session revocation, logout and legacy administrator login denial.

Checkout (including concurrent retries/credit/BNPL), actual EOD export, protected patient workflows, activity/approver settings, atomic visits, session tests and profile balance refresh tests passed. Focused lint and production build passed. One overlapping fixture test initially failed because another test added a patient between snapshot assertions; rerunning these shared-database tests sequentially passed. No user-interface visual automation was performed; manual page review is still required.

Demo owner: `owner.demo@local.test` / `LocalOwnerTestOnly!42`.

Demo clinic manager: `manager.demo@local.test` / `LocalManagerTestOnly!42` (fake Clinic A only).

These public demo credentials are strictly localhost-only and must never be provisioned on a cloud/live project. Generated TEST accounts are disabled after integration tests; their account/audit rows are retained.

## Exact primary changes

- Migration: `supabase/migrations/20261007170317_individual_manager_workspace.sql`.
- Permissions/session plumbing: `lib/account-access.ts`, `lib/workspace-server.ts`, `lib/session-auth.ts`, `lib/api-session.ts`, `lib/admin-security.ts`, `middleware.ts`.
- Auth/account APIs: `app/api/auth/staff-login/route.ts`, `app/api/owner/managers/route.ts`, `app/api/workspace/{context,catalog,password,logout}/route.ts`.
- UI: `app/login/staff/page.tsx`, `app/backend/managers/page.tsx`, `app/clinic-admin/page.tsx`, `components/clinic-manager-workspace.tsx`, `app/backend/clinic-workspace/page.tsx`, navigation/shell/login links.
- Compatibility: doctor/service routes now use the scoped workspace; branding pages and clinic deduction settings use protected writes; CEO dashboard scopes manager data; POS doctor selection excludes inactive doctors; visit/checkout SQL validates doctor activity; activity log resolves named accounts.
- Safe receipt attributes: `lib/thermal-receipt-branding.ts`; owner design helper: `lib/backend-catalog-client.ts`.

## Remaining and rollout recommendation

**NO-GO for production deployment.** This is a working local account/workspace feature, not complete system-wide security or the correction redesign.

1. Migrate and restrict remaining broad financial/receptionist/configuration/storage database paths. Public anonymous financial reads/writes still exist elsewhere in the legacy application; the new scoped workspace does not secure those paths. Audit this with both anonymous and authenticated credentials before deployment.
2. Link correction approver settings to named account IDs (the earlier configuration uses receptionist IDs), and implement actual refund/void request/approval/execution workflows. The correction-approval permission is stored but the workflow is clearly marked pending.
3. Finish per-visit income attribution and financial report changes for void/refund statuses.
4. Decide and implement historical receipt branding/catalog snapshots if reprints must reproduce the original appearance and labels exactly.
5. Configure real owner/manager recovery, secure account onboarding and production Auth/rate-limit/email settings. Real owner provisioning must be deliberate, without demo credentials. No new cloud project or charge was created.
6. Prove complete backup recovery and rehearse coordinated application/database rollout and rollback.

Local rollback: preserve account/audit data. Prefer forward fixes. Do not restore broad public write grants as a shortcut. Turning off named-admin-only mode re-enables shared legacy administrator sessions and is a security downgrade, not a production recovery plan. A reviewed rollback must coordinate app versions, server configuration and catalog permissions; reverting just the app would leave legacy browser edits denied.
