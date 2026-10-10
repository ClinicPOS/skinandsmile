# EOD targeted patient lookup review

Local-only change: the EOD export now requests patient history only for patients referenced by its relevant treatment plans and payment records. Requests are split into batches of 200; all six existing clinic history sources retain their clinic restrictions and pagination. Other history screens retain full-history behavior. No authentication caching, database changes, push or deployment.

Verification: production build and TypeScript pass. Existing 17 unit/security test scripts pass; new targeted patient scope tests and refund approval UI test pass. Before/after actual export workbook JSON matches byte-for-byte for report dates 2026-10-07 and 2026-10-10, including all cells and formatting. This verifies identical results on local fixtures; it does not measure live performance.

Remaining optimization opportunities: clinic-wide file-number lookup, sequential report queries, comprehensive failure handling and large-volume pagination review. This narrow change removes the full-history scan; it is not a claim that every possible financial edge case has been proven.
