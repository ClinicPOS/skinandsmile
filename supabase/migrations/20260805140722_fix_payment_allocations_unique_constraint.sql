-- Fix payment allocations unique constraint to allow same provider ref across different receipts
-- The constraint should be unique per receipt + method_group + provider_reference
-- not globally across all receipts

-- Drop the overly restrictive global unique constraint
drop index if exists public.payment_allocations_provider_ref_unique_idx;

-- Add a better constraint that prevents duplicates within a single payment record
-- (since each payment_record is tied to exactly one receipt via receipt_id)
create unique index if not exists payment_allocations_provider_ref_unique_idx
  on public.payment_allocations(payment_id, method_group, provider_reference_normalized)
  where provider_reference_normalized is not null and method_group in ('tabby', 'tamara');
