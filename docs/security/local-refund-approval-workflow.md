# Local refund approval workflow

Local implementation only. No production migration, push or deployment.

## Workflow

1. Receptionist opens an existing receipt and selects services and the original payment allocations to refund.
2. Request Refund saves a PENDING request. No refund, revenue reversal or payment change occurs.
3. An enabled named manager with correction_approval access for this clinic, or the named owner, reviews Refund approvals in the clinic workspace. Rejection requires a reason.
4. APPROVED still does not change money or reports. The requesting receptionist opens Refund requests and confirms actual return of money, with a cash-return or provider reference.
5. One database transaction creates refunds, refund_items and allocation reversals, and closes the request as COMPLETED. Failed writes roll everything back. Repeated confirmation returns the existing result.

Approval and completion must occur on the request's Dubai calendar day. The approver must still have current access at completion. A changed receipt/payment/refund history blocks approval/completion; cancel and create a fresh request. Only one PENDING/APPROVED request may exist per receipt. Requests cannot be edited; cancel and replace them. Request IDs are retained across network retries.

The owner assigns refund approval in Manager access. Dates on the existing manager access assignment handle temporary cover. No shared PIN grants approval. The older receptionist-based correction-approvers configuration is not used by this named-account workflow and should be retired during the later backend cleanup.

## Financial behavior and limits

Only completed refunds create financial rows, so pending/approved/rejected/cancelled requests have no effect on existing EOD or doctor reports. Existing refund treatment/VAT splits and non-refundable Tabby/Tamara fee behavior are retained. Selected snapshot-backed service items can be refunded individually or together. The original receipt and items are retained.

The refund flow blocks receipts without complete pricing snapshots, mixed historical snapshots, missing payment allocations, and payment VAT splits inconsistent with selected services. It does not implement arbitrary partial amounts within one service, credit-only returns, treatment-plan void, or provider API transfers. The later local receipt-correction flow supports approved same-day cash replacements; see local-receipt-corrections-eod.md. Confirmation records the receptionist's attestation; it does not independently prove a bank/provider transfer. Unsupported cases need separate reviewed financial rules before production use.

The queue displays the newest 100 requests per clinic (receptionists see their own). Longer history pagination/export and immutable printed receipt layout remain follow-up work. Existing reports' date attribution is unchanged; separate prior-date refund/report reconciliation is required before production rollout.

## Changes

- Migration 20261007180412_approved_receipt_refunds.sql: protected request table, one-open-request constraint, fingerprint RPC, service-only atomic transition RPC, audit trigger, browser refund write/RPC revocations.
- app/api/workspace/refunds/route.ts: verified sessions, clinic/role checks, authoritative proposal preparation, idempotent request replay, request list and transitions.
- lib/refund-proposal-server.ts: saved item values, existing refund history and original payment allocations determine all amounts; browser prices and actor IDs are not accepted.
- components/refund-approval-queue.tsx: manager review and receptionist return confirmation forms.
- components/pos-modals.tsx: request instead of immediate refund; removed browser balance deletion.
- components/clinic-manager-workspace.tsx: Refund approvals tab gated by assigned permission.
- app/backend/managers/page.tsx: permission label.
- app/refunds/page.tsx and components/app-frame.tsx: receptionist request queue and navigation; old browser shared-PIN refund page removed.
- lib/refund-request-client.ts: request transport.

## Verification and rollback

scripts/local-refund-approval-integration.mjs accepts only localhost Supabase configuration. It checks request/approval/return separation, clinic and role isolation, concurrent retries, item-partial and full refunds, rejection/cancellation, changed receipt guards, disabled approver guards, BNPL fee retention, forced mid-transaction rollback, audit identity, and anonymous table/RPC denial. Labelled fake financial records are retained for audit history; temporary login sessions are removed, test staff disabled, and fixture services made inactive.

Do not independently roll back just the browser code or database grants. The old refund flow is incompatible with these local revocations. For a test rollback, restore the isolated test database snapshot and matching test code together. Before a future production release, verify backups/restoration and expand legacy/refund/report coverage; production remains NO GO for this feature.
