# Local financial transaction stage — 7 October 2026

Status: checkout and treatment-visit server operations implemented and tested locally. Overall production release remains NO-GO.

## Changes

- Regular POS checkout now calls /api/receipts/checkout rather than separately inserting receipt, items, allocations, credit deductions and outstanding balances.
- complete_pos_checkout saves those financial rows in one database transaction. Failure rolls back the entire checkout. It preserves current financial tables, payment RPC and reporting amounts.
- The server validates session/role/clinic, receptionist and doctor ownership, patient/file membership, service ownership and current VAT, line arithmetic, payment/VAT allocation, provider fees, credit availability and open register ownership.
- A request UUID is retained in sessionStorage until the successful transaction is finalized. The database retains the request/result. Repeating an identical request returns its existing receipt; changing a committed request returns conflict. Recovery lookup requires an authorized clinic/manager session. Changed pending carts can be discarded only after a saved receipt is confirmed.
- Patient-credit checkout is serialized on the clinic file row. This prevents double spending between checkouts using this operation. Legacy direct credit writers do not yet participate in this lock and remain a release blocker.
- Treatment visits use record_treatment_plan_visit: lock the plan, validate patient/doctor/receptionist clinic membership, enforce Active status/visit limit and atomically mark completion. Replays reuse the visit UUID. Pending IDs survive page reload in sessionStorage. Existing imported-visit minimum-count behavior remains.
- Visit doctor remains optional for backward compatibility. Per-service doctor attribution and income-policy changes are not implemented here.
- EOD outstanding now compares invoice value excluding provider fees with settled invoice/credit. Fully paid BNPL receipts no longer show the collected fee as an outstanding balance.
- Nonfinancial patient notes remain a separate checked operation; note failure warns that payment was already saved and must not be repeated.

## Local-only migrations

- 20261007110516_atomic_treatment_plan_visit.sql: additive invoker function, service-role EXECUTE only.
- 20261007110801_atomic_pos_checkout.sql: additive private request table and invoker checkout function, service-role EXECUTE only.

Neither migration alters existing financial table/function permissions. Do not deploy the changed app without its matching functions and private server credentials. No production change was made.

## Tests

- Real localhost checks: missing session, reports-only session, wrong clinic/doctor, malformed UUID/details and excessive note size rejected.
- Two concurrent requests for the last visit produce one visit; plan completion and insertion are one transaction. Identical retry returns the same visit; changed retry is rejected.
- Full/partial payment, credit-only payment, discount, Cash/Card split, bank transfer and Tabby fee checkout pass.
- Concurrent identical checkout produces one receipt/payment. Concurrent credit spending permits only one deduction.
- A duplicate provider reference inside one split payment deliberately fails after receipt/items insertion; no receipt, items or request record remains.
- The actual POS checkout function is executed against local HTTP APIs, including identical retry and persisted request ID.
- The actual EOD export function reconciles each generated receipt's subtotal, discount, total, VAT, collection, credit and outstanding values against independent database records.
- Fake fixtures and temporary sessions are removed after integration checks. Existing clinic patient/payment records are not altered.

## Rollback

Pause local writes and restore the previous app files as a coordinated unit. Keep the additive request table and saved idempotency records; they contain confirmed checkout recovery information. Existing financial tables retain their original permissions in this increment, so old app compatibility remains, with its original security/partial-save risks. Do not restore an old data dump over newer financial rows. A production rollback snapshot and full recovery rehearsal are still required before release.

## Remaining security work

- Migrate all other financial reads and writes: treatment-plan creation/payment, deposits/credit adjustments, old-balance payments, refunds, receipt deletion and administration/export paths.
- Existing anonymous financial tables and older SECURITY DEFINER RPCs still permit bypassing these server checks. Restrict them only after every dependent path is migrated and verified.
- All credit writers must use the same serialization lock before concurrency protection can be claimed system-wide.
- Patient demographics/file links remain shared across clinics according to the existing model. This stage does not split old patients.
- Price overrides and discounts retain existing receptionist behavior; clinic approval rules require a separate explicit policy.
- Complete backup restore validation, production credential setup, isolated Preview configuration and coordinated release/rollback remain open.

## Recovery files inspected in this stage

The existing 5 October backup contains COPY sections for 26 Auth tables, 41 public tables and five Storage tables. Its role dump contains three ALTER ROLE statements. The local Auth compatibility additions are present, but the local Storage schema still lacks the six previously identified newer columns. No full restore was attempted in this increment: replaying role changes into the shared test cluster could change its global roles, and a SQL dump does not by itself prove Storage file-content recovery. Use a separate isolated restore environment with matching managed schemas and reconcile all source counts before approving production release.
