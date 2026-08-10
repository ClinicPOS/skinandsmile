-- Persist immutable per-line pricing and VAT snapshots for new regular POS receipts.
-- Legacy receipt_items rows remain compatible because the new fields stay nullable.

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS service_name_snapshot text,
  ADD COLUMN IF NOT EXISTS allocated_global_discount_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS taxable_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,4),
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS final_line_total numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_items_allocated_global_discount_amount_nonnegative'
  ) THEN
    ALTER TABLE public.receipt_items
      ADD CONSTRAINT receipt_items_allocated_global_discount_amount_nonnegative
      CHECK (
        allocated_global_discount_amount IS NULL
        OR allocated_global_discount_amount >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_items_taxable_amount_nonnegative'
  ) THEN
    ALTER TABLE public.receipt_items
      ADD CONSTRAINT receipt_items_taxable_amount_nonnegative
      CHECK (
        taxable_amount IS NULL
        OR taxable_amount >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_items_vat_rate_allowed'
  ) THEN
    ALTER TABLE public.receipt_items
      ADD CONSTRAINT receipt_items_vat_rate_allowed
      CHECK (
        vat_rate IS NULL
        OR vat_rate IN (0, 0.05)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_items_vat_amount_nonnegative'
  ) THEN
    ALTER TABLE public.receipt_items
      ADD CONSTRAINT receipt_items_vat_amount_nonnegative
      CHECK (
        vat_amount IS NULL
        OR vat_amount >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'receipt_items_final_line_total_nonnegative'
  ) THEN
    ALTER TABLE public.receipt_items
      ADD CONSTRAINT receipt_items_final_line_total_nonnegative
      CHECK (
        final_line_total IS NULL
        OR final_line_total >= 0
      );
  END IF;
END $$;
