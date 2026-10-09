# Local work checkpoint — 8 October 2026

Production decision: NO-GO. No live Supabase changes, commits, pushes or deployments were made.

## Completed and verified locally

- Till reconciliation excludes voided receipts/cancelled payments and deducts the actual money returned, including VAT. Refunds are scoped to clinic, receptionist and shift. Unavailable cash data blocks register closure.
- Removed the alternate receipt-log direct refund implementation and its linked-balance deletion. That screen now explains the approved POS request path.
- Replaced treatment-plan hard deletion with named owner/manager cancellation of unused, unpaid plans. Paid/imported/visited plans are blocked for financial review. Originals and cancellation audit stay. New payments/visits on cancelled plans are rejected; repeated cancellation creates one activity record.
- Disabled hard deletion of saved outstanding balances in the owner backend. Financial adjustments require a separate recorded workflow.
- Added an atomic protected outstanding-balance payment operation. It verifies clinic, receptionist, open register and remaining balance; concurrent payments cannot overpay and identical retries save once. Anonymous insert/update/delete on balance payments is revoked locally.
- Cancelled plans no longer inflate current outstanding balances. Historical report dates before cancellation retain the original balance.
- Alternate receipt and treatment history label voided receipts. Receipt history does not reprint a voided record as a valid receipt/invoice.
- The actual EOD export reconciles receipt net collections plus separately reported plan/old-balance/prepayment collections against the daily summary.

Checks: local refund/void integration, cancellation integration, balance-payment integration, real cash-summary endpoint, cash/VAT reconciliation and cancellation-date tests, EOD export, TypeScript and production build. Retained labelled fake financial records are audit fixtures; they are not live clinic records.

## Recovery evidence

The saved 5 October schema/data backup was restored in one transaction into a separate local database, `pos_restore_audit_20261008`, with exit code 0. All 72 dump table row counts matched; 145 foreign-key relationships had no orphan records. The running local POS database still has its three fake patients. Connections to the separate recovery database were restricted.

