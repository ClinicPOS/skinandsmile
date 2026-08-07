ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS thermal_logo_width_mm double precision,
  ADD COLUMN IF NOT EXISTS thermal_logo_max_height_mm double precision,
  ADD COLUMN IF NOT EXISTS thermal_logo_alignment text,
  ADD COLUMN IF NOT EXISTS thermal_logo_offset_x_mm double precision,
  ADD COLUMN IF NOT EXISTS thermal_logo_offset_y_mm double precision,
  ADD COLUMN IF NOT EXISTS thermal_logo_high_contrast boolean,
  ADD COLUMN IF NOT EXISTS thermal_text_weight integer,
  ADD COLUMN IF NOT EXISTS thermal_font_size_px double precision;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_thermal_logo_width_mm_check'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_thermal_logo_width_mm_check
      CHECK (
        thermal_logo_width_mm IS NULL
        OR thermal_logo_width_mm BETWEEN 10 AND 72
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_thermal_logo_max_height_mm_check'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_thermal_logo_max_height_mm_check
      CHECK (
        thermal_logo_max_height_mm IS NULL
        OR thermal_logo_max_height_mm BETWEEN 10 AND 72
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_thermal_logo_alignment_check'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_thermal_logo_alignment_check
      CHECK (
        thermal_logo_alignment IS NULL
        OR thermal_logo_alignment IN ('left', 'center', 'right')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_thermal_logo_offset_x_mm_check'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_thermal_logo_offset_x_mm_check
      CHECK (
        thermal_logo_offset_x_mm IS NULL
        OR thermal_logo_offset_x_mm BETWEEN -62 AND 62
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_thermal_logo_offset_y_mm_check'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_thermal_logo_offset_y_mm_check
      CHECK (
        thermal_logo_offset_y_mm IS NULL
        OR thermal_logo_offset_y_mm BETWEEN -8 AND 16
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_thermal_text_weight_check'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_thermal_text_weight_check
      CHECK (
        thermal_text_weight IS NULL
        OR thermal_text_weight IN (500, 700, 800)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clinics_thermal_font_size_px_check'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_thermal_font_size_px_check
      CHECK (
        thermal_font_size_px IS NULL
        OR thermal_font_size_px BETWEEN 9 AND 13
      );
  END IF;
END $$;
