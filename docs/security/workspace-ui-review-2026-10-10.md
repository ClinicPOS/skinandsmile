# Manager and CEO interface cleanup

Local only. No production deployment, database change or new permissions.

- Manager navigation groups existing permitted actions under Daily work, Clinic setup and Receipt design. Password settings now have their own My account screen. On smaller screens the menu collapses; assigned-clinic managers still have no clinic selector.
- Overview distinguishes money collected, net collections and outstanding balances. Pending approval and approved-but-unfinished counts use the existing scoped request endpoint. A badge links to approvals.
- Approvals default to unfinished requests, with separate void/refund filters and an explicit completed-history switch. Status wording and colors distinguish approval from completion. Existing review/return/void actions and validation are retained.
- CEO reports have persistent navigation. Clinic performance and doctor ranking are separate pages; all other reporting sections remain available. Clinic/date filters remain shared across pages. Common date shortcuts are reduced to four; the existing date picker retains other periods.
- Collection labels are consistent; doctor figures are labelled ranking credit. Pending attribution warnings are visible on the doctor page. Financial data sources, formulas, sorting and export amounts are unchanged.

Verified TypeScript, production build, CEO calculation tests, doctor ranking tests and approval action tests. Browser checks verified navigation, scoped fake local data, unfinished/history filters, status labels and empty states at the in-app browser width. Screenshots saved outside the repository in the private outputs folder. No real approval or financial action was performed during browser review.
