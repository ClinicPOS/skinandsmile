-- Phase 4: Add per-item VAT/invoice breakdown columns to refund_items.
-- These are populated for new snapshot-backed refunds only.
-- Legacy rows (no snapshot data) leave all three columns NULL — fully compatible.
--
-- amount (existing) continues to store refunded_treatment_amount for reporting
-- compatibility (CEO dashboard reads amount as treatment/service value).

ALTER TABLE public.refund_items
  ADD COLUMN IF NOT EXISTS refunded_treatment_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS refunded_vat_amount        numeric(12,2),
  ADD COLUMN IF NOT EXISTS refunded_invoice_amount    numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_items_refunded_treatment_amount_nonnegative'
  ) THEN
    ALTER TABLE public.refund_items
      ADD CONSTRAINT refund_items_refunded_treatment_amount_nonnegative
      CHECK (refunded_treatment_amount IS NULL OR refunded_treatment_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_items_refunded_vat_amount_nonnegative'
  ) THEN
    ALTER TABLE public.refund_items
      ADD CONSTRAINT refund_items_refunded_vat_amount_nonnegative
      CHECK (refunded_vat_amount IS NULL OR refunded_vat_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_items_refunded_invoice_amount_nonnegative'
  ) THEN
    ALTER TABLE public.refund_items
      ADD CONSTRAINT refund_items_refunded_invoice_amount_nonnegative
      CHECK (refunded_invoice_amount IS NULL OR refunded_invoice_amount >= 0);
  END IF;

  -- When all three snapshot columns are populated, treatment + VAT must equal invoice.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refund_items_snapshot_amounts_consistent'
  ) THEN
    ALTER TABLE public.refund_items
      ADD CONSTRAINT refund_items_snapshot_amounts_consistent
      CHECK (
        refunded_treatment_amount IS NULL
        OR refunded_vat_amount IS NULL
        OR refunded_invoice_amount IS NULL
        OR (refunded_treatment_amount + refunded_vat_amount = refunded_invoice_amount)
      );
  END IF;
END $$;
