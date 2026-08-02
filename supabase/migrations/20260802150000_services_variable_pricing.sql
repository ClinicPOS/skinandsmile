-- Variable-range pricing for services.
-- Additive only; does not touch existing prices or service data.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS pricing_type TEXT NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS min_price    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS max_price    NUMERIC(10,2);

-- Ensure only recognised values are stored.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_pricing_type_check'
      AND conrelid = 'public.services'::regclass
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_pricing_type_check
      CHECK (pricing_type IN ('fixed', 'variable'));
  END IF;
END
$$;

-- Index so the POS query can filter/sort variable services efficiently.
CREATE INDEX IF NOT EXISTS services_pricing_type_idx
  ON public.services (pricing_type)
  WHERE pricing_type = 'variable';
