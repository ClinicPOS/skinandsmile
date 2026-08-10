ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_vat_rate_allowed_check'
      AND conrelid = 'public.services'::regclass
  ) THEN
    ALTER TABLE public.services
      ADD CONSTRAINT services_vat_rate_allowed_check
      CHECK (vat_rate IS NULL OR vat_rate IN (0, 0.05));
  END IF;
END
$$;
