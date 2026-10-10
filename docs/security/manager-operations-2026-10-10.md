# Manager workspace expansion — local preparation

Not deployed. Do not apply the migration to production yet.

## Changes

- Assigned-clinic receptionist creation/editing/PIN changes, with a separate owner-granted permission. Inactive receptionists are denied login; removing staff availability or changing PIN revokes their POS sessions. Historical rows remain.
- Owner-only removal of all manager access, including session revocation in the same database operation. No auth user or historical activity is deleted.
- Owner-only manager password reset with a temporary password shown once, session revocation and an activity-log entry. Passwords are not logged.
- Searchable, category-grouped service/doctor/staff editor; inactive filter; fixed/range price controls; per-tooth quantity and required/optional tooth-number selection. Existing catalog fields are used.
- Existing thermal and A4 preview editors reused in the workspace with a fixed clinic. A4 PNG/JPEG uploads use a clinic-authorized server endpoint and file signature/size validation.
- Duplicate doctors/services/receptionist/design items removed from owner navigation. Owner retains Clinic Workspace for oversight and emergency assistance, plus account/security/clinic controls. Existing URLs remain compatible.
- Routine catalog changes have automatic audit reasons. Availability removal is staged in the edit form and requires Save.

## Verification

Production build and TypeScript checks passed. Route tests passed for assigned-clinic denial, missing permission, unsigned calls, invalid PIN, invalid price range and owner-only access removal; these use a mocked database.

After Docker was updated and restarted, the local migration passed, preserving existing receptionist records. Actual owner/manager regression tests passed. New integration tests passed for staff creation/edit/removal, old and stale session denial, PIN-free audit, both API and direct SQL clinic isolation, permission removal, owner password reset and old-password denial, immediate manager removal, scoped logo upload and invalid image denial. Range validation also rejects partial-update bypasses.

Ordinary checkout and EOD regression tests passed, including VAT, discount, partial payments, BNPL fee, duplicate-reference rollback, concurrent retries and credit protection. Existing staff privacy/attempt-limit tests passed.

Browser inspection verified the consolidated owner navigation, service range/tooth controls and both print previews. The standalone clinic workspace avoids nested backend headers. A screenshot is saved in the private outputs folder. No live database migration or deployment was performed.

## Before production

- Review the local workspace with the clinic owner, including assigned-clinic receptionist permission and removal confirmation.
- Reconcile live migration history before the next production database update.
- Verify the production `clinic-branding` logo bucket configuration during release preparation; the local test bucket supports PNG/JPEG images up to 5 MB.
- Deploy application and database changes together during an approved quiet window. Do not deploy the new receptionist session checks before the new column exists.

Existing managers do not automatically gain receptionist administration. The owner explicitly grants the new permission. Categories are not guessed or bulk-assigned to existing services; the manager organizes them deliberately.
