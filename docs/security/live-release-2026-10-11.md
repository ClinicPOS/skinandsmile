# Live follow-up release 11 October 2026

Owner authorized the live release during a quiet window. Fresh backup completed 00:36:37 Dubai time; local SQL and encrypted archive exist under C:\Clinic-Backups\Current-POS\Daily\2026-10-11.

The three incremental migrations were applied as one explicit transaction via Supabase migration manager_operations_and_reliability_20261011. Exact counts and original-column row fingerprints for every original public table were checked before and after; the transaction succeeded without changing original records. New receptionist availability defaults to true. Existing manager permissions remain unchanged.

Changes include manager staff/catalog/design administration, owner manager removal/reset, saved-row visit counts, targeted EOD patient lookup, fail-closed EOD reads, protected note-context reads, patient-save checkout gate and atomic cash audit trigger. Receipt-history pagination remains pending.

Deployment must use the same application changes: old cash-deduction routes also insert logs separately, so do not reopen financial use between database change and application deployment. Do not run blind db push: remote migrations are atomic bundles while local history contains individual files.

No missing or mismatched transactions from the 10 October spreadsheet comparison were modified.
