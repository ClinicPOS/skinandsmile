# Local receipt corrections and EOD

Implemented only in the local checkout and isolated test app/database. No push, production migration or deployment.

## User flow

Receptionist opens a saved receipt in POS history, expands it and chooses Correct receipt. They enter corrected services/prices/quantities and a mandatory reason. The manager reviews the proposed bill under Corrections & refunds. After approval, the requesting receptionist chooses Create corrected receipt.

The original becomes VOIDED and retains its original amount and items. Original/replacement receipts link both ways. The existing cash payment record and its allocation move to the replacement (the payment ID, customer money and collection time are preserved). VAT attribution is recalculated for the corrected invoice. Nothing is refunded and no second collection is created. Old uncollected debt is cancelled to zero, retaining its former amount in cancelled_original_amount and the activity log. New remaining debt is recalculated. Repeated confirmation returns the existing replacement.

Manager approval and completion must occur on the request's Dubai calendar date. Older unresolved requests can be rejected/cancelled and submitted again; earlier-day receipt corrections require owner reconciliation. This is a calendar-day rule, not an accounting close or a guarantee that an approval happens before the boss receives a report.

## Safe scope

Automatic correction supports same-day regular receipts with one unreversed cash payment (or no payment), no fees, credits, refunds or collected balance payments. The new invoice must cover all saved money collected. Unsupported card/BNPL/split-payment/credit/refunded/prior-day cases are blocked for review. No owner bypass executes these unsupported cases. Further implementation is required for them; the owner-review message is not a completed alternate workflow.

Example: original invoice 500 with actual saved payment 300, corrected bill 300 -> original 500 remains grey/voided, payment 300 moves to replacement, old uncollected 200 is cancelled. If the system recorded 500 collected, correcting the bill to 300 is blocked; money cannot be erased. Verified payment-entry adjustments, refunds or patient-credit handling need a separately reviewed design.

## EOD

- Transaction Details adds Status, Reason, Approved By, correction/refund time, original/replacement receipt numbers.
- VOIDED: grey fill and strikethrough; original amounts remain visible but are excluded from totals and receipt count.
- REFUNDED: red fill. PARTIALLY_REFUNDED: yellow fill. Existing completed financial reversals still drive refund totals.
- Pending Approvals lists unresolved requests. Export warns and filename starts DRAFT when requests remain; final sending is still a manual clinic action.
- CEO/top-services/cash-deduction receipt queries exclude VOIDED receipts. Payment collections remain counted once through the replacement's preserved payment record.

Old receipt-log hard deletion is removed and browser receipt writes/deletes revoked locally. New actions use verified server sessions and service-only transactional functions.

## Validation

Local refund integration checks linked correction, immutable original sale amount, same payment ID/count, no refund created, repeated/concurrent execution, zero replacement balance, excessive-payment rejection, same-day approval rejection and EOD metadata. Existing refund isolation/atomic rollback tests remain in the suite. The actual EOD function test checks grey strikethrough, separate refund colours, void-excluding totals and pending sheet. TypeScript, focused lint and production build are checked separately. Human browser testing is still required for the new correction form.

## Deployment and rollback

Production remains NO GO. Remaining work includes complete legacy/payment-method support, clinical-plan linkage review, older-day refund detail/report attribution, all historical/reprint screens, immutable EOD close/revision rules and full security/backup verification. Do not deploy these database changes alone. The isolated test database and matching code must be restored together for rollback; do not drop linked financial history or restore old anonymous write permissions on a live system.

Automatic correction also blocks treatment-plan-linked receipts, visit-linked receipts, and receipts containing tooth selections. Those clinical records require a separately reviewed correction workflow; they are never silently discarded.