The managed Auth/Storage schema was bootstrapped from the existing local schema. Six missing Storage dump columns were added with types checked against official migrations [0062](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0062-object-versioning-core.sql) and [0068](https://raw.githubusercontent.com/supabase/storage/master/migrations/tenant/0068-bucket-lifecycle-configuration.sql). This proves recovery of the SQL data and its links. It does **not** prove a complete matching Supabase service deployment, Storage file-content recovery, Google Drive sync, or recovery of transactions created after 5 October. The roles were already present locally; account/password/role provisioning is not established by this check.

The restore log remains privately under Documents/Codex/2026-10-05/referenced-chatgpt-conversation-this-is-an/outputs/local-isolated-restore-20261008.log. No backup patient data was copied into the repository.

## Work still required before production

1. Finish authenticated server reads/writes for plans, plan payments, credits, cash-register lifecycle, financial histories/reports and remaining staff/catalog administration. Balance-payment writes are protected; this is not complete financial RLS coverage.
2. Remove shared/hardcoded login alternatives and browser exposure of receptionist PINs; use durable attempt limiting. Provision real owner/managers and verify private production configuration.
3. Correct/reconcile mixed-doctor receipt and refund ranking before using rankings for monetary awards. Treatment-plan credit remains pending by the user's decision.
4. Rehearse the complete access-control migration and compatible application release against a fresh production-schema copy. Obtain and verify a fresh pre-release backup; the recovered snapshot is from 5 October.
5. Broaden historic/mixed-method/discount/credit reporting and exact migration-order checks; inspect remaining dependency advisories.

Do not enable blanket denial policies on the live database while the deployed application still depends on direct browser operations. See release-readiness-2026-10-08.md for the original read-only live findings and rollout requirements. This checkpoint supersedes its completed-item descriptions, not its remaining security blockers.

## Additional local security checks completed

- Treatment-plan payments now use a server-verified, locked database operation. Clinic, receptionist, open register, remaining balance and payment allocation amounts are checked. Identical retries save once; competing payments cannot overpay. Anonymous access to the old payment function and direct payment writes is revoked locally.
- Removed hardcoded fallback login passwords and legacy shared manager login. The configured shared clinic password remains a transition path; it has not been replaced by individual receptionist accounts.
- Login attempts now have atomic database counters for shared clinic login, named owner/manager login, and receptionist PIN verification. Receptionist account counters also cover attempts made from different sessions. Counters contain hashes, not passwords or PINs. Verification errors fail closed.
- Browsers receive only receptionist lookup fields, never PINs. PIN checks are server-side. Staff creation/editing requires a verified named owner and records a PIN-redacted audit entry in the same transaction. Moving an existing staff account to another clinic is blocked to protect history.
- Removed the standalone unassigned-staff creation form and redirected account administration to Backend. Staff hard deletion is blocked in the owner screen to retain historical links.

Validation: local staff-security integration, concurrent plan-payment integration, actual EOD export and TypeScript passed. The final production build passed with 42 generated pages; TypeScript and login integration also passed after the authentication hardening. No live database changes, push or deployment.

Remaining checklist above still applies to financial read access, plan creation, credits, register lifecycle, catalog administration, ranking, dependency advisories, fresh backup and the complete rollout rehearsal. Item 2 is partly resolved by this section; real account provisioning and private production configuration remain outstanding. This is not a production go-ahead.


## Register lifecycle protection - local stage

Opening and closing registers now use a receptionist-authenticated server endpoint. Direct anonymous register writes are revoked locally. Concurrent opening resumes one saved row, including its original opening cash/date. A failed save no longer unlocks the POS or clears a register locally. Owner/clinic/receptionist checks and database audit records are enforced; repeat close with the same cash amount returns the original saved closure without duplicate audit. Expected cash is computed from server records, not the browser's submitted amount or variance.

Local register integration passed: unauthorized/foreign staff rejection, invalid amount, concurrent open, server variance, repeat close, changed close rejection, audit counts and anonymous insert denial. Actual EOD export also passed.

Still required: make close reconciliation and simultaneous financial posting one serialized operation. Current close computes the cash summary on the server before taking the final database register lock; simultaneous posting can change the ledger in that interval. Do not treat this stage as a live-release approval. Financial reads, plan/credit writes, historical reporting and final security rehearsal remain outstanding.

## Latest local remediation - supersedes completed-item blockers above

- Register ledger writes now serialize with closure. A stale server reconciliation fingerprint rejects closure; checkout requires the saved open register. Local register and checkout integration passed.
- All 24 screen data sources use authenticated server reads with clinic scoping. Public database table access is revoked locally and public base tables have RLS enabled. Arbitrary embedded relations are denied; the two supported shallow screen relations have fixed fields. Clinic separation, nested-read denial, public PIN denial and staff permission tests passed.
- Plan creation, historical plan visits, deposits and legacy balances use validated server operations with durable request IDs and audit entries. Historical doctor attribution remains unknown rather than fabricated. Local creation, retry, scope and closed-register checks passed.
- Favorites and greetings use scoped server routes. Their new write routes still require focused integration verification.
- Owner catalog changes use protected catalog operations; doctor/service removal deactivates records and preserves historic links. Manager workspace integration passed after restrictions.
- Patient access and backup exports use protected connections after session verification. Registration, editing, duplicate file numbers, clinic history, birthdays, workbook export and foreign-clinic denial integration passed after restrictions.
- Doctor ranking allocates discounted treatment value by line doctor, excludes VAT/provider fees, and deducts explicitly recorded treatment refunds including older-sale returns. Unknown attribution withholds ranking. Mixed-doctor, discount, cent-allocation and refund tests passed; the CEO endpoint confirmed pending treatment-plan credit remains clearly marked.
- The broader current-day checkout/EOD test exposed a one-fils truncation discrepancy. Export normalization now rounds recorded currency to cents. The actual checkout screen, atomic checkout and current-day EOD reconciliation passed after the fix.
- Next.js and its ESLint configuration updated from 16.3.6 to the verified security patch 16.3.8. TypeScript and pure calculation/session/file-number/refresh tests passed. Final patched-framework build was attempted but failed because the Windows sandbox denied SWC path canonicalization; this is not a passing build.

Tool approval review subsequently became unavailable due to its usage limit. Package-version verification and the complete database rehearsal were not executed after that failure. No bypass was attempted. The running localhost test copy still has the previous installed framework version until its packages are synchronized and its server restarted.

Prepared `scripts/verify-local-release.ps1`: default checks TypeScript/build only; `-RehearseDatabase` applies all 23 migrations in one transaction to `pos_restore_audit_20261008` only, checks every original public record fingerprint and all foreign-key relationships, and rolls back on failure. This script is prepared, not executed or verified.

### Remaining release gates

1. Run the final build outside the failing sandbox and rerun integration against the patched framework in the test copy.
2. Execute/review the complete isolated migration rehearsal. Obtain a fresh production schema/backup; the available recovery copy is from 5 October.
3. Finish preference-write tests and independent security/reporting review, including older-sale returns and mutable-search-path/advisor findings.
4. Remaining npm advisories: five high entries in the development ESLint dependency chain (braces), two moderate entries in ExcelJS/uuid. Do not apply the suggested major downgrades blindly. ExcelJS currently imports UUID v4; the UUID advisory concerns v3/v5/v6 with a supplied buffer. Compatibility/risk assessment and focused workbook validation still need completion.
5. Provision real named owner/managers, verify private server/session secrets and deployment configuration, and coordinate database/app cutover and rollback. Existing production is unchanged. There is no production release approval from these local results.
