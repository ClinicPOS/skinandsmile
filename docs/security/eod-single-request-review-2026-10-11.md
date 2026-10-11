# EOD single-request performance review

The POS report button now sends one protected request to `/api/workspace/eod-export`. The endpoint checks the current session, role and selected clinic once. The middleware defers this endpoint to that explicit check; it does not grant public data access. A manager requires the `reports` permission and the assigned clinic. Revoked accounts remain checked freshly on the next request.

The existing workbook calculation has moved into `lib/eod-workbook.ts`; totals, refund/void handling, historical references, pending-approval warnings, filenames, cells and styles are retained. The browser still creates the Excel download. Independent day reads and patient-history source reads run concurrently. Internal report helpers retain their clinic checks without separate HTTP trips or repeated login queries. The extra manager permission lookup in `/api/pos-read` has been removed because its session verification already obtains current permissions.

The EOD data client is read-only and exists only for one export. It verifies exact result counts, retrieves every page, batches large linked UUID lists into groups of 200, and shares identical reads only within that request. There is no cross-request data or authorization cache. Legacy refund and balance-payment tables retain their parent-clinic filters. A failed source, failed later page or unverifiable row count blocks the report instead of returning partial data. The response is losslessly gzip compressed and marked `private, no-store`.

## Verification

- TypeScript and production build pass (Next.js 16.3.8). The existing middleware deprecation warning remains.
- All 21 unit/security test scripts pass.
- Actual before/after local export comparisons on 7 and 10 October match every workbook cell and style, including refunds, void formatting, treatment-plan payments and current clinic file numbers. The final compressed export also matches.
- Pagination tests preserve all 2,301 rows with a deliberately lower 100-row server cap and all 2,401 linked IDs; failed later pages and missing counts are rejected.
- All 22 required source-table failures reject the actual server workbook generation on localhost.
- Actual localhost downloads pass for receptionist, owner and assigned manager; anonymous, revoked, foreign-clinic, reports-only and invalid-date requests are denied.
- Patient-read, 24-table screen-read and manager-workspace integration checks pass, including immediate permission removal/account disable.
- Local export preparation measured 1,524 ms before and 412 ms after on the same fixture. These are local measurements, not a live performance guarantee. Server timing separates authorization, data/calculation, workbook preparation and response compression; the browser logs Excel writing and overall time without patient data.

No schema, RLS, grants, credentials or production financial records are changed by this release. Receipt-history pagination is a separate remaining optimization; this release does not claim to fix its full-history load time. Authenticated live export timing remains an operator check after deployment.
