-- Backfill original_price for historical receipt items
-- For receipts without an original_price saved, use the charged price as the original price
-- This ensures historical receipts display correctly in Receipt History

UPDATE public.receipt_items
SET original_price = price
WHERE original_price IS NULL
  AND price IS NOT NULL;
