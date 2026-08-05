-- Persist the original unit price for receipt items so edited fixed-price services
-- can be re-rendered with the original price struck through on receipts and invoices.

ALTER TABLE public.receipt_items
  ADD COLUMN IF NOT EXISTS original_price numeric(12,2);

UPDATE public.receipt_items
SET original_price = price
WHERE original_price IS NULL
  AND price IS NOT NULL;
