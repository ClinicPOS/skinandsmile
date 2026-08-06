ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS enable_expenses boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enable_commissions boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.cash_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE RESTRICT,
  register_session_id uuid NOT NULL REFERENCES public.cash_register_sessions(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('expense', 'commission')),
  staff_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  paid_to_name text NOT NULL,
  description text NOT NULL,
  reference_number text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  created_by uuid REFERENCES public.receptionist(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.receptionist(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_by uuid REFERENCES public.receptionist(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_reason text,
  CONSTRAINT cash_deductions_void_requires_metadata CHECK (
    status <> 'voided'
    OR (voided_at IS NOT NULL AND NULLIF(btrim(COALESCE(void_reason, '')), '') IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.cash_deduction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deduction_id uuid NOT NULL REFERENCES public.cash_deductions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'voided')),
  changed_by uuid REFERENCES public.receptionist(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  previous_data jsonb,
  next_data jsonb
);

CREATE INDEX IF NOT EXISTS cash_deductions_clinic_date_idx
  ON public.cash_deductions(clinic_id, business_date, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_deductions_register_session_idx
  ON public.cash_deductions(register_session_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_deductions_type_status_idx
  ON public.cash_deductions(type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_deduction_events_deduction_idx
  ON public.cash_deduction_events(deduction_id, changed_at DESC);

ALTER TABLE public.cash_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_deduction_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_deductions_select ON public.cash_deductions;
DROP POLICY IF EXISTS cash_deductions_insert ON public.cash_deductions;
DROP POLICY IF EXISTS cash_deductions_update ON public.cash_deductions;
DROP POLICY IF EXISTS cash_deduction_events_select ON public.cash_deduction_events;
DROP POLICY IF EXISTS cash_deduction_events_insert ON public.cash_deduction_events;

CREATE POLICY cash_deductions_select ON public.cash_deductions FOR SELECT USING (true);
CREATE POLICY cash_deductions_insert ON public.cash_deductions FOR INSERT WITH CHECK (true);
CREATE POLICY cash_deductions_update ON public.cash_deductions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY cash_deduction_events_select ON public.cash_deduction_events FOR SELECT USING (true);
CREATE POLICY cash_deduction_events_insert ON public.cash_deduction_events FOR INSERT WITH CHECK (true);
