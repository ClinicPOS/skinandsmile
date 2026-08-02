-- POS service browser structured fields + favorites support.
-- Safe migration: additive only, with backfill from existing columns.

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS standard_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS category_id text,
  ADD COLUMN IF NOT EXISTS active_plan_recommended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS search_keywords text,
  ADD COLUMN IF NOT EXISTS common_aliases text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS canonical_service_id uuid REFERENCES public.services(id) ON DELETE SET NULL;

DO $$
DECLARE
  has_description boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'description'
  )
  INTO has_description;

  IF has_description THEN
    UPDATE public.services
    SET
      display_name = COALESCE(NULLIF(BTRIM(display_name), ''), name),
      variant = COALESCE(NULLIF(BTRIM(variant), ''), NULLIF(BTRIM(description), '')),
      standard_price = COALESCE(standard_price, price, 0),
      category_id = COALESCE(NULLIF(BTRIM(category_id), ''), NULLIF(BTRIM(category), '')),
      sort_order = COALESCE(sort_order, 0)
    WHERE
      display_name IS NULL
      OR BTRIM(display_name) = ''
      OR variant IS NULL
      OR standard_price IS NULL
      OR category_id IS NULL
      OR sort_order IS NULL;
  ELSE
    UPDATE public.services
    SET
      display_name = COALESCE(NULLIF(BTRIM(display_name), ''), name),
      standard_price = COALESCE(standard_price, price, 0),
      category_id = COALESCE(NULLIF(BTRIM(category_id), ''), NULLIF(BTRIM(category), '')),
      sort_order = COALESCE(sort_order, 0)
    WHERE
      display_name IS NULL
      OR BTRIM(display_name) = ''
      OR standard_price IS NULL
      OR category_id IS NULL
      OR sort_order IS NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS services_clinic_active_sort_idx
  ON public.services(clinic_id, is_active, sort_order, display_name);

CREATE INDEX IF NOT EXISTS services_canonical_service_id_idx
  ON public.services(canonical_service_id);

CREATE TABLE IF NOT EXISTS public.service_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  receptionist_id uuid REFERENCES public.receptionist(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS service_favorites_clinic_level_uidx
  ON public.service_favorites(clinic_id, service_id)
  WHERE receptionist_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS service_favorites_user_level_uidx
  ON public.service_favorites(clinic_id, receptionist_id, service_id)
  WHERE receptionist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_favorites_lookup_idx
  ON public.service_favorites(clinic_id, receptionist_id, created_at DESC);

ALTER TABLE public.service_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_favorites_select ON public.service_favorites;
DROP POLICY IF EXISTS service_favorites_insert ON public.service_favorites;
DROP POLICY IF EXISTS service_favorites_delete ON public.service_favorites;

CREATE POLICY service_favorites_select ON public.service_favorites FOR SELECT USING (true);
CREATE POLICY service_favorites_insert ON public.service_favorites FOR INSERT WITH CHECK (true);
CREATE POLICY service_favorites_delete ON public.service_favorites FOR DELETE USING (true);
